import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayBuffer, cloneReplayState, sampleReplayFrames } from './ReplayBuffer.js';

const state = (tick, x) => ({
  tick, orangeScore: 1, blueScore: 2, boostPadMask: 0xffff, connected: [1,1,0,0],
  cars: Array.from({ length: 4 }, (_, i) => ({ p: [x + i, 1, 0], r: [0,0,0,1], v: [1,0,0], w: [0,0,0], g: 1, b: 100 })),
  ball: { p: [x * 2, 2, 0], r: [0,0,0,1], v: [2,0,0], w: [0,0,0] }
});

test('replay buffer keeps a bounded pre-goal window', () => {
  const buffer = new ReplayBuffer(60, 8);
  for (let tick = 0; tick <= 600; tick += 3) buffer.push(state(tick, tick));
  const frames = buffer.window(600, 6.25);
  assert.ok(frames[0].tick >= 225);
  assert.equal(frames.at(-1).tick, 600);
});

test('replay sampling interpolates transforms without mutating history', () => {
  const frames = [cloneReplayState(state(100, 0)), cloneReplayState(state(110, 10))];
  const sample = sampleReplayFrames(frames, 0.5);
  assert.equal(sample.cars[0].p[0], 5);
  assert.equal(sample.ball.p[0], 10);
  assert.equal(frames[0].cars[0].p[0], 0);
});
