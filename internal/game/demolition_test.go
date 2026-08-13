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
	attacker.Position = Vec3{X: 0, Y: 0.52, Z: 0}
	victim.Position = Vec3{X: 0, Y: 0.52, Z: -2.0}
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

func TestDemolitionRequiresSpeedAboveNormalCap(t *testing.T) {
	config := DefaultConfig()
	world, _, victim, contact := setupDemoContact(t, config.Car.MaxGroundSpeed, 0, 0, 1)
	if world.tryCarCarDemolition(&world.Cars[0], victim, contact) {
		t.Fatal("exactly 70 km/h triggered a demolition; requirement is strictly above normal speed")
	}
	if victim.Demolished {
		t.Fatal("victim was marked demolished at the normal speed cap")
	}

	world, attacker, victim, contact := setupDemoContact(t, 71.0/3.6, 0, 0, 1)
	if !world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("71 km/h frontal enemy hit did not trigger demolition")
	}
	if !victim.Demolished || attacker.Demolished {
		t.Fatalf("unexpected demolition state: attacker=%v victim=%v", attacker.Demolished, victim.Demolished)
	}
	events := world.ConsumeDemolitions()
	if len(events) != 1 || events[0].AttackerSlot != 0 || events[0].VictimSlot != 1 {
		t.Fatalf("unexpected demolition event: %+v", events)
	}
}

func TestDemolitionUsesAttackerSpeedNotLargeRelativeImpact(t *testing.T) {
	world, attacker, victim, contact := setupDemoContact(t, 90.0/3.6, 0, 0, 1)
	// The victim is already moving in the same direction at 86.4 km/h, so the
	// relative closing speed is only 1 m/s. Supersonic-style demolition is based
	// on the attacker's own speed and frontal contact, not a huge impact delta.
	victim.Velocity = Vec3{Z: -24}
	contact, hit := carCarContact(attacker, victim, world.Config.Car)
	if !hit || contact.ClosingSpeed < 0.9 || contact.ClosingSpeed > 1.1 {
		t.Fatalf("unexpected low-relative-speed contact: hit=%v closing=%f", hit, contact.ClosingSpeed)
	}
	if !world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("frontal >70 km/h hit was incorrectly rejected because relative speed was small")
	}
}

func TestDemolitionRequiresFrontFacingImpact(t *testing.T) {
	world, attacker, victim, contact := setupDemoContact(t, 90.0/3.6, math.Pi/2, 0, 1)
	if world.tryCarCarDemolition(attacker, victim, contact) {
		t.Fatal("sideways/rear-facing hit triggered a demolition")
	}
	if victim.Demolished {
		t.Fatal("victim was demolished by a non-frontal hit")
	}
}

func TestDemolitionDoesNotAffectTeammates(t *testing.T) {
	world, attacker, victim, contact := setupDemoContact(t, 90.0/3.6, 0, 0, 2)
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
	if points[0].Position.X <= points[2].Position.X {
		t.Fatalf("blue spawn order is not screen-relative left/middle/right: %+v", points)
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
