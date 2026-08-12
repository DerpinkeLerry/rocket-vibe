import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStickCodes } from './MobileControls.js';

test('mobile stick maps cardinal directions to existing keyboard inputs', () => {
  assert.deepEqual(resolveStickCodes(0, -1), ['KeyW']);
  assert.deepEqual(resolveStickCodes(0, 1), ['KeyS']);
  assert.deepEqual(resolveStickCodes(-1, 0), ['KeyA']);
  assert.deepEqual(resolveStickCodes(1, 0), ['KeyD']);
});

test('mobile stick supports diagonal drive/air control and a center dead zone', () => {
  assert.deepEqual(resolveStickCodes(-0.8, -0.8), ['KeyA', 'KeyW']);
  assert.deepEqual(resolveStickCodes(0.8, 0.8), ['KeyD', 'KeyS']);
  assert.deepEqual(resolveStickCodes(0.1, -0.1), []);
});
