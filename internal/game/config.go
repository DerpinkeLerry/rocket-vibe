package game

const (
	PhysicsHz  = 120
	SnapshotHz = 60
	MaxPlayers = 4
)

type ArenaConfig struct {
	Width        float64 `json:"width"`
	Length       float64 `json:"length"`
	Ceiling      float64 `json:"ceiling"`
	WallHeight   float64 `json:"wallHeight"`
	CornerRadius float64 `json:"cornerRadius"`
	RampRadius   float64 `json:"rampRadius"`
	GoalWidth    float64 `json:"goalWidth"`
	GoalHeight   float64 `json:"goalHeight"`
	GoalDepth    float64 `json:"goalDepth"`
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
	Radius          float64 `json:"radius"`
	Mass            float64 `json:"mass"`
	Restitution     float64 `json:"restitution"`
	Friction        float64 `json:"friction"`
	LinearDamping   float64 `json:"linearDamping"`
	AngularDamping  float64 `json:"angularDamping"`
	MaxSpeed        float64 `json:"maxSpeed"`
	MaxAngularSpeed float64 `json:"maxAngularSpeed"`
	SpawnY          float64 `json:"spawnY"`
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
			Width: 110, Length: 160, Ceiling: 25, WallHeight: 25, CornerRadius: 16, RampRadius: 7,
			GoalWidth: 34, GoalHeight: 12, GoalDepth: 14,
		},
		Car: CarConfig{
			HalfExtents:          Vec3{X: 0.83, Y: 0.45, Z: 1.48},
			Mass:                 420,
			MaxGroundSpeed:       60.0 / 3.6,
			MaxBoostSpeed:        80.0 / 3.6,
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
			DodgeImpulse:         13.5,
			DodgeLift:            2.2,
			DodgeAngularSpeed:    11.5,
			DodgeWindow:          1.25,
			DodgeDuration:        0.65,
			DodgeControlScale:    0.18,
			DownAcceleration:     18,
			WallGravityCancel:    1,
			SurfaceAlignResponse: 18,
			LinearDamping:        0.06,
			AngularDamping:       0.55,
			Restitution:          0,
		},
		Ball: BallConfig{
			Radius:          2.2,
			Mass:            30,
			Restitution:     0.62,
			Friction:        0.24,
			LinearDamping:   0.035,
			AngularDamping:  0.06,
			MaxSpeed:        56,
			MaxAngularSpeed: 32,
			SpawnY:          5.5,
		},
	}
}
