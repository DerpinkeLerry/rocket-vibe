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
	if speed := car.Velocity.Length(); speed > world.Config.Car.MaxBoostSpeed*1.36 {
		t.Fatalf("car exceeded safety speed cap: %f", speed)
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
	if throughGoal.Ball.Position != (Vec3{Y: config.Ball.SpawnY}) {
		t.Fatalf("ball was not reset after goal: %+v", throughGoal.Ball.Position)
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
