package server

import (
	"context"
	"encoding/json"
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
	"rocket-vibe/internal/game"
	"rocket-vibe/internal/protocol"
)

func TestHTTPAndWebSocketIntegration(t *testing.T) {
	staticDirectory := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDirectory, "index.html"), []byte("rocket"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	match := NewMatch(ctx, game.DefaultConfig())
	defer match.Stop()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	app := NewHTTPServer(match, HTTPOptions{StaticDirectory: staticDirectory, Version: "test"}, logger)
	httpServer := httptest.NewServer(app.Handler())
	defer httpServer.Close()

	response, err := http.Get(httpServer.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("health returned %d", response.StatusCode)
	}
	_ = response.Body.Close()

	connectionContext, cancelConnection := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelConnection()
	connection, _, err := websocket.Dial(connectionContext, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/lan?name=Test%20Pilot&car=titan&boost=ion", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()

	messageType, payload, err := connection.Read(connectionContext)
	if err != nil || messageType != websocket.MessageText {
		t.Fatalf("welcome read failed: type=%v err=%v", messageType, err)
	}
	var welcome struct {
		Type       string `json:"type"`
		PlayerID   int    `json:"playerId"`
		Name       string `json:"playerName"`
		Team       string `json:"team"`
		CarStyle   string `json:"carStyle"`
		BoostStyle string `json:"boostStyle"`
		Protocol   int    `json:"protocol"`
	}
	if json.Unmarshal(payload, &welcome) != nil || welcome.Type != "welcome" || welcome.PlayerID != 0 ||
		welcome.Name != "Test Pilot" || welcome.Team != game.TeamOrange || welcome.CarStyle != "titan" || welcome.BoostStyle != "ion" || welcome.Protocol != 3 {
		t.Fatalf("unexpected welcome: %s", payload)
	}

	input := []byte{protocol.MessageInput, 1, 0, 0, 0, game.InputW, 0}
	if err := connection.Write(connectionContext, websocket.MessageBinary, input); err != nil {
		t.Fatal(err)
	}
	foundState := false
	foundRoster := false
	for !foundState || !foundRoster {
		messageType, payload, err = connection.Read(connectionContext)
		if err != nil {
			t.Fatal(err)
		}
		if messageType == websocket.MessageBinary {
			if len(payload) != protocol.StateBytes || payload[0] != protocol.MessageState {
				t.Fatalf("invalid state packet: %d bytes", len(payload))
			}
			foundState = true
		} else if messageType == websocket.MessageText {
			var roster struct {
				Type    string         `json:"type"`
				Players []rosterPlayer `json:"players"`
			}
			if json.Unmarshal(payload, &roster) == nil && roster.Type == "roster" {
				if len(roster.Players) != 1 || roster.Players[0].Name != "Test Pilot" || roster.Players[0].Team != game.TeamOrange || roster.Players[0].BoostStyle != "ion" {
					t.Fatalf("unexpected roster: %s", payload)
				}
				foundRoster = true
			}
		}
	}
}

func TestFourPlayerCapacityAndFifthPlayerRejection(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	match := NewMatch(ctx, game.DefaultConfig())
	defer match.Stop()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	app := NewHTTPServer(match, HTTPOptions{StaticDirectory: ".", Version: "test"}, logger)
	httpServer := httptest.NewServer(app.Handler())
	defer httpServer.Close()
	webSocketURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/lan"

	connectionContext, cancelConnections := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelConnections()
	connections := make([]*websocket.Conn, 0, game.MaxPlayers)
	defer func() {
		for _, connection := range connections {
			connection.CloseNow()
		}
	}()
	seenSlots := [game.MaxPlayers]bool{}
	for range game.MaxPlayers {
		connection, _, err := websocket.Dial(connectionContext, webSocketURL, nil)
		if err != nil {
			t.Fatal(err)
		}
		connections = append(connections, connection)
		_, payload, err := connection.Read(connectionContext)
		if err != nil {
			t.Fatal(err)
		}
		var welcome struct {
			Type     string `json:"type"`
			PlayerID int    `json:"playerId"`
		}
		if json.Unmarshal(payload, &welcome) != nil || welcome.Type != "welcome" {
			t.Fatalf("unexpected welcome: %s", payload)
		}
		if welcome.PlayerID < 0 || welcome.PlayerID >= game.MaxPlayers || seenSlots[welcome.PlayerID] {
			t.Fatalf("invalid or duplicate player slot: %d", welcome.PlayerID)
		}
		seenSlots[welcome.PlayerID] = true
	}

	fifth, _, err := websocket.Dial(connectionContext, webSocketURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer fifth.CloseNow()
	messageType, payload, err := fifth.Read(connectionContext)
	if err != nil || messageType != websocket.MessageText {
		t.Fatalf("server-full read failed: type=%v err=%v", messageType, err)
	}
	var full struct {
		Type       string `json:"type"`
		MaxPlayers int    `json:"maxPlayers"`
	}
	if json.Unmarshal(payload, &full) != nil || full.Type != "server-full" || full.MaxPlayers != game.MaxPlayers {
		t.Fatalf("unexpected capacity response: %s", payload)
	}
}
