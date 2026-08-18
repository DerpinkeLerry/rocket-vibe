export const CAMERA_SETTINGS_STORAGE_PREFIX = 'rocket-vibe-camera-settings-v2';

export const DEFAULT_CAMERA_SETTINGS = Object.freeze({
  mode: 'BALL',
  fov: 72,
  distance: 2.95,
  height: 1.17,
  lookHeight: 0,
  positionStiffness: 14.5,
  lookStiffness: 13.5,
  rotationStiffness: 11.5,
  speedDistance: 0.4,
  speedHeight: 0.12,
  highBallAssist: 1,
  dynamicFov: 1,
  occlusion: true
});

export const CAMERA_SETTING_FIELDS = Object.freeze([
  { key: 'fov', label: 'Sichtfeld', hint: 'Breiter oder enger Bildausschnitt', min: 55, max: 100, step: 1, unit: '°' },
  { key: 'distance', label: 'Abstand', hint: 'Entfernung hinter dem Auto', min: 1.5, max: 13, step: 0.05, unit: 'm' },
  { key: 'height', label: 'Höhe', hint: 'Kamerahöhe über dem Auto', min: 0.5, max: 8, step: 0.05, unit: 'm' },
  { key: 'lookHeight', label: 'Blickhöhe', hint: 'Zielpunkt über oder unter dem Auto', min: -1, max: 4, step: 0.1, unit: 'm' },
  { key: 'positionStiffness', label: 'Positions-Reaktion', hint: 'Wie schnell die Kamera folgt', min: 2, max: 30, step: 0.5, unit: '' },
  { key: 'lookStiffness', label: 'Blick-Reaktion', hint: 'Wie schnell der Zielpunkt folgt', min: 2, max: 30, step: 0.5, unit: '' },
  { key: 'rotationStiffness', label: 'Dreh-Reaktion', hint: 'Wie schnell die Kamera einschwenkt', min: 2, max: 30, step: 0.5, unit: '' },
  { key: 'speedDistance', label: 'Tempo-Abstand', hint: 'Zusätzlicher Abstand bei hohem Tempo', min: 0, max: 4, step: 0.1, unit: 'm' },
  { key: 'speedHeight', label: 'Tempo-Höhe', hint: 'Zusätzliche Höhe bei hohem Tempo', min: 0, max: 2.5, step: 0.05, unit: 'm' },
  { key: 'highBallAssist', label: 'High-Ball Assist', hint: 'Automatische Hilfe für hohe Bälle', min: 0, max: 1.5, step: 0.05, unit: '×' },
  { key: 'dynamicFov', label: 'Dynamisches Sichtfeld', hint: 'FOV-Zuwachs bei hohem Tempo', min: 0, max: 2, step: 0.05, unit: '×' }
]);

const FIELD_BY_KEY = new Map(CAMERA_SETTING_FIELDS.map((field) => [field.key, field]));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeCameraSettings(value = {}) {
  const result = { ...DEFAULT_CAMERA_SETTINGS };
  result.mode = value?.mode === 'CAR' ? 'CAR' : 'BALL';
  result.occlusion = value?.occlusion !== false;

  for (const [key, field] of FIELD_BY_KEY) {
    const number = Number(value?.[key]);
    if (!Number.isFinite(number)) continue;
    const stepped = Math.round(number / field.step) * field.step;
    result[key] = Number(clamp(stepped, field.min, field.max).toFixed(4));
  }
  return result;
}

export function cameraSettingsStorageKey(accountName = '') {
  const account = String(accountName || 'guest').trim().toLocaleLowerCase().slice(0, 32);
  return `${CAMERA_SETTINGS_STORAGE_PREFIX}:${account || 'guest'}`;
}

export function loadCameraSettings(accountName = '', storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(cameraSettingsStorageKey(accountName));
    return normalizeCameraSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_CAMERA_SETTINGS };
  }
}

export function saveCameraSettings(accountName = '', settings = {}, storage = globalThis.localStorage) {
  const normalized = normalizeCameraSettings(settings);
  try {
    storage?.setItem?.(cameraSettingsStorageKey(accountName), JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in private browsing. Live settings still work.
  }
  return normalized;
}
