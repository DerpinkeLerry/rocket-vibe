import test from 'node:test';
import assert from 'node:assert/strict';
import { LanClient } from './LanClient.js';

const STATE_BYTES = 277;
const LEGACY_STATE_BYTES = 271;

test('binary state reads boost, pad mask, scores and entity data from protocol v4 layout', () => {
  const client = new LanClient('Test Pilot');
  const buffer = new ArrayBuffer(STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, 2);
  view.setUint32(1, 0x11223344, true);
  view.setUint8(5, 0b0101);
  view.setUint8(6, 0b0001);
  view.setUint16(7, 12, true);
  view.setUint16(9, 9, true);
  view.setUint8(11, 73);
  view.setUint8(12, 44);
  view.setUint8(13, 20);
  view.setUint8(14, 0);
  view.setUint16(15, 0xa55a, true);
  view.setFloat32(17, 42.5, true);

  let received = false;
  client.onState = () => { received = true; };
  client.readBinaryMessage(buffer);

  assert.equal(received, true);
  assert.equal(client.state.tick, 0x11223344);
  assert.equal(client.state.orangeScore, 12);
  assert.equal(client.state.blueScore, 9);
  assert.equal(client.state.boostPadMask, 0xa55a);
  assert.deepEqual(client.state.connected, [1, 0, 1, 0]);
  assert.equal(client.state.cars[0].g, 1);
  assert.equal(client.state.cars[0].b, 73);
  assert.equal(client.state.cars[1].b, 44);
  assert.equal(client.state.cars[0].p[0], 42.5);
});

test('legacy state packets remain readable during a rolling deploy', () => {
  const client = new LanClient('Legacy Pilot');
  const buffer = new ArrayBuffer(LEGACY_STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, 2);
  view.setUint32(1, 9, true);
  view.setFloat32(11, -7.25, true);

  client.readBinaryMessage(buffer);
  assert.equal(client.state.tick, 9);
  assert.equal(client.state.cars[0].b, 100);
  assert.equal(client.state.boostPadMask, 0xffff);
  assert.equal(client.state.cars[0].p[0], -7.25);
});


test('client remembers the selected cosmetic car style', () => {
  const selected = new LanClient('Style Pilot', 'apex');
  assert.equal(selected.carStyle, 'apex');
  const invalid = new LanClient('Fallback Pilot', 'octane');
  assert.equal(invalid.carStyle, 'vortex');
});

test('kickoff control messages persist and notify the game layer', () => {
  const client = new LanClient('Kickoff Pilot');
  const received = [];
  client.onKickoff = (kickoff) => received.push(kickoff);

  client.applyKickoffMessage({ type: 'kickoff', phase: 'countdown', count: 3 });
  client.applyKickoffMessage({ type: 'kickoff', phase: 'countdown', count: 2 });
  client.applyKickoffMessage({ type: 'kickoff', phase: 'go', count: 0 });

  assert.deepEqual(received, [
    { phase: 'countdown', count: 3, resetScore: false },
    { phase: 'countdown', count: 2, resetScore: false },
    { phase: 'go', count: 0, resetScore: false }
  ]);
  assert.deepEqual(client.kickoff, { phase: 'go', count: 0, resetScore: false });
});

test('kickoff countdown values are clamped to the three-second format', () => {
  const client = new LanClient('Clamp Pilot');
  client.applyKickoffMessage({ type: 'kickoff', phase: 'countdown', count: 99 });
  assert.deepEqual(client.kickoff, { phase: 'countdown', count: 3, resetScore: false });
  client.applyKickoffMessage({ type: 'kickoff', phase: 'countdown', count: -4 });
  assert.deepEqual(client.kickoff, { phase: 'countdown', count: 1, resetScore: false });
});


test('kickoff control message carries whether the score must reset', () => {
  const client = new LanClient('Score Pilot');
  client.applyKickoffMessage({ type: 'kickoff', phase: 'countdown', count: 3, resetScore: true });
  assert.deepEqual(client.kickoff, { phase: 'countdown', count: 3, resetScore: true });
});

test('goal messages carry explosion side, scorer and score metadata', () => {
  const client = new LanClient('Goal Pilot');
  let received = null;
  client.onGoal = (goal) => { received = goal; };
  client.applyGoalMessage({
    type: 'goal', goalSign: 1, scoringTeam: 'blue', scorerId: 3, scorerName: 'Shooter',
    position: [2.5, 4.2, 82.1], durationMs: 1250, orangeScore: 4, blueScore: 5
  });

  assert.deepEqual(received, {
    goalSign: 1,
    scoringTeam: 'blue',
    scorerId: 3,
    scorerName: 'Shooter',
    position: [2.5, 4.2, 82.1],
    durationMs: 1250,
    orangeScore: 4,
    blueScore: 5
  });
});

test('replay messages keep scorer metadata and unanimous skip progress', () => {
  const client = new LanClient('Replay Pilot');
  const received = [];
  client.onReplay = (replay) => received.push({ ...replay });
  client.applyReplayMessage({
    type: 'replay', phase: 'start', scorerId: 1, scorerName: 'GoalGuy', goalTick: 420,
    lookbackSeconds: 5, durationMs: 5500, skipped: 0, required: 2, orangeScore: 1, blueScore: 2
  });
  client.applyReplayMessage({ type: 'replay', phase: 'progress', skipped: 1, required: 2 });
  client.applyReplayMessage({ type: 'replay', phase: 'end', reason: 'all-skipped' });

  assert.equal(received[0].scorerId, 1);
  assert.equal(received[0].goalTick, 420);
  assert.equal(received[1].skipped, 1);
  assert.equal(received[1].required, 2);
  assert.equal(received[2].phase, 'end');
  assert.equal(received[2].reason, 'all-skipped');
});
