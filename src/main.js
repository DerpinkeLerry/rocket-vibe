import { Game } from './game/Game.js';
import { LanClient } from './network/LanClient.js';
import { CAR_STYLES, DEFAULT_CAR_STYLE, normalizeCarStyle } from './shared/car-styles.js';
import { prefersMobileControls } from './game/MobileControls.js';
import { canRequestFullscreen, isFullscreenActive, requestGameFullscreen } from './game/Fullscreen.js';
import { canUseUltraHigh, getRememberedPerformanceMode, setPerformancePreference } from './game/PerformanceProfile.js';
import './style.css';

function installMobileBrowserGuards() {
  if (!prefersMobileControls()) return;

  // iOS Safari historically ignores parts of the viewport zoom policy in some
  // embedding modes. Blocking gesture events plus double-click zoom keeps the
  // game stable from the start screen onward. Text editing inside the name
  // field remains available.
  const preventGesture = (event) => event.preventDefault();
  const preventDoubleTapZoom = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
  };

  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
  document.addEventListener('dblclick', preventDoubleTapZoom, { passive: false });
}

function rememberedPlayerName() {
  try {
    return localStorage.getItem('rocket-vibe-player-name') || '';
  } catch {
    return '';
  }
}

function rememberedCarStyle() {
  try {
    return normalizeCarStyle(localStorage.getItem('rocket-vibe-car-style') || DEFAULT_CAR_STYLE);
  } catch {
    return DEFAULT_CAR_STYLE;
  }
}

function carPreviewSvg(styleId) {
  const shapes = {
    vortex: {
      body: 'M27 67 L39 45 L91 37 L132 42 L151 61 L149 79 L31 79 Z',
      glass: 'M78 42 L94 29 L123 31 L137 45 L113 47 Z',
      spoiler: 'M126 33 H153 V38 H127 Z'
    },
    titan: {
      body: 'M25 65 L34 43 L68 36 L134 38 L154 56 L153 80 L28 80 Z',
      glass: 'M70 39 L83 22 L123 22 L140 41 L122 46 L75 46 Z',
      spoiler: 'M126 27 H154 V34 H128 Z'
    },
    apex: {
      body: 'M23 67 L37 49 L92 41 L143 47 L157 63 L154 78 L25 78 Z',
      glass: 'M84 43 L101 32 L130 34 L143 48 L116 50 Z',
      spoiler: 'M127 36 H158 V41 H128 Z'
    },
    razor: {
      body: 'M20 68 L44 51 L112 39 L153 53 L160 67 L155 78 L23 78 Z',
      glass: 'M101 41 L115 31 L139 38 L149 52 L123 50 Z',
      spoiler: ''
    }
  };
  const shape = shapes[styleId] || shapes.vortex;
  return `
    <svg viewBox="0 0 180 100" role="img" aria-label="Fahrzeugvorschau">
      <defs>
        <linearGradient id="paint-${styleId}" x1="0" x2="1">
          <stop offset="0" stop-color="#2caeff"/>
          <stop offset="1" stop-color="#ff8a32"/>
        </linearGradient>
      </defs>
      <ellipse cx="90" cy="83" rx="70" ry="7" fill="rgba(0,0,0,.28)"/>
      <circle cx="50" cy="75" r="15" fill="#071019"/><circle cx="50" cy="75" r="7" fill="#a8c5d9"/>
      <circle cx="136" cy="75" r="15" fill="#071019"/><circle cx="136" cy="75" r="7" fill="#a8c5d9"/>
      <path d="${shape.body}" fill="url(#paint-${styleId})" stroke="rgba(255,255,255,.65)" stroke-width="2"/>
      <path d="${shape.glass}" fill="#14354d" stroke="rgba(173,230,255,.55)" stroke-width="2"/>
      ${shape.spoiler ? `<path d="${shape.spoiler}" fill="#101820"/>` : ''}
      <path d="M31 67 H48" stroke="#d9fbff" stroke-width="4" stroke-linecap="round"/>
    </svg>`;
}

function requestPlayerIdentity(root) {
  return new Promise((resolve) => {
    const selectedStyle = rememberedCarStyle();
    const selectedGraphics = getRememberedPerformanceMode();
    const ultraHighAvailable = canUseUltraHigh();
    const overlay = document.createElement('div');
    overlay.className = 'join-screen';
    overlay.innerHTML = `
      <form class="join-card join-card--wide">
        <div class="join-card__eyebrow">ROCKET VIBE</div>
        <h1>Fahrer & Auto</h1>
        <p>Wähle deinen Namen und eine Karosserie. Alle vier Autos haben dieselbe Hitbox und dieselben Fahrwerte.</p>
        ${prefersMobileControls() ? '<div class="join-card__mobile-note">📱 Touch-Steuerung aktiv · Querformat empfohlen</div>' : ''}
        <div class="join-card__fullscreen-row">
          <button class="join-card__fullscreen" type="button" data-start-fullscreen>⛶ VOLLBILD STARTEN</button>
          <span class="join-card__fullscreen-status" data-fullscreen-status aria-live="polite"></span>
        </div>
        <label for="player-name">Spielername</label>
        <input id="player-name" name="playerName" type="text" minlength="2" maxlength="16"
          autocomplete="nickname" enterkeyhint="go" spellcheck="false" placeholder="z. B. Goofy" required />

        <fieldset class="car-select">
          <legend>Auto auswählen</legend>
          <div class="car-select__grid">
            ${CAR_STYLES.map((style) => `
              <label class="car-choice${style.id === selectedStyle ? ' is-selected' : ''}" data-car-choice="${style.id}">
                <input type="radio" name="carStyle" value="${style.id}" ${style.id === selectedStyle ? 'checked' : ''} />
                <span class="car-choice__preview">${carPreviewSvg(style.id)}</span>
                <span class="car-choice__name">${style.name}</span>
                <span class="car-choice__desc">${style.description}</span>
              </label>`).join('')}
          </div>
        </fieldset>

        <fieldset class="graphics-select">
          <legend>Grafikqualität</legend>
          <div class="graphics-select__grid">
            <label class="graphics-choice${selectedGraphics === 'ultra-low' ? ' is-selected' : ''}" data-graphics-choice="ultra-low">
              <input type="radio" name="graphicsMode" value="ultra-low" ${selectedGraphics === 'ultra-low' ? 'checked' : ''} />
              <span class="graphics-choice__title">ULTRA LOW</span>
              <span class="graphics-choice__desc">Maximale FPS · schwache PCs / VM</span>
            </label>
            <label class="graphics-choice${selectedGraphics === 'normal' ? ' is-selected' : ''}" data-graphics-choice="normal">
              <input type="radio" name="graphicsMode" value="normal" ${selectedGraphics === 'normal' ? 'checked' : ''} />
              <span class="graphics-choice__title">NORMAL</span>
              <span class="graphics-choice__desc">Ausgewogen · Standard auf Smartphone</span>
            </label>
            <label class="graphics-choice graphics-choice--high${selectedGraphics === 'ultra-high' ? ' is-selected' : ''}${ultraHighAvailable ? '' : ' is-disabled'}" data-graphics-choice="ultra-high">
              <input type="radio" name="graphicsMode" value="ultra-high" ${selectedGraphics === 'ultra-high' ? 'checked' : ''} ${ultraHighAvailable ? '' : 'disabled'} />
              <span class="graphics-choice__title">ULTRA HIGH</span>
              <span class="graphics-choice__desc">${ultraHighAvailable ? 'PC only · Schatten, Reflexionen, Bloom, maximale Details' : 'Nur am PC verfügbar'}</span>
            </label>
          </div>
        </fieldset>

        <div class="join-card__error" aria-live="polite"></div>
        <button type="submit">MATCH BEITRETEN</button>
      </form>`;
    root.appendChild(overlay);

    const form = overlay.querySelector('form');
    const input = overlay.querySelector('#player-name');
    const error = overlay.querySelector('.join-card__error');
    const choices = [...overlay.querySelectorAll('[data-car-choice]')];
    const graphicsChoices = [...overlay.querySelectorAll('[data-graphics-choice]')];
    const fullscreenButton = overlay.querySelector('[data-start-fullscreen]');
    const fullscreenStatus = overlay.querySelector('[data-fullscreen-status]');
    const mobile = prefersMobileControls();

    const updateFullscreenUi = () => {
      const active = isFullscreenActive();
      const supported = canRequestFullscreen(document.documentElement);
      fullscreenButton.textContent = active ? '✓ VOLLBILD AKTIV' : '⛶ VOLLBILD STARTEN';
      fullscreenButton.classList.toggle('is-active', active);
      if (active) fullscreenStatus.textContent = 'Browser-Leisten ausgeblendet · Querformat wird bevorzugt';
      else if (!supported && mobile) fullscreenStatus.textContent = 'Falls dein Browser echtes Vollbild blockiert: Spiel zum Home-Bildschirm hinzufügen.';
      else fullscreenStatus.textContent = mobile ? 'Einmal tippen für die größte Spielfläche.' : '';
    };

    fullscreenButton.addEventListener('click', async () => {
      fullscreenStatus.textContent = 'Vollbild wird aktiviert …';
      const active = await requestGameFullscreen(document.documentElement);
      updateFullscreenUi();
      if (!active && mobile && !canRequestFullscreen(document.documentElement)) {
        fullscreenStatus.textContent = 'Dieser Browser erlaubt hier kein echtes Vollbild. Im Home-Bildschirm-Modus läuft das Spiel ohne Browserleisten.';
      }
    });
    document.addEventListener('fullscreenchange', updateFullscreenUi);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUi);
    updateFullscreenUi();

    input.value = rememberedPlayerName();
    if (!prefersMobileControls()) requestAnimationFrame(() => input.focus());

    form.addEventListener('change', (event) => {
      if (event.target?.name === 'carStyle') {
        for (const choice of choices) {
          const radio = choice.querySelector('input[type="radio"]');
          choice.classList.toggle('is-selected', Boolean(radio?.checked));
        }
      }
      if (event.target?.name === 'graphicsMode') {
        for (const choice of graphicsChoices) {
          const radio = choice.querySelector('input[type="radio"]');
          choice.classList.toggle('is-selected', Boolean(radio?.checked));
        }
      }
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      const formData = new FormData(form);
      const carStyle = normalizeCarStyle(formData.get('carStyle'));
      const graphicsMode = setPerformancePreference(formData.get('graphicsMode') || 'normal');
      if (name.length < 2) {
        error.textContent = 'Bitte mindestens 2 Zeichen eingeben.';
        input.focus();
        return;
      }
      try {
        localStorage.setItem('rocket-vibe-player-name', name);
        localStorage.setItem('rocket-vibe-car-style', carStyle);
      } catch {
        // Private browsing may disable storage; the match can still start.
      }
      document.removeEventListener('fullscreenchange', updateFullscreenUi);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenUi);
      overlay.remove();
      resolve({ playerName: name.slice(0, 16), carStyle, graphicsMode });
    });
  });
}

async function boot() {
  installMobileBrowserGuards();
  const app = document.querySelector('#app');
  const multiplayerEnabled = import.meta.env.MODE === 'lan' || import.meta.env.PROD;
  const identity = await requestPlayerIdentity(app);

  let network = null;
  let RAPIER = null;

  if (multiplayerEnabled) {
    network = new LanClient(identity.playerName, identity.carStyle);
    await network.connect();
    // No Rapier import in the browser for online play. Railway owns physics.
  } else {
    const rapierModule = await import('@dimforge/rapier3d-compat');
    RAPIER = rapierModule.default;
    await RAPIER.init();
  }

  const game = new Game(app, RAPIER, network, identity);
  game.start();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <pre style="white-space:pre-wrap;color:#fff;background:#120b12;padding:24px;min-height:100vh;margin:0">
Fehler beim Starten:\n\n${error?.stack ?? error}\n\nGo/LAN: "npm run lan".\nRailway baut das enthaltene Dockerfile automatisch.\nOffline: "npm run dev".
    </pre>`;
});
