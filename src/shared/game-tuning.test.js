import test from 'node:test';
import assert from 'node:assert/strict';
import { getDirectionalDodgeLiftScale } from './game-tuning.js';

test('pure side dodges add no vertical lift while forward and diagonal dodges blend it', () => {
  assert.equal(getDirectionalDodgeLiftScale(0), 0);
  assert.equal(getDirectionalDodgeLiftScale(0.19), 0);
  assert.equal(getDirectionalDodgeLiftScale(-0.19), 0);
  assert.equal(getDirectionalDodgeLiftScale(1), 1);
  assert.equal(getDirectionalDodgeLiftScale(-1), 1);
  assert.ok(Math.abs(getDirectionalDodgeLiftScale(Math.SQRT1_2) - Math.SQRT1_2) < 1e-12);
});
