import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BALL_TUNING,
  CAR_TUNING,
  FULL_STEER_SPEED,
  FULL_STEER_TIME_CONSTANT,
  getDirectionalDodgeLiftScale,
  throttleAccelerationAtSpeed,
  turningAngularSpeed,
  turningCurvatureAtSpeed
} from './game-tuning.js';
import { ARENA_TUNING, CAR_HITBOX, clampPointToRoundedArena } from './arena-tuning.js';

test('pure side dodges add no vertical lift while forward and diagonal dodges blend it', () => {
  assert.equal(getDirectionalDodgeLiftScale(0), 0);
  assert.equal(getDirectionalDodgeLiftScale(0.19), 0);
  assert.equal(getDirectionalDodgeLiftScale(-0.19), 0);
  assert.equal(getDirectionalDodgeLiftScale(1), 1);
  assert.equal(getDirectionalDodgeLiftScale(-1), 1);
  assert.ok(Math.abs(getDirectionalDodgeLiftScale(Math.SQRT1_2) - Math.SQRT1_2) < 1e-12);
});

test('shared defaults match the RLBot arena, car, jump and ball reference', () => {
  assert.deepEqual(ARENA_TUNING, {
    width: 81.92, length: 102.40, ceiling: 20.44, wallHeight: 20.44,
    cornerRadius: 11.52, rampRadius: 2.56, rampSegments: 16,
    ceilingRampRadius: 2.56, wallThickness: 0.4,
    goalWidth: 17.8551, goalHeight: 6.42775, goalDepth: 8.8,
    goalRampRadius: 2.56, goalMouthRadius: 0.8
  });
  assert.deepEqual(CAR_HITBOX, { x: 0.421, y: 0.1701, z: 0.59004 });
  assert.equal(CAR_TUNING.maxGroundSpeed, 14.1);
  assert.equal(CAR_TUNING.maxBoostSpeed, 23);
  assert.equal(CAR_TUNING.supersonicSpeed, 22);
  assert.equal(CAR_TUNING.boostConsumptionPerSecond, 33.3);
  assert.equal(CAR_TUNING.boostAcceleration, 9.91666);
  assert.equal(CAR_TUNING.airBoostAcceleration, 10.58333);
  assert.equal(CAR_TUNING.brakeAcceleration, 35);
  assert.equal(CAR_TUNING.coastDeceleration, 5.25);
  assert.equal(CAR_TUNING.jumpSpeed, 2.92);
  assert.equal(CAR_TUNING.jumpHoldAcceleration, 14.6);
  assert.equal(CAR_TUNING.jumpHoldDuration, 0.2);
  assert.equal(CAR_TUNING.doubleJumpSpeed, 2.91667);
  assert.equal(CAR_TUNING.gravity, 6.5);
  assert.equal(CAR_TUNING.maxAirAngular, 5.5);
  assert.equal(FULL_STEER_SPEED, 12.34);
  assert.equal(FULL_STEER_TIME_CONSTANT, 0.74704);

  assert.equal(BALL_TUNING.radius, 0.9125);
  assert.equal(BALL_TUNING.restingHeight, 0.9315);
  assert.equal(BALL_TUNING.mass, 30);
  assert.equal(BALL_TUNING.restitution, 0.6);
  assert.equal(BALL_TUNING.maxSpeed, 60);
  assert.equal(BALL_TUNING.terminalSpeed, 212.68220703125);
  assert.equal(BALL_TUNING.maxAngularSpeed, 6);
  assert.equal(BALL_TUNING.linearDamping, 0.030562030038766);
  assert.ok(Math.abs(CAR_TUNING.gravity / BALL_TUNING.linearDamping - BALL_TUNING.terminalSpeed) < 1e-9);
});

test('arena corners use the published 45-degree planes and 8064 uu intercept', () => {
  assert.ok(Math.abs((ARENA_TUNING.length - 2 * ARENA_TUNING.cornerRadius) - 79.36) < 1e-12);
  assert.ok(Math.abs((ARENA_TUNING.width - 2 * ARENA_TUNING.cornerRadius) - 58.88) < 1e-12);
  assert.ok(Math.abs(ARENA_TUNING.cornerRadius * Math.SQRT2 - 16.29174) < 1e-6);

  const point = { x: 40, y: 3, z: 50 };
  clampPointToRoundedArena(point);
  assert.ok(Math.abs(point.x + point.z - 80.64) < 1e-12, JSON.stringify(point));
  assert.ok(Math.abs((40 - point.x) - (50 - point.z)) < 1e-12, JSON.stringify(point));
});

test('shared throttle and turning functions reproduce the measured piecewise curves', () => {
  const close = (actual, expected, tolerance = 1e-10) => assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`
  );
  close(throttleAccelerationAtSpeed(0), 16);
  close(throttleAccelerationAtSpeed(5), 10.857142857142858);
  close(throttleAccelerationAtSpeed(10), 5.714285714285714);
  close(throttleAccelerationAtSpeed(14), 1.6);
  close(throttleAccelerationAtSpeed(14.05), 0.8);
  close(throttleAccelerationAtSpeed(14.1), 0);
  close(turningCurvatureAtSpeed(0), 0.69);
  close(turningCurvatureAtSpeed(5), 0.398);
  close(turningCurvatureAtSpeed(10), 0.235);
  close(turningCurvatureAtSpeed(15), 0.1375);
  close(turningCurvatureAtSpeed(17.5), 0.11);
  close(turningCurvatureAtSpeed(23), 0.088);
  close(turningAngularSpeed(10, 1), 2.35);
  close(turningAngularSpeed(10, 0.25), 0.5875);
});

test('offline engine and online predictor both run the reference 120 Hz model', async () => {
  const [gameSource, carSource, predictorSource] = await Promise.all([
    readFile(new URL('../game/Game.js', import.meta.url), 'utf8'),
    readFile(new URL('../game/Car.js', import.meta.url), 'utf8'),
    readFile(new URL('../network/LocalCarPredictor.js', import.meta.url), 'utf8')
  ]);
  assert.match(gameSource, /this\.fixedDt = 1 \/ 120/);
  assert.match(gameSource, /new RAPIER\.World\(\{ x: 0, y: -CAR_TUNING\.gravity, z: 0 \}\)/);
  assert.match(gameSource, /simulationHz: 120/);
  for (const source of [carSource, predictorSource]) {
    assert.match(source, /throttleAccelerationAtSpeed/);
    assert.match(source, /turningAngularSpeed/);
    assert.match(source, /fullSteerDecelerationAtSpeed/);
    assert.match(source, /jumpStickyAcceleration/);
    assert.match(source, /airBoostAcceleration/);
  }
  assert.match(predictorSource, /boundaryDistance = \(intercept - absX - absZ\) \* Math\.SQRT1_2/);
});
