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

// Arcade handling tuned around Rocket-League-style behaviour.  The server and
// the local predictor intentionally use the same values so input never changes
// character when an authoritative snapshot arrives.
export const CAR_TUNING = Object.freeze({
  // Internal physics units are metres/second. These caps correspond to the
  // HUD targets requested for the slower, more readable game pace.
  maxGroundSpeed: 70 / 3.6,
  maxBoostSpeed: 120 / 3.6,
  driveAcceleration: 14.0,
  reverseAcceleration: 10.0,
  brakeAcceleration: 28.0,
  coastDeceleration: 3.5,
  boostAcceleration: 16.0,
  // Air boost is intentionally stronger than ground boost. With the current
  // gravity this gives roughly a Rocket-League-like thrust/gravity ratio, so
  // pitching the nose upward can genuinely gain altitude instead of only
  // slowing the fall.
  airBoostAcceleration: 34.0,
  boostCapacity: 100,
  boostConsumptionPerSecond: 100 / 3,
  grip: 18.0,
  driftGrip: 3.0,
  steerRate: 2.75,
  driftSteerRate: 4.65,
  steerResponse: 14.0,
  driftSteerResponse: 19.0,
  angularGroundDamping: 11.0,
  airPitchAcceleration: 11.0,
  airYawAcceleration: 8.8,
  airRollAcceleration: 10.5,
  maxAirAngular: 6.6,
  // First jump is intentionally modest. Holding jump continuously adds lift
  // for up to 0.20 s, giving a large and controllable tap-to-full height range.
  jumpSpeed: 10.5,
  jumpHoldAcceleration: 32.0,
  jumpHoldDuration: 0.20,
  doubleJumpSpeed: 10.0,
  // A dodge owns one finite 360-degree rotation.  While it is active normal
  // air torque is suppressed so holding the dodge direction cannot turn the
  // flip into an endless corkscrew.
  dodgeImpulse: 14.0,
  dodgeLift: 1.8,
  dodgeAngularSpeed: 11.22,
  dodgeRotation: Math.PI * 2,
  dodgeWindow: 1.25,
  dodgeDuration: 0.56,
  dodgeControlScale: 0.0,
  downAcceleration: 18.0,
  wallGravityCancel: 1.0,
  surfaceNormalBlend: 0.28,
  surfaceNormalResponse: 11.0,
  surfaceAlignResponse: 16.0,
  gravity: 20.5,
  linearDamping: 0.0,
  angularDamping: 0.55
});

export const BALL_TUNING = Object.freeze({
  radius: 2.2,
  spawnY: 5.5,
  // Density compensates for the larger volume to keep mass near the old ball.
  density: 0.67,
  restitution: 0.68,
  friction: 0.22,
  rollingResistance: 0.18,
  linearDamping: 0.015,
  angularDamping: 0.055,
  carHitPower: 0.34,
  carHitLift: 0.11,
  carHitLiftBase: 0.45,
  maxSpeed: 60,
  maxAngularSpeed: 34
});
