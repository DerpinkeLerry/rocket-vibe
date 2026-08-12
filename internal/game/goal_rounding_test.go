package game

import (
	"math"
	"testing"
)

func TestGoalBackCornerUsesRoundedHorizontalBoundary(t *testing.T) {
	config := DefaultConfig()
	r := config.Arena.GoalRampRadius
	halfWidth := config.Arena.GoalWidth * 0.5
	halfLength := config.Arena.Length * 0.5
	straightX := halfWidth - r
	straightDepth := config.Arena.GoalDepth - r
	position := Vec3{
		X: straightX + r*0.70,
		Y: 5,
		Z: halfLength + straightDepth + r*0.70,
	}
	boundary, ok := nearestGoalBoundary(position, config.Arena)
	if !ok {
		t.Fatal("goal boundary was not found")
	}
	if boundary.Outward.X < 0.6 || boundary.Outward.Z < 0.6 {
		t.Fatalf("goal back corner did not produce a rounded diagonal normal: %+v", boundary.Outward)
	}
}

func TestGoalFloorToSideWallUsesRoundedSurfaceNormal(t *testing.T) {
	config := DefaultConfig()
	halfLength := config.Arena.Length * 0.5
	radius := config.Arena.GoalRampRadius
	support45 := (config.Car.HalfExtents.X + config.Car.HalfExtents.Y) / math.Sqrt2
	offset := radius - (radius-support45)/math.Sqrt2
	car := Car{
		Body: Body{
			Position: Vec3{X: config.Arena.GoalWidth*0.5 - offset, Y: offset, Z: halfLength + 5},
			Rotation: IdentityQuat(),
		},
		GroundNormal: Vec3{Y: 1},
	}
	for range 16 {
		resolveCarArena(&car, config)
	}
	if !car.Grounded {
		t.Fatal("car did not register contact on rounded goal side ramp")
	}
	if car.GroundNormal.X > -0.45 || car.GroundNormal.Y < 0.45 {
		t.Fatalf("unexpected rounded goal normal: %+v", car.GroundNormal)
	}
	if math.Abs(car.GroundNormal.Z) > 0.08 {
		t.Fatalf("side ramp normal unexpectedly points along goal depth: %+v", car.GroundNormal)
	}
}

func TestBallGoalBackCornerDeflectsInsteadOfHittingSquareCorner(t *testing.T) {
	config := DefaultConfig()
	r := config.Arena.GoalRampRadius
	halfWidth := config.Arena.GoalWidth * 0.5
	halfLength := config.Arena.Length * 0.5
	straightX := halfWidth - r
	straightDepth := config.Arena.GoalDepth - r
	ball := Ball{Body: Body{
		Position: Vec3{
			X: straightX + r*0.82,
			Y: 6,
			Z: halfLength + straightDepth + r*0.82,
		},
		Velocity: Vec3{X: 8, Z: 8},
	}}
	resolveBallArena(&ball, config)
	if ball.Velocity.X >= 8 || ball.Velocity.Z >= 8 {
		t.Fatalf("rounded goal corner did not remove outward velocity: %+v", ball.Velocity)
	}
}

func TestGoalSideWallToCeilingUsesRoundedSurfaceNormal(t *testing.T) {
	config := DefaultConfig()
	halfLength := config.Arena.Length * 0.5
	radius := config.Arena.GoalRampRadius
	support45 := (config.Car.HalfExtents.X + config.Car.HalfExtents.Y) / math.Sqrt2
	offset := radius - (radius-support45)/math.Sqrt2
	car := Car{
		Body: Body{
			Position: Vec3{X: config.Arena.GoalWidth*0.5 - offset, Y: config.Arena.GoalHeight - offset, Z: halfLength + 5},
			Rotation: quatFromAxisAngle(Vec3{Z: 1}, math.Pi),
		},
		GroundNormal: Vec3{Y: -1},
	}
	for range 16 {
		resolveCarArena(&car, config)
	}
	if !car.Grounded {
		t.Fatal("upside-down car did not register contact on rounded goal ceiling ramp")
	}
	if car.GroundNormal.X > -0.45 || car.GroundNormal.Y > -0.45 {
		t.Fatalf("unexpected goal wall-to-ceiling normal: %+v", car.GroundNormal)
	}
}

func TestGoalBackWallStillContainsFastBallAfterCenterCrossesWall(t *testing.T) {
	config := DefaultConfig()
	halfLength := config.Arena.Length * 0.5
	goalBack := halfLength + config.Arena.GoalDepth
	ball := Ball{Body: Body{
		Position: Vec3{Y: 6, Z: goalBack + 0.5},
		Velocity: Vec3{Z: 18},
	}}
	resolveBallArena(&ball, config)
	maximumCenterZ := goalBack - config.Ball.Radius
	if ball.Position.Z > maximumCenterZ+1e-6 {
		t.Fatalf("ball escaped rounded goal back wall: z=%f want <= %f", ball.Position.Z, maximumCenterZ)
	}
	if ball.Velocity.Z >= 0 {
		t.Fatalf("ball kept moving out of goal after back-wall hit: %+v", ball.Velocity)
	}
}

func TestGoalMouthBoundaryBlendsEndWallIntoTunnel(t *testing.T) {
	config := DefaultConfig()
	halfLength := config.Arena.Length * 0.5
	halfWidth := config.Arena.GoalWidth * 0.5
	radius := goalMouthRadius(config.Arena)
	position := Vec3{
		X: halfWidth + radius*0.48,
		Y: 4,
		Z: halfLength + radius*0.48,
	}

	boundary, ok := nearestGoalMouthBoundary(position, config.Arena)
	if !ok {
		t.Fatal("rounded goal mouth boundary was not found")
	}
	if boundary.Outward.X < 0.35 || boundary.Outward.Z < 0.35 {
		t.Fatalf("goal mouth did not produce a blended diagonal normal: %+v", boundary.Outward)
	}
}

func TestGoalMouthOpeningNarrowsSmoothly(t *testing.T) {
	config := DefaultConfig()
	halfWidth := config.Arena.GoalWidth * 0.5
	radius := goalMouthRadius(config.Arena)
	front := goalOpeningHalfWidthAtDepth(0, config.Arena)
	middle := goalOpeningHalfWidthAtDepth(radius*0.5, config.Arena)
	inside := goalOpeningHalfWidthAtDepth(radius, config.Arena)

	if math.Abs(front-(halfWidth+radius)) > 1e-9 {
		t.Fatalf("unexpected flared goal width at line: got %f", front)
	}
	if !(front > middle && middle > inside) {
		t.Fatalf("goal mouth does not narrow smoothly: front=%f middle=%f inside=%f", front, middle, inside)
	}
	if math.Abs(inside-halfWidth) > 1e-9 {
		t.Fatalf("goal mouth did not become tangent to straight tunnel: got %f want %f", inside, halfWidth)
	}
}

func TestGoalOpeningEndWallBoundaryReachesCompactRampStart(t *testing.T) {
	config := DefaultConfig()
	halfLength := config.Arena.Length * 0.5
	radius := goalMouthRadius(config.Arena)
	position := Vec3{
		X: config.Arena.GoalWidth*0.5 + radius + 1,
		Y: 1,
		Z: halfLength - config.Arena.RampRadius,
	}

	boundary, ok := nearestArenaBoundary(position, config.Arena, true)
	if !ok {
		t.Fatal("end-wall boundary disappeared before the compact lower ramp")
	}
	if math.Abs(boundary.Distance-config.Arena.RampRadius) > 1e-9 {
		t.Fatalf("unexpected end-wall distance at ramp start: got %f want %f", boundary.Distance, config.Arena.RampRadius)
	}
	if boundary.Outward.Z < 0.99 || math.Abs(boundary.Outward.X) > 1e-9 {
		t.Fatalf("unexpected end-wall normal at ramp start: %+v", boundary.Outward)
	}
}
