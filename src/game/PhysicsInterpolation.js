export function getPhysicsInterpolationAlpha(accumulator, fixedDt, enabled = true) {
  if (!enabled) return 1;
  const step = Math.max(1e-6, Number(fixedDt) || 0);
  const remainder = Math.max(0, Number(accumulator) || 0);
  return Math.max(0, Math.min(1, remainder / step));
}
