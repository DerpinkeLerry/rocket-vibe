export const INPUT_BITS = Object.freeze({
  W: 1 << 0,
  S: 1 << 1,
  A: 1 << 2,
  D: 1 << 3,
  Q: 1 << 4,
  E: 1 << 5,
  BOOST: 1 << 6
});

export const INPUT_EDGES = Object.freeze({
  JUMP: 1 << 0,
  RESET: 1 << 1,
  BALL_RESET: 1 << 2
});

export const CAR_TUNING = Object.freeze({
  maxGroundSpeed: 39,
  maxBoostSpeed: 52,
  driveAcceleration: 25.5,
  reverseAcceleration: 20.0,
  brakeAcceleration: 34.0,
  coastDeceleration: 5.5,
  boostAcceleration: 31.0,
  grip: 13.5,
  steerRate: 2.55,
  steerResponse: 10.0,
  angularGroundDamping: 8.5,
  airPitchAcceleration: 8.5,
  airYawAcceleration: 7.4,
  airRollAcceleration: 8.0,
  maxAirAngular: 6.5,
  jumpSpeed: 11.8,
  doubleJumpSpeed: 8.4,
  downAcceleration: 5.5,
  gravity: 20.5,
  linearDamping: 0.08,
  angularDamping: 0.32
});

export const BALL_TUNING = Object.freeze({
  // v1.2 used radius 0.92. 1.75 makes the ball almost 2x the diameter.
  radius: 1.75,
  spawnY: 5.0,
  // Density compensates for the larger volume to keep mass near the old ball.
  density: 1.32,
  maxSpeed: 56,
  maxAngularSpeed: 32
});
