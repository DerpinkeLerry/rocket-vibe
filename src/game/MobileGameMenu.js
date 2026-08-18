import {
  CAMERA_SETTING_FIELDS,
  DEFAULT_CAMERA_SETTINGS,
  normalizeCameraSettings,
  saveCameraSettings
} from './CameraSettings.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatValue(field, value) {
  const decimals = String(field.step).includes('.') ? String(field.step).split('.')[1].length : 0;
  return `${Number(value).toFixed(decimals)}${field.unit ? ` ${field.unit}` : ''}`;
}

export class MobileGameMenu {
  constructor(root, options = {}) {
    this.root = root;
    this.enabled = Boolean(options.enabled);
    this.accountName = String(options.accountName || 'Gast');
    this.getCameraSettings = options.getCameraSettings;
    this.onCameraPreview = options.onCameraPreview;
    this.onCameraMode = options.onCameraMode;
    this.onOpenChange = options.onOpenChange;
    this.onLeave = options.onLeave;
    this.open = false;
    this.savedSettings = normalizeCameraSettings(this.getCameraSettings?.());
    this.draftSettings = { ...this.savedSettings };
    if (!this.enabled) return;

    this.el = document.createElement('div');
    this.el.className = 'mobile-game-menu';
    this.el.innerHTML = `
      <button class="mobile-game-menu__trigger" type="button" data-game-menu-open aria-label="Match-Menü öffnen" aria-expanded="false">☰</button>
      <div class="mobile-game-menu__overlay" data-game-menu-overlay hidden>
        <button class="mobile-game-menu__backdrop" type="button" data-game-menu-close aria-label="Menü schließen"></button>
        <section class="mobile-game-menu__sheet" role="dialog" aria-modal="true" aria-label="Match-Menü">
          <header class="mobile-game-menu__header">
            <div><span>ROCKET VIBE</span><strong>Match-Menü</strong></div>
            <button type="button" data-game-menu-close aria-label="Menü schließen">×</button>
          </header>
          <div class="mobile-game-menu__account">Angemeldet als <strong>${escapeHtml(this.accountName)}</strong></div>
          <div class="mobile-game-menu__home" data-menu-home>
            <button class="mobile-game-menu__primary" type="button" data-camera-settings>KAMERA-EINSTELLUNGEN</button>
            <button class="mobile-game-menu__secondary" type="button" data-game-menu-close>WEITERSPIELEN</button>
            <button class="mobile-game-menu__danger" type="button" data-leave-match>MATCH VERLASSEN</button>
          </div>
          <form class="mobile-game-menu__camera" data-camera-form hidden>
            <div class="mobile-game-menu__subhead">
              <button type="button" data-camera-back>← ZURÜCK</button>
              <strong>Kamera</strong>
            </div>
            <fieldset class="mobile-game-menu__modes">
              <legend>Startmodus</legend>
              <div>
                <button type="button" data-camera-mode="BALL">BALL CAM</button>
                <button type="button" data-camera-mode="CAR">CAR CAM</button>
              </div>
            </fieldset>
            <div class="mobile-game-menu__settings">
              ${CAMERA_SETTING_FIELDS.map((field) => `
                <label class="mobile-camera-setting">
                  <span><strong>${escapeHtml(field.label)}</strong><small>${escapeHtml(field.hint)}</small></span>
                  <output data-camera-output="${field.key}">${escapeHtml(formatValue(field, this.draftSettings[field.key]))}</output>
                  <input type="range" name="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${this.draftSettings[field.key]}" />
                </label>`).join('')}
              <label class="mobile-camera-toggle">
                <span><strong>Sichtschutz</strong><small>Verdeckende Arena-Objekte ausblenden</small></span>
                <input type="checkbox" name="occlusion" ${this.draftSettings.occlusion ? 'checked' : ''} />
              </label>
            </div>
            <div class="mobile-game-menu__savebar">
              <button type="button" data-camera-reset>STANDARD</button>
              <button type="submit">SPEICHERN</button>
            </div>
            <div class="mobile-game-menu__status" data-camera-status aria-live="polite"></div>
          </form>
        </section>
      </div>`;
    root.appendChild(this.el);

    this.trigger = this.el.querySelector('[data-game-menu-open]');
    this.overlay = this.el.querySelector('[data-game-menu-overlay]');
    this.home = this.el.querySelector('[data-menu-home]');
    this.cameraForm = this.el.querySelector('[data-camera-form]');
    this.status = this.el.querySelector('[data-camera-status]');
    this.trigger.addEventListener('click', () => this.show());
    for (const button of this.el.querySelectorAll('[data-game-menu-close]')) {
      button.addEventListener('click', () => this.hide());
    }
    this.el.querySelector('[data-camera-settings]').addEventListener('click', () => this.showCamera());
    this.el.querySelector('[data-camera-back]').addEventListener('click', () => this.showHome(true));
    this.el.querySelector('[data-camera-reset]').addEventListener('click', () => this.resetCamera());
    this.el.querySelector('[data-leave-match]').addEventListener('click', () => this.leaveMatch());
    this.cameraForm.addEventListener('input', (event) => this.updateDraft(event.target));
    this.cameraForm.addEventListener('submit', (event) => this.saveCamera(event));
    for (const button of this.cameraForm.querySelectorAll('[data-camera-mode]')) {
      button.addEventListener('click', () => this.setDraftMode(button.dataset.cameraMode));
    }
    this.renderCameraForm();
  }

  show() {
    if (!this.enabled || this.open) return;
    this.open = true;
    this.savedSettings = normalizeCameraSettings(this.getCameraSettings?.());
    this.draftSettings = { ...this.savedSettings };
    this.renderCameraForm();
    this.showHome(false);
    this.overlay.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.root.classList.add('game-menu-open');
    this.onOpenChange?.(true);
  }

  hide() {
    if (!this.open) return;
    if (!this.cameraForm.hidden) this.onCameraPreview?.(this.savedSettings);
    this.open = false;
    this.overlay.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.root.classList.remove('game-menu-open');
    this.onOpenChange?.(false);
  }

  showHome(restorePreview = false) {
    if (restorePreview) {
      this.draftSettings = { ...this.savedSettings };
      this.onCameraPreview?.(this.savedSettings);
    }
    this.home.hidden = false;
    this.cameraForm.hidden = true;
    this.status.textContent = '';
  }

  showCamera() {
    this.savedSettings = normalizeCameraSettings(this.getCameraSettings?.());
    this.draftSettings = { ...this.savedSettings };
    this.renderCameraForm();
    this.home.hidden = true;
    this.cameraForm.hidden = false;
    this.cameraForm.querySelector('input')?.focus?.({ preventScroll: true });
  }

  updateDraft(target) {
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name === 'occlusion') this.draftSettings.occlusion = target.checked;
    else if (target.type === 'range') this.draftSettings[target.name] = Number(target.value);
    this.draftSettings = normalizeCameraSettings(this.draftSettings);
    this.renderOutputs();
    this.onCameraPreview?.(this.draftSettings);
  }

  setDraftMode(mode) {
    this.draftSettings.mode = mode === 'CAR' ? 'CAR' : 'BALL';
    this.renderModeButtons();
    this.onCameraMode?.(this.draftSettings.mode);
    this.onCameraPreview?.(this.draftSettings);
  }

  resetCamera() {
    this.draftSettings = { ...DEFAULT_CAMERA_SETTINGS };
    this.renderCameraForm();
    this.onCameraMode?.(this.draftSettings.mode);
    this.onCameraPreview?.(this.draftSettings);
    this.status.textContent = 'Standardwerte als Vorschau geladen.';
  }

  saveCamera(event) {
    event.preventDefault();
    this.savedSettings = saveCameraSettings(this.accountName, this.draftSettings);
    this.draftSettings = { ...this.savedSettings };
    this.onCameraPreview?.(this.savedSettings);
    this.onCameraMode?.(this.savedSettings.mode);
    this.status.textContent = 'Kameraeinstellungen gespeichert.';
  }

  renderCameraForm() {
    if (!this.cameraForm) return;
    for (const field of CAMERA_SETTING_FIELDS) {
      const input = this.cameraForm.elements[field.key];
      if (input) input.value = String(this.draftSettings[field.key]);
    }
    if (this.cameraForm.elements.occlusion) this.cameraForm.elements.occlusion.checked = this.draftSettings.occlusion;
    this.renderOutputs();
    this.renderModeButtons();
  }

  renderOutputs() {
    for (const field of CAMERA_SETTING_FIELDS) {
      const output = this.cameraForm?.querySelector(`[data-camera-output="${field.key}"]`);
      if (output) output.textContent = formatValue(field, this.draftSettings[field.key]);
    }
  }

  renderModeButtons() {
    for (const button of this.cameraForm?.querySelectorAll('[data-camera-mode]') || []) {
      const selected = button.dataset.cameraMode === this.draftSettings.mode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  leaveMatch() {
    if (!window.confirm('Match wirklich verlassen?')) return;
    this.onLeave?.();
  }

  destroy() {
    this.root.classList.remove('game-menu-open');
    this.el?.remove();
  }
}
