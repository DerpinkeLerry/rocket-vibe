package game

import "testing"

func TestNormalizeGameModeDefaultsToNormalAndAcceptsBasketballAliases(t *testing.T) {
	if got := NormalizeGameMode(""); got != GameModeNormal {
		t.Fatalf("empty mode = %q, want %q", got, GameModeNormal)
	}
	for _, input := range []string{"basketball", "HOOPS", " basket "} {
		if got := NormalizeGameMode(input); got != GameModeBasketball {
			t.Fatalf("NormalizeGameMode(%q) = %q, want %q", input, got, GameModeBasketball)
		}
	}
}

func TestBasketballGoalCountsOnlyDownwardPassThroughRim(t *testing.T) {
	config := DefaultConfig()
	config.GameMode = GameModeBasketball
	world := NewWorld(config)
	hoop := basketballHoopFor(config, 1)

	world.PreviousBallPosition = Vec3{Y: hoop.Center.Y + 0.8, Z: hoop.Center.Z}
	world.Ball.Position = Vec3{Y: hoop.Center.Y - 0.3, Z: hoop.Center.Z}
	world.Ball.Velocity = Vec3{Y: -12}
	if !world.detectGoal() {
		t.Fatal("downward ball through hoop did not score")
	}
	if world.BlueScore != 1 || world.OrangeScore != 0 {
		t.Fatalf("unexpected score: orange=%d blue=%d", world.OrangeScore, world.BlueScore)
	}
	if world.LastGoalSign != 1 || world.LastGoalScoringTeam != TeamBlue {
		t.Fatalf("unexpected goal metadata: sign=%d team=%q", world.LastGoalSign, world.LastGoalScoringTeam)
	}

	world.ResetKickoff()
	world.PreviousBallPosition = Vec3{Y: hoop.Center.Y - 0.8, Z: hoop.Center.Z}
	world.Ball.Position = Vec3{Y: hoop.Center.Y + 0.3, Z: hoop.Center.Z}
	world.Ball.Velocity = Vec3{Y: 12}
	if world.detectGoal() {
		t.Fatal("ball rising through the hoop from below must not score")
	}
}

func TestBasketballModeClosesSoccarGoalOpening(t *testing.T) {
	config := DefaultConfig()
	config.GameMode = GameModeBasketball
	halfLength := config.Arena.Length * 0.5
	ball := Ball{Body: Body{
		Position: Vec3{Y: config.Ball.Radius + 0.2, Z: halfLength + config.Ball.Radius*0.8},
		Velocity: Vec3{Z: 18},
		Rotation: IdentityQuat(),
	}}

	resolveBallArena(&ball, config)
	maximumZ := halfLength - config.Ball.Radius + 0.08
	if ball.Position.Z > maximumZ {
		t.Fatalf("basketball end wall still has soccar opening: z=%f want <= %f", ball.Position.Z, maximumZ)
	}
	if ball.Velocity.Z > 0.01 {
		t.Fatalf("ball kept moving through closed basketball end wall: %+v", ball.Velocity)
	}
}

func TestBasketballRimDeflectsBall(t *testing.T) {
	config := DefaultConfig()
	config.GameMode = GameModeBasketball
	hoop := basketballHoopFor(config, -1)
	ball := Ball{Body: Body{
		Position: Vec3{X: hoop.RimRadius + 0.1, Y: hoop.Center.Y, Z: hoop.Center.Z},
		Velocity: Vec3{X: -8},
		Rotation: IdentityQuat(),
	}}

	resolveBallBasketballHoops(&ball, config)
	if ball.Position.X <= hoop.RimRadius {
		t.Fatalf("rim did not separate ball from torus: x=%f", ball.Position.X)
	}
	if ball.Velocity.X <= 0 {
		t.Fatalf("rim did not reflect incoming ball: %+v", ball.Velocity)
	}
}

func TestBasketballRimDeflectsCar(t *testing.T) {
	config := DefaultConfig()
	config.GameMode = GameModeBasketball
	hoop := basketballHoopFor(config, 1)
	car := Car{Body: Body{
		Position: Vec3{X: hoop.RimRadius + 0.2, Y: hoop.Center.Y, Z: hoop.Center.Z},
		Velocity: Vec3{X: -8},
		Rotation: IdentityQuat(),
	}}

	resolveCarBasketballHoops(&car, config)
	if car.Position.X <= hoop.RimRadius+0.2 {
		t.Fatalf("rim did not separate car: x=%f", car.Position.X)
	}
	if car.Velocity.X < -0.01 {
		t.Fatalf("rim did not stop/reflect incoming car: %+v", car.Velocity)
	}
}

func TestBasketballNetFlaresOutward(t *testing.T) {
	config := DefaultConfig()
	config.GameMode = GameModeBasketball
	hoop := basketballHoopFor(config, 1)
	topRadius, _ := basketballNetProfile(hoop, 0)
	bottomRadius, _ := basketballNetProfile(hoop, 1)
	if bottomRadius <= topRadius {
		t.Fatalf("net should flare outward: top=%f bottom=%f", topRadius, bottomRadius)
	}
}

func TestBasketballNetTouchesFloor(t *testing.T) {
	config := DefaultConfig()
	config.GameMode = GameModeBasketball
	hoop := basketballHoopFor(config, 1)
	_, y := basketballNetProfile(hoop, 1)
	if y < -1e-6 || y > 1e-6 {
		t.Fatalf("net bottom y = %f, want 0", y)
	}
}

func TestBasketballNetDeflectsBall(t *testing.T) {
	config := DefaultConfig()
	config.GameMode = GameModeBasketball
	hoop := basketballHoopFor(config, -1)
	netRadius, netY := basketballNetProfile(hoop, 0.55)
	startX := netRadius + config.Ball.Radius + basketballNetThickness - 0.05
	ball := Ball{Body: Body{
		Position: Vec3{X: startX, Y: netY, Z: hoop.Center.Z},
		Velocity: Vec3{X: -6},
		Rotation: IdentityQuat(),
	}}

	resolveBallBasketballHoops(&ball, config)
	if ball.Position.X <= startX {
		t.Fatalf("net did not separate ball: x=%f start=%f", ball.Position.X, startX)
	}
	if ball.Velocity.X <= 0 {
		t.Fatalf("net did not reflect incoming ball: %+v", ball.Velocity)
	}
}
