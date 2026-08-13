package server

import "time"

type MatchRules struct {
	ScoreLimit             int     `json:"scoreLimit"`
	MatchSeconds           int     `json:"matchSeconds"`
	OvertimeOnTie          bool    `json:"overtimeOnTie"`
	KickoffSeconds         int     `json:"kickoffSeconds"`
	GoalReplayEnabled      bool    `json:"goalReplayEnabled"`
	GoalReplaySeconds      float64 `json:"goalReplaySeconds"`
	GoalCelebrationSeconds float64 `json:"goalCelebrationSeconds"`
	AllowCarReset          bool    `json:"allowCarReset"`
	AllowBallReset         bool    `json:"allowBallReset"`
}

func DefaultMatchRules() MatchRules {
	return MatchRules{
		ScoreLimit:             0,
		MatchSeconds:           300,
		OvertimeOnTie:          true,
		KickoffSeconds:         kickoffCountdownSeconds,
		GoalReplayEnabled:      true,
		GoalReplaySeconds:      goalReplayDuration.Seconds(),
		GoalCelebrationSeconds: goalCelebrationDuration.Seconds(),
		AllowCarReset:          true,
		AllowBallReset:         true,
	}
}

func sanitizeMatchRules(rules MatchRules) MatchRules {
	if rules.ScoreLimit < 0 {
		rules.ScoreLimit = 0
	}
	if rules.ScoreLimit > 99 {
		rules.ScoreLimit = 99
	}
	if rules.MatchSeconds < 0 {
		rules.MatchSeconds = 0
	}
	if rules.MatchSeconds > 60*60 {
		rules.MatchSeconds = 60 * 60
	}
	if rules.KickoffSeconds < 0 {
		rules.KickoffSeconds = 0
	}
	if rules.KickoffSeconds > 10 {
		rules.KickoffSeconds = 10
	}
	if rules.GoalReplaySeconds < 0 {
		rules.GoalReplaySeconds = 0
	}
	if rules.GoalReplaySeconds > 20 {
		rules.GoalReplaySeconds = 20
	}
	if rules.GoalCelebrationSeconds < 0 {
		rules.GoalCelebrationSeconds = 0
	}
	if rules.GoalCelebrationSeconds > 10 {
		rules.GoalCelebrationSeconds = 10
	}
	return rules
}

func secondsDuration(seconds float64) time.Duration {
	if seconds <= 0 {
		return 0
	}
	return time.Duration(seconds * float64(time.Second))
}
