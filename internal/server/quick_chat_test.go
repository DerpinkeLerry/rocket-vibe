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

func TestQuickChatCatalogContainsMultipleTrustedPhrases(t *testing.T) {
	if len(quickChatOptions) < 12 {
		t.Fatalf("quick chat catalog too small: %d", len(quickChatOptions))
	}
	option, ok := quickChatOptionFor(" NICE-SHOT ")
	if !ok || option.Text != "Nice shot!" {
		t.Fatalf("unexpected normalized quick chat: %+v ok=%v", option, ok)
	}
	if _, ok := quickChatOptionFor("<script>"); ok {
		t.Fatal("unknown quick chat id should never be accepted")
	}
}

func TestTextChatSanitizesWhitespaceControlsAndUnicodeLength(t *testing.T) {
	got := sanitizeTextChat("  Hallo\n\tWelt\u0000  ")
	if got != "Hallo Welt" {
		t.Fatalf("sanitizeTextChat=%q, want %q", got, "Hallo Welt")
	}
	long := "🙂"
	for len([]rune(long)) <= textChatMaxRunes+8 {
		long += "🙂"
	}
	if runes := len([]rune(sanitizeTextChat(long))); runes != textChatMaxRunes {
		t.Fatalf("sanitized rune count=%d, want %d", runes, textChatMaxRunes)
	}
}

func TestTextChatLimiterAppliesBurstCooldown(t *testing.T) {
	var limiter textChatLimiter
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < textChatBurstLimit; i++ {
		if decision := limiter.allow(now.Add(time.Duration(i) * 100 * time.Millisecond)); !decision.Allowed {
			t.Fatalf("text message %d blocked early", i+1)
		}
	}
	blocked := limiter.allow(now.Add(600 * time.Millisecond))
	if blocked.Allowed || blocked.CooldownLeft != textChatCooldown {
		t.Fatalf("unexpected blocked decision: %+v", blocked)
	}
	if decision := limiter.allow(now.Add(600*time.Millisecond + textChatCooldown + time.Millisecond)); !decision.Allowed {
		t.Fatalf("text chat did not recover after cooldown: %+v", decision)
	}
}
