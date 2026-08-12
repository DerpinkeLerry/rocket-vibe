const NETWORK_DOWN_BITS = [
  ['KeyW', 1 << 0],
  ['KeyS', 1 << 1],
  ['KeyA', 1 << 2],
  ['KeyD', 1 << 3],
  ['KeyQ', 1 << 4],
  ['KeyE', 1 << 5],
  ['ShiftLeft', 1 << 6],
  ['Space', 1 << 7]
];

const NETWORK_EDGE_CODES = ['Space', 'KeyR', 'KeyB'];

export class Input {
  constructor() {
    this.down = new Set();
    this.virtualDown = new Map();
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

      const wasDown = this.isCodeDown(event.code);
      this.down.add(event.code);
      if (!event.repeat && !wasDown) {
        this.pressed.add(event.code);
        this.networkPressed.add(event.code);
      }

      // Multiplayer input should not depend on requestAnimationFrame. Send an
      // update immediately when a key changes so player 2 remains responsive.
      if (!wasDown) this.networkChangeHandler?.();
    }, { passive: false });

    window.addEventListener('keyup', (event) => {
      const wasDown = this.isCodeDown(event.code);
      this.down.delete(event.code);
      if (wasDown && !this.isCodeDown(event.code)) this.networkChangeHandler?.();
    });

    window.addEventListener('blur', () => {
      this.down.clear();
      this.virtualDown.clear();
      this.pressed.clear();
      this.networkPressed.clear();
      // Explicitly send a zeroed packet so a remote key can never get stuck.
      this.networkChangeHandler?.();
    });
  }

  setNetworkChangeHandler(handler) {
    this.networkChangeHandler = typeof handler === 'function' ? handler : null;
  }

  isCodeDown(code) {
    return this.down.has(code) || Boolean(this.virtualDown.get(code)?.size);
  }

  // Touch/gamepad-like sources reuse the exact same keyboard codes. Multiple
  // sources may hold one code simultaneously without releasing each other.
  setVirtualKey(code, active, source = 'virtual') {
    const wasDown = this.isCodeDown(code);
    let sources = this.virtualDown.get(code);

    if (active) {
      if (!sources) {
        sources = new Set();
        this.virtualDown.set(code, sources);
      }
      sources.add(source);
    } else if (sources) {
      sources.delete(source);
      if (sources.size === 0) this.virtualDown.delete(code);
    }

    const isDown = this.isCodeDown(code);
    if (!wasDown && isDown) {
      this.pressed.add(code);
      this.networkPressed.add(code);
    }
    if (wasDown !== isDown) this.networkChangeHandler?.();
  }

  clearVirtualKeys() {
    if (this.virtualDown.size === 0) return;
    this.virtualDown.clear();
    this.networkChangeHandler?.();
  }

  isDown(...codes) {
    return codes.some((code) => this.isCodeDown(code));
  }

  consumePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  takeNetworkPacket() {
    let mask = 0;
    for (const [code, bit] of NETWORK_DOWN_BITS) {
      if (this.isCodeDown(code)) mask |= bit;
    }
    if (this.isCodeDown('ArrowUp')) mask |= 1 << 0;
    if (this.isCodeDown('ArrowDown')) mask |= 1 << 1;
    if (this.isCodeDown('ArrowLeft')) mask |= 1 << 2;
    if (this.isCodeDown('ArrowRight')) mask |= 1 << 3;
    if (this.isCodeDown('ShiftRight')) mask |= 1 << 6;

    let edges = 0;
    for (let i = 0; i < NETWORK_EDGE_CODES.length; i++) {
      if (this.networkPressed.has(NETWORK_EDGE_CODES[i])) edges |= 1 << i;
    }
    this.networkPressed.clear();

    return { mask, edges };
  }
}
