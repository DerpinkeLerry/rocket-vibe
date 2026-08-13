function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value, min, max) {
  if (max <= min) return value >= max ? 1 : 0;
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function getBallCamHighBallAssist(ballHeight) {
  const height = Math.max(0, Number(ballHeight) || 0);
  const blend = smoothstep(height, 2, 10);
  return Object.freeze({
    blend,
    distanceExtra: clamp(height * (0.12 + blend * 0.30), 0, 10.5),
    heightExtra: height * (0.18 + blend * 0.30),
    lookLift: clamp(height * (0.10 + blend * 0.46), 0, 14)
  });
}
