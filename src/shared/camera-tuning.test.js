import assert from 'node:assert/strict';
import test from 'node:test';
import { getBallCamFraming, getStableBallCamRig } from './camera-tuning.js';

test('ball cam base rig keeps a fixed car-relative height', () => {
  const rig = getStableBallCamRig({ distance: 3.2, height: 1.4, lookHeight: 0.3 });
  assert.deepEqual(rig, { distance: 3.35, height: 1.5, lookHeight: 0.3 });
  assert.deepEqual(getStableBallCamRig({ distance: -20, height: 100, lookHeight: 20 }), {
    distance: 1.65,
    height: 8.1,
    lookHeight: 4
  });
});

test('high-ball framing looks up while retaining car and ball inside the vertical FOV', () => {
  const low = getBallCamFraming({
    baseDistance: 3.1, cameraHeight: 1.27, carAnchorDrop: 0.34,
    ballHeight: 1, ballForward: 8, verticalFovDegrees: 72
  });
  const high = getBallCamFraming({
    baseDistance: 3.1, cameraHeight: 1.27, carAnchorDrop: 0.34,
    ballHeight: 19, ballForward: 0, verticalFovDegrees: 72
  });

  assert.ok(high.aimElevation > low.aimElevation, `low=${low.aimElevation} high=${high.aimElevation}`);
  assert.ok(high.distance > 3.1 && high.distance < 24);
  assert.ok(high.aimElevation - high.carElevation <= high.verticalLimit + 1e-8);
  assert.ok(high.ballElevation - high.aimElevation <= high.verticalLimit + 1e-8);
});
