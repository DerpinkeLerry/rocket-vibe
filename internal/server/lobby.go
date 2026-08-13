package server

import (
	"context"
	"errors"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"rocket-vibe/internal/game"
)

var (
	ErrLobbyNotFound = errors.New("lobby not found")
	ErrLobbyLimit    = errors.New("too many lobbies")
)

const maxLobbies = 64

type LobbyCreateRequest struct {
	Name   string      `json:"name"`
	Config game.Config `json:"config"`
	Rules  MatchRules  `json:"rules"`
}

type LobbySummary struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Players    int32       `json:"players"`
	MaxPlayers int         `json:"maxPlayers"`
	CreatedAt  time.Time   `json:"createdAt"`
	Rules      MatchRules  `json:"rules"`
	Config     game.Config `json:"config"`
}

type Lobby struct {
	ID        string
	Name      string
	CreatedAt time.Time
	Config    game.Config
	Rules     MatchRules
	Match     *Match
}

type LobbyManager struct {
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.RWMutex
	items  map[string]*Lobby
}

func NewLobbyManager(parent context.Context) *LobbyManager {
	ctx, cancel := context.WithCancel(parent)
	manager := &LobbyManager{ctx: ctx, cancel: cancel, items: make(map[string]*Lobby)}
	go manager.runCleanup()
	return manager
}

func (manager *LobbyManager) Defaults() LobbyCreateRequest {
	return LobbyCreateRequest{Name: "Neue Lobby", Config: game.DefaultConfig(), Rules: DefaultMatchRules()}
}

func (manager *LobbyManager) Create(request LobbyCreateRequest) (*Lobby, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if len(manager.items) >= maxLobbies {
		return nil, ErrLobbyLimit
	}
	id, err := randomID()
	if err != nil {
		return nil, err
	}
	config := sanitizeLobbyConfig(request.Config)
	rules := sanitizeMatchRules(request.Rules)
	name := sanitizeLobbyName(request.Name)
	if name == "" {
		name = "Rocket Lobby"
	}
	lobby := &Lobby{
		ID: id, Name: name, CreatedAt: time.Now().UTC(), Config: config, Rules: rules,
		Match: NewMatchWithRules(manager.ctx, config, rules),
	}
	manager.items[id] = lobby
	return lobby, nil
}

func (manager *LobbyManager) Get(id string) (*Lobby, bool) {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	lobby, ok := manager.items[strings.TrimSpace(id)]
	return lobby, ok
}

func (manager *LobbyManager) List() []LobbySummary {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	result := make([]LobbySummary, 0, len(manager.items))
	for _, lobby := range manager.items {
		result = append(result, lobbySummary(lobby))
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Players != result[j].Players {
			return result[i].Players > result[j].Players
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result
}

func (manager *LobbyManager) Stop() {
	manager.cancel()
	manager.mu.Lock()
	defer manager.mu.Unlock()
	for id, lobby := range manager.items {
		lobby.Match.Stop()
		delete(manager.items, id)
	}
}

func (manager *LobbyManager) runCleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-manager.ctx.Done():
			return
		case now := <-ticker.C:
			manager.mu.Lock()
			for id, lobby := range manager.items {
				if lobby.Match.Stats().Players == 0 && now.Sub(lobby.CreatedAt) > 2*time.Hour {
					lobby.Match.Stop()
					delete(manager.items, id)
				}
			}
			manager.mu.Unlock()
		}
	}
}

func lobbySummary(lobby *Lobby) LobbySummary {
	return LobbySummary{
		ID: lobby.ID, Name: lobby.Name, Players: lobby.Match.Stats().Players,
		MaxPlayers: lobby.Config.MaxPlayers, CreatedAt: lobby.CreatedAt, Rules: lobby.Rules, Config: lobby.Config,
	}
}

func sanitizeLobbyName(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	runes := []rune(value)
	if len(runes) > 32 {
		runes = runes[:32]
	}
	return string(runes)
}

func sanitizeLobbyConfig(input game.Config) game.Config {
	defaults := game.DefaultConfig()
	config := input

	// Server cadence is intentionally not a lobby mutator: the fixed binary
	// protocol and input buffering assume these production-safe rates.
	config.PhysicsHz = defaults.PhysicsHz
	config.SnapshotHz = defaults.SnapshotHz
	config.MaxPlayers = boundedInt(config.MaxPlayers, defaults.MaxPlayers, 1, game.MaxPlayers)
	config.SolverSteps = boundedInt(config.SolverSteps, defaults.SolverSteps, 1, 8)
	config.Gravity = bounded(config.Gravity, defaults.Gravity, -40, 80)

	config.Arena.Width = bounded(config.Arena.Width, defaults.Arena.Width, 110, 240)
	config.Arena.Length = bounded(config.Arena.Length, defaults.Arena.Length, 160, 360)
	config.Arena.Ceiling = bounded(config.Arena.Ceiling, defaults.Arena.Ceiling, 14, 80)
	config.Arena.WallHeight = bounded(config.Arena.WallHeight, defaults.Arena.WallHeight, 8, config.Arena.Ceiling)
	maxCorner := math.Min(config.Arena.Width, config.Arena.Length)*0.5 - 2
	config.Arena.CornerRadius = bounded(config.Arena.CornerRadius, defaults.Arena.CornerRadius, 4, math.Min(40, maxCorner))
	config.Arena.RampRadius = bounded(config.Arena.RampRadius, defaults.Arena.RampRadius, 0.5, math.Min(12, config.Arena.Ceiling*0.35))
	config.Arena.CeilingRampRadius = bounded(config.Arena.CeilingRampRadius, defaults.Arena.CeilingRampRadius, 0.5, math.Min(18, config.Arena.Ceiling*0.45))
	config.Arena.GoalWidth = bounded(config.Arena.GoalWidth, defaults.Arena.GoalWidth, 10, math.Min(70, config.Arena.Width-12))
	config.Arena.GoalHeight = bounded(config.Arena.GoalHeight, defaults.Arena.GoalHeight, 4, math.Min(30, config.Arena.Ceiling-2))
	config.Arena.GoalDepth = bounded(config.Arena.GoalDepth, defaults.Arena.GoalDepth, 4, 35)
	maxGoalRadius := math.Min(config.Arena.GoalWidth*0.5-0.2, config.Arena.GoalDepth-0.2)
	config.Arena.GoalRampRadius = bounded(config.Arena.GoalRampRadius, defaults.Arena.GoalRampRadius, 0.3, math.Min(10, maxGoalRadius))
	config.Arena.GoalMouthRadius = bounded(config.Arena.GoalMouthRadius, defaults.Arena.GoalMouthRadius, 0.2, math.Min(10, maxGoalRadius))

	config.Car.HalfExtents.X = bounded(config.Car.HalfExtents.X, defaults.Car.HalfExtents.X, 0.35, 2.5)
	config.Car.HalfExtents.Y = bounded(config.Car.HalfExtents.Y, defaults.Car.HalfExtents.Y, 0.2, 1.5)
	config.Car.HalfExtents.Z = bounded(config.Car.HalfExtents.Z, defaults.Car.HalfExtents.Z, 0.5, 3.5)
	config.Car.Mass = bounded(config.Car.Mass, defaults.Car.Mass, 50, 2500)
	config.Car.MaxGroundSpeed = bounded(config.Car.MaxGroundSpeed, defaults.Car.MaxGroundSpeed, 2, 80)
	config.Car.MaxBoostSpeed = bounded(config.Car.MaxBoostSpeed, defaults.Car.MaxBoostSpeed, config.Car.MaxGroundSpeed, 120)
	config.Car.BoostCapacity = bounded(config.Car.BoostCapacity, defaults.Car.BoostCapacity, 1, 100)
	config.Car.BoostConsumption = bounded(config.Car.BoostConsumption, defaults.Car.BoostConsumption, 0, 200)
	config.Car.DriveAcceleration = bounded(config.Car.DriveAcceleration, defaults.Car.DriveAcceleration, 0, 80)
	config.Car.ReverseAcceleration = bounded(config.Car.ReverseAcceleration, defaults.Car.ReverseAcceleration, 0, 80)
	config.Car.BrakeAcceleration = bounded(config.Car.BrakeAcceleration, defaults.Car.BrakeAcceleration, 0, 120)
	config.Car.CoastDeceleration = bounded(config.Car.CoastDeceleration, defaults.Car.CoastDeceleration, 0, 40)
	config.Car.BoostAcceleration = bounded(config.Car.BoostAcceleration, defaults.Car.BoostAcceleration, 0, 100)
	config.Car.AirBoostAcceleration = bounded(config.Car.AirBoostAcceleration, defaults.Car.AirBoostAcceleration, 0, 140)
	config.Car.Grip = bounded(config.Car.Grip, defaults.Car.Grip, 0, 80)
	config.Car.DriftGrip = bounded(config.Car.DriftGrip, defaults.Car.DriftGrip, 0, 40)
	config.Car.SteerRate = bounded(config.Car.SteerRate, defaults.Car.SteerRate, 0, 12)
	config.Car.DriftSteerRate = bounded(config.Car.DriftSteerRate, defaults.Car.DriftSteerRate, 0, 16)
	config.Car.SteerResponse = bounded(config.Car.SteerResponse, defaults.Car.SteerResponse, 0, 60)
	config.Car.DriftSteerResponse = bounded(config.Car.DriftSteerResponse, defaults.Car.DriftSteerResponse, 0, 80)
	config.Car.GroundAngularDamping = bounded(config.Car.GroundAngularDamping, defaults.Car.GroundAngularDamping, 0, 50)
	config.Car.AirPitchAcceleration = bounded(config.Car.AirPitchAcceleration, defaults.Car.AirPitchAcceleration, 0, 50)
	config.Car.AirYawAcceleration = bounded(config.Car.AirYawAcceleration, defaults.Car.AirYawAcceleration, 0, 50)
	config.Car.AirRollAcceleration = bounded(config.Car.AirRollAcceleration, defaults.Car.AirRollAcceleration, 0, 50)
	config.Car.AirPitchRate = bounded(config.Car.AirPitchRate, defaults.Car.AirPitchRate, 0, 18)
	config.Car.AirYawRate = bounded(config.Car.AirYawRate, defaults.Car.AirYawRate, 0, 18)
	config.Car.AirRollRate = bounded(config.Car.AirRollRate, defaults.Car.AirRollRate, 0, 18)
	config.Car.AirControlResponse = bounded(config.Car.AirControlResponse, defaults.Car.AirControlResponse, 0, 50)
	config.Car.AirNeutralResponse = bounded(config.Car.AirNeutralResponse, defaults.Car.AirNeutralResponse, 0, 50)
	config.Car.MaxAirAngular = bounded(config.Car.MaxAirAngular, defaults.Car.MaxAirAngular, 0, 24)
	config.Car.JumpSpeed = bounded(config.Car.JumpSpeed, defaults.Car.JumpSpeed, 0, 40)
	config.Car.JumpHoldAcceleration = bounded(config.Car.JumpHoldAcceleration, defaults.Car.JumpHoldAcceleration, 0, 120)
	config.Car.JumpHoldDuration = bounded(config.Car.JumpHoldDuration, defaults.Car.JumpHoldDuration, 0, 2)
	config.Car.DoubleJumpSpeed = bounded(config.Car.DoubleJumpSpeed, defaults.Car.DoubleJumpSpeed, 0, 50)
	config.Car.DodgeImpulse = bounded(config.Car.DodgeImpulse, defaults.Car.DodgeImpulse, 0, 50)
	config.Car.DodgeLift = bounded(config.Car.DodgeLift, defaults.Car.DodgeLift, -10, 20)
	config.Car.DodgeAngularSpeed = bounded(config.Car.DodgeAngularSpeed, defaults.Car.DodgeAngularSpeed, 0, 40)
	config.Car.DodgeRotation = bounded(config.Car.DodgeRotation, defaults.Car.DodgeRotation, 0, math.Pi*8)
	config.Car.DodgeWindow = bounded(config.Car.DodgeWindow, defaults.Car.DodgeWindow, 0, 5)
	config.Car.DodgeDuration = bounded(config.Car.DodgeDuration, defaults.Car.DodgeDuration, 0.05, 3)
	config.Car.DodgeControlScale = bounded(config.Car.DodgeControlScale, defaults.Car.DodgeControlScale, 0, 1)
	config.Car.DownAcceleration = bounded(config.Car.DownAcceleration, defaults.Car.DownAcceleration, 0, 100)
	config.Car.WallGravityCancel = bounded(config.Car.WallGravityCancel, defaults.Car.WallGravityCancel, 0, 3)
	config.Car.SurfaceAlignResponse = bounded(config.Car.SurfaceAlignResponse, defaults.Car.SurfaceAlignResponse, 0, 60)
	config.Car.LinearDamping = bounded(config.Car.LinearDamping, defaults.Car.LinearDamping, 0, 10)
	config.Car.AngularDamping = bounded(config.Car.AngularDamping, defaults.Car.AngularDamping, 0, 10)
	config.Car.Restitution = bounded(config.Car.Restitution, defaults.Car.Restitution, 0, 1.5)

	config.Ball.Radius = bounded(config.Ball.Radius, defaults.Ball.Radius, 0.5, 6)
	config.Ball.Mass = bounded(config.Ball.Mass, defaults.Ball.Mass, 1, 500)
	config.Ball.Restitution = bounded(config.Ball.Restitution, defaults.Ball.Restitution, 0, 1.5)
	config.Ball.Friction = bounded(config.Ball.Friction, defaults.Ball.Friction, 0, 2)
	config.Ball.RollingResistance = bounded(config.Ball.RollingResistance, defaults.Ball.RollingResistance, 0, 4)
	config.Ball.LinearDamping = bounded(config.Ball.LinearDamping, defaults.Ball.LinearDamping, 0, 5)
	config.Ball.AngularDamping = bounded(config.Ball.AngularDamping, defaults.Ball.AngularDamping, 0, 5)
	config.Ball.MaxSpeed = bounded(config.Ball.MaxSpeed, defaults.Ball.MaxSpeed, 2, 160)
	config.Ball.MaxAngularSpeed = bounded(config.Ball.MaxAngularSpeed, defaults.Ball.MaxAngularSpeed, 0, 120)
	config.Ball.CarHitPower = bounded(config.Ball.CarHitPower, defaults.Ball.CarHitPower, 0, 3)
	config.Ball.CarHitLift = bounded(config.Ball.CarHitLift, defaults.Ball.CarHitLift, -1, 2)
	config.Ball.CarHitLiftBase = bounded(config.Ball.CarHitLiftBase, defaults.Ball.CarHitLiftBase, -5, 10)
	config.Ball.SpawnY = bounded(config.Ball.SpawnY, defaults.Ball.SpawnY, config.Ball.Radius+0.05, 20)

	config.BoostPads.FullAmount = bounded(config.BoostPads.FullAmount, defaults.BoostPads.FullAmount, 0, config.Car.BoostCapacity)
	config.BoostPads.SmallAmount = bounded(config.BoostPads.SmallAmount, defaults.BoostPads.SmallAmount, 0, config.Car.BoostCapacity)
	config.BoostPads.SmallRespawnSeconds = bounded(config.BoostPads.SmallRespawnSeconds, defaults.BoostPads.SmallRespawnSeconds, 0.1, 60)
	config.BoostPads.FullRespawnSeconds = bounded(config.BoostPads.FullRespawnSeconds, defaults.BoostPads.FullRespawnSeconds, 0.1, 60)

	config.Demolition.MinSpeed = bounded(config.Demolition.MinSpeed, defaults.Demolition.MinSpeed, 0, 120)
	config.Demolition.RespawnSeconds = bounded(config.Demolition.RespawnSeconds, defaults.Demolition.RespawnSeconds, 0.25, 20)
	config.Demolition.RespawnBoost = bounded(config.Demolition.RespawnBoost, defaults.Demolition.RespawnBoost, 0, config.Car.BoostCapacity)
	config.Demolition.RespawnImmunity = bounded(config.Demolition.RespawnImmunity, defaults.Demolition.RespawnImmunity, 0, 10)
	config.Demolition.FrontDot = bounded(config.Demolition.FrontDot, defaults.Demolition.FrontDot, -1, 1)
	config.Demolition.MotionDot = bounded(config.Demolition.MotionDot, defaults.Demolition.MotionDot, -1, 1)
	config.Demolition.MinClosingSpeed = bounded(config.Demolition.MinClosingSpeed, defaults.Demolition.MinClosingSpeed, 0, 40)
	config.Demolition.SpeedTieEpsilon = bounded(config.Demolition.SpeedTieEpsilon, defaults.Demolition.SpeedTieEpsilon, 0, 20)

	return config
}

func bounded(value, fallback, minValue, maxValue float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func boundedInt(value, fallback, minValue, maxValue int) int {
	if value == 0 {
		value = fallback
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
