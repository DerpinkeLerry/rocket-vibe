import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  addEventListener() {}
};

const { Input } = await import('./Input.js');

test('virtual touch buttons serialize through the existing multiplayer mask', () => {
  const input = new Input();
  input.setVirtualKey('ShiftLeft', true, 'boost');
  input.setVirtualKey('Space', true, 'jump');

  const packet = input.takeNetworkPacket();
  assert.equal(packet.mask & (1 << 6), 1 << 6);
  assert.equal(packet.mask & (1 << 7), 1 << 7);
  assert.equal(packet.edges & 1, 1);
});

test('analog mobile drive serializes exact axes plus compatibility direction bits', () => {
  const input = new Input();
  input.setAnalogDrive(0.42, 0.27, true, 'stick');
  const packet = input.takeNetworkPacket();

  assert.equal(packet.flags & (1 << 1), 1 << 1);
  assert.ok(Math.abs(packet.throttle - 0.42) < 1e-9);
  assert.ok(Math.abs(packet.steer - 0.27) < 1e-9);
  assert.equal(packet.mask & (1 << 0), 1 << 0); // forward fallback
  assert.equal(packet.mask & (1 << 2), 1 << 2); // left fallback
  assert.deepEqual(input.getDriveAxes(), { throttle: 0.42, steer: 0.27, analog: true });
});

test('analog release returns to desktop keyboard controls without leaving a stuck axis', () => {
  const input = new Input();
  input.setAnalogDrive(0.8, -0.4, true, 'stick');
  input.clearAnalogDrive('stick');
  assert.deepEqual(input.getDriveAxes(), { throttle: 0, steer: 0, analog: false });
  const packet = input.takeNetworkPacket();
  assert.equal(packet.flags & (1 << 1), 0);
  assert.equal(packet.throttle, 0);
  assert.equal(packet.steer, 0);
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

test('drift is serialized as an independent held input flag beside analog mode', () => {
  const input = new Input();
  input.setAnalogDrive(0.5, 0.2, true, 'stick');
  input.setVirtualKey('ControlLeft', true, 'drift');
  const held = input.takeNetworkPacket();
  assert.equal(held.flags & 1, 1);
  assert.equal(held.flags & 2, 2);

  input.setVirtualKey('ControlLeft', false, 'drift');
  const released = input.takeNetworkPacket();
  assert.equal(released.flags & 1, 0);
  assert.equal(released.flags & 2, 2);
});
