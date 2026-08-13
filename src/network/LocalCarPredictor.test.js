import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCarPredictor } from './LocalCarPredictor.js';
import { INPUT_BITS, INPUT_EDGES, INPUT_FLAGS } from '../shared/game-tuning.js';
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

function startPredictorDodge(mask) {
  const result = makePredictor();
  result.predictor.syncGrounded(true);
  result.predictor.setInput({ mask: 0, edges: INPUT_EDGES.JUMP });
  result.predictor.step(1 / 120);
  result.predictor.setInput({ mask, edges: INPUT_EDGES.JUMP });
  result.predictor.step(1 / 120);
  return result;
}

test('prediction performs a finite directional second-jump dodge', () => {
  const { body, predictor } = startPredictorDodge(INPUT_BITS.W);

  assert.equal(predictor.jumpCount, 2);
  assert.ok(body.linvel().z < -CAR_HITBOX.z * 6, `forward speed was ${body.linvel().z}`);
  assert.ok(body.angvel().x < -7, `flip angular speed was ${body.angvel().x}`);
  assert.ok(predictor.dodgeTime > 0);
  assert.ok(predictor.dodgeAngleRemaining > 0);
});

test('prediction side dodges roll and push in the matching direction', () => {
  const left = startPredictorDodge(INPUT_BITS.A);
  assert.ok(left.body.linvel().x < -8, `left dodge x speed was ${left.body.linvel().x}`);
  assert.ok(left.body.angvel().z > 7, `left roll angular speed was ${left.body.angvel().z}`);

  const right = startPredictorDodge(INPUT_BITS.D);
  assert.ok(right.body.linvel().x > 8, `right dodge x speed was ${right.body.linvel().x}`);
  assert.ok(right.body.angvel().z < -7, `right roll angular speed was ${right.body.angvel().z}`);
});

test('prediction stops a held directional dodge after one revolution', () => {
  const { body, predictor } = startPredictorDodge(INPUT_BITS.W);
  body.setTranslation({ x: 0, y: 5, z: body.translation().z });

  // Keep W held: the post-dodge input latch should prevent a second pitch spin.
  for (let index = 0; index < 120; index++) predictor.step(1 / 120);

  assert.ok(predictor.dodgeAngleRemaining <= 1e-6);
  assert.ok(predictor.dodgeTime <= 1e-6);
  assert.ok(Math.hypot(body.angvel().x, body.angvel().y, body.angvel().z) < 0.08,
    `angular velocity remained ${JSON.stringify(body.angvel())}`);

  const q = body.rotation();
  assert.ok(Math.abs(q.x) < 0.03 && Math.abs(q.y) < 0.03 && Math.abs(q.z) < 0.03,
    `orientation did not return after one revolution: ${JSON.stringify(q)}`);

  predictor.setInput({ mask: 0, edges: 0 });
  predictor.step(1 / 120);
  predictor.setInput({ mask: INPUT_BITS.W, edges: 0 });
  for (let index = 0; index < 18; index++) predictor.step(1 / 120);
  assert.ok(body.angvel().x < -0.2, `air pitch did not recover: ${body.angvel().x}`);
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

test('prediction air boost gains altitude when the nose is raised', () => {
  const { body, predictor } = makePredictor({ x: 0, y: 9, z: 0 });
  const pitch = 50 * Math.PI / 180;
  body.setRotation({ x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) });
  predictor.setInput({ mask: INPUT_BITS.BOOST, edges: 0 });

  const startY = body.translation().y;
  for (let index = 0; index < 90; index++) predictor.step(1 / 120);

  assert.ok(body.translation().y > startY + 0.5,
    `air boost failed to climb: start=${startY} end=${body.translation().y}`);
  assert.ok(body.linvel().y > 1, `air boost vertical speed was ${body.linvel().y}`);
});

test('prediction consumes boost and enforces the 120 km/h hard cap', () => {
  const { body, predictor } = makePredictor();
  predictor.syncGrounded(true);
  predictor.setInput({ mask: INPUT_BITS.W | INPUT_BITS.BOOST, edges: 0 });

  for (let index = 0; index < 120; index++) predictor.step(1 / 120);
  assert.ok(predictor.boost < 67.1 && predictor.boost > 66.2, `boost after 1s was ${predictor.boost}`);
  assert.ok(Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z) * 3.6 <= 120.01);

  for (let index = 0; index < 250; index++) predictor.step(1 / 120);
  assert.ok(predictor.boost <= 0.001, `boost did not empty: ${predictor.boost}`);
});


test('prediction preserves boosted momentum after releasing boost until braking', () => {
  const { body, predictor } = makePredictor();
  predictor.syncGrounded(true);
  predictor.setInput({ mask: INPUT_BITS.W | INPUT_BITS.BOOST, edges: 0 });
  for (let index = 0; index < 240; index++) predictor.step(1 / 120);

  const boosted = Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z) * 3.6;
  assert.ok(boosted > 105, `boosted speed was ${boosted}`);

  predictor.setInput({ mask: 0, edges: 0 });
  for (let index = 0; index < 120; index++) predictor.step(1 / 120);
  const held = Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z) * 3.6;
  assert.ok(held >= boosted - 1, `boost momentum decayed after release from ${boosted} to ${held}`);

  predictor.setInput({ mask: INPUT_BITS.S, edges: 0 });
  for (let index = 0; index < 60; index++) predictor.step(1 / 120);
  const braked = Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z) * 3.6;
  assert.ok(braked < held - 8, `braking failed to reduce ${held}, got ${braked}`);
});


test('prediction scales first-jump height with continuous hold time', () => {
  function apex(holdSteps) {
    const { body, predictor } = makePredictor();
    predictor.syncGrounded(true);
    predictor.setInput({ mask: holdSteps > 0 ? INPUT_BITS.JUMP : 0, edges: INPUT_EDGES.JUMP, flags: 0 });
    let maxY = body.translation().y;
    for (let step = 0; step < 240; step++) {
      if (holdSteps > 0 && step === holdSteps) predictor.setInput({ mask: 0, edges: 0, flags: 0 });
      predictor.step(1 / 120);
      maxY = Math.max(maxY, body.translation().y);
    }
    return maxY;
  }

  const tap = apex(0);
  const medium = apex(10);
  const full = apex(28);
  assert.ok(medium > tap + 0.65, `tap=${tap} medium=${medium}`);
  assert.ok(full > medium + 0.65, `medium=${medium} full=${full}`);
});

test('prediction drift turns harder while retaining lateral slip', () => {
  function run(flags) {
    const { body, predictor } = makePredictor();
    body.setLinvel({ x: 0, y: 0, z: -15 });
    predictor.syncGrounded(true);
    predictor.setInput({ mask: INPUT_BITS.W | INPUT_BITS.A, edges: 0, flags });
    for (let index = 0; index < 50; index++) predictor.step(1 / 120);
    const q = body.rotation();
    const yawTurn = Math.abs(2 * Math.atan2(q.y, q.w));
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const forwardX = -2 * (q.x * q.z + q.w * q.y);
    const forwardZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const dot = speed > 1e-6 ? (v.x * forwardX + v.z * forwardZ) / speed : 1;
    const slip = Math.acos(Math.max(-1, Math.min(1, dot)));
    return { yawTurn, slip };
  }

  const normal = run(0);
  const drift = run(INPUT_FLAGS.DRIFT);
  assert.ok(drift.yawTurn > normal.yawTurn + 0.2, JSON.stringify({ normal, drift }));
  assert.ok(drift.slip > normal.slip + 0.1, JSON.stringify({ normal, drift }));
});

test('prediction consumes continuous analog steering and throttle instead of snapping to digital', () => {
  function run({ throttle, steer }) {
    const { body, predictor } = makePredictor();
    predictor.syncGrounded(true);
    predictor.setInput({
      mask: 0,
      edges: 0,
      flags: INPUT_FLAGS.ANALOG,
      throttle,
      steer
    });
    for (let index = 0; index < 45; index++) predictor.step(1 / 120);
    const q = body.rotation();
    return {
      speed: Math.hypot(body.linvel().x, body.linvel().z),
      yaw: Math.abs(2 * Math.atan2(q.y, q.w))
    };
  }

  const softThrottle = run({ throttle: 0.25, steer: 0 });
  const fullThrottle = run({ throttle: 1, steer: 0 });
  assert.ok(fullThrottle.speed > softThrottle.speed * 2.2, JSON.stringify({ softThrottle, fullThrottle }));

  const softSteer = run({ throttle: 1, steer: 0.25 });
  const fullSteer = run({ throttle: 1, steer: 1 });
  assert.ok(fullSteer.yaw > softSteer.yaw * 1.8, JSON.stringify({ softSteer, fullSteer }));
});
