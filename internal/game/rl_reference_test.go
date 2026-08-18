package game

import (
	"math"
	"testing"
)

func closeReference(t *testing.T, label string, got, want, tolerance float64) {
	t.Helper()
	if math.Abs(got-want) > tolerance {
		t.Fatalf("%s = %.12f, want %.12f (+/- %.3g)", label, got, want, tolerance)
	}
}

func TestRLBotReferenceDefaults(t *testing.T) {
	config := DefaultConfig()
	if config.PhysicsHz != 120 {
		t.Fatalf("physics tick rate = %d, want 120 Hz", config.PhysicsHz)
	}
	closeReference(t, "gravity", config.Gravity, 6.50, 1e-12)
	closeReference(t, "side wall", config.Arena.Width/2, 40.96, 1e-12)
	closeReference(t, "back wall", config.Arena.Length/2, 51.20, 1e-12)
	closeReference(t, "ceiling", config.Arena.Ceiling, 20.44, 1e-12)
	closeReference(t, "corner radius", config.Arena.CornerRadius, 11.52, 1e-12)
	closeReference(t, "side straight length", config.Arena.Length-2*config.Arena.CornerRadius, 79.36, 1e-12)
	closeReference(t, "back straight length", config.Arena.Width-2*config.Arena.CornerRadius, 58.88, 1e-12)
	closeReference(t, "corner wall length", config.Arena.CornerRadius*math.Sqrt2, 16.29174, 1e-6)
	closeReference(t, "goal height", config.Arena.GoalHeight, 6.42775, 1e-12)
	closeReference(t, "goal center-to-post", config.Arena.GoalWidth/2, 8.92755, 1e-12)
	closeReference(t, "goal depth", config.Arena.GoalDepth, 8.80, 1e-12)

	closeReference(t, "car mass", config.Car.Mass, 180, 1e-12)
	closeReference(t, "Octane rest elevation", config.Car.HalfExtents.Y, 0.1701, 1e-12)
	closeReference(t, "throttle speed", config.Car.MaxGroundSpeed, 14.10, 1e-12)
	closeReference(t, "boost speed", config.Car.MaxBoostSpeed, 23.00, 1e-12)
	closeReference(t, "supersonic speed", config.Car.SupersonicSpeed, 22.00, 1e-12)
	closeReference(t, "ground boost acceleration", config.Car.BoostAcceleration, 9.91666, 1e-12)
	closeReference(t, "air boost acceleration", config.Car.AirBoostAcceleration, 10.58333, 1e-12)
	closeReference(t, "braking", config.Car.BrakeAcceleration, 35, 1e-12)
	closeReference(t, "coasting", config.Car.CoastDeceleration, 5.25, 1e-12)
	closeReference(t, "air throttle", config.Car.AirThrottleAcceleration, 0.66667, 1e-12)
	closeReference(t, "air reverse", config.Car.AirReverseAcceleration, 0.33334, 1e-12)
	closeReference(t, "jump impulse", config.Car.JumpSpeed, 2.92, 1e-12)
	closeReference(t, "jump hold acceleration", config.Car.JumpHoldAcceleration, 14.6, 1e-12)
	closeReference(t, "double jump impulse", config.Car.DoubleJumpSpeed, 2.91667, 1e-12)
	closeReference(t, "yaw acceleration", config.Car.AirYawAcceleration, 9.11, 1e-12)
	closeReference(t, "pitch acceleration", config.Car.AirPitchAcceleration, 12.46, 1e-12)
	closeReference(t, "roll acceleration", config.Car.AirRollAcceleration, 38.34, 1e-12)
	closeReference(t, "maximum angular speed", config.Car.MaxAirAngular, 5.5, 1e-12)

	closeReference(t, "ball radius", config.Ball.Radius, 0.9125, 1e-12)
	closeReference(t, "ball resting height", config.Ball.RestingHeight, 0.9315, 1e-12)
	closeReference(t, "ball mass", config.Ball.Mass, 30, 1e-12)
	closeReference(t, "ball restitution", config.Ball.Restitution, 0.60, 1e-12)
	closeReference(t, "ball max speed", config.Ball.MaxSpeed, 60, 1e-12)
	closeReference(t, "ball terminal speed", RLBallTerminalSpeed, 212.68220703125, 1e-12)
	closeReference(t, "terminal speed from gravity and drag", RLGravity/RLBallLinearDrag, RLBallTerminalSpeed, 1e-9)
	closeReference(t, "ball max angular speed", config.Ball.MaxAngularSpeed, 6, 1e-12)
	closeReference(t, "ball drag", config.Ball.LinearDamping, RLBallLinearDrag, 1e-15)
	closeReference(t, "small boost", config.BoostPads.SmallAmount, 12, 1e-12)
	closeReference(t, "small respawn", config.BoostPads.SmallRespawnSeconds, 4, 1e-12)
	closeReference(t, "full boost", config.BoostPads.FullAmount, 100, 1e-12)
	closeReference(t, "full respawn", config.BoostPads.FullRespawnSeconds, 10, 1e-12)
}

func TestArenaCornersUseDocumentedFortyFiveDegreePlanes(t *testing.T) {
	config := DefaultConfig()
	halfWidth := config.Arena.Width * 0.5
	halfLength := config.Arena.Length * 0.5
	straightX := halfWidth - config.Arena.CornerRadius
	straightZ := halfLength - config.Arena.CornerRadius

	// Both endpoints sit on x+z=80.64 m, matching the 8064 uu axis
	// intercept and the published straight-wall lengths.
	for _, point := range []Vec3{
		{X: halfWidth, Z: straightZ},
		{X: straightX, Z: halfLength},
		{X: -halfWidth, Z: -straightZ},
	} {
		boundary, ok := nearestArenaBoundary(point, config.Arena, false)
		if !ok {
			t.Fatalf("corner endpoint had no boundary: %+v", point)
		}
		closeReference(t, "corner endpoint distance", boundary.Distance, 0, 1e-12)
	}

	boundary, ok := nearestArenaBoundary(Vec3{X: 40, Z: 50}, config.Arena, false)
	if !ok {
		t.Fatal("diagonal corner boundary was not found")
	}
	closeReference(t, "corner plane distance", boundary.Distance, (80.64-90)/math.Sqrt2, 1e-12)
	closeReference(t, "corner normal x", boundary.Outward.X, 1/math.Sqrt2, 1e-12)
	closeReference(t, "corner normal z", boundary.Outward.Z, 1/math.Sqrt2, 1e-12)
}

func TestAllRLBotBoostPadCoordinatesAndHitboxes(t *testing.T) {
	expected := [BoostPadCount]struct {
		x, z float64
		full bool
	}{
		{0, -42.40, false}, {-17.92, -41.84, false}, {17.92, -41.84, false},
		{-30.72, -40.96, true}, {30.72, -40.96, true}, {-9.40, -33.08, false},
		{9.40, -33.08, false}, {0, -28.16, false}, {-35.84, -24.84, false},
		{35.84, -24.84, false}, {-17.88, -23.00, false}, {17.88, -23.00, false},
		{-20.48, -10.36, false}, {0, -10.24, false}, {20.48, -10.36, false},
		{-35.84, 0, true}, {-10.24, 0, false}, {10.24, 0, false}, {35.84, 0, true},
		{-20.48, 10.36, false}, {0, 10.24, false}, {20.48, 10.36, false},
		{-17.88, 23.00, false}, {17.88, 23.00, false}, {-35.84, 24.84, false},
		{35.84, 24.84, false}, {0, 28.16, false}, {-9.40, 33.08, false},
		{9.40, 33.08, false}, {-30.72, 40.96, true}, {30.72, 40.96, true},
		{-17.92, 41.84, false}, {17.92, 41.84, false}, {0, 42.40, false},
	}

	world := NewWorld(DefaultConfig())
	for index, want := range expected {
		pad := world.BoostPads[index]
		closeReference(t, "pad x", pad.Position.X, want.x, 1e-12)
		closeReference(t, "pad z", pad.Position.Z, want.z, 1e-12)
		if pad.Full != want.full {
			t.Fatalf("pad %d full=%v, want %v", index, pad.Full, want.full)
		}
		if want.full {
			closeReference(t, "full radius", pad.Radius, 2.08, 1e-12)
			closeReference(t, "full height", pad.Height, 1.68, 1e-12)
		} else {
			closeReference(t, "small radius", pad.Radius, 1.44, 1e-12)
			closeReference(t, "small height", pad.Height, 1.65, 1e-12)
		}
	}
}

func TestRLBotSpawnLocationsAndYawConversion(t *testing.T) {
	expectedKickoff := [MaxPlayers]struct {
		x, z, yaw float64
	}{
		{20.48, 25.60, math.Pi / 4}, {-20.48, -25.60, -3 * math.Pi / 4},
		{-20.48, 25.60, -math.Pi / 4}, {20.48, -25.60, 3 * math.Pi / 4},
		{2.56, 38.40, 0}, {-2.56, -38.40, math.Pi},
		{-2.56, 38.40, 0}, {2.56, -38.40, math.Pi},
	}
	for index, want := range expectedKickoff {
		closeReference(t, "kickoff x", playerSpawns[index].Position.X, want.x, 1e-12)
		closeReference(t, "kickoff z", playerSpawns[index].Position.Z, want.z, 1e-12)
		closeReference(t, "kickoff yaw", playerSpawns[index].Yaw, want.yaw, 1e-12)
	}

	blue := RespawnPointsForSlot(1)
	orange := RespawnPointsForSlot(0)
	blueX := [4]float64{-23.04, -26.88, 23.04, 26.88}
	orangeX := [4]float64{23.04, 26.88, -23.04, -26.88}
	for index := range blue {
		closeReference(t, "blue demo x", blue[index].Position.X, blueX[index], 1e-12)
		closeReference(t, "blue demo z", blue[index].Position.Z, -46.08, 1e-12)
		closeReference(t, "blue demo yaw", blue[index].Yaw, math.Pi, 1e-12)
		closeReference(t, "orange demo x", orange[index].Position.X, orangeX[index], 1e-12)
		closeReference(t, "orange demo z", orange[index].Position.Z, 46.08, 1e-12)
		closeReference(t, "orange demo yaw", orange[index].Yaw, 0, 1e-12)
	}
}

func TestMeasuredThrottleAndTurningCurves(t *testing.T) {
	throttleCases := []struct{ speed, acceleration float64 }{
		{0, 16}, {5, 10.857142857142858}, {10, 5.714285714285714},
		{14, 1.6}, {14.05, 0.8}, {14.10, 0}, {-10, 5.714285714285714},
	}
	for _, testCase := range throttleCases {
		closeReference(t, "throttle curve", throttleAccelerationAtSpeed(testCase.speed), testCase.acceleration, 1e-10)
	}

	curvatureCases := []struct{ speed, curvature float64 }{
		{0, 0.6900}, {5, 0.3980}, {10, 0.2350}, {15, 0.1375}, {17.5, 0.1100}, {23, 0.0880},
	}
	for _, testCase := range curvatureCases {
		closeReference(t, "curvature", turningCurvatureAtSpeed(testCase.speed), testCase.curvature, 1e-10)
	}
	closeReference(t, "turn radius at 1000 uu/s", 1/turningCurvatureAtSpeed(10), 4.25531914893617, 1e-10)
	closeReference(t, "turn angular speed at 1000 uu/s", turningAngularSpeed(10, 1), 2.35, 1e-12)
}

func TestFullSteerAccelerationAndDecelerationTraces(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	car := &world.Cars[0]
	car.GroundNormal = Vec3{Y: 1}
	dt := 1 / float64(config.PhysicsHz)
	forward := Vec3{Z: -1}
	right := Vec3{X: 1}
	for range config.PhysicsHz * 5 {
		world.applyGroundDrive(car, forward, right, 1, 1, false, false, dt)
	}
	want := RLFullSteerSpeed * (1 - math.Exp(-5/RLFullSteerTimeConstant))
	closeReference(t, "five-second full-steer speed", math.Abs(car.Velocity.Z), want, 0.01)

	car.Velocity = Vec3{Z: -RLCarMaxSpeed}
	for range int(7.6 * float64(config.PhysicsHz)) {
		world.applyGroundDrive(car, forward, right, 1, 1, false, false, dt)
	}
	closeReference(t, "settled full-steer speed", math.Abs(car.Velocity.Z), RLFullSteerSpeed, 0.02)
}

func TestReferenceJumpImpulseHoldAndStickyForce(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{X: 10, Y: config.Car.HalfExtents.Y, Z: 10}
	car.Rotation = IdentityQuat()
	car.Grounded = true
	car.GroundNormal = Vec3{Y: 1}
	world.SetInput(0, Input{Sequence: 1, Mask: InputJump, Edges: EdgeJump})
	dt := 1 / float64(config.PhysicsHz)
	world.Step(dt)
	wantFirstTick := RLJumpImpulse + (RLJumpHoldAcceleration-RLJumpStickyAcceleration-RLGravity)*dt
	closeReference(t, "first jump tick velocity", car.Velocity.Y, wantFirstTick, 1e-9)

	for range config.PhysicsHz/5 - 1 {
		world.Step(dt)
	}
	wantAfterHold := RLJumpImpulse + RLJumpHoldAcceleration*RLJumpHoldDuration -
		RLJumpStickyAcceleration*RLJumpStickyDuration - RLGravity*RLJumpHoldDuration
	closeReference(t, "held jump velocity after 0.2s", car.Velocity.Y, wantAfterHold, 1e-8)
	closeReference(t, "held jump duration", car.JumpHoldTime, RLJumpHoldDuration, 1e-12)
}

func TestBallRestitutionDragAndSafetyCaps(t *testing.T) {
	config := DefaultConfig()
	ball := Ball{Body: Body{Position: Vec3{Y: 0.5}, Velocity: Vec3{Y: -10}}}
	resolveBallFlatFloor(&ball, config)
	closeReference(t, "resting height", ball.Position.Y, RLBallRestingHeight, 1e-12)
	closeReference(t, "ten metre bounce", ball.Velocity.Y, 6, 1e-12)

	world := NewWorld(config)
	world.Config.Gravity = 0
	world.Ball.Position = Vec3{Y: 10}
	world.Ball.Velocity = Vec3{X: 10}
	dt := 1 / float64(config.PhysicsHz)
	for range config.PhysicsHz {
		world.Step(dt)
	}
	closeReference(t, "one-second linear drag", world.Ball.Velocity.X, 10*math.Exp(-RLBallLinearDrag), 1e-9)

	falling := NewWorld(config)
	falling.Ball.Position = Vec3{Y: 100}
	falling.Ball.Velocity = Vec3{}
	for range config.PhysicsHz {
		falling.stepBall(dt)
	}
	expectedFallSpeed := -RLGravity / RLBallLinearDrag * (1 - math.Exp(-RLBallLinearDrag))
	closeReference(t, "one-second gravity and drag fall speed", falling.Ball.Velocity.Y, expectedFallSpeed, 0.002)
	if falling.Ball.Position.Y < 96.7 || falling.Ball.Position.Y > 96.8 {
		t.Fatalf("one-second fall height = %.6f, want a realistic 3.2-3.3 m drop", falling.Ball.Position.Y)
	}

	world.Ball.Velocity = Vec3{X: 100}
	world.Ball.AngularVelocity = Vec3{Y: 20}
	world.Step(dt)
	closeReference(t, "ball speed cap", world.Ball.Velocity.Length(), RLBallMaxSpeed, 1e-9)
	closeReference(t, "ball angular cap", world.Ball.AngularVelocity.Length(), RLBallMaxAngularSpeed, 1e-9)
}
