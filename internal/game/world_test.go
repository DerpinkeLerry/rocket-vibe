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
