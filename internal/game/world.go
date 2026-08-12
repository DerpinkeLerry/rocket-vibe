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

	InputFlagDrift uint8 = 1 << 0

	EdgeJump      uint8 = 1 << 0
	EdgeReset     uint8 = 1 << 1
	EdgeBallReset uint8 = 1 << 2

	TeamOrange = "orange"
	TeamBlue   = "blue"

	BoostPadCount = 16
)

type Input struct {
	Sequence uint32
	Mask     uint8
	Edges    uint8
	Flags    uint8
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
	AirTime             float64 `json:"-"`
	GroundLockout       float64 `json:"-"`
	DodgeTime           float64 `json:"-"`
	DodgeAngleRemaining float64 `json:"-"`
	DodgeAxis           Vec3    `json:"-"`
	DodgePitchLock      float64 `json:"-"`
	DodgeYawLock        float64 `json:"-"`
	Boost               float64 `json:"boost"`
	GroundNormal        Vec3    `json:"-"`
}

type BoostPad struct {
	Position       Vec3
	Amount         float64
	Radius         float64
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
	Tick          uint64                  `json:"tick"`
	ConnectedMask uint8                   `json:"connectedMask"`
	GroundMask    uint8                   `json:"groundMask"`
	OrangeScore   uint16                  `json:"orangeScore"`
	BlueScore     uint16                  `json:"blueScore"`
	Boost         [MaxPlayers]uint8       `json:"boost"`
	BoostPadMask  uint16                  `json:"boostPadMask"`
	Cars          [MaxPlayers]EntityState `json:"cars"`
	Ball          EntityState             `json:"ball"`
}

type World struct {
	Config      Config
	Cars        [MaxPlayers]Car
	Ball        Ball
	Tick        uint64
	OrangeScore uint16
	BlueScore   uint16
	BoostPads   [BoostPadCount]BoostPad
}

func TeamForSlot(slot int) string {
	if slot%2 == 0 {
		return TeamOrange
	}
	return TeamBlue
}

var playerSpawns = [MaxPlayers]struct {
	Position Vec3
	Yaw      float64
}{
	{Position: Vec3{X: -13, Y: 0.52, Z: 44}, Yaw: 0},
	{Position: Vec3{X: -13, Y: 0.52, Z: -44}, Yaw: math.Pi},
	{Position: Vec3{X: 13, Y: 0.52, Z: 44}, Yaw: 0},
	{Position: Vec3{X: 13, Y: 0.52, Z: -44}, Yaw: math.Pi},
}

var boostPadSpecs = [BoostPadCount]BoostPad{
	{Position: Vec3{X: -43, Z: -68}, Amount: 100, Radius: 2.8, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: 43, Z: -68}, Amount: 100, Radius: 2.8, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: -43, Z: 68}, Amount: 100, Radius: 2.8, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: 43, Z: 68}, Amount: 100, Radius: 2.8, RespawnSeconds: 10, Full: true},
	{Position: Vec3{X: -28, Z: -45}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: -52}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 28, Z: -45}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -24, Z: -20}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: -26}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 24, Z: -20}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -24, Z: 20}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: 26}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 24, Z: 20}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: -28, Z: 45}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 0, Z: 52}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
	{Position: Vec3{X: 28, Z: 45}, Amount: 20, Radius: 1.65, RespawnSeconds: 4},
}

func NewWorld(config Config) *World {
	world := &World{Config: config}
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

func (world *World) ResetMatch() {
	world.OrangeScore = 0
	world.BlueScore = 0
	for index := range world.Cars {
		world.resetCar(&world.Cars[index])
	}
	world.resetBoostPads()
	world.resetBall()
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
	input.Flags &= InputFlagDrift
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
		if !car.Connected {
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
	world.stepBall(dt)

	for iteration := 0; iteration < world.Config.SolverSteps; iteration++ {
		for index := range world.Cars {
			car := &world.Cars[index]
			if car.Connected {
				resolveCarArena(car, world.Config)
			}
		}
		resolveBallArena(&world.Ball, world.Config)

		for first := 0; first < len(world.Cars); first++ {
			carA := &world.Cars[first]
			if !carA.Connected {
				continue
			}
			for second := first + 1; second < len(world.Cars); second++ {
				carB := &world.Cars[second]
				if carB.Connected {
					resolveCarCar(carA, carB, world.Config.Car)
				}
			}
			resolveCarBall(carA, &world.Ball, world.Config)
		}
	}
	world.collectBoostPads()
	world.detectGoal()

	for index := range world.Cars {
		car := &world.Cars[index]
		if !car.Connected {
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
	if car.Input.Edges&EdgeReset != 0 {
		world.resetCar(car)
		return
	}

	car.GroundLockout = math.Max(0, car.GroundLockout-dt)
	inputMask := car.Input.Mask
	inputFlags := car.Input.Flags
	if world.Tick-car.LastInputTick > uint64(world.Config.PhysicsHz) {
		inputMask = 0
		inputFlags = 0
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
			normalSpeed := car.Velocity.Dot(groundNormal)
			car.Velocity = car.Velocity.Add(groundNormal.Mul(math.Max(0, config.JumpSpeed-normalSpeed)))
			car.JumpCount = 1
			car.JumpHoldTime = 0
			car.JumpHoldActive = inputMask&InputJump != 0
			car.AirTime = 0
			car.Grounded = false
			car.GroundLockout = 0.16
			driveGrounded = false
		} else if !driveGrounded && car.JumpCount == 1 && car.AirTime <= config.DodgeWindow {
			world.applySecondJumpOrDodge(car, forward, right, up, forwardInput, steerInput)
		}
	}

	// Variable first-jump height. The hold force is available only while the
	// original jump press remains continuously held; once released it cannot be
	// re-armed until the car lands. This keeps the second press free for a dodge.
	if car.JumpCount == 1 && car.JumpHoldActive {
		if inputMask&InputJump == 0 {
			car.JumpHoldActive = false
		} else if car.JumpHoldTime < config.JumpHoldDuration {
			holdDt := math.Min(dt, config.JumpHoldDuration-car.JumpHoldTime)
			car.Velocity = car.Velocity.Add(up.Mul(config.JumpHoldAcceleration * holdDt))
			car.JumpHoldTime += holdDt
			if car.JumpHoldTime >= config.JumpHoldDuration-1e-9 {
				car.JumpHoldActive = false
			}
		}
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
	// Diagonals blend both axes and normalize so every dodge has the same power.
	dodgeDirection := forward.Mul(forwardAmount).Add(right.Mul(-sideAmount)).NormalizeOr(forward)
	car.Velocity = car.Velocity.
		Add(dodgeDirection.Mul(config.DodgeImpulse)).
		Add(up.NormalizeOr(Vec3{Y: 1}).Mul(config.DodgeLift))

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
	tangentSpeed := math.Hypot(forwardSpeed, lateralSpeed)
	reverseTarget := -config.MaxGroundSpeed * 0.68
	opposing := throttle != 0 && math.Abs(forwardSpeed) > 0.05 && math.Signbit(throttle) != math.Signbit(forwardSpeed)

	nextForward := forwardSpeed
	if opposing {
		brakeTarget := config.MaxGroundSpeed
		if throttle < 0 {
			brakeTarget = reverseTarget
		}
		nextForward = moveTowards(forwardSpeed, brakeTarget, config.BrakeAcceleration*dt)
	} else if throttle > 0 {
		// Normal throttle accelerates to 70 km/h but intentionally preserves
		// any speed already earned with boost up to the 100 km/h hard cap.
		if forwardSpeed < config.MaxGroundSpeed {
			nextForward = moveTowards(forwardSpeed, config.MaxGroundSpeed, config.DriveAcceleration*dt)
		}
	} else if throttle < 0 {
		nextForward = moveTowards(forwardSpeed, reverseTarget, config.ReverseAcceleration*dt)
	} else if forwardSpeed <= config.MaxGroundSpeed+0.01 {
		// Ordinary coasting still slows the car below cruise speed. Once boost
		// has pushed it past cruise speed, momentum stays until something else
		// (braking, collision, turning losses) actually reduces it.
		nextForward = moveTowards(forwardSpeed, 0, config.CoastDeceleration*dt)
	}
	if boosting {
		nextForward = moveTowards(nextForward, config.MaxBoostSpeed, config.BoostAcceleration*dt)
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

	steerStrength := clamp(math.Max(math.Abs(nextForward), 1.5)/7, 0.18, 1) * clamp(1-tangentSpeed/70, 0.48, 1)
	reverseSign := 1.0
	if nextForward < -0.01 || (math.Abs(nextForward) <= 0.01 && throttle < 0) {
		reverseSign = -1
	}
	steerRate := config.SteerRate
	steerResponse := config.SteerResponse
	driftStrength := steerStrength
	if drifting {
		steerRate = config.DriftSteerRate
		steerResponse = config.DriftSteerResponse
		driftStrength = math.Max(0.72, steerStrength)
	}
	targetYaw := steer * steerRate * driftStrength * reverseSign
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
	controlScale := 1.0
	maximumAngular := config.MaxAirAngular
	if car.DodgeAngleRemaining > 1e-9 {
		controlScale = config.DodgeControlScale
		maximumAngular = math.Max(maximumAngular, config.DodgeAngularSpeed)
	}
	car.AngularVelocity = car.AngularVelocity.
		Add(right.Mul(-pitch * config.AirPitchAcceleration * controlScale * dt)).
		Add(up.Mul(yaw * config.AirYawAcceleration * controlScale * dt)).
		Add(forward.Mul(roll * config.AirRollAcceleration * controlScale * dt))
	car.AngularVelocity = clampMagnitude(car.AngularVelocity, maximumAngular)

	if boosting {
		car.Velocity = car.Velocity.Add(forward.Mul(config.BoostAcceleration * dt))
		car.Velocity = clampMagnitude(car.Velocity, config.MaxBoostSpeed)
	}
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
		if !car.Connected || car.Position.Y > 2.45 {
			continue
		}
		for padIndex := range world.BoostPads {
			pad := &world.BoostPads[padIndex]
			if !pad.Active {
				continue
			}
			dx := car.Position.X - pad.Position.X
			dz := car.Position.Z - pad.Position.Z
			if dx*dx+dz*dz > pad.Radius*pad.Radius {
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
	car.Body = Body{Position: spawn.Position, Rotation: QuatFromYaw(spawn.Yaw)}
	car.Input = Input{}
	car.LastInputTick = world.Tick
	car.Grounded = false
	car.JumpCount = 0
	car.JumpHoldTime = 0
	car.JumpHoldActive = false
	car.AirTime = 0
	car.GroundLockout = 0
	car.DodgeTime = 0
	car.DodgeAngleRemaining = 0
	car.DodgeAxis = Vec3{}
	car.DodgePitchLock = 0
	car.DodgeYawLock = 0
	car.Boost = world.Config.Car.BoostCapacity
	car.GroundNormal = Vec3{Y: 1}
}

func (world *World) resetBall() {
	world.Ball.Body = Body{
		Position: Vec3{Y: world.Config.Ball.SpawnY},
		Rotation: IdentityQuat(),
	}
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
	halfLength := world.Config.Arena.Length * 0.5
	ball := &world.Ball
	if math.Abs(ball.Position.Z) <= halfLength+world.Config.Ball.Radius*0.35 {
		return false
	}
	if math.Abs(ball.Position.X)+world.Config.Ball.Radius > world.Config.Arena.GoalWidth*0.5 ||
		ball.Position.Y+world.Config.Ball.Radius > world.Config.Arena.GoalHeight {
		return false
	}

	// Positive Z is the orange goal; negative Z is the blue goal.
	if ball.Position.Z > 0 {
		world.BlueScore++
	} else {
		world.OrangeScore++
	}
	for index := range world.Cars {
		if world.Cars[index].Connected {
			world.resetCar(&world.Cars[index])
		}
	}
	world.resetBoostPads()
	world.resetBall()
	return true
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
