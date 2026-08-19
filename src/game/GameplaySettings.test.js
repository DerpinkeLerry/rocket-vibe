import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GAMEPLAY_SETTINGS,
  gameplaySettingsStorageKey,
  loadGameplaySettings,
  normalizeGameplaySettings,
  saveGameplaySettings
} from './GameplaySettings.js';

test('mobile goal assist is enabled by default and only explicit false disables it', () => {
  assert.equal(DEFAULT_GAMEPLAY_SETTINGS.mobileBallAssist, true);
  assert.equal(normalizeGameplaySettings().mobileBallAssist, true);
  assert.equal(normalizeGameplaySettings({ mobileBallAssist: true }).mobileBallAssist, true);
  assert.equal(normalizeGameplaySettings({ mobileBallAssist: false }).mobileBallAssist, false);
});

test('mobile goal assist preference persists independently per account', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  saveGameplaySettings('PilotOne', { mobileBallAssist: false }, storage);
  assert.notEqual(gameplaySettingsStorageKey('PilotOne'), gameplaySettingsStorageKey('PilotTwo'));
  assert.equal(loadGameplaySettings('PilotOne', storage).mobileBallAssist, false);
  assert.equal(loadGameplaySettings('PilotTwo', storage).mobileBallAssist, true);
});

test('guest session can change goal assist without writing account storage', () => {
  let writes = 0;
  const storage = { setItem: () => { writes += 1; } };
  const liveSettings = saveGameplaySettings('Gast', { mobileBallAssist: false }, null);
  assert.equal(liveSettings.mobileBallAssist, false);
  assert.equal(writes, 0);
  assert.equal(loadGameplaySettings('Gast', storage).mobileBallAssist, true);
});
