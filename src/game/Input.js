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
const NETWORK_FLAG_CODES = [
  [['ControlLeft', 'ControlRight'], 1 << 0]
];
const INPUT_FLAG_ANALOG = 1 << 1;

const clampAxis = (value) => Math.max(-1, Math.min(1, Number(value) || 0));

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tagName = String(target.tagName || '').toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target.isContentEditable);
}

export class Input {
  constructor() {
    this.down = new Set();
    this.virtualDown = new Map();
    this.pressed = new Set();
    this.networkPressed = new Set();
    this.networkChangeHandler = null;
    this.analogDrive = { active: false, throttle: 0, steer: 0, source: null };
    this.lastAnalogNotify = { throttle: 0, steer: 0, active: false };
    this.textInputActive = false;

    window.addEventListener('keydown', (event) => {
      if (this.textInputActive || isEditableTarget(event.target)) return;
      if ([
        'Space', 'ControlLeft', 'ControlRight',
        'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
        'ShiftLeft', 'ShiftRight',
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
      if (this.textInputActive || isEditableTarget(event.target)) return;
      const wasDown = this.isCodeDown(event.code);
      this.down.delete(event.code);
      if (wasDown && !this.isCodeDown(event.code)) this.networkChangeHandler?.();
    });

    window.addEventListener('blur', () => {
      this.down.clear();
      this.virtualDown.clear();
      this.pressed.clear();
      this.networkPressed.clear();
      this.analogDrive = { active: false, throttle: 0, steer: 0, source: null };
      this.lastAnalogNotify = { throttle: 0, steer: 0, active: false };
      // Explicitly send a zeroed packet so a remote key can never get stuck.
      this.networkChangeHandler?.();
    });
  }

  setNetworkChangeHandler(handler) {
    this.networkChangeHandler = typeof handler === 'function' ? handler : null;
  }

  setTextInputActive(active) {
    const next = Boolean(active);
    if (next === this.textInputActive) return;
    this.textInputActive = next;
    if (!next) return;
    this.down.clear();
    this.virtualDown.clear();
    this.pressed.clear();
    this.networkPressed.clear();
    this.analogDrive = { active: false, throttle: 0, steer: 0, source: null };
    this.lastAnalogNotify = { throttle: 0, steer: 0, active: false };
    this.networkChangeHandler?.();
  }

  isCodeDown(code) {
    return this.down.has(code) || Boolean(this.virtualDown.get(code)?.size);
  }

  // Touch/gamepad-like button sources reuse the exact same keyboard codes.
  // Multiple sources may hold one code simultaneously without releasing each
  // other. Movement itself uses setAnalogDrive() on mobile.
  setVirtualKey(code, active, source = 'virtual') {
    if (this.textInputActive && active) return;
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

  // Physics convention: throttle +1 = forward / -1 = reverse,
  // steer +1 = left / -1 = right. Keeping this convention matches the old
  // A-minus-D calculation and lets server, Rapier and prediction share values.
  setAnalogDrive(throttle, steer, active = true, source = 'analog') {
    const next = {
      active: Boolean(active),
      throttle: Boolean(active) ? clampAxis(throttle) : 0,
      steer: Boolean(active) ? clampAxis(steer) : 0,
      source: Boolean(active) ? source : null
    };
    const previous = this.analogDrive;
    this.analogDrive = next;

    // Analog is normally sent by the 30 Hz input heartbeat. Notify immediately
    // on activation/release or a meaningful direction change so the first touch
    // never waits for the next heartbeat, without flooding WebSocket at 60 fps.
    const notifyDelta = Math.max(
      Math.abs(next.throttle - this.lastAnalogNotify.throttle),
      Math.abs(next.steer - this.lastAnalogNotify.steer)
    );
    if (next.active !== this.lastAnalogNotify.active || notifyDelta >= 0.12) {
      this.lastAnalogNotify = { throttle: next.throttle, steer: next.steer, active: next.active };
      this.networkChangeHandler?.();
    } else if (previous.active && !next.active) {
      this.networkChangeHandler?.();
    }
  }

  clearAnalogDrive(source = null) {
    if (!this.analogDrive.active) return;
    if (source && this.analogDrive.source !== source) return;
    this.setAnalogDrive(0, 0, false, null);
  }

  hasAnalogDrive() {
    return Boolean(this.analogDrive.active);
  }

  getDriveAxes() {
    if (this.analogDrive.active) {
      return {
        throttle: this.analogDrive.throttle,
        steer: this.analogDrive.steer,
        analog: true
      };
    }
    return {
      throttle: (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0),
      steer: (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (this.isDown('KeyD', 'ArrowRight') ? 1 : 0),
      analog: false
    };
  }

  clearVirtualKeys() {
    const hadVirtual = this.virtualDown.size > 0;
    this.virtualDown.clear();
    this.clearAnalogDrive();
    if (hadVirtual) this.networkChangeHandler?.();
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
    if (this.textInputActive) {
      this.networkPressed.clear();
      return { mask: 0, edges: 0, flags: 0, throttle: 0, steer: 0 };
    }
    let mask = 0;
    for (const [code, bit] of NETWORK_DOWN_BITS) {
      if (this.isCodeDown(code)) mask |= bit;
    }
    if (this.isCodeDown('ArrowUp')) mask |= 1 << 0;
    if (this.isCodeDown('ArrowDown')) mask |= 1 << 1;
    if (this.isCodeDown('ArrowLeft')) mask |= 1 << 2;
    if (this.isCodeDown('ArrowRight')) mask |= 1 << 3;
    if (this.isCodeDown('ShiftRight')) mask |= 1 << 6;

    const axes = this.getDriveAxes();
    if (axes.analog) {
      // Preserve directional bits as a compatibility fallback for older servers
      // while the new server uses the exact analog values below.
      if (axes.throttle > 0.025) mask |= 1 << 0;
      if (axes.throttle < -0.025) mask |= 1 << 1;
      if (axes.steer > 0.025) mask |= 1 << 2;
      if (axes.steer < -0.025) mask |= 1 << 3;
    }

    let edges = 0;
    for (let i = 0; i < NETWORK_EDGE_CODES.length; i++) {
      if (this.networkPressed.has(NETWORK_EDGE_CODES[i])) edges |= 1 << i;
    }
    this.networkPressed.clear();

    let flags = 0;
    for (const [codes, bit] of NETWORK_FLAG_CODES) {
      if (codes.some((code) => this.isCodeDown(code))) flags |= bit;
    }
    if (axes.analog) flags |= INPUT_FLAG_ANALOG;

    return {
      mask,
      edges,
      flags,
      throttle: axes.analog ? axes.throttle : 0,
      steer: axes.analog ? axes.steer : 0
    };
  }
}
