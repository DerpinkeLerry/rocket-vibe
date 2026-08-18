package game

import (
	"math"
	"testing"
)

func setupDemoContact(t *testing.T, speed float64, attackerYaw float64, attackerSlot, victimSlot int) (*World, *Car, *Car, carCarContactInfo) {
	t.Helper()
	world := NewWorld(DefaultConfig())
	world.SetConnected(attackerSlot, true)
	world.SetConnected(victimSlot, true)
	attacker := &world.Cars[attackerSlot]
	victim := &world.Cars[victimSlot]
	attacker.Position = Vec3{X: 0, Y: world.Config.Car.HalfExtents.Y, Z: 0}
	victim.Position = Vec3{X: 0, Y: world.Config.Car.HalfExtents.Y, Z: -1.0}
	attacker.Rotation = QuatFromYaw(attackerYaw)
	victim.Rotation = QuatFromYaw(math.Pi)
	attacker.Velocity = Vec3{Z: -speed}
	victim.Velocity = Vec3{}
	contact, hit := carCarContact(attacker, victim, world.Config.Car)
	if !hit {
		t.Fatal("expected overlapping car contact")
	}
	return world, attacker, victim, contact
}

func TestDemolitionRequiresSupersonicSpeed(t *testing.T) {
	world, attacker, victim, contact := setupDemoContact(t, 79.1/3.6, 0, 0, 1)
	if world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("79.1 km/h triggered a demolition below the 2200 uu/s supersonic threshold")
	}
	if victim.Demolished {
		t.Fatal("victim was marked demolished below supersonic speed")
	}

	world, attacker, victim, contact = setupDemoContact(t, 79.2/3.6, 0, 0, 1)
	if !world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("79.2 km/h frontal supersonic hit on a slower enemy did not trigger demolition")
	}
	if !victim.Demolished || attacker.Demolished {
		t.Fatalf("unexpected demolition state: attacker=%v victim=%v", attacker.Demolished, victim.Demolished)
	}
	events := world.ConsumeDemolitions()
	if len(events) != 1 || events[0].AttackerSlot != 0 || events[0].VictimSlot != 1 {
		t.Fatalf("unexpected demolition event: %+v", events)
	}
}

func TestDemolitionFasterCarWinsHeadOn(t *testing.T) {
	world, first, second, _ := setupDemoContact(t, 100.0/3.6, 0, 0, 1)
	second.Velocity = Vec3{Z: 95.0 / 3.6}
	contact, hit := carCarContact(first, second, world.Config.Car)
	if !hit {
		t.Fatal("expected first head-on contact")
	}
	if !world.tryCarCarDemolition(first, second, contact) {
		t.Fatal("faster first car did not demolish slower second car")
	}
	if first.Demolished || !second.Demolished {
		t.Fatalf("wrong head-on winner: first=%v second=%v", first.Demolished, second.Demolished)
	}

	world, first, second, _ = setupDemoContact(t, 95.0/3.6, 0, 0, 1)
	second.Velocity = Vec3{Z: 100.0 / 3.6}
	contact, hit = carCarContact(first, second, world.Config.Car)
	if !hit {
		t.Fatal("expected second head-on contact")
	}
	if !world.tryCarCarDemolition(first, second, contact) {
		t.Fatal("faster second car did not demolish slower first car")
	}
	if !first.Demolished || second.Demolished {
		t.Fatalf("wrong reverse head-on winner: first=%v second=%v", first.Demolished, second.Demolished)
	}
}

func TestDemolitionEqualSpeedHasNoWinner(t *testing.T) {
	world, first, second, _ := setupDemoContact(t, 100.0/3.6, 0, 0, 1)
	second.Velocity = Vec3{Z: 100.0 / 3.6}
	contact, hit := carCarContact(first, second, world.Config.Car)
	if !hit {
		t.Fatal("expected equal-speed head-on contact")
	}
	if world.tryCarCarDemolition(first, second, contact) {
		t.Fatal("equal-speed impact triggered a demolition")
	}
	if first.Demolished || second.Demolished {
		t.Fatalf("equal-speed impact demolished a car: first=%v second=%v", first.Demolished, second.Demolished)
	}
}

func TestDemolitionUsesFasterCarSpeedNotLargeRelativeImpact(t *testing.T) {
	world, attacker, victim, _ := setupDemoContact(t, 100.0/3.6, 0, 0, 1)
	// Both cars are already above the demo threshold and travel in the same
	// direction. The faster car is still the only possible attacker even though
	// the relative closing speed is just 1 m/s.
	victim.Velocity = Vec3{Z: -(100.0/3.6 - 1.0)}
	contact, hit := carCarContact(attacker, victim, world.Config.Car)
	if !hit || contact.ClosingSpeed < 0.9 || contact.ClosingSpeed > 1.1 {
		t.Fatalf("unexpected low-relative-speed contact: hit=%v closing=%f", hit, contact.ClosingSpeed)
	}
	if !world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("faster 100 km/h frontal hit was incorrectly rejected because relative speed was small")
	}
}

func TestDemolitionRequiresFasterCarToHitFrontally(t *testing.T) {
	world, attacker, victim, contact := setupDemoContact(t, 100.0/3.6, math.Pi/2, 0, 1)
	if world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("sideways/rear-facing hit triggered a demolition")
	}
	if victim.Demolished {
		t.Fatal("victim was demolished by a non-frontal faster car")
	}
}

func TestSlowerCarCannotDemolishFasterCar(t *testing.T) {
	world, slower, faster, _ := setupDemoContact(t, 100.0/3.6, 0, 0, 1)
	// The slower car is facing directly into the contact. The faster car is
	// moving away in the same direction, so it is not making a frontal attack.
	// Result: no demolition rather than letting the slower car win.
	faster.Rotation = QuatFromYaw(0)
	faster.Velocity = Vec3{Z: -110.0 / 3.6}
	contact, hit := carCarContact(slower, faster, world.Config.Car)
	if !hit {
		t.Fatal("expected overlapping faster/slower contact")
	}
	if world.tryCarCarDemolition(slower, faster, contact) {
		t.Fatal("slower car demolished the faster car")
	}
	if slower.Demolished || faster.Demolished {
		t.Fatalf("unexpected demolition: slower=%v faster=%v", slower.Demolished, faster.Demolished)
	}
}

func TestDemolitionDoesNotAffectTeammates(t *testing.T) {
	world, attacker, victim, contact := setupDemoContact(t, 100.0/3.6, 0, 0, 2)
	if TeamForSlot(attacker.Slot) != TeamForSlot(victim.Slot) {
		t.Fatal("test setup did not create teammates")
	}
	if world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("teammate collision triggered demolition")
	}
}

func TestDemolishedCarRespawnsAtSelectedOwnHalfPoint(t *testing.T) {
	world := NewWorld(DefaultConfig())
	world.SetConnected(1, true) // blue
	car := &world.Cars[1]
	world.markDemolished(car)
	if !car.Demolished {
		t.Fatal("car was not marked demolished")
	}
	point, ok := world.RespawnCar(1, 0)
	if !ok {
		t.Fatal("respawn failed")
	}
	if car.Demolished {
		t.Fatal("car remained demolished after respawn")
	}
	if point.Position.Z >= 0 || car.Position != point.Position {
		t.Fatalf("blue respawn was not on its own half: point=%+v car=%+v", point.Position, car.Position)
	}
	if math.Abs(car.Boost-DemolitionRespawnBoost) > 1e-9 {
		t.Fatalf("respawn boost is %.3f, want %.3f", car.Boost, DemolitionRespawnBoost)
	}
	if car.DemoImmunity <= 0 {
		t.Fatal("respawn did not receive short anti-chain-demo immunity")
	}

	points := RespawnPointsForSlot(1)
	wantX := [DemolitionSpawnCount]float64{-23.04, -26.88, 23.04, 26.88}
	for index, expected := range wantX {
		if points[index].Position.X != expected || points[index].Position.Z != -46.08 {
			t.Fatalf("blue demolition spawn %d = %+v, want x=%.2f z=-46.08", index, points[index], expected)
		}
	}
}

func TestSnapshotCarriesDemolishedMask(t *testing.T) {
	world := NewWorld(DefaultConfig())
	world.SetConnected(0, true)
	world.SetConnected(1, true)
	world.Cars[1].Demolished = true
	snapshot := world.Snapshot()
	if snapshot.DemolishedMask != 0b0010 {
		t.Fatalf("demolished mask = %08b, want bit 1", snapshot.DemolishedMask)
	}
}
