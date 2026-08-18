export const INPUT_BITS = Object.freeze({
  W: 1 << 0,
  S: 1 << 1,
  A: 1 << 2,
  D: 1 << 3,
  Q: 1 << 4,
  E: 1 << 5,
  BOOST: 1 << 6,
  JUMP: 1 << 7
});

export const INPUT_EDGES = Object.freeze({
  JUMP: 1 << 0,
  RESET: 1 << 1,
  BALL_RESET: 1 << 2
});

// Held controls that do not fit in the original 8-bit movement mask. Kept in
// a separate byte so drift can be held independently from air-roll bindings.
export const INPUT_FLAGS = Object.freeze({
  DRIFT: 1 << 0,
  ANALOG: 1 << 1
});

// Rocket League reference handling. The server and local predictor intentionally
// use the same values so input never changes character at snapshot boundaries.

export function getDirectionalDodgeLiftScale(forwardAmount) {
  const amount = Math.min(1, Math.abs(Number(forwardAmount) || 0));
  return amount < 0.20 ? 0 : amount;
}

export const UU_PER_METRE = 100;
// Deliberate readability override: dynamics stay on the RLBot reference while
// both gameplay objects and their colliders are uniformly 50% larger.
export const GAMEPLAY_OBJECT_SCALE = 1.25;
export const FULL_STEER_SPEED = 12.34;
export const FULL_STEER_TIME_CONSTANT = 0.74704;

export function throttleAccelerationAtSpeed(speed) {
  const velocityUU = Math.abs(Number(speed) || 0) * UU_PER_METRE;
  if (velocityUU < 1400) return (1600 - (1440 / 1400) * velocityUU) / UU_PER_METRE;
  if (velocityUU < 1410) return (160 - 16 * (velocityUU - 1400)) / UU_PER_METRE;
  return 0;
}

export function turningCurvatureAtSpeed(speed) {
  const velocityUU = Math.abs(Number(speed) || 0) * UU_PER_METRE;
  let curvatureUU = 0;
  if (velocityUU < 500) curvatureUU = 0.006900 - 5.84e-6 * velocityUU;
  else if (velocityUU < 1000) curvatureUU = 0.005610 - 3.26e-6 * velocityUU;
  else if (velocityUU < 1500) curvatureUU = 0.004300 - 1.95e-6 * velocityUU;
  else if (velocityUU < 1750) curvatureUU = 0.003025 - 1.10e-6 * velocityUU;
  else if (velocityUU < 2500) curvatureUU = 0.001800 - 4.00e-7 * velocityUU;
  return Math.max(0, curvatureUU * UU_PER_METRE);
}

export function turningAngularSpeed(speed, steer = 1) {
  return speed * turningCurvatureAtSpeed(speed) * Math.max(-1, Math.min(1, Number(steer) || 0));
}

export function fullSteerDecelerationAtSpeed(speed) {
  const velocityUU = Math.abs(Number(speed) || 0) * UU_PER_METRE;
  if (velocityUU <= 1234) return 0;
  if (velocityUU <= 1248) return 5.185 / UU_PER_METRE;
  if (velocityUU <= 1270) return 27.5 / UU_PER_METRE;
  if (velocityUU <= 1322) return 65 / UU_PER_METRE;
  if (velocityUU <= 1401) return 131.667 / UU_PER_METRE;
  if (velocityUU <= 1824) return 325.384615 / UU_PER_METRE;
  if (velocityUU <= 2224) return 400 / UU_PER_METRE;
  if (velocityUU <= 2290) return 330 / UU_PER_METRE;
  return 100 / UU_PER_METRE;
}

export const CAR_TUNING = {
  // RLBot values converted from Unreal Units to metres.
  mass: 180,
  maxGroundSpeed: 14.10,
  maxBoostSpeed: 23.00,
  supersonicSpeed: 22.00,
  driveAcceleration: 16.0,
  reverseAcceleration: 16.0,
  brakeAcceleration: 35.0,
  coastDeceleration: 5.25,
  boostAcceleration: 9.91666,
  airBoostAcceleration: 10.58333,
  airThrottleAcceleration: 0.66667,
  airReverseAcceleration: 0.33334,
  boostCapacity: 100,
  boostConsumptionPerSecond: 33.3,
  grip: 18.0,
  driftGrip: 3.0,
  steerRate: 2.75,
  driftSteerRate: 4.65,
  steerResponse: 14.0,
  driftSteerResponse: 19.0,
  angularGroundDamping: 11.0,
  airPitchAcceleration: 12.46,
  airYawAcceleration: 9.11,
  airRollAcceleration: 38.34,
  // Aerial orientation uses angular-velocity targets instead of accumulating
  // torque forever. This keeps the car stable when controls are released while
  // preserving immediate, analog pitch/yaw/roll authority when the player asks.
  airPitchRate: 5.5,
  airYawRate: 5.5,
  airRollRate: 5.5,
  airControlResponse: 11.5,
  airNeutralResponse: 8.5,
  maxAirAngular: 5.5,
  jumpSpeed: 2.92,
  jumpHoldAcceleration: 14.6,
  jumpHoldDuration: 0.20,
  jumpMinimumHoldDuration: 3 / 120,
  jumpStickyAcceleration: 3.25,
  jumpStickyDuration: 3 / 120,
  doubleJumpSpeed: 2.91667,
  // A dodge owns one finite 360-degree rotation.  While it is active normal
  // air torque is suppressed so holding the dodge direction cannot turn the
  // flip into an endless corkscrew.
  dodgeImpulse: 5.0,
  // Applied fully to forward/back dodges, proportionally to diagonals, and not
  // at all to pure A/D barrel rolls so a side dodge never changes jump height.
  dodgeLift: 1.8,
  dodgeAngularSpeed: 5.5,
  dodgeRotation: Math.PI * 2,
  dodgeWindow: 1.25,
  dodgeDuration: Math.PI * 2 / 5.5,
  dodgeControlScale: 0.0,
  downAcceleration: 3.25,
  wallGravityCancel: 1.0,
  surfaceNormalBlend: 0.28,
  surfaceNormalResponse: 11.0,
  surfaceAlignResponse: 16.0,
  gravity: 6.5,
  linearDamping: 0.0,
  angularDamping: 0.55
};

export const BALL_TUNING = {
  radius: 0.9125 * GAMEPLAY_OBJECT_SCALE,
  spawnY: 0.9315 * GAMEPLAY_OBJECT_SCALE,
  restingHeight: 0.9315 * GAMEPLAY_OBJECT_SCALE,
  // Density preserves the referenced mass after the readability scale-up.
  density: 30 / ((4 / 3) * Math.PI * (0.9125 * GAMEPLAY_OBJECT_SCALE) ** 3),
  mass: 30,
  restitution: 0.60,
  friction: 0.22,
  rollingResistance: 0.18,
  linearDamping: 0.030562030038766,
  angularDamping: 0.055,
  carHitPower: 0.34,
  carHitLift: 0.11,
  carHitLiftBase: 0.45,
  maxSpeed: 60,
  terminalSpeed: 212.68220703125,
  maxAngularSpeed: 6
};

export function applyServerPhysicsConfig(config = {}) {
  const car = config?.car || {};
  const ball = config?.ball || {};

  const carMap = {
    mass: 'mass', maxGroundSpeed: 'maxGroundSpeed', maxBoostSpeed: 'maxBoostSpeed', supersonicSpeed: 'supersonicSpeed', boostCapacity: 'boostCapacity',
    boostConsumptionPerSecond: 'boostConsumptionPerSecond', driveAcceleration: 'driveAcceleration',
    reverseAcceleration: 'reverseAcceleration', brakeAcceleration: 'brakeAcceleration', coastDeceleration: 'coastDeceleration',
    boostAcceleration: 'boostAcceleration', airBoostAcceleration: 'airBoostAcceleration',
    airThrottleAcceleration: 'airThrottleAcceleration', airReverseAcceleration: 'airReverseAcceleration', grip: 'grip', driftGrip: 'driftGrip',
    steerRate: 'steerRate', driftSteerRate: 'driftSteerRate', steerResponse: 'steerResponse', driftSteerResponse: 'driftSteerResponse',
    groundAngularDamping: 'angularGroundDamping', airPitchAcceleration: 'airPitchAcceleration', airYawAcceleration: 'airYawAcceleration',
    airRollAcceleration: 'airRollAcceleration', airPitchRate: 'airPitchRate', airYawRate: 'airYawRate', airRollRate: 'airRollRate',
    airControlResponse: 'airControlResponse', airNeutralResponse: 'airNeutralResponse', maxAirAngular: 'maxAirAngular',
    jumpSpeed: 'jumpSpeed', jumpHoldAcceleration: 'jumpHoldAcceleration', jumpHoldDuration: 'jumpHoldDuration',
    jumpMinimumHoldDuration: 'jumpMinimumHoldDuration', jumpStickyAcceleration: 'jumpStickyAcceleration', jumpStickyDuration: 'jumpStickyDuration',
    doubleJumpSpeed: 'doubleJumpSpeed', dodgeImpulse: 'dodgeImpulse', dodgeLift: 'dodgeLift', dodgeAngularSpeed: 'dodgeAngularSpeed',
    dodgeRotation: 'dodgeRotation', dodgeWindow: 'dodgeWindow', dodgeDuration: 'dodgeDuration', dodgeControlScale: 'dodgeControlScale',
    downAcceleration: 'downAcceleration', wallGravityCancel: 'wallGravityCancel', surfaceAlignResponse: 'surfaceAlignResponse',
    linearDamping: 'linearDamping', angularDamping: 'angularDamping'
  };
  for (const [sourceKey, targetKey] of Object.entries(carMap)) {
    const value = Number(car[sourceKey]);
    if (Number.isFinite(value)) CAR_TUNING[targetKey] = value;
  }
  const gravity = Number(config?.gravity);
  if (Number.isFinite(gravity)) CAR_TUNING.gravity = gravity;

  const ballKeys = ['radius', 'mass', 'spawnY', 'restingHeight', 'restitution', 'friction', 'rollingResistance', 'linearDamping', 'angularDamping', 'carHitPower', 'carHitLift', 'carHitLiftBase', 'maxSpeed', 'maxAngularSpeed'];
  for (const key of ballKeys) {
    const value = Number(ball[key]);
    if (Number.isFinite(value)) BALL_TUNING[key] = value;
  }
  BALL_TUNING.density = BALL_TUNING.mass / ((4 / 3) * Math.PI * BALL_TUNING.radius ** 3);
}
