import { LanClient } from './network/LanClient.js';
import { CAR_STYLES, DEFAULT_CAR_STYLE, normalizeCarStyle } from './shared/car-styles.js';
import { BOOST_STYLES, DEFAULT_BOOST_STYLE, normalizeBoostStyle } from './shared/boost-styles.js';
import { prefersMobileControls } from './game/MobileControls.js';
import { canRequestFullscreen, isFullscreenActive, requestGameFullscreen } from './game/Fullscreen.js';
import { canUseUltraHigh, getRememberedPerformanceMode, setPerformancePreference } from './game/PerformanceProfile.js';
import { applyServerPhysicsConfig } from './shared/game-tuning.js';
import { applyServerArenaConfig, applyServerHitboxConfig } from './shared/arena-tuning.js';
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

function rememberedBoostStyle() {
  try {
    return normalizeBoostStyle(localStorage.getItem('rocket-vibe-boost-style') || DEFAULT_BOOST_STYLE);
  } catch {
    return DEFAULT_BOOST_STYLE;
  }
}

function boostColor(value) {
  return `#${Number(value).toString(16).padStart(6, '0')}`;
}

function boostPreviewSvg(style) {
  const primary = boostColor(style.primary);
  const secondary = boostColor(style.secondary);
  const core = boostColor(style.core);
  const id = style.id;
  const particles = id === 'starfall'
    ? '<path d="M35 50 l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path d="M17 37 l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/><circle cx="48" cy="78" r="2"/>'
    : id === 'ion'
      ? '<rect x="9" y="43" width="46" height="5" rx="2.5"/><rect x="17" y="56" width="34" height="3" rx="1.5"/><circle cx="11" cy="66" r="3"/>'
      : id === 'plasma'
        ? '<circle cx="28" cy="50" r="10" fill="none" stroke-width="4"/><circle cx="14" cy="62" r="6" fill="none" stroke-width="3"/><circle cx="44" cy="70" r="4"/>'
        : '<circle cx="27" cy="49" r="7"/><circle cx="13" cy="59" r="4"/><circle cx="42" cy="67" r="3"/><circle cx="20" cy="76" r="2"/>';
  return `
    <svg viewBox="0 0 180 100" role="img" aria-label="${style.name} Boost Vorschau">
      <defs>
        <linearGradient id="boost-${id}" x1="1" x2="0">
          <stop offset="0" stop-color="${core}"/>
          <stop offset=".34" stop-color="${secondary}"/>
          <stop offset="1" stop-color="${primary}" stop-opacity="0"/>
        </linearGradient>
        <filter id="glow-${id}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <rect x="83" y="39" width="69" height="34" rx="9" fill="#101923" stroke="rgba(255,255,255,.22)"/>
      <circle cx="102" cy="73" r="12" fill="#05080c"/><circle cx="139" cy="73" r="12" fill="#05080c"/>
      <path d="M84 49 H34 L7 56 L34 63 H84 Z" fill="url(#boost-${id})" filter="url(#glow-${id})"/>
      <g fill="${secondary}" stroke="${core}" stroke-width="1" filter="url(#glow-${id})">${particles}</g>
      <rect x="80" y="48" width="14" height="5" rx="2.5" fill="${core}"/>
      <rect x="80" y="61" width="14" height="5" rx="2.5" fill="${core}"/>
    </svg>`;
}

function carPreviewSvg(styleId) {
  const shapes = {
    vortex: {
      body: 'M27 67 L39 45 L91 37 L132 42 L151 61 L149 79 L31 79 Z',
      glass: 'M78 42 L94 29 L123 31 L137 45 L113 47 Z',
      spoiler: 'M126 33 H153 V38 H127 Z'
    },
    apex: {
      body: 'M23 67 L37 49 L92 41 L143 47 L157 63 L154 78 L25 78 Z',
      glass: 'M84 43 L101 32 L130 34 L143 48 L116 50 Z',
      spoiler: 'M127 36 H158 V41 H128 Z'
    },
    razor: {
      body: 'M23 70 L29 49 L55 40 L136 40 L154 52 L158 70 L151 80 L29 80 Z',
      glass: 'M61 42 L72 27 L124 27 L140 42 L132 50 L65 50 Z',
      spoiler: 'M126 34 H153 V40 H127 Z'
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

const LOBBY_PHYSICS_SECTIONS = [
  {
    title: 'Welt & Solver',
    hint: 'Grundlegende Simulationswerte. Negative Gravitation zieht nach oben.',
    fields: [
      ['config.gravity', 'Gravitation', -40, 80, 0.5, 'm/s²'],
      ['config.solverSteps', 'Collision Solver Steps', 1, 8, 1, '']
    ]
  },
  {
    title: 'Arena-Geometrie',
    hint: 'Größe und Form des Spielfelds. Boostpads und Standard-Spawns bleiben an ihren bekannten Positionen.',
    fields: [
      ['config.arena.width', 'Arena-Breite', 110, 240, 1, 'm'],
      ['config.arena.length', 'Arena-Länge', 160, 360, 1, 'm'],
      ['config.arena.ceiling', 'Deckenhöhe', 14, 80, 0.5, 'm'],
      ['config.arena.wallHeight', 'Wandhöhe', 8, 80, 0.5, 'm'],
      ['config.arena.cornerRadius', 'Eckenradius', 4, 40, 0.5, 'm'],
      ['config.arena.rampRadius', 'Boden-Rampenradius', 0.5, 12, 0.1, 'm'],
      ['config.arena.ceilingRampRadius', 'Decken-Rampenradius', 0.5, 18, 0.1, 'm'],
      ['config.arena.goalWidth', 'Torbreite', 10, 70, 0.5, 'm'],
      ['config.arena.goalHeight', 'Torhöhe', 4, 30, 0.5, 'm'],
      ['config.arena.goalDepth', 'Tortiefe', 4, 35, 0.5, 'm'],
      ['config.arena.goalRampRadius', 'Tor-Rampenradius', 0.3, 10, 0.1, 'm'],
      ['config.arena.goalMouthRadius', 'Tor-Mundradius', 0.2, 10, 0.1, 'm']
    ]
  },
  {
    title: 'Auto · Hitbox & Geschwindigkeit',
    fields: [
      ['config.car.halfExtents.x', 'Hitbox halbe Breite', 0.35, 2.5, 0.01, 'm'],
      ['config.car.halfExtents.y', 'Hitbox halbe Höhe', 0.2, 1.5, 0.01, 'm'],
      ['config.car.halfExtents.z', 'Hitbox halbe Länge', 0.5, 3.5, 0.01, 'm'],
      ['config.car.mass', 'Masse', 50, 2500, 10, 'kg'],
      ['config.car.maxGroundSpeed', 'Max. Bodentempo', 7.2, 288, 0.1, 'km/h', 3.6],
      ['config.car.maxBoostSpeed', 'Max. Boosttempo', 7.2, 432, 0.1, 'km/h', 3.6],
      ['config.car.linearDamping', 'Linear Damping', 0, 10, 0.01, ''],
      ['config.car.angularDamping', 'Angular Damping', 0, 10, 0.01, ''],
      ['config.car.restitution', 'Auto-Bounce', 0, 1.5, 0.01, '']
    ]
  },
  {
    title: 'Auto · Antrieb, Boost & Grip',
    fields: [
      ['config.car.boostCapacity', 'Boost-Kapazität', 1, 100, 1, ''],
      ['config.car.boostConsumptionPerSecond', 'Boost-Verbrauch', 0, 200, 'any', '/s'],
      ['config.car.driveAcceleration', 'Beschleunigung vorwärts', 0, 80, 0.5, 'm/s²'],
      ['config.car.reverseAcceleration', 'Beschleunigung rückwärts', 0, 80, 0.5, 'm/s²'],
      ['config.car.brakeAcceleration', 'Bremskraft', 0, 120, 0.5, 'm/s²'],
      ['config.car.coastDeceleration', 'Ausroll-Bremse', 0, 40, 0.1, 'm/s²'],
      ['config.car.boostAcceleration', 'Boost-Beschleunigung Boden', 0, 100, 0.5, 'm/s²'],
      ['config.car.airBoostAcceleration', 'Boost-Beschleunigung Luft', 0, 140, 0.5, 'm/s²'],
      ['config.car.grip', 'Grip', 0, 80, 0.1, ''],
      ['config.car.driftGrip', 'Drift-Grip', 0, 40, 0.1, ''],
      ['config.car.steerRate', 'Lenkrate', 0, 12, 0.05, ''],
      ['config.car.driftSteerRate', 'Drift-Lenkrate', 0, 16, 0.05, ''],
      ['config.car.steerResponse', 'Lenk-Reaktion', 0, 60, 0.1, ''],
      ['config.car.driftSteerResponse', 'Drift-Lenk-Reaktion', 0, 80, 0.1, ''],
      ['config.car.groundAngularDamping', 'Boden-Rotationsdämpfung', 0, 50, 0.1, '']
    ]
  },
  {
    title: 'Auto · Aerials, Jump & Dodge',
    fields: [
      ['config.car.airPitchAcceleration', 'Air Pitch Acceleration', 0, 50, 0.1, ''],
      ['config.car.airYawAcceleration', 'Air Yaw Acceleration', 0, 50, 0.1, ''],
      ['config.car.airRollAcceleration', 'Air Roll Acceleration', 0, 50, 0.1, ''],
      ['config.car.airPitchRate', 'Air Pitch Rate', 0, 18, 0.05, 'rad/s'],
      ['config.car.airYawRate', 'Air Yaw Rate', 0, 18, 0.05, 'rad/s'],
      ['config.car.airRollRate', 'Air Roll Rate', 0, 18, 0.05, 'rad/s'],
      ['config.car.airControlResponse', 'Air-Control-Reaktion', 0, 50, 0.1, ''],
      ['config.car.airNeutralResponse', 'Air-Neutral-Stabilisierung', 0, 50, 0.1, ''],
      ['config.car.maxAirAngular', 'Max. Luftrotation', 0, 24, 0.1, 'rad/s'],
      ['config.car.jumpSpeed', 'Jump Speed', 0, 40, 0.1, 'm/s'],
      ['config.car.jumpHoldAcceleration', 'Jump Hold Acceleration', 0, 120, 0.5, 'm/s²'],
      ['config.car.jumpHoldDuration', 'Jump Hold Dauer', 0, 2, 0.01, 's'],
      ['config.car.doubleJumpSpeed', 'Double-Jump Speed', 0, 50, 0.1, 'm/s'],
      ['config.car.dodgeImpulse', 'Dodge Impuls', 0, 50, 0.1, ''],
      ['config.car.dodgeLift', 'Dodge Lift', -10, 20, 0.1, ''],
      ['config.car.dodgeAngularSpeed', 'Dodge Rotationsspeed', 0, 40, 'any', 'rad/s'],
      ['config.car.dodgeRotation', 'Dodge Gesamtrotation', 0, 25.1327, 'any', 'rad'],
      ['config.car.dodgeWindow', 'Dodge-Fenster', 0, 5, 0.01, 's'],
      ['config.car.dodgeDuration', 'Dodge-Dauer', 0.05, 3, 0.01, 's'],
      ['config.car.dodgeControlScale', 'Steuerung während Dodge', 0, 1, 0.01, ''],
      ['config.car.downAcceleration', 'Anpresskraft', 0, 100, 0.5, 'm/s²'],
      ['config.car.wallGravityCancel', 'Wall Gravity Cancel', 0, 3, 0.01, ''],
      ['config.car.surfaceAlignResponse', 'Surface Align Response', 0, 60, 0.1, '']
    ]
  },
  {
    title: 'Ball',
    fields: [
      ['config.ball.radius', 'Radius', 0.5, 6, 0.05, 'm'],
      ['config.ball.mass', 'Masse', 1, 500, 1, 'kg'],
      ['config.ball.restitution', 'Bounce / Restitution', 0, 1.5, 0.01, ''],
      ['config.ball.friction', 'Reibung', 0, 2, 0.01, ''],
      ['config.ball.rollingResistance', 'Rollwiderstand', 0, 4, 0.01, ''],
      ['config.ball.linearDamping', 'Linear Damping', 0, 5, 0.005, ''],
      ['config.ball.angularDamping', 'Angular Damping', 0, 5, 0.005, ''],
      ['config.ball.maxSpeed', 'Max. Balltempo', 7.2, 576, 0.1, 'km/h', 3.6],
      ['config.ball.maxAngularSpeed', 'Max. Ballrotation', 0, 120, 0.5, 'rad/s'],
      ['config.ball.carHitPower', 'Car Hit Power', 0, 3, 0.01, ''],
      ['config.ball.carHitLift', 'Car Hit Lift', -1, 2, 0.01, ''],
      ['config.ball.carHitLiftBase', 'Car Hit Lift Base', -5, 10, 0.05, ''],
      ['config.ball.spawnY', 'Spawn-Höhe', 0.55, 20, 0.05, 'm']
    ]
  },
  {
    title: 'Boost-Pads',
    fields: [
      ['config.boostPads.fullAmount', '100er Pad · Menge', 0, 100, 1, 'Boost'],
      ['config.boostPads.smallAmount', 'Kleines Pad · Menge', 0, 100, 1, 'Boost'],
      ['config.boostPads.smallRespawnSeconds', 'Kleines Pad · Respawn', 0.1, 60, 0.1, 's'],
      ['config.boostPads.fullRespawnSeconds', '100er Pad · Respawn', 0.1, 60, 0.1, 's']
    ]
  },
  {
    title: 'Demolition-Physik',
    fields: [
      ['config.demolition.minSpeed', 'Mindesttempo', 0, 432, 1, 'km/h', 3.6],
      ['config.demolition.respawnSeconds', 'Respawn-Dauer', 0.25, 20, 0.05, 's'],
      ['config.demolition.respawnBoost', 'Boost nach Respawn', 0, 100, 1, ''],
      ['config.demolition.respawnImmunitySeconds', 'Spawn-Immunität', 0, 10, 0.05, 's'],
      ['config.demolition.frontDot', 'Fronttreffer-Schwelle', -1, 1, 0.01, 'dot'],
      ['config.demolition.motionDot', 'Bewegungsrichtungs-Schwelle', -1, 1, 0.01, 'dot'],
      ['config.demolition.minClosingSpeed', 'Min. Closing Speed', 0, 40, 0.05, 'm/s'],
      ['config.demolition.speedTieEpsilon', 'Speed-Tie-Toleranz', 0, 20, 0.01, 'm/s']
    ]
  }
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function writePath(object, path, value) {
  const parts = path.split('.');
  let target = object;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]] || typeof target[parts[i]] !== 'object') target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts.at(-1)] = value;
}

function cloneSettings(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

async function fetchLobbyJSON(url, options) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status text below is more useful than a JSON parse error.
  }
  if (!response.ok) throw new Error(payload?.error || `Serverfehler ${response.status}`);
  return payload;
}

function formatLobbyClock(seconds) {
  if (!seconds) return '∞';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function lobbyRuleSummary(lobby) {
  const rules = lobby?.rules || {};
  const config = lobby?.config || {};
  const score = Number(rules.scoreLimit) > 0 ? `${rules.scoreLimit} Tore` : 'kein Scorelimit';
  const time = Number(rules.matchSeconds) > 0 ? formatLobbyClock(Number(rules.matchSeconds)) : 'ohne Uhr';
  const gravity = Number(config.gravity);
  const gravityText = Number.isFinite(gravity) ? `${gravity.toFixed(1)} m/s²` : 'Standard-G';
  return `${time} · ${score} · ${config?.demolition?.enabled ? 'Demos an' : 'Demos aus'} · G ${gravityText}`;
}

function renderNumericLobbyField(defaults, field) {
  const [path, label, min, max, step, unit, scale = 1] = field;
  const raw = Number(readPath(defaults, path));
  const value = Number.isFinite(raw) ? raw * scale : 0;
  return `
    <label class="lobby-setting">
      <span>${escapeHtml(label)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</span>
      <input type="number" data-lobby-setting="${path}" data-scale="${scale}" min="${min}" max="${max}" step="${step}" value="${Number(value.toFixed(5))}" />
    </label>`;
}

function lobbyCreationMarkup(defaults) {
  const rules = defaults.rules || {};
  const config = defaults.config || {};
  return `
    <form class="lobby-create-card" data-lobby-create-form novalidate>
      <div class="lobby-create-card__top">
        <button class="lobby-back" type="button" data-lobby-back>← LOBBIES</button>
        <div>
          <div class="join-card__eyebrow">LOBBY ERSTELLEN</div>
          <h1>Regeln & Physics</h1>
        </div>
      </div>
      <p class="lobby-create-card__intro">Alles hier erzeugt eine eigene serverautoritative Match-Instanz. Die Werte gelten nur in dieser Lobby.</p>

      <div class="lobby-preset-row" role="group" aria-label="Physics-Presets">
        <button type="button" data-lobby-preset="standard">STANDARD</button>
        <button type="button" data-lobby-preset="moon">MOONBALL</button>
        <button type="button" data-lobby-preset="pinball">PINBALL</button>
        <button type="button" data-lobby-preset="chaos">CHAOS</button>
      </div>

      <section class="lobby-settings-section lobby-settings-section--open">
        <h2>Lobby & Spielregeln</h2>
        <div class="lobby-settings-grid">
          <label class="lobby-setting lobby-setting--wide"><span>Lobby-Name</span><input name="lobbyName" type="text" maxlength="32" value="${escapeHtml(defaults.name || 'Neue Lobby')}" required /></label>
          <label class="lobby-setting"><span>Max. Spieler <small>1–4</small></span><input type="number" data-lobby-setting="config.maxPlayers" min="1" max="4" step="1" value="${Number(config.maxPlayers) || 4}" /></label>
          <label class="lobby-setting"><span>Matchdauer <small>Sekunden · 0 = ∞</small></span><input type="number" data-lobby-setting="rules.matchSeconds" min="0" max="3600" step="15" value="${Number(rules.matchSeconds) || 0}" /></label>
          <label class="lobby-setting"><span>Scorelimit <small>0 = ∞</small></span><input type="number" data-lobby-setting="rules.scoreLimit" min="0" max="99" step="1" value="${Number(rules.scoreLimit) || 0}" /></label>
          <label class="lobby-setting"><span>Kickoff Countdown <small>Sekunden</small></span><input type="number" data-lobby-setting="rules.kickoffSeconds" min="0" max="10" step="1" value="${Number(rules.kickoffSeconds) || 0}" /></label>
          <label class="lobby-setting"><span>Goal Replay <small>Sekunden</small></span><input type="number" data-lobby-setting="rules.goalReplaySeconds" min="0" max="20" step="0.1" value="${Number(rules.goalReplaySeconds) || 0}" /></label>
          <label class="lobby-setting"><span>Goal Celebration <small>Sekunden</small></span><input type="number" data-lobby-setting="rules.goalCelebrationSeconds" min="0" max="10" step="0.05" value="${Number(rules.goalCelebrationSeconds) || 0}" /></label>
        </div>
        <div class="lobby-toggle-grid">
          <label><input type="checkbox" data-lobby-setting-bool="rules.overtimeOnTie" ${rules.overtimeOnTie ? 'checked' : ''}/><span>Overtime bei Gleichstand</span></label>
          <label><input type="checkbox" data-lobby-setting-bool="rules.goalReplayEnabled" ${rules.goalReplayEnabled ? 'checked' : ''}/><span>Goal Replays aktiv</span></label>
          <label><input type="checkbox" data-lobby-setting-bool="rules.allowCarReset" ${rules.allowCarReset ? 'checked' : ''}/><span>Auto-Reset mit R erlauben</span></label>
          <label><input type="checkbox" data-lobby-setting-bool="rules.allowBallReset" ${rules.allowBallReset ? 'checked' : ''}/><span>Ball-Reset mit B erlauben</span></label>
          <label><input type="checkbox" data-lobby-setting-bool="config.demolition.enabled" ${config?.demolition?.enabled ? 'checked' : ''}/><span>Demolitions aktiv</span></label>
        </div>
      </section>

      ${LOBBY_PHYSICS_SECTIONS.map((section, index) => `
        <details class="lobby-settings-section" ${index === 0 ? 'open' : ''}>
          <summary><span>${escapeHtml(section.title)}</span><small>${escapeHtml(section.hint || 'Werte frei anpassen')}</small></summary>
          <div class="lobby-settings-grid">
            ${section.fields.map((field) => renderNumericLobbyField(defaults, field)).join('')}
          </div>
        </details>`).join('')}

      <div class="join-card__error" data-lobby-create-error aria-live="polite"></div>
      <button class="lobby-create-submit" type="submit">LOBBY ERSTELLEN & BEITRETEN</button>
    </form>`;
}

function applyLobbyPreset(form, defaults, preset) {
  const values = cloneSettings(defaults);
  if (preset === 'moon') {
    values.config.gravity = 6;
    values.config.car.jumpSpeed = 14;
    values.config.car.airBoostAcceleration = 48;
    values.config.ball.mass = 18;
    values.config.ball.restitution = 0.82;
  } else if (preset === 'pinball') {
    values.config.ball.restitution = 1.18;
    values.config.ball.carHitPower = 0.85;
    values.config.ball.carHitLift = 0.22;
    values.config.ball.maxSpeed = 100;
    values.config.car.maxBoostSpeed = 46;
  } else if (preset === 'chaos') {
    values.config.gravity = 12;
    values.config.car.boostConsumptionPerSecond = 0;
    values.config.car.maxGroundSpeed = 30;
    values.config.car.maxBoostSpeed = 55;
    values.config.car.jumpSpeed = 17;
    values.config.ball.radius = 3.1;
    values.config.ball.restitution = 1.05;
    values.config.demolition.minSpeed = 40 / 3.6;
    values.rules.kickoffSeconds = 1;
  }
  for (const input of form.querySelectorAll('[data-lobby-setting]')) {
    const scale = Number(input.dataset.scale) || 1;
    const raw = Number(readPath(values, input.dataset.lobbySetting));
    if (Number.isFinite(raw)) input.value = String(Number((raw * scale).toFixed(5)));
  }
  for (const input of form.querySelectorAll('[data-lobby-setting-bool]')) {
    input.checked = Boolean(readPath(values, input.dataset.lobbySettingBool));
  }
}

function collectLobbySettings(form, defaults) {
  const request = cloneSettings(defaults);
  request.name = form.elements.lobbyName.value.trim().replace(/\s+/g, ' ').slice(0, 32) || 'Rocket Lobby';
  for (const input of form.querySelectorAll('[data-lobby-setting]')) {
    const scale = Number(input.dataset.scale) || 1;
    const value = Number(input.value);
    if (Number.isFinite(value)) writePath(request, input.dataset.lobbySetting, value / scale);
  }
  for (const input of form.querySelectorAll('[data-lobby-setting-bool]')) {
    writePath(request, input.dataset.lobbySettingBool, Boolean(input.checked));
  }
  return request;
}

function validateLobbyCreationForm(form, error) {
  const invalid = Array.from(form.querySelectorAll('input')).find((input) => !input.checkValidity());
  if (!invalid) return true;

  const details = invalid.closest('details');
  if (details) details.open = true;
  const label = invalid.closest('label')?.querySelector('span')?.childNodes?.[0]?.textContent?.trim() || 'Lobby-Einstellung';
  const constraints = [];
  if (invalid.min !== '') constraints.push(`min. ${invalid.min}`);
  if (invalid.max !== '') constraints.push(`max. ${invalid.max}`);
  if (invalid.step && invalid.step !== 'any') constraints.push(`Schritt ${invalid.step}`);
  error.textContent = `Bitte prüfe „${label}“${constraints.length ? ` (${constraints.join(', ')})` : ''}.`;
  invalid.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  invalid.focus?.({ preventScroll: true });
  return false;
}

function requestLobby(root, notice = '') {
  return new Promise(async (resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.className = 'lobby-screen';
    root.appendChild(overlay);
    let defaults;
    let refreshTimer = null;
    let finished = false;

    const finish = (lobby) => {
      if (finished) return;
      finished = true;
      if (refreshTimer) clearInterval(refreshTimer);
      overlay.remove();
      resolve(lobby);
    };

    const showBrowser = async (message = notice) => {
      overlay.innerHTML = `
        <div class="lobby-browser">
          <header class="lobby-browser__header">
            <div><div class="join-card__eyebrow">ROCKET VIBE</div><h1>LOBBIES</h1></div>
            <button type="button" class="lobby-create-button" data-create-lobby>+ LOBBY ERSTELLEN</button>
          </header>
          ${message ? `<div class="lobby-browser__notice">${escapeHtml(message)}</div>` : ''}
          <div class="lobby-list" data-lobby-list><div class="lobby-list__loading">Lobbies werden geladen …</div></div>
        </div>`;
      overlay.querySelector('[data-create-lobby]').addEventListener('click', showCreation);
      await refreshList();
    };

    const refreshList = async () => {
      const list = overlay.querySelector('[data-lobby-list]');
      if (!list || finished) return;
      try {
        const payload = await fetchLobbyJSON('/api/lobbies');
        const lobbies = Array.isArray(payload?.lobbies) ? payload.lobbies : [];
        if (lobbies.length === 0) {
          list.innerHTML = `<div class="lobby-list__empty"><strong>Noch keine Lobby.</strong><span>Erstelle die erste und stell Regeln oder Physics-Mutatoren nach Wunsch ein.</span></div>`;
          return;
        }
        list.innerHTML = lobbies.map((lobby) => {
          const full = Number(lobby.players) >= Number(lobby.maxPlayers);
          return `
            <button type="button" class="lobby-row${full ? ' is-full' : ''}" data-join-lobby="${escapeHtml(lobby.id)}" ${full ? 'disabled' : ''}>
              <span class="lobby-row__main"><strong>${escapeHtml(lobby.name)}</strong><small>${escapeHtml(lobbyRuleSummary(lobby))}</small></span>
              <span class="lobby-row__players"><b>${Number(lobby.players) || 0}/${Number(lobby.maxPlayers) || 4}</b><small>${full ? 'VOLL' : 'BEITRETEN'}</small></span>
            </button>`;
        }).join('');
        for (const button of list.querySelectorAll('[data-join-lobby]')) {
          button.addEventListener('click', () => {
            const lobby = lobbies.find((entry) => entry.id === button.dataset.joinLobby);
            if (lobby) finish(lobby);
          });
        }
      } catch (error) {
        list.innerHTML = `<div class="lobby-list__error">Lobby-Liste konnte nicht geladen werden: ${escapeHtml(error.message)}</div>`;
      }
    };

    const showCreation = () => {
      if (refreshTimer) clearInterval(refreshTimer);
      overlay.innerHTML = lobbyCreationMarkup(defaults);
      const form = overlay.querySelector('[data-lobby-create-form]');
      const error = overlay.querySelector('[data-lobby-create-error]');
      overlay.querySelector('[data-lobby-back]').addEventListener('click', async () => {
        await showBrowser('');
        refreshTimer = setInterval(refreshList, 2500);
      });
      for (const button of overlay.querySelectorAll('[data-lobby-preset]')) {
        button.addEventListener('click', () => applyLobbyPreset(form, defaults, button.dataset.lobbyPreset));
      }
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.textContent = '';
        if (!validateLobbyCreationForm(form, error)) return;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'LOBBY WIRD ERSTELLT …';
        try {
          const request = collectLobbySettings(form, defaults);
          const created = await fetchLobbyJSON('/api/lobbies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
          });
          finish(created);
        } catch (creationError) {
          error.textContent = creationError.message;
          submit.disabled = false;
          submit.textContent = 'LOBBY ERSTELLEN & BEITRETEN';
        }
      });
    };

    try {
      defaults = await fetchLobbyJSON('/api/lobbies/defaults');
      await showBrowser();
      refreshTimer = setInterval(refreshList, 2500);
    } catch (error) {
      overlay.remove();
      reject(error);
    }
  });
}

function requestPlayerIdentity(root, lobby = null) {
  return new Promise((resolve) => {
    const selectedStyle = rememberedCarStyle();
    const selectedBoostStyle = rememberedBoostStyle();
    const selectedGraphics = getRememberedPerformanceMode();
    const ultraHighAvailable = canUseUltraHigh();
    const mobileGraphics = prefersMobileControls();
    const overlay = document.createElement('div');
    overlay.className = 'join-screen';
    overlay.innerHTML = `
      <form class="join-card join-card--wide">
        <div class="join-card__eyebrow">ROCKET VIBE</div>
        <h1>${lobby ? escapeHtml(lobby.name) : 'Fahrer & Auto'}</h1>
        <p>${lobby ? `Du trittst <strong>${escapeHtml(lobby.name)}</strong> bei (${Number(lobby.players) || 0}/${Number(lobby.maxPlayers) || 4}). Jetzt wie gewohnt Name, Auto, Boost und Grafik auswählen.` : 'Wähle deinen Namen und eine Karosserie. Alle drei Autos haben dieselbe Hitbox und dieselben Fahrwerte.'}</p>
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
          <div class="car-select__note">OCTANE, DOMINUS und FENNEC nutzen in ULTRA HIGH die echten GLB-Modelle. NORMAL und ULTRA LOW verwenden automatisch die leichten Fallback-Karosserien mit identischer Hitbox. Asset-Credits: <code>THIRD_PARTY_ASSETS.md</code>.</div>
        </fieldset>

        <fieldset class="boost-select">
          <legend>Boost-Effekt auswählen</legend>
          <div class="boost-select__grid">
            ${BOOST_STYLES.map((style) => `
              <label class="boost-choice${style.id === selectedBoostStyle ? ' is-selected' : ''}" data-boost-choice="${style.id}">
                <input type="radio" name="boostStyle" value="${style.id}" ${style.id === selectedBoostStyle ? 'checked' : ''} />
                <span class="boost-choice__preview">${boostPreviewSvg(style)}</span>
                <span class="boost-choice__name">${style.name}</span>
                <span class="boost-choice__desc">${style.description}</span>
              </label>`).join('')}
          </div>
          <div class="boost-select__note">Die volle Partikelspur wird in ULTRA HIGH gerendert; die Boost-Physik ist bei allen Effekten identisch.</div>
        </fieldset>

        <fieldset class="graphics-select">
          <legend>Grafikqualität</legend>
          <div class="graphics-select__grid">
            <label class="graphics-choice${selectedGraphics === 'ultra-low' ? ' is-selected' : ''}" data-graphics-choice="ultra-low">
              <input type="radio" name="graphicsMode" value="ultra-low" ${selectedGraphics === 'ultra-low' ? 'checked' : ''} />
              <span class="graphics-choice__title">ULTRA LOW</span>
              <span class="graphics-choice__desc">Maximale FPS · schwache Geräte / VM</span>
            </label>
            <label class="graphics-choice${selectedGraphics === 'normal' ? ' is-selected' : ''}" data-graphics-choice="normal">
              <input type="radio" name="graphicsMode" value="normal" ${selectedGraphics === 'normal' ? 'checked' : ''} />
              <span class="graphics-choice__title">NORMAL</span>
              <span class="graphics-choice__desc">Ausgewogen · empfohlen für Smartphone</span>
            </label>
            <label class="graphics-choice graphics-choice--high${selectedGraphics === 'ultra-high' ? ' is-selected' : ''}${ultraHighAvailable ? '' : ' is-disabled'}" data-graphics-choice="ultra-high">
              <input type="radio" name="graphicsMode" value="ultra-high" ${selectedGraphics === 'ultra-high' ? 'checked' : ''} ${ultraHighAvailable ? '' : 'disabled'} />
              <span class="graphics-choice__title">ULTRA HIGH</span>
              <span class="graphics-choice__desc">${ultraHighAvailable ? (mobileGraphics ? 'Scharfe Feldtexturen, Schatten und Detailmaterialien · hoher Akkuverbrauch' : 'Scharfe Feld-/Wandtexturen, Detailmaterialien und Schatten') : 'Nicht verfügbar'}</span>
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
    const boostChoices = [...overlay.querySelectorAll('[data-boost-choice]')];
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
      if (event.target?.name === 'boostStyle') {
        for (const choice of boostChoices) {
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
      const boostStyle = normalizeBoostStyle(formData.get('boostStyle'));
      const graphicsMode = setPerformancePreference(formData.get('graphicsMode') || 'normal');
      if (name.length < 2) {
        error.textContent = 'Bitte mindestens 2 Zeichen eingeben.';
        input.focus();
        return;
      }
      try {
        localStorage.setItem('rocket-vibe-player-name', name);
        localStorage.setItem('rocket-vibe-car-style', carStyle);
        localStorage.setItem('rocket-vibe-boost-style', boostStyle);
      } catch {
        // Private browsing may disable storage; the match can still start.
      }
      document.removeEventListener('fullscreenchange', updateFullscreenUi);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenUi);
      overlay.remove();
      resolve({ playerName: name.slice(0, 16), carStyle, boostStyle, graphicsMode });
    });
  });
}

async function boot() {
  installMobileBrowserGuards();
  const app = document.querySelector('#app');
  const multiplayerEnabled = import.meta.env.MODE === 'lan' || import.meta.env.PROD;

  let network = null;
  let RAPIER = null;
  let identity = null;

  if (multiplayerEnabled) {
    let lobbyNotice = '';
    while (!network) {
      const lobby = await requestLobby(app, lobbyNotice);
      identity = await requestPlayerIdentity(app, lobby);
      const candidate = new LanClient(identity.playerName, identity.carStyle, identity.boostStyle, lobby.id);
      try {
        await candidate.connect();
        network = candidate;
      } catch (error) {
        candidate.stopPing?.();
        candidate.socket?.close?.();
        lobbyNotice = `Beitritt fehlgeschlagen: ${error.message}`;
      }
    }
    applyServerPhysicsConfig(network.matchConfig);
    applyServerArenaConfig(network.matchConfig);
    applyServerHitboxConfig(network.matchConfig);
    // No Rapier import in the browser for online play. Railway owns physics.
  } else {
    identity = await requestPlayerIdentity(app);
    const rapierModule = await import('@dimforge/rapier3d-compat');
    RAPIER = rapierModule.default;
    await RAPIER.init();
  }

  // Load the arena/game only after lobby physics arrived. Arena.js derives
  // geometry constants at module evaluation time, so this keeps rendering and
  // authoritative server collision dimensions in lockstep.
  const { Game } = await import('./game/Game.js');
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
