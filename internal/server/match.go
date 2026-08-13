package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"

	"rocket-vibe/internal/game"
	"rocket-vibe/internal/protocol"
)

var (
	ErrMatchFull     = errors.New("match is full")
	ErrServerStopped = errors.New("match server stopped")
)

const (
	kickoffCountdownSeconds   = 3
	kickoffCountdownDuration  = time.Duration(kickoffCountdownSeconds) * time.Second
	goalReplayLookback        = 6.25
	goalReplayDuration        = 6800 * time.Millisecond
	goalCelebrationDuration   = 1250 * time.Millisecond
	demolitionRespawnDuration = 4 * time.Second
)

func shouldStartKickoff(playerCount int) bool {
	return playerCount == 2 || playerCount == 4
}

func shouldStartKickoffForLobby(playerCount, maxPlayers int) bool {
	if maxPlayers <= 1 {
		return playerCount == 1
	}
	return shouldStartKickoff(playerCount)
}

type joinRequest struct {
	client *client
	result chan joinResult
}

type joinResult struct {
	slot int
	err  error
}

type inputEvent struct {
	clientID string
	input    game.Input
}

type quickChatEvent struct {
	clientID string
}

type respawnSelectionEvent struct {
	clientID string
	index    int
}

type demolitionRespawnState struct {
	slot   int
	choice int
	endsAt time.Time
}

type rosterPlayer struct {
	PlayerID   int    `json:"playerId"`
	Name       string `json:"name"`
	Team       string `json:"team"`
	CarStyle   string `json:"carStyle"`
	BoostStyle string `json:"boostStyle"`
}

type Stats struct {
	Players        int32  `json:"players"`
	Tick           uint64 `json:"tick"`
	LastTickMicros int64  `json:"lastTickMicros"`
	DroppedInputs  int64  `json:"droppedInputs"`
	PhysicsHz      int    `json:"physicsHz"`
	SnapshotHz     int    `json:"snapshotHz"`
}

type Match struct {
	config game.Config
	rules  MatchRules
	world  *game.World

	ctx      context.Context
	cancel   context.CancelFunc
	wait     sync.WaitGroup
	stopOnce sync.Once

	joins             chan joinRequest
	leaves            chan string
	inputs            chan inputEvent
	replaySkips       chan string
	quickChats        chan quickChatEvent
	respawnSelections chan respawnSelectionEvent

	playerCount    atomic.Int32
	lastTick       atomic.Uint64
	lastTickMicros atomic.Int64
	droppedInputs  atomic.Int64
	latestState    atomic.Value
}

func NewMatch(parent context.Context, config game.Config) *Match {
	return NewMatchWithRules(parent, config, DefaultMatchRules())
}

func NewMatchWithRules(parent context.Context, config game.Config, rules MatchRules) *Match {
	ctx, cancel := context.WithCancel(parent)
	match := &Match{
		config:            config,
		rules:             sanitizeMatchRules(rules),
		world:             game.NewWorld(config),
		ctx:               ctx,
		cancel:            cancel,
		joins:             make(chan joinRequest),
		leaves:            make(chan string, 32),
		inputs:            make(chan inputEvent, 256),
		replaySkips:       make(chan string, 32),
		quickChats:        make(chan quickChatEvent, 64),
		respawnSelections: make(chan respawnSelectionEvent, 64),
	}
	match.latestState.Store(match.world.Snapshot())
	match.wait.Add(1)
	go match.run()
	return match
}

func (match *Match) Config() game.Config { return match.config }

func (match *Match) Rules() MatchRules { return match.rules }

func (match *Match) Join(ctx context.Context, connected *client) (int, error) {
	result := make(chan joinResult, 1)
	request := joinRequest{client: connected, result: result}
	select {
	case match.joins <- request:
	case <-ctx.Done():
		return -1, ctx.Err()
	case <-match.ctx.Done():
		return -1, ErrServerStopped
	}
	select {
	case joined := <-result:
		return joined.slot, joined.err
	case <-ctx.Done():
		return -1, ctx.Err()
	case <-match.ctx.Done():
		return -1, ErrServerStopped
	}
}

func (match *Match) Leave(clientID string) {
	select {
	case match.leaves <- clientID:
	case <-match.ctx.Done():
	}
}

func (match *Match) SubmitInput(clientID string, input game.Input) {
	select {
	case match.inputs <- inputEvent{clientID: clientID, input: input}:
	case <-match.ctx.Done():
	default:
		match.droppedInputs.Add(1)
	}
}

func (match *Match) SubmitReplaySkip(clientID string) {
	select {
	case match.replaySkips <- clientID:
	case <-match.ctx.Done():
	default:
	}
}

func (match *Match) SubmitQuickChat(clientID string) {
	select {
	case match.quickChats <- quickChatEvent{clientID: clientID}:
	case <-match.ctx.Done():
	default:
	}
}

func (match *Match) SubmitRespawnSelection(clientID string, index int) {
	select {
	case match.respawnSelections <- respawnSelectionEvent{clientID: clientID, index: index}:
	case <-match.ctx.Done():
	default:
	}
}

func (match *Match) Stats() Stats {
	return Stats{
		Players:        match.playerCount.Load(),
		Tick:           match.lastTick.Load(),
		LastTickMicros: match.lastTickMicros.Load(),
		DroppedInputs:  match.droppedInputs.Load(),
		PhysicsHz:      match.config.PhysicsHz,
		SnapshotHz:     match.config.SnapshotHz,
	}
}

func (match *Match) LatestState() game.Snapshot {
	state, _ := match.latestState.Load().(game.Snapshot)
	return state
}

func (match *Match) Stop() {
	match.stopOnce.Do(match.cancel)
	match.wait.Wait()
}

func (match *Match) run() {
	defer match.wait.Done()
	clients := make(map[string]*client, match.config.MaxPlayers)
	ticker := time.NewTicker(time.Second / time.Duration(match.config.PhysicsHz))
	defer ticker.Stop()
	snapshotEvery := uint64(match.config.PhysicsHz / match.config.SnapshotHz)
	dt := 1 / float64(match.config.PhysicsHz)
	var loopTick uint64
	var kickoffEndsAt time.Time
	kickoffLastAnnounced := 0
	kickoffResetScore := false
	lastGoalSequence := match.world.GoalSequence
	matchRemaining := float64(match.rules.MatchSeconds)
	matchClockSecond := -1
	matchClockRunning := false
	overtime := false
	matchOverPending := false

	goalCelebrationActive := false
	var goalCelebrationEndsAt time.Time
	replayActive := false
	var replayEndsAt time.Time
	replayParticipants := make(map[string]bool)
	replaySkipped := make(map[string]bool)
	replayScorerSlot := -1
	replayScorerName := ""
	replayGoalTick := uint64(0)
	replayResetScoreAfter := false
	quickChatLimits := make(map[string]*quickChatLimiter, match.config.MaxPlayers)
	demolitionRespawns := make(map[string]*demolitionRespawnState, match.config.MaxPlayers)

	participantCount := func() int {
		return len(replayParticipants)
	}
	skippedCount := func() int {
		count := 0
		for id := range replaySkipped {
			if replayParticipants[id] {
				count++
			}
		}
		return count
	}

	clientForSlot := func(slot int) (*client, string) {
		for id, connected := range clients {
			if connected.slot == slot {
				return connected, id
			}
		}
		return nil, ""
	}

	cancelDemolitionRespawns := func(reason string) {
		if len(demolitionRespawns) == 0 {
			return
		}
		match.broadcastDemolitionCancel(clients, reason)
		demolitionRespawns = make(map[string]*demolitionRespawnState, match.config.MaxPlayers)
	}

	broadcastClock := func(force bool) {
		if match.rules.MatchSeconds <= 0 {
			return
		}
		seconds := int(math.Ceil(math.Max(0, matchRemaining)))
		if !force && seconds == matchClockSecond {
			return
		}
		matchClockSecond = seconds
		match.broadcastMatchClock(clients, seconds, overtime)
	}

	markMatchOver := func(reason string) {
		if matchOverPending {
			return
		}
		matchOverPending = true
		match.broadcastMatchOver(clients, reason, match.world.OrangeScore, match.world.BlueScore)
	}

	startKickoff := func(resetScore bool) {
		cancelDemolitionRespawns("kickoff")
		match.world.SetDemolitionsEnabled(false)
		matchClockRunning = false
		if resetScore {
			match.world.ResetMatch()
			matchRemaining = float64(match.rules.MatchSeconds)
			matchClockSecond = -1
			overtime = false
			matchOverPending = false
		} else {
			match.world.ResetKickoff()
		}
		kickoffLastAnnounced = match.rules.KickoffSeconds
		kickoffResetScore = resetScore
		state := match.world.Snapshot()
		match.latestState.Store(state)
		if match.rules.KickoffSeconds <= 0 {
			kickoffEndsAt = time.Time{}
			match.world.SetDemolitionsEnabled(match.config.Demolition.Enabled)
			matchClockRunning = true
			match.broadcastKickoff(clients, "go", 0, resetScore)
			broadcastClock(true)
		} else {
			kickoffEndsAt = time.Now().Add(time.Duration(match.rules.KickoffSeconds) * time.Second)
			match.broadcastKickoff(clients, "countdown", match.rules.KickoffSeconds, resetScore)
		}
		match.broadcastSnapshot(clients, state)
	}

	endReplay := func(reason string) {
		if !replayActive {
			return
		}
		replayActive = false
		replayEndsAt = time.Time{}
		match.broadcastReplayEnd(clients, reason)
		startKickoff(replayResetScoreAfter || matchOverPending)
		replayParticipants = make(map[string]bool)
		replaySkipped = make(map[string]bool)
		replayScorerSlot = -1
		replayScorerName = ""
		replayGoalTick = 0
		replayResetScoreAfter = false
	}

	startGoalCelebration := func() {
		cancelDemolitionRespawns("goal")
		match.world.SetDemolitionsEnabled(false)
		_ = match.world.ConsumeDemolitions()
		goalCelebrationActive = true
		celebrationDuration := secondsDuration(match.rules.GoalCelebrationSeconds)
		goalCelebrationEndsAt = time.Now().Add(celebrationDuration)
		kickoffEndsAt = time.Time{}
		kickoffLastAnnounced = 0
		match.world.ClearInputs()
		match.broadcastGoal(clients, celebrationDuration)

		if overtime {
			markMatchOver("overtime-goal")
			replayResetScoreAfter = true
		} else if match.rules.ScoreLimit > 0 && (int(match.world.OrangeScore) >= match.rules.ScoreLimit || int(match.world.BlueScore) >= match.rules.ScoreLimit) {
			markMatchOver("score-limit")
			replayResetScoreAfter = true
		} else if match.rules.MatchSeconds > 0 && matchRemaining <= 0 {
			if match.world.OrangeScore == match.world.BlueScore && match.rules.OvertimeOnTie {
				overtime = true
				broadcastClock(true)
			} else {
				markMatchOver("time")
				replayResetScoreAfter = true
			}
		}
		state := match.world.Snapshot()
		match.latestState.Store(state)
		match.broadcastSnapshot(clients, state)
	}

	startReplay := func() {
		match.world.SetDemolitionsEnabled(false)
		goalCelebrationActive = false
		goalCelebrationEndsAt = time.Time{}
		if !match.rules.GoalReplayEnabled || match.rules.GoalReplaySeconds <= 0 {
			startKickoff(replayResetScoreAfter || matchOverPending)
			replayResetScoreAfter = false
			return
		}
		replayActive = true
		replayEndsAt = time.Now().Add(secondsDuration(match.rules.GoalReplaySeconds))
		replayParticipants = make(map[string]bool, len(clients))
		replaySkipped = make(map[string]bool, len(clients))
		for id := range clients {
			replayParticipants[id] = true
		}
		replayScorerSlot = match.world.LastGoalScorer
		replayScorerName = playerNameForSlot(clients, replayScorerSlot)
		replayGoalTick = match.world.LastGoalTick
		kickoffEndsAt = time.Time{}
		kickoffLastAnnounced = 0
		match.broadcastReplayStart(clients, replayScorerSlot, replayScorerName, replayGoalTick, match.world.OrangeScore, match.world.BlueScore, participantCount())
	}

	for {
		select {
		case <-match.ctx.Done():
			for _, connected := range clients {
				connected.stop()
			}
			return

		case request := <-match.joins:
			slot := availableSlot(clients, match.config.MaxPlayers)
			if slot < 0 {
				request.result <- joinResult{slot: -1, err: ErrMatchFull}
				continue
			}
			request.client.slot = slot
			if request.client.name == "" {
				request.client.name = fmt.Sprintf("Spieler %d", slot+1)
			}
			request.client.team = game.TeamForSlot(slot)
			clients[request.client.id] = request.client
			match.world.SetConnected(slot, true)
			match.playerCount.Store(int32(len(clients)))
			welcome, _ := json.Marshal(map[string]any{
				"type": "welcome", "playerId": slot, "maxPlayers": match.config.MaxPlayers,
				"playerName": request.client.name, "team": request.client.team, "carStyle": request.client.carStyle, "boostStyle": request.client.boostStyle,
				"connectedPlayers": connectedSlots(clients), "players": rosterPlayers(clients), "protocol": protocol.Version,
				"serverHz": match.config.PhysicsHz, "snapshotHz": match.config.SnapshotHz,
				"config": match.config, "rules": match.rules,
			})
			request.client.offerJSON(welcome)
			match.broadcastRoster(clients)

			// A player joining while a goal replay is already running is not added to
			// that replay's unanimous-skip vote because they have no pre-goal history.
			// If their arrival creates a fair 1v1/2v2, perform the usual score-reset
			// kickoff as soon as the current replay is over.
			if goalCelebrationActive {
				if shouldStartKickoffForLobby(len(clients), match.config.MaxPlayers) {
					replayResetScoreAfter = true
				}
				remaining := max(0, time.Until(goalCelebrationEndsAt).Milliseconds())
				request.client.offerSnapshot(protocol.EncodeState(match.world.Snapshot()))
				match.sendGoalCelebration(request.client, time.Duration(remaining)*time.Millisecond, playerNameForSlot(clients, match.world.LastGoalScorer))
			} else if replayActive {
				if shouldStartKickoffForLobby(len(clients), match.config.MaxPlayers) {
					replayResetScoreAfter = true
				}
				remaining := max(0, time.Until(replayEndsAt).Milliseconds())
				request.client.offerSnapshot(protocol.EncodeState(match.world.Snapshot()))
				match.sendReplayWaiting(request.client, replayScorerSlot, replayScorerName, replayGoalTick, remaining, skippedCount(), participantCount(), match.world.OrangeScore, match.world.BlueScore)
			} else if shouldStartKickoffForLobby(len(clients), match.config.MaxPlayers) {
				startKickoff(true)
			} else if !kickoffEndsAt.IsZero() {
				// Player three never restarts a match, but if they happen to arrive
				// during the 1v1 countdown they still need to see the existing lock.
				remaining := int(math.Ceil(time.Until(kickoffEndsAt).Seconds()))
				if remaining > 0 {
					message, _ := json.Marshal(map[string]any{
						"type": "kickoff", "phase": "countdown", "count": remaining, "resetScore": kickoffResetScore,
					})
					request.client.offerJSON(message)
				}
			}
			request.result <- joinResult{slot: slot}

		case clientID := <-match.leaves:
			connected, exists := clients[clientID]
			if !exists {
				continue
			}
			delete(clients, clientID)
			delete(quickChatLimits, clientID)
			delete(demolitionRespawns, clientID)
			match.world.SetConnected(connected.slot, false)
			match.playerCount.Store(int32(len(clients)))
			connected.stop()
			if len(clients) == 0 {
				match.world.ResetMatch()
				matchClockRunning = false
				matchRemaining = float64(match.rules.MatchSeconds)
				matchClockSecond = -1
				overtime = false
				matchOverPending = false
			}
			if replayActive {
				delete(replayParticipants, clientID)
				delete(replaySkipped, clientID)
				if participantCount() == 0 || skippedCount() >= participantCount() {
					endReplay("all-skipped")
				} else {
					match.broadcastReplayProgress(clients, skippedCount(), participantCount())
				}
			}
			match.broadcastRoster(clients)

		case selection := <-match.respawnSelections:
			state := demolitionRespawns[selection.clientID]
			if state == nil {
				continue
			}
			if selection.index < 0 || selection.index >= game.DemolitionSpawnCount {
				continue
			}
			state.choice = selection.index

		case event := <-match.quickChats:
			connected, exists := clients[event.clientID]
			if !exists {
				continue
			}
			limiter := quickChatLimits[event.clientID]
			if limiter == nil {
				limiter = &quickChatLimiter{}
				quickChatLimits[event.clientID] = limiter
			}
			decision := limiter.allow(time.Now())
			if decision.Allowed {
				match.broadcastQuickChat(clients, connected)
			}
			match.sendQuickChatLimit(connected, decision)

		case clientID := <-match.replaySkips:
			if !replayActive || !replayParticipants[clientID] || replaySkipped[clientID] {
				continue
			}
			replaySkipped[clientID] = true
			match.broadcastReplayProgress(clients, skippedCount(), participantCount())
			if skippedCount() >= participantCount() {
				endReplay("all-skipped")
			}

		case event := <-match.inputs:
			connected, exists := clients[event.clientID]
			if !exists {
				continue
			}
			if demolitionRespawns[event.clientID] != nil {
				event.input.Mask = 0
				event.input.Edges = 0
				event.input.Flags = 0
				event.input.Throttle = 0
				event.input.Steer = 0
			}
			if !match.rules.AllowCarReset {
				event.input.Edges &^= game.EdgeReset
			}
			if !match.rules.AllowBallReset {
				event.input.Edges &^= game.EdgeBallReset
			}
			// Held throttle/steer/boost may be queued during replay/countdown so
			// players can launch on GO. One-shot actions are never buffered.
			if goalCelebrationActive {
				event.input.Mask = 0
				event.input.Edges = 0
				event.input.Flags = 0
			} else if replayActive || !kickoffEndsAt.IsZero() {
				event.input.Edges = 0
			}
			if !match.world.SetInput(connected.slot, event.input) {
				continue
			}
			active := event.input.Mask != 0 || event.input.Edges != 0 || event.input.Flags != 0
			if !connected.ackedAny || (active && !connected.ackedActive) {
				connected.ackedAny = true
				if active {
					connected.ackedActive = true
				}
				ack, _ := json.Marshal(map[string]any{
					"type": "input-ack", "seq": event.input.Sequence,
					"playerId": connected.slot, "active": active,
				})
				connected.offerJSON(ack)
			}

		case <-ticker.C:
			started := time.Now()
			loopTick++

			now := time.Now()
			if !replayActive && !goalCelebrationActive && kickoffEndsAt.IsZero() {
				for clientID, respawn := range demolitionRespawns {
					if now.Before(respawn.endsAt) {
						continue
					}
					point, ok := match.world.RespawnCar(respawn.slot, respawn.choice)
					if !ok {
						delete(demolitionRespawns, clientID)
						continue
					}
					delete(demolitionRespawns, clientID)
					match.broadcastRespawn(clients, respawn.slot, respawn.choice, point, match.config.Demolition.RespawnBoost)
				}
			}

			if replayActive {
				if !time.Now().Before(replayEndsAt) {
					endReplay("complete")
				}
				state := match.world.Snapshot()
				match.latestState.Store(state)
				match.lastTick.Store(state.Tick)
				match.lastTickMicros.Store(time.Since(started).Microseconds())
				continue
			}

			if goalCelebrationActive {
				if !time.Now().Before(goalCelebrationEndsAt) {
					startReplay()
					match.lastTickMicros.Store(time.Since(started).Microseconds())
					continue
				}
				match.world.Step(dt)
				state := match.world.Snapshot()
				match.latestState.Store(state)
				match.lastTick.Store(state.Tick)
				if loopTick%snapshotEvery == 0 && len(clients) > 0 {
					match.broadcastSnapshot(clients, state)
				}
				match.lastTickMicros.Store(time.Since(started).Microseconds())
				continue
			}

			if !kickoffEndsAt.IsZero() {
				remaining := int(math.Ceil(time.Until(kickoffEndsAt).Seconds()))
				if remaining > 0 {
					if remaining != kickoffLastAnnounced {
						kickoffLastAnnounced = remaining
						match.broadcastKickoff(clients, "countdown", remaining, kickoffResetScore)
					}
					state := match.world.Snapshot()
					match.latestState.Store(state)
					match.lastTick.Store(state.Tick)
					if loopTick%snapshotEvery == 0 && len(clients) > 0 {
						match.broadcastSnapshot(clients, state)
					}
					match.lastTickMicros.Store(time.Since(started).Microseconds())
					continue
				}

				kickoffEndsAt = time.Time{}
				kickoffLastAnnounced = 0
				match.world.SetDemolitionsEnabled(match.config.Demolition.Enabled)
				matchClockRunning = true
				match.broadcastKickoff(clients, "go", 0, kickoffResetScore)
				broadcastClock(true)
				kickoffResetScore = false
			}

			if matchClockRunning && match.rules.MatchSeconds > 0 && !overtime {
				matchRemaining = math.Max(0, matchRemaining-dt)
				broadcastClock(false)
			}

			match.world.Step(dt)
			state := match.world.Snapshot()
			match.latestState.Store(state)
			match.lastTick.Store(state.Tick)
			match.confirmMotion(clients)

			if match.world.GoalSequence != lastGoalSequence {
				lastGoalSequence = match.world.GoalSequence
				// Show the actual explosion/knockback live first. The replay still
				// reads only snapshots up to LastGoalTick, so this celebration never
				// contaminates the scorer-POV replay window.
				startGoalCelebration()
				match.lastTickMicros.Store(time.Since(started).Microseconds())
				continue
			}

			if matchClockRunning && match.rules.MatchSeconds > 0 && !overtime && matchRemaining <= 0 {
				if match.world.OrangeScore == match.world.BlueScore && match.rules.OvertimeOnTie {
					overtime = true
					broadcastClock(true)
				} else {
					markMatchOver("time")
					startKickoff(true)
					match.lastTickMicros.Store(time.Since(started).Microseconds())
					continue
				}
			}

			for _, demolition := range match.world.ConsumeDemolitions() {
				victim, victimClientID := clientForSlot(demolition.VictimSlot)
				if victim == nil || victimClientID == "" || demolitionRespawns[victimClientID] != nil {
					continue
				}
				choice := 1
				duration := secondsDuration(match.config.Demolition.RespawnSeconds)
				demolitionRespawns[victimClientID] = &demolitionRespawnState{
					slot: demolition.VictimSlot, choice: choice, endsAt: time.Now().Add(duration),
				}
				match.broadcastDemolition(clients, demolition, choice, duration, state.Tick)
			}

			if loopTick%snapshotEvery == 0 && len(clients) > 0 {
				match.broadcastSnapshot(clients, state)
			}
			match.lastTickMicros.Store(time.Since(started).Microseconds())
		}
	}
}

func (match *Match) confirmMotion(clients map[string]*client) {
	state := match.world.Snapshot()
	for _, connected := range clients {
		if connected.motionAcked || !connected.ackedActive {
			continue
		}
		car := state.Cars[connected.slot]
		speed := mathHypot3(car.Velocity)
		angularSpeed := mathHypot3(car.AngularVelocity)
		if speed <= 0.2 && angularSpeed <= 0.05 {
			continue
		}
		connected.motionAcked = true
		message, _ := json.Marshal(map[string]any{
			"type": "motion-ack", "playerId": connected.slot,
			"speed": speed, "angularSpeed": angularSpeed,
		})
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastRoster(clients map[string]*client) {
	message, _ := json.Marshal(map[string]any{
		"type": "roster", "connectedPlayers": connectedSlots(clients),
		"players": rosterPlayers(clients), "maxPlayers": match.config.MaxPlayers,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastKickoff(clients map[string]*client, phase string, count int, resetScore bool) {
	message, _ := json.Marshal(map[string]any{
		"type": "kickoff", "phase": phase, "count": count, "resetScore": resetScore,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastMatchClock(clients map[string]*client, seconds int, overtime bool) {
	message, _ := json.Marshal(map[string]any{
		"type": "match-clock", "seconds": max(0, seconds), "overtime": overtime,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastMatchOver(clients map[string]*client, reason string, orangeScore, blueScore uint16) {
	message, _ := json.Marshal(map[string]any{
		"type": "match-over", "reason": reason, "orangeScore": orangeScore, "blueScore": blueScore,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastGoal(clients map[string]*client, duration time.Duration) {
	message, _ := json.Marshal(map[string]any{
		"type": "goal", "goalSign": match.world.LastGoalSign, "scoringTeam": match.world.LastGoalScoringTeam,
		"scorerId": match.world.LastGoalScorer, "scorerName": playerNameForSlot(clients, match.world.LastGoalScorer),
		"position":   []float64{match.world.LastGoalPosition.X, match.world.LastGoalPosition.Y, match.world.LastGoalPosition.Z},
		"durationMs": duration.Milliseconds(), "orangeScore": match.world.OrangeScore, "blueScore": match.world.BlueScore,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) sendGoalCelebration(connected *client, remaining time.Duration, scorerName string) {
	message, _ := json.Marshal(map[string]any{
		"type": "goal", "goalSign": match.world.LastGoalSign, "scoringTeam": match.world.LastGoalScoringTeam,
		"scorerId": match.world.LastGoalScorer, "scorerName": scorerName,
		"position":   []float64{match.world.LastGoalPosition.X, match.world.LastGoalPosition.Y, match.world.LastGoalPosition.Z},
		"durationMs": max(int64(1), remaining.Milliseconds()), "orangeScore": match.world.OrangeScore, "blueScore": match.world.BlueScore,
	})
	connected.offerJSON(message)
}

func (match *Match) replayLookbackSeconds() float64 {
	duration := match.rules.GoalReplaySeconds
	if duration <= 0 {
		return goalReplayLookback
	}
	return math.Min(goalReplayLookback, math.Max(1, duration-0.2))
}

func (match *Match) broadcastReplayStart(clients map[string]*client, scorerSlot int, scorerName string, goalTick uint64, orangeScore, blueScore uint16, required int) {
	message, _ := json.Marshal(map[string]any{
		"type": "replay", "phase": "start", "scorerId": scorerSlot, "scorerName": scorerName,
		"goalTick": goalTick, "lookbackSeconds": match.replayLookbackSeconds(), "durationMs": secondsDuration(match.rules.GoalReplaySeconds).Milliseconds(),
		"skipped": 0, "required": required, "orangeScore": orangeScore, "blueScore": blueScore,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastReplayProgress(clients map[string]*client, skipped, required int) {
	message, _ := json.Marshal(map[string]any{
		"type": "replay", "phase": "progress", "skipped": skipped, "required": required,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastReplayEnd(clients map[string]*client, reason string) {
	message, _ := json.Marshal(map[string]any{"type": "replay", "phase": "end", "reason": reason})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) sendReplayWaiting(connected *client, scorerSlot int, scorerName string, goalTick uint64, remainingMs int64, skipped, required int, orangeScore, blueScore uint16) {
	message, _ := json.Marshal(map[string]any{
		"type": "replay", "phase": "wait", "scorerId": scorerSlot, "scorerName": scorerName,
		"goalTick": goalTick, "lookbackSeconds": match.replayLookbackSeconds(), "durationMs": remainingMs, "remainingMs": remainingMs,
		"skipped": skipped, "required": required, "orangeScore": orangeScore, "blueScore": blueScore,
	})
	connected.offerJSON(message)
}

func (match *Match) broadcastDemolition(clients map[string]*client, demolition game.DemolitionEvent, choice int, duration time.Duration, stateTick uint64) {
	points := game.RespawnPointsForSlot(demolition.VictimSlot)
	spawnPoints := make([]map[string]any, 0, len(points))
	for _, point := range points {
		spawnPoints = append(spawnPoints, map[string]any{
			"x": point.Position.X, "y": point.Position.Y, "z": point.Position.Z, "yaw": point.Yaw,
		})
	}
	message, _ := json.Marshal(map[string]any{
		"type": "demolition", "attackerId": demolition.AttackerSlot, "victimId": demolition.VictimSlot,
		"attackerName": playerNameForSlot(clients, demolition.AttackerSlot),
		"victimName":   playerNameForSlot(clients, demolition.VictimSlot),
		"position":     []float64{demolition.Position.X, demolition.Position.Y, demolition.Position.Z},
		"durationMs":   duration.Milliseconds(), "stateTick": stateTick, "selectedIndex": choice, "spawnPoints": spawnPoints,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastRespawn(clients map[string]*client, slot, choice int, point game.RespawnPoint, boost float64) {
	message, _ := json.Marshal(map[string]any{
		"type": "respawn", "playerId": slot, "spawnIndex": choice,
		"position": []float64{point.Position.X, point.Position.Y, point.Position.Z},
		"yaw":      point.Yaw, "boost": boost,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastDemolitionCancel(clients map[string]*client, reason string) {
	message, _ := json.Marshal(map[string]any{"type": "demolition-cancel", "reason": reason})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) broadcastQuickChat(clients map[string]*client, sender *client) {
	message, _ := json.Marshal(map[string]any{
		"type": "quick-chat", "id": quickChatMessageID, "text": quickChatMessage,
		"playerId": sender.slot, "playerName": sender.name, "team": sender.team,
	})
	for _, connected := range clients {
		connected.offerJSON(message)
	}
}

func (match *Match) sendQuickChatLimit(connected *client, decision quickChatDecision) {
	cooldownMs := max(int64(0), decision.CooldownLeft.Milliseconds())
	message, _ := json.Marshal(map[string]any{
		"type": "quick-chat-limit", "allowed": decision.Allowed,
		"remaining": decision.Remaining, "cooldownMs": cooldownMs,
	})
	connected.offerJSON(message)
}

func playerNameForSlot(clients map[string]*client, slot int) string {
	for _, connected := range clients {
		if connected.slot == slot {
			return connected.name
		}
	}
	if slot >= 0 {
		return fmt.Sprintf("Spieler %d", slot+1)
	}
	return "Unbekannt"
}

func (match *Match) broadcastSnapshot(clients map[string]*client, state game.Snapshot) {
	packet := protocol.EncodeState(state)
	for _, connected := range clients {
		connected.offerSnapshot(packet)
	}
}

func rosterPlayers(clients map[string]*client) []rosterPlayer {
	players := make([]rosterPlayer, 0, len(clients))
	for slot := 0; slot < game.MaxPlayers; slot++ {
		for _, connected := range clients {
			if connected.slot == slot {
				players = append(players, rosterPlayer{PlayerID: slot, Name: connected.name, Team: connected.team, CarStyle: connected.carStyle, BoostStyle: connected.boostStyle})
				break
			}
		}
	}
	return players
}

func connectedSlots(clients map[string]*client) []int {
	connected := make([]int, 0, len(clients))
	for slot := 0; slot < game.MaxPlayers; slot++ {
		for _, candidate := range clients {
			if candidate.slot == slot {
				connected = append(connected, slot)
				break
			}
		}
	}
	return connected
}

func availableSlot(clients map[string]*client, maximum int) int {
	used := [game.MaxPlayers]bool{}
	for _, connected := range clients {
		if connected.slot >= 0 && connected.slot < len(used) {
			used[connected.slot] = true
		}
	}
	for slot := 0; slot < maximum; slot++ {
		if !used[slot] {
			return slot
		}
	}
	return -1
}

func mathHypot3(vector game.Vec3) float64 {
	return math.Sqrt(vector.X*vector.X + vector.Y*vector.Y + vector.Z*vector.Z)
}
