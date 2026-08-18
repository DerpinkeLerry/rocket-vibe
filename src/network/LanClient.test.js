import test from 'node:test';
import assert from 'node:assert/strict';
import { LanClient } from './LanClient.js';
import { ALL_BOOST_PADS_MASK } from '../shared/boost-tuning.js';

const STATE_BYTES = 496;
const FOUR_PLAYER_STATE_BYTES = 283;
const PREVIOUS_STATE_BYTES = 277;
const LEGACY_STATE_BYTES = 271;

test('binary state reads eight cars, full masks, scores and the 34-pad mask from protocol v5 layout', () => {
  const client = new LanClient('Test Pilot');
  const buffer = new ArrayBuffer(STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, 2);
  view.setUint32(1, 0x11223344, true);
  view.setUint8(5, 0b10000101);
  view.setUint8(6, 0b10000001);
  view.setUint8(7, 0b10000100);
  view.setUint16(8, 12, true);
  view.setUint16(10, 9, true);
  view.setUint8(12, 73);
  view.setUint8(13, 44);
  view.setUint8(18, 21);
  view.setUint8(19, 66);
  view.setUint32(20, 0x0000a55a, true);
  view.setUint32(24, 0x00000002, true); // bit 33
  view.setFloat32(28, 42.5, true);
  view.setFloat32(28 + 7 * 52, -12.5, true);

  let received = false;
  client.onState = () => { received = true; };
  client.readBinaryMessage(buffer);

  assert.equal(received, true);
  assert.equal(client.state.tick, 0x11223344);
  assert.equal(client.state.orangeScore, 12);
  assert.equal(client.state.blueScore, 9);
  assert.equal(client.state.boostPadMask, 2 ** 33 + 0xa55a);
  assert.equal(client.state.connected.length, 8);
  assert.equal(client.state.cars.length, 8);
  assert.deepEqual(client.state.connected, [1, 0, 1, 0, 0, 0, 0, 1]);
  assert.equal(client.state.cars[0].g, 1);
  assert.equal(client.state.cars[7].g, 1);
  assert.equal(client.state.cars[2].d, 1);
  assert.equal(client.state.cars[7].d, 1);
  assert.equal(client.state.cars[0].b, 73);
  assert.equal(client.state.cars[7].b, 66);
  assert.equal(client.state.cars[0].p[0], 42.5);
  assert.equal(client.state.cars[7].p[0], -12.5);
});

test('previous four-player 34-pad packets remain readable during a rolling deploy', () => {
  const client = new LanClient('Four Player Pilot');
  const buffer = new ArrayBuffer(FOUR_PLAYER_STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, 2);
  view.setUint32(1, 23, true);
  view.setUint8(5, 0b0101);
  view.setUint8(6, 0b01010001);
  view.setUint16(7, 3, true);
  view.setUint16(9, 4, true);
  view.setUint8(11, 73);
  view.setUint8(12, 44);
  view.setUint32(15, 0x0000a55a, true);
  view.setUint32(19, 0x00000002, true);
  view.setFloat32(23, 7.75, true);

  client.readBinaryMessage(buffer);
  assert.equal(client.state.tick, 23);
  assert.deepEqual(client.state.connected, [1, 0, 1, 0, 0, 0, 0, 0]);
  assert.equal(client.state.cars[0].d, 1);
  assert.equal(client.state.cars[2].d, 1);
  assert.equal(client.state.cars[0].b, 73);
  assert.equal(client.state.cars[1].b, 44);
  assert.equal(client.state.boostPadMask, 2 ** 33 + 0xa55a);
  assert.equal(client.state.cars[0].p[0], 7.75);
});

test('previous 16-pad state packets remain readable during a rolling deploy', () => {
  const client = new LanClient('Previous Pilot');
  const buffer = new ArrayBuffer(PREVIOUS_STATE_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, 2);
  view.setUint32(1, 17, true);
  view.setUint8(11, 88);
  view.setUint16(15, 0xa55a, true);
  view.setFloat32(17, 3.25, true);

  client.readBinaryMessage(buffer);
  assert.equal(client.state.tick, 17);
  assert.equal(client.state.cars[0].b, 88);
  assert.equal(client.state.boostPadMask, 0xa55a);
  assert.equal(client.state.cars[0].p[0], 3.25);
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
  assert.equal(client.state.boostPadMask, ALL_BOOST_PADS_MASK);
  assert.equal(client.state.cars[0].p[0], -7.25);
});


test('client remembers selected car and boost cosmetics', () => {
  const selected = new LanClient('Style Pilot', 'apex', 'plasma');
  assert.equal(selected.carStyle, 'apex');
  assert.equal(selected.boostStyle, 'plasma');
  const invalid = new LanClient('Fallback Pilot', 'octane', 'rainbow');
  assert.equal(invalid.carStyle, 'vortex');
  assert.equal(invalid.boostStyle, 'solar');
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

test('kickoff countdown values are clamped to the configurable ten-second maximum', () => {
  const client = new LanClient('Clamp Pilot');
  client.applyKickoffMessage({ type: 'kickoff', phase: 'countdown', count: 99 });
  assert.deepEqual(client.kickoff, { phase: 'countdown', count: 10, resetScore: false });
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
    lookbackSeconds: 6.25, durationMs: 6800, skipped: 0, required: 2, orangeScore: 1, blueScore: 2
  });
  client.applyReplayMessage({ type: 'replay', phase: 'progress', skipped: 1, required: 2 });
  client.applyReplayMessage({ type: 'replay', phase: 'end', reason: 'all-skipped' });

  assert.equal(received[0].scorerId, 1);
  assert.equal(received[0].goalTick, 420);
  assert.equal(received[0].lookbackSeconds, 6.25);
  assert.equal(received[0].durationMs, 6800);
  assert.equal(received[1].skipped, 1);
  assert.equal(received[1].required, 2);
  assert.equal(received[2].phase, 'end');
  assert.equal(received[2].reason, 'all-skipped');
});

test('quick chat messages use the authoritative catalog instead of trusting message text', () => {
  const client = new LanClient('Quick Pilot');
  let received = null;
  client.onQuickChat = (chat) => { received = chat; };

  const chat = client.applyQuickChatMessage({
    type: 'quick-chat', id: 'nice-shot', text: '<unsafe>',
    playerId: 2, playerName: 'Saver', team: 'blue'
  });

  assert.deepEqual(chat, {
    kind: 'quick', id: 'nice-shot', text: 'Nice shot!', playerId: 2, playerName: 'Saver', team: 'blue'
  });
  assert.deepEqual(received, chat);
});

test('quick chat limit starts a two second client cooldown after the third message', () => {
  const client = new LanClient('Cooldown Pilot');
  let received = null;
  client.onQuickChatLimit = (limit) => { received = limit; };
  const before = performance.now();

  const limit = client.applyQuickChatLimitMessage({
    type: 'quick-chat-limit', allowed: true, remaining: 0, cooldownMs: 2000
  });

  assert.equal(limit.remaining, 0);
  assert.equal(limit.cooldownMs, 2000);
  assert.equal(received.cooldownMs, 2000);
  assert.ok(client.quickChatCooldownUntil >= before + 1900);
  assert.ok(client.quickChatCooldownRemaining() > 0);
});

test('client packs analog throttle and steering into the extended 10-byte input packet', () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = { OPEN: 1 };
  try {
    const client = new LanClient('Analog Pilot');
    let sent = null;
    client.connected = true;
    client.socket = { readyState: 1, send(value) { sent = value; } };

    assert.equal(client.sendInput({ mask: 0b0101, edges: 1, flags: 0b11, throttle: 0.5, steer: -0.25 }), true);
    assert.ok(sent instanceof ArrayBuffer);
    assert.equal(sent.byteLength, 10);
    const view = new DataView(sent);
    assert.equal(view.getUint8(0), 1);
    assert.equal(view.getUint8(5), 0b0101);
    assert.equal(view.getUint8(6), 1);
    assert.equal(view.getUint8(7), 0b11);
    assert.equal(view.getInt8(8), 64);
    assert.equal(view.getInt8(9), -32);
  } finally {
    if (previousWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = previousWebSocket;
  }
});


test('client sends any catalog quick chat and sanitizes normal text chat', () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = { OPEN: 1 };
  try {
    const client = new LanClient('Chat Pilot');
    const sent = [];
    client.connected = true;
    client.socket = { readyState: 1, send(value) { sent.push(value); } };

    assert.equal(client.sendQuickChat('great-pass'), true);
    assert.deepEqual(JSON.parse(sent[0]), { type: 'quick-chat', id: 'great-pass' });
    assert.equal(client.sendTextChat('  Hallo\n   zusammen!  '), true);
    assert.deepEqual(JSON.parse(sent[1]), { type: 'chat', text: 'Hallo zusammen!' });
  } finally {
    if (previousWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = previousWebSocket;
  }
});

test('normal chat messages preserve safe server text and expose text-chat cooldown', () => {
  const client = new LanClient('Text Pilot');
  let received = null;
  client.onChat = (chat) => { received = chat; };
  const chat = client.applyTextChatMessage({ type: 'chat', text: 'GG zusammen', playerId: 4, playerName: 'Writer', team: 'orange' });
  assert.deepEqual(chat, { kind: 'text', text: 'GG zusammen', playerId: 4, playerName: 'Writer', team: 'orange' });
  assert.deepEqual(received, chat);

  const before = performance.now();
  const limit = client.applyTextChatLimitMessage({ type: 'chat-limit', allowed: false, cooldownMs: 4000 });
  assert.equal(limit.allowed, false);
  assert.ok(client.chatCooldownUntil >= before + 3900);
  assert.ok(client.textChatCooldownRemaining() > 0);
});

test('demolition and respawn control messages carry the spawn-selection data', () => {
  const client = new LanClient('Demo Pilot');
  let demolitionReceived = null;
  let respawnReceived = null;
  client.onDemolition = (message) => { demolitionReceived = message; };
  client.onRespawn = (message) => { respawnReceived = message; };

  const demolition = client.applyDemolitionMessage({
    type: 'demolition', attackerId: 0, victimId: 1,
    attackerName: 'Orange', victimName: 'Blue',
    position: [1, 2, 3], durationMs: 4000, stateTick: 912, selectedIndex: 1,
    spawnPoints: [
      { x: -23.04, y: 0.25515, z: -46.08, yaw: Math.PI },
      { x: -26.88, y: 0.25515, z: -46.08, yaw: Math.PI },
      { x: 23.04, y: 0.25515, z: -46.08, yaw: Math.PI },
      { x: 26.88, y: 0.25515, z: -46.08, yaw: Math.PI }
    ]
  });
  assert.equal(demolition.durationMs, 4000);
  assert.equal(demolition.stateTick, 912);
  assert.equal(client.demolition, demolition);
  assert.equal(demolition.spawnPoints.length, 4);
  assert.equal(demolition.spawnPoints[0].z, -46.08);
  assert.deepEqual(demolitionReceived, demolition);

  const respawn = client.applyRespawnMessage({
    type: 'respawn', playerId: 1, spawnIndex: 2,
    position: [23.04, 0.25515, -46.08], yaw: Math.PI, boost: 33
  });
  assert.equal(respawn.spawnIndex, 2);
  assert.equal(respawn.boost, 33);
  assert.equal(client.demolition, null);
  assert.deepEqual(respawnReceived, respawn);
});

test('client sends a clamped demolition respawn selection', () => {
  const previousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = { OPEN: 1 };
  try {
    const client = new LanClient('Spawn Pilot');
    const sent = [];
    client.connected = true;
    client.socket = { readyState: 1, send(value) { sent.push(value); } };

    assert.equal(client.sendRespawnSelection(9), true);
    assert.deepEqual(JSON.parse(sent[0]), { type: 'respawn-select', index: 3 });
  } finally {
    if (previousWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = previousWebSocket;
  }
});
