package server

import (
	"strings"
	"time"
	"unicode"
)

const (
	quickChatBurstLimit = 3
	quickChatCooldown   = 2 * time.Second
	textChatBurstLimit  = 5
	textChatWindow      = 8 * time.Second
	textChatCooldown    = 4 * time.Second
	textChatMaxRunes    = 160
)

type quickChatOption struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

var quickChatOptions = []quickChatOption{
	{ID: "what-a-save", Text: "What a save!"},
	{ID: "nice-shot", Text: "Nice shot!"},
	{ID: "great-pass", Text: "Great pass!"},
	{ID: "nice-one", Text: "Nice one!"},
	{ID: "thanks", Text: "Thanks!"},
	{ID: "sorry", Text: "Sorry!"},
	{ID: "my-bad", Text: "My bad..."},
	{ID: "no-problem", Text: "No problem."},
	{ID: "wow", Text: "Wow!"},
	{ID: "close-one", Text: "Close one!"},
	{ID: "calculated", Text: "Calculated."},
	{ID: "okay", Text: "Okay."},
	{ID: "i-got-it", Text: "I got it!"},
	{ID: "defending", Text: "Defending..."},
	{ID: "take-the-shot", Text: "Take the shot!"},
	{ID: "need-boost", Text: "Need boost!"},
	{ID: "centering", Text: "Centering!"},
	{ID: "all-yours", Text: "All yours."},
	{ID: "good-luck", Text: "Good luck!"},
	{ID: "have-fun", Text: "Have fun!"},
}

var quickChatByID = func() map[string]quickChatOption {
	result := make(map[string]quickChatOption, len(quickChatOptions))
	for _, option := range quickChatOptions {
		result[option.ID] = option
	}
	return result
}()

func quickChatOptionFor(id string) (quickChatOption, bool) {
	option, ok := quickChatByID[strings.TrimSpace(strings.ToLower(id))]
	return option, ok
}

func quickChatCatalog() []quickChatOption {
	return append([]quickChatOption(nil), quickChatOptions...)
}

type quickChatLimiter struct {
	used          int
	cooldownUntil time.Time
}

type quickChatDecision struct {
	Allowed      bool
	Remaining    int
	CooldownLeft time.Duration
}

func (limiter *quickChatLimiter) allow(now time.Time) quickChatDecision {
	if !limiter.cooldownUntil.IsZero() {
		if now.Before(limiter.cooldownUntil) {
			return quickChatDecision{
				Allowed:      false,
				Remaining:    0,
				CooldownLeft: limiter.cooldownUntil.Sub(now),
			}
		}
		limiter.used = 0
		limiter.cooldownUntil = time.Time{}
	}

	limiter.used++
	remaining := max(0, quickChatBurstLimit-limiter.used)
	decision := quickChatDecision{Allowed: true, Remaining: remaining}
	if limiter.used >= quickChatBurstLimit {
		limiter.cooldownUntil = now.Add(quickChatCooldown)
		decision.CooldownLeft = quickChatCooldown
	}
	return decision
}

type textChatLimiter struct {
	sent          []time.Time
	cooldownUntil time.Time
}

type textChatDecision struct {
	Allowed      bool
	CooldownLeft time.Duration
}

func (limiter *textChatLimiter) allow(now time.Time) textChatDecision {
	if !limiter.cooldownUntil.IsZero() {
		if now.Before(limiter.cooldownUntil) {
			return textChatDecision{Allowed: false, CooldownLeft: limiter.cooldownUntil.Sub(now)}
		}
		limiter.cooldownUntil = time.Time{}
	}

	cutoff := now.Add(-textChatWindow)
	kept := limiter.sent[:0]
	for _, sentAt := range limiter.sent {
		if sentAt.After(cutoff) {
			kept = append(kept, sentAt)
		}
	}
	limiter.sent = kept
	if len(limiter.sent) >= textChatBurstLimit {
		limiter.sent = nil
		limiter.cooldownUntil = now.Add(textChatCooldown)
		return textChatDecision{Allowed: false, CooldownLeft: textChatCooldown}
	}
	limiter.sent = append(limiter.sent, now)
	return textChatDecision{Allowed: true}
}

func sanitizeTextChat(value string) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, value)
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	runes := []rune(value)
	if len(runes) > textChatMaxRunes {
		runes = runes[:textChatMaxRunes]
	}
	return strings.TrimSpace(string(runes))
}
