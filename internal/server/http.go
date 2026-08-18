package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/coder/websocket"
	"rocket-vibe/internal/game"
	"rocket-vibe/internal/protocol"
)

type HTTPOptions struct {
	StaticDirectory string
	Version         string
	AllowedOrigins  []string
	AuthDataFile    string
	DisableAuth     bool
}

type HTTPServer struct {
	match    *Match
	manager  *LobbyManager
	options  HTTPOptions
	logger   *slog.Logger
	handler  http.Handler
	accounts *accountStore
}

const accountSessionCookie = "rocket_vibe_session"

type accountCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type textInputMessage struct {
	Type  string `json:"type"`
	Seq   uint32 `json:"seq"`
	Input struct {
		Mask     uint8   `json:"mask"`
		Edges    uint8   `json:"edges"`
		Flags    uint8   `json:"flags"`
		Throttle float64 `json:"throttle"`
		Steer    float64 `json:"steer"`
	} `json:"input"`
}

type pingMessage struct {
	Type string          `json:"type"`
	Time json.RawMessage `json:"t"`
}

type quickChatInputMessage struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type textChatInputMessage struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type respawnSelectionMessage struct {
	Type  string `json:"type"`
	Index int    `json:"index"`
}

func NewHTTPServer(match *Match, options HTTPOptions, logger *slog.Logger) *HTTPServer {
	server := &HTTPServer{match: match, options: options, logger: logger, accounts: newAccountStore(options.AuthDataFile)}
	server.installRoutes()
	return server
}

func NewLobbyHTTPServer(manager *LobbyManager, options HTTPOptions, logger *slog.Logger) *HTTPServer {
	server := &HTTPServer{manager: manager, options: options, logger: logger, accounts: newAccountStore(options.AuthDataFile)}
	server.installRoutes()
	return server
}

func (server *HTTPServer) installRoutes() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/config", server.config)
	mux.HandleFunc("/debug/game", server.debugGame)
	mux.HandleFunc("/api/auth/", server.authentication)
	mux.HandleFunc("/api/lobbies/defaults", server.lobbyDefaults)
	mux.HandleFunc("/api/lobbies/", server.lobbyByID)
	mux.HandleFunc("/api/lobbies", server.lobbies)
	mux.HandleFunc("/lan", server.webSocket)
	mux.HandleFunc("/", server.static)
	server.handler = securityHeaders(mux)
}

func (server *HTTPServer) Handler() http.Handler { return server.handler }

func (server *HTTPServer) authentication(writer http.ResponseWriter, request *http.Request) {
	if server.options.DisableAuth {
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "accounts are disabled"})
		return
	}
	action := strings.Trim(strings.TrimPrefix(request.URL.Path, "/api/auth/"), "/")
	switch action {
	case "register":
		server.registerAccount(writer, request)
	case "login":
		server.loginAccount(writer, request)
	case "guest":
		server.beginGuestSession(writer, request)
	case "session":
		server.accountSession(writer, request)
	case "logout":
		server.logoutAccount(writer, request)
	default:
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "account endpoint not found"})
	}
}

func (server *HTTPServer) readAccountCredentials(writer http.ResponseWriter, request *http.Request) (accountCredentials, bool) {
	request.Body = http.MaxBytesReader(writer, request.Body, 8<<10)
	var credentials accountCredentials
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&credentials); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "Ungültige Account-Daten."})
		return accountCredentials{}, false
	}
	return credentials, true
}

func publicAccount(account storedAccount) map[string]string {
	return map[string]string{"username": account.Username}
}

func publicIdentity(identity accountIdentity) map[string]any {
	username := identity.Username
	if identity.Guest {
		username = "Gast"
	}
	return map[string]any{"username": username, "guest": identity.Guest}
}

func (server *HTTPServer) beginAccountSession(writer http.ResponseWriter, request *http.Request, account storedAccount) bool {
	token, err := server.accounts.createSession(strings.ToLower(account.Username))
	if err != nil {
		server.logger.Error("account session creation failed", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "Sitzung konnte nicht erstellt werden."})
		return false
	}
	secure := request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(writer, &http.Cookie{
		Name: accountSessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: secure,
		SameSite: http.SameSiteStrictMode, MaxAge: int(accountSessionLifetime.Seconds()),
		Expires: time.Now().Add(accountSessionLifetime),
	})
	return true
}

func (server *HTTPServer) beginGuestSession(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if cookie, err := request.Cookie(accountSessionCookie); err == nil {
		server.accounts.deleteSession(cookie.Value)
	}
	token, err := server.accounts.createGuestSession()
	if err != nil {
		server.logger.Error("guest session creation failed", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "Gast-Sitzung konnte nicht erstellt werden."})
		return
	}
	secure := request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(writer, &http.Cookie{
		Name: accountSessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: secure,
		SameSite: http.SameSiteStrictMode,
	})
	writeJSON(writer, http.StatusCreated, map[string]any{"user": publicIdentity(accountIdentity{Guest: true})})
}

func (server *HTTPServer) registerAccount(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	credentials, ok := server.readAccountCredentials(writer, request)
	if !ok {
		return
	}
	account, err := server.accounts.register(credentials.Username, credentials.Password)
	if err != nil {
		status := http.StatusBadRequest
		message := "Account konnte nicht erstellt werden."
		if errors.Is(err, errAccountExists) {
			status = http.StatusConflict
			message = "Dieser Benutzername ist bereits vergeben."
		} else if errors.Is(err, errInvalidUsername) || errors.Is(err, errInvalidPassword) {
			message = err.Error()
		} else {
			status = http.StatusServiceUnavailable
			server.logger.Error("account registration failed", "error", err)
		}
		writeJSON(writer, status, map[string]string{"error": message})
		return
	}
	if !server.beginAccountSession(writer, request, account) {
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"user": publicAccount(account)})
}

func (server *HTTPServer) loginAccount(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	credentials, ok := server.readAccountCredentials(writer, request)
	if !ok {
		return
	}
	account, err := server.accounts.authenticate(credentials.Username, credentials.Password)
	if err != nil {
		if !errors.Is(err, errInvalidCredentials) {
			server.logger.Error("account login failed", "error", err)
		}
		writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "Benutzername oder Passwort ist falsch."})
		return
	}
	if !server.beginAccountSession(writer, request, account) {
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"user": publicAccount(account)})
}

func (server *HTTPServer) authenticatedAccount(request *http.Request) (accountIdentity, bool) {
	cookie, err := request.Cookie(accountSessionCookie)
	if err != nil || cookie.Value == "" {
		return accountIdentity{}, false
	}
	return server.accounts.session(cookie.Value)
}

func (server *HTTPServer) requireAccount(writer http.ResponseWriter, request *http.Request) bool {
	if server.options.DisableAuth {
		return true
	}
	if _, ok := server.authenticatedAccount(request); ok {
		return true
	}
	writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "Bitte zuerst anmelden."})
	return false
}

func (server *HTTPServer) accountSession(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	identity, ok := server.authenticatedAccount(request)
	if !ok {
		writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "Keine aktive Anmeldung."})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"user": publicIdentity(identity)})
}

func (server *HTTPServer) logoutAccount(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if cookie, err := request.Cookie(accountSessionCookie); err == nil {
		server.accounts.deleteSession(cookie.Value)
	}
	http.SetCookie(writer, &http.Cookie{
		Name: accountSessionCookie, Value: "", Path: "/", HttpOnly: true,
		SameSite: http.SameSiteStrictMode, MaxAge: -1, Expires: time.Unix(1, 0),
	})
	writeJSON(writer, http.StatusOK, map[string]bool{"loggedOut": true})
}

func (server *HTTPServer) health(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if server.manager != nil {
		lobbies := server.manager.List()
		var players int32
		for _, lobby := range lobbies {
			players += lobby.Players
		}
		writeJSON(writer, http.StatusOK, map[string]any{
			"ok": true, "service": "rocket-vibe-go", "version": server.options.Version,
			"lobbies": len(lobbies), "players": players,
		})
		return
	}
	writeJSON(writer, http.StatusOK, struct {
		OK      bool   `json:"ok"`
		Service string `json:"service"`
		Version string `json:"version"`
		Stats
	}{OK: true, Service: "rocket-vibe-go", Version: server.options.Version, Stats: server.match.Stats()})
}

func (server *HTTPServer) config(writer http.ResponseWriter, request *http.Request) {
	if !server.requireAccount(writer, request) {
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	match, ok := server.matchForRequest(request)
	if !ok {
		if server.manager != nil {
			writeJSON(writer, http.StatusOK, server.manager.Defaults().Config)
			return
		}
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobby not found"})
		return
	}
	writeJSON(writer, http.StatusOK, match.Config())
}

func (server *HTTPServer) debugGame(writer http.ResponseWriter, request *http.Request) {
	if !server.requireAccount(writer, request) {
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	match, ok := server.matchForRequest(request)
	if !ok {
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobby not found"})
		return
	}
	writeJSON(writer, http.StatusOK, struct {
		Stats Stats         `json:"stats"`
		State game.Snapshot `json:"state"`
	}{Stats: match.Stats(), State: match.LatestState()})
}

func (server *HTTPServer) lobbyDefaults(writer http.ResponseWriter, request *http.Request) {
	if !server.requireAccount(writer, request) {
		return
	}
	if server.manager == nil {
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobbies are disabled"})
		return
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(writer, http.StatusOK, server.manager.Defaults())
}

func (server *HTTPServer) lobbies(writer http.ResponseWriter, request *http.Request) {
	if !server.requireAccount(writer, request) {
		return
	}
	if server.manager == nil {
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobbies are disabled"})
		return
	}
	switch request.Method {
	case http.MethodGet, http.MethodHead:
		writeJSON(writer, http.StatusOK, map[string]any{"lobbies": server.manager.List()})
	case http.MethodPost:
		request.Body = http.MaxBytesReader(writer, request.Body, 128<<10)
		var create LobbyCreateRequest
		decoder := json.NewDecoder(request.Body)
		if err := decoder.Decode(&create); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid lobby settings"})
			return
		}
		lobby, err := server.manager.Create(create)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrLobbyLimit) {
				status = http.StatusServiceUnavailable
			}
			writeJSON(writer, status, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusCreated, lobbySummary(lobby))
	default:
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (server *HTTPServer) lobbyByID(writer http.ResponseWriter, request *http.Request) {
	if !server.requireAccount(writer, request) {
		return
	}
	if server.manager == nil {
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobbies are disabled"})
		return
	}
	id := strings.Trim(strings.TrimPrefix(request.URL.Path, "/api/lobbies/"), "/")
	if id == "" {
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobby not found"})
		return
	}

	switch request.Method {
	case http.MethodGet, http.MethodHead:
		lobby, ok := server.manager.Get(id)
		if !ok {
			writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobby not found"})
			return
		}
		writeJSON(writer, http.StatusOK, lobbySummary(lobby))
	case http.MethodDelete:
		if err := server.manager.Delete(id); err != nil {
			if errors.Is(err, ErrLobbyNotFound) {
				writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobby not found"})
				return
			}
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"deleted": true, "id": id})
	default:
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (server *HTTPServer) matchForRequest(request *http.Request) (*Match, bool) {
	if server.manager == nil {
		return server.match, server.match != nil
	}
	id := strings.TrimSpace(request.URL.Query().Get("lobby"))
	if id == "" {
		return nil, false
	}
	lobby, ok := server.manager.Get(id)
	if !ok {
		return nil, false
	}
	return lobby.Match, true
}

func (server *HTTPServer) webSocket(writer http.ResponseWriter, request *http.Request) {
	if !server.requireAccount(writer, request) {
		return
	}
	if request.Method != http.MethodGet {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	match, ok := server.matchForRequest(request)
	if !ok {
		writeJSON(writer, http.StatusNotFound, map[string]string{"error": "lobby not found"})
		return
	}
	lobbyID := strings.TrimSpace(request.URL.Query().Get("lobby"))
	connection, err := websocket.Accept(writer, request, &websocket.AcceptOptions{
		OriginPatterns:  server.options.AllowedOrigins,
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		server.logger.Warn("websocket rejected", "error", err)
		return
	}
	connection.SetReadLimit(4096)

	clientID, err := randomID()
	if err != nil {
		_ = connection.Close(websocket.StatusInternalError, "could not create player id")
		return
	}
	playerName := request.URL.Query().Get("name")
	if !server.options.DisableAuth {
		if identity, authenticated := server.authenticatedAccount(request); authenticated && !identity.Guest {
			// The authenticated account is the multiplayer identity. Do not trust a
			// caller-supplied websocket query to impersonate another display name.
			playerName = identity.Username
		}
	}
	connected := newClient(
		clientID, connection,
		sanitizePlayerName(playerName),
		sanitizeCarStyle(request.URL.Query().Get("car")),
		sanitizeBoostStyle(request.URL.Query().Get("boost")),
	)
	joinContext, cancelJoin := context.WithTimeout(request.Context(), 3*time.Second)
	_, err = match.Join(joinContext, connected)
	cancelJoin()
	if err != nil {
		payload, _ := json.Marshal(map[string]any{"type": "server-full", "maxPlayers": match.Config().MaxPlayers})
		writeContext, cancelWrite := context.WithTimeout(context.Background(), time.Second)
		_ = connection.Write(writeContext, websocket.MessageText, payload)
		cancelWrite()
		_ = connection.Close(websocket.StatusTryAgainLater, err.Error())
		return
	}
	server.logger.Info("player connected", "player", connected.slot+1, "players", match.Stats().Players, "lobby", lobbyID)
	defer func() {
		match.Leave(clientID)
		connected.stop()
		server.logger.Info("player disconnected", "player", connected.slot+1, "lobby", lobbyID)
	}()

	writerDone := make(chan error, 1)
	go func() {
		writerDone <- connected.runWriter()
		connected.cancel()
	}()

	for {
		select {
		case <-writerDone:
			return
		default:
		}

		messageType, payload, readErr := connection.Read(connected.ctx)
		if readErr != nil {
			status := websocket.CloseStatus(readErr)
			if status != websocket.StatusNormalClosure && status != websocket.StatusGoingAway && !errors.Is(readErr, context.Canceled) {
				server.logger.Debug("websocket read ended", "player", connected.slot+1, "error", readErr)
			}
			return
		}
		switch messageType {
		case websocket.MessageBinary:
			packet, ok := protocol.DecodeInput(payload)
			if ok {
				match.SubmitInput(clientID, game.Input{
					Sequence: packet.Sequence, Mask: packet.Mask, Edges: packet.Edges, Flags: packet.Flags,
					Throttle: packet.Throttle, Steer: packet.Steer,
				})
			}
		case websocket.MessageText:
			server.handleTextMessage(match, connected, payload)
		}
	}
}

func (server *HTTPServer) handleTextMessage(match *Match, connected *client, payload []byte) {
	var envelope struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(payload, &envelope) != nil {
		return
	}
	switch envelope.Type {
	case "ping":
		var ping pingMessage
		if json.Unmarshal(payload, &ping) != nil {
			return
		}
		if len(ping.Time) == 0 {
			ping.Time = json.RawMessage("0")
		}
		pong, _ := json.Marshal(struct {
			Type string          `json:"type"`
			Time json.RawMessage `json:"t"`
		}{Type: "pong", Time: ping.Time})
		connected.offerJSON(pong)
	case "input":
		var message textInputMessage
		if json.Unmarshal(payload, &message) == nil {
			match.SubmitInput(connected.id, game.Input{
				Sequence: message.Seq, Mask: message.Input.Mask, Edges: message.Input.Edges, Flags: message.Input.Flags,
				Throttle: message.Input.Throttle, Steer: message.Input.Steer,
			})
		}
	case "replay-skip":
		match.SubmitReplaySkip(connected.id)
	case "quick-chat":
		var message quickChatInputMessage
		if json.Unmarshal(payload, &message) == nil {
			if _, ok := quickChatOptionFor(message.ID); ok {
				match.SubmitQuickChat(connected.id, message.ID)
			}
		}
	case "chat":
		var message textChatInputMessage
		if json.Unmarshal(payload, &message) == nil {
			match.SubmitTextChat(connected.id, message.Text)
		}
	case "respawn-select":
		var message respawnSelectionMessage
		if json.Unmarshal(payload, &message) == nil {
			match.SubmitRespawnSelection(connected.id, message.Index)
		}
	}
}

func (server *HTTPServer) static(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	requestedPath := path.Clean("/" + request.URL.Path)
	relativePath := strings.TrimPrefix(requestedPath, "/")
	if relativePath == "" || relativePath == "." {
		relativePath = "index.html"
	}
	candidate, ok := safeStaticPath(server.options.StaticDirectory, relativePath)
	if !ok {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid path"})
		return
	}
	info, err := os.Stat(candidate)
	if err != nil || !info.Mode().IsRegular() {
		if path.Ext(requestedPath) != "" {
			writeJSON(writer, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		candidate, _ = safeStaticPath(server.options.StaticDirectory, "index.html")
		if _, err = os.Stat(candidate); err != nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "frontend build is missing"})
			return
		}
	}
	if strings.HasPrefix(relativePath, "assets/") {
		writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		writer.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(writer, request, candidate)
}

func safeStaticPath(root, relative string) (string, bool) {
	root, err := filepath.Abs(root)
	if err != nil {
		return "", false
	}
	candidate, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(relative)))
	if err != nil {
		return "", false
	}
	relation, err := filepath.Rel(root, candidate)
	if err != nil || relation == ".." || strings.HasPrefix(relation, ".."+string(filepath.Separator)) {
		return "", false
	}
	return candidate, true
}

func randomID() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("Referrer-Policy", "same-origin")
		writer.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		writer.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		next.ServeHTTP(writer, request)
	})
}
