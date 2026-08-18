package game

import (
	"math"
)

const (
	InputW     uint8 = 1 << 0
	InputS     uint8 = 1 << 1
	InputA     uint8 = 1 << 2
	InputD     uint8 = 1 << 3
	InputQ     uint8 = 1 << 4
	InputE     uint8 = 1 << 5
	InputBoost uint8 = 1 << 6
	InputJump  uint8 = 1 << 7

	InputFlagDrift  uint8 = 1 << 0
	InputFlagAnalog uint8 = 1 << 1

	EdgeJump      uint8 = 1 << 0
	EdgeReset     uint8 = 1 << 1
	EdgeBallReset uint8 = 1 << 2

	TeamOrange = "orange"
	TeamBlue   = "blue"

	BoostPadCount = 34
)

type Input struct {
	Sequence uint32
	Mask     uint8
	Edges    uint8
	Flags    uint8
	Throttle float64
	Steer    float64
}

type Body struct {
	Position        Vec3 `json:"position"`
	Rotation        Quat `json:"rotation"`
	Velocity        Vec3 `json:"velocity"`
	AngularVelocity Vec3 `json:"angularVelocity"`
}

type Car struct {
	Body
	Connected           bool    `json:"connected"`
	Grounded            bool    `json:"grounded"`
	Slot                int     `json:"slot"`
	Input               Input   `json:"-"`
	LastInputTick       uint64  `json:"-"`
	JumpCount           int     `json:"-"`
	JumpHoldTime        float64 `json:"-"`
	JumpHoldActive      bool    `json:"-"`
	JumpStickyTime      float64 `json:"-"`
	AirTime             float64 `json:"-"`
	GroundLockout       float64 `json:"-"`
	DodgeTime           float64 `json:"-"`
	DodgeAngleRemaining float64 `json:"-"`
	DodgeAxis           Vec3    `json:"-"`
	DodgePitchLock      float64 `json:"-"`
	DodgeYawLock        float64 `json:"-"`
	Boost               float64 `json:"boost"`
	GroundNormal        Vec3    `json:"-"`
	Demolished          bool    `json:"-"`
	DemoImmunity        float64 `json:"-"`
}

type BoostPad struct {
	Position       Vec3
	Amount         float64
	Radius         float64
	Height         float64
	RespawnSeconds float64
	Full           bool
	Active         bool
	RespawnAtTick  uint64
}

type Ball struct {
	Body
}

type EntityState struct {
	Position        Vec3 `json:"position"`
	Rotation        Quat `json:"rotation"`
	Velocity        Vec3 `json:"velocity"`
	AngularVelocity Vec3 `json:"angularVelocity"`
}

type Snapshot struct {
	Tick           uint64                  `json:"tick"`
	ConnectedMask  uint8                   `json:"connectedMask"`
	GroundMask     uint8                   `json:"groundMask"`
	OrangeScore    uint16                  `json:"orangeScore"`
	BlueScore      uint16                  `json:"blueScore"`
	Boost          [MaxPlayers]uint8       `json:"boost"`
	BoostPadMask   uint64                  `json:"boostPadMask"`
	DemolishedMask uint8                   `json:"demolishedMask"`
	Cars           [MaxPlayers]EntityState `json:"cars"`
	Ball           EntityState             `json:"ball"`
}

type World struct {
	Config      Config
	Cars        [MaxPlayers]Car
	Ball        Ball
	Tick        uint64
	OrangeScore uint16
	BlueScore   uint16
	BoostPads   [BoostPadCount]BoostPad

	// Replay/goal attribution stays outside the snapshot protocol. The match
	// server reads these fields after a scoring tick and tells every client which
	// car should be used as the replay camera target.
	LastBallTouchSlot    int
	LastBallTouchTick    uint64
	PreviousBallPosition Vec3
	LastGoalScorer       int
	LastGoalTick         uint64
	LastGoalSign         int
	LastGoalScoringTeam  string
	LastGoalPosition     Vec3
	GoalSequence         uint64
	GoalLocked           bool

	DemolitionsEnabled bool
	pendingDemolitions []DemolitionEvent
}

func TeamForSlot(slot int) string {
	if slot%2 == 0 {
		return TeamOrange
	}
	return TeamBlue
}

const DemolitionSpawnCount = 4

type DemolitionEvent struct {
	AttackerSlot int
	VictimSlot   int
	Position     Vec3
}

type RespawnPoint struct {
	Position Vec3    `json:"position"`
	Yaw      float64 `json:"yaw"`
}

func RespawnPointsForSlot(slot int) [DemolitionSpawnCount]RespawnPoint {
	team := TeamForSlot(slot)
	if team == TeamBlue {
		return [DemolitionSpawnCount]RespawnPoint{
			{Position: Vec3{X: -23.04, Y: GameplayCarHalfHeight, Z: -46.08}, Yaw: math.Pi},
			{Position: Vec3{X: -26.88, Y: GameplayCarHalfHeight, Z: -46.08}, Yaw: math.Pi},
			{Position: Vec3{X: 23.04, Y: GameplayCarHalfHeight, Z: -46.08}, Yaw: math.Pi},
			{Position: Vec3{X: 26.88, Y: GameplayCarHalfHeight, Z: -46.08}, Yaw: math.Pi},
		}
	}
	return [DemolitionSpawnCount]RespawnPoint{
		{Position: Vec3{X: 23.04, Y: GameplayCarHalfHeight, Z: 46.08}, Yaw: 0},
		{Position: Vec3{X: 26.88, Y: GameplayCarHalfHeight, Z: 46.08}, Yaw: 0},
		{Position: Vec3{X: -23.04, Y: GameplayCarHalfHeight, Z: 46.08}, Yaw: 0},
		{Position: Vec3{X: -26.88, Y: GameplayCarHalfHeight, Z: 46.08}, Yaw: 0},
	}
}

var playerSpawns = [MaxPlayers]struct {
	Position Vec3
	Yaw      float64
}{
	// RLBot's yaw uses a different zero axis; these values are converted to the
	// local convention where yaw 0 faces -Z. The diagonal cars deliberately
	// point at 45 degrees, as in Rocket League, rather than directly at the ball.
	{Position: Vec3{X: 20.48, Y: GameplayCarHalfHeight, Z: 25.60}, Yaw: math.Pi / 4},
	{Position: Vec3{X: -20.48, Y: GameplayCarHalfHeight, Z: -25.60}, Yaw: -3 * math.Pi / 4},
	{Position: Vec3{X: -20.48, Y: GameplayCarHalfHeight, Z: 25.60}, Yaw: -math.Pi / 4},
	{Position: Vec3{X: 20.48, Y: GameplayCarHalfHeight, Z: -25.60}, Yaw: 3 * math.Pi / 4},
	{Position: Vec3{X: 2.56, Y: GameplayCarHalfHeight, Z: 38.40}, Yaw: 0},
	{Position: Vec3{X: -2.56, Y: GameplayCarHalfHeight, Z: -38.40}, Yaw: math.Pi},
	{Position: Vec3{X: -2.56, Y: GameplayCarHalfHeight, Z: 38.40}, Yaw: 0},
	{Position: Vec3{X: 2.56, Y: GameplayCarHalfHeight, Z: -38.40}, Yaw: math.Pi},
}

var boostPadSpecs = [BoostPadCount]BoostPad{
	// DFH Stadium coordinates from RLBot, converted from uu to metres. IDs stay
	// in FieldInfo order so clients and the authoritative 34-bit mask agree.
	{Position: Vec3{X: 0, Z: -42.40}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -17.92, Z: -41.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 17.92, Z: -41.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -30.72, Z: -40.96}, Amount: 100, Radius: 2.08, Height: 1.68, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: 30.72, Z: -40.96}, Amount: 100, Radius: 2.08, Height: 1.68, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: -9.40, Z: -33.08}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 9.40, Z: -33.08}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: -28.16}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -35.84, Z: -24.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 35.84, Z: -24.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -17.88, Z: -23.00}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 17.88, Z: -23.00}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -20.48, Z: -10.36}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: -10.24}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 20.48, Z: -10.36}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -35.84, Z: 0}, Amount: 100, Radius: 2.08, Height: 1.68, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: -10.24, Z: 0}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 10.24, Z: 0}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 35.84, Z: 0}, Amount: 100, Radius: 2.08, Height: 1.68, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: -20.48, Z: 10.36}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: 10.24}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 20.48, Z: 10.36}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -17.88, Z: 23.00}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 17.88, Z: 23.00}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -35.84, Z: 24.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 35.84, Z: 24.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: 28.16}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -9.40, Z: 33.08}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 9.40, Z: 33.08}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -30.72, Z: 40.96}, Amount: 100, Radius: 2.08, Height: 1.68, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: 30.72, Z: 40.96}, Amount: 100, Radius: 2.08, Height: 1.68, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: -17.92, Z: 41.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 17.92, Z: 41.84}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: 42.40}, Amount: 12, Radius: 1.44, Height: 1.65, RespawnSeconds: 4},
}

func NewWorld(config Config) *World {
	world := &World{Config: config, LastBallTouchSlot: -1, LastGoalScorer: -1, DemolitionsEnabled: config.Demolition.Enabled}
	for slot := range world.Cars {
		world.Cars[slot].Slot = slot
		world.resetCar(&world.Cars[slot])
	}
	world.resetBoostPads()
	world.resetBall()
	return world
}

func (world *World) SetConnected(slot int, connected bool) bool {
	if slot < 0 || slot >= len(world.Cars) {
		return false
	}
	car := &world.Cars[slot]
	car.Connected = connected
	world.resetCar(car)
	return true
}

func (world *World) SetDemolitionsEnabled(enabled bool) {
	world.DemolitionsEnabled = enabled
	if !enabled {
		world.pendingDemolitions = world.pendingDemolitions[:0]
	}
}

func (world *World) ConsumeDemolitions() []DemolitionEvent {
	if len(world.pendingDemolitions) == 0 {
		return nil
	}
	events := append([]DemolitionEvent(nil), world.pendingDemolitions...)
	world.pendingDemolitions = world.pendingDemolitions[:0]
	return events
}

func (world *World) RespawnCar(slot, choice int) (RespawnPoint, bool) {
	if slot < 0 || slot >= len(world.Cars) {
		return RespawnPoint{}, false
	}
	points := RespawnPointsForSlot(slot)
	if choice < 0 || choice >= len(points) {
		choice = 1
	}
	point := points[choice]
	car := &world.Cars[slot]
	if !car.Connected {
		return RespawnPoint{}, false
	}
	connected := car.Connected
	world.resetCarAt(car, point.Position, point.Yaw, world.Config.Demolition.RespawnBoost)
	car.Connected = connected
	car.DemoImmunity = world.Config.Demolition.RespawnImmunity
	return point, true
}

func (world *World) ResetMatch() {
	world.OrangeScore = 0
	world.BlueScore = 0
	world.ResetKickoff()
}

// ResetKickoff returns every gameplay object to a fair kickoff state without
// touching the score. It is used after a goal replay finishes.
func (world *World) ResetKickoff() {
	world.pendingDemolitions = world.pendingDemolitions[:0]
	for index := range world.Cars {
		world.resetCar(&world.Cars[index])
	}
	world.resetBoostPads()
	world.resetBall()
	world.GoalLocked = false
	world.LastGoalSign = 0
	world.LastGoalScoringTeam = ""
	world.LastGoalPosition = Vec3{}
}

// ClearInputs keeps input sequence numbers intact while neutralizing controls.
// The match server uses it during the short goal-explosion celebration so the
// radial blast, not player steering, owns the cars for that moment.
func (world *World) ClearInputs() {
	for index := range world.Cars {
		car := &world.Cars[index]
		if !car.Connected {
			continue
		}
		car.Input.Mask = 0
		car.Input.Edges = 0
		car.Input.Flags = 0
		car.Input.Throttle = 0
		car.Input.Steer = 0
		car.LastInputTick = world.Tick
	}
}

func (world *World) SetInput(slot int, input Input) bool {
	if slot < 0 || slot >= len(world.Cars) {
		return false
	}
	car := &world.Cars[slot]
	if !car.Connected || !sequenceIsNewer(input.Sequence, car.Input.Sequence) {
		return false
	}
	input.Mask &= 0xff
	input.Edges &= 0x07
	input.Flags &= InputFlagDrift | InputFlagAnalog
	if !isFinite(input.Throttle) {
		input.Throttle = 0
	}
	if !isFinite(input.Steer) {
		input.Steer = 0
	}
	input.Throttle = clamp(input.Throttle, -1, 1)
	input.Steer = clamp(input.Steer, -1, 1)
	if input.Flags&InputFlagAnalog == 0 {
		input.Throttle = 0
		input.Steer = 0
	}
	input.Edges |= car.Input.Edges
	car.Input = input
	car.LastInputTick = world.Tick
	return true
}

func sequenceIsNewer(next, previous uint32) bool {
	if next == previous {
		return false
	}
	return int32(next-previous) > 0
}

func (world *World) Step(dt float64) {
	if dt <= 0 || !isFinite(dt) {
		return
	}
	world.Tick++
	world.refreshBoostPads()

	ballReset := false
	for index := range world.Cars {
		car := &world.Cars[index]
		if !car.Connected || car.Demolished {
			continue
		}
		if car.Input.Edges&EdgeBallReset != 0 {
			ballReset = true
		}
		world.stepCar(car, dt)
		car.Grounded = false
	}
	if ballReset {
		world.resetBall()
	}
	world.PreviousBallPosition = world.Ball.Position
	world.stepBall(dt)

	for iteration := 0; iteration < world.Config.SolverSteps; iteration++ {
		for index := range world.Cars {
			car := &world.Cars[index]
			if car.Connected && !car.Demolished {
				resolveCarArena(car, world.Config)
				if NormalizeGameMode(world.Config.GameMode) == GameModeBasketball {
					resolveCarBasketballHoops(car, world.Config)
				}
			}
		}
		resolveBallArena(&world.Ball, world.Config)
		if NormalizeGameMode(world.Config.GameMode) == GameModeBasketball {
			resolveBallBasketballHoops(&world.Ball, world.Config)
		}

		for first := 0; first < len(world.Cars); first++ {
			carA := &world.Cars[first]
			if !carA.Connected || carA.Demolished {
				continue
			}
			for second := first + 1; second < len(world.Cars); second++ {
				if carA.Demolished {
					break
				}
				carB := &world.Cars[second]
				if !carB.Connected || carB.Demolished {
					continue
				}
				contact, hit := carCarContact(carA, carB, world.Config.Car)
				if !hit {
					continue
				}
				if world.tryCarCarDemolition(carA, carB, contact) {
					continue
				}
				resolveCarCarContact(carA, carB, world.Config.Car, contact)
			}
			if carA.Demolished {
				continue
			}
			if resolveCarBall(carA, &world.Ball, world.Config) {
				world.LastBallTouchSlot = carA.Slot
				world.LastBallTouchTick = world.Tick
			}
		}
	}
	world.collectBoostPads()
	world.detectGoal()

	for index := range world.Cars {
		car := &world.Cars[index]
		if !car.Connected || car.Demolished {
			continue
		}
		world.finishCarStep(car, dt)
		if !bodyIsFinite(car.Body) || car.Position.Y < -8 || math.Abs(car.Position.X) > 200 || math.Abs(car.Position.Z) > 200 {
			world.resetCar(car)
		}
		car.Input.Edges = 0
	}
	world.finishBallStep()
}

func (world *World) stepCar(car *Car, dt float64) {
	car.DemoImmunity = math.Max(0, car.DemoImmunity-dt)
	if car.Input.Edges&EdgeReset != 0 {
		world.resetCar(car)
		return
	}

	car.GroundLockout = math.Max(0, car.GroundLockout-dt)
	inputMask := car.Input.Mask
	inputFlags := car.Input.Flags
	analogThrottle := car.Input.Throttle
	analogSteer := car.Input.Steer
	if world.Tick-car.LastInputTick > uint64(world.Config.PhysicsHz) {
		inputMask = 0
		inputFlags = 0
		analogThrottle = 0
		analogSteer = 0
	}

	config := world.Config.Car
	rotation := car.Rotation.Normalize()
	forward := rotation.Rotate(Vec3{Z: -1}).NormalizeOr(Vec3{Z: -1})
	right := rotation.Rotate(Vec3{X: 1}).NormalizeOr(Vec3{X: 1})
	up := rotation.Rotate(Vec3{Y: 1}).NormalizeOr(Vec3{Y: 1})
	nearFloor := car.Position.Y <= config.HalfExtents.Y+0.12 && up.Y > 0.45 && math.Abs(car.Velocity.Y) < 4.5
	driveGrounded := car.GroundLockout <= 0 && (car.Grounded || nearFloor)
	if nearFloor && !car.Grounded {
		car.GroundNormal = Vec3{Y: 1}
	}

	forwardInput := boolValue(inputMask&InputW != 0) - boolValue(inputMask&InputS != 0)
	steerInput := boolValue(inputMask&InputA != 0) - boolValue(inputMask&InputD != 0)
	if inputFlags&InputFlagAnalog != 0 {
		forwardInput = analogThrottle
		steerInput = analogSteer
	}
	rollInput := boolValue(inputMask&InputQ != 0) - boolValue(inputMask&InputE != 0)
	boosting := inputMask&InputBoost != 0 && car.Boost > 0.001
	drifting := inputFlags&InputFlagDrift != 0
	if boosting {
		car.Boost = math.Max(0, car.Boost-config.BoostConsumption*dt)
	}

	if driveGrounded {
		world.applyGroundDrive(car, forward, right, forwardInput, steerInput, boosting, drifting, dt)
		car.AirTime = 0
	} else {
		airPitch, airYaw := filterPostDodgeAirInput(car, forwardInput, steerInput)
		world.applyAirControl(car, forward, right, up, airPitch, airYaw, rollInput, boosting, dt)
		car.AirTime += dt
	}

	if car.Input.Edges&EdgeJump != 0 {
		if driveGrounded && car.JumpCount == 0 {
			groundNormal := car.GroundNormal.NormalizeOr(Vec3{Y: 1})
			car.Velocity = car.Velocity.Add(groundNormal.Mul(config.JumpSpeed))
			car.JumpCount = 1
			car.JumpHoldTime = 0
			car.JumpHoldActive = true
			car.JumpStickyTime = config.JumpStickyDuration
			car.AirTime = 0
			car.Grounded = false
			car.GroundLockout = 0.16
			driveGrounded = false
		} else if !driveGrounded && car.JumpCount == 1 && car.AirTime <= config.DodgeWindow+math.Min(config.JumpHoldDuration, car.JumpHoldTime) {
			world.applySecondJumpOrDodge(car, forward, right, up, forwardInput, steerInput)
		}
	}

	// Variable first-jump height. The hold force is available only while the
	// original jump press remains continuously held; once released it cannot be
	// re-armed until the car lands. This keeps the second press free for a dodge.
	if car.JumpCount == 1 && car.JumpHoldActive {
		released := inputMask&InputJump == 0
		if released && car.JumpHoldTime >= config.JumpMinimumHoldDuration {
			car.JumpHoldActive = false
		} else if car.JumpHoldTime < config.JumpHoldDuration {
			holdDt := math.Min(dt, config.JumpHoldDuration-car.JumpHoldTime)
			car.Velocity = car.Velocity.Add(up.Mul(config.JumpHoldAcceleration * holdDt))
			car.JumpHoldTime += holdDt
			if car.JumpHoldTime >= config.JumpHoldDuration-1e-9 ||
				(released && car.JumpHoldTime >= config.JumpMinimumHoldDuration-1e-9) {
				car.JumpHoldActive = false
			}
		}
	}

	if car.JumpStickyTime > 0 {
		stickyDt := math.Min(dt, car.JumpStickyTime)
		car.Velocity = car.Velocity.Sub(up.Mul(config.JumpStickyAcceleration * stickyDt))
		car.JumpStickyTime = math.Max(0, car.JumpStickyTime-stickyDt)
	}

	if driveGrounded {
		groundNormal := car.GroundNormal.NormalizeOr(Vec3{Y: 1})
		// On steep surfaces the ordinary world gravity would pull a perfectly
		// aligned car straight down the glass.  Cancel only the tangential part
		// as the surface turns vertical, then press the suspension into the wall.
		// Jumping disables both immediately through driveGrounded/lockout.
		steepness := clamp(1-math.Max(0, groundNormal.Y), 0, 1)
		gravity := Vec3{Y: -world.Config.Gravity}
		tangentGravity := gravity.Sub(groundNormal.Mul(gravity.Dot(groundNormal)))
		car.Velocity = car.Velocity.Sub(tangentGravity.Mul(config.WallGravityCancel * steepness * dt))
		car.Velocity = car.Velocity.Sub(groundNormal.Mul(config.DownAcceleration * dt))
	}

	car.Velocity.Y -= world.Config.Gravity * dt
	car.Velocity = car.Velocity.Mul(math.Exp(-config.LinearDamping * dt))
	car.AngularVelocity = car.AngularVelocity.Mul(math.Exp(-config.AngularDamping * dt))
	car.Velocity = clampMagnitude(car.Velocity, config.MaxBoostSpeed)
	car.Position = car.Position.Add(car.Velocity.Mul(dt))
	dodgeCompleted := world.driveDodgeRotation(car, dt)
	car.Rotation = car.Rotation.Integrate(car.AngularVelocity, dt)
	if dodgeCompleted {
		world.stopDodgeRotation(car)
	}
}

func (world *World) applySecondJumpOrDodge(car *Car, forward, right, up Vec3, forwardInput, steerInput float64) {
	config := world.Config.Car
	directionMagnitude := math.Hypot(forwardInput, steerInput)
	if directionMagnitude < 0.25 {
		// A neutral second jump follows the car roof, just like the first jump.
		// This also makes wall double-jumps behave naturally after detaching.
		car.Velocity = car.Velocity.Add(up.NormalizeOr(Vec3{Y: 1}).Mul(config.DoubleJumpSpeed))
		car.JumpCount = 2
		car.JumpHoldActive = false
		return
	}

	forwardAmount := forwardInput / directionMagnitude
	sideAmount := steerInput / directionMagnitude

	// The translational dodge impulse is independent from the car's heading:
	// W/S pushes forward/back, while A/D pushes laterally without yawing the car.
	// Pure side barrel-roll dodges must not add extra vertical velocity; otherwise
	// the same A/D dodge changes jump height and becomes hard to predict. Forward
	// dodges keep the configured small lift and diagonals blend it proportionally.
	dodgeDirection := forward.Mul(forwardAmount).Add(right.Mul(-sideAmount)).NormalizeOr(forward)
	liftScale := math.Abs(forwardAmount)
	if liftScale < 0.20 {
		liftScale = 0
	}
	car.Velocity = car.Velocity.
		Add(dodgeDirection.Mul(config.DodgeImpulse)).
		Add(up.NormalizeOr(Vec3{Y: 1}).Mul(config.DodgeLift * liftScale))

	// A dodge is a finite, owned rotation rather than a one-shot angular kick.
	// Front/back flips rotate around local right. Left/right dodges barrel-roll
	// around local forward with the sign chosen so A rolls left and D rolls right.
	car.DodgeAxis = right.Mul(-forwardAmount).Add(forward.Mul(-sideAmount)).NormalizeOr(right)
	car.DodgeAngleRemaining = config.DodgeRotation
	car.DodgeTime = config.DodgeDuration
	car.DodgePitchLock = math.Copysign(1, forwardAmount)
	if math.Abs(forwardAmount) < 0.25 {
		car.DodgePitchLock = 0
	}
	car.DodgeYawLock = math.Copysign(1, sideAmount)
	if math.Abs(sideAmount) < 0.25 {
		car.DodgeYawLock = 0
	}
	// Clear pre-existing air spin so the requested dodge starts as one clean
	// rotation instead of inheriting a corkscrew from air-control input.
	car.AngularVelocity = Vec3{}
	car.JumpCount = 2
	car.JumpHoldActive = false
}

// driveDodgeRotation owns exactly one configured rotation. It replaces only
// the angular component along the dodge axis on every physics step, so damping
// or held controls cannot turn a single dodge into continuous spinning.
func (world *World) driveDodgeRotation(car *Car, dt float64) bool {
	config := world.Config.Car
	if car.DodgeAngleRemaining <= 1e-9 || dt <= 0 || config.DodgeAngularSpeed <= 0 {
		car.DodgeAngleRemaining = 0
		car.DodgeTime = 0
		return false
	}

	axis := car.DodgeAxis.NormalizeOr(Vec3{})
	if axis.LengthSquared() < 1e-12 {
		car.DodgeAngleRemaining = 0
		car.DodgeTime = 0
		return false
	}

	stepAngle := math.Min(car.DodgeAngleRemaining, config.DodgeAngularSpeed*dt)
	requestedSpeed := stepAngle / dt
	axisSpeed := car.AngularVelocity.Dot(axis)
	car.AngularVelocity = car.AngularVelocity.Sub(axis.Mul(axisSpeed)).Add(axis.Mul(requestedSpeed))
	car.DodgeAngleRemaining = math.Max(0, car.DodgeAngleRemaining-stepAngle)
	car.DodgeTime = car.DodgeAngleRemaining / config.DodgeAngularSpeed
	return car.DodgeAngleRemaining <= 1e-9
}

func (world *World) stopDodgeRotation(car *Car) {
	axis := car.DodgeAxis.NormalizeOr(Vec3{})
	if axis.LengthSquared() > 1e-12 {
		car.AngularVelocity = car.AngularVelocity.Sub(axis.Mul(car.AngularVelocity.Dot(axis)))
	}
	car.DodgeAngleRemaining = 0
	car.DodgeTime = 0
	car.DodgeAxis = Vec3{}
}

func filterPostDodgeAirInput(car *Car, pitch, yaw float64) (float64, float64) {
	if car.DodgePitchLock != 0 {
		if math.Abs(pitch) < 0.25 || pitch*car.DodgePitchLock <= 0 {
			car.DodgePitchLock = 0
		} else {
			pitch = 0
		}
	}
	if car.DodgeYawLock != 0 {
		if math.Abs(yaw) < 0.25 || yaw*car.DodgeYawLock <= 0 {
			car.DodgeYawLock = 0
		} else {
			yaw = 0
		}
	}
	return pitch, yaw
}

func (world *World) applyGroundDrive(car *Car, forward, right Vec3, throttle, steer float64, boosting, drifting bool, dt float64) {
	config := world.Config.Car
	groundNormal := car.GroundNormal.NormalizeOr(Vec3{Y: 1})
	forward = surfaceTangentForward(forward, car.Velocity, groundNormal)
	right = forward.Cross(groundNormal).NormalizeOr(right)

	forwardSpeed := car.Velocity.Dot(forward)
	lateralSpeed := car.Velocity.Dot(right)
	effectiveThrottle := clamp(throttle, -1, 1)
	if boosting {
		// Rocket League forces throttle to +1 while boost is active.
		effectiveThrottle = 1
	}
	nextForward := forwardSpeed
	opposing := math.Abs(effectiveThrottle) >= 0.01 && math.Abs(forwardSpeed) > 0.01 &&
		math.Signbit(effectiveThrottle) != math.Signbit(forwardSpeed)
	if opposing {
		// Any non-zero opposite throttle invokes the measured 3500 uu/s² brake.
		nextForward = moveTowards(forwardSpeed, 0, config.BrakeAcceleration*dt)
	} else if math.Abs(effectiveThrottle) < 0.01 {
		nextForward = moveTowards(forwardSpeed, 0, config.CoastDeceleration*dt)
	} else {
		direction := math.Copysign(1, effectiveThrottle)
		directionalSpeed := nextForward * direction
		if directionalSpeed < config.MaxGroundSpeed {
			accelerationScale := config.DriveAcceleration / 16.0
			if direction < 0 {
				accelerationScale = config.ReverseAcceleration / 16.0
			}
			acceleration := throttleAccelerationAtSpeed(directionalSpeed) * accelerationScale
			steerBlend := math.Pow(math.Abs(clamp(steer, -1, 1)), 2)
			if !drifting && steerBlend > 0 {
				turnAcceleration := math.Max(0, (RLFullSteerSpeed-directionalSpeed)/RLFullSteerTimeConstant)
				acceleration = acceleration*(1-steerBlend) + turnAcceleration*steerBlend
			}
			acceleration *= math.Abs(effectiveThrottle)
			nextForward += direction * acceleration * dt
			if nextForward*direction > config.MaxGroundSpeed {
				nextForward = direction * config.MaxGroundSpeed
			}
		}
	}
	if boosting {
		nextForward += config.BoostAcceleration * dt
		nextForward = math.Min(nextForward, config.MaxBoostSpeed)
	}

	steerAmount := math.Abs(clamp(steer, -1, 1))
	if !drifting && steerAmount > 0.001 {
		// Full steering settles near 1234 uu/s. Cars already above that speed use
		// the measured piecewise deceleration trace instead of snapping to a cap.
		steerLimit := config.MaxGroundSpeed - (config.MaxGroundSpeed-RLFullSteerSpeed)*steerAmount*steerAmount
		if math.Abs(forwardSpeed) <= steerLimit+0.02 && math.Abs(nextForward) > steerLimit {
			nextForward = math.Copysign(steerLimit, nextForward)
		} else if math.Abs(forwardSpeed) > RLFullSteerSpeed {
			turnLoss := fullSteerDecelerationAtSpeed(forwardSpeed) * steerAmount * steerAmount * dt
			nextForward = moveTowards(nextForward, math.Copysign(RLFullSteerSpeed, nextForward), turnLoss)
		}
	}
	activeGrip := config.Grip
	if drifting {
		activeGrip = config.DriftGrip
	}
	nextLateral := lateralSpeed * math.Exp(-activeGrip*dt)
	normalSpeed := math.Min(0, car.Velocity.Dot(groundNormal))
	car.Velocity = forward.Mul(nextForward).
		Add(right.Mul(nextLateral)).
		Add(groundNormal.Mul(normalSpeed))

	targetYaw := turningAngularSpeed(nextForward, steer) * config.SteerRate / 2.75
	steerResponse := config.SteerResponse
	if drifting {
		steerResponse = config.DriftSteerResponse
		reverseSign := math.Copysign(1, nextForward)
		targetYaw = steer * config.DriftSteerRate * reverseSign
	}
	spin := car.AngularVelocity.Dot(groundNormal)
	tangentAngular := car.AngularVelocity.Sub(groundNormal.Mul(spin)).Mul(math.Exp(-config.GroundAngularDamping * dt))
	spin = damp(spin, targetYaw, steerResponse, dt)
	car.AngularVelocity = tangentAngular.Add(groundNormal.Mul(spin))
}

func surfaceTangentForward(forward, velocity, normal Vec3) Vec3 {
	normal = normal.NormalizeOr(Vec3{Y: 1})
	projected := forward.Sub(normal.Mul(forward.Dot(normal)))
	if projected.LengthSquared() > 0.0125 {
		return projected.NormalizeOr(Vec3{Z: -1})
	}

	// When the car reaches a near-vertical wall, its old nose direction can be
	// almost parallel to the surface normal. Using a fixed downward fallback
	// made it suddenly pitch toward the floor. Prefer actual tangential motion,
	// which naturally points up the wall and around the ceiling transition.
	motion := velocity.Sub(normal.Mul(velocity.Dot(normal)))
	if motion.LengthSquared() > 0.25 {
		return motion.NormalizeOr(Vec3{Y: 1})
	}

	stable := Vec3{Y: 1}.Sub(normal.Mul(normal.Y))
	if stable.LengthSquared() < 0.0125 {
		stable = Vec3{Z: -1}.Sub(normal.Mul(Vec3{Z: -1}.Dot(normal)))
	}
	return stable.NormalizeOr(Vec3{Z: -1})
}

func (world *World) applyAirControl(car *Car, forward, right, up Vec3, pitch, yaw, roll float64, boosting bool, dt float64) {
	config := world.Config.Car
	dodging := car.DodgeAngleRemaining > 1e-9
	maximumAngular := config.MaxAirAngular
	if dodging {
		// A dodge owns its rotation completely. driveDodgeRotation programs the
		// one finite revolution later in the step, so normal aerial assistance
		// must not fight or extend it.
		maximumAngular = math.Max(maximumAngular, config.DodgeAngularSpeed)
	} else {
		// Move each local rotation component toward its requested rate while
		// respecting the measured maximum pitch/yaw/roll accelerations.
		pitchRate := car.AngularVelocity.Dot(right)
		yawRate := car.AngularVelocity.Dot(up)
		rollRate := car.AngularVelocity.Dot(forward)
		pitchAccelerationScale := math.Abs(pitch)
		if pitchAccelerationScale < 0.001 {
			pitchAccelerationScale = 1
		}
		yawAccelerationScale := math.Abs(yaw)
		if yawAccelerationScale < 0.001 {
			yawAccelerationScale = 1
		}
		rollAccelerationScale := math.Abs(roll)
		if rollAccelerationScale < 0.001 {
			rollAccelerationScale = 1
		}
		pitchRate = moveTowards(pitchRate, -pitch*config.AirPitchRate, config.AirPitchAcceleration*pitchAccelerationScale*dt)
		yawRate = moveTowards(yawRate, yaw*config.AirYawRate, config.AirYawAcceleration*yawAccelerationScale*dt)
		rollRate = moveTowards(rollRate, roll*config.AirRollRate, config.AirRollAcceleration*rollAccelerationScale*dt)
		car.AngularVelocity = right.Mul(pitchRate).Add(up.Mul(yawRate)).Add(forward.Mul(rollRate))
	}
	car.AngularVelocity = clampMagnitude(car.AngularVelocity, maximumAngular)

	airThrottle := config.AirThrottleAcceleration * math.Max(0, pitch)
	if pitch < 0 {
		airThrottle = config.AirReverseAcceleration * pitch
	}
	car.Velocity = car.Velocity.Add(forward.Mul(airThrottle * dt))
	if boosting {
		car.Velocity = car.Velocity.Add(forward.Mul(config.AirBoostAcceleration * dt))
	}
	car.Velocity = clampMagnitude(car.Velocity, config.MaxBoostSpeed)
}

func (world *World) stepBall(dt float64) {
	config := world.Config.Ball
	world.Ball.Velocity.Y -= world.Config.Gravity * dt
	world.Ball.Velocity = world.Ball.Velocity.Mul(math.Exp(-config.LinearDamping * dt))
	world.Ball.AngularVelocity = world.Ball.AngularVelocity.Mul(math.Exp(-config.AngularDamping * dt))
	world.Ball.Velocity = clampMagnitude(world.Ball.Velocity, config.MaxSpeed)
	world.Ball.AngularVelocity = clampMagnitude(world.Ball.AngularVelocity, config.MaxAngularSpeed)
	world.Ball.Position = world.Ball.Position.Add(world.Ball.Velocity.Mul(dt))
	world.Ball.Rotation = world.Ball.Rotation.Integrate(world.Ball.AngularVelocity, dt)
}

func (world *World) finishCarStep(car *Car, dt float64) {
	if !car.Grounded || car.GroundLockout > 0 {
		return
	}
	groundNormal := car.GroundNormal.NormalizeOr(Vec3{Y: 1})
	forward := surfaceTangentForward(car.Rotation.Rotate(Vec3{Z: -1}), car.Velocity, groundNormal)
	target := QuatFromForwardUp(forward, groundNormal)
	car.Rotation = car.Rotation.NLerp(target, 1-math.Exp(-world.Config.Car.SurfaceAlignResponse*dt))
	spin := car.AngularVelocity.Dot(groundNormal)
	perpendicular := car.AngularVelocity.Sub(groundNormal.Mul(spin)).Mul(math.Exp(-world.Config.Car.GroundAngularDamping * dt))
	car.AngularVelocity = perpendicular.Add(groundNormal.Mul(spin))
	car.JumpCount = 0
	car.JumpHoldTime = 0
	car.JumpHoldActive = false
	car.JumpStickyTime = 0
	car.DodgeTime = 0
	car.DodgeAngleRemaining = 0
	car.DodgeAxis = Vec3{}
	car.DodgePitchLock = 0
	car.DodgeYawLock = 0
	car.AirTime = 0
}

func (world *World) finishBallStep() {
	config := world.Config.Ball
	world.Ball.Velocity = clampMagnitude(world.Ball.Velocity, config.MaxSpeed)
	world.Ball.AngularVelocity = clampMagnitude(world.Ball.AngularVelocity, config.MaxAngularSpeed)
	if !bodyIsFinite(world.Ball.Body) || world.Ball.Position.Y < -12 || math.Abs(world.Ball.Position.X) > 200 || math.Abs(world.Ball.Position.Z) > 200 {
		world.resetBall()
	}
}

func (world *World) resetBoostPads() {
	for index := range world.BoostPads {
		pad := boostPadSpecs[index]
		if pad.Full {
			pad.Amount = world.Config.BoostPads.FullAmount
			pad.RespawnSeconds = world.Config.BoostPads.FullRespawnSeconds
		} else {
			pad.Amount = world.Config.BoostPads.SmallAmount
			pad.RespawnSeconds = world.Config.BoostPads.SmallRespawnSeconds
		}
		pad.Active = true
		pad.RespawnAtTick = 0
		world.BoostPads[index] = pad
	}
}

func (world *World) refreshBoostPads() {
	for index := range world.BoostPads {
		pad := &world.BoostPads[index]
		if !pad.Active && pad.RespawnAtTick > 0 && world.Tick >= pad.RespawnAtTick {
			pad.Active = true
			pad.RespawnAtTick = 0
		}
	}
}

func (world *World) collectBoostPads() {
	for carIndex := range world.Cars {
		car := &world.Cars[carIndex]
		if !car.Connected || car.Demolished {
			continue
		}
		for padIndex := range world.BoostPads {
			pad := &world.BoostPads[padIndex]
			if !pad.Active {
				continue
			}
			if car.Position.Y < -0.05 || car.Position.Y > pad.Height {
				continue
			}
			dx := car.Position.X - pad.Position.X
			dz := car.Position.Z - pad.Position.Z
			pickupRadius := pad.Radius + GameplayBoostPadPickupAssist
			if dx*dx+dz*dz > pickupRadius*pickupRadius {
				continue
			}

			before := car.Boost
			if pad.Full {
				car.Boost = world.Config.Car.BoostCapacity
			} else {
				car.Boost = math.Min(world.Config.Car.BoostCapacity, car.Boost+pad.Amount)
			}
			if car.Boost <= before+0.001 {
				continue
			}

			pad.Active = false
			respawnTicks := uint64(math.Ceil(pad.RespawnSeconds * float64(world.Config.PhysicsHz)))
			if respawnTicks < 1 {
				respawnTicks = 1
			}
			pad.RespawnAtTick = world.Tick + respawnTicks
		}
	}
}

func (world *World) resetCar(car *Car) {
	spawn := playerSpawns[car.Slot]
	world.resetCarAt(car, spawn.Position, spawn.Yaw, world.Config.Car.BoostCapacity)
}

func (world *World) resetCarAt(car *Car, position Vec3, yaw, boost float64) {
	car.Body = Body{Position: position, Rotation: QuatFromYaw(yaw)}
	car.Input = Input{}
	car.LastInputTick = world.Tick
	car.Grounded = false
	car.JumpCount = 0
	car.JumpHoldTime = 0
	car.JumpHoldActive = false
	car.JumpStickyTime = 0
	car.AirTime = 0
	car.GroundLockout = 0
	car.DodgeTime = 0
	car.DodgeAngleRemaining = 0
	car.DodgeAxis = Vec3{}
	car.DodgePitchLock = 0
	car.DodgeYawLock = 0
	car.Boost = clamp(boost, 0, world.Config.Car.BoostCapacity)
	car.GroundNormal = Vec3{Y: 1}
	car.Demolished = false
	car.DemoImmunity = 0
}

func (world *World) tryCarCarDemolition(first, second *Car, contact carCarContactInfo) bool {
	if !world.DemolitionsEnabled || TeamForSlot(first.Slot) == TeamForSlot(second.Slot) {
		return false
	}

	// Demolitions are intentionally asymmetric: the faster car may demolish the
	// slower one, never the other way around. This also prevents head-on impacts
	// from randomly destroying both cars when both happen to satisfy the old
	// frontal/supersonic test in the same solver iteration.
	firstSpeed := first.Velocity.Length()
	secondSpeed := second.Velocity.Length()
	if math.Abs(firstSpeed-secondSpeed) <= world.Config.Demolition.SpeedTieEpsilon {
		return false
	}

	towardSecond := second.Position.Sub(first.Position)
	towardSecond.Y = 0
	if towardSecond.LengthSquared() < 1e-8 {
		towardSecond = contact.Normal
	}

	attacker := first
	victim := second
	direction := towardSecond
	if secondSpeed > firstSpeed {
		attacker = second
		victim = first
		direction = towardSecond.Mul(-1)
	}
	if !world.canDemolishCar(attacker, victim, direction, contact.ClosingSpeed) {
		return false
	}

	position := first.Position.Add(second.Position).Mul(0.5)
	world.markDemolished(victim)
	world.pendingDemolitions = append(world.pendingDemolitions, DemolitionEvent{AttackerSlot: attacker.Slot, VictimSlot: victim.Slot, Position: position})
	return true
}

func (world *World) canDemolishCar(attacker, victim *Car, towardVictim Vec3, closingSpeed float64) bool {
	if attacker == nil || victim == nil || attacker.Demolished || victim.Demolished || victim.DemoImmunity > 0 {
		return false
	}
	config := world.Config.Demolition
	speed := attacker.Velocity.Length()
	if speed+1e-6 < config.MinSpeed || speed <= victim.Velocity.Length()+config.SpeedTieEpsilon || closingSpeed < config.MinClosingSpeed {
		return false
	}

	_, forward := horizontalCarAxes(attacker.Rotation)
	direction := towardVictim
	direction.Y = 0
	direction = direction.NormalizeOr(forward)
	if forward.Dot(direction) < config.FrontDot {
		return false
	}

	motion := attacker.Velocity
	motion.Y = 0
	if motion.LengthSquared() < 1e-8 {
		return false
	}
	motion = motion.NormalizeOr(forward)
	return motion.Dot(direction) >= config.MotionDot
}

func (world *World) markDemolished(car *Car) {
	car.Demolished = true
	car.Grounded = false
	car.Velocity = Vec3{}
	car.AngularVelocity = Vec3{}
	car.Input = Input{Sequence: car.Input.Sequence}
	car.LastInputTick = world.Tick
	car.JumpCount = 0
	car.JumpHoldTime = 0
	car.JumpHoldActive = false
	car.JumpStickyTime = 0
	car.AirTime = 0
	car.GroundLockout = 0
	car.DodgeTime = 0
	car.DodgeAngleRemaining = 0
	car.DodgeAxis = Vec3{}
	car.Boost = 0
}

func (world *World) resetBall() {
	world.Ball.Body = Body{
		Position: Vec3{Y: world.Config.Ball.SpawnY},
		Rotation: IdentityQuat(),
	}
	world.PreviousBallPosition = world.Ball.Position
	world.LastBallTouchSlot = -1
	world.LastBallTouchTick = 0
}

func (world *World) Snapshot() Snapshot {
	snapshot := Snapshot{Tick: world.Tick, OrangeScore: world.OrangeScore, BlueScore: world.BlueScore}
	for index := range world.Cars {
		car := &world.Cars[index]
		if car.Connected {
			snapshot.ConnectedMask |= 1 << index
		}
		if car.Grounded {
			snapshot.GroundMask |= 1 << index
		}
		if car.Demolished {
			snapshot.DemolishedMask |= 1 << index
		}
		snapshot.Cars[index] = stateFromBody(car.Body)
		snapshot.Boost[index] = uint8(math.Round(clamp(car.Boost, 0, world.Config.Car.BoostCapacity)))
	}
	for index := range world.BoostPads {
		if world.BoostPads[index].Active {
			snapshot.BoostPadMask |= 1 << index
		}
	}
	snapshot.Ball = stateFromBody(world.Ball.Body)
	return snapshot
}

func (world *World) detectGoal() bool {
	if world.GoalLocked {
		return false
	}
	if NormalizeGameMode(world.Config.GameMode) == GameModeBasketball {
		return world.detectBasketballGoal()
	}
	return world.detectSoccarGoal()
}

func (world *World) detectSoccarGoal() bool {
	halfLength := world.Config.Arena.Length * 0.5
	ball := &world.Ball
	// A goal only counts once the ENTIRE sphere has crossed the goal plane.
	// Touching the line (or having only part of the ball inside the goal) is not
	// enough, matching Rocket League's whole-ball goal rule.
	if math.Abs(ball.Position.Z)-world.Config.Ball.Radius <= halfLength {
		return false
	}
	if math.Abs(ball.Position.X)+world.Config.Ball.Radius > world.Config.Arena.GoalWidth*0.5 ||
		ball.Position.Y+world.Config.Ball.Radius > world.Config.Arena.GoalHeight {
		return false
	}

	// Positive Z is the orange goal; negative Z is the blue goal.
	scoringTeam := TeamOrange
	goalSign := -1
	if ball.Position.Z > 0 {
		world.BlueScore++
		scoringTeam = TeamBlue
		goalSign = 1
	} else {
		world.OrangeScore++
	}
	world.recordGoal(scoringTeam, goalSign)
	return true
}

func (world *World) detectBasketballGoal() bool {
	ball := &world.Ball
	if ball.Velocity.Y >= -0.05 {
		return false
	}
	for _, sign := range []int{-1, 1} {
		hoop := basketballHoopFor(world.Config, sign)
		// Hoops only score on a downward pass through the rim plane. This avoids
		// counting shots that rise through the basket from underneath.
		if world.PreviousBallPosition.Y <= hoop.Center.Y || ball.Position.Y > hoop.Center.Y {
			continue
		}
		dx := ball.Position.X - hoop.Center.X
		dz := ball.Position.Z - hoop.Center.Z
		if math.Hypot(dx, dz) > basketballScoreRadius(world.Config) {
			continue
		}

		scoringTeam := TeamOrange
		if sign > 0 {
			world.BlueScore++
			scoringTeam = TeamBlue
		} else {
			world.OrangeScore++
		}
		world.recordGoal(scoringTeam, sign)
		return true
	}
	return false
}

func (world *World) recordGoal(scoringTeam string, goalSign int) {
	ball := &world.Ball

	// The replay follows the last meaningful car to touch the ball. If there was
	// no recent touch (for example a debug/reset ball rolling in), fall back to a
	// connected player on the scoring team so the replay still has a useful POV.
	world.LastGoalScorer = -1
	maxTouchAge := uint64(math.Max(1, float64(world.Config.PhysicsHz*10)))
	if world.LastBallTouchSlot >= 0 && world.LastBallTouchSlot < len(world.Cars) &&
		world.Cars[world.LastBallTouchSlot].Connected && world.Tick-world.LastBallTouchTick <= maxTouchAge {
		world.LastGoalScorer = world.LastBallTouchSlot
	}
	if world.LastGoalScorer < 0 {
		for index := range world.Cars {
			if world.Cars[index].Connected && TeamForSlot(index) == scoringTeam {
				world.LastGoalScorer = index
				break
			}
		}
	}
	world.LastGoalTick = world.Tick
	world.LastGoalSign = goalSign
	world.LastGoalScoringTeam = scoringTeam
	world.LastGoalPosition = ball.Position
	world.GoalSequence++
	world.GoalLocked = true
	world.applyGoalExplosionKnockback(world.LastGoalSign)
}

// applyGoalExplosionKnockback gives every connected car the same authoritative
// Rocket-League-style blast away from the scored goal. The direction is radial
// in the floor plane and receives a strong upward component so even distant
// cars visibly lift and tumble during the short post-goal celebration.
func (world *World) applyGoalExplosionKnockback(goalSign int) {
	if goalSign == 0 {
		goalSign = 1
	}
	origin := Vec3{
		Y: 3.8,
		Z: float64(goalSign) * (world.Config.Arena.Length*0.5 + 1.4),
	}
	if NormalizeGameMode(world.Config.GameMode) == GameModeBasketball {
		origin = basketballHoopFor(world.Config, goalSign).Center
	}
	for index := range world.Cars {
		car := &world.Cars[index]
		if !car.Connected || car.Demolished {
			continue
		}
		away := Vec3{X: car.Position.X - origin.X, Z: car.Position.Z - origin.Z}
		if away.LengthSquared() < 1e-8 {
			away = Vec3{Z: -float64(goalSign)}
		}
		away = away.NormalizeOr(Vec3{Z: -float64(goalSign)})
		car.Velocity = away.Mul(29.5).Add(Vec3{Y: 13.0})
		spinSign := 1.0
		if index%2 == 1 {
			spinSign = -1
		}
		car.AngularVelocity = Vec3{
			X: 4.4 + float64(index)*0.35,
			Y: spinSign * (2.0 + float64(index)*0.18),
			Z: -spinSign * (4.8 + float64(index)*0.30),
		}
		car.Grounded = false
		car.GroundLockout = math.Max(car.GroundLockout, 0.40)
		car.JumpHoldActive = false
		car.DodgeAngleRemaining = 0
		car.DodgeTime = 0
	}
	world.Ball.Velocity = Vec3{}
	world.Ball.AngularVelocity = Vec3{}
}

func stateFromBody(body Body) EntityState {
	return EntityState{
		Position:        body.Position,
		Rotation:        body.Rotation,
		Velocity:        body.Velocity,
		AngularVelocity: body.AngularVelocity,
	}
}

func bodyIsFinite(body Body) bool {
	return body.Position.IsFinite() &&
		body.Velocity.IsFinite() &&
		body.AngularVelocity.IsFinite() &&
		isFinite(body.Rotation.X) && isFinite(body.Rotation.Y) &&
		isFinite(body.Rotation.Z) && isFinite(body.Rotation.W)
}

func boolValue(value bool) float64 {
	if value {
		return 1
	}
	return 0
}
