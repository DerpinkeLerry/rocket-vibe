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

type rosterPlayer struct {
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Team     string `json:"team"`
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
	world  *game.World

	ctx      context.Context
	cancel   context.CancelFunc
	wait     sync.WaitGroup
	stopOnce sync.Once

	joins  chan joinRequest
	leaves chan string
	inputs chan inputEvent

	playerCount    atomic.Int32
	lastTick       atomic.Uint64
	lastTickMicros atomic.Int64
	droppedInputs  atomic.Int64
	latestState    atomic.Value
}

func NewMatch(parent context.Context, config game.Config) *Match {
	ctx, cancel := context.WithCancel(parent)
	match := &Match{
		config: config,
		world:  game.NewWorld(config),
		ctx:    ctx,
		cancel: cancel,
		joins:  make(chan joinRequest),
		leaves: make(chan string, 32),
		inputs: make(chan inputEvent, 256),
	}
	match.latestState.Store(match.world.Snapshot())
	match.wait.Add(1)
	go match.run()
	return match
}

func (match *Match) Config() game.Config { return match.config }

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
				"playerName": request.client.name, "team": request.client.team,
				"connectedPlayers": connectedSlots(clients), "players": rosterPlayers(clients), "protocol": 3,
				"serverHz": match.config.PhysicsHz, "snapshotHz": match.config.SnapshotHz,
			})
			request.client.offerJSON(welcome)
			match.broadcastRoster(clients)
			request.result <- joinResult{slot: slot}

		case clientID := <-match.leaves:
			connected, exists := clients[clientID]
			if !exists {
				continue
			}
			delete(clients, clientID)
			match.world.SetConnected(connected.slot, false)
			match.playerCount.Store(int32(len(clients)))
			connected.stop()
			if len(clients) == 0 {
				match.world.ResetMatch()
			}
			match.broadcastRoster(clients)

		case event := <-match.inputs:
			connected, exists := clients[event.clientID]
			if !exists || !match.world.SetInput(connected.slot, event.input) {
				continue
			}
			active := event.input.Mask != 0 || event.input.Edges != 0
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
			match.world.Step(dt)
			state := match.world.Snapshot()
			match.latestState.Store(state)
			match.lastTick.Store(state.Tick)
			match.confirmMotion(clients)
			if state.Tick%snapshotEvery == 0 && len(clients) > 0 {
				packet := protocol.EncodeState(state)
				for _, connected := range clients {
					connected.offerSnapshot(packet)
				}
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

func rosterPlayers(clients map[string]*client) []rosterPlayer {
	players := make([]rosterPlayer, 0, len(clients))
	for slot := 0; slot < game.MaxPlayers; slot++ {
		for _, connected := range clients {
			if connected.slot == slot {
				players = append(players, rosterPlayer{PlayerID: slot, Name: connected.name, Team: connected.team})
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
