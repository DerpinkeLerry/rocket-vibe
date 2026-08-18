import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMicroDeadZone,
  applyMobileBallContactAssist,
  curveSmartGroundThrottle,
  curveSteering,
  curveThrottle,
  getMobileBallContactTarget,
  isPointInsideAction,
  resolveAnalogStick,
  resolveMobileDrive,
  resolveStickCodes
} from './MobileControls.js';

test('mobile steering has only a tiny micro dead zone and then grows continuously', () => {
  assert.equal(applyMicroDeadZone(0.01), 0);
  assert.ok(applyMicroDeadZone(0.03) > 0);

  const quarter = Math.abs(curveSteering(0.25, { speedKmh: 20 }));
  const half = Math.abs(curveSteering(0.50, { speedKmh: 20 }));
  const threeQuarter = Math.abs(curveSteering(0.75, { speedKmh: 20 }));
  assert.ok(quarter > 0.20 && quarter < 0.32, quarter);
  assert.ok(half > 0.45 && half < 0.60, half);
  assert.ok(half > quarter * 1.75, { quarter, half });
  assert.ok(threeQuarter > half, { half, threeQuarter });
  assert.ok(Math.abs(curveSteering(-1, { speedKmh: 20 }) - 1) < 1e-9); // screen-left -> physics-left
  assert.ok(Math.abs(curveSteering(1, { speedKmh: 20 }) + 1) < 1e-9);
});

test('high speed softens mid-stick steering but full travel always remains full steering', () => {
  const lowSpeedMid = Math.abs(curveSteering(0.55, { speedKmh: 20 }));
  const highSpeedMid = Math.abs(curveSteering(0.55, { speedKmh: 115 }));
  assert.ok(highSpeedMid < lowSpeedMid, { lowSpeedMid, highSpeedMid });
  assert.ok(highSpeedMid > lowSpeedMid * 0.92, { lowSpeedMid, highSpeedMid });
  assert.ok(Math.abs(curveSteering(1, { speedKmh: 115 }) + 1) < 1e-9);
});

test('drift deliberately makes the same thumb travel steer more aggressively', () => {
  const normal = Math.abs(curveSteering(0.48, { speedKmh: 55, drift: false }));
  const drift = Math.abs(curveSteering(0.48, { speedKmh: 55, drift: true }));
  assert.ok(drift > normal * 1.15, { normal, drift });
});

test('throttle is analog and soft axis lock filters accidental cross-axis wobble', () => {
  assert.ok(curveThrottle(-0.30) > 0.40 && curveThrottle(-0.30) < curveThrottle(-0.8));
  assert.ok(curveThrottle(-0.50) > 0.60);
  assert.ok(curveThrottle(0.5) < 0);

  const mostlySteer = resolveAnalogStick(0.7, 0.12, { speedKmh: 30 });
  assert.ok(Math.abs(mostlySteer.steer) > Math.abs(mostlySteer.throttle) * 3, mostlySteer);
  const diagonal = resolveAnalogStick(-0.7, -0.7, { speedKmh: 30 });
  assert.ok(diagonal.steer > 0.3 && diagonal.throttle > 0.3, diagonal);

  // Full throttle must no longer crush a deliberate moderate steering input.
  const drivingTurn = resolveAnalogStick(0.30, -1, { speedKmh: 70 });
  assert.ok(Math.abs(drivingTurn.steer) > 0.27, drivingTurn);
  assert.ok(drivingTurn.throttle > 0.99, drivingTurn);
});

test('compatibility direction helper follows the continuous analog signs', () => {
  assert.deepEqual(resolveStickCodes(0, -1), ['KeyW']);
  assert.deepEqual(resolveStickCodes(0, 1), ['KeyS']);
  assert.deepEqual(resolveStickCodes(-1, 0), ['KeyA']);
  assert.deepEqual(resolveStickCodes(1, 0), ['KeyD']);
  assert.deepEqual(resolveStickCodes(-0.8, -0.8), ['KeyA', 'KeyW']);
});

test('smart drive separates easy ground driving from deliberate braking and air control', () => {
  assert.equal(curveSmartGroundThrottle(0), 1);
  assert.equal(curveSmartGroundThrottle(-1), 1);
  assert.ok(curveSmartGroundThrottle(0.17) > 0 && curveSmartGroundThrottle(0.17) < 1);
  assert.equal(curveSmartGroundThrottle(0.26), 0);
  assert.ok(curveSmartGroundThrottle(0.50) < -0.6);
  assert.equal(curveSmartGroundThrottle(1), -1);

  const groundTurn = resolveMobileDrive(0.5, 0, { speedKmh: 45, airborne: false });
  assert.equal(groundTurn.throttle, 1);
  assert.ok(Math.abs(groundTurn.steer) > 0.45);

  const neutralAir = resolveMobileDrive(0, 0, { speedKmh: 45, airborne: true });
  assert.deepEqual(neutralAir, { throttle: 0, steer: 0 });
  const pitchedAir = resolveMobileDrive(0, -0.5, { speedKmh: 45, airborne: true });
  assert.ok(pitchedAir.throttle > 0.6);
});

test('boost-to-jump chord uses a forgiving but bounded action hit target', () => {
  const jumpRect = { left: 300, right: 364, top: 180, bottom: 244 };
  assert.equal(isPointInsideAction(294, 210, jumpRect, 12), true);
  assert.equal(isPointInsideAction(376, 210, jumpRect, 12), true);
  assert.equal(isPointInsideAction(285, 210, jumpRect, 12), false);
  assert.equal(isPointInsideAction(330, 260, jumpRect, 12), false);
});

test('mobile contact targeting leads the moving ball, prepares shots and rejects unreachable targets', () => {
  const left = getMobileBallContactTarget({
    carPosition: { x: 0, y: 0.5, z: 0 },
    carVelocity: { x: 0, y: 0, z: -12 },
    carForward: { x: 0, z: -1 },
    ballPosition: { x: -2, y: 1.2, z: -8 },
    ballVelocity: { x: 0, y: 0, z: 0 }
  });
  assert.equal(left.reachable, true);
  assert.ok(left.signedAngle > 0, left);
  assert.ok(left.leadTime > 0 && left.leadTime <= 0.52, left);

  const movingRight = getMobileBallContactTarget({
    carPosition: { x: 0, y: 0.5, z: 0 },
    carVelocity: { x: 0, y: 0, z: -10 },
    carForward: { x: 0, z: -1 },
    ballPosition: { x: 0, y: 1.2, z: -9 },
    ballVelocity: { x: 7, y: 0, z: 0 }
  });
  assert.ok(movingRight.signedAngle < 0, movingRight);

  const shotSetup = getMobileBallContactTarget({
    carPosition: { x: 0, y: 0.5, z: 8 },
    carVelocity: { x: 0, y: 0, z: -10 },
    carForward: { x: 0, z: -1 },
    ballPosition: { x: 2, y: 1.2, z: 0 },
    ballVelocity: { x: 0, y: 0, z: 0 },
    goalPosition: { x: 0, z: -51.2 }
  });
  assert.equal(shotSetup.reachable, true);
  assert.ok(shotSetup.shotAlignment > 0.8, shotSetup);
  assert.ok(shotSetup.aimX > 2, shotSetup);

  const high = getMobileBallContactTarget({
    carPosition: { x: 0, y: 0.5, z: 0 },
    carForward: { x: 0, z: -1 },
    ballPosition: { x: 0, y: 6, z: -6 }
  });
  const behind = getMobileBallContactTarget({
    carPosition: { x: 0, y: 0.5, z: 0 },
    carForward: { x: 0, z: -1 },
    ballPosition: { x: 0, y: 1.2, z: 5 }
  });
  assert.equal(high.reachable, false);
  assert.equal(behind.reachable, false);
});

test('mobile contact assist strongly corrects misses while preserving a full deliberate override', () => {
  const corrected = applyMobileBallContactAssist(0, {
    reachable: true,
    signedAngle: 0.20,
    distance: 5,
    throttle: 1,
    airborne: false
  });
  assert.equal(corrected.active, true);
  assert.ok(corrected.steer > 0.52 && corrected.steer <= 0.72, corrected);

  const mediumOpposition = applyMobileBallContactAssist(-0.7, {
    reachable: true,
    signedAngle: 0.20,
    distance: 5,
    throttle: 1,
    airborne: false
  });
  assert.ok(mediumOpposition.steer > -0.15, mediumOpposition);
  assert.equal(mediumOpposition.active, true);

  const fullOverride = applyMobileBallContactAssist(-1, {
    reachable: true,
    signedAngle: 0.20,
    distance: 5,
    throttle: 1,
    airborne: false
  });
  assert.ok(fullOverride.steer < -0.7, fullOverride);

  const airborne = applyMobileBallContactAssist(0.2, {
    reachable: true,
    signedAngle: 0.20,
    distance: 5,
    throttle: 1,
    airborne: true
  });
  assert.equal(airborne.active, true);
  assert.ok(airborne.steer > 0.4, airborne);
});
