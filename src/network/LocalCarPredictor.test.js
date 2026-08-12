import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCarPredictor } from './LocalCarPredictor.js';
import { INPUT_BITS, INPUT_EDGES } from '../shared/game-tuning.js';
import { ARENA_TUNING, CAR_HITBOX } from '../shared/arena-tuning.js';

class MockBody {
  constructor(position = { x: 0, y: CAR_HITBOX.y, z: 0 }) {
    this.p = { ...position };
    this.r = { x: 0, y: 0, z: 0, w: 1 };
    this.v = { x: 0, y: 0, z: 0 };
    this.w = { x: 0, y: 0, z: 0 };
  }

  translation() { return this.p; }
  rotation() { return this.r; }
  linvel() { return this.v; }
  angvel() { return this.w; }
  setTranslation(value) { this.p = { ...value }; }
  setRotation(value) { this.r = { ...value }; }
  setLinvel(value) { this.v = { ...value }; }
  setAngvel(value) { this.w = { ...value }; }
}

function makePredictor(position) {
  const body = new MockBody(position);
  const car = { body, grounded: false, reset() {} };
  return { body, predictor: new LocalCarPredictor(car, { simulationHz: 120 }) };
}

test('jump lockout prevents the floor heuristic from cancelling a jump', () => {
  const { body, predictor } = makePredictor();
  predictor.syncGrounded(true);
  predictor.setInput({ mask: 0, edges: INPUT_EDGES.JUMP });
  predictor.step(1 / 60);

  assert.ok(body.translation().y > CAR_HITBOX.y + 0.05);
  assert.ok(body.linvel().y > 10);
  assert.equal(predictor.grounded, false);
});

test('prediction clamps the floor instead of waiting for a server correction', () => {
  const { body, predictor } = makePredictor({ x: 0, y: -1, z: 0 });
  body.setLinvel({ x: 0, y: -30, z: 0 });
  predictor.step(1 / 120);

  assert.ok(body.translation().y >= CAR_HITBOX.y - 1e-9);
  assert.equal(body.linvel().y, 0);
});

test('prediction turns side-wall motion into an upward ramp climb', () => {
  const startX = ARENA_TUNING.width * 0.5 - 0.9;
  const { body, predictor } = makePredictor({ x: startX, y: CAR_HITBOX.y, z: 0 });
  body.setLinvel({ x: 40, y: 0, z: 7 });
  predictor.syncGrounded(true);
  predictor.step(1 / 60);

  assert.ok(body.translation().x < ARENA_TUNING.width * 0.5);
  assert.ok(body.translation().y > CAR_HITBOX.y);
  assert.ok(body.linvel().x > 0);
  assert.ok(body.linvel().y > 0);
  assert.ok(body.linvel().z > 0);
});

test('prediction can continuously drive from floor onto vertical glass', () => {
  const startX = ARENA_TUNING.width * 0.5 - ARENA_TUNING.rampRadius - 4;
  const { body, predictor } = makePredictor({ x: startX, y: CAR_HITBOX.y, z: 0 });
  const halfYaw = -Math.PI / 4;
  body.setRotation({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) });
  predictor.syncGrounded(true);
  predictor.setInput({ mask: INPUT_BITS.W | INPUT_BITS.BOOST, edges: 0 });

  let maximumY = body.translation().y;
  let reachedVerticalGlass = false;
  for (let index = 0; index < 120 * 3; index++) {
    predictor.step(1 / 120);
    maximumY = Math.max(maximumY, body.translation().y);
    if (body.translation().y > ARENA_TUNING.rampRadius + 1
      && predictor.grounded && Math.abs(predictor.groundNormal.x) > 0.75) {
      reachedVerticalGlass = true;
    }
  }

  assert.ok(maximumY > ARENA_TUNING.rampRadius + 2, `maximum wall height was ${maximumY}`);
  assert.ok(body.translation().x <= ARENA_TUNING.width * 0.5 + 0.01);
  assert.equal(reachedVerticalGlass, true);
});

test('prediction performs a directional second-jump dodge', () => {
  const { body, predictor } = makePredictor();
  predictor.syncGrounded(true);
  predictor.setInput({ mask: 0, edges: INPUT_EDGES.JUMP });
  predictor.step(1 / 120);

  predictor.setInput({ mask: INPUT_BITS.W, edges: INPUT_EDGES.JUMP });
  predictor.step(1 / 120);

  assert.equal(predictor.jumpCount, 2);
  assert.ok(body.linvel().z < -CAR_HITBOX.z * 6, `forward speed was ${body.linvel().z}`);
  assert.ok(body.angvel().x < -7, `flip angular speed was ${body.angvel().x}`);
  assert.ok(predictor.dodgeTime > 0);
});

test('prediction keeps a parked car attached to vertical glass until jump', () => {
  const wallX = ARENA_TUNING.width * 0.5 - CAR_HITBOX.y + 0.03;
  const { body, predictor } = makePredictor({ x: wallX, y: 11, z: 0 });
  const halfTurn = Math.PI / 4;
  body.setRotation({ x: 0, y: 0, z: Math.sin(halfTurn), w: Math.cos(halfTurn) });
  predictor.grounded = true;
  predictor.groundNormal.set(-1, 0, 0);

  const startY = body.translation().y;
  for (let index = 0; index < 120; index++) predictor.step(1 / 120);

  assert.equal(predictor.grounded, true);
  assert.ok(predictor.groundNormal.x < -0.9);
  assert.ok(startY - body.translation().y < 0.18, `wall drop was ${startY - body.translation().y}`);

  const beforeX = body.translation().x;
  predictor.setInput({ mask: 0, edges: INPUT_EDGES.JUMP });
  predictor.step(1 / 120);
  assert.equal(predictor.grounded, false);
  assert.ok(predictor.groundLockout > 0);
  assert.ok(body.translation().x < beforeX);
  assert.ok(body.linvel().x < -8);
});

test('prediction gives a held jump more lift than a tap', () => {
  const tapped = makePredictor();
  const held = makePredictor();
  tapped.predictor.syncGrounded(true);
  held.predictor.syncGrounded(true);
  tapped.predictor.setInput({ mask: 0, edges: INPUT_EDGES.JUMP });
  held.predictor.setInput({ mask: INPUT_BITS.JUMP, edges: INPUT_EDGES.JUMP });

  for (let index = 0; index < 18; index++) {
    tapped.predictor.step(1 / 120);
    held.predictor.step(1 / 120);
  }

  assert.ok(held.body.translation().y > tapped.body.translation().y + 0.15);
  assert.ok(held.body.linvel().y > tapped.body.linvel().y + 0.5);
});
