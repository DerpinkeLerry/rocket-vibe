const NETWORK_DOWN_BITS = [
  ['KeyW', 1 << 0],
  ['KeyS', 1 << 1],
  ['KeyA', 1 << 2],
  ['KeyD', 1 << 3],
  ['KeyQ', 1 << 4],
  ['KeyE', 1 << 5],
  ['ShiftLeft', 1 << 6]
];

const NETWORK_EDGE_CODES = ['Space', 'KeyR', 'KeyB'];

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.networkPressed = new Set();
    this.networkChangeHandler = null;

    window.addEventListener('keydown', (event) => {
      if ([
        'Space',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
      ].includes(event.code)) {
        event.preventDefault();
      }

      if (!event.repeat) {
        this.pressed.add(event.code);
        this.networkPressed.add(event.code);
      }
      this.down.add(event.code);

      // Multiplayer input should not depend on requestAnimationFrame. Send an
      // update immediately when a key changes so player 2 remains responsive.
      this.networkChangeHandler?.();
    }, { passive: false });

    window.addEventListener('keyup', (event) => {
      this.down.delete(event.code);
      this.networkChangeHandler?.();
    });

    window.addEventListener('blur', () => {
      this.down.clear();
      this.pressed.clear();
      this.networkPressed.clear();
      // Explicitly send a zeroed packet so a remote key can never get stuck.
      this.networkChangeHandler?.();
    });
  }

  setNetworkChangeHandler(handler) {
    this.networkChangeHandler = typeof handler === 'function' ? handler : null;
  }

  isDown(...codes) {
    return codes.some((code) => this.down.has(code));
  }

  consumePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  takeNetworkPacket() {
    let mask = 0;
    for (const [code, bit] of NETWORK_DOWN_BITS) {
      if (this.down.has(code)) mask |= bit;
    }
    if (this.down.has('ArrowUp')) mask |= 1 << 0;
    if (this.down.has('ArrowDown')) mask |= 1 << 1;
    if (this.down.has('ArrowLeft')) mask |= 1 << 2;
    if (this.down.has('ArrowRight')) mask |= 1 << 3;
    if (this.down.has('ShiftRight')) mask |= 1 << 6;

    let edges = 0;
    for (let i = 0; i < NETWORK_EDGE_CODES.length; i++) {
      if (this.networkPressed.has(NETWORK_EDGE_CODES[i])) edges |= 1 << i;
    }
    this.networkPressed.clear();

    return { mask, edges };
  }
}
