import assert from 'node:assert/strict';
import test from 'node:test';
import { getPhysicsInterpolationAlpha } from './PhysicsInterpolation.js';

test('offline visual interpolation follows the fixed-step remainder without extrapolating', () => {
  const fixedDt = 1 / 120;
  assert.equal(getPhysicsInterpolationAlpha(0, fixedDt), 0);
  assert.ok(Math.abs(getPhysicsInterpolationAlpha(fixedDt * 0.5, fixedDt) - 0.5) < 1e-12);
  assert.equal(getPhysicsInterpolationAlpha(fixedDt * 2, fixedDt), 1);
  assert.equal(getPhysicsInterpolationAlpha(-1, fixedDt), 0);
  assert.equal(getPhysicsInterpolationAlpha(fixedDt * 0.5, fixedDt, false), 1);
});
