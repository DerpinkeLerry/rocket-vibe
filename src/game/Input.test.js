import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  addEventListener() {}
};

const { Input } = await import('./Input.js');

test('virtual touch keys serialize through the existing multiplayer input packet', () => {
  const input = new Input();
  input.setVirtualKey('KeyW', true, 'stick');
  input.setVirtualKey('KeyA', true, 'stick');
  input.setVirtualKey('ShiftLeft', true, 'boost');
  input.setVirtualKey('Space', true, 'jump');

  const packet = input.takeNetworkPacket();
  assert.equal(packet.mask & (1 << 0), 1 << 0);
  assert.equal(packet.mask & (1 << 2), 1 << 2);
  assert.equal(packet.mask & (1 << 6), 1 << 6);
  assert.equal(packet.mask & (1 << 7), 1 << 7);
  assert.equal(packet.edges & 1, 1);
});

test('one touch source cannot release a key still held by another source', () => {
  const input = new Input();
  input.setVirtualKey('Space', true, 'jump-a');
  input.setVirtualKey('Space', true, 'jump-b');
  input.setVirtualKey('Space', false, 'jump-a');
  assert.equal(input.isDown('Space'), true);
  input.setVirtualKey('Space', false, 'jump-b');
  assert.equal(input.isDown('Space'), false);
});


test('drift is serialized as an independent held input flag', () => {
  const input = new Input();
  input.setVirtualKey('ControlLeft', true, 'drift');
  const held = input.takeNetworkPacket();
  assert.equal(held.flags & 1, 1);
  assert.equal(held.mask, 0);

  input.setVirtualKey('ControlLeft', false, 'drift');
  const released = input.takeNetworkPacket();
  assert.equal(released.flags & 1, 0);
});
