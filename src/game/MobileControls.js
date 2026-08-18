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

export function curveSmartGroundThrottle(rawY) {
  const y = clamp(Number(rawY) || 0, -1, 1);
  // Touching the drive zone means "go". A deliberate downward pull first
  // feathers the throttle, then brakes/reverses. This leaves the horizontal
  // thumb movement entirely available for steering on a small phone.
  if (y <= 0.08) return 1;
  if (y <= 0.26) return 1 - smoothstep(0.08, 0.26, y);
  return -smoothstep(0.26, 0.62, y);
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

export function resolveMobileDrive(x, y, options = {}) {
  if (options.airborne || options.smartThrottle === false) {
    return resolveAnalogStick(x, y, options);
  }
  return {
    throttle: curveSmartGroundThrottle(y),
    steer: curveSteering(clamp(Number(x) || 0, -1, 1), options)
  };
}

export function isPointInsideAction(clientX, clientY, rect, padding = 12) {
  if (!rect) return false;
  const x = Number(clientX);
  const y = Number(clientY);
  const pad = Math.max(0, Number(padding) || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= rect.left - pad && x <= rect.right + pad
    && y >= rect.top - pad && y <= rect.bottom + pad;
}

export function getMobileBallContactTarget(options = {}) {
  const car = options.carPosition ?? {};
  const carVelocity = options.carVelocity ?? {};
  const forward = options.carForward ?? {};
  const ball = options.ballPosition ?? {};
  const ballVelocity = options.ballVelocity ?? {};
  const fxRaw = Number(forward.x) || 0;
  const fzRaw = Number(forward.z) || -1;
  const forwardLength = Math.max(1e-6, Math.hypot(fxRaw, fzRaw));
  const fx = fxRaw / forwardLength;
  const fz = fzRaw / forwardLength;
  const carSpeed = Math.hypot(
    Number(carVelocity.x) || 0,
    Number(carVelocity.y) || 0,
    Number(carVelocity.z) || 0
  );
  const initialDistance = Math.hypot(
    (Number(ball.x) || 0) - (Number(car.x) || 0),
    (Number(ball.z) || 0) - (Number(car.z) || 0)
  );
  const leadTime = clamp(initialDistance / Math.max(13, carSpeed + 5), 0.03, 0.30);
  const leadScale = 0.72;
  const dx = (Number(ball.x) || 0) + (Number(ballVelocity.x) || 0) * leadTime * leadScale
    - (Number(car.x) || 0);
  const dz = (Number(ball.z) || 0) + (Number(ballVelocity.z) || 0) * leadTime * leadScale
    - (Number(car.z) || 0);
  const distance = Math.max(1e-6, Math.hypot(dx, dz));
  const forwardDot = clamp((fx * dx + fz * dz) / distance, -1, 1);
  // Positive is left in the physics steering convention.
  const signedAngle = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
  const verticalDelta = (Number(ball.y) || 0) - (Number(car.y) || 0);
  const reachable = options.enabled !== false
    && distance <= 13.5
    && verticalDelta >= -1.2
    && verticalDelta <= 2.65
    && forwardDot >= Math.cos(0.82);
  return Object.freeze({
    reachable,
    distance,
    signedAngle,
    verticalDelta,
    leadTime
  });
}

export function applyMobileBallContactAssist(manualSteer, options = {}) {
  const steer = clamp(Number(manualSteer) || 0, -1, 1);
  const angle = Number(options.signedAngle) || 0;
  const distance = Math.max(0, Number(options.distance) || 0);
  const throttle = Number(options.throttle) || 0;
  if (!options.reachable || options.airborne || throttle <= 0.15
    || distance <= 0.5 || Math.abs(angle) <= 0.022 || Math.abs(angle) >= 0.82) {
    return Object.freeze({ steer, strength: 0, correction: 0, active: false });
  }

  const desiredSteer = clamp(angle / 0.38, -1, 1);
  const distanceBlend = 1 - smoothstep(3.5, 13.5, distance);
  const angleBlend = 1 - smoothstep(0.58, 0.82, Math.abs(angle));
  let strength = (0.16 + distanceBlend * 0.28) * angleBlend;

  // A deliberate opposite or full-lock input always wins. The assist corrects
  // small thumb imprecision; it must never prevent an angled shot or rotation.
  if (steer * desiredSteer < -0.04) {
    strength *= clamp(1 - Math.abs(steer) * 2.5, 0, 1);
  } else if (Math.abs(steer) > 0.82) {
    strength *= 0.12;
  }

  const correction = clamp((desiredSteer - steer) * strength, -0.30, 0.30);
  const assistedSteer = clamp(steer + correction, -1, 1);
  return Object.freeze({
    steer: assistedSteer,
    strength,
    correction,
    active: Math.abs(correction) >= 0.012
  });
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
    this.vehicleAirborne = false;
    this.ballContactTarget = null;
    this.ballAssistActive = false;
    this.analogFrame = 0;
    this.analogLastTime = 0;
    this.buttonPointers = new Map();
    this.jumpControlSources = new Set();
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
          <div class="mobile-stick__guide" data-stick-guide aria-hidden="true">
            <span class="mobile-stick__guide-label" data-stick-mode>AUTO-GAS · LENKEN</span>
          </div>
          <div class="mobile-stick__knob" data-stick-knob></div>
        </div>
        <div class="mobile-stick__idle-hint" aria-hidden="true">BERÜHREN &amp; LENKEN <small>↓ BREMSE</small></div>
      </div>

      <div class="mobile-controls__right">
        <div class="mobile-controls__utility">
          <button class="mobile-btn mobile-btn--utility" type="button" data-key="KeyC" data-tap data-camera-button aria-label="Kamera wechseln">BALL</button>
          <button class="mobile-btn mobile-btn--utility" type="button" data-key="KeyR" data-tap aria-label="Auto zurücksetzen">↻</button>
        </div>
        <div class="mobile-controls__quickchat">
          <button class="mobile-btn mobile-btn--quickchat" type="button" data-quick-chat aria-label="Chat öffnen">CHAT</button>
        </div>
        <div class="mobile-controls__roll">
          <button class="mobile-btn mobile-btn--small mobile-btn--drift" type="button" data-key="ControlLeft" aria-label="Drift / Handbremse">DRIFT</button>
          <button class="mobile-btn mobile-btn--small" type="button" data-key="KeyQ" aria-label="Air Roll links">L ↶</button>
          <button class="mobile-btn mobile-btn--small" type="button" data-key="KeyE" aria-label="Air Roll rechts">↷ R</button>
        </div>
        <div class="mobile-controls__actions">
          <button class="mobile-btn mobile-btn--boost" type="button" data-key="ShiftLeft" data-action-boost aria-label="Boost; nach rechts zum Sprung wischen"><span>BOOST</span><small>→ JUMP</small></button>
          <button class="mobile-btn mobile-btn--jump" type="button" data-key="Space" data-action-jump aria-label="Springen und Flippen"><span>JUMP</span><small>2× FLIP</small></button>
        </div>
      </div>

      <div class="mobile-control-coach" aria-hidden="true">
        <span><b>LINKS</b> berühren = Auto-Gas · ziehen = lenken · ↓ bremsen</span>
        <span><b>BOOST → JUMP</b> wischen = beides mit einem Finger</span>
      </div>

      <div class="mobile-ball-contact" data-ball-contact aria-hidden="true">
        <i></i><span>KONTAKT</span>
      </div>

      <div class="mobile-orientation-hint" aria-hidden="true">
        <strong>↻ Querformat empfohlen</strong>
        <span>Mehr Platz für Steuerung und Sicht</span>
      </div>
    `;
    root.appendChild(this.el);

    this.stick = this.el.querySelector('[data-stick]');
    this.stickKnob = this.el.querySelector('[data-stick-knob]');
    this.stickGuide = this.el.querySelector('[data-stick-guide]');
    this.stickModeLabel = this.el.querySelector('[data-stick-mode]');
    this.cameraButton = this.el.querySelector('[data-camera-button]');
    this.quickChatButton = this.el.querySelector('[data-quick-chat]');
    this.jumpButton = this.el.querySelector('[data-action-jump]');
    this.ballContactMarker = this.el.querySelector('[data-ball-contact]');

    this.bindStick();
    this.bindButtons();
    this.bindLifecycle();
  }

  setVehicleSpeed(speedKmh = 0) {
    this.vehicleSpeedKmh = Math.max(0, Number(speedKmh) || 0);
  }

  setVehicleState({ speedKmh = 0, airborne = false } = {}) {
    const wasAirborne = this.vehicleAirborne;
    this.vehicleSpeedKmh = Math.max(0, Number(speedKmh) || 0);
    this.vehicleAirborne = Boolean(airborne);
    this.el?.classList.toggle('is-airborne', this.vehicleAirborne);
    if (this.stickModeLabel) {
      this.stickModeLabel.textContent = this.vehicleAirborne ? 'AIR · PITCH / YAW' : 'AUTO-GAS · LENKEN';
    }
    if (wasAirborne !== this.vehicleAirborne && this.stickPointerId !== null) {
      this.recalculateTargets();
      this.syncAnalogImmediately();
    }
  }

  setBallContactTarget(target = null) {
    this.ballContactTarget = target;
    if (this.stickPointerId !== null) this.recalculateTargets();
    if (!target?.reachable) {
      this.setBallAssistActive(false);
      this.ballContactMarker?.classList.remove('is-visible');
    }
  }

  setBallContactScreenPosition({ x = 0, y = 0, visible = false } = {}) {
    if (!this.ballContactMarker) return;
    this.ballContactMarker.style.left = `${Number(x).toFixed(1)}px`;
    this.ballContactMarker.style.top = `${Number(y).toFixed(1)}px`;
    this.ballContactMarker.classList.toggle('is-visible', Boolean(visible && this.ballContactTarget?.reachable));
  }

  bindStick() {
    const onDown = (event) => {
      if (this.stickPointerId !== null) return;
      event.preventDefault();
      this.stickPointerId = event.pointerId;
      this.stickRect = this.stick.getBoundingClientRect();
      this.stickRadius = Math.max(76, Math.min(108, Math.min(this.stickRect.width, this.stickRect.height) * 0.40));
      this.knobTravel = Math.min(62, this.stickRadius * 0.58);

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
    if (this.stickGuide) {
      this.stickGuide.style.left = `${localX.toFixed(1)}px`;
      this.stickGuide.style.top = `${localY.toFixed(1)}px`;
    }
  }

  updateStick(clientX, clientY) {
    let pixelX = clientX - this.stickOriginX;
    let pixelY = clientY - this.stickOriginY;
    const pixelLength = Math.hypot(pixelX, pixelY);
    if (pixelLength > this.stickRadius) {
      // Let the floating center follow overflow at the edge. The player can
      // straighten with a short thumb correction instead of hunting for the
      // exact first contact point after a long steering sweep.
      const overflow = pixelLength - this.stickRadius;
      this.stickOriginX += pixelX / pixelLength * overflow;
      this.stickOriginY += pixelY / pixelLength * overflow;
      pixelX = clientX - this.stickOriginX;
      pixelY = clientY - this.stickOriginY;
    }
    let dx = pixelX / Math.max(1, this.stickRadius);
    let dy = pixelY / Math.max(1, this.stickRadius);
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
    if (this.stickPointerId === null) {
      this.targetThrottle = 0;
      this.targetSteer = 0;
      this.setBallAssistActive(false);
      return;
    }
    const axes = resolveMobileDrive(this.rawStickX, this.rawStickY, {
      speedKmh: this.vehicleSpeedKmh,
      drift: this.input.isDown('ControlLeft', 'ControlRight'),
      airborne: this.vehicleAirborne || this.jumpControlSources.size > 0
    });
    const assist = applyMobileBallContactAssist(axes.steer, {
      ...this.ballContactTarget,
      throttle: axes.throttle,
      airborne: this.vehicleAirborne || this.jumpControlSources.size > 0
    });
    this.targetThrottle = axes.throttle;
    this.targetSteer = assist.steer;
    this.setBallAssistActive(assist.active, assist.strength);
    this.stick?.classList.toggle('is-braking', axes.throttle < -0.05);
  }

  setBallAssistActive(active, strength = 0) {
    this.ballAssistActive = Boolean(active);
    this.el?.classList.toggle('is-ball-assist', this.ballAssistActive);
    this.ballContactMarker?.classList.toggle('is-active', this.ballAssistActive);
    this.ballContactMarker?.style.setProperty('--contact-assist', clamp(Number(strength) || 0, 0, 1).toFixed(3));
  }

  syncAnalogImmediately() {
    if (this.stickPointerId === null) return;
    this.currentThrottle = this.targetThrottle;
    this.currentSteer = this.targetSteer;
    this.input.setAnalogDrive(this.currentThrottle, this.currentSteer, true, ANALOG_SOURCE);
  }

  setJumpControl(source, active) {
    if (active) this.jumpControlSources.add(source);
    else this.jumpControlSources.delete(source);
    this.recalculateTargets();
    this.syncAnalogImmediately();
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
    this.stick?.classList.remove('is-braking');
    this.setBallAssistActive(false);
    if (this.stickKnob) {
      this.stickKnob.style.left = '50%';
      this.stickKnob.style.top = '50%';
      this.stickKnob.style.transform = 'translate(0px, 0px)';
    }
    if (this.stickGuide) {
      this.stickGuide.style.left = '50%';
      this.stickGuide.style.top = '50%';
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
        const source = `mobile-button-${event.pointerId}`;
        const held = { button, code, source, chordActive: false };
        this.buttonPointers.set(event.pointerId, held);
        button.setPointerCapture?.(event.pointerId);
        button.classList.add('is-active');
        if (code === 'Space') this.setJumpControl(source, true);
        this.input.setVirtualKey(code, true, source);
        if (tapOnly) {
          this.input.setVirtualKey(code, false, source);
        }
        if (code === 'Space') vibrate(10);
        else if (code === 'ShiftLeft') vibrate(5);
        else if (code === 'ControlLeft') {
          vibrate(6);
          this.recalculateTargets();
        } else if (code === 'KeyQ' || code === 'KeyE') vibrate(4);
      };

      const onMove = (event) => {
        const held = this.buttonPointers.get(event.pointerId);
        if (!held || held.button !== button || code !== 'ShiftLeft' || !this.jumpButton) return;
        event.preventDefault();
        const insideJump = isPointInsideAction(
          event.clientX,
          event.clientY,
          this.jumpButton.getBoundingClientRect(),
          14
        );
        if (insideJump === held.chordActive) return;
        const chordSource = `mobile-chord-${event.pointerId}`;
        held.chordActive = insideJump;
        this.jumpButton.classList.toggle('is-chord-active', insideJump);
        if (insideJump) this.setJumpControl(chordSource, true);
        this.input.setVirtualKey('Space', insideJump, chordSource);
        if (!insideJump) this.setJumpControl(chordSource, false);
        if (insideJump) vibrate(10);
      };

      const onUp = (event) => {
        const held = this.buttonPointers.get(event.pointerId);
        if (!held || held.button !== button) return;
        event.preventDefault();
        this.buttonPointers.delete(event.pointerId);
        button.classList.remove('is-active');
        if (held.chordActive) {
          const chordSource = `mobile-chord-${event.pointerId}`;
          this.input.setVirtualKey('Space', false, chordSource);
          this.setJumpControl(chordSource, false);
          this.jumpButton?.classList.remove('is-chord-active');
        }
        this.input.setVirtualKey(code, false, held.source);
        if (code === 'Space') this.setJumpControl(held.source, false);
        if (code === 'ControlLeft') this.recalculateTargets();
      };

      button.addEventListener('pointerdown', onDown, { passive: false });
      button.addEventListener('pointermove', onMove, { passive: false });
      button.addEventListener('pointerup', onUp, { passive: false });
      button.addEventListener('pointercancel', onUp, { passive: false });
      button.addEventListener('lostpointercapture', onUp, { passive: false });
      this.destroyers.push(() => {
        button.removeEventListener('pointerdown', onDown);
        button.removeEventListener('pointermove', onMove);
        button.removeEventListener('pointerup', onUp);
        button.removeEventListener('pointercancel', onUp);
        button.removeEventListener('lostpointercapture', onUp);
      });
    }

    const onQuickChat = (event) => {
      event.preventDefault();
      if (!this.quickChatHandler) return;
      vibrate(5);
      this.quickChatHandler();
    };
    this.quickChatButton?.addEventListener('pointerdown', onQuickChat, { passive: false });
    this.destroyers.push(() => this.quickChatButton?.removeEventListener('pointerdown', onQuickChat));

  }

  bindLifecycle() {
    const releaseAll = () => this.releaseAll();
    const onVisibility = () => {
      if (document.hidden) this.releaseAll();
    };
    const onContextMenu = (event) => event.preventDefault();

    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    this.el.addEventListener('contextmenu', onContextMenu);
    this.destroyers.push(() => {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      this.el.removeEventListener('contextmenu', onContextMenu);
    });
  }

  setQuickChatHandler(handler) {
    this.quickChatHandler = typeof handler === 'function' ? handler : null;
  }

  setChatHandler(handler) {
    this.setQuickChatHandler(handler);
  }

  setQuickChatCooldown(_milliseconds = 0) {
    // The mobile CHAT button must always stay usable: text chat is independent
    // from the server-side quick-chat cooldown. The ChatPanel shows cooldowns.
    if (this.quickChatButton) {
      this.quickChatButton.disabled = false;
      this.quickChatButton.textContent = 'CHAT';
    }
  }

  setCameraMode(mode) {
    if (!this.cameraButton) return;
    const carMode = mode === 'CAR';
    this.cameraButton.textContent = carMode ? 'CAR' : 'BALL';
    this.cameraButton.setAttribute('aria-label', `Kamera wechseln · aktuell ${carMode ? 'Car Cam' : 'Ball Cam'}`);
  }

  releaseAll() {
    this.releaseStick(true);
    for (const [pointerId, held] of this.buttonPointers) {
      held.button.classList.remove('is-active');
      this.input.setVirtualKey(held.code, false, held.source ?? `mobile-button-${pointerId}`);
      if (held.chordActive) this.input.setVirtualKey('Space', false, `mobile-chord-${pointerId}`);
    }
    this.buttonPointers.clear();
    this.jumpControlSources.clear();
    this.jumpButton?.classList.remove('is-chord-active');
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
