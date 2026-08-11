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

func TestBallCanEnterGoalButHitsSolidEndWall(t *testing.T) {
	config := DefaultConfig()
	dt := 1 / float64(config.PhysicsHz)

	throughGoal := NewWorld(config)
	throughGoal.Ball.Position = Vec3{Y: config.Ball.Radius, Z: config.Arena.Length*0.5 - config.Ball.Radius - 0.1}
	throughGoal.Ball.Velocity = Vec3{Z: 20}
	for range 30 {
		throughGoal.Step(dt)
	}
	if throughGoal.Ball.Position.Z <= config.Arena.Length*0.5 {
		t.Fatalf("ball did not pass through goal opening: z=%f", throughGoal.Ball.Position.Z)
	}

	endWall := NewWorld(config)
	endWall.Ball.Position = Vec3{X: 12, Y: config.Ball.Radius, Z: config.Arena.Length*0.5 - config.Ball.Radius - 0.1}
	endWall.Ball.Velocity = Vec3{Z: 20}
	for range 10 {
		endWall.Step(dt)
	}
	maximumZ := config.Arena.Length*0.5 - config.Ball.Radius + 1e-6
	if endWall.Ball.Position.Z > maximumZ || endWall.Ball.Velocity.Z > 0 {
		t.Fatalf("ball escaped through solid end wall: p=%+v v=%+v", endWall.Ball.Position, endWall.Ball.Velocity)
	}
}

<<<<<<< HEAD
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

func TestCarWallContactSlidesWithoutSpringBounce(t *testing.T) {
	config := DefaultConfig()
	world := NewWorld(config)
	car := &world.Cars[0]
	car.Position = Vec3{X: config.Arena.Width * 0.5, Y: config.Car.HalfExtents.Y, Z: 0}
	car.Rotation = IdentityQuat()
	car.Velocity = Vec3{X: 38, Z: 9}

	resolveCarArena(car, config)
	maximumX := config.Arena.Width*0.5 - config.Car.HalfExtents.X
	if car.Position.X > maximumX+1e-7 {
		t.Fatalf("car remained inside the side wall: x=%f max=%f", car.Position.X, maximumX)
	}
	if math.Abs(car.Velocity.X) > 1e-7 {
		t.Fatalf("wall should remove, not reverse, normal speed: %+v", car.Velocity)
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
	if outward := car.Velocity.Dot(normal); outward > 1e-7 {
		t.Fatalf("car retained outward corner velocity: %f", outward)
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

=======
>>>>>>> e4f4ac3d0103e90daad46770ba947151c0f2f96e
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
