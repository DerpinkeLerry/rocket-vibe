import { canRequestFullscreen, isFullscreenActive, toggleGameFullscreen } from './Fullscreen.js';

const STICK_CODES = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];

export function resolveStickCodes(x, y, throttleDeadZone = 0.22, steeringDeadZone = 0.34) {
  const codes = [];
  // Steering intentionally needs more thumb travel than throttle/brake. This
  // makes small corrections on a phone much less twitchy while preserving
  // quick acceleration and braking.
  if (x <= -steeringDeadZone) codes.push('KeyA');
  if (x >= steeringDeadZone) codes.push('KeyD');
  if (y <= -throttleDeadZone) codes.push('KeyW');
  if (y >= throttleDeadZone) codes.push('KeyS');
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
    this.activeStickCodes = new Set();
    this.buttonPointers = new Map();
    this.fullscreenButton = null;
    this.destroyers = [];

    if (!this.enabled) return;

    root.classList.add('mobile-active');
    document.documentElement.classList.add('mobile-game');

    this.el = document.createElement('div');
    this.el.className = 'mobile-controls';
    this.el.setAttribute('aria-label', 'Touch-Steuerung');
    this.el.innerHTML = `
      <div class="mobile-controls__left">
        <div class="mobile-stick" data-stick aria-label="Virtueller Steuerstick">
          <div class="mobile-stick__ring"></div>
          <div class="mobile-stick__knob" data-stick-knob></div>
          <span class="mobile-stick__hint">FAHREN</span>
        </div>
      </div>

      <div class="mobile-controls__right">
        <div class="mobile-controls__utility">
          <button class="mobile-btn mobile-btn--utility" type="button" data-key="KeyC" data-tap data-camera-button aria-label="Kamera wechseln">BALL</button>
          <button class="mobile-btn mobile-btn--utility" type="button" data-key="KeyR" data-tap aria-label="Auto zurücksetzen">↻</button>
          <button class="mobile-btn mobile-btn--utility mobile-btn--fullscreen" type="button" data-fullscreen aria-label="Vollbild">⛶</button>
        </div>
        <div class="mobile-controls__roll">
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

    this.bindStick();
    this.bindButtons();
    this.bindLifecycle();
    this.updateFullscreenAvailability();
  }

  bindStick() {
    const onDown = (event) => {
      if (this.stickPointerId !== null) return;
      event.preventDefault();
      this.stickPointerId = event.pointerId;
      this.stickRect = this.stick.getBoundingClientRect();
      this.stick.setPointerCapture?.(event.pointerId);
      this.stick.classList.add('is-active');
      this.updateStick(event.clientX, event.clientY);
    };

    const onMove = (event) => {
      if (event.pointerId !== this.stickPointerId) return;
      event.preventDefault();
      this.updateStick(event.clientX, event.clientY);
    };

    const onUp = (event) => {
      if (event.pointerId !== this.stickPointerId) return;
      event.preventDefault();
      this.releaseStick();
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

  updateStick(clientX, clientY) {
    const rect = this.stickRect || this.stick.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.44);
    let dx = (clientX - cx) / radius;
    let dy = (clientY - cy) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }

    this.stickKnob.style.transform = `translate(${(dx * radius * 0.78).toFixed(1)}px, ${(dy * radius * 0.78).toFixed(1)}px)`;

    const nextCodes = new Set(resolveStickCodes(dx, dy));
    for (const code of STICK_CODES) {
      const wasDown = this.activeStickCodes.has(code);
      const shouldBeDown = nextCodes.has(code);
      if (wasDown === shouldBeDown) continue;
      this.input.setVirtualKey(code, shouldBeDown, 'mobile-stick');
    }
    this.activeStickCodes = nextCodes;
  }

  releaseStick() {
    for (const code of STICK_CODES) this.input.setVirtualKey(code, false, 'mobile-stick');
    this.activeStickCodes.clear();
    this.stickPointerId = null;
    this.stickRect = null;
    this.stick?.classList.remove('is-active');
    if (this.stickKnob) this.stickKnob.style.transform = 'translate(0px, 0px)';
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
          // Camera/reset are edge actions. Releasing in the same turn prevents
          // them from becoming a held key while keeping the pressed edge alive.
          this.input.setVirtualKey(code, false, `mobile-button-${event.pointerId}`);
        }
        if (code === 'Space') vibrate(10);
        else if (code === 'ShiftLeft') vibrate(5);
      };

      const onUp = (event) => {
        const held = this.buttonPointers.get(event.pointerId);
        if (!held || held.button !== button) return;
        event.preventDefault();
        this.buttonPointers.delete(event.pointerId);
        button.classList.remove('is-active');
        this.input.setVirtualKey(code, false, `mobile-button-${event.pointerId}`);
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
    // Keep the control available on mobile Safari as well. If the browser does
    // not expose the Fullscreen API, the helper still performs its best-effort
    // visual-viewport fallback instead of making the button mysteriously vanish.
    this.fullscreenButton.hidden = false;
    this.fullscreenButton.textContent = active ? '×' : '⛶';
    this.fullscreenButton.setAttribute(
      'aria-label',
      active ? 'Vollbild verlassen' : (supported ? 'Vollbild' : 'Browser-Vollbild versuchen')
    );
  }

  releaseAll() {
    this.releaseStick();
    for (const [pointerId, held] of this.buttonPointers) {
      held.button.classList.remove('is-active');
      this.input.setVirtualKey(held.code, false, `mobile-button-${pointerId}`);
    }
    this.buttonPointers.clear();
    this.input.clearVirtualKeys?.();
  }

  destroy() {
    this.releaseAll();
    for (const destroy of this.destroyers) destroy();
    this.destroyers.length = 0;
    this.el?.remove();
    this.root.classList.remove('mobile-active');
    document.documentElement.classList.remove('mobile-game');
  }
}
