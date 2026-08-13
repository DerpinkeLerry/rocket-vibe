import { canRequestFullscreen, isFullscreenActive, toggleGameFullscreen } from './Fullscreen.js';

const MICRO_DEAD_ZONE = 0.018;
const ANALOG_SOURCE = 'mobile-stick-analog';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function applyMicroDeadZone(value, deadZone = MICRO_DEAD_ZONE) {
  const magnitude = Math.abs(Number(value) || 0);
  if (magnitude <= deadZone) return 0;
  return Math.sign(value) * clamp((magnitude - deadZone) / (1 - deadZone), 0, 1);
}

export function curveSteering(rawX, options = {}) {
  const drift = Boolean(options.drift);
  const speedKmh = Math.max(0, Number(options.speedKmh) || 0);
  const normalized = applyMicroDeadZone(rawX);
  const magnitude = Math.abs(normalized);
  if (magnitude === 0) return 0;

  // v1.10.16: keep fine control around center, but get to useful steering much
  // sooner. The previous 1.65 exponent made normal driving feel like a very long
  // steering rack: ~50 % thumb travel produced only ~30 % steering before the
  // speed filter. This curve is close to linear while still preserving a soft
  // center. Drift deliberately becomes even more eager.
  const exponent = drift ? 0.72 : 0.96;
  let curved = magnitude ** exponent;

  // High-speed precision is now deliberately subtle. We only soften the middle
  // of the stick by at most 6 %, and restore full authority well before the
  // outer edge. Full travel always remains exactly 100 %.
  if (!drift) {
    const speedBlend = clamp((speedKmh - 55) / 75, 0, 1);
    const precisionScale = 1 - speedBlend * 0.06;
    const outerRestore = smoothstep(0.58, 0.90, magnitude);
    curved *= precisionScale + (1 - precisionScale) * outerRestore;
  }

  // Physics uses +1 for left (A) and -1 for right (D), opposite screen X.
  return -Math.sign(normalized) * clamp(curved, 0, 1);
}

export function curveThrottle(rawY) {
  const normalized = applyMicroDeadZone(-rawY);
  const magnitude = Math.abs(normalized);
  if (magnitude === 0) return 0;
  // A mildly progressive curve gives useful acceleration/braking early in the
  // thumb travel while remaining truly analog. Half-stick is intentionally more
  // than half command now, so mobile no longer feels underpowered.
  return Math.sign(normalized) * (magnitude ** 0.68);
}

export function resolveAnalogStick(x, y, options = {}) {
  let rawX = clamp(Number(x) || 0, -1, 1);
  let rawY = clamp(Number(y) || 0, -1, 1);
  const absX = Math.abs(rawX);
  const absY = Math.abs(rawY);

  // Only suppress *tiny* cross-axis finger wobble. The old relative axis lock
  // treated full throttle + moderate steering as "mostly throttle" and could
  // crush 30 % steering down to ~9 %. Deliberate combined steering/throttle is
  // now left untouched. The attenuation below is smooth and disappears by 12 %.
  if (absY > 0.24 && absX < 0.12) {
    rawX *= smoothstep(0.02, 0.12, absX);
  }
  if (absX > 0.24 && absY < 0.12) {
    rawY *= smoothstep(0.02, 0.12, absY);
  }

  return {
    throttle: curveThrottle(rawY),
    steer: curveSteering(rawX, options)
  };
}

// Compatibility helper kept for old tests/tools. Unlike the old implementation
// this is not used for gameplay; it merely describes the signs of analog axes.
export function resolveStickCodes(x, y) {
  const axes = resolveAnalogStick(x, y);
  const codes = [];
  if (axes.steer > 0.025) codes.push('KeyA');
  if (axes.steer < -0.025) codes.push('KeyD');
  if (axes.throttle > 0.025) codes.push('KeyW');
  if (axes.throttle < -0.025) codes.push('KeyS');
  return codes;
}

export function prefersMobileControls() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('mobile') === '1') return true;
  if (params.get('mobile') === '0') return false;
  return navigator.maxTouchPoints > 0 && Boolean(window.matchMedia?.('(any-pointer: coarse)').matches);
}

function vibrate(pattern = 8) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are optional and unsupported on several browsers (notably iOS).
  }
}

export class MobileControls {
  constructor(root, input, options = {}) {
    this.root = root;
    this.input = input;
    this.enabled = options.enabled ?? prefersMobileControls();
    this.stickPointerId = null;
    this.stickRect = null;
    this.stickOriginX = 0;
    this.stickOriginY = 0;
    this.stickRadius = 128;
    this.knobTravel = 78;
    this.rawStickX = 0;
    this.rawStickY = 0;
    this.targetThrottle = 0;
    this.targetSteer = 0;
    this.currentThrottle = 0;
    this.currentSteer = 0;
    this.vehicleSpeedKmh = 0;
    this.analogFrame = 0;
    this.analogLastTime = 0;
    this.buttonPointers = new Map();
    this.fullscreenButton = null;
    this.quickChatButton = null;
    this.quickChatHandler = null;
    this.quickChatCooldownTimer = null;
    this.quickChatCooldownInterval = null;
    this.destroyers = [];

    if (!this.enabled) return;

    root.classList.add('mobile-active');
    document.documentElement.classList.add('mobile-game');

    this.el = document.createElement('div');
    this.el.className = 'mobile-controls';
    this.el.setAttribute('aria-label', 'Touch-Steuerung');
    this.el.innerHTML = `
      <div class="mobile-controls__left">
        <div class="mobile-stick" data-stick aria-label="Analoger virtueller Steuerstick">
          <div class="mobile-stick__knob" data-stick-knob></div>
        </div>
      </div>

      <div class="mobile-controls__right">
        <div class="mobile-controls__utility">
          <button class="mobile-btn mobile-btn--utility" type="button" data-key="KeyC" data-tap data-camera-button aria-label="Kamera wechseln">BALL</button>
          <button class="mobile-btn mobile-btn--utility" type="button" data-key="KeyR" data-tap aria-label="Auto zurücksetzen">↻</button>
          <button class="mobile-btn mobile-btn--utility mobile-btn--fullscreen" type="button" data-fullscreen aria-label="Vollbild">⛶</button>
        </div>
        <div class="mobile-controls__quickchat">
          <button class="mobile-btn mobile-btn--quickchat" type="button" data-quick-chat aria-label="Quick Chat: What a save!">WHAT A SAVE!</button>
        </div>
        <div class="mobile-controls__roll">
          <button class="mobile-btn mobile-btn--small mobile-btn--drift" type="button" data-key="ControlLeft" aria-label="Drift / Handbremse">DRIFT</button>
          <button class="mobile-btn mobile-btn--small" type="button" data-key="KeyQ" aria-label="Air Roll links">ROLL L</button>
          <button class="mobile-btn mobile-btn--small" type="button" data-key="KeyE" aria-label="Air Roll rechts">ROLL R</button>
        </div>
        <div class="mobile-controls__actions">
          <button class="mobile-btn mobile-btn--boost" type="button" data-key="ShiftLeft" aria-label="Boost">BOOST</button>
          <button class="mobile-btn mobile-btn--jump" type="button" data-key="Space" aria-label="Springen und Flippen">JUMP</button>
        </div>
      </div>

      <div class="mobile-orientation-hint" aria-hidden="true">
        <strong>↻ Querformat empfohlen</strong>
        <span>Mehr Platz für Steuerung und Sicht</span>
      </div>
    `;
    root.appendChild(this.el);

    this.stick = this.el.querySelector('[data-stick]');
    this.stickKnob = this.el.querySelector('[data-stick-knob]');
    this.fullscreenButton = this.el.querySelector('[data-fullscreen]');
    this.cameraButton = this.el.querySelector('[data-camera-button]');
    this.quickChatButton = this.el.querySelector('[data-quick-chat]');

    this.bindStick();
    this.bindButtons();
    this.bindLifecycle();
    this.updateFullscreenAvailability();
  }

  setVehicleSpeed(speedKmh = 0) {
    this.vehicleSpeedKmh = Math.max(0, Number(speedKmh) || 0);
  }

  bindStick() {
    const onDown = (event) => {
      if (this.stickPointerId !== null) return;
      event.preventDefault();
      this.stickPointerId = event.pointerId;
      this.stickRect = this.stick.getBoundingClientRect();
      this.stickRadius = Math.max(92, Math.min(138, Math.min(this.stickRect.width, this.stickRect.height) * 0.46));
      this.knobTravel = Math.min(82, this.stickRadius * 0.64);

      // Floating origin: wherever the thumb lands becomes neutral. This removes
      // the need to hunt for one fixed center while looking at the match.
      this.stickOriginX = event.clientX;
      this.stickOriginY = event.clientY;
      this.stick.setPointerCapture?.(event.pointerId);
      this.stick.classList.add('is-active');
      this.positionKnob(0, 0, true);
      this.updateStick(event.clientX, event.clientY);
      this.startAnalogLoop();
    };

    const onMove = (event) => {
      if (event.pointerId !== this.stickPointerId) return;
      event.preventDefault();
      this.updateStick(event.clientX, event.clientY);
    };

    const onUp = (event) => {
      if (event.pointerId !== this.stickPointerId) return;
      event.preventDefault();
      this.releaseStick(false);
    };

    this.stick.addEventListener('pointerdown', onDown, { passive: false });
    this.stick.addEventListener('pointermove', onMove, { passive: false });
    this.stick.addEventListener('pointerup', onUp, { passive: false });
    this.stick.addEventListener('pointercancel', onUp, { passive: false });
    this.destroyers.push(() => {
      this.stick.removeEventListener('pointerdown', onDown);
      this.stick.removeEventListener('pointermove', onMove);
      this.stick.removeEventListener('pointerup', onUp);
      this.stick.removeEventListener('pointercancel', onUp);
    });
  }

  positionKnob(dx, dy, atOrigin = false) {
    if (!this.stickKnob || !this.stickRect) return;
    const localX = this.stickOriginX - this.stickRect.left;
    const localY = this.stickOriginY - this.stickRect.top;
    const visualX = atOrigin ? 0 : dx * this.knobTravel;
    const visualY = atOrigin ? 0 : dy * this.knobTravel;
    this.stickKnob.style.left = `${localX.toFixed(1)}px`;
    this.stickKnob.style.top = `${localY.toFixed(1)}px`;
    this.stickKnob.style.transform = `translate(${visualX.toFixed(1)}px, ${visualY.toFixed(1)}px)`;
  }

  updateStick(clientX, clientY) {
    let dx = (clientX - this.stickOriginX) / Math.max(1, this.stickRadius);
    let dy = (clientY - this.stickOriginY) / Math.max(1, this.stickRadius);
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    this.rawStickX = dx;
    this.rawStickY = dy;
    this.positionKnob(dx, dy);
    this.recalculateTargets();
  }

  recalculateTargets() {
    const axes = resolveAnalogStick(this.rawStickX, this.rawStickY, {
      speedKmh: this.vehicleSpeedKmh,
      drift: this.input.isDown('ControlLeft', 'ControlRight')
    });
    this.targetThrottle = axes.throttle;
    this.targetSteer = axes.steer;
  }

  startAnalogLoop() {
    if (this.analogFrame || typeof requestAnimationFrame !== 'function') return;
    this.analogLastTime = performance.now();
    const tick = (now) => {
      this.analogFrame = 0;
      const dt = clamp((now - this.analogLastTime) / 1000, 1 / 240, 0.05);
      this.analogLastTime = now;

      if (this.stickPointerId !== null) this.recalculateTargets();

      const steerReturning = Math.abs(this.targetSteer) < Math.abs(this.currentSteer);
      const throttleReturning = Math.abs(this.targetThrottle) < Math.abs(this.currentThrottle);
      this.currentSteer = damp(this.currentSteer, this.targetSteer, steerReturning ? 50 : 42, dt);
      this.currentThrottle = damp(this.currentThrottle, this.targetThrottle, throttleReturning ? 48 : 40, dt);

      if (Math.abs(this.currentSteer) < 0.002 && Math.abs(this.targetSteer) < 0.002) this.currentSteer = 0;
      if (Math.abs(this.currentThrottle) < 0.002 && Math.abs(this.targetThrottle) < 0.002) this.currentThrottle = 0;

      const stillActive = this.stickPointerId !== null || this.currentSteer !== 0 || this.currentThrottle !== 0;
      if (stillActive) {
        this.input.setAnalogDrive(this.currentThrottle, this.currentSteer, true, ANALOG_SOURCE);
        this.analogFrame = requestAnimationFrame(tick);
      } else {
        this.input.clearAnalogDrive(ANALOG_SOURCE);
      }
    };
    this.analogFrame = requestAnimationFrame(tick);
  }

  releaseStick(immediate = false) {
    this.stickPointerId = null;
    this.stickRect = null;
    this.rawStickX = 0;
    this.rawStickY = 0;
    this.targetThrottle = 0;
    this.targetSteer = 0;
    this.stick?.classList.remove('is-active');
    if (this.stickKnob) {
      this.stickKnob.style.left = '50%';
      this.stickKnob.style.top = '50%';
      this.stickKnob.style.transform = 'translate(0px, 0px)';
    }

    if (immediate) {
      if (this.analogFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.analogFrame);
      this.analogFrame = 0;
      this.currentThrottle = 0;
      this.currentSteer = 0;
      this.input.clearAnalogDrive(ANALOG_SOURCE);
    } else {
      this.startAnalogLoop();
    }
  }

  bindButtons() {
    for (const button of this.el.querySelectorAll('[data-key]')) {
      const code = button.dataset.key;
      const tapOnly = button.hasAttribute('data-tap');

      const onDown = (event) => {
        event.preventDefault();
        if (this.buttonPointers.has(event.pointerId)) return;
        this.buttonPointers.set(event.pointerId, { button, code });
        button.setPointerCapture?.(event.pointerId);
        button.classList.add('is-active');
        this.input.setVirtualKey(code, true, `mobile-button-${event.pointerId}`);
        if (tapOnly) {
          this.input.setVirtualKey(code, false, `mobile-button-${event.pointerId}`);
        }
        if (code === 'Space') vibrate(10);
        else if (code === 'ShiftLeft') vibrate(5);
        else if (code === 'ControlLeft') {
          vibrate(6);
          this.recalculateTargets();
        }
      };

      const onUp = (event) => {
        const held = this.buttonPointers.get(event.pointerId);
        if (!held || held.button !== button) return;
        event.preventDefault();
        this.buttonPointers.delete(event.pointerId);
        button.classList.remove('is-active');
        this.input.setVirtualKey(code, false, `mobile-button-${event.pointerId}`);
        if (code === 'ControlLeft') this.recalculateTargets();
      };

      button.addEventListener('pointerdown', onDown, { passive: false });
      button.addEventListener('pointerup', onUp, { passive: false });
      button.addEventListener('pointercancel', onUp, { passive: false });
      button.addEventListener('lostpointercapture', onUp, { passive: false });
      this.destroyers.push(() => {
        button.removeEventListener('pointerdown', onDown);
        button.removeEventListener('pointerup', onUp);
        button.removeEventListener('pointercancel', onUp);
        button.removeEventListener('lostpointercapture', onUp);
      });
    }

    const onQuickChat = (event) => {
      event.preventDefault();
      if (this.quickChatButton?.disabled || !this.quickChatHandler) return;
      vibrate(5);
      this.quickChatHandler();
    };
    this.quickChatButton?.addEventListener('pointerdown', onQuickChat, { passive: false });
    this.destroyers.push(() => this.quickChatButton?.removeEventListener('pointerdown', onQuickChat));

    const onFullscreen = async (event) => {
      event.preventDefault();
      vibrate(8);
      await toggleGameFullscreen(document.documentElement);
      this.updateFullscreenAvailability();
    };
    this.fullscreenButton?.addEventListener('click', onFullscreen);
    this.destroyers.push(() => this.fullscreenButton?.removeEventListener('click', onFullscreen));
  }

  bindLifecycle() {
    const releaseAll = () => this.releaseAll();
    const onVisibility = () => {
      if (document.hidden) this.releaseAll();
    };
    const onFullscreenChange = () => this.updateFullscreenAvailability();
    const onContextMenu = (event) => event.preventDefault();

    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    this.el.addEventListener('contextmenu', onContextMenu);
    this.destroyers.push(() => {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      this.el.removeEventListener('contextmenu', onContextMenu);
    });
  }

  setQuickChatHandler(handler) {
    this.quickChatHandler = typeof handler === 'function' ? handler : null;
  }

  setQuickChatCooldown(milliseconds = 0) {
    if (!this.quickChatButton) return;
    if (this.quickChatCooldownTimer) clearTimeout(this.quickChatCooldownTimer);
    if (this.quickChatCooldownInterval) clearInterval(this.quickChatCooldownInterval);
    this.quickChatCooldownTimer = null;
    this.quickChatCooldownInterval = null;

    const duration = Math.max(0, Number(milliseconds) || 0);
    if (duration <= 0) {
      this.quickChatButton.disabled = false;
      this.quickChatButton.textContent = 'WHAT A SAVE!';
      return;
    }

    const deadline = performance.now() + duration;
    this.quickChatButton.disabled = true;
    const update = () => {
      const remaining = Math.max(0, deadline - performance.now());
      this.quickChatButton.textContent = remaining > 0 ? `WAIT ${(remaining / 1000).toFixed(1)}s` : 'WHAT A SAVE!';
    };
    update();
    this.quickChatCooldownInterval = setInterval(update, 100);
    this.quickChatCooldownTimer = setTimeout(() => {
      if (this.quickChatCooldownInterval) clearInterval(this.quickChatCooldownInterval);
      this.quickChatCooldownInterval = null;
      this.quickChatCooldownTimer = null;
      this.quickChatButton.disabled = false;
      this.quickChatButton.textContent = 'WHAT A SAVE!';
    }, duration);
  }

  setCameraMode(mode) {
    if (!this.cameraButton) return;
    const carMode = mode === 'CAR';
    this.cameraButton.textContent = carMode ? 'CAR' : 'BALL';
    this.cameraButton.setAttribute('aria-label', `Kamera wechseln · aktuell ${carMode ? 'Car Cam' : 'Ball Cam'}`);
  }

  updateFullscreenAvailability() {
    if (!this.fullscreenButton) return;
    const active = isFullscreenActive();
    const supported = canRequestFullscreen(document.documentElement);
    this.fullscreenButton.hidden = false;
    this.fullscreenButton.textContent = active ? '×' : '⛶';
    this.fullscreenButton.setAttribute(
      'aria-label',
      active ? 'Vollbild verlassen' : (supported ? 'Vollbild' : 'Browser-Vollbild versuchen')
    );
  }

  releaseAll() {
    this.releaseStick(true);
    for (const [pointerId, held] of this.buttonPointers) {
      held.button.classList.remove('is-active');
      this.input.setVirtualKey(held.code, false, `mobile-button-${pointerId}`);
    }
    this.buttonPointers.clear();
    this.input.clearVirtualKeys?.();
    this.input.clearAnalogDrive?.(ANALOG_SOURCE);
  }

  destroy() {
    this.releaseAll();
    if (this.quickChatCooldownTimer) clearTimeout(this.quickChatCooldownTimer);
    if (this.quickChatCooldownInterval) clearInterval(this.quickChatCooldownInterval);
    for (const destroy of this.destroyers) destroy();
    this.destroyers.length = 0;
    this.el?.remove();
    this.root.classList.remove('mobile-active');
    document.documentElement.classList.remove('mobile-game');
  }
}
