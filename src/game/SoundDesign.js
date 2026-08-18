const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (a, b, value) => {
  const t = clamp((Number(value) - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const SOUND_EFFECTS = Object.freeze([
  'uiHover', 'uiConfirm', 'uiBack', 'uiSlider', 'chat', 'camera', 'reset',
  'countdown', 'clockTick', 'go', 'overtime', 'matchReady', 'matchEnd', 'replay',
  'gearShift', 'jump', 'flip', 'land', 'carImpact', 'ballHit', 'ballBounce',
  'boostPickupSmall', 'boostPickupFull', 'boostEmpty',
  'goal', 'demolition', 'respawn'
]);

const EFFECT_SET = new Set(SOUND_EFFECTS);
const EFFECT_COOLDOWNS = Object.freeze({
  uiHover: 0.035,
  uiSlider: 0.028,
  ballHit: 0.045,
  ballBounce: 0.075,
  carImpact: 0.11,
  gearShift: 0.32,
  land: 0.12,
  boostEmpty: 0.36,
  chat: 0.12,
  reset: 0.25,
  respawn: 0.25
});

export function calculateEngineMix(options = {}) {
  const speedKmh = Math.max(0, Number(options.speedKmh) || 0);
  const throttle = clamp(Math.abs(Number(options.throttle) || 0), 0, 1);
  const steer = clamp(Math.abs(Number(options.steer) || 0), 0, 1);
  const speed = clamp(speedKmh / 230, 0, 1);
  const active = options.active !== false;
  const grounded = Boolean(options.grounded);
  const boosting = Boolean(options.boosting);
  const drifting = Boolean(options.drifting);
  const engineFrequency = 54 + speed * 128 + throttle * 28;
  const engineGain = active ? 0.024 + throttle * 0.038 + speed * 0.021 : 0;
  const boostGain = active && boosting ? 0.105 : 0;
  const tireLoad = grounded ? smoothstep(14, 105, speedKmh) : 0;
  const skidGain = active && grounded
    ? tireLoad * (drifting ? 0.115 : smoothstep(0.62, 1, steer) * 0.026)
    : 0;
  const windGain = active ? smoothstep(72, 218, speedKmh) * 0.052 : 0;
  return Object.freeze({ engineFrequency, engineGain, boostGain, skidGain, windGain });
}

export function spatializeEffect(position, listenerPosition, listenerRight) {
  if (!position || !listenerPosition) return Object.freeze({ pan: 0, gain: 1, distance: 0 });
  const px = Array.isArray(position) ? position[0] : position.x;
  const py = Array.isArray(position) ? position[1] : position.y;
  const pz = Array.isArray(position) ? position[2] : position.z;
  const dx = (Number(px) || 0) - (Number(listenerPosition.x) || 0);
  const dy = (Number(py) || 0) - (Number(listenerPosition.y) || 0);
  const dz = (Number(pz) || 0) - (Number(listenerPosition.z) || 0);
  const distance = Math.hypot(dx, dy, dz);
  const invDistance = distance > 1e-6 ? 1 / distance : 0;
  const right = listenerRight ?? { x: 1, y: 0, z: 0 };
  const pan = clamp(
    (dx * (Number(right.x) || 0) + dy * (Number(right.y) || 0) + dz * (Number(right.z) || 0)) * invDistance,
    -1,
    1
  );
  const gain = clamp(1 / (1 + (distance / 34) ** 2), 0.08, 1);
  return Object.freeze({ pan, gain, distance });
}

export function classifyGameplayImpact(options = {}) {
  const previous = options.previousBallVelocity ?? {};
  const current = options.ballVelocity ?? {};
  const delta = Math.hypot(
    (Number(current.x) || 0) - (Number(previous.x) || 0),
    (Number(current.y) || 0) - (Number(previous.y) || 0),
    (Number(current.z) || 0) - (Number(previous.z) || 0)
  );
  if (delta < 2.9) return Object.freeze({ type: null, intensity: 0, delta });
  const distanceToCar = Math.max(0, Number(options.distanceToCar) || 0);
  return Object.freeze({
    type: distanceToCar <= 4.25 ? 'ballHit' : 'ballBounce',
    intensity: clamp((delta - 2.2) / 15, 0.18, 1.25),
    delta
  });
}

function copyVector(value) {
  return {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    z: Number(value?.z) || 0
  };
}

function vectorDeltaLength(a, b) {
  return Math.hypot(
    (Number(a?.x) || 0) - (Number(b?.x) || 0),
    (Number(a?.y) || 0) - (Number(b?.y) || 0),
    (Number(a?.z) || 0) - (Number(b?.z) || 0)
  );
}

export class SoundDesign {
  constructor(options = {}) {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.loopNodes = null;
    this.listenerPosition = { x: 0, y: 0, z: 0 };
    this.listenerRight = { x: 1, y: 0, z: 0 };
    this.previousGameplay = null;
    this.cooldowns = new Map();
    this.activeVoices = 0;
    this.uiRoot = null;
    this.uiDestroyers = [];
    this.lastSliderSoundAt = 0;
    this.enabled = true;
    this.configure(options);
  }

  configure(options = {}) {
    this.mobile = Boolean(options.mobile ?? this.mobile);
    this.lowDetail = Boolean(options.lowDetail ?? this.lowDetail);
    this.maxVoices = this.lowDetail ? 12 : (this.mobile ? 18 : 28);
    this.volume = clamp(Number(options.volume ?? this.volume ?? 0.72), 0, 1);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.025);
    }
  }

  ensureContext() {
    if (!this.enabled) return null;
    if (this.context) return this.context;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextClass !== 'function') return null;
    try {
      const context = new AudioContextClass({ latencyHint: this.mobile ? 'interactive' : 'balanced' });
      const master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      master.gain.value = this.volume;
      compressor.threshold.value = -15;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.16;
      master.connect(compressor);
      compressor.connect(context.destination);
      this.context = context;
      this.master = master;
      this.compressor = compressor;
      this.noiseBuffer = this.createNoiseBuffer();
      this.createLoopNodes();
      return context;
    } catch {
      this.enabled = false;
      return null;
    }
  }

  unlock() {
    const context = this.ensureContext();
    if (!context || context.state === 'running') return;
    try {
      const result = context.resume();
      result?.catch?.(() => {});
    } catch {
      // Browsers can reject resume outside a trusted gesture; the next gesture retries.
    }
  }

  installGlobalUISounds(root = globalThis.document) {
    if (!root || this.uiRoot === root) return;
    this.removeGlobalUISounds();
    this.uiRoot = root;

    const onPointerDown = () => this.unlock();
    const onKeyDown = () => this.unlock();
    const onClick = (event) => {
      const target = event.target?.closest?.('button, [role="button"], input[type="radio"], input[type="checkbox"]');
      if (!target || target.disabled) return;
      if (target.closest?.('.mobile-controls') && !target.matches?.('[data-quick-chat]')) return;
      const back = target.matches?.('[data-game-menu-close], [data-camera-back], [data-lobby-back], .lobby-back');
      this.play(back ? 'uiBack' : 'uiConfirm', { volume: 0.72 });
    };
    const onPointerOver = (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const target = event.target?.closest?.('button, [role="button"]');
      if (!target || target.disabled || target.closest?.('.mobile-controls')) return;
      if (target.contains?.(event.relatedTarget)) return;
      this.play('uiHover', { volume: 0.42 });
    };
    const onInput = (event) => {
      if (event.target?.type !== 'range') return;
      const now = globalThis.performance?.now?.() ?? Date.now();
      if (now - this.lastSliderSoundAt < 42) return;
      this.lastSliderSoundAt = now;
      this.play('uiSlider', { volume: 0.42 });
    };

    root.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    root.addEventListener('keydown', onKeyDown, { passive: true, capture: true });
    root.addEventListener('click', onClick, { passive: true });
    root.addEventListener('pointerover', onPointerOver, { passive: true });
    root.addEventListener('input', onInput, { passive: true });
    this.uiDestroyers.push(
      () => root.removeEventListener('pointerdown', onPointerDown, true),
      () => root.removeEventListener('keydown', onKeyDown, true),
      () => root.removeEventListener('click', onClick),
      () => root.removeEventListener('pointerover', onPointerOver),
      () => root.removeEventListener('input', onInput)
    );
  }

  removeGlobalUISounds() {
    for (const destroy of this.uiDestroyers) destroy();
    this.uiDestroyers.length = 0;
    this.uiRoot = null;
  }

  createNoiseBuffer() {
    const context = this.context;
    const length = Math.max(1, Math.floor(context.sampleRate * 2));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x6d2b79f5;
    for (let i = 0; i < data.length; i++) {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      data[i] = (((state ^ (state >>> 14)) >>> 0) / 2147483648 - 1) * 0.88;
    }
    return buffer;
  }

  createNoiseLoop(filterType, frequency) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.75;
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    return { source, filter, gain };
  }

  createLoopNodes() {
    if (!this.context || this.loopNodes) return;
    const context = this.context;
    const engineGain = context.createGain();
    const engineFilter = context.createBiquadFilter();
    const engineA = context.createOscillator();
    const engineB = context.createOscillator();
    const engineMixA = context.createGain();
    const engineMixB = context.createGain();
    engineA.type = 'sawtooth';
    engineB.type = 'triangle';
    engineMixA.gain.value = 0.58;
    engineMixB.gain.value = 0.42;
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 760;
    engineFilter.Q.value = 1.4;
    engineGain.gain.value = 0;
    engineA.connect(engineMixA);
    engineB.connect(engineMixB);
    engineMixA.connect(engineFilter);
    engineMixB.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(this.master);
    engineA.start();
    engineB.start();

    this.loopNodes = {
      engineA,
      engineB,
      engineFilter,
      engineGain,
      boost: this.createNoiseLoop('bandpass', 820),
      skid: this.createNoiseLoop('bandpass', 1550),
      wind: this.createNoiseLoop('highpass', 1250)
    };
  }

  updateListener(camera) {
    if (!camera) return;
    this.listenerPosition = copyVector(camera.position);
    const q = camera.quaternion ?? {};
    const x = Number(q.x) || 0;
    const y = Number(q.y) || 0;
    const z = Number(q.z) || 0;
    const w = Number(q.w) || 1;
    this.listenerRight = {
      x: 1 - 2 * (y * y + z * z),
      y: 2 * (x * y + w * z),
      z: 2 * (x * z - w * y)
    };
  }

  updateLoops(mix) {
    if (!this.context || !this.loopNodes) return;
    const now = this.context.currentTime;
    const set = (param, value, time = 0.035) => param.setTargetAtTime(Math.max(0.00001, value), now, time);
    set(this.loopNodes.engineA.frequency, mix.engineFrequency, 0.045);
    set(this.loopNodes.engineB.frequency, mix.engineFrequency * 2.02, 0.045);
    set(this.loopNodes.engineFilter.frequency, 520 + mix.engineFrequency * 4.2, 0.055);
    set(this.loopNodes.engineGain.gain, mix.engineGain, 0.055);
    set(this.loopNodes.boost.gain.gain, mix.boostGain, 0.022);
    set(this.loopNodes.boost.filter.frequency, 720 + mix.engineFrequency * 2.6, 0.05);
    set(this.loopNodes.skid.gain.gain, mix.skidGain, 0.035);
    set(this.loopNodes.wind.gain.gain, mix.windGain, 0.09);
  }

  setSpatialPan(node, pan) {
    if (typeof this.context.createStereoPanner !== 'function') {
      node.connect(this.master);
      return;
    }
    const panner = this.context.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    node.connect(panner);
    panner.connect(this.master);
  }

  registerVoice(source) {
    this.activeVoices += 1;
    const finish = () => { this.activeVoices = Math.max(0, this.activeVoices - 1); };
    source.addEventListener?.('ended', finish, { once: true });
    if (!source.addEventListener) source.onended = finish;
  }

  tone(options = {}) {
    if (!this.context || this.activeVoices >= this.maxVoices) return;
    const context = this.context;
    const start = context.currentTime + Math.max(0, Number(options.delay) || 0);
    const duration = clamp(Number(options.duration) || 0.12, 0.015, 2.5);
    const attack = clamp(Number(options.attack) || 0.006, 0.001, duration * 0.45);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type || 'sine';
    const startFrequency = Math.max(20, Number(options.frequency) || 440);
    const endFrequency = Math.max(20, Number(options.endFrequency) || startFrequency);
    oscillator.frequency.setValueAtTime(startFrequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    const peak = Math.max(0.0001, Number(options.gain) || 0.05);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    this.setSpatialPan(gain, Number(options.pan) || 0);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
    this.registerVoice(oscillator);
  }

  noise(options = {}) {
    if (!this.context || !this.noiseBuffer || this.activeVoices >= this.maxVoices) return;
    const context = this.context;
    const start = context.currentTime + Math.max(0, Number(options.delay) || 0);
    const duration = clamp(Number(options.duration) || 0.12, 0.02, 1.8);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = options.filterType || 'bandpass';
    filter.frequency.value = Math.max(40, Number(options.frequency) || 900);
    filter.Q.value = Math.max(0.01, Number(options.q) || 0.8);
    const peak = Math.max(0.0001, Number(options.gain) || 0.05);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.012, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    this.setSpatialPan(gain, Number(options.pan) || 0);
    const offset = (Math.abs(Math.sin(start * 31.73)) * 1.5) % Math.max(0.01, this.noiseBuffer.duration - duration);
    source.start(start, offset);
    source.stop(start + duration + 0.015);
    this.registerVoice(source);
  }

  canPlay(name) {
    const now = globalThis.performance?.now?.() ? globalThis.performance.now() / 1000 : Date.now() / 1000;
    const availableAt = this.cooldowns.get(name) || 0;
    if (now < availableAt) return false;
    this.cooldowns.set(name, now + (EFFECT_COOLDOWNS[name] || 0));
    return true;
  }

  play(name, options = {}) {
    if (!EFFECT_SET.has(name) || !this.canPlay(name)) return false;
    const context = this.ensureContext();
    if (!context) return false;
    if (context.state !== 'running') this.unlock();
    const spatial = spatializeEffect(options.position, this.listenerPosition, this.listenerRight);
    const volume = clamp(Number(options.volume ?? 1), 0, 1.5) * spatial.gain;
    const intensity = clamp(Number(options.intensity ?? 1), 0.12, 1.35);
    const gain = volume * intensity;
    const pan = spatial.pan;

    switch (name) {
      case 'uiHover':
        this.tone({ frequency: 560, endFrequency: 610, duration: 0.038, gain: 0.022 * gain, type: 'sine', pan });
        break;
      case 'uiConfirm':
        this.tone({ frequency: 390, endFrequency: 650, duration: 0.09, gain: 0.055 * gain, type: 'triangle', pan });
        break;
      case 'uiBack':
        this.tone({ frequency: 390, endFrequency: 245, duration: 0.085, gain: 0.045 * gain, type: 'triangle', pan });
        break;
      case 'uiSlider':
        this.tone({ frequency: 760, endFrequency: 820, duration: 0.032, gain: 0.022 * gain, type: 'sine', pan });
        break;
      case 'chat':
        this.tone({ frequency: 620, endFrequency: 760, duration: 0.075, gain: 0.042 * gain, type: 'sine', pan });
        this.tone({ frequency: 840, endFrequency: 920, duration: 0.07, gain: 0.03 * gain, type: 'sine', delay: 0.07, pan });
        break;
      case 'camera':
        this.tone({ frequency: 690, endFrequency: 390, duration: 0.11, gain: 0.055 * gain, type: 'triangle', pan });
        break;
      case 'reset':
        this.noise({ duration: 0.28, frequency: 1050, q: 0.55, gain: 0.075 * gain, pan });
        this.tone({ frequency: 520, endFrequency: 90, duration: 0.30, gain: 0.07 * gain, type: 'sine', pan });
        break;
      case 'countdown':
        this.tone({ frequency: 520, endFrequency: 500, duration: 0.14, gain: 0.10 * gain, type: 'sine', pan });
        this.tone({ frequency: 260, endFrequency: 250, duration: 0.14, gain: 0.045 * gain, type: 'triangle', pan });
        break;
      case 'clockTick':
        this.tone({ frequency: 880, endFrequency: 760, duration: 0.085, gain: 0.07 * gain, type: 'square', pan });
        this.tone({ frequency: 220, endFrequency: 190, duration: 0.10, gain: 0.035 * gain, type: 'sine', pan });
        break;
      case 'go':
        this.tone({ frequency: 420, endFrequency: 540, duration: 0.30, gain: 0.10 * gain, type: 'triangle', pan });
        this.tone({ frequency: 630, endFrequency: 810, duration: 0.30, gain: 0.075 * gain, type: 'sine', pan });
        this.tone({ frequency: 840, endFrequency: 1080, duration: 0.28, gain: 0.045 * gain, type: 'sine', pan });
        break;
      case 'overtime':
        this.noise({ duration: 0.42, frequency: 980, q: 0.62, gain: 0.07 * gain, pan });
        this.tone({ frequency: 185, endFrequency: 370, duration: 0.48, gain: 0.11 * gain, type: 'sawtooth', pan });
        this.tone({ frequency: 370, endFrequency: 555, duration: 0.45, gain: 0.075 * gain, type: 'triangle', delay: 0.28, pan });
        break;
      case 'matchReady':
        this.noise({ duration: 0.22, frequency: 1300, gain: 0.035 * gain, pan });
        this.tone({ frequency: 230, endFrequency: 610, duration: 0.34, gain: 0.075 * gain, type: 'triangle', pan });
        break;
      case 'matchEnd':
        this.tone({ frequency: 392, endFrequency: 360, duration: 0.52, gain: 0.075 * gain, type: 'triangle', pan });
        this.tone({ frequency: 494, endFrequency: 454, duration: 0.52, gain: 0.055 * gain, type: 'sine', delay: 0.04, pan });
        this.tone({ frequency: 587, endFrequency: 540, duration: 0.52, gain: 0.05 * gain, type: 'sine', delay: 0.08, pan });
        break;
      case 'replay':
        this.noise({ duration: 0.42, frequency: 980, q: 0.45, gain: 0.07 * gain, pan });
        this.tone({ frequency: 180, endFrequency: 480, duration: 0.36, gain: 0.045 * gain, type: 'triangle', pan });
        break;
      case 'gearShift':
        this.noise({ duration: 0.075, frequency: 620, q: 1.15, gain: 0.04 * gain, pan });
        this.tone({ frequency: 150, endFrequency: 225, duration: 0.11, gain: 0.055 * gain, type: 'sawtooth', pan });
        break;
      case 'jump':
        this.noise({ duration: 0.14, frequency: 820, q: 0.65, gain: 0.075 * gain, pan });
        this.tone({ frequency: 145, endFrequency: 340, duration: 0.17, gain: 0.09 * gain, type: 'triangle', pan });
        break;
      case 'flip':
        this.noise({ duration: 0.24, frequency: 1450, q: 0.52, gain: 0.10 * gain, pan });
        this.tone({ frequency: 290, endFrequency: 86, duration: 0.22, gain: 0.085 * gain, type: 'sawtooth', pan });
        break;
      case 'land':
        this.noise({ duration: 0.16, frequency: 170, filterType: 'lowpass', q: 0.7, gain: 0.13 * gain, pan });
        this.tone({ frequency: 92, endFrequency: 43, duration: 0.18, gain: 0.12 * gain, type: 'sine', pan });
        break;
      case 'carImpact':
        this.noise({ duration: 0.20, frequency: 520, q: 0.55, gain: 0.14 * gain, pan });
        this.tone({ frequency: 125, endFrequency: 48, duration: 0.22, gain: 0.13 * gain, type: 'triangle', pan });
        break;
      case 'ballHit':
        this.tone({ frequency: 210, endFrequency: 76, duration: 0.22, gain: 0.14 * gain, type: 'triangle', pan });
        this.tone({ frequency: 680, endFrequency: 330, duration: 0.15, gain: 0.075 * gain, type: 'sine', pan });
        this.noise({ duration: 0.11, frequency: 1050, q: 1.2, gain: 0.07 * gain, pan });
        break;
      case 'ballBounce':
        this.tone({ frequency: 165, endFrequency: 88, duration: 0.17, gain: 0.10 * gain, type: 'triangle', pan });
        this.noise({ duration: 0.09, frequency: 720, q: 0.75, gain: 0.045 * gain, pan });
        break;
      case 'boostPickupSmall':
        this.tone({ frequency: 760, endFrequency: 980, duration: 0.10, gain: 0.06 * gain, type: 'sine', pan });
        this.tone({ frequency: 1080, endFrequency: 1320, duration: 0.10, gain: 0.038 * gain, type: 'sine', delay: 0.055, pan });
        break;
      case 'boostPickupFull':
        this.noise({ duration: 0.23, frequency: 1650, q: 0.5, gain: 0.055 * gain, pan });
        this.tone({ frequency: 360, endFrequency: 720, duration: 0.28, gain: 0.075 * gain, type: 'triangle', pan });
        this.tone({ frequency: 620, endFrequency: 1240, duration: 0.28, gain: 0.055 * gain, type: 'sine', delay: 0.03, pan });
        break;
      case 'boostEmpty':
        this.tone({ frequency: 120, endFrequency: 72, duration: 0.07, gain: 0.055 * gain, type: 'square', pan });
        this.noise({ duration: 0.045, frequency: 360, q: 1.4, gain: 0.035 * gain, pan });
        break;
      case 'goal':
        this.noise({ duration: 0.85, frequency: 520, filterType: 'lowpass', q: 0.45, gain: 0.22 * gain, pan });
        this.tone({ frequency: 58, endFrequency: 34, duration: 0.72, gain: 0.24 * gain, type: 'sine', pan });
        this.tone({ frequency: 196, endFrequency: 220, duration: 0.85, gain: 0.11 * gain, type: 'sawtooth', delay: 0.08, pan });
        this.tone({ frequency: 294, endFrequency: 330, duration: 0.85, gain: 0.075 * gain, type: 'triangle', delay: 0.08, pan });
        this.tone({ frequency: 392, endFrequency: 440, duration: 0.82, gain: 0.055 * gain, type: 'triangle', delay: 0.11, pan });
        break;
      case 'demolition':
        this.noise({ duration: 0.78, frequency: 430, filterType: 'lowpass', q: 0.55, gain: 0.30 * gain, pan });
        this.noise({ duration: 0.34, frequency: 1350, q: 0.35, gain: 0.13 * gain, pan });
        this.tone({ frequency: 72, endFrequency: 28, duration: 0.72, gain: 0.27 * gain, type: 'sine', pan });
        break;
      case 'respawn':
        this.noise({ duration: 0.30, frequency: 1450, q: 0.45, gain: 0.065 * gain, pan });
        this.tone({ frequency: 150, endFrequency: 680, duration: 0.38, gain: 0.085 * gain, type: 'triangle', pan });
        this.tone({ frequency: 740, endFrequency: 1040, duration: 0.22, gain: 0.04 * gain, type: 'sine', delay: 0.16, pan });
        break;
      default:
        return false;
    }
    return true;
  }

  updateGameplay(options = {}) {
    if (!this.ensureContext()) return;
    this.updateListener(options.camera);
    const car = options.car;
    const ball = options.ball;
    const input = options.input;
    const carPosition = car?.body?.translation?.();
    const carVelocity = car?.body?.linvel?.();
    const ballPosition = ball?.body?.translation?.();
    const ballVelocity = ball?.body?.linvel?.();
    if (!carPosition || !carVelocity || !ballPosition || !ballVelocity) return;

    const axes = input?.getDriveAxes?.() ?? { throttle: 0, steer: 0 };
    const speedKmh = Math.hypot(carVelocity.x, carVelocity.y, carVelocity.z) * 3.6;
    const active = options.active !== false;
    const eventsEnabled = options.eventsEnabled ?? active;
    const wantsBoost = Boolean(input?.isDown?.('ShiftLeft', 'ShiftRight'));
    const drifting = Boolean(input?.isDown?.('ControlLeft', 'ControlRight'));
    const current = {
      carPosition: copyVector(carPosition),
      carVelocity: copyVector(carVelocity),
      ballPosition: copyVector(ballPosition),
      ballVelocity: copyVector(ballVelocity),
      grounded: Boolean(car.grounded),
      jumpCount: Math.max(0, Number(options.jumpCount ?? car.jumpCount) || 0),
      boost: Math.max(0, Number(car.getBoost?.() ?? car.boost) || 0),
      wantsBoost,
      speedKmh,
      gear: speedKmh < 4 ? 0 : Math.min(6, Math.floor(speedKmh / 38) + 1)
    };

    this.updateLoops(calculateEngineMix({
      speedKmh,
      throttle: axes.throttle,
      steer: axes.steer,
      active,
      grounded: current.grounded,
      boosting: Boolean(car.boosting) && active,
      drifting
    }));

    const previous = this.previousGameplay;
    this.previousGameplay = current;
    if (!previous || !eventsEnabled) return;

    if (current.jumpCount > previous.jumpCount) {
      this.play(current.jumpCount >= 2 ? 'flip' : 'jump', { volume: 0.92 });
    }

    if (current.grounded && current.gear > previous.gear && Math.abs(axes.throttle) > 0.45) {
      this.play('gearShift', { intensity: 0.6 + current.gear * 0.07, volume: 0.72 });
    }

    if (current.grounded && !previous.grounded && previous.carVelocity.y < -2.2) {
      this.play('land', { intensity: clamp(Math.abs(previous.carVelocity.y) / 12, 0.25, 1.1), volume: 0.9 });
    }

    const boostGain = current.boost - previous.boost;
    if (boostGain > 1.2) {
      let nearestPad = null;
      let nearestPadDistance = Infinity;
      for (const pad of options.boostPads || []) {
        if (pad?.active || !pad?.spec) continue;
        const distance = Math.hypot(
          current.carPosition.x - (Number(pad.spec.x) || 0),
          current.carPosition.z - (Number(pad.spec.z) || 0)
        );
        if (distance < nearestPadDistance) {
          nearestPad = pad;
          nearestPadDistance = distance;
        }
      }
      const fullPickup = (nearestPadDistance <= 3.4 && nearestPad?.spec?.kind === 'large') || boostGain >= 18;
      this.play(fullPickup ? 'boostPickupFull' : 'boostPickupSmall', { volume: 0.9 });
    }
    if (current.wantsBoost && !previous.wantsBoost && current.boost <= 0.2) {
      this.play('boostEmpty', { volume: 0.8 });
    }

    const ballCarDistance = vectorDeltaLength(current.ballPosition, current.carPosition);
    const impact = classifyGameplayImpact({
      previousBallVelocity: previous.ballVelocity,
      ballVelocity: current.ballVelocity,
      distanceToCar: ballCarDistance
    });
    if (impact.type) {
      this.play(impact.type, {
        position: current.ballPosition,
        intensity: impact.intensity,
        volume: impact.type === 'ballHit' ? 1 : 0.78
      });
    }

    const carVelocityDelta = vectorDeltaLength(current.carVelocity, previous.carVelocity);
    const landed = current.grounded && !previous.grounded;
    if (!landed && carVelocityDelta > 6.2) {
      this.play('carImpact', {
        position: current.carPosition,
        intensity: clamp((carVelocityDelta - 4.5) / 13, 0.2, 1.15),
        volume: 0.82
      });
    }

    const carTeleport = vectorDeltaLength(current.carPosition, previous.carPosition);
    const ballTeleport = vectorDeltaLength(current.ballPosition, previous.ballPosition);
    if (carTeleport > 15 || ballTeleport > 18) this.play('reset', { volume: 0.75 });
  }

  resetGameplayTracking() {
    this.previousGameplay = null;
  }

  stopGameplay(fast = false) {
    this.previousGameplay = null;
    if (!this.context || !this.loopNodes) return;
    const now = this.context.currentTime;
    const time = fast ? 0.01 : 0.06;
    for (const gain of [
      this.loopNodes.engineGain.gain,
      this.loopNodes.boost.gain.gain,
      this.loopNodes.skid.gain.gain,
      this.loopNodes.wind.gain.gain
    ]) gain.setTargetAtTime(0.00001, now, time);
  }
}

let sharedSoundDesign = null;

export function getSoundDesign(options = {}) {
  if (!sharedSoundDesign) sharedSoundDesign = new SoundDesign(options);
  else sharedSoundDesign.configure(options);
  return sharedSoundDesign;
}
