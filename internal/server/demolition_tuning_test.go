package server

import (
	"testing"
	"time"

	"rocket-vibe/internal/game"
)

func TestDemolitionRespawnSelectionWindow(t *testing.T) {
	if demolitionRespawnDuration != 4*time.Second {
		t.Fatalf("demolition respawn duration = %s, want 4s", demolitionRespawnDuration)
	}
	if game.DemolitionSpawnCount != 4 {
		t.Fatalf("demolition spawn count = %d, want 4", game.DemolitionSpawnCount)
	}
}
