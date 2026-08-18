import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SOUND_EFFECTS,
  calculateEngineMix,
  classifyGameplayImpact,
  spatializeEffect
} from './SoundDesign.js';

const gameSource = readFileSync(new URL('./Game.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('sound design covers gameplay, match and interface effects without music', () => {
  for (const effect of [
    'jump', 'flip', 'land', 'carImpact', 'ballHit', 'ballBounce',
    'boostPickupSmall', 'boostPickupFull', 'boostEmpty',
    'countdown', 'clockTick', 'go', 'overtime', 'goal', 'demolition', 'respawn', 'replay',
    'gearShift',
    'camera', 'chat', 'uiConfirm', 'matchReady', 'matchEnd'
  ]) assert.ok(SOUND_EFFECTS.includes(effect), effect);
  assert.equal(SOUND_EFFECTS.some((effect) => /music|song|track/i.test(effect)), false);
});

test('continuous vehicle mix responds to throttle, boost, drift and speed', () => {
  const idle = calculateEngineMix({ speedKmh: 0, throttle: 0, grounded: true, active: true });
  const driving = calculateEngineMix({ speedKmh: 120, throttle: 1, steer: 0.8, grounded: true, active: true });
  const drifting = calculateEngineMix({ speedKmh: 85, throttle: 1, steer: 0.8, grounded: true, drifting: true, boosting: true });
  const paused = calculateEngineMix({ speedKmh: 120, throttle: 1, grounded: true, active: false, boosting: true });

  assert.ok(driving.engineFrequency > idle.engineFrequency);
  assert.ok(driving.engineGain > idle.engineGain);
  assert.ok(drifting.boostGain > 0);
  assert.ok(drifting.skidGain > driving.skidGain);
  assert.equal(paused.engineGain, 0);
  assert.equal(paused.boostGain, 0);
});

test('world effects pan and attenuate relative to the camera', () => {
  const listener = { x: 0, y: 2, z: 0 };
  const right = { x: 1, y: 0, z: 0 };
  const rightSide = spatializeEffect({ x: 10, y: 2, z: 0 }, listener, right);
  const leftSide = spatializeEffect({ x: -10, y: 2, z: 0 }, listener, right);
  const far = spatializeEffect({ x: 100, y: 2, z: 0 }, listener, right);

  assert.ok(rightSide.pan > 0.99);
  assert.ok(leftSide.pan < -0.99);
  assert.ok(far.gain < rightSide.gain);
});

test('ball velocity discontinuities distinguish car hits from arena bounces', () => {
  const quiet = classifyGameplayImpact({
    previousBallVelocity: { x: 0, y: -2, z: 0 },
    ballVelocity: { x: 0, y: -3, z: 0 },
    distanceToCar: 2
  });
  const carHit = classifyGameplayImpact({
    previousBallVelocity: { x: 0, y: -8, z: 0 },
    ballVelocity: { x: 8, y: 5, z: -4 },
    distanceToCar: 2.5
  });
  const bounce = classifyGameplayImpact({
    previousBallVelocity: { x: 0, y: -10, z: 0 },
    ballVelocity: { x: 0, y: 8, z: 0 },
    distanceToCar: 20
  });

  assert.equal(quiet.type, null);
  assert.equal(carHit.type, 'ballHit');
  assert.equal(bounce.type, 'ballBounce');
  assert.ok(bounce.intensity > 0.5);
});

test('game and application wire continuous, physical, match and UI audio', () => {
  assert.match(mainSource, /installGlobalUISounds\(document\)/);
  assert.match(gameSource, /soundDesign\.updateGameplay\(/);
  assert.match(gameSource, /soundDesign\.play\('goal'/);
  assert.match(gameSource, /soundDesign\.play\('demolition'/);
  assert.match(gameSource, /soundDesign\.play\('countdown'/);
  assert.match(gameSource, /soundDesign\.play\('go'/);
  assert.match(gameSource, /soundDesign\.play\('respawn'/);
  assert.match(gameSource, /soundDesign\.play\('chat'/);
  assert.match(gameSource, /soundDesign\.play\('clockTick'/);
  assert.match(gameSource, /soundDesign\.play\('overtime'/);
});
