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

export class VirtualInput {
  constructor() {
    this.mask = 0;
    this.pressed = new Set();
  }

  applyPacket(packet) {
    this.mask = Number(packet?.mask) || 0;
    const edges = Number(packet?.edges) || 0;
    for (let i = 0; i < EDGE_CODES.length; i++) {
      if (edges & (1 << i)) this.pressed.add(EDGE_CODES[i]);
    }
  }

  isDown(...codes) {
    return codes.some((code) => {
      const bit = CODE_BITS.get(code);
      return bit ? Boolean(this.mask & bit) : false;
    });
  }

  consumePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  clear() {
    this.mask = 0;
    this.pressed.clear();
  }
}
