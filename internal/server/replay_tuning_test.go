package server

import "testing"

func TestGoalReplayUsesExtendedWindow(t *testing.T) {
	if goalReplayLookback < 6.0 {
		t.Fatalf("replay lookback too short: %f", goalReplayLookback)
	}
	if goalReplayDuration.Milliseconds() < 6500 {
		t.Fatalf("replay duration too short: %s", goalReplayDuration)
	}
	if goalReplayDuration.Seconds() <= goalReplayLookback {
		t.Fatalf("replay duration must leave a short hold after playback: lookback=%f duration=%s", goalReplayLookback, goalReplayDuration)
	}
}
