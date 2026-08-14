package game

import "math"

// Basketball/Hoops keeps the normal enclosed arena but replaces the two soccar
// goal tunnels with elevated hoops. These dimensions scale from the configured
// arena length so physics-mutator lobbies still keep the baskets in-bounds.
const (
	basketballHoopHeight             = 6.1
	basketballRimRadius              = 12.5
	basketballRimTubeRadius          = 0.96
	basketballHoopWallInset          = 11.5
	basketballBackboardOffset        = 6.8
	basketballBackboardWidth         = 10.4
	basketballBackboardHeight        = 5.9
	basketballBackboardBottom        = 6.3
	basketballBackboardDepth         = 0.72
	basketballBackboardBeamThickness = 0.9
	basketballNetBottomRadius        = 14.2
	basketballNetDepth               = 6.1
	basketballNetThickness           = 0.18
	basketballNetTopInset            = 0.12
)

type basketballHoop struct {
	Sign            int
	Center          Vec3
	RimRadius       float64
	RimTubeRadius   float64
	BackboardCenter Vec3
	BackboardHalf   Vec3
}

type basketballBackboardBox struct {
	Center Vec3
	Half   Vec3
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

func basketballBackboardBoxes(hoop basketballHoop) [4]basketballBackboardBox {
	beamHalf := basketballBackboardBeamThickness * 0.5
	bottomCenterY := basketballBackboardBottom + beamHalf
	topCenterY := basketballBackboardBottom + basketballBackboardHeight - beamHalf
	halfWidth := basketballBackboardWidth * 0.5
	return [4]basketballBackboardBox{
		{
			Center: Vec3{Y: bottomCenterY, Z: hoop.BackboardCenter.Z},
			Half:   Vec3{X: halfWidth, Y: beamHalf, Z: basketballBackboardDepth * 0.5},
		},
		{
			Center: Vec3{Y: topCenterY, Z: hoop.BackboardCenter.Z},
			Half:   Vec3{X: halfWidth, Y: beamHalf, Z: basketballBackboardDepth * 0.5},
		},
		{
			Center: Vec3{X: -halfWidth + beamHalf, Y: hoop.BackboardCenter.Y, Z: hoop.BackboardCenter.Z},
			Half:   Vec3{X: beamHalf, Y: basketballBackboardHeight * 0.5, Z: basketballBackboardDepth * 0.5},
		},
		{
			Center: Vec3{X: halfWidth - beamHalf, Y: hoop.BackboardCenter.Y, Z: hoop.BackboardCenter.Z},
			Half:   Vec3{X: beamHalf, Y: basketballBackboardHeight * 0.5, Z: basketballBackboardDepth * 0.5},
		},
	}
}

func basketballNetProfile(hoop basketballHoop, t float64) (radius, y float64) {
	t = clamp(t, 0, 1)
	radius = hoop.RimRadius*0.98 + (basketballNetBottomRadius-hoop.RimRadius*0.98)*math.Pow(t, 0.82)
	y = hoop.Center.Y - (basketballNetTopInset + (basketballNetDepth-basketballNetTopInset)*math.Pow(t, 1.08))
	return radius, y
}

func basketballClosestPointOnNet(radial, y float64, hoop basketballHoop) (shellRadius, shellY float64) {
	const segments = 5
	bestDistanceSq := math.MaxFloat64
	prevRadius, prevY := basketballNetProfile(hoop, 0)
	shellRadius, shellY = prevRadius, prevY
	for index := 1; index <= segments; index++ {
		nextRadius, nextY := basketballNetProfile(hoop, float64(index)/segments)
		deltaRadius := nextRadius - prevRadius
		deltaY := nextY - prevY
		segmentLengthSq := deltaRadius*deltaRadius + deltaY*deltaY
		segmentT := 0.0
		if segmentLengthSq > 1e-9 {
			segmentT = ((radial-prevRadius)*deltaRadius + (y-prevY)*deltaY) / segmentLengthSq
			segmentT = clamp(segmentT, 0, 1)
		}
		candidateRadius := prevRadius + deltaRadius*segmentT
		candidateY := prevY + deltaY*segmentT
		distanceSq := (radial-candidateRadius)*(radial-candidateRadius) + (y-candidateY)*(y-candidateY)
		if distanceSq < bestDistanceSq {
			bestDistanceSq = distanceSq
			shellRadius = candidateRadius
			shellY = candidateY
		}
		prevRadius, prevY = nextRadius, nextY
	}
	return shellRadius, shellY
}

func resolveBallBasketballHoops(ball *Ball, config Config) {
	for _, sign := range []int{-1, 1} {
		hoop := basketballHoopFor(config, sign)
		resolveBallBackboard(ball, config, hoop)
		resolveBallRim(ball, config, hoop)
		resolveBallNet(ball, config, hoop)
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

func resolveBallNet(ball *Ball, config Config, hoop basketballHoop) {
	dx := ball.Position.X - hoop.Center.X
	dz := ball.Position.Z - hoop.Center.Z
	radial := math.Hypot(dx, dz)
	shellRadius, shellY := basketballClosestPointOnNet(radial, ball.Position.Y, hoop)
	deltaRadius := radial - shellRadius
	deltaY := ball.Position.Y - shellY
	distance := math.Hypot(deltaRadius, deltaY)
	minimum := config.Ball.Radius + basketballNetThickness
	if distance >= minimum {
		return
	}

	radialX := 1.0
	radialZ := 0.0
	if radial > 1e-9 {
		radialX = dx / radial
		radialZ = dz / radial
	}
	normal := Vec3{X: radialX * deltaRadius, Y: deltaY, Z: radialZ * deltaRadius}.NormalizeOr(Vec3{Y: 1})
	resolveBodyIntoPlayable(&ball.Body, normal, minimum-distance+0.001, config.Ball.Restitution)
}

func resolveBallBackboard(ball *Ball, config Config, hoop basketballHoop) {
	for _, box := range basketballBackboardBoxes(hoop) {
		minPoint := box.Center.Sub(box.Half)
		maxPoint := box.Center.Add(box.Half)
		closest := Vec3{
			X: clamp(ball.Position.X, minPoint.X, maxPoint.X),
			Y: clamp(ball.Position.Y, minPoint.Y, maxPoint.Y),
			Z: clamp(ball.Position.Z, minPoint.Z, maxPoint.Z),
		}
		delta := ball.Position.Sub(closest)
		distance := delta.Length()
		if distance >= config.Ball.Radius {
			continue
		}

		if distance > 1e-9 {
			normal := delta.Mul(1 / distance)
			resolveBodyIntoPlayable(&ball.Body, normal, config.Ball.Radius-distance+0.001, config.Ball.Restitution)
			return
		}

		// Sphere center ended up inside one beam. Push it out through the nearest
		// face rather than choosing an arbitrary normal.
		dx := box.Half.X - math.Abs(ball.Position.X-box.Center.X)
		dy := box.Half.Y - math.Abs(ball.Position.Y-box.Center.Y)
		dz := box.Half.Z - math.Abs(ball.Position.Z-box.Center.Z)
		normal := Vec3{Z: -float64(hoop.Sign)}
		penetration := dz + config.Ball.Radius
		if dx < dz && dx <= dy {
			normal = Vec3{X: nonZeroSign(ball.Position.X - box.Center.X)}
			penetration = dx + config.Ball.Radius
		} else if dy < dz && dy < dx {
			normal = Vec3{Y: nonZeroSign(ball.Position.Y - box.Center.Y)}
			penetration = dy + config.Ball.Radius
		}
		resolveBodyIntoPlayable(&ball.Body, normal, penetration+0.001, config.Ball.Restitution)
		return
	}
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
	for _, box := range basketballBackboardBoxes(hoop) {
		delta := car.Position.Sub(box.Center)
		penetrationX := box.Half.X + extentX - math.Abs(delta.X)
		penetrationY := box.Half.Y + extentY - math.Abs(delta.Y)
		penetrationZ := box.Half.Z + extentZ - math.Abs(delta.Z)
		if penetrationX <= 0 || penetrationY <= 0 || penetrationZ <= 0 {
			continue
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
		return
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
