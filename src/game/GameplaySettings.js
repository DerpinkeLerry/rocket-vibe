export const GAMEPLAY_SETTINGS_STORAGE_PREFIX = 'rocket-vibe-gameplay-settings-v1';

export const DEFAULT_GAMEPLAY_SETTINGS = Object.freeze({
  mobileBallAssist: true
});

export function normalizeGameplaySettings(value = {}) {
  return {
    mobileBallAssist: value?.mobileBallAssist !== false
  };
}

export function gameplaySettingsStorageKey(accountName = '') {
  const account = String(accountName || 'guest').trim().toLocaleLowerCase().slice(0, 32);
  return `${GAMEPLAY_SETTINGS_STORAGE_PREFIX}:${account || 'guest'}`;
}

export function loadGameplaySettings(accountName = '', storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(gameplaySettingsStorageKey(accountName));
    return normalizeGameplaySettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_GAMEPLAY_SETTINGS };
  }
}

export function saveGameplaySettings(accountName = '', settings = {}, storage = globalThis.localStorage) {
  const normalized = normalizeGameplaySettings(settings);
  try {
    storage?.setItem?.(gameplaySettingsStorageKey(accountName), JSON.stringify(normalized));
  } catch {
    // Live settings remain usable when storage is blocked or unavailable.
  }
  return normalized;
}
