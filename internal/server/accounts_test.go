package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestAccountsProtectLobbyAndNeverPersistPlaintextPasswords(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager := NewLobbyManager(ctx)
	defer manager.Stop()
	lobby, err := manager.Create(manager.Defaults())
	if err != nil {
		t.Fatal(err)
	}
	accountPath := filepath.Join(t.TempDir(), "users.json")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	app := NewLobbyHTTPServer(manager, HTTPOptions{
		StaticDirectory: t.TempDir(),
		Version:         "test",
		AuthDataFile:    accountPath,
	}, logger)
	server := httptest.NewServer(app.Handler())
	defer server.Close()

	response, err := http.Get(server.URL + "/api/lobbies")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous lobby request returned %d, want 401", response.StatusCode)
	}
	_ = response.Body.Close()

	response, err = http.Post(server.URL+"/api/auth/guest", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("guest session returned %d: %s", response.StatusCode, body)
	}
	guestCookies := response.Cookies()
	_ = response.Body.Close()
	if len(guestCookies) == 0 || guestCookies[0].Name != accountSessionCookie || !guestCookies[0].HttpOnly || guestCookies[0].MaxAge != 0 {
		t.Fatalf("guest did not receive a temporary HttpOnly session cookie: %#v", guestCookies)
	}
	if _, statErr := os.Stat(accountPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("guest session wrote account data to disk: %v", statErr)
	}

	guestRequest, _ := http.NewRequest(http.MethodGet, server.URL+"/api/lobbies", nil)
	guestRequest.AddCookie(guestCookies[0])
	response, err = http.DefaultClient.Do(guestRequest)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("guest lobby request returned %d: %s", response.StatusCode, body)
	}
	_ = response.Body.Close()

	guestContext, cancelGuest := context.WithTimeout(context.Background(), 3*time.Second)
	guestHeader := http.Header{}
	guestHeader.Set("Cookie", accountSessionCookie+"="+guestCookies[0].Value)
	guestConnection, _, err := websocket.Dial(
		guestContext,
		"ws"+strings.TrimPrefix(server.URL, "http")+"/lan?lobby="+lobby.ID+"&name=GuestPilot",
		&websocket.DialOptions{HTTPHeader: guestHeader},
	)
	if err != nil {
		cancelGuest()
		t.Fatal(err)
	}
	messageType, guestPayload, err := guestConnection.Read(guestContext)
	guestConnection.CloseNow()
	cancelGuest()
	if err != nil || messageType != websocket.MessageText {
		t.Fatalf("guest websocket welcome failed: type=%v err=%v", messageType, err)
	}
	var guestWelcome struct {
		Type       string `json:"type"`
		PlayerName string `json:"playerName"`
	}
	if json.Unmarshal(guestPayload, &guestWelcome) != nil || guestWelcome.Type != "welcome" || guestWelcome.PlayerName != "GuestPilot" {
		t.Fatalf("guest websocket did not use the chosen temporary identity: %s", guestPayload)
	}

	credentials := []byte(`{"username":"Pilot_7","password":"correct horse battery"}`)
	response, err = http.Post(server.URL+"/api/auth/register", "application/json", bytes.NewReader(credentials))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("register returned %d: %s", response.StatusCode, body)
	}
	cookies := response.Cookies()
	_ = response.Body.Close()
	if len(cookies) == 0 || cookies[0].Name != accountSessionCookie || !cookies[0].HttpOnly {
		t.Fatalf("registration did not return an HttpOnly session cookie: %#v", cookies)
	}

	persisted, err := os.ReadFile(accountPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(persisted, []byte("correct horse battery")) {
		t.Fatal("plaintext password was persisted")
	}
	if !bytes.Contains(persisted, []byte("pbkdf2-sha256$")) {
		t.Fatalf("password hash format missing: %s", persisted)
	}

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/lobbies", nil)
	request.AddCookie(cookies[0])
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("authenticated lobby request returned %d: %s", response.StatusCode, body)
	}
	_ = response.Body.Close()

	connectionContext, cancelConnection := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelConnection()
	header := http.Header{}
	header.Set("Cookie", accountSessionCookie+"="+cookies[0].Value)
	connection, _, err := websocket.Dial(
		connectionContext,
		"ws"+strings.TrimPrefix(server.URL, "http")+"/lan?lobby="+lobby.ID+"&name=Imposter",
		&websocket.DialOptions{HTTPHeader: header},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	messageType, payload, err := connection.Read(connectionContext)
	if err != nil || messageType != websocket.MessageText {
		t.Fatalf("authenticated websocket welcome failed: type=%v err=%v", messageType, err)
	}
	var welcome struct {
		Type       string `json:"type"`
		PlayerName string `json:"playerName"`
	}
	if json.Unmarshal(payload, &welcome) != nil || welcome.Type != "welcome" || welcome.PlayerName != "Pilot_7" {
		t.Fatalf("websocket did not use authenticated identity: %s", payload)
	}

	response, err = http.Post(server.URL+"/api/auth/login", "application/json", strings.NewReader(`{"username":"pilot_7","password":"wrong password"}`))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password returned %d, want 401", response.StatusCode)
	}
	_ = response.Body.Close()
}

func TestAccountStoreSurvivesServerRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.json")
	first := newAccountStore(path)
	if _, err := first.register("RestartPilot", "long-enough-password"); err != nil {
		t.Fatal(err)
	}
	second := newAccountStore(path)
	account, err := second.authenticate("restartpilot", "long-enough-password")
	if err != nil {
		t.Fatal(err)
	}
	if account.Username != "RestartPilot" {
		t.Fatalf("loaded username = %q", account.Username)
	}
}
