package game

import (
	"math"
	"testing"
)

func TestYawQuaternionUsesThreeJSForwardAxis(t *testing.T) {
	forward := QuatFromYaw(math.Pi).Rotate(Vec3{Z: -1})
	if math.Abs(forward.X) > 1e-9 || math.Abs(forward.Y) > 1e-9 || math.Abs(forward.Z-1) > 1e-9 {
		t.Fatalf("unexpected forward vector: %+v", forward)
	}
}

func TestConnectedCarDrivesAndRemainsSpeedLimited(t *testing.T) {
	world := NewWorld(DefaultConfig())
	world.SetConnected(0, true)
	if !world.SetInput(0, Input{Sequence: 1, Mask: InputW | InputBoost}) {
		t.Fatal("input was not accepted")
	}
	for range world.Config.PhysicsHz * 3 {
		world.Step(1 / float64(world.Config.PhysicsHz))
	}
	car := world.Cars[0]
	if car.Position.Z >= playerSpawns[0].Position.Z-2 {
		t.Fatalf("car did not drive forward: z=%f", car.Position.Z)
	}
	if speed := car.Velocity.Length(); speed > world.Config.Car.MaxBoostSpeed+1e-6 {
		t.Fatalf("car exceeded 120 km/h speed cap: %f", speed)
	}
}

func TestNormalAndBoostTopSpeedsMatchRequestedKmh(t *testing.T) {
	config := DefaultConfig()
	if math.Abs(config.Car.MaxGroundSpeed*3.6-70) > 1e-9 {
		t.Fatalf("normal top speed is %.3f km/h, want 70", config.Car.MaxGroundSpeed*3.6)
	}
	if math.Abs(config.Car.MaxBoostSpeed*3.6-120) > 1e-9 {
		t.Fatalf("boost top speed is %.3f km/h, want 120", config.Car.MaxBoostSpeed*3.6)
	}

	world := NewWorld(config)
	world.SetConnected(0, true)
	if !world.SetInput(0, Input{Sequence: 1, Mask: InputW}) {
		t.Fatal("normal drive input was not accepted")
	}
	dt := 1 / float64(config.PhysicsHz)
	for range config.PhysicsHz * 5 {
		world.Step(dt)
	}
	if speedKmh := world.Cars[0].Velocity.Length() * 3.6; speedKmh > 70.1 {
		t.Fatalf("normal driving exceeded 70 km/h: %.3f", speedKmh)
	}
}

func TestBoostedGroundSpeedPersistsAfterBoostReleaseUntilBraking(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	dt := 1 / float64(config.PhysicsHz)

	sequence := uint32(1)
	if !world.SetInput(0, Input{Sequence: sequence, Mask: InputW | InputBoost}) {
		t.Fatal("boost input was not accepted")
	}
	for step := 0; step < config.PhysicsHz*2; step++ {
		if step > 0 && step%30 == 0 {
			sequence++
			world.SetInput(0, Input{Sequence: sequence, Mask: InputW | InputBoost})
		}
		world.Step(dt)
	}

	before := world.Cars[0].Velocity.Length() * 3.6
	if before < 105 {
		t.Fatalf("car never entered boosted momentum band: %.3f km/h", before)
	}

	for step := 0; step < config.PhysicsHz; step++ {
		if step%30 == 0 {
			sequence++
			world.SetInput(0, Input{Sequence: sequence, Mask: 0})
		}
		world.Step(dt)
	}
	afterCoast := world.Cars[0].Velocity.Length() * 3.6
	if afterCoast < before-1.0 {
		t.Fatalf("boosted momentum decayed after releasing boost/throttle: before=%.3f after=%.3f", before, afterCoast)
	}

	for step := 0; step < config.PhysicsHz/2; step++ {
		if step%30 == 0 {
			sequence++
			world.SetInput(0, Input{Sequence: sequence, Mask: InputS})
		}
		world.Step(dt)
	}
	afterBrake := world.Cars[0].Velocity.Length() * 3.6
	if afterBrake >= afterCoast-8 {
		t.Fatalf("braking did not remove boosted momentum: coast=%.3f brake=%.3f", afterCoast, afterBrake)
	}
}

func TestBoostConsumesFromHundredToZero(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	if !world.SetInput(0, Input{Sequence: 1, Mask: InputBoost}) {
		t.Fatal("boost input was not accepted")
	}
	dt := 1 / float64(config.PhysicsHz)
	sequence := uint32(1)
	for step := 0; step < config.PhysicsHz*3+2; step++ {
		if step > 0 && step%30 == 0 {
			sequence++
			if !world.SetInput(0, Input{Sequence: sequence, Mask: InputBoost}) {
				t.Fatal("boost heartbeat was not accepted")
			}
		}
		world.Step(dt)
		if step == config.PhysicsHz-1 {
			if boost := world.Cars[0].Boost; math.Abs(boost-66.6666667) > 0.4 {
				t.Fatalf("boost after one second is %.3f, want about 66.7", boost)
			}
		}
	}
	if world.Cars[0].Boost > 1e-6 {
		t.Fatalf("boost did not empty: %.9f", world.Cars[0].Boost)
	}
}

func TestSmallAndLargeBoostPadsCollectAndRespawn(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]

	// Small pad gives +20 and should disappear for four seconds.
	car.Boost = 50
	small := &world.BoostPads[4]
	car.Position = Vec3{X: small.Position.X, Y: config.Car.HalfExtents.Y, Z: small.Position.Z}
	world.collectBoostPads()
	if math.Abs(car.Boost-70) > 1e-9 {
		t.Fatalf("small pad gave wrong boost: %.3f", car.Boost)
	}
	if small.Active {
		t.Fatal("small pad remained active after pickup")
	}
	world.Tick = small.RespawnAtTick
	world.refreshBoostPads()
	if !small.Active {
		t.Fatal("small pad did not respawn")
	}

	// Full corner pad fills to 100.
	car.Boost = 12
	large := &world.BoostPads[0]
	car.Position = Vec3{X: large.Position.X, Y: config.Car.HalfExtents.Y, Z: large.Position.Z}
	world.collectBoostPads()
	if car.Boost != config.Car.BoostCapacity {
		t.Fatalf("large pad did not fill boost: %.3f", car.Boost)
	}
	if large.Active {
		t.Fatal("large pad remained active after pickup")
	}
}

func TestFullCarDoesNotConsumeBoostPad(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	pad := &world.BoostPads[4]
	car.Boost = config.Car.BoostCapacity
	car.Position = Vec3{X: pad.Position.X, Y: config.Car.HalfExtents.Y, Z: pad.Position.Z}
	world.collectBoostPads()
	if !pad.Active {
		t.Fatal("full car consumed a boost pad")
	}
}

func TestSnapshotCarriesBoostAndBoostPadMask(t *testing.T) {
	world := NewWorld(DefaultConfig())
	world.SetConnected(0, true)
	world.Cars[0].Boost = 37.4
	world.BoostPads[3].Active = false
	snapshot := world.Snapshot()
	if snapshot.Boost[0] != 37 {
		t.Fatalf("snapshot boost is %d, want 37", snapshot.Boost[0])
	}
	if snapshot.BoostPadMask&(1<<3) != 0 {
		t.Fatal("inactive pad was marked active in snapshot")
	}
	if snapshot.BoostPadMask&(1<<2) == 0 {
		t.Fatal("active pad missing from snapshot mask")
	}
}

func TestBallScoresThroughGoalButHitsSolidEndWall(t *testing.T) {
	config := DefaultConfig()
	dt := 1 / float64(config.PhysicsHz)

	throughGoal := NewWorld(config)
	throughGoal.Ball.Position = Vec3{Y: config.Ball.Radius, Z: config.Arena.Length*0.5 - config.Ball.Radius - 0.1}
	throughGoal.Ball.Velocity = Vec3{Z: 20}
	for range 30 {
		throughGoal.Step(dt)
		if throughGoal.BlueScore > 0 {
			break
		}
	}
	if throughGoal.BlueScore != 1 || throughGoal.OrangeScore != 0 {
		t.Fatalf("positive-Z orange goal did not score for blue: orange=%d blue=%d", throughGoal.OrangeScore, throughGoal.BlueScore)
	}
	if !throughGoal.GoalLocked || throughGoal.LastGoalSign != 1 {
		t.Fatalf("goal celebration did not lock the scored goal: locked=%v sign=%d", throughGoal.GoalLocked, throughGoal.LastGoalSign)
	}
	if throughGoal.Ball.Position.Z <= config.Arena.Length*0.5 {
		t.Fatalf("scoring ball did not remain in the goal for the explosion phase: %+v", throughGoal.Ball.Position)
	}

	endWall := NewWorld(config)
	endWall.Ball.Position = Vec3{X: config.Arena.GoalWidth*0.5 + config.Ball.Radius + 1, Y: config.Ball.Radius, Z: config.Arena.Length*0.5 - config.Ball.Radius - 0.1}
	endWall.Ball.Velocity = Vec3{Z: 20}
	for range 10 {
		endWall.Step(dt)
	}
	if endWall.BlueScore != 0 || endWall.Ball.Position.Z > config.Arena.Length*0.5+config.Ball.Radius {
		t.Fatalf("ball escaped/scored outside the goal opening: p=%+v v=%+v", endWall.Ball.Position, endWall.Ball.Velocity)
	}
	if endWall.Ball.Position.Y <= config.Ball.Radius {
		t.Fatalf("end-wall ramp did not turn ball upward: p=%+v", endWall.Ball.Position)
	}
}

func TestHardLandingCannotTunnelOrBounceBackUp(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{Y: 2.2}
	car.Rotation = IdentityQuat()
	car.Velocity = Vec3{Y: -60}

	dt := 1 / float64(config.PhysicsHz)
	for range 30 {
		world.Step(dt)
		_, extentY, _ := projectedExtents(car.Rotation, config.Car.HalfExtents)
		if bottom := car.Position.Y - extentY; bottom < -1e-7 {
			t.Fatalf("car crossed the floor: bottom=%f p=%+v", bottom, car.Position)
		}
	}
	if car.Velocity.Y > 0.05 {
		t.Fatalf("floor launched the car back upward: velocity=%+v", car.Velocity)
	}
	if !car.Grounded {
		t.Fatal("car did not settle as grounded after the landing")
	}
}

func TestCarWallContactTurnsIntoRampClimb(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	car := &world.Cars[0]
	car.Position = Vec3{X: config.Arena.Width * 0.5, Y: config.Car.HalfExtents.Y, Z: 0}
	car.Rotation = IdentityQuat()
	car.Velocity = Vec3{X: 38, Z: 9}

	resolveCarArena(car, config)
	if car.Position.X >= config.Arena.Width*0.5 || car.Position.Y <= config.Car.HalfExtents.Y {
		t.Fatalf("car was not moved onto the curved ramp: p=%+v", car.Position)
	}
	if car.Velocity.X <= 0 || car.Velocity.Y <= 0 {
		t.Fatalf("ramp should turn outward speed upward without reversing it: %+v", car.Velocity)
	}
	if math.Abs(car.Velocity.Z-9) > 1e-7 {
		t.Fatalf("wall contact should preserve tangential sliding: %+v", car.Velocity)
	}
}

func TestCarCannotEscapeRoundedCorner(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	car := &world.Cars[0]
	straightX := config.Arena.Width*0.5 - config.Arena.CornerRadius
	straightZ := config.Arena.Length*0.5 - config.Arena.CornerRadius
	normal := Vec3{X: 1, Z: 1}.NormalizeOr(Vec3{X: 1})
	car.Position = Vec3{X: straightX, Y: config.Car.HalfExtents.Y, Z: straightZ}.Add(normal.Mul(config.Arena.CornerRadius + 3))
	car.Rotation = IdentityQuat()
	car.Velocity = normal.Mul(40)

	resolveCarArena(car, config)
	cornerCenter := Vec3{X: straightX, Z: straightZ}
	distance := car.Position.Sub(cornerCenter)
	distance.Y = 0
	support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, normal)
	maximumDistance := config.Arena.CornerRadius - support
	if distance.Length() > maximumDistance+1e-7 {
		t.Fatalf("car escaped rounded corner: distance=%f max=%f", distance.Length(), maximumDistance)
	}
	boundary, ok := nearestArenaBoundary(car.Position, config.Arena, false)
	if !ok {
		t.Fatal("rounded corner boundary was not found")
	}
	horizontal := config.Arena.RampRadius - boundary.Distance
	vertical := car.Position.Y - config.Arena.RampRadius
	distanceFromRampCenter := math.Hypot(horizontal, vertical)
	surfaceNormal := boundary.Outward.Mul(-horizontal / distanceFromRampCenter).Add(Vec3{Y: -vertical / distanceFromRampCenter})
	if intoSurface := car.Velocity.Dot(surfaceNormal); intoSurface < -1e-7 {
		t.Fatalf("car retained velocity into rounded ramp: %f", intoSurface)
	}
}

func TestCarCanDriveUpSideWall(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{X: config.Arena.Width*0.5 - config.Arena.RampRadius - 4, Y: config.Car.HalfExtents.Y, Z: 0}
	car.Rotation = QuatFromYaw(-math.Pi / 2)
	car.Grounded = true
	car.GroundNormal = Vec3{Y: 1}
	if !world.SetInput(0, Input{Sequence: 1, Mask: InputW | InputBoost}) {
		t.Fatal("input was not accepted")
	}

	dt := 1 / float64(config.PhysicsHz)
	maximumY := car.Position.Y
	reachedVerticalGlass := false
	for range config.PhysicsHz * 3 {
		world.Step(dt)
		maximumY = math.Max(maximumY, car.Position.Y)
		if car.Position.Y > config.Arena.RampRadius+1 && car.Grounded && math.Abs(car.GroundNormal.X) > 0.75 {
			reachedVerticalGlass = true
		}
	}
	if maximumY < config.Arena.RampRadius+2 {
		t.Fatalf("car did not climb onto the vertical glass: maxY=%f final=%+v", maximumY, car.Position)
	}
	if car.Position.X > config.Arena.Width*0.5+0.01 {
		t.Fatalf("car escaped through wall while climbing: %+v", car.Position)
	}
	if !reachedVerticalGlass {
		t.Fatalf("car rose but never attached to vertical glass: maxY=%f final=%+v normal=%+v", maximumY, car.Position, car.GroundNormal)
	}
}

func TestHoldingJumpAddsExtraLift(t *testing.T) {
	config := DefaultConfig()
	dt := 1 / float64(config.PhysicsHz)

	makeJumpingWorld := func(mask uint8) *World {
		world := NewWorld(config)
		world.SetConnected(0, true)
		car := &world.Cars[0]
		car.Position = Vec3{Y: config.Car.HalfExtents.Y}
		car.Rotation = IdentityQuat()
		car.Grounded = true
		car.GroundNormal = Vec3{Y: 1}
		if !world.SetInput(0, Input{Sequence: 1, Mask: mask, Edges: EdgeJump}) {
			t.Fatal("jump input was not accepted")
		}
		return world
	}

	tapped := makeJumpingWorld(0)
	held := makeJumpingWorld(InputJump)
	for range 18 {
		tapped.Step(dt)
		held.Step(dt)
	}
	if held.Cars[0].Position.Y <= tapped.Cars[0].Position.Y+0.15 {
		t.Fatalf("holding jump did not add meaningful lift: tapY=%f heldY=%f", tapped.Cars[0].Position.Y, held.Cars[0].Position.Y)
	}
	if held.Cars[0].Velocity.Y <= tapped.Cars[0].Velocity.Y+0.5 {
		t.Fatalf("holding jump did not preserve extra upward velocity: tapV=%f heldV=%f", tapped.Cars[0].Velocity.Y, held.Cars[0].Velocity.Y)
	}
}

func startDirectionalDodge(t *testing.T, mask uint8) (*World, *Car, float64) {
	t.Helper()
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{Y: config.Car.HalfExtents.Y}
	car.Rotation = IdentityQuat()
	car.Grounded = true
	car.GroundNormal = Vec3{Y: 1}
	dt := 1 / float64(config.PhysicsHz)

	if !world.SetInput(0, Input{Sequence: 1, Edges: EdgeJump}) {
		t.Fatal("first jump input was not accepted")
	}
	world.Step(dt)
	if car.JumpCount != 1 || car.Grounded {
		t.Fatalf("first jump did not detach cleanly: jumpCount=%d grounded=%v", car.JumpCount, car.Grounded)
	}

	if !world.SetInput(0, Input{Sequence: 2, Mask: mask, Edges: EdgeJump}) {
		t.Fatal("dodge input was not accepted")
	}
	world.Step(dt)
	if car.JumpCount != 2 {
		t.Fatalf("directional second jump did not consume dodge: jumpCount=%d", car.JumpCount)
	}
	return world, car, dt
}

func TestDodgeTuningIsExactlyOneRevolution(t *testing.T) {
	config := DefaultConfig().Car
	if math.Abs(config.DodgeRotation-2*math.Pi) > 1e-12 {
		t.Fatalf("dodge rotation is %f radians, want 2*pi", config.DodgeRotation)
	}
	expectedDuration := config.DodgeRotation / config.DodgeAngularSpeed
	if math.Abs(config.DodgeDuration-expectedDuration) > 0.002 {
		t.Fatalf("dodge duration/speed mismatch: duration=%f expected=%f", config.DodgeDuration, expectedDuration)
	}
}

func TestDirectionalSecondJumpCreatesRocketStyleDodge(t *testing.T) {
	world, car, _ := startDirectionalDodge(t, InputW)
	config := world.Config.Car
	if car.Velocity.Z > -config.DodgeImpulse*0.75 {
		t.Fatalf("forward dodge did not add enough forward speed: %+v", car.Velocity)
	}
	if car.AngularVelocity.X > -config.DodgeAngularSpeed*0.65 {
		t.Fatalf("forward dodge did not create a front-flip rotation: %+v", car.AngularVelocity)
	}
	if car.DodgeTime <= 0 || car.DodgeAngleRemaining <= 0 {
		t.Fatal("finite dodge rotation was not activated")
	}
}

func TestForwardBackAndDiagonalDodgesPushAlongRequestedVector(t *testing.T) {
	forwardWorld, forward, _ := startDirectionalDodge(t, InputW)
	if forward.Velocity.Z > -forwardWorld.Config.Car.DodgeImpulse*0.75 {
		t.Fatalf("forward dodge did not push forward: %+v", forward.Velocity)
	}

	backWorld, back, _ := startDirectionalDodge(t, InputS)
	if back.Velocity.Z < backWorld.Config.Car.DodgeImpulse*0.75 {
		t.Fatalf("back dodge did not push backward: %+v", back.Velocity)
	}
	if back.AngularVelocity.X < backWorld.Config.Car.DodgeAngularSpeed*0.65 {
		t.Fatalf("back dodge rotated the wrong way: %+v", back.AngularVelocity)
	}

	diagonalWorld, diagonal, _ := startDirectionalDodge(t, InputW|InputA)
	minimumComponent := diagonalWorld.Config.Car.DodgeImpulse * 0.45
	if diagonal.Velocity.X > -minimumComponent || diagonal.Velocity.Z > -minimumComponent {
		t.Fatalf("forward-left dodge did not push diagonally: %+v", diagonal.Velocity)
	}
}

func TestSideDodgesRollAndPushInMatchingDirection(t *testing.T) {
	leftWorld, left, _ := startDirectionalDodge(t, InputA)
	if left.Velocity.X > -leftWorld.Config.Car.DodgeImpulse*0.75 {
		t.Fatalf("left dodge did not push left: %+v", left.Velocity)
	}
	if left.AngularVelocity.Z < leftWorld.Config.Car.DodgeAngularSpeed*0.65 {
		t.Fatalf("left dodge rolled the wrong way: %+v", left.AngularVelocity)
	}

	rightWorld, right, _ := startDirectionalDodge(t, InputD)
	if right.Velocity.X < rightWorld.Config.Car.DodgeImpulse*0.75 {
		t.Fatalf("right dodge did not push right: %+v", right.Velocity)
	}
	if right.AngularVelocity.Z > -rightWorld.Config.Car.DodgeAngularSpeed*0.65 {
		t.Fatalf("right dodge rolled the wrong way: %+v", right.AngularVelocity)
	}
}

func TestDodgeStopsAfterExactlyOneRevolutionWithoutCountersteer(t *testing.T) {
	world, car, dt := startDirectionalDodge(t, InputW)
	// Keep W held for the entire test. The dodge input latch must prevent that
	// same key from immediately becoming normal air-pitch after the flip ends.
	car.Position.Y = 5
	steps := int(math.Ceil((world.Config.Car.DodgeDuration + 0.28) * float64(world.Config.PhysicsHz)))
	for range steps {
		world.Step(dt)
	}

	if car.DodgeAngleRemaining > 1e-6 || car.DodgeTime > 1e-6 {
		t.Fatalf("dodge did not finish: time=%f angle=%f", car.DodgeTime, car.DodgeAngleRemaining)
	}
	if spin := car.AngularVelocity.Length(); spin > 0.08 {
		t.Fatalf("car kept spinning after one flip without countersteer: %+v", car.AngularVelocity)
	}
	forward := car.Rotation.Rotate(Vec3{Z: -1})
	up := car.Rotation.Rotate(Vec3{Y: 1})
	if forward.Dot(Vec3{Z: -1}) < 0.985 || up.Dot(Vec3{Y: 1}) < 0.985 {
		t.Fatalf("one-flip dodge did not return to the original heading: forward=%+v up=%+v", forward, up)
	}

	// Releasing the trigger direction clears the latch; pressing it again must
	// restore ordinary air control rather than permanently disabling pitch.
	world.SetInput(0, Input{Sequence: 3, Mask: 0})
	world.Step(dt)
	world.SetInput(0, Input{Sequence: 4, Mask: InputW})
	for range 18 {
		world.Step(dt)
	}
	if car.AngularVelocity.X > -0.2 {
		t.Fatalf("air pitch did not return after releasing the dodge key: %+v", car.AngularVelocity)
	}
}

func TestVerticalWallAdhesionHoldsUntilJump(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]

	wallNormal := Vec3{X: -1}
	car.Position = Vec3{X: config.Arena.Width*0.5 - config.Car.HalfExtents.Y + 0.03, Y: 11, Z: 0}
	car.Rotation = QuatFromForwardUp(Vec3{Z: -1}, wallNormal)
	car.Velocity = Vec3{}
	car.AngularVelocity = Vec3{}
	car.GroundLockout = 0
	resolveCarArena(car, config)
	finishStartY := car.Position.Y
	world.finishCarStep(car, 1/float64(config.PhysicsHz))
	if !car.Grounded || car.GroundNormal.Dot(wallNormal) < 0.95 {
		t.Fatalf("test car did not establish wall contact: grounded=%v normal=%+v", car.Grounded, car.GroundNormal)
	}

	dt := 1 / float64(config.PhysicsHz)
	for range config.PhysicsHz {
		world.Step(dt)
	}
	if !car.Grounded || car.GroundNormal.Dot(wallNormal) < 0.9 {
		t.Fatalf("car lost vertical wall contact without jumping: grounded=%v normal=%+v", car.Grounded, car.GroundNormal)
	}
	if drop := finishStartY - car.Position.Y; drop > 0.18 {
		t.Fatalf("wall gravity pulled the car down despite adhesion: drop=%f position=%+v", drop, car.Position)
	}

	if !world.SetInput(0, Input{Sequence: 1, Edges: EdgeJump}) {
		t.Fatal("wall jump input was not accepted")
	}
	beforeX := car.Position.X
	world.Step(dt)
	if car.Grounded || car.GroundLockout <= 0 {
		t.Fatalf("wall jump did not disable adhesion: grounded=%v lockout=%f", car.Grounded, car.GroundLockout)
	}
	if car.Position.X >= beforeX || car.Velocity.X >= -config.Car.JumpSpeed*0.7 {
		t.Fatalf("wall jump did not push away from glass: position=%+v velocity=%+v", car.Position, car.Velocity)
	}
}

func TestNegativeZBlueGoalScoresForOrange(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.Ball.Position = Vec3{Y: config.Ball.Radius, Z: -config.Arena.Length*0.5 + config.Ball.Radius + 0.1}
	world.Ball.Velocity = Vec3{Z: -24}
	dt := 1 / float64(config.PhysicsHz)
	for range 40 {
		world.Step(dt)
		if world.OrangeScore > 0 {
			break
		}
	}
	if world.OrangeScore != 1 || world.BlueScore != 0 {
		t.Fatalf("negative-Z blue goal did not score for orange: orange=%d blue=%d", world.OrangeScore, world.BlueScore)
	}
}

func TestBallBouncesInsideRoundedCorner(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	straightX := config.Arena.Width*0.5 - config.Arena.CornerRadius
	straightZ := config.Arena.Length*0.5 - config.Arena.CornerRadius
	normal := Vec3{X: -1, Z: 1}.NormalizeOr(Vec3{Z: 1})
	cornerCenter := Vec3{X: -straightX, Z: straightZ}
	world.Ball.Position = cornerCenter.Add(normal.Mul(config.Arena.CornerRadius + 2))
	world.Ball.Position.Y = config.Ball.Radius
	world.Ball.Velocity = normal.Mul(30)

	resolveBallArena(&world.Ball, config)
	delta := world.Ball.Position.Sub(cornerCenter)
	delta.Y = 0
	maximumDistance := config.Arena.CornerRadius - config.Ball.Radius
	if delta.Length() > maximumDistance+1e-7 {
		t.Fatalf("ball escaped rounded corner: distance=%f max=%f", delta.Length(), maximumDistance)
	}
	if outward := world.Ball.Velocity.Dot(normal); outward >= 0 {
		t.Fatalf("ball did not bounce inward from glass: %f", outward)
	}
}

func TestCarTransfersMomentumToBall(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{Y: 0.9}
	car.Rotation = IdentityQuat()
	car.Velocity = Vec3{Z: -15}
	world.Ball.Position = Vec3{Y: 1.1, Z: -2.5}
	world.Ball.Velocity = Vec3{}

	resolveCarBall(car, &world.Ball, config)
	if world.Ball.Velocity.Z >= -0.5 {
		t.Fatalf("ball did not receive forward momentum: %+v", world.Ball.Velocity)
	}
	if !world.Ball.Velocity.IsFinite() || !car.Velocity.IsFinite() {
		t.Fatal("collision produced a non-finite velocity")
	}
}

func TestOlderInputCannotOverwriteNewerInput(t *testing.T) {
	world := NewWorld(DefaultConfig())
	world.SetConnected(0, true)
	if !world.SetInput(0, Input{Sequence: 10, Mask: InputW}) {
		t.Fatal("new input was rejected")
	}
	if world.SetInput(0, Input{Sequence: 9, Mask: InputS}) {
		t.Fatal("older input was accepted")
	}
	if world.Cars[0].Input.Mask != InputW {
		t.Fatalf("input was overwritten: %08b", world.Cars[0].Input.Mask)
	}
}

func BenchmarkWorldStepFourPlayers(b *testing.B) {
	world := NewWorld(DefaultConfig())
	for slot := range world.Cars {
		world.SetConnected(slot, true)
		world.SetInput(slot, Input{Sequence: 1, Mask: InputW | InputBoost})
	}
	dt := 1 / float64(world.Config.PhysicsHz)
	b.ResetTimer()
	for range b.N {
		world.Step(dt)
	}
}

func TestWallAlignmentKeepsClimbingDirectionWhenNoseMeetsWall(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	car := &world.Cars[0]
	wallNormal := Vec3{X: -1}

	// This is the degenerate pose that used to trigger the old fixed "down"
	// fallback: the nose points into the wall while the collision has already
	// turned the actual motion upward.
	car.Rotation = QuatFromYaw(-math.Pi / 2)
	car.Velocity = Vec3{Y: 12}
	car.Grounded = true
	car.GroundNormal = wallNormal
	world.finishCarStep(car, 0.08)

	forward := car.Rotation.Rotate(Vec3{Z: -1})
	if forward.Y <= 0.2 {
		t.Fatalf("wall alignment did not preserve upward climbing direction: forward=%+v", forward)
	}
	if forward.Y < 0 {
		t.Fatalf("wall alignment pitched the car down the wall: forward=%+v", forward)
	}
}

func TestCarCanRollFromWallOntoRoundedCeiling(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	wallNormal := Vec3{X: -1}

	car.Position = Vec3{
		X: config.Arena.Width*0.5 - config.Car.HalfExtents.Y + 0.02,
		Y: config.Arena.Ceiling - config.Arena.CeilingRampRadius - 1.2,
		Z: 0,
	}
	car.Rotation = QuatFromForwardUp(Vec3{Y: 1}, wallNormal)
	car.Velocity = Vec3{Y: 14}
	car.Grounded = true
	car.GroundNormal = wallNormal
	car.Boost = config.Car.BoostCapacity
	if !world.SetInput(0, Input{Sequence: 1, Mask: InputW | InputBoost}) {
		t.Fatal("input was not accepted")
	}

	dt := 1 / float64(config.PhysicsHz)
	reachedUpperArc := false
	reachedCeilingLikeNormal := false
	minimumX := car.Position.X
	maximumY := car.Position.Y
	for step := 0; step < config.PhysicsHz; step++ {
		if step == config.PhysicsHz/2 {
			if !world.SetInput(0, Input{Sequence: 2, Mask: InputW | InputBoost}) {
				t.Fatal("input heartbeat was not accepted")
			}
		}
		world.Step(dt)
		minimumX = math.Min(minimumX, car.Position.X)
		maximumY = math.Max(maximumY, car.Position.Y)
		if car.Position.Y > config.Arena.Ceiling-config.Arena.CeilingRampRadius+0.4 && car.Grounded {
			reachedUpperArc = true
		}
		if car.Grounded && car.GroundNormal.Y < -0.45 {
			reachedCeilingLikeNormal = true
		}
	}

	if !reachedUpperArc {
		t.Fatalf("car never entered the rounded ceiling transition: maxY=%.3f pos=%+v normal=%+v", maximumY, car.Position, car.GroundNormal)
	}
	if !reachedCeilingLikeNormal {
		t.Fatalf("surface normal never rotated toward the ceiling: pos=%+v normal=%+v", car.Position, car.GroundNormal)
	}
	if minimumX >= config.Arena.Width*0.5-config.Arena.CeilingRampRadius*0.25 {
		t.Fatalf("car did not roll inward across the ceiling arc: minX=%.3f", minimumX)
	}
}

func TestCarHitIsForwardBiasedWithModerateLift(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	car := &world.Cars[0]
	car.Position = Vec3{Y: config.Car.HalfExtents.Y}
	car.Rotation = IdentityQuat()
	car.Velocity = Vec3{Z: -16}
	ball := &world.Ball
	ball.Position = Vec3{Y: config.Car.HalfExtents.Y, Z: -3.55}
	ball.Velocity = Vec3{}
	ball.AngularVelocity = Vec3{}

	resolveCarBall(car, ball, config)
	forwardSpeed := math.Abs(ball.Velocity.Z)
	if forwardSpeed < 24 {
		t.Fatalf("frontal car hit did not carry enough forward speed: velocity=%+v", ball.Velocity)
	}
	if ball.Velocity.Y < 1.0 || ball.Velocity.Y > 3.5 {
		t.Fatalf("frontal car hit should have moderate lift instead of a lob: velocity=%+v", ball.Velocity)
	}
	if ball.Velocity.Y/forwardSpeed > 0.15 {
		t.Fatalf("frontal car hit is still too vertical: velocity=%+v", ball.Velocity)
	}
}

func TestBallKeepsRollingMomentum(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.Ball.Position = Vec3{Y: config.Ball.Radius}
	world.Ball.Velocity = Vec3{Z: 12}

	dt := 1 / float64(config.PhysicsHz)
	for step := 0; step < config.PhysicsHz*5; step++ {
		world.Step(dt)
	}

	horizontalSpeed := math.Hypot(world.Ball.Velocity.X, world.Ball.Velocity.Z)
	if horizontalSpeed < 4.0 {
		t.Fatalf("ball lost rolling momentum too quickly after five seconds: speed=%.3f velocity=%+v", horizontalSpeed, world.Ball.Velocity)
	}
}

func TestWallClimbSurfaceNormalChangesContinuously(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{X: config.Arena.Width*0.5 - config.Arena.RampRadius - 3, Y: config.Car.HalfExtents.Y, Z: 0}
	car.Rotation = QuatFromYaw(-math.Pi / 2)
	car.Grounded = true
	car.GroundNormal = Vec3{Y: 1}
	if !world.SetInput(0, Input{Sequence: 1, Mask: InputW | InputBoost}) {
		t.Fatal("input was not accepted")
	}

	dt := 1 / float64(config.PhysicsHz)
	previous := car.GroundNormal
	havePrevious := false
	minimumDot := 1.0
	for step := 0; step < config.PhysicsHz*2; step++ {
		if step == config.PhysicsHz-1 {
			world.SetInput(0, Input{Sequence: 2, Mask: InputW | InputBoost})
		}
		world.Step(dt)
		if !car.Grounded {
			havePrevious = false
			continue
		}
		current := car.GroundNormal.NormalizeOr(Vec3{Y: 1})
		if havePrevious {
			minimumDot = math.Min(minimumDot, previous.Dot(current))
		}
		previous = current
		havePrevious = true
	}
	if minimumDot < 0.94 {
		t.Fatalf("surface normal snapped too sharply during wall climb: min dot=%.5f", minimumDot)
	}
}

func TestBallFloorRampSeamNeverDropsThroughFloor(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)

	// Reproduce the old invisible gap directly: this position is still on the
	// flat-floor side of the geometric ramp seam, but it used to be classified
	// as "ramp zone" because the test incorrectly added the whole ball radius.
	gapDistance := config.Arena.RampRadius + config.Ball.Radius*0.5
	world.Ball.Position = Vec3{
		X: config.Arena.Width*0.5 - gapDistance,
		Y: config.Ball.Radius - 0.35,
		Z: 9,
	}
	world.Ball.Velocity = Vec3{X: 12, Y: -2, Z: 4}
	resolveBallArena(&world.Ball, config)
	if world.Ball.Position.Y < config.Ball.Radius-1e-7 {
		t.Fatalf("flat floor left a gap before the wall ramp: p=%+v", world.Ball.Position)
	}

	// Then cross the seam at speed. The center must never appear below the
	// floor before the analytic quarter-pipe starts lifting it.
	seamX := config.Arena.Width*0.5 - config.Arena.RampRadius
	world = NewWorld(config)
	world.Ball.Position = Vec3{X: seamX - 1.4, Y: config.Ball.Radius, Z: 9}
	world.Ball.Velocity = Vec3{X: 28, Z: 8}
	dt := 1 / float64(config.PhysicsHz)
	minimumY := world.Ball.Position.Y
	for step := 0; step < 40; step++ {
		world.Step(dt)
		minimumY = math.Min(minimumY, world.Ball.Position.Y)
		if !world.Ball.Position.IsFinite() || !world.Ball.Velocity.IsFinite() {
			t.Fatalf("ball became non-finite at floor/ramp seam: p=%+v v=%+v", world.Ball.Position, world.Ball.Velocity)
		}
	}
	if minimumY < config.Ball.Radius-0.015 {
		t.Fatalf("ball dipped through the floor/ramp seam: minY=%.4f radius=%.4f", minimumY, config.Ball.Radius)
	}
}

func simulateFirstJumpApex(t *testing.T, holdSeconds float64) float64 {
	t.Helper()
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{Y: config.Car.HalfExtents.Y}
	car.Rotation = IdentityQuat()
	car.Grounded = true
	car.GroundNormal = Vec3{Y: 1}

	mask := uint8(0)
	if holdSeconds > 0 {
		mask = InputJump
	}
	if !world.SetInput(0, Input{Sequence: 1, Mask: mask, Edges: EdgeJump}) {
		t.Fatal("initial jump input was not accepted")
	}

	dt := 1 / float64(config.PhysicsHz)
	releaseAt := int(math.Round(holdSeconds * float64(config.PhysicsHz)))
	sequence := uint32(1)
	maximumY := car.Position.Y
	for step := 0; step < config.PhysicsHz*2; step++ {
		if holdSeconds > 0 && step == releaseAt {
			sequence++
			if !world.SetInput(0, Input{Sequence: sequence, Mask: 0}) {
				t.Fatal("jump release input was not accepted")
			}
		}
		world.Step(dt)
		maximumY = math.Max(maximumY, car.Position.Y)
	}
	return maximumY
}

func TestJumpHeightScalesWithContinuousHoldDuration(t *testing.T) {
	tap := simulateFirstJumpApex(t, 0)
	medium := simulateFirstJumpApex(t, 0.085)
	full := simulateFirstJumpApex(t, DefaultConfig().Car.JumpHoldDuration+0.04)

	if medium <= tap+0.65 {
		t.Fatalf("medium jump was not meaningfully higher than tap: tap=%f medium=%f", tap, medium)
	}
	if full <= medium+0.65 {
		t.Fatalf("full jump was not meaningfully higher than medium: medium=%f full=%f", medium, full)
	}
	if full <= tap+1.7 {
		t.Fatalf("jump hold range is too small to aim flip height: tap=%f full=%f", tap, full)
	}
}

func TestReleasedJumpCannotRearmFirstJumpHold(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	car := &world.Cars[0]
	car.Position = Vec3{Y: config.Car.HalfExtents.Y}
	car.Rotation = IdentityQuat()
	car.Grounded = true
	car.GroundNormal = Vec3{Y: 1}
	dt := 1 / float64(config.PhysicsHz)

	world.SetInput(0, Input{Sequence: 1, Mask: InputJump, Edges: EdgeJump})
	for range 5 {
		world.Step(dt)
	}
	world.SetInput(0, Input{Sequence: 2, Mask: 0})
	world.Step(dt)
	if car.JumpHoldActive {
		t.Fatal("releasing jump did not end first-jump hold")
	}

	// Holding the button again without a new jump edge must not resume the first
	// jump's lift. The second press is reserved for the eventual dodge edge.
	before := car.JumpHoldTime
	world.SetInput(0, Input{Sequence: 3, Mask: InputJump})
	for range 8 {
		world.Step(dt)
	}
	if car.JumpHoldTime != before {
		t.Fatalf("first-jump hold rearmed after release: before=%f after=%f", before, car.JumpHoldTime)
	}
}

func TestDriftTurnsFasterAndPreservesLateralSlip(t *testing.T) {
	run := func(flags uint8) (turnAngle, slipAngle float64) {
		config := DefaultConfig()
		world := NewWorld(config)
		world.SetConnected(0, true)
		car := &world.Cars[0]
		car.Position = Vec3{Y: config.Car.HalfExtents.Y}
		car.Rotation = IdentityQuat()
		car.Velocity = Vec3{Z: -15}
		car.Grounded = true
		car.GroundNormal = Vec3{Y: 1}
		world.SetInput(0, Input{Sequence: 1, Mask: InputW | InputA, Flags: flags})

		dt := 1 / float64(config.PhysicsHz)
		for range int(0.42 * float64(config.PhysicsHz)) {
			world.Step(dt)
		}

		forward := car.Rotation.Rotate(Vec3{Z: -1}).NormalizeOr(Vec3{Z: -1})
		turnAngle = math.Acos(clamp(forward.Dot(Vec3{Z: -1}), -1, 1))
		velocity := Vec3{X: car.Velocity.X, Z: car.Velocity.Z}.NormalizeOr(forward)
		slipAngle = math.Acos(clamp(velocity.Dot(forward), -1, 1))
		return turnAngle, slipAngle
	}

	normalTurn, normalSlip := run(0)
	driftTurn, driftSlip := run(InputFlagDrift)
	if driftTurn <= normalTurn+0.20 {
		t.Fatalf("drift did not tighten steering enough: normal=%f drift=%f", normalTurn, driftTurn)
	}
	if driftSlip <= normalSlip+0.12 {
		t.Fatalf("drift did not preserve enough lateral slide: normal=%f drift=%f", normalSlip, driftSlip)
	}
}

func TestGoalReplayTracksLastBallTouchAsScorer(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	world.SetConnected(1, true)
	world.Tick = 123
	world.LastBallTouchSlot = 1
	world.LastBallTouchTick = 120
	world.Ball.Position = Vec3{Y: config.Ball.Radius, Z: config.Arena.Length*0.5 + config.Ball.Radius}

	if !world.detectGoal() {
		t.Fatal("expected a goal")
	}
	if world.LastGoalScorer != 1 {
		t.Fatalf("replay scorer=%d, want last toucher slot 1", world.LastGoalScorer)
	}
	if world.LastGoalTick != 123 || world.GoalSequence != 1 {
		t.Fatalf("goal replay metadata not recorded: tick=%d sequence=%d", world.LastGoalTick, world.GoalSequence)
	}
}

func TestGoalExplosionKnockbackPushesEveryCarAwayAndLocksGoal(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	world.SetConnected(0, true)
	world.SetConnected(1, true)
	world.Cars[0].Position = Vec3{X: -8, Y: config.Car.HalfExtents.Y, Z: 26}
	world.Cars[1].Position = Vec3{X: 11, Y: config.Car.HalfExtents.Y, Z: -18}
	world.Ball.Position = Vec3{X: 1.5, Y: config.Ball.Radius, Z: config.Arena.Length*0.5 + config.Ball.Radius}

	if !world.detectGoal() {
		t.Fatal("expected a goal")
	}
	if !world.GoalLocked || world.LastGoalSign != 1 || world.LastGoalScoringTeam != TeamBlue {
		t.Fatalf("goal celebration metadata missing: locked=%v sign=%d team=%q", world.GoalLocked, world.LastGoalSign, world.LastGoalScoringTeam)
	}
	origin := Vec3{Y: 3.8, Z: config.Arena.Length*0.5 + 1.4}
	for index := 0; index < 2; index++ {
		car := world.Cars[index]
		away := Vec3{X: car.Position.X - origin.X, Z: car.Position.Z - origin.Z}.NormalizeOr(Vec3{Z: -1})
		horizontalVelocity := Vec3{X: car.Velocity.X, Z: car.Velocity.Z}
		if horizontalVelocity.Dot(away) < 28 {
			t.Fatalf("car %d was not blasted away from goal: velocity=%+v away=%+v", index, car.Velocity, away)
		}
		if car.Velocity.Y < 12 {
			t.Fatalf("car %d did not receive enough vertical goal blast: %+v", index, car.Velocity)
		}
		if car.AngularVelocity.Length() < 4 {
			t.Fatalf("car %d did not tumble after goal blast: %+v", index, car.AngularVelocity)
		}
	}

	blueBefore := world.BlueScore
	if world.detectGoal() {
		t.Fatal("goal lock allowed the same ball to score twice")
	}
	if world.BlueScore != blueBefore {
		t.Fatalf("score changed while goal was locked: before=%d after=%d", blueBefore, world.BlueScore)
	}

	world.ResetKickoff()
	if world.GoalLocked {
		t.Fatal("kickoff reset did not unlock goal detection")
	}
}

func TestKickoffResetAfterReplayPreservesScore(t *testing.T) {
	world := NewWorld(DefaultConfig())
	world.SetConnected(0, true)
	world.OrangeScore = 3
	world.BlueScore = 2
	world.Cars[0].Position = Vec3{X: 20, Y: 8, Z: 0}
	world.Ball.Position = Vec3{X: 10, Y: 7, Z: 4}

	world.ResetKickoff()
	if world.OrangeScore != 3 || world.BlueScore != 2 {
		t.Fatalf("kickoff reset changed score: orange=%d blue=%d", world.OrangeScore, world.BlueScore)
	}
	if world.Cars[0].Position != playerSpawns[0].Position {
		t.Fatalf("car was not reset to kickoff spawn: %+v", world.Cars[0].Position)
	}
	if world.Ball.Position != (Vec3{Y: world.Config.Ball.SpawnY}) {
		t.Fatalf("ball was not reset for kickoff: %+v", world.Ball.Position)
	}
}
