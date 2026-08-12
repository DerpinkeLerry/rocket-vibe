export const ARENA_TUNING = Object.freeze({
  width: 110,
  length: 160,
  ceiling: 25,
  wallHeight: 25,
  cornerRadius: 16,
  rampRadius: 3.4,
  rampSegments: 16,
  ceilingRampRadius: 6,
  wallThickness: 0.8,
  goalWidth: 34,
  goalHeight: 12,
  goalDepth: 14,
  goalRampRadius: 3.4,
  goalMouthRadius: 2.8
});

export const CAR_HITBOX = Object.freeze({
  x: 0.83,
  y: 0.45,
  z: 1.48
});

// Utility for systems that need a point constrained to the rounded arena.
// The chase camera deliberately no longer uses this: it may travel outside
// walls and relies on render-time occlusion hiding instead.
export function clampPointToRoundedArena(point, margin = 0) {
  const arena = ARENA_TUNING;
  const safeMargin = Math.max(0, Math.min(Number(margin) || 0, arena.cornerRadius - 0.1));
  const halfWidth = arena.width * 0.5 - safeMargin;
  const halfLength = arena.length * 0.5 - safeMargin;
  const radius = arena.cornerRadius - safeMargin;
  const cornerX = arena.width * 0.5 - arena.cornerRadius;
  const cornerZ = arena.length * 0.5 - arena.cornerRadius;

  point.x = Math.max(-halfWidth, Math.min(halfWidth, point.x));
  point.z = Math.max(-halfLength, Math.min(halfLength, point.z));

  const absX = Math.abs(point.x);
  const absZ = Math.abs(point.z);
  if (absX > cornerX && absZ > cornerZ) {
    const dx = absX - cornerX;
    const dz = absZ - cornerZ;
    const distance = Math.hypot(dx, dz);
    if (distance > radius && distance > 0.000001) {
      const scale = radius / distance;
      point.x = Math.sign(point.x || 1) * (cornerX + dx * scale);
      point.z = Math.sign(point.z || 1) * (cornerZ + dz * scale);
    }
  }

  point.y = Math.max(0.35, Math.min(arena.ceiling - Math.max(0.35, safeMargin), point.y));
  return point;
}
