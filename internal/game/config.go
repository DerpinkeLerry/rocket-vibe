package game

const (
	PhysicsHz  = 120
	SnapshotHz = 60
	MaxPlayers = 4
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
	HalfExtents          Vec3    `json:"halfExtents"`
	Mass                 float64 `json:"mass"`
	MaxGroundSpeed       float64 `json:"maxGroundSpeed"`
	MaxBoostSpeed        float64 `json:"maxBoostSpeed"`
	BoostCapacity        float64 `json:"boostCapacity"`
	BoostConsumption     float64 `json:"boostConsumptionPerSecond"`
	DriveAcceleration    float64 `json:"driveAcceleration"`
	ReverseAcceleration  float64 `json:"reverseAcceleration"`
	BrakeAcceleration    float64 `json:"brakeAcceleration"`
	CoastDeceleration    float64 `json:"coastDeceleration"`
	BoostAcceleration    float64 `json:"boostAcceleration"`
	Grip                 float64 `json:"grip"`
	SteerRate            float64 `json:"steerRate"`
	SteerResponse        float64 `json:"steerResponse"`
	GroundAngularDamping float64 `json:"groundAngularDamping"`
	AirPitchAcceleration float64 `json:"airPitchAcceleration"`
	AirYawAcceleration   float64 `json:"airYawAcceleration"`
	AirRollAcceleration  float64 `json:"airRollAcceleration"`
	MaxAirAngular        float64 `json:"maxAirAngular"`
	JumpSpeed            float64 `json:"jumpSpeed"`
	JumpHoldAcceleration float64 `json:"jumpHoldAcceleration"`
	JumpHoldDuration     float64 `json:"jumpHoldDuration"`
	DoubleJumpSpeed      float64 `json:"doubleJumpSpeed"`
	DodgeImpulse         float64 `json:"dodgeImpulse"`
	DodgeLift            float64 `json:"dodgeLift"`
	DodgeAngularSpeed    float64 `json:"dodgeAngularSpeed"`
	DodgeRotation        float64 `json:"dodgeRotation"`
	DodgeWindow          float64 `json:"dodgeWindow"`
	DodgeDuration        float64 `json:"dodgeDuration"`
	DodgeControlScale    float64 `json:"dodgeControlScale"`
	DownAcceleration     float64 `json:"downAcceleration"`
	WallGravityCancel    float64 `json:"wallGravityCancel"`
	SurfaceAlignResponse float64 `json:"surfaceAlignResponse"`
	LinearDamping        float64 `json:"linearDamping"`
	AngularDamping       float64 `json:"angularDamping"`
	Restitution          float64 `json:"restitution"`
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
}

type Config struct {
	PhysicsHz   int         `json:"physicsHz"`
	SnapshotHz  int         `json:"snapshotHz"`
	MaxPlayers  int         `json:"maxPlayers"`
	SolverSteps int         `json:"solverSteps"`
	Gravity     float64     `json:"gravity"`
	Arena       ArenaConfig `json:"arena"`
	Car         CarConfig   `json:"car"`
	Ball        BallConfig  `json:"ball"`
}

func DefaultConfig() Config {
	return Config{
		PhysicsHz:   PhysicsHz,
		SnapshotHz:  SnapshotHz,
		MaxPlayers:  MaxPlayers,
		SolverSteps: 4,
		Gravity:     20.5,
		Arena: ArenaConfig{
			Width: 110, Length: 160, Ceiling: 25, WallHeight: 25, CornerRadius: 16, RampRadius: 3.4, CeilingRampRadius: 6,
			GoalWidth: 34, GoalHeight: 12, GoalDepth: 14, GoalRampRadius: 3.4, GoalMouthRadius: 2.8,
		},
		Car: CarConfig{
			HalfExtents:          Vec3{X: 0.83, Y: 0.45, Z: 1.48},
			Mass:                 420,
			MaxGroundSpeed:       70.0 / 3.6,
			MaxBoostSpeed:        100.0 / 3.6,
			BoostCapacity:        100,
			BoostConsumption:     100.0 / 3.0,
			DriveAcceleration:    14,
			ReverseAcceleration:  10,
			BrakeAcceleration:    28,
			CoastDeceleration:    3.5,
			BoostAcceleration:    16,
			Grip:                 18,
			SteerRate:            2.75,
			SteerResponse:        14,
			GroundAngularDamping: 11,
			AirPitchAcceleration: 11,
			AirYawAcceleration:   8.8,
			AirRollAcceleration:  10.5,
			MaxAirAngular:        6.6,
			JumpSpeed:            12.4,
			JumpHoldAcceleration: 24,
			JumpHoldDuration:     0.18,
			DoubleJumpSpeed:      10,
			DodgeImpulse:         14.0,
			DodgeLift:            1.8,
			DodgeAngularSpeed:    11.22,
			DodgeRotation:        6.283185307179586,
			DodgeWindow:          1.25,
			DodgeDuration:        0.56,
			DodgeControlScale:    0.0,
			DownAcceleration:     18,
			WallGravityCancel:    1,
			SurfaceAlignResponse: 16,
			LinearDamping:        0.0,
			AngularDamping:       0.55,
			Restitution:          0,
		},
		Ball: BallConfig{
			Radius:            2.2,
			Mass:              30,
			Restitution:       0.68,
			Friction:          0.22,
			RollingResistance: 0.18,
			LinearDamping:     0.015,
			AngularDamping:    0.055,
			MaxSpeed:          60,
			MaxAngularSpeed:   34,
			CarHitPower:       0.34,
			CarHitLift:        0.11,
			CarHitLiftBase:    0.45,
			SpawnY:            5.5,
		},
	}
}
