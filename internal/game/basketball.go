package game

import "math"

// Basketball/Hoops keeps the normal enclosed arena but replaces the two soccar
// goal tunnels with elevated hoops. These dimensions scale from the configured
// arena length so physics-mutator lobbies still keep the baskets in-bounds.
const (
	basketballHoopHeight      = 10.5
	basketballRimRadius       = 6.6
	basketballRimTubeRadius   = 0.42
	basketballHoopWallInset   = 11.5
	basketballBackboardOffset = 4.2
	basketballBackboardWidth  = 20.0
	basketballBackboardHeight = 9.2
	basketballBackboardBottom = 7.2
	basketballBackboardDepth  = 0.55
)

type basketballHoop struct {
	Sign            int
	Center          Vec3
	RimRadius       float64
	RimTubeRadius   float64
	BackboardCenter Vec3
	BackboardHalf   Vec3
}

func basketballHoopFor(config Config, sign int) basketballHoop {
	if sign >= 0 {
		sign = 1
	} else {
		sign = -1
	}
	halfLength := config.Arena.Length * 0.5
	rimZ := float64(sign) * (halfLength - basketballHoopWallInset)
	backboardZ := rimZ + float64(sign)*basketballBackboardOffset
	backboardCenterY := basketballBackboardBottom + basketballBackboardHeight*0.5
	return basketballHoop{
		Sign:          sign,
		Center:        Vec3{Y: basketballHoopHeight, Z: rimZ},
		RimRadius:     basketballRimRadius,
		RimTubeRadius: basketballRimTubeRadius,
		BackboardCenter: Vec3{
			Y: backboardCenterY,
			Z: backboardZ,
		},
		BackboardHalf: Vec3{
			X: basketballBackboardWidth * 0.5,
			Y: basketballBackboardHeight * 0.5,
			Z: basketballBackboardDepth * 0.5,
		},
	}
}

func basketballScoreRadius(config Config) float64 {
	// Require the whole ball to fit through the inside of the rim. A very small
	// tolerance avoids numerical edge cases where the sphere grazes the torus.
	return math.Max(0.05, basketballRimRadius-basketballRimTubeRadius-config.Ball.Radius+0.08)
}

func resolveBallBasketballHoops(ball *Ball, config Config) {
	for _, sign := range []int{-1, 1} {
		hoop := basketballHoopFor(config, sign)
		resolveBallBackboard(ball, config, hoop)
		resolveBallRim(ball, config, hoop)
	}
}

func resolveBallRim(ball *Ball, config Config, hoop basketballHoop) {
	dx := ball.Position.X - hoop.Center.X
	dz := ball.Position.Z - hoop.Center.Z
	radial := math.Hypot(dx, dz)
	var closest Vec3
	if radial > 1e-9 {
		scale := hoop.RimRadius / radial
		closest = Vec3{X: hoop.Center.X + dx*scale, Y: hoop.Center.Y, Z: hoop.Center.Z + dz*scale}
	} else {
		closest = Vec3{X: hoop.Center.X + hoop.RimRadius, Y: hoop.Center.Y, Z: hoop.Center.Z}
	}

	delta := ball.Position.Sub(closest)
	distance := delta.Length()
	minimum := config.Ball.Radius + hoop.RimTubeRadius
	if distance >= minimum {
		return
	}
	normal := delta.NormalizeOr(Vec3{Y: 1})
	resolveBodyIntoPlayable(&ball.Body, normal, minimum-distance+0.001, config.Ball.Restitution)
}

func resolveBallBackboard(ball *Ball, config Config, hoop basketballHoop) {
	minPoint := hoop.BackboardCenter.Sub(hoop.BackboardHalf)
	maxPoint := hoop.BackboardCenter.Add(hoop.BackboardHalf)
	closest := Vec3{
		X: clamp(ball.Position.X, minPoint.X, maxPoint.X),
		Y: clamp(ball.Position.Y, minPoint.Y, maxPoint.Y),
		Z: clamp(ball.Position.Z, minPoint.Z, maxPoint.Z),
	}
	delta := ball.Position.Sub(closest)
	distance := delta.Length()
	if distance >= config.Ball.Radius {
		return
	}

	if distance > 1e-9 {
		normal := delta.Mul(1 / distance)
		resolveBodyIntoPlayable(&ball.Body, normal, config.Ball.Radius-distance+0.001, config.Ball.Restitution)
		return
	}

	// Sphere center ended up inside the thin backboard slab. Push it out through
	// the nearest face rather than choosing an arbitrary normal.
	dx := hoop.BackboardHalf.X - math.Abs(ball.Position.X-hoop.BackboardCenter.X)
	dy := hoop.BackboardHalf.Y - math.Abs(ball.Position.Y-hoop.BackboardCenter.Y)
	dz := hoop.BackboardHalf.Z - math.Abs(ball.Position.Z-hoop.BackboardCenter.Z)
	normal := Vec3{Z: -float64(hoop.Sign)}
	penetration := dz + config.Ball.Radius
	if dx < dz && dx <= dy {
		normal = Vec3{X: nonZeroSign(ball.Position.X - hoop.BackboardCenter.X)}
		penetration = dx + config.Ball.Radius
	} else if dy < dz && dy < dx {
		normal = Vec3{Y: nonZeroSign(ball.Position.Y - hoop.BackboardCenter.Y)}
		penetration = dy + config.Ball.Radius
	}
	resolveBodyIntoPlayable(&ball.Body, normal, penetration+0.001, config.Ball.Restitution)
}

func resolveCarBasketballHoops(car *Car, config Config) {
	for _, sign := range []int{-1, 1} {
		hoop := basketballHoopFor(config, sign)
		resolveCarBackboard(car, config, hoop)
		resolveCarRim(car, config, hoop)
	}
}

func resolveCarBackboard(car *Car, config Config, hoop basketballHoop) {
	extentX, extentY, extentZ := projectedExtents(car.Rotation, config.Car.HalfExtents)
	delta := car.Position.Sub(hoop.BackboardCenter)
	penetrationX := hoop.BackboardHalf.X + extentX - math.Abs(delta.X)
	penetrationY := hoop.BackboardHalf.Y + extentY - math.Abs(delta.Y)
	penetrationZ := hoop.BackboardHalf.Z + extentZ - math.Abs(delta.Z)
	if penetrationX <= 0 || penetrationY <= 0 || penetrationZ <= 0 {
		return
	}

	normal := Vec3{Z: nonZeroSign(delta.Z)}
	penetration := penetrationZ
	if penetrationX < penetration {
		normal = Vec3{X: nonZeroSign(delta.X)}
		penetration = penetrationX
	}
	if penetrationY < penetration {
		normal = Vec3{Y: nonZeroSign(delta.Y)}
		penetration = penetrationY
	}
	resolveBodyIntoPlayable(&car.Body, normal, penetration+0.001, config.Car.Restitution)
	if math.Abs(normal.Y) > 0.8 {
		markCarSurfaceContact(car, normal)
	}
}

func resolveCarRim(car *Car, config Config, hoop basketballHoop) {
	dx := car.Position.X - hoop.Center.X
	dz := car.Position.Z - hoop.Center.Z
	radial := math.Hypot(dx, dz)
	closest := Vec3{X: hoop.Center.X + hoop.RimRadius, Y: hoop.Center.Y, Z: hoop.Center.Z}
	if radial > 1e-9 {
		scale := hoop.RimRadius / radial
		closest = Vec3{X: hoop.Center.X + dx*scale, Y: hoop.Center.Y, Z: hoop.Center.Z + dz*scale}
	}

	delta := car.Position.Sub(closest)
	distance := delta.Length()
	normal := delta.NormalizeOr(Vec3{Y: 1})
	support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, normal)
	minimum := hoop.RimTubeRadius + support
	if distance >= minimum {
		return
	}
	resolveBodyIntoPlayable(&car.Body, normal, minimum-distance+0.001, config.Car.Restitution)
	if normal.Y > 0.75 {
		markCarSurfaceContact(car, normal)
	}
}
