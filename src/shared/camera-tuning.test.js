import assert from 'node:assert/strict';
import test from 'node:test';
import { getBallCamHighBallAssist } from './camera-tuning.js';

test('ball cam stays quiet for normal-height balls and strongly follows high balls', () => {
  const ground = getBallCamHighBallAssist(-2);
  const low = getBallCamHighBallAssist(2);
  const medium = getBallCamHighBallAssist(8);
  const high = getBallCamHighBallAssist(22);

  assert.deepEqual(ground, { blend: 0, distanceExtra: 0, heightExtra: 0, lookLift: 0 });
  assert.ok(low.lookLift < 0.4);
  assert.ok(medium.heightExtra > low.heightExtra * 2);
  assert.ok(high.distanceExtra > 8);
  assert.ok(high.heightExtra > 10);
  assert.ok(high.lookLift > 11);
});
