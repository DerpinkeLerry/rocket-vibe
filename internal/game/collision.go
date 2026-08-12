package game

import "math"

func resolveCarArena(car *Car, config Config) {
	half := config.Car.HalfExtents
	extentX, extentY, extentZ := projectedExtents(car.Rotation, half)
	resolveCarFloorAndCeiling(car, config, extentY)

	halfLength := config.Arena.Length * 0.5
	absX := math.Abs(car.Position.X)
	goalHalfWidth := config.Arena.GoalWidth * 0.5
	goalFits := absX+extentX <= goalHalfWidth &&
		car.Position.Y+extentY <= config.Arena.GoalHeight
	if boundary, ok := nearestArenaBoundary(car.Position, config.Arena, goalFits); ok {
		resolveCarBoundary(car, config, boundary)
	}

	if math.Abs(car.Position.Z) > halfLength-0.02 {
		resolveGoalCar(car, config, extentX, extentY, extentZ)
	}
}

func resolveCarFloorAndCeiling(car *Car, config Config, extentY float64) {
	if floorExistsAt(car.Position, config.Arena) {
		penetration := extentY - car.Position.Y
		if penetration > 0 {
			car.Position.Y += penetration
			if car.Velocity.Y < 0 {
				// Cars settle on the floor. Returning landing energy here made a
				// late network correction look like a spring launching the car.
				car.Velocity.Y = 0
			}
		}
		up := car.Rotation.Rotate(Vec3{Y: 1})
		if penetration >= -0.04 && up.Y > 0.3 && car.GroundLockout <= 0 {
			car.Grounded = true
			car.GroundNormal = Vec3{Y: 1}
		}
	}

	resolveBodyMaximum(&car.Body, 1, config.Arena.Ceiling, extentY, config.Car.Restitution)
}

type arenaBoundary struct {
	Distance float64
	Outward  Vec3
}

func nearestArenaBoundary(position Vec3, arena ArenaConfig, goalOpening bool) (arenaBoundary, bool) {
	halfWidth := arena.Width * 0.5
	halfLength := arena.Length * 0.5
	straightX := halfWidth - arena.CornerRadius
	straightZ := halfLength - arena.CornerRadius
	absX := math.Abs(position.X)
	absZ := math.Abs(position.Z)

	if absX > straightX && absZ > straightZ {
		center := Vec3{X: nonZeroSign(position.X) * straightX, Z: nonZeroSign(position.Z) * straightZ}
		delta := position.Sub(center)
		delta.Y = 0
		distance := delta.Length()
		if distance < 1e-9 {
			return arenaBoundary{}, false
		}
		return arenaBoundary{
			Distance: arena.CornerRadius - distance,
			Outward:  delta.Mul(1 / distance),
		}, true
	}

	best := arenaBoundary{Distance: math.MaxFloat64}
	found := false
	if absZ <= straightZ {
		best = arenaBoundary{
			Distance: halfWidth - absX,
			Outward:  Vec3{X: nonZeroSign(position.X)},
		}
		found = true
	}
	if absX <= straightX && !goalOpening {
		end := arenaBoundary{
			Distance: halfLength - absZ,
			Outward:  Vec3{Z: nonZeroSign(position.Z)},
		}
		if !found || end.Distance < best.Distance {
			best = end
		}
		found = true
	}
	return best, found
}

func resolveCarBoundary(car *Car, config Config, boundary arenaBoundary) {
	rampRadius := config.Arena.RampRadius
	outward := boundary.Outward
	inward := outward.Mul(-1)
	up := Vec3{Y: 1}
	horizontal := rampRadius - boundary.Distance
	vertical := car.Position.Y - rampRadius

	// The lower wall is a quarter circle. Its contact normal continuously turns
	// from world-up into the inward wall normal, so cars can drive onto glass.
	if horizontal >= 0 && vertical <= 0 {
		radial := outward.Mul(horizontal).Add(up.Mul(vertical))
		distance := radial.Length()
		if distance > 1e-9 {
			normal := radial.Mul(-1 / distance)
			support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, normal)
			maximumDistance := math.Max(0.1, rampRadius-support)
			penetration := distance - maximumDistance
			if penetration > 0 {
				resolveBodyIntoPlayable(&car.Body, normal, penetration, config.Car.Restitution)
				markCarSurfaceContact(car, normal)
				return
			}
		}
	}

	support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, inward)
	penetration := support - boundary.Distance
	if penetration > 0 {
		resolveBodyIntoPlayable(&car.Body, inward, penetration, config.Car.Restitution)
		markCarSurfaceContact(car, inward)
		car.AngularVelocity = car.AngularVelocity.Mul(0.985)
	}
}

func markCarSurfaceContact(car *Car, normal Vec3) {
	if car.GroundLockout > 0 {
		return
	}
	up := car.Rotation.Rotate(Vec3{Y: 1})
	if up.Dot(normal) <= 0.1 {
		return
	}
	car.Grounded = true
	car.GroundNormal = normal.NormalizeOr(Vec3{Y: 1})
}

func resolveGoalCar(car *Car, config Config, extentX, extentY, extentZ float64) {
	halfLength := config.Arena.Length * 0.5
	goalHalfWidth := config.Arena.GoalWidth * 0.5
	goalBack := halfLength + config.Arena.GoalDepth
	if math.Abs(car.Position.Z) > goalBack+extentZ+1 {
		return
	}

	resolveBodyMinimum(&car.Body, 0, -goalHalfWidth, extentX, config.Car.Restitution)
	resolveBodyMaximum(&car.Body, 0, goalHalfWidth, extentX, config.Car.Restitution)
	resolveBodyMaximum(&car.Body, 1, config.Arena.GoalHeight, extentY, config.Car.Restitution)

	if car.Position.Z > 0 {
		resolveBodyMaximum(&car.Body, 2, goalBack, extentZ, config.Car.Restitution)
	} else {
		resolveBodyMinimum(&car.Body, 2, -goalBack, extentZ, config.Car.Restitution)
	}
}

func resolveBallArena(ball *Ball, config Config) {
	radius := config.Ball.Radius
	halfLength := config.Arena.Length * 0.5

	if floorExistsAt(ball.Position, config.Arena) {
		penetration := radius - ball.Position.Y
		if penetration > 0 {
			ball.Position.Y += penetration
			if ball.Velocity.Y < -0.4 {
				ball.Velocity.Y = -ball.Velocity.Y * config.Ball.Restitution
			} else if ball.Velocity.Y < 0 {
				ball.Velocity.Y = 0
			}
			friction := math.Exp(-config.Ball.Friction * 0.12)
			ball.Velocity.X *= friction
			ball.Velocity.Z *= friction
			rolling := Vec3{X: ball.Velocity.Z / radius, Z: -ball.Velocity.X / radius}
			ball.AngularVelocity.X = lerp(ball.AngularVelocity.X, rolling.X, 0.04)
			ball.AngularVelocity.Z = lerp(ball.AngularVelocity.Z, rolling.Z, 0.04)
		}
	}
	resolveBodyMaximum(&ball.Body, 1, config.Arena.Ceiling, radius, config.Ball.Restitution)

	absX := math.Abs(ball.Position.X)
	goalHalfWidth := config.Arena.GoalWidth * 0.5
	goalFits := absX+radius <= goalHalfWidth &&
		ball.Position.Y+radius <= config.Arena.GoalHeight
	if boundary, ok := nearestArenaBoundary(ball.Position, config.Arena, goalFits); ok {
		resolveBallBoundary(ball, config, boundary)
	}

	if math.Abs(ball.Position.Z) > halfLength-0.02 {
		goalBack := halfLength + config.Arena.GoalDepth
		resolveBodyMinimum(&ball.Body, 0, -goalHalfWidth, radius, config.Ball.Restitution)
		resolveBodyMaximum(&ball.Body, 0, goalHalfWidth, radius, config.Ball.Restitution)
		resolveBodyMaximum(&ball.Body, 1, config.Arena.GoalHeight, radius, config.Ball.Restitution)
		if ball.Position.Z > 0 {
			resolveBodyMaximum(&ball.Body, 2, goalBack, radius, config.Ball.Restitution)
		} else {
			resolveBodyMinimum(&ball.Body, 2, -goalBack, radius, config.Ball.Restitution)
		}
	}
}

func resolveBallBoundary(ball *Ball, config Config, boundary arenaBoundary) {
	rampRadius := config.Arena.RampRadius
	outward := boundary.Outward
	inward := outward.Mul(-1)
	horizontal := rampRadius - boundary.Distance
	vertical := ball.Position.Y - rampRadius

	if horizontal >= 0 && vertical <= 0 {
		radial := outward.Mul(horizontal).Add(Vec3{Y: vertical})
		distance := radial.Length()
		maximumDistance := math.Max(0.1, rampRadius-config.Ball.Radius)
		penetration := distance - maximumDistance
		if penetration > 0 && distance > 1e-9 {
			normal := radial.Mul(-1 / distance)
			resolveBodyIntoPlayable(&ball.Body, normal, penetration, config.Ball.Restitution)
			return
		}
	}

	penetration := config.Ball.Radius - boundary.Distance
	if penetration > 0 {
		resolveBodyIntoPlayable(&ball.Body, inward, penetration, config.Ball.Restitution)
	}
}

func floorExistsAt(position Vec3, arena ArenaConfig) bool {
	halfLength := arena.Length * 0.5
	if math.Abs(position.Z) <= halfLength {
		return math.Abs(position.X) <= arena.Width*0.5+2
	}
	return math.Abs(position.Z) <= halfLength+arena.GoalDepth+1 &&
		math.Abs(position.X) <= arena.GoalWidth*0.5+1
}

func orientedBoxSupport(rotation Quat, half Vec3, normal Vec3) float64 {
	right := rotation.Rotate(Vec3{X: 1})
	up := rotation.Rotate(Vec3{Y: 1})
	forward := rotation.Rotate(Vec3{Z: -1})
	return math.Abs(right.Dot(normal))*half.X +
		math.Abs(up.Dot(normal))*half.Y +
		math.Abs(forward.Dot(normal))*half.Z
}

// normal points from the solid surface into the playable volume.
func resolveBodyIntoPlayable(body *Body, normal Vec3, penetration, restitution float64) {
	body.Position = body.Position.Add(normal.Mul(penetration))
	intoSurfaceSpeed := body.Velocity.Dot(normal)
	if intoSurfaceSpeed < 0 {
		body.Velocity = body.Velocity.Sub(normal.Mul((1 + restitution) * intoSurfaceSpeed))
	}
}

// projectedExtents returns the world-axis AABB extents of an oriented box.
func projectedExtents(rotation Quat, half Vec3) (float64, float64, float64) {
	right := rotation.Rotate(Vec3{X: 1})
	up := rotation.Rotate(Vec3{Y: 1})
	forward := rotation.Rotate(Vec3{Z: 1})
	return math.Abs(right.X)*half.X + math.Abs(up.X)*half.Y + math.Abs(forward.X)*half.Z,
		math.Abs(right.Y)*half.X + math.Abs(up.Y)*half.Y + math.Abs(forward.Y)*half.Z,
		math.Abs(right.Z)*half.X + math.Abs(up.Z)*half.Y + math.Abs(forward.Z)*half.Z
}

// resolveBodyMinimum constrains the negative side of one body axis. The wall
// coordinate is the inner face and extent is the body's projected half-size.
func resolveBodyMinimum(body *Body, axis int, wall, extent, restitution float64) {
	position := axisValue(body.Position, axis)
	penetration := wall - (position - extent)
	if penetration <= 0 {
		return
	}
	setAxisValue(&body.Position, axis, position+penetration)
	velocity := axisValue(body.Velocity, axis)
	if velocity < 0 {
		setAxisValue(&body.Velocity, axis, -velocity*restitution)
	}
}

func resolveBodyMaximum(body *Body, axis int, wall, extent, restitution float64) {
	position := axisValue(body.Position, axis)
	penetration := (position + extent) - wall
	if penetration <= 0 {
		return
	}
	setAxisValue(&body.Position, axis, position-penetration)
	velocity := axisValue(body.Velocity, axis)
	if velocity > 0 {
		setAxisValue(&body.Velocity, axis, -velocity*restitution)
	}
}

func axisValue(vector Vec3, axis int) float64 {
	switch axis {
	case 0:
		return vector.X
	case 1:
		return vector.Y
	default:
		return vector.Z
	}
}

func setAxisValue(vector *Vec3, axis int, value float64) {
	switch axis {
	case 0:
		vector.X = value
	case 1:
		vector.Y = value
	default:
		vector.Z = value
	}
}

func resolveCarCar(first, second *Car, config CarConfig) {
	_, firstExtentY, _ := projectedExtents(first.Rotation, config.HalfExtents)
	_, secondExtentY, _ := projectedExtents(second.Rotation, config.HalfExtents)
	if math.Abs(second.Position.Y-first.Position.Y) >= firstExtentY+secondExtentY+0.02 {
		return
	}

	rightA, forwardA := horizontalCarAxes(first.Rotation)
	rightB, forwardB := horizontalCarAxes(second.Rotation)
	delta := second.Position.Sub(first.Position)
	delta.Y = 0
	bestPenetration := math.MaxFloat64
	bestNormal := Vec3{X: 1}
	axes := [...]Vec3{rightA, forwardA, rightB, forwardB}
	for _, axis := range axes {
		axis = axis.NormalizeOr(Vec3{X: 1})
		distance := math.Abs(delta.Dot(axis))
		radiusA := config.HalfExtents.X*math.Abs(rightA.Dot(axis)) + config.HalfExtents.Z*math.Abs(forwardA.Dot(axis))
		radiusB := config.HalfExtents.X*math.Abs(rightB.Dot(axis)) + config.HalfExtents.Z*math.Abs(forwardB.Dot(axis))
		penetration := radiusA + radiusB - distance
		if penetration <= 0 {
			return
		}
		if penetration < bestPenetration {
			bestPenetration = penetration
			bestNormal = axis
			if delta.Dot(bestNormal) < 0 {
				bestNormal = bestNormal.Mul(-1)
			}
		}
	}

	correction := bestNormal.Mul(bestPenetration*0.5 + 0.0005)
	first.Position = first.Position.Sub(correction)
	second.Position = second.Position.Add(correction)
	relativeVelocity := second.Velocity.Sub(first.Velocity)
	closingSpeed := relativeVelocity.Dot(bestNormal)
	if closingSpeed >= 0 {
		return
	}
	inverseMass := 1 / config.Mass
	impulseMagnitude := -(1 + config.Restitution) * closingSpeed / (inverseMass * 2)
	impulse := bestNormal.Mul(impulseMagnitude)
	first.Velocity = first.Velocity.Sub(impulse.Mul(inverseMass))
	second.Velocity = second.Velocity.Add(impulse.Mul(inverseMass))
}

func horizontalCarAxes(rotation Quat) (Vec3, Vec3) {
	right := rotation.Rotate(Vec3{X: 1})
	forward := rotation.Rotate(Vec3{Z: -1})
	right.Y = 0
	forward.Y = 0
	forward = forward.NormalizeOr(Vec3{Z: -1})
	right = right.NormalizeOr(Vec3{X: 1})
	return right, forward
}

func resolveCarBall(car *Car, ball *Ball, config Config) {
	contact, normal, penetration, hit := sphereOBBContact(ball.Position, config.Ball.Radius, car.Body, config.Car.HalfExtents)
	if !hit {
		return
	}

	inverseCarMass := 1 / config.Car.Mass
	inverseBallMass := 1 / config.Ball.Mass
	inverseMassSum := inverseCarMass + inverseBallMass
	ballShare := inverseBallMass / inverseMassSum
	carShare := inverseCarMass / inverseMassSum
	correction := normal.Mul(penetration + 0.0005)
	ball.Position = ball.Position.Add(correction.Mul(ballShare))
	car.Position = car.Position.Sub(correction.Mul(carShare))

	carRadius := contact.Sub(car.Position)
	carPointVelocity := car.Velocity.Add(car.AngularVelocity.Cross(carRadius))
	relativeVelocity := ball.Velocity.Sub(carPointVelocity)
	closingSpeed := relativeVelocity.Dot(normal)
	if closingSpeed >= 0 {
		return
	}

	carInverseInertia := 1 / carAverageInertia(config.Car)
	ballInverseInertia := 1 / (0.4 * config.Ball.Mass * config.Ball.Radius * config.Ball.Radius)
	angularArm := carRadius.Cross(normal)
	angularTerm := angularArm.LengthSquared() * carInverseInertia
	denominator := inverseMassSum + angularTerm
	restitution := math.Max(config.Car.Restitution, config.Ball.Restitution)
	impulseMagnitude := -(1 + restitution) * closingSpeed / denominator
	normalImpulse := normal.Mul(impulseMagnitude)
	applyCarBallImpulse(car, ball, contact, normalImpulse, config, carInverseInertia, ballInverseInertia)

	// A small Coulomb friction impulse gives glancing hits and rolling balls a
	// useful amount of spin without making the arcade car feel sticky.
	carPointVelocity = car.Velocity.Add(car.AngularVelocity.Cross(contact.Sub(car.Position)))
	relativeVelocity = ball.Velocity.Sub(carPointVelocity)
	tangent := relativeVelocity.Sub(normal.Mul(relativeVelocity.Dot(normal)))
	if tangent.LengthSquared() > 1e-8 {
		tangent = tangent.NormalizeOr(Vec3{})
		frictionMagnitude := -relativeVelocity.Dot(tangent) / denominator
		maximumFriction := impulseMagnitude * 0.18
		frictionMagnitude = clamp(frictionMagnitude, -maximumFriction, maximumFriction)
		applyCarBallImpulse(car, ball, contact, tangent.Mul(frictionMagnitude), config, carInverseInertia, ballInverseInertia)
	}
}

func applyCarBallImpulse(car *Car, ball *Ball, contact Vec3, impulse Vec3, config Config, carInverseInertia, ballInverseInertia float64) {
	car.Velocity = car.Velocity.Sub(impulse.Mul(1 / config.Car.Mass))
	ball.Velocity = ball.Velocity.Add(impulse.Mul(1 / config.Ball.Mass))
	carArm := contact.Sub(car.Position)
	car.AngularVelocity = car.AngularVelocity.Sub(carArm.Cross(impulse).Mul(carInverseInertia))
	ballArm := contact.Sub(ball.Position)
	ball.AngularVelocity = ball.AngularVelocity.Add(ballArm.Cross(impulse).Mul(ballInverseInertia))
}

func carAverageInertia(config CarConfig) float64 {
	width := config.HalfExtents.X * 2
	height := config.HalfExtents.Y * 2
	length := config.HalfExtents.Z * 2
	iX := config.Mass * (height*height + length*length) / 12
	iY := config.Mass * (width*width + length*length) / 12
	iZ := config.Mass * (width*width + height*height) / 12
	return (iX + iY + iZ) / 3
}

// sphereOBBContact returns a world-space contact point on the car, an outward
// normal from car to sphere and penetration depth.
func sphereOBBContact(center Vec3, radius float64, box Body, half Vec3) (Vec3, Vec3, float64, bool) {
	rotation := box.Rotation.Normalize()
	localCenter := rotation.Conjugate().Rotate(center.Sub(box.Position))
	closest := Vec3{
		X: clamp(localCenter.X, -half.X, half.X),
		Y: clamp(localCenter.Y, -half.Y, half.Y),
		Z: clamp(localCenter.Z, -half.Z, half.Z),
	}
	delta := localCenter.Sub(closest)
	distanceSquared := delta.LengthSquared()
	if distanceSquared >= radius*radius {
		return Vec3{}, Vec3{}, 0, false
	}

	var normalLocal Vec3
	penetration := 0.0
	if distanceSquared > 1e-12 {
		distance := math.Sqrt(distanceSquared)
		normalLocal = delta.Mul(1 / distance)
		penetration = radius - distance
	} else {
		distanceX := half.X - math.Abs(localCenter.X)
		distanceY := half.Y - math.Abs(localCenter.Y)
		distanceZ := half.Z - math.Abs(localCenter.Z)
		switch {
		case distanceX <= distanceY && distanceX <= distanceZ:
			normalLocal.X = nonZeroSign(localCenter.X)
			closest.X = normalLocal.X * half.X
			penetration = radius + distanceX
		case distanceY <= distanceZ:
			normalLocal.Y = nonZeroSign(localCenter.Y)
			closest.Y = normalLocal.Y * half.Y
			penetration = radius + distanceY
		default:
			normalLocal.Z = nonZeroSign(localCenter.Z)
			closest.Z = normalLocal.Z * half.Z
			penetration = radius + distanceZ
		}
	}

	contact := box.Position.Add(rotation.Rotate(closest))
	normal := rotation.Rotate(normalLocal).NormalizeOr(Vec3{Y: 1})
	return contact, normal, penetration, true
}

func nonZeroSign(value float64) float64 {
	if value < 0 {
		return -1
	}
	return 1
}
