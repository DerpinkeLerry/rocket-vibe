package game

import "math"

// Rocket League uses Unreal Units (uu), with 100 uu equal to one metre.
// These constants are the SI-unit equivalents of the RLBot useful-game-values
// reference. Keeping the conversion in one place prevents arena and vehicle
// tuning from silently drifting onto different scales again.
const (
	UUPerMetre = 100.0

	// The exact RL dimensions looked undersized in Rocket Vibe's camera and
	// arena presentation. Cars and ball therefore use one shared 150% gameplay
	// scale while their masses, forces, speeds and response curves stay intact.
	GameplayObjectScale = 1.50

	RLArenaWidth        = 81.92
	RLArenaLength       = 102.40
	RLArenaCeiling      = 20.44
	RLArenaCornerRadius = 11.52
	RLArenaRampRadius   = 2.56
	RLGoalHeight        = 6.42775
	RLGoalWidth         = 17.85510
	RLGoalDepth         = 8.80

	RLGravity         = 6.50
	RLCarMass         = 180.0
	RLOctaneHalfWidth = 0.42100
	// The simplified box proxy uses the documented Octane centre elevation as
	// its floor support so an upright car rests at 17.01 uu.
	RLOctaneHalfHeight          = 0.17010
	RLOctaneHalfLength          = 0.59004
	RLCarMaxThrottleSpeed       = 14.10
	RLCarMaxSpeed               = 23.00
	RLSupersonicSpeed           = 22.00
	RLBoostConsumptionPerSecond = 33.3
	RLGroundBoostAcceleration   = 9.91666
	RLAirBoostAcceleration      = 10.58333
	RLBrakeAcceleration         = 35.0
	RLCoastDeceleration         = 5.25
	RLAirThrottleAcceleration   = 0.66667
	RLAirReverseAcceleration    = 0.33334
	RLJumpImpulse               = 2.92
	RLJumpHoldAcceleration      = 14.60
	RLJumpHoldDuration          = 0.20
	RLJumpMinimumHoldDuration   = 3.0 / 120.0
	RLJumpStickyAcceleration    = 3.25
	RLJumpStickyDuration        = 3.0 / 120.0
	RLDoubleJumpImpulse         = 2.91667
	RLAirYawAcceleration        = 9.11
	RLAirPitchAcceleration      = 12.46
	RLAirRollAcceleration       = 38.34
	RLMaxCarAngularSpeed        = 5.50
	RLFullSteerSpeed            = 12.34
	RLFullSteerTimeConstant     = 0.74704

	RLBallRadius          = 0.9125
	RLBallRestingHeight   = 0.9315
	RLBallMass            = 30.0
	RLBallRestitution     = 0.60
	RLBallMaxSpeed        = 60.0
	RLBallTerminalSpeed   = 212.68220703125
	RLBallMaxAngularSpeed = 6.0
	RLBallLinearDrag      = 0.030562030038766

	GameplayCarHalfWidth   = RLOctaneHalfWidth * GameplayObjectScale
	GameplayCarHalfHeight  = RLOctaneHalfHeight * GameplayObjectScale
	GameplayCarHalfLength  = RLOctaneHalfLength * GameplayObjectScale
	GameplayBallRadius     = RLBallRadius * GameplayObjectScale
	GameplayBallRestHeight = RLBallRestingHeight * GameplayObjectScale
)

// throttleAccelerationAtSpeed is the measured piecewise-linear throttle
// curve. Input and output use metres; the source measurements use uu.
func throttleAccelerationAtSpeed(speed float64) float64 {
	velocityUU := math.Abs(speed) * UUPerMetre
	switch {
	case velocityUU < 1400:
		return (1600 - (1440.0/1400.0)*velocityUU) / UUPerMetre
	case velocityUU < 1410:
		return (160 - 16*(velocityUU-1400)) / UUPerMetre
	default:
		return 0
	}
}

// turningCurvatureAtSpeed reproduces the RLBot piecewise curvature function.
// It returns inverse metres so multiplying it by m/s yields radians/second.
func turningCurvatureAtSpeed(speed float64) float64 {
	velocityUU := math.Abs(speed) * UUPerMetre
	var curvatureUU float64
	switch {
	case velocityUU < 500:
		curvatureUU = 0.006900 - 5.84e-6*velocityUU
	case velocityUU < 1000:
		curvatureUU = 0.005610 - 3.26e-6*velocityUU
	case velocityUU < 1500:
		curvatureUU = 0.004300 - 1.95e-6*velocityUU
	case velocityUU < 1750:
		curvatureUU = 0.003025 - 1.10e-6*velocityUU
	case velocityUU < 2500:
		curvatureUU = 0.001800 - 4.00e-7*velocityUU
	default:
		return 0
	}
	return math.Max(0, curvatureUU*UUPerMetre)
}

func turningAngularSpeed(speed, steer float64) float64 {
	return speed * turningCurvatureAtSpeed(speed) * clamp(steer, -1, 1)
}

// The measured full-steer deceleration trace starts at 2300 uu/s and settles
// at about 1234 uu/s after 7.5 seconds. Values are the net speed loss while
// throttle remains fully held.
func fullSteerDecelerationAtSpeed(speed float64) float64 {
	velocityUU := math.Abs(speed) * UUPerMetre
	var decelerationUU float64
	switch {
	case velocityUU <= 1234:
		return 0
	case velocityUU <= 1248:
		decelerationUU = 5.185
	case velocityUU <= 1270:
		decelerationUU = 27.5
	case velocityUU <= 1322:
		decelerationUU = 65
	case velocityUU <= 1401:
		decelerationUU = 131.667
	case velocityUU <= 1824:
		decelerationUU = 325.384615
	case velocityUU <= 2224:
		decelerationUU = 400
	case velocityUU <= 2290:
		decelerationUU = 330
	default:
		decelerationUU = 100
	}
	return decelerationUU / UUPerMetre
}
