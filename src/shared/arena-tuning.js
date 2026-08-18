import { GAMEPLAY_OBJECT_SCALE } from './game-tuning.js';

export const ARENA_TUNING = {
  width: 81.92,
  length: 102.40,
  ceiling: 20.44,
  wallHeight: 20.44,
  cornerRadius: 11.52,
  rampRadius: 2.56,
  rampSegments: 16,
  ceilingRampRadius: 2.56,
  wallThickness: 0.4,
  goalWidth: 17.8551,
  goalHeight: 6.42775,
  goalDepth: 8.8,
  goalRampRadius: 2.56,
  goalMouthRadius: 0.8
};

export const CAR_HITBOX = {
  x: 0.421 * GAMEPLAY_OBJECT_SCALE,
  y: 0.1701 * GAMEPLAY_OBJECT_SCALE,
  z: 0.59004 * GAMEPLAY_OBJECT_SCALE
};


export function applyServerArenaConfig(config = {}) {
  const arena = config?.arena || {};
  for (const key of [
    'width', 'length', 'ceiling', 'wallHeight', 'cornerRadius', 'rampRadius',
    'ceilingRampRadius', 'goalWidth', 'goalHeight', 'goalDepth', 'goalRampRadius', 'goalMouthRadius'
  ]) {
    const value = Number(arena[key]);
    if (Number.isFinite(value) && value > 0) ARENA_TUNING[key] = value;
  }
}

export function applyServerHitboxConfig(config = {}) {
  const hitbox = config?.car?.halfExtents || {};
  for (const key of ['x', 'y', 'z']) {
    const value = Number(hitbox[key]);
    if (Number.isFinite(value) && value > 0) CAR_HITBOX[key] = value;
  }
}

// Utility for systems that need a point constrained to the arena's documented
// 45-degree plan-view corner planes.
// The chase camera deliberately no longer uses this: it may travel outside
// walls and relies on render-time occlusion hiding instead.
export function clampPointToRoundedArena(point, margin = 0) {
  const arena = ARENA_TUNING;
  const safeMargin = Math.max(0, Math.min(Number(margin) || 0, arena.cornerRadius - 0.1));
  const halfWidth = arena.width * 0.5 - safeMargin;
  const halfLength = arena.length * 0.5 - safeMargin;
  const cornerX = arena.width * 0.5 - arena.cornerRadius;
  const cornerZ = arena.length * 0.5 - arena.cornerRadius;

  point.x = Math.max(-halfWidth, Math.min(halfWidth, point.x));
  point.z = Math.max(-halfLength, Math.min(halfLength, point.z));

  const absX = Math.abs(point.x);
  const absZ = Math.abs(point.z);
  if (absX > cornerX && absZ > cornerZ) {
    const intercept = arena.width * 0.5 + arena.length * 0.5
      - arena.cornerRadius - safeMargin * Math.SQRT2;
    const overflow = absX + absZ - intercept;
    if (overflow > 0) {
      point.x -= Math.sign(point.x || 1) * overflow * 0.5;
      point.z -= Math.sign(point.z || 1) * overflow * 0.5;
    }
  }

  point.y = Math.max(0.35, Math.min(arena.ceiling - Math.max(0.35, safeMargin), point.y));
  return point;
}
