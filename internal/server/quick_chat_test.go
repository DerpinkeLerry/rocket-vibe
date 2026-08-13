package server

import (
	"testing"
	"time"
)

func TestQuickChatAllowsThreeThenEnforcesTwoSecondCooldown(t *testing.T) {
	var limiter quickChatLimiter
	now := time.Unix(1_700_000_000, 0)

	for sent := 1; sent <= quickChatBurstLimit; sent++ {
		decision := limiter.allow(now)
		if !decision.Allowed {
			t.Fatalf("message %d was blocked", sent)
		}
		wantRemaining := quickChatBurstLimit - sent
		if decision.Remaining != wantRemaining {
			t.Fatalf("message %d remaining=%d, want %d", sent, decision.Remaining, wantRemaining)
		}
		if sent < quickChatBurstLimit && decision.CooldownLeft != 0 {
			t.Fatalf("message %d started cooldown early: %v", sent, decision.CooldownLeft)
		}
	}

	blocked := limiter.allow(now.Add(250 * time.Millisecond))
	if blocked.Allowed {
		t.Fatal("fourth quick chat should be blocked")
	}
	if blocked.CooldownLeft < 1700*time.Millisecond || blocked.CooldownLeft > 1800*time.Millisecond {
		t.Fatalf("unexpected cooldown left: %v", blocked.CooldownLeft)
	}

	allowedAgain := limiter.allow(now.Add(quickChatCooldown + time.Millisecond))
	if !allowedAgain.Allowed || allowedAgain.Remaining != 2 {
		t.Fatalf("quick chat did not reset after cooldown: %+v", allowedAgain)
	}
}
