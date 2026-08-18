package game

import "strings"

const (
	PhysicsHz                = 120
	SnapshotHz               = 60
	MaxPlayers               = 8
	DefaultMaxPlayers        = 4
	GameModeNormal           = "normal"
	GameModeBasketball       = "basketball"
	BasketballMinimumCeiling = 18.0

	DemolitionRespawnSeconds = 4.0
	DemolitionRespawnBoost   = 33.0
	DemolitionMinSpeed       = RLSupersonicSpeed
)

type ArenaConfig struct {
	Width             float64 `json:"width"`
	Length            float64 `json:"length"`
	Ceiling           float64 `json:"ceiling"`
	WallHeight        float64 `json:"wallHeight"`
	CornerRadius      float64 `json:"cornerRadius"`
	RampRadius        float64 `json:"rampRadius"`
	CeilingRampRadius float64 `json:"ceilingRampRadius"`
	GoalWidth         float64 `json:"goalWidth"`
	GoalHeight        float64 `json:"goalHeight"`
	GoalDepth         float64 `json:"goalDepth"`
	GoalRampRadius    float64 `json:"goalRampRadius"`
	GoalMouthRadius   float64 `json:"goalMouthRadius"`
}

type CarConfig struct {
	HalfExtents             Vec3    `json:"halfExtents"`
	Mass                    float64 `json:"mass"`
	MaxGroundSpeed          float64 `json:"maxGroundSpeed"`
	MaxBoostSpeed           float64 `json:"maxBoostSpeed"`
	SupersonicSpeed         float64 `json:"supersonicSpeed"`
	BoostCapacity           float64 `json:"boostCapacity"`
	BoostConsumption        float64 `json:"boostConsumptionPerSecond"`
	DriveAcceleration       float64 `json:"driveAcceleration"`
	ReverseAcceleration     float64 `json:"reverseAcceleration"`
	BrakeAcceleration       float64 `json:"brakeAcceleration"`
	CoastDeceleration       float64 `json:"coastDeceleration"`
	BoostAcceleration       float64 `json:"boostAcceleration"`
	AirBoostAcceleration    float64 `json:"airBoostAcceleration"`
	AirThrottleAcceleration float64 `json:"airThrottleAcceleration"`
	AirReverseAcceleration  float64 `json:"airReverseAcceleration"`
	Grip                    float64 `json:"grip"`
	DriftGrip               float64 `json:"driftGrip"`
	SteerRate               float64 `json:"steerRate"`
	DriftSteerRate          float64 `json:"driftSteerRate"`
	SteerResponse           float64 `json:"steerResponse"`
	DriftSteerResponse      float64 `json:"driftSteerResponse"`
	GroundAngularDamping    float64 `json:"groundAngularDamping"`
	AirPitchAcceleration    float64 `json:"airPitchAcceleration"`
	AirYawAcceleration      float64 `json:"airYawAcceleration"`
	AirRollAcceleration     float64 `json:"airRollAcceleration"`
	AirPitchRate            float64 `json:"airPitchRate"`
	AirYawRate              float64 `json:"airYawRate"`
	AirRollRate             float64 `json:"airRollRate"`
	AirControlResponse      float64 `json:"airControlResponse"`
	AirNeutralResponse      float64 `json:"airNeutralResponse"`
	MaxAirAngular           float64 `json:"maxAirAngular"`
	JumpSpeed               float64 `json:"jumpSpeed"`
	JumpHoldAcceleration    float64 `json:"jumpHoldAcceleration"`
	JumpHoldDuration        float64 `json:"jumpHoldDuration"`
	JumpMinimumHoldDuration float64 `json:"jumpMinimumHoldDuration"`
	JumpStickyAcceleration  float64 `json:"jumpStickyAcceleration"`
	JumpStickyDuration      float64 `json:"jumpStickyDuration"`
	DoubleJumpSpeed         float64 `json:"doubleJumpSpeed"`
	DodgeImpulse            float64 `json:"dodgeImpulse"`
	DodgeLift               float64 `json:"dodgeLift"`
	DodgeAngularSpeed       float64 `json:"dodgeAngularSpeed"`
	DodgeRotation           float64 `json:"dodgeRotation"`
	DodgeWindow             float64 `json:"dodgeWindow"`
	DodgeDuration           float64 `json:"dodgeDuration"`
	DodgeControlScale       float64 `json:"dodgeControlScale"`
	DownAcceleration        float64 `json:"downAcceleration"`
	WallGravityCancel       float64 `json:"wallGravityCancel"`
	SurfaceAlignResponse    float64 `json:"surfaceAlignResponse"`
	LinearDamping           float64 `json:"linearDamping"`
	AngularDamping          float64 `json:"angularDamping"`
	Restitution             float64 `json:"restitution"`
}

type BallConfig struct {
	Radius            float64 `json:"radius"`
	Mass              float64 `json:"mass"`
	Restitution       float64 `json:"restitution"`
	Friction          float64 `json:"friction"`
	RollingResistance float64 `json:"rollingResistance"`
	LinearDamping     float64 `json:"linearDamping"`
	AngularDamping    float64 `json:"angularDamping"`
	MaxSpeed          float64 `json:"maxSpeed"`
	MaxAngularSpeed   float64 `json:"maxAngularSpeed"`
	CarHitPower       float64 `json:"carHitPower"`
	CarHitLift        float64 `json:"carHitLift"`
	CarHitLiftBase    float64 `json:"carHitLiftBase"`
	SpawnY            float64 `json:"spawnY"`
	RestingHeight     float64 `json:"restingHeight"`
}

type BoostPadConfig struct {
	FullAmount          float64 `json:"fullAmount"`
	SmallAmount         float64 `json:"smallAmount"`
	SmallRespawnSeconds float64 `json:"smallRespawnSeconds"`
	FullRespawnSeconds  float64 `json:"fullRespawnSeconds"`
}

type DemolitionConfig struct {
	Enabled         bool    `json:"enabled"`
	MinSpeed        float64 `json:"minSpeed"`
	RespawnSeconds  float64 `json:"respawnSeconds"`
	RespawnBoost    float64 `json:"respawnBoost"`
	RespawnImmunity float64 `json:"respawnImmunitySeconds"`
	FrontDot        float64 `json:"frontDot"`
	MotionDot       float64 `json:"motionDot"`
	MinClosingSpeed float64 `json:"minClosingSpeed"`
	SpeedTieEpsilon float64 `json:"speedTieEpsilon"`
}

type Config struct {
	PhysicsHz   int              `json:"physicsHz"`
	SnapshotHz  int              `json:"snapshotHz"`
	MaxPlayers  int              `json:"maxPlayers"`
	SolverSteps int              `json:"solverSteps"`
	Gravity     float64          `json:"gravity"`
	GameMode    string           `json:"gameMode"`
	Arena       ArenaConfig      `json:"arena"`
	Car         CarConfig        `json:"car"`
	Ball        BallConfig       `json:"ball"`
	BoostPads   BoostPadConfig   `json:"boostPads"`
	Demolition  DemolitionConfig `json:"demolition"`
}

func DefaultConfig() Config {
	return Config{
		PhysicsHz:   PhysicsHz,
		SnapshotHz:  SnapshotHz,
		MaxPlayers:  DefaultMaxPlayers,
		SolverSteps: 4,
		Gravity:     RLGravity,
		GameMode:    GameModeNormal,
		Arena: ArenaConfig{
			Width: RLArenaWidth, Length: RLArenaLength, Ceiling: RLArenaCeiling, WallHeight: RLArenaCeiling,
			CornerRadius: RLArenaCornerRadius, RampRadius: RLArenaRampRadius, CeilingRampRadius: RLArenaRampRadius,
			GoalWidth: RLGoalWidth, GoalHeight: RLGoalHeight, GoalDepth: RLGoalDepth,
			GoalRampRadius: RLArenaRampRadius, GoalMouthRadius: 0.8,
		},
		Car: CarConfig{
			HalfExtents:             Vec3{X: GameplayCarHalfWidth, Y: GameplayCarHalfHeight, Z: GameplayCarHalfLength},
			Mass:                    RLCarMass,
			MaxGroundSpeed:          RLCarMaxThrottleSpeed,
			MaxBoostSpeed:           RLCarMaxSpeed,
			SupersonicSpeed:         RLSupersonicSpeed,
			BoostCapacity:           100,
			BoostConsumption:        RLBoostConsumptionPerSecond,
			DriveAcceleration:       16,
			ReverseAcceleration:     16,
			BrakeAcceleration:       RLBrakeAcceleration,
			CoastDeceleration:       RLCoastDeceleration,
			BoostAcceleration:       RLGroundBoostAcceleration,
			AirBoostAcceleration:    RLAirBoostAcceleration,
			AirThrottleAcceleration: RLAirThrottleAcceleration,
			AirReverseAcceleration:  RLAirReverseAcceleration,
			Grip:                    18,
			DriftGrip:               3.0,
			SteerRate:               2.75,
			DriftSteerRate:          4.65,
			SteerResponse:           14,
			DriftSteerResponse:      19,
			GroundAngularDamping:    11,
			AirPitchAcceleration:    RLAirPitchAcceleration,
			AirYawAcceleration:      RLAirYawAcceleration,
			AirRollAcceleration:     RLAirRollAcceleration,
			AirPitchRate:            RLMaxCarAngularSpeed,
			AirYawRate:              RLMaxCarAngularSpeed,
			AirRollRate:             RLMaxCarAngularSpeed,
			AirControlResponse:      11.5,
			AirNeutralResponse:      8.5,
			MaxAirAngular:           RLMaxCarAngularSpeed,
			JumpSpeed:               RLJumpImpulse,
			JumpHoldAcceleration:    RLJumpHoldAcceleration,
			JumpHoldDuration:        RLJumpHoldDuration,
			JumpMinimumHoldDuration: RLJumpMinimumHoldDuration,
			JumpStickyAcceleration:  RLJumpStickyAcceleration,
			JumpStickyDuration:      RLJumpStickyDuration,
			DoubleJumpSpeed:         RLDoubleJumpImpulse,
			DodgeImpulse:            5.0,
			DodgeLift:               1.8,
			DodgeAngularSpeed:       GameplayDodgeAngularSpeed,
			DodgeRotation:           6.283185307179586,
			DodgeWindow:             1.25,
			DodgeDuration:           6.283185307179586 / GameplayDodgeAngularSpeed,
			DodgeControlScale:       0.0,
			DownAcceleration:        RLJumpStickyAcceleration,
			WallGravityCancel:       1,
			SurfaceAlignResponse:    16,
			LinearDamping:           0.0,
			AngularDamping:          0.55,
			Restitution:             0,
		},
		Ball: BallConfig{
			Radius:            GameplayBallRadius,
			Mass:              RLBallMass,
			Restitution:       RLBallRestitution,
			Friction:          0.22,
			RollingResistance: 0.18,
			LinearDamping:     RLBallLinearDrag,
			AngularDamping:    0.055,
			MaxSpeed:          RLBallMaxSpeed,
			MaxAngularSpeed:   RLBallMaxAngularSpeed,
			CarHitPower:       0.34,
			CarHitLift:        0.11,
			CarHitLiftBase:    0.45,
			SpawnY:            GameplayBallRestHeight,
			RestingHeight:     GameplayBallRestHeight,
		},
		BoostPads: BoostPadConfig{
			FullAmount: 100, SmallAmount: 12, SmallRespawnSeconds: 4, FullRespawnSeconds: 10,
		},
		Demolition: DemolitionConfig{
			Enabled: true, MinSpeed: RLSupersonicSpeed, RespawnSeconds: DemolitionRespawnSeconds,
			RespawnBoost: DemolitionRespawnBoost, RespawnImmunity: 0.75, FrontDot: 0.72, MotionDot: 0.72,
			MinClosingSpeed: 0.15, SpeedTieEpsilon: 0.05,
		},
	}
}

func NormalizeGameMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case GameModeBasketball, "hoops", "basket", "basketball-hoops":
		return GameModeBasketball
	default:
		return GameModeNormal
	}
}
