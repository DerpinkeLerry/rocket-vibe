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
}

type HTTPServer struct {
	match   *Match
	options HTTPOptions
	logger  *slog.Logger
	handler http.Handler
}

type textInputMessage struct {
	Type  string `json:"type"`
	Seq   uint32 `json:"seq"`
	Input struct {
		Mask  uint8 `json:"mask"`
		Edges uint8 `json:"edges"`
		Flags uint8 `json:"flags"`
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

func NewHTTPServer(match *Match, options HTTPOptions, logger *slog.Logger) *HTTPServer {
	server := &HTTPServer{match: match, options: options, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/config", server.config)
	mux.HandleFunc("/debug/game", server.debugGame)
	mux.HandleFunc("/lan", server.webSocket)
	mux.HandleFunc("/", server.static)
	server.handler = securityHeaders(mux)
	return server
}

func (server *HTTPServer) Handler() http.Handler { return server.handler }

func (server *HTTPServer) health(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
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
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(writer, http.StatusOK, server.match.Config())
}

func (server *HTTPServer) debugGame(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(writer, http.StatusOK, struct {
		Stats Stats         `json:"stats"`
		State game.Snapshot `json:"state"`
	}{Stats: server.match.Stats(), State: server.match.LatestState()})
}

func (server *HTTPServer) webSocket(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
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
	connected := newClient(
		clientID, connection,
		sanitizePlayerName(request.URL.Query().Get("name")),
		sanitizeCarStyle(request.URL.Query().Get("car")),
	)
	joinContext, cancelJoin := context.WithTimeout(request.Context(), 3*time.Second)
	_, err = server.match.Join(joinContext, connected)
	cancelJoin()
	if err != nil {
		payload, _ := json.Marshal(map[string]any{"type": "server-full", "maxPlayers": server.match.Config().MaxPlayers})
		writeContext, cancelWrite := context.WithTimeout(context.Background(), time.Second)
		_ = connection.Write(writeContext, websocket.MessageText, payload)
		cancelWrite()
		_ = connection.Close(websocket.StatusTryAgainLater, err.Error())
		return
	}
	server.logger.Info("player connected", "player", connected.slot+1, "players", server.match.Stats().Players)
	defer func() {
		server.match.Leave(clientID)
		connected.stop()
		server.logger.Info("player disconnected", "player", connected.slot+1)
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
				server.match.SubmitInput(clientID, game.Input{Sequence: packet.Sequence, Mask: packet.Mask, Edges: packet.Edges, Flags: packet.Flags})
			}
		case websocket.MessageText:
			server.handleTextMessage(connected, payload)
		}
	}
}

func (server *HTTPServer) handleTextMessage(connected *client, payload []byte) {
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
			server.match.SubmitInput(connected.id, game.Input{
				Sequence: message.Seq, Mask: message.Input.Mask, Edges: message.Input.Edges, Flags: message.Input.Flags,
			})
		}
	case "replay-skip":
		server.match.SubmitReplaySkip(connected.id)
	case "quick-chat":
		var message quickChatInputMessage
		if json.Unmarshal(payload, &message) == nil && message.ID == quickChatMessageID {
			server.match.SubmitQuickChat(connected.id)
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
