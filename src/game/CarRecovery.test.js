import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCarUpY,
  getUprightRecoveryRotation,
  shouldUseCarRecoveryJump
} from './CarRecovery.js';

test('recovery jump recognizes a car resting on its roof or side near the floor', () => {
  const roof = { x: 1, y: 0, z: 0, w: 0 };
  const side = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
  assert.equal(getCarUpY(roof), -1);
  assert.ok(Math.abs(getCarUpY(side)) < 1e-9);
  for (const rotation of [roof, side]) {
    assert.equal(shouldUseCarRecoveryJump({
      rotation,
      grounded: false,
      nearFloor: true,
      airTime: 0.3,
      verticalSpeed: 0
    }), true);
  }
});

test('recovery jump does not interrupt normal driving, aerials or ceiling driving', () => {
  const upright = { x: 0, y: 0, z: 0, w: 1 };
  const roof = { x: 1, y: 0, z: 0, w: 0 };
  assert.equal(shouldUseCarRecoveryJump({ rotation: upright, nearFloor: true, airTime: 1 }), false);
  assert.equal(shouldUseCarRecoveryJump({ rotation: roof, nearFloor: false, airTime: 1 }), false);
  assert.equal(shouldUseCarRecoveryJump({ rotation: roof, nearFloor: true, airTime: 0.05 }), false);
  assert.equal(shouldUseCarRecoveryJump({ rotation: roof, nearFloor: true, airTime: 1, verticalSpeed: -8 }), false);
});

test('recovery rotation becomes world-upright while preserving the driving heading', () => {
  const halfYaw = Math.PI * 0.25;
  const recovered = getUprightRecoveryRotation({
    x: 0,
    y: Math.sin(halfYaw),
    z: 0,
    w: Math.cos(halfYaw)
  });
  assert.equal(recovered.x, 0);
  assert.equal(recovered.z, 0);
  assert.ok(Math.abs(recovered.y - Math.sin(halfYaw)) < 1e-9, recovered);
  assert.ok(Math.abs(recovered.w - Math.cos(halfYaw)) < 1e-9, recovered);
});
