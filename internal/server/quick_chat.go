package server

import "time"

const (
	quickChatMessageID  = "what-a-save"
	quickChatMessage    = "What a save!"
	quickChatBurstLimit = 3
	quickChatCooldown   = 2 * time.Second
)

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
