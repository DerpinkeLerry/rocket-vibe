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
