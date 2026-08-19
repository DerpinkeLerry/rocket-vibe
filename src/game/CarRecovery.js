const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function getCarUpY(rotation = {}) {
  const x = finite(rotation.x);
  const z = finite(rotation.z);
  return Math.max(-1, Math.min(1, 1 - 2 * (x * x + z * z)));
}

export function shouldUseCarRecoveryJump(options = {}) {
  const upright = getCarUpY(options.rotation);
  return !options.grounded
    && options.nearFloor === true
    && finite(options.airTime) >= 0.12
    && Math.abs(finite(options.verticalSpeed)) <= 4.5
    && upright < 0.48;
}

export function getUprightRecoveryRotation(rotation = {}, velocity = {}) {
  const x = finite(rotation.x);
  const y = finite(rotation.y);
  const z = finite(rotation.z);
  const w = finite(rotation.w, 1);
  let forwardX = -2 * (x * z + w * y);
  let forwardZ = -(1 - 2 * (x * x + y * y));
  let length = Math.hypot(forwardX, forwardZ);

  if (length < 0.12) {
    forwardX = finite(velocity.x);
    forwardZ = finite(velocity.z);
    length = Math.hypot(forwardX, forwardZ);
  }
  if (length < 0.12) {
    forwardX = 0;
    forwardZ = -1;
    length = 1;
  }

  forwardX /= length;
  forwardZ /= length;
  const yaw = Math.atan2(-forwardX, -forwardZ);
  const halfYaw = yaw * 0.5;
  return Object.freeze({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) });
}
