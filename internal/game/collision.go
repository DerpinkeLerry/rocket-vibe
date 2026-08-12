package game

import "math"

const (
	surfaceContactSlop = 0.075
	ballRampSeamSlop   = 0.035
)

func resolveCarArena(car *Car, config Config) {
	half := config.Car.HalfExtents
	extentX, extentY, extentZ := projectedExtents(car.Rotation, half)

	halfLength := config.Arena.Length * 0.5
	goalOpeningHeight := car.Position.Y+extentY <= config.Arena.GoalHeight
	inGoal := goalTunnelContains(car.Position, config.Arena, extentX, extentY, extentZ)
	boundary, hasBoundary := nearestArenaBoundary(car.Position, config.Arena, goalOpeningHeight)

	if !inGoal {
		resolveCarFloorAndCeiling(car, config, extentY, boundary, hasBoundary)
	}
	if hasBoundary {
		resolveCarBoundary(car, config, boundary)
	}

	if inGoal || math.Abs(car.Position.Z)+extentZ > halfLength-surfaceContactSlop {
		resolveGoalCar(car, config, extentX, extentY, extentZ)
	}
}

func resolveCarFloorAndCeiling(car *Car, config Config, extentY float64, boundary arenaBoundary, hasBoundary bool) {
	lowerRampZone := hasBoundary && boundary.Distance < config.Arena.RampRadius+surfaceContactSlop &&
		car.Position.Y <= config.Arena.RampRadius+extentY+surfaceContactSlop
	if floorExistsAt(car.Position, config.Arena) && !lowerRampZone {
		penetration := extentY - car.Position.Y
		if penetration > 0 {
			car.Position.Y += penetration
			if car.Velocity.Y < 0 {
				// Cars settle on the floor. Returning landing energy here made a
				// late network correction look like a spring launching the car.
				car.Velocity.Y = 0
			}
		}
		if penetration >= -surfaceContactSlop {
			markCarSurfaceContact(car, Vec3{Y: 1})
		}
	}

	ceilingRampZone := hasBoundary && boundary.Distance < config.Arena.CeilingRampRadius+surfaceContactSlop &&
		car.Position.Y >= config.Arena.Ceiling-config.Arena.CeilingRampRadius-extentY-surfaceContactSlop
	if !ceilingRampZone {
		penetration := car.Position.Y + extentY - config.Arena.Ceiling
		if penetration > 0 {
			car.Position.Y -= penetration
			if car.Velocity.Y > 0 {
				car.Velocity.Y = -car.Velocity.Y * config.Car.Restitution
			}
		}
		if penetration >= -surfaceContactSlop {
			// An upside-down car may keep its wheels on the glass roof for a
			// short time. Gravity still wins slowly because the adhesion force is
			// intentionally a little weaker than world gravity on the ceiling.
			markCarSurfaceContact(car, Vec3{Y: -1})
		}
	}
}

type arenaBoundary struct {
	Distance float64
	Outward  Vec3
}

func nearestArenaBoundary(position Vec3, arena ArenaConfig, goalOpeningHeight bool) (arenaBoundary, bool) {
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

	best := arenaBoundary{}
	found := false
	if absZ <= straightZ {
		best = arenaBoundary{
			Distance: halfWidth - absX,
			Outward:  Vec3{X: nonZeroSign(position.X)},
		}
		found = true
	}
	if absX <= straightX && !goalOpeningHeight {
		end := arenaBoundary{
			Distance: halfLength - absZ,
			Outward:  Vec3{Z: nonZeroSign(position.Z)},
		}
		best, found = considerBoundary(best, found, end)
	}
	if goalOpeningHeight {
		if mouth, ok := nearestGoalMouthBoundary(position, arena); ok {
			best, found = considerBoundary(best, found, mouth)
		}
	}
	return best, found
}

func considerBoundary(best arenaBoundary, found bool, candidate arenaBoundary) (arenaBoundary, bool) {
	replace := !found
	if found {
		switch {
		case best.Distance >= 0 && candidate.Distance >= 0:
			replace = candidate.Distance < best.Distance
		case best.Distance < 0 && candidate.Distance < 0:
			replace = candidate.Distance > best.Distance
		default:
			replace = candidate.Distance < 0
		}
	}
	if replace {
		best = candidate
	}
	return best, true
}

func goalMouthRadius(arena ArenaConfig) float64 {
	halfWidth := arena.GoalWidth * 0.5
	requested := arena.GoalMouthRadius
	if requested <= 0 {
		requested = math.Min(arena.GoalRampRadius, 3)
	}
	return math.Max(0.2, math.Min(requested, math.Min(halfWidth-0.1, arena.GoalDepth-0.1)))
}

func nearestGoalMouthBoundary(position Vec3, arena ArenaConfig) (arenaBoundary, bool) {
	halfLength := arena.Length * 0.5
	halfWidth := arena.GoalWidth * 0.5
	radius := goalMouthRadius(arena)
	depth := math.Abs(position.Z) - halfLength
	outsideOpening := math.Abs(position.X) - halfWidth
	// Keep the end-wall distance field active farther into the pitch than the
	// mouth radius. The lower quarter-pipe starts at RampRadius, which is
	// intentionally a little larger than GoalMouthRadius in this layout.
	signX := nonZeroSign(position.X)
	signZ := nonZeroSign(position.Z)
	best := arenaBoundary{}
	found := false
	if outsideOpening < radius && depth < radius {
		dx := outsideOpening - radius
		dz := depth - radius
		distanceToCenter := math.Hypot(dx, dz)
		if distanceToCenter > 1e-9 {
			best, found = considerBoundary(best, found, arenaBoundary{
				Distance: distanceToCenter - radius,
				Outward: Vec3{
					X: signX * (-dx / distanceToCenter),
					Z: signZ * (-dz / distanceToCenter),
				},
			})
		}
	}
	if outsideOpening >= radius {
		best, found = considerBoundary(best, found, arenaBoundary{
			Distance: -depth,
			Outward:  Vec3{Z: signZ},
		})
	}
	if depth >= radius {
		best, found = considerBoundary(best, found, arenaBoundary{
			Distance: -outsideOpening,
			Outward:  Vec3{X: signX},
		})
	}
	return best, found
}

func goalTunnelContains(position Vec3, arena ArenaConfig, extentX, extentY, extentZ float64) bool {
	halfLength := arena.Length * 0.5
	depth := math.Abs(position.Z) - halfLength
	if depth < -extentZ-surfaceContactSlop || depth > arena.GoalDepth+extentZ+surfaceContactSlop {
		return false
	}
	return math.Abs(position.X) <= goalOpeningHalfWidthAtDepth(depth, arena)+extentX+surfaceContactSlop &&
		position.Y <= arena.GoalHeight+extentY+surfaceContactSlop
}

// goalOpeningHalfWidthAtDepth describes the flared quarter-circle entrance
// that blends the arena end wall into the goal side wall. At the goal line the
// opening is wider by GoalMouthRadius, then narrows smoothly to GoalWidth.
func goalOpeningHalfWidthAtDepth(depth float64, arena ArenaConfig) float64 {
	halfWidth := arena.GoalWidth * 0.5
	radius := goalMouthRadius(arena)
	if radius <= 1e-9 {
		return halfWidth
	}
	if depth <= 0 {
		return halfWidth + radius
	}
	if depth >= radius {
		return halfWidth
	}
	vertical := depth - radius
	return halfWidth + radius - math.Sqrt(math.Max(0, radius*radius-vertical*vertical))
}

func nearestGoalBoundary(position Vec3, arena ArenaConfig) (arenaBoundary, bool) {
	halfLength := arena.Length * 0.5
	depth := math.Abs(position.Z) - halfLength
	if depth < -goalMouthRadius(arena)-surfaceContactSlop {
		return arenaBoundary{}, false
	}

	halfWidth := arena.GoalWidth * 0.5
	radius := math.Min(arena.GoalRampRadius, math.Min(halfWidth-0.1, arena.GoalDepth-0.1))
	radius = math.Max(0.2, radius)
	straightX := halfWidth - radius
	straightDepth := arena.GoalDepth - radius
	absX := math.Abs(position.X)
	signX := nonZeroSign(position.X)
	signZ := nonZeroSign(position.Z)

	if absX > straightX && depth > straightDepth {
		centerX := signX * straightX
		dx := position.X - centerX
		dd := depth - straightDepth
		distance := math.Hypot(dx, dd)
		if distance > 1e-9 {
			return arenaBoundary{
				Distance: radius - distance,
				Outward:  Vec3{X: dx / distance, Z: signZ * dd / distance},
			}, true
		}
	}

	best, found := nearestGoalMouthBoundary(position, arena)
	if depth >= 0 {
		back := arenaBoundary{
			Distance: arena.GoalDepth - depth,
			Outward:  Vec3{Z: signZ},
		}
		best, found = considerBoundary(best, found, back)
	}
	return best, found
}

func resolveCarBoundary(car *Car, config Config, boundary arenaBoundary) {
	outward := boundary.Outward
	inward := outward.Mul(-1)
	up := Vec3{Y: 1}

	// The lower wall is a quarter circle. Keep accepting near-contact (not only
	// penetration) so later solver iterations do not replace this smooth normal
	// with a flat floor/wall normal and make the car jerk.
	lowerRadius := config.Arena.RampRadius
	lowerHorizontal := lowerRadius - boundary.Distance
	lowerVertical := car.Position.Y - lowerRadius
	if lowerHorizontal >= 0 && lowerVertical <= 0 {
		radial := outward.Mul(lowerHorizontal).Add(up.Mul(lowerVertical))
		distance := radial.Length()
		if distance > 1e-9 {
			normal := radial.Mul(-1 / distance)
			support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, normal)
			maximumDistance := math.Max(0.1, lowerRadius-support)
			penetration := distance - maximumDistance
			if penetration >= -surfaceContactSlop {
				if penetration > 0 {
					resolveBodyIntoPlayable(&car.Body, normal, penetration, config.Car.Restitution)
				}
				markCarSurfaceContact(car, normal)
				return
			}
		}
	}

	// Mirror the same rounded transition at the top. The normal rotates from
	// the inward wall normal to world-down, which lets a sufficiently aligned
	// car roll naturally from the glass wall onto the glass ceiling.
	upperRadius := config.Arena.CeilingRampRadius
	upperHorizontal := upperRadius - boundary.Distance
	upperVertical := car.Position.Y - (config.Arena.Ceiling - upperRadius)
	if upperHorizontal >= 0 && upperVertical >= 0 {
		radial := outward.Mul(upperHorizontal).Add(up.Mul(upperVertical))
		distance := radial.Length()
		if distance > 1e-9 {
			normal := radial.Mul(-1 / distance)
			support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, normal)
			maximumDistance := math.Max(0.1, upperRadius-support)
			penetration := distance - maximumDistance
			if penetration >= -surfaceContactSlop {
				if penetration > 0 {
					resolveBodyIntoPlayable(&car.Body, normal, penetration, config.Car.Restitution)
				}
				markCarSurfaceContact(car, normal)
				return
			}
		}
	}

	support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, inward)
	penetration := support - boundary.Distance
	if penetration >= -surfaceContactSlop {
		if penetration > 0 {
			resolveBodyIntoPlayable(&car.Body, inward, penetration, config.Car.Restitution)
		}
		markCarSurfaceContact(car, inward)
		car.AngularVelocity = car.AngularVelocity.Mul(0.985)
	}
}

func markCarSurfaceContact(car *Car, normal Vec3) {
	if car.GroundLockout > 0 {
		return
	}
	candidate := normal.NormalizeOr(Vec3{Y: 1})
	up := car.Rotation.Rotate(Vec3{Y: 1})
	if up.Dot(candidate) <= 0.06 {
		return
	}

	// Keep the normal continuous across floor -> ramp -> wall -> roof. A direct
	// assignment here was the main source of visible angle snapping and tiny
	// position corrections on every solver pass.
	previous := car.GroundNormal.NormalizeOr(candidate)
	if previous.Dot(candidate) > 0.05 {
		const blend = 0.08
		candidate = previous.Mul(1 - blend).Add(candidate.Mul(blend)).NormalizeOr(candidate)
	}
	car.Grounded = true
	car.GroundNormal = candidate
}

func resolveGoalCar(car *Car, config Config, extentX, extentY, extentZ float64) {
	halfLength := config.Arena.Length * 0.5
	if math.Abs(car.Position.Z)+extentZ < halfLength-surfaceContactSlop {
		return
	}
	if !goalTunnelContains(car.Position, config.Arena, extentX, extentY, extentZ) {
		return
	}

	boundary, hasBoundary := nearestGoalBoundary(car.Position, config.Arena)
	radius := config.Arena.GoalRampRadius
	lowerRampZone := hasBoundary && boundary.Distance < radius+surfaceContactSlop &&
		car.Position.Y <= radius+extentY+surfaceContactSlop
	if !lowerRampZone {
		penetration := extentY - car.Position.Y
		if penetration > 0 {
			car.Position.Y += penetration
			if car.Velocity.Y < 0 {
				car.Velocity.Y = 0
			}
		}
		if penetration >= -surfaceContactSlop {
			markCarSurfaceContact(car, Vec3{Y: 1})
		}
	}

	upperRampZone := hasBoundary && boundary.Distance < radius+surfaceContactSlop &&
		car.Position.Y >= config.Arena.GoalHeight-radius-extentY-surfaceContactSlop
	if !upperRampZone {
		penetration := car.Position.Y + extentY - config.Arena.GoalHeight
		if penetration > 0 {
			car.Position.Y -= penetration
			if car.Velocity.Y > 0 {
				car.Velocity.Y = -car.Velocity.Y * config.Car.Restitution
			}
		}
		if penetration >= -surfaceContactSlop {
			markCarSurfaceContact(car, Vec3{Y: -1})
		}
	}

	if !hasBoundary {
		return
	}
	resolveGoalCarBoundary(car, config, boundary)
}

func resolveGoalCarBoundary(car *Car, config Config, boundary arenaBoundary) {
	outward := boundary.Outward
	up := Vec3{Y: 1}
	radius := config.Arena.GoalRampRadius

	lowerHorizontal := radius - boundary.Distance
	lowerVertical := car.Position.Y - radius
	if lowerHorizontal >= 0 && lowerVertical <= 0 {
		radial := outward.Mul(lowerHorizontal).Add(up.Mul(lowerVertical))
		distance := radial.Length()
		if distance > 1e-9 {
			normal := radial.Mul(-1 / distance)
			support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, normal)
			maximumDistance := math.Max(0.1, radius-support)
			penetration := distance - maximumDistance
			if penetration >= -surfaceContactSlop {
				if penetration > 0 {
					resolveBodyIntoPlayable(&car.Body, normal, penetration, config.Car.Restitution)
				}
				markCarSurfaceContact(car, normal)
				return
			}
		}
	}

	upperHorizontal := radius - boundary.Distance
	upperVertical := car.Position.Y - (config.Arena.GoalHeight - radius)
	if upperHorizontal >= 0 && upperVertical >= 0 {
		radial := outward.Mul(upperHorizontal).Add(up.Mul(upperVertical))
		distance := radial.Length()
		if distance > 1e-9 {
			normal := radial.Mul(-1 / distance)
			support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, normal)
			maximumDistance := math.Max(0.1, radius-support)
			penetration := distance - maximumDistance
			if penetration >= -surfaceContactSlop {
				if penetration > 0 {
					resolveBodyIntoPlayable(&car.Body, normal, penetration, config.Car.Restitution)
				}
				markCarSurfaceContact(car, normal)
				return
			}
		}
	}

	inward := outward.Mul(-1)
	support := orientedBoxSupport(car.Rotation, config.Car.HalfExtents, inward)
	penetration := support - boundary.Distance
	if penetration >= -surfaceContactSlop {
		if penetration > 0 {
			resolveBodyIntoPlayable(&car.Body, inward, penetration, config.Car.Restitution)
		}
		markCarSurfaceContact(car, inward)
		car.AngularVelocity = car.AngularVelocity.Mul(0.985)
	}
}

func resolveBallArena(ball *Ball, config Config) {
	radius := config.Ball.Radius
	goalOpeningHeight := ball.Position.Y+radius <= config.Arena.GoalHeight
	inGoal := goalTunnelContains(ball.Position, config.Arena, radius, radius, radius)
	boundary, hasBoundary := nearestArenaBoundary(ball.Position, config.Arena, goalOpeningHeight)

	if inGoal {
		resolveGoalBall(ball, config)
		return
	}

	// The flat floor remains authoritative right up to the geometric start of
	// the quarter-pipe. The previous `RampRadius + ballRadius` condition disabled
	// the floor more than two metres too early, leaving an invisible annular gap.
	lowerRampZone := hasBoundary && boundary.Distance <= config.Arena.RampRadius+ballRampSeamSlop &&
		ball.Position.Y <= config.Arena.RampRadius+radius
	if floorExistsAt(ball.Position, config.Arena) && !lowerRampZone {
		resolveBallFlatFloor(ball, config)
	}

	upperRampZone := hasBoundary && boundary.Distance <= config.Arena.CeilingRampRadius+ballRampSeamSlop &&
		ball.Position.Y >= config.Arena.Ceiling-config.Arena.CeilingRampRadius-radius
	if !upperRampZone {
		resolveBodyMaximum(&ball.Body, 1, config.Arena.Ceiling, radius, config.Ball.Restitution)
	}

	if hasBoundary {
		resolveBallRoundedBoundary(ball, config, boundary, config.Arena.RampRadius, config.Arena.CeilingRampRadius, config.Arena.Ceiling)
	}
}

func resolveGoalBall(ball *Ball, config Config) {
	radius := config.Ball.Radius
	boundary, hasBoundary := nearestGoalBoundary(ball.Position, config.Arena)
	goalRadius := config.Arena.GoalRampRadius

	lowerRampZone := hasBoundary && boundary.Distance <= goalRadius+ballRampSeamSlop &&
		ball.Position.Y <= goalRadius+radius
	if !lowerRampZone {
		resolveBallFlatFloor(ball, config)
	}

	upperRampZone := hasBoundary && boundary.Distance <= goalRadius+ballRampSeamSlop &&
		ball.Position.Y >= config.Arena.GoalHeight-goalRadius-radius
	if !upperRampZone {
		resolveBodyMaximum(&ball.Body, 1, config.Arena.GoalHeight, radius, config.Ball.Restitution)
	}
	if hasBoundary {
		resolveBallRoundedBoundary(ball, config, boundary, goalRadius, goalRadius, config.Arena.GoalHeight)
	}
}

func resolveBallFlatFloor(ball *Ball, config Config) {
	radius := config.Ball.Radius
	penetration := radius - ball.Position.Y
	if penetration <= 0 {
		return
	}
	ball.Position.Y += penetration
	if ball.Velocity.Y < -0.4 {
		ball.Velocity.Y = -ball.Velocity.Y * config.Ball.Restitution
	} else if ball.Velocity.Y < 0 {
		ball.Velocity.Y = 0
	}
	// Rolling resistance is time based so the ball keeps useful momentum.
	physicsHz := math.Max(1, float64(config.PhysicsHz))
	rollingDecay := math.Exp(-config.Ball.RollingResistance / physicsHz)
	ball.Velocity.X *= rollingDecay
	ball.Velocity.Z *= rollingDecay
	rolling := Vec3{X: ball.Velocity.Z / radius, Z: -ball.Velocity.X / radius}
	ball.AngularVelocity.X = lerp(ball.AngularVelocity.X, rolling.X, 0.04)
	ball.AngularVelocity.Z = lerp(ball.AngularVelocity.Z, rolling.Z, 0.04)
}

func resolveBallRoundedBoundary(ball *Ball, config Config, boundary arenaBoundary, lowerRadius, upperRadius, ceilingY float64) {
	outward := boundary.Outward
	inward := outward.Mul(-1)

	lowerHorizontal := lowerRadius - boundary.Distance
	lowerVertical := ball.Position.Y - lowerRadius
	if lowerHorizontal >= -ballRampSeamSlop && lowerVertical <= 0 {
		lowerHorizontal = math.Max(0, lowerHorizontal)
		radial := outward.Mul(lowerHorizontal).Add(Vec3{Y: lowerVertical})
		distance := radial.Length()
		maximumDistance := math.Max(0.1, lowerRadius-config.Ball.Radius)
		penetration := distance - maximumDistance
		if penetration > 0 && distance > 1e-9 {
			normal := radial.Mul(-1 / distance)
			resolveBodyIntoPlayable(&ball.Body, normal, penetration, config.Ball.Restitution)
			return
		}
	}

	upperHorizontal := upperRadius - boundary.Distance
	upperVertical := ball.Position.Y - (ceilingY - upperRadius)
	if upperHorizontal >= -ballRampSeamSlop && upperVertical >= 0 {
		upperHorizontal = math.Max(0, upperHorizontal)
		radial := outward.Mul(upperHorizontal).Add(Vec3{Y: upperVertical})
		distance := radial.Length()
		maximumDistance := math.Max(0.1, upperRadius-config.Ball.Radius)
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
	depth := math.Abs(position.Z) - halfLength
	if depth > arena.GoalDepth+1 {
		return false
	}
	maximumX := arena.GoalWidth*0.5 + 1
	if depth <= goalMouthRadius(arena)+surfaceContactSlop {
		maximumX = arena.GoalWidth*0.5 + goalMouthRadius(arena) + 0.25
	}
	return math.Abs(position.X) <= maximumX
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

	// Add a controlled arcade kick on meaningful car hits. Frontal hits are
	// intentionally forward-biased: most of the extra energy follows the contact
	// direction, while world-up lift is only a moderate pop. This keeps shots
	// powerful without making a bumper hit behave like a lob.
	impactSpeed := -closingSpeed
	if impactSpeed > 1.0 {
		extraForward := clamp(impactSpeed*config.Ball.CarHitPower, 0, 7.5)
		liftRamp := clamp((impactSpeed-1)/4, 0, 1)
		lift := clamp((config.Ball.CarHitLiftBase+impactSpeed*config.Ball.CarHitLift)*liftRamp, 0, 3.25)
		ball.Velocity = ball.Velocity.Add(normal.Mul(extraForward)).Add(Vec3{Y: lift})
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
