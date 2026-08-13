import { INPUT_FLAGS } from '../shared/game-tuning.js';

const CODE_BITS = new Map([
  ['KeyW', 1 << 0], ['ArrowUp', 1 << 0],
  ['KeyS', 1 << 1], ['ArrowDown', 1 << 1],
  ['KeyA', 1 << 2], ['ArrowLeft', 1 << 2],
  ['KeyD', 1 << 3], ['ArrowRight', 1 << 3],
  ['KeyQ', 1 << 4],
  ['KeyE', 1 << 5],
  ['ShiftLeft', 1 << 6], ['ShiftRight', 1 << 6]
]);

const EDGE_CODES = ['Space', 'KeyR', 'KeyB'];
const FLAG_BITS = new Map([
  ['ControlLeft', 1 << 0], ['ControlRight', 1 << 0]
]);

export class VirtualInput {
  constructor() {
    this.mask = 0;
    this.flags = 0;
    this.throttle = 0;
    this.steer = 0;
    this.pressed = new Set();
  }

  applyPacket(packet) {
    this.mask = Number(packet?.mask) || 0;
    this.flags = Number(packet?.flags) || 0;
    this.throttle = Math.max(-1, Math.min(1, Number(packet?.throttle) || 0));
    this.steer = Math.max(-1, Math.min(1, Number(packet?.steer) || 0));
    const edges = Number(packet?.edges) || 0;
    for (let i = 0; i < EDGE_CODES.length; i++) {
      if (edges & (1 << i)) this.pressed.add(EDGE_CODES[i]);
    }
  }

  isDown(...codes) {
    return codes.some((code) => {
      const bit = CODE_BITS.get(code);
      if (bit) return Boolean(this.mask & bit);
      const flag = FLAG_BITS.get(code);
      return flag ? Boolean(this.flags & flag) : false;
    });
  }

  getDriveAxes() {
    if (this.flags & INPUT_FLAGS.ANALOG) {
      return { throttle: this.throttle, steer: this.steer, analog: true };
    }
    return {
      throttle: (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0),
      steer: (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (this.isDown('KeyD', 'ArrowRight') ? 1 : 0),
      analog: false
    };
  }

  consumePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  clear() {
    this.mask = 0;
    this.flags = 0;
    this.throttle = 0;
    this.steer = 0;
    this.pressed.clear();
  }
}
