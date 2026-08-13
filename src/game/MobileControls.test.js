import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMicroDeadZone,
  curveSteering,
  curveThrottle,
  resolveAnalogStick,
  resolveStickCodes
} from './MobileControls.js';

test('mobile steering has only a tiny micro dead zone and then grows continuously', () => {
  assert.equal(applyMicroDeadZone(0.02), 0);
  assert.ok(applyMicroDeadZone(0.04) > 0);

  const quarter = Math.abs(curveSteering(0.25, { speedKmh: 20 }));
  const half = Math.abs(curveSteering(0.50, { speedKmh: 20 }));
  const threeQuarter = Math.abs(curveSteering(0.75, { speedKmh: 20 }));
  assert.ok(quarter > 0.04 && quarter < 0.16, quarter);
  assert.ok(half > quarter * 2, { quarter, half });
  assert.ok(threeQuarter > half, { half, threeQuarter });
  assert.ok(Math.abs(curveSteering(-1, { speedKmh: 20 }) - 1) < 1e-9); // screen-left -> physics-left
  assert.ok(Math.abs(curveSteering(1, { speedKmh: 20 }) + 1) < 1e-9);
});

test('high speed softens mid-stick steering but full travel always remains full steering', () => {
  const lowSpeedMid = Math.abs(curveSteering(0.55, { speedKmh: 20 }));
  const highSpeedMid = Math.abs(curveSteering(0.55, { speedKmh: 115 }));
  assert.ok(highSpeedMid < lowSpeedMid, { lowSpeedMid, highSpeedMid });
  assert.ok(Math.abs(curveSteering(1, { speedKmh: 115 }) + 1) < 1e-9);
});

test('drift deliberately makes the same thumb travel steer more aggressively', () => {
  const normal = Math.abs(curveSteering(0.48, { speedKmh: 55, drift: false }));
  const drift = Math.abs(curveSteering(0.48, { speedKmh: 55, drift: true }));
  assert.ok(drift > normal * 1.25, { normal, drift });
});

test('throttle is analog and soft axis lock filters accidental cross-axis wobble', () => {
  assert.ok(curveThrottle(-0.30) > 0 && curveThrottle(-0.30) < curveThrottle(-0.8));
  assert.ok(curveThrottle(0.5) < 0);

  const mostlySteer = resolveAnalogStick(0.7, 0.12, { speedKmh: 30 });
  assert.ok(Math.abs(mostlySteer.steer) > Math.abs(mostlySteer.throttle) * 3, mostlySteer);
  const diagonal = resolveAnalogStick(-0.7, -0.7, { speedKmh: 30 });
  assert.ok(diagonal.steer > 0.3 && diagonal.throttle > 0.3, diagonal);
});

test('compatibility direction helper follows the continuous analog signs', () => {
  assert.deepEqual(resolveStickCodes(0, -1), ['KeyW']);
  assert.deepEqual(resolveStickCodes(0, 1), ['KeyS']);
  assert.deepEqual(resolveStickCodes(-1, 0), ['KeyA']);
  assert.deepEqual(resolveStickCodes(1, 0), ['KeyD']);
  assert.deepEqual(resolveStickCodes(-0.8, -0.8), ['KeyA', 'KeyW']);
});
