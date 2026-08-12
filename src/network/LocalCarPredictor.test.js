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
