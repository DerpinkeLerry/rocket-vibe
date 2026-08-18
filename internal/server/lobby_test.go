package server

import (
	"context"
	"errors"
	"testing"

	"rocket-vibe/internal/game"
)

func TestLobbyConfigSupportsEightPlayersWhileDefaultStaysFour(t *testing.T) {
	defaults := game.DefaultConfig()
	if game.DefaultMaxPlayers != 4 {
		t.Fatalf("DefaultMaxPlayers = %d, want 4", game.DefaultMaxPlayers)
	}
	if defaults.MaxPlayers != game.DefaultMaxPlayers {
		t.Fatalf("default max players = %d, want %d", defaults.MaxPlayers, game.DefaultMaxPlayers)
	}

	config := defaults
	config.MaxPlayers = game.MaxPlayers
	got := sanitizeLobbyConfig(config)
	if got.MaxPlayers != game.MaxPlayers {
		t.Fatalf("max-player lobby was clamped to %d, want %d", got.MaxPlayers, game.MaxPlayers)
	}
}

func TestSanitizeLobbyConfigNormalizesBasketballModeAndCeiling(t *testing.T) {
	config := game.DefaultConfig()
	config.GameMode = "HOOPS"
	config.Arena.Ceiling = 14

	got := sanitizeLobbyConfig(config)
	if got.GameMode != game.GameModeBasketball {
		t.Fatalf("game mode = %q, want %q", got.GameMode, game.GameModeBasketball)
	}
	if got.Arena.Ceiling < game.BasketballMinimumCeiling {
		t.Fatalf("basketball ceiling = %f, want >= %f", got.Arena.Ceiling, game.BasketballMinimumCeiling)
	}

	config.GameMode = "unknown-mode"
	if normal := sanitizeLobbyConfig(config).GameMode; normal != game.GameModeNormal {
		t.Fatalf("unknown mode = %q, want %q", normal, game.GameModeNormal)
	}
}

func TestSanitizeLobbyConfigKeepsValidCustomPhysics(t *testing.T) {
	config := game.DefaultConfig()
	config.MaxPlayers = 2
	config.Gravity = 6.25
	config.Arena.Width = 150
	config.Arena.Length = 220
	config.Arena.GoalWidth = 48
	config.Car.MaxGroundSpeed = 31
	config.Car.MaxBoostSpeed = 52
	config.Car.HalfExtents.X = 1.1
	config.Ball.Radius = 3.2
	config.BoostPads.FullAmount = 72
	config.BoostPads.SmallAmount = 9
	config.Demolition.RespawnSeconds = 1.75

	got := sanitizeLobbyConfig(config)
	if got.MaxPlayers != 2 || got.Gravity != 6.25 {
		t.Fatalf("basic lobby config changed unexpectedly: %+v", got)
	}
	if got.Arena.Width != 150 || got.Arena.Length != 220 || got.Arena.GoalWidth != 48 {
		t.Fatalf("arena mutators changed unexpectedly: %+v", got.Arena)
	}
	if got.Car.MaxGroundSpeed != 31 || got.Car.MaxBoostSpeed != 52 || got.Car.HalfExtents.X != 1.1 {
		t.Fatalf("car mutators changed unexpectedly: %+v", got.Car)
	}
	if got.Ball.Radius != 3.2 || got.BoostPads.FullAmount != 72 || got.BoostPads.SmallAmount != 9 {
		t.Fatalf("ball/boost mutators changed unexpectedly: ball=%+v boost=%+v", got.Ball, got.BoostPads)
	}
	if got.Demolition.RespawnSeconds != 1.75 {
		t.Fatalf("demo mutator changed unexpectedly: %+v", got.Demolition)
	}
	if got.PhysicsHz != game.PhysicsHz || got.SnapshotHz != game.SnapshotHz {
		t.Fatalf("network cadence must remain canonical: %d/%d", got.PhysicsHz, got.SnapshotHz)
	}
}

func TestSanitizeLobbyConfigClampsUnsafeRelationships(t *testing.T) {
	config := game.DefaultConfig()
	config.MaxPlayers = 99
	config.Arena.Width = 40
	config.Arena.Length = 60
	config.Arena.Ceiling = 10
	config.Arena.GoalWidth = 500
	config.Arena.GoalHeight = 500
	config.Car.MaxGroundSpeed = 70
	config.Car.MaxBoostSpeed = 10
	config.Car.BoostCapacity = 25
	config.BoostPads.FullAmount = 100
	config.BoostPads.SmallAmount = 100
	config.Ball.Radius = 5
	config.Ball.SpawnY = 1

	got := sanitizeLobbyConfig(config)
	if got.MaxPlayers != game.MaxPlayers {
		t.Fatalf("max players not clamped: %d", got.MaxPlayers)
	}
	if got.Arena.Width < 60 || got.Arena.Length < 80 || got.Arena.Ceiling < 10 {
		t.Fatalf("arena safety minimums not applied: %+v", got.Arena)
	}
	if got.Arena.GoalWidth >= got.Arena.Width || got.Arena.GoalHeight >= got.Arena.Ceiling {
		t.Fatalf("goal must stay inside arena: %+v", got.Arena)
	}
	if got.Car.MaxBoostSpeed < got.Car.MaxGroundSpeed {
		t.Fatalf("boost speed %f below ground speed %f", got.Car.MaxBoostSpeed, got.Car.MaxGroundSpeed)
	}
	if got.BoostPads.FullAmount > got.Car.BoostCapacity || got.BoostPads.SmallAmount > got.Car.BoostCapacity {
		t.Fatalf("boost pad amount exceeds capacity: %+v capacity=%f", got.BoostPads, got.Car.BoostCapacity)
	}
	if got.Ball.RestingHeight < got.Ball.Radius || got.Ball.SpawnY < got.Ball.RestingHeight {
		t.Fatalf("ball spawn/resting height is inside floor: radius=%f resting=%f spawn=%f", got.Ball.Radius, got.Ball.RestingHeight, got.Ball.SpawnY)
	}
}

func TestLobbyManagerCreatesIndependentMatches(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager := NewLobbyManager(ctx)
	defer manager.Stop()

	first := manager.Defaults()
	first.Name = "Moon Lab"
	first.Config.Gravity = 6
	first.Rules.ScoreLimit = 3
	lobbyA, err := manager.Create(first)
	if err != nil {
		t.Fatal(err)
	}

	second := manager.Defaults()
	second.Name = "Pinball Lab"
	second.Config.Gravity = 32
	second.Config.Ball.Restitution = 1.2
	second.Rules.ScoreLimit = 7
	lobbyB, err := manager.Create(second)
	if err != nil {
		t.Fatal(err)
	}

	if lobbyA.ID == lobbyB.ID || lobbyA.Match == lobbyB.Match {
		t.Fatal("lobbies must own independent match instances")
	}
	if lobbyA.Match.Config().Gravity != 6 || lobbyB.Match.Config().Gravity != 32 {
		t.Fatalf("physics leaked across lobbies: a=%f b=%f", lobbyA.Match.Config().Gravity, lobbyB.Match.Config().Gravity)
	}
	if lobbyA.Match.Rules().ScoreLimit != 3 || lobbyB.Match.Rules().ScoreLimit != 7 {
		t.Fatalf("rules leaked across lobbies: a=%d b=%d", lobbyA.Match.Rules().ScoreLimit, lobbyB.Match.Rules().ScoreLimit)
	}
	if len(manager.List()) != 2 {
		t.Fatalf("expected two lobbies, got %d", len(manager.List()))
	}
}

func TestLobbyManagerDeleteRemovesAndStopsLobby(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	manager := NewLobbyManager(ctx)
	defer manager.Stop()

	lobby, err := manager.Create(manager.Defaults())
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Delete(lobby.ID); err != nil {
		t.Fatalf("delete lobby: %v", err)
	}
	if _, ok := manager.Get(lobby.ID); ok {
		t.Fatal("deleted lobby is still available")
	}
	select {
	case <-lobby.Match.ctx.Done():
	default:
		t.Fatal("deleted lobby match was not stopped")
	}
	if err := manager.Delete(lobby.ID); !errors.Is(err, ErrLobbyNotFound) {
		t.Fatalf("second delete = %v, want ErrLobbyNotFound", err)
	}
}
