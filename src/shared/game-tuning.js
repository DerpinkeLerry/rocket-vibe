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

// Arcade handling tuned around Rocket-League-style behaviour.  The server and
// the local predictor intentionally use the same values so input never changes
// character when an authoritative snapshot arrives.
export const CAR_TUNING = Object.freeze({
  maxGroundSpeed: 40,
  maxBoostSpeed: 54,
  driveAcceleration: 30.0,
  reverseAcceleration: 22.0,
  brakeAcceleration: 44.0,
  coastDeceleration: 4.2,
  boostAcceleration: 34.0,
  grip: 18.0,
  steerRate: 2.75,
  steerResponse: 14.0,
  angularGroundDamping: 11.0,
  airPitchAcceleration: 11.0,
  airYawAcceleration: 8.8,
  airRollAcceleration: 10.5,
  maxAirAngular: 6.6,
  jumpSpeed: 12.4,
  jumpHoldAcceleration: 24.0,
  jumpHoldDuration: 0.18,
  doubleJumpSpeed: 10.0,
  dodgeImpulse: 13.5,
  dodgeLift: 2.2,
  dodgeAngularSpeed: 11.5,
  dodgeWindow: 1.25,
  dodgeDuration: 0.65,
  dodgeControlScale: 0.18,
  downAcceleration: 18.0,
  wallGravityCancel: 1.0,
  surfaceAlignResponse: 18.0,
  gravity: 20.5,
  linearDamping: 0.06,
  angularDamping: 0.55
});

export const BALL_TUNING = Object.freeze({
  radius: 2.2,
  spawnY: 5.5,
  // Density compensates for the larger volume to keep mass near the old ball.
  density: 0.67,
  maxSpeed: 56,
  maxAngularSpeed: 32
});
