package game

import "math"

// Vec3 uses metres, metres/second or radians/second depending on context.
// The simulation keeps float64 precision internally and only converts to
// float32 when a compact network snapshot is encoded.
type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func (v Vec3) Add(other Vec3) Vec3 {
	return Vec3{X: v.X + other.X, Y: v.Y + other.Y, Z: v.Z + other.Z}
}

func (v Vec3) Sub(other Vec3) Vec3 {
	return Vec3{X: v.X - other.X, Y: v.Y - other.Y, Z: v.Z - other.Z}
}

func (v Vec3) Mul(scalar float64) Vec3 {
	return Vec3{X: v.X * scalar, Y: v.Y * scalar, Z: v.Z * scalar}
}

func (v Vec3) Dot(other Vec3) float64 {
	return v.X*other.X + v.Y*other.Y + v.Z*other.Z
}

func (v Vec3) Cross(other Vec3) Vec3 {
	return Vec3{
		X: v.Y*other.Z - v.Z*other.Y,
		Y: v.Z*other.X - v.X*other.Z,
		Z: v.X*other.Y - v.Y*other.X,
	}
}

func (v Vec3) LengthSquared() float64 { return v.Dot(v) }
func (v Vec3) Length() float64        { return math.Sqrt(v.LengthSquared()) }

func (v Vec3) NormalizeOr(fallback Vec3) Vec3 {
	length := v.Length()
	if length < 1e-9 || !isFinite(length) {
		return fallback
	}
	return v.Mul(1 / length)
}

func (v Vec3) IsFinite() bool {
	return isFinite(v.X) && isFinite(v.Y) && isFinite(v.Z)
}

type Quat struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
	W float64 `json:"w"`
}

func IdentityQuat() Quat { return Quat{W: 1} }

func QuatFromYaw(yaw float64) Quat {
	half := yaw * 0.5
	return Quat{Y: math.Sin(half), W: math.Cos(half)}
}

func quatFromAxisAngle(axis Vec3, angle float64) Quat {
	axis = axis.NormalizeOr(Vec3{Y: 1})
	half := angle * 0.5
	sine := math.Sin(half)
	return Quat{X: axis.X * sine, Y: axis.Y * sine, Z: axis.Z * sine, W: math.Cos(half)}
}

func (q Quat) Normalize() Quat {
	length := math.Sqrt(q.X*q.X + q.Y*q.Y + q.Z*q.Z + q.W*q.W)
	if length < 1e-12 || !isFinite(length) {
		return IdentityQuat()
	}
	return Quat{X: q.X / length, Y: q.Y / length, Z: q.Z / length, W: q.W / length}
}

// Mul returns q * other. A world-space rotation delta therefore pre-multiplies
// the current orientation: delta.Mul(current).
func (q Quat) Mul(other Quat) Quat {
	return Quat{
		X: q.W*other.X + q.X*other.W + q.Y*other.Z - q.Z*other.Y,
		Y: q.W*other.Y - q.X*other.Z + q.Y*other.W + q.Z*other.X,
		Z: q.W*other.Z + q.X*other.Y - q.Y*other.X + q.Z*other.W,
		W: q.W*other.W - q.X*other.X - q.Y*other.Y - q.Z*other.Z,
	}
}

func (q Quat) Conjugate() Quat {
	return Quat{X: -q.X, Y: -q.Y, Z: -q.Z, W: q.W}
}

func (q Quat) Rotate(v Vec3) Vec3 {
	q = q.Normalize()
	vector := Vec3{X: q.X, Y: q.Y, Z: q.Z}
	t := vector.Cross(v).Mul(2)
	return v.Add(t.Mul(q.W)).Add(vector.Cross(t))
}

func (q Quat) Integrate(worldAngularVelocity Vec3, dt float64) Quat {
	speed := worldAngularVelocity.Length()
	if speed < 1e-9 || dt <= 0 {
		return q.Normalize()
	}
	delta := quatFromAxisAngle(worldAngularVelocity.Mul(1/speed), speed*dt)
	return delta.Mul(q).Normalize()
}

func (q Quat) NLerp(target Quat, amount float64) Quat {
	amount = clamp(amount, 0, 1)
	dot := q.X*target.X + q.Y*target.Y + q.Z*target.Z + q.W*target.W
	if dot < 0 {
		target = Quat{X: -target.X, Y: -target.Y, Z: -target.Z, W: -target.W}
	}
	return Quat{
		X: lerp(q.X, target.X, amount),
		Y: lerp(q.Y, target.Y, amount),
		Z: lerp(q.Z, target.Z, amount),
		W: lerp(q.W, target.W, amount),
	}.Normalize()
}

func clampMagnitude(v Vec3, maximum float64) Vec3 {
	length := v.Length()
	if length <= maximum || length < 1e-9 {
		return v
	}
	return v.Mul(maximum / length)
}

func moveTowards(current, target, maximumDelta float64) float64 {
	if math.Abs(target-current) <= maximumDelta {
		return target
	}
	return current + math.Copysign(maximumDelta, target-current)
}

func damp(current, target, lambda, dt float64) float64 {
	return lerp(current, target, 1-math.Exp(-lambda*dt))
}

func lerp(a, b, amount float64) float64 { return a + (b-a)*amount }

func clamp(value, minimum, maximum float64) float64 {
	return math.Max(minimum, math.Min(maximum, value))
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
