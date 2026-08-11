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

	EdgeJump      uint8 = 1 << 0
	EdgeReset     uint8 = 1 << 1
	EdgeBallReset uint8 = 1 << 2
)

type Input struct {
	Sequence uint32
	Mask     uint8
	Edges    uint8
}

type Body struct {
	Position        Vec3 `json:"position"`
	Rotation        Quat `json:"rotation"`
	Velocity        Vec3 `json:"velocity"`
	AngularVelocity Vec3 `json:"angularVelocity"`
}

type Car struct {
	Body
	Connected     bool    `json:"connected"`
	Grounded      bool    `json:"grounded"`
	Slot          int     `json:"slot"`
	Input         Input   `json:"-"`
	LastInputTick uint64  `json:"-"`
	JumpCount     int     `json:"-"`
	AirTime       float64 `json:"-"`
	GroundLockout float64 `json:"-"`
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
	Cars          [MaxPlayers]EntityState `json:"cars"`
	Ball          EntityState             `json:"ball"`
}

type World struct {
	Config Config
	Cars   [MaxPlayers]Car
	Ball   Ball
	Tick   uint64
}

var playerSpawns = [MaxPlayers]struct {
	Position Vec3
	Yaw      float64
}{
	{Position: Vec3{X: -13, Y: 1.25, Z: 44}, Yaw: 0},
	{Position: Vec3{X: -13, Y: 1.25, Z: -44}, Yaw: math.Pi},
	{Position: Vec3{X: 13, Y: 1.25, Z: 44}, Yaw: 0},
	{Position: Vec3{X: 13, Y: 1.25, Z: -44}, Yaw: math.Pi},
}

func NewWorld(config Config) *World {
	world := &World{Config: config}
	for slot := range world.Cars {
		world.Cars[slot].Slot = slot
		world.resetCar(&world.Cars[slot])
	}
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

func (world *World) SetInput(slot int, input Input) bool {
	if slot < 0 || slot >= len(world.Cars) {
		return false
	}
	car := &world.Cars[slot]
	if !car.Connected || !sequenceIsNewer(input.Sequence, car.Input.Sequence) {
		return false
	}
	input.Mask &= 0x7f
	input.Edges &= 0x07
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
	if world.Tick-car.LastInputTick > uint64(world.Config.PhysicsHz) {
		inputMask = 0
	}

	config := world.Config.Car
	rotation := car.Rotation.Normalize()
	forward := rotation.Rotate(Vec3{Z: -1}).NormalizeOr(Vec3{Z: -1})
	right := rotation.Rotate(Vec3{X: 1}).NormalizeOr(Vec3{X: 1})
	up := rotation.Rotate(Vec3{Y: 1}).NormalizeOr(Vec3{Y: 1})
	nearFloor := car.Position.Y < 1.55 && up.Y > 0.35 && math.Abs(car.Velocity.Y) < 6.5
	driveGrounded := car.GroundLockout <= 0 && (car.Grounded || nearFloor)

	forwardInput := boolValue(inputMask&InputW != 0) - boolValue(inputMask&InputS != 0)
	steerInput := boolValue(inputMask&InputA != 0) - boolValue(inputMask&InputD != 0)
	rollInput := boolValue(inputMask&InputQ != 0) - boolValue(inputMask&InputE != 0)
	boosting := inputMask&InputBoost != 0

	if driveGrounded {
		world.applyGroundDrive(car, forward, right, forwardInput, steerInput, boosting, dt)
		car.AirTime = 0
	} else {
		world.applyAirControl(car, forward, right, up, forwardInput, steerInput, rollInput, boosting, dt)
		car.AirTime += dt
	}

	if car.Input.Edges&EdgeJump != 0 {
		if driveGrounded && car.JumpCount == 0 {
			car.Velocity.Y = math.Max(car.Velocity.Y, config.JumpSpeed)
			car.JumpCount = 1
			car.Grounded = false
			car.GroundLockout = 0.18
		} else if !driveGrounded && car.JumpCount == 1 && car.AirTime < 1.4 {
			car.Velocity.Y += config.DoubleJumpSpeed
			car.JumpCount = 2
		}
	}

	if driveGrounded {
		car.Velocity.Y -= config.DownAcceleration * dt
	}
	car.Velocity.Y -= world.Config.Gravity * dt
	car.Velocity = car.Velocity.Mul(math.Exp(-config.LinearDamping * dt))
	car.AngularVelocity = car.AngularVelocity.Mul(math.Exp(-config.AngularDamping * dt))
	car.Velocity = clampMagnitude(car.Velocity, config.MaxBoostSpeed*1.35)
	car.Position = car.Position.Add(car.Velocity.Mul(dt))
	car.Rotation = car.Rotation.Integrate(car.AngularVelocity, dt)
}

func (world *World) applyGroundDrive(car *Car, forward, right Vec3, throttle, steer float64, boosting bool, dt float64) {
	config := world.Config.Car
	forward.Y = 0
	right.Y = 0
	forward = forward.NormalizeOr(Vec3{Z: -1})
	right = right.NormalizeOr(Vec3{X: 1})

	forwardSpeed := car.Velocity.Dot(forward)
	lateralSpeed := car.Velocity.Dot(right)
	flatSpeed := math.Hypot(car.Velocity.X, car.Velocity.Z)
	maximumSpeed := config.MaxGroundSpeed
	if boosting {
		maximumSpeed = config.MaxBoostSpeed
	}
	targetForward := throttle * maximumSpeed
	if throttle < 0 {
		targetForward = throttle * config.MaxGroundSpeed * 0.68
	}
	acceleration := config.DriveAcceleration
	if throttle < 0 {
		acceleration = config.ReverseAcceleration
	}
	if throttle != 0 && math.Signbit(throttle) != math.Signbit(forwardSpeed) && math.Abs(forwardSpeed) > 0.05 {
		acceleration = config.BrakeAcceleration
	}

	nextForward := forwardSpeed
	if throttle != 0 {
		nextForward = moveTowards(forwardSpeed, targetForward, acceleration*dt)
	} else {
		nextForward = moveTowards(forwardSpeed, 0, config.CoastDeceleration*dt)
	}
	if boosting {
		nextForward = moveTowards(nextForward, config.MaxBoostSpeed, config.BoostAcceleration*dt)
	}
	nextLateral := lateralSpeed * math.Exp(-config.Grip*dt)
	car.Velocity.X = forward.X*nextForward + right.X*nextLateral
	car.Velocity.Z = forward.Z*nextForward + right.Z*nextLateral

	steerStrength := clamp(math.Max(math.Abs(nextForward), 1.5)/7, 0.18, 1) * clamp(1-flatSpeed/62, 0.38, 1)
	reverseSign := 1.0
	if nextForward < -0.01 || (math.Abs(nextForward) <= 0.01 && throttle < 0) {
		reverseSign = -1
	}
	targetYaw := steer * config.SteerRate * steerStrength * reverseSign
	car.AngularVelocity.X = damp(car.AngularVelocity.X, 0, config.GroundAngularDamping, dt)
	car.AngularVelocity.Y = damp(car.AngularVelocity.Y, targetYaw, config.SteerResponse, dt)
	car.AngularVelocity.Z = damp(car.AngularVelocity.Z, 0, config.GroundAngularDamping, dt)
}

func (world *World) applyAirControl(car *Car, forward, right, up Vec3, pitch, yaw, roll float64, boosting bool, dt float64) {
	config := world.Config.Car
	car.AngularVelocity = car.AngularVelocity.
		Add(right.Mul(-pitch * config.AirPitchAcceleration * dt)).
		Add(up.Mul(yaw * config.AirYawAcceleration * dt)).
		Add(forward.Mul(roll * config.AirRollAcceleration * dt))
	car.AngularVelocity = clampMagnitude(car.AngularVelocity, config.MaxAirAngular)

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
	forward := car.Rotation.Rotate(Vec3{Z: -1})
	yaw := math.Atan2(-forward.X, -forward.Z)
	target := QuatFromYaw(yaw)
	car.Rotation = car.Rotation.NLerp(target, 1-math.Exp(-8*dt))
	car.AngularVelocity.X *= math.Exp(-8 * dt)
	car.AngularVelocity.Z *= math.Exp(-8 * dt)
	car.JumpCount = 0
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

func (world *World) resetCar(car *Car) {
	spawn := playerSpawns[car.Slot]
	car.Body = Body{Position: spawn.Position, Rotation: QuatFromYaw(spawn.Yaw)}
	car.Input = Input{}
	car.LastInputTick = world.Tick
	car.Grounded = false
	car.JumpCount = 0
	car.AirTime = 0
	car.GroundLockout = 0
}

func (world *World) resetBall() {
	world.Ball.Body = Body{
		Position: Vec3{Y: world.Config.Ball.SpawnY},
		Rotation: IdentityQuat(),
	}
}

func (world *World) Snapshot() Snapshot {
	snapshot := Snapshot{Tick: world.Tick}
	for index := range world.Cars {
		car := &world.Cars[index]
		if car.Connected {
			snapshot.ConnectedMask |= 1 << index
		}
		if car.Grounded {
			snapshot.GroundMask |= 1 << index
		}
		snapshot.Cars[index] = stateFromBody(car.Body)
	}
	snapshot.Ball = stateFromBody(world.Ball.Body)
	return snapshot
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
