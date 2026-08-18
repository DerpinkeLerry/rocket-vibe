import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAMERA_SETTING_FIELDS,
  DEFAULT_CAMERA_SETTINGS,
  cameraSettingsStorageKey,
  loadCameraSettings,
  normalizeCameraSettings,
  saveCameraSettings
} from './CameraSettings.js';

test('camera settings expose a broad bounded set of player choices', () => {
  assert.ok(CAMERA_SETTING_FIELDS.length >= 10);
  const normalized = normalizeCameraSettings({
    mode: 'CAR',
    fov: 500,
    distance: -20,
    highBallAssist: 0.37,
    dynamicFov: 1.43,
    occlusion: false
  });
  assert.equal(normalized.mode, 'CAR');
  assert.equal(normalized.fov, 100);
  assert.equal(normalized.distance, 4);
  assert.equal(normalized.highBallAssist, 0.35);
  assert.equal(normalized.dynamicFov, 1.45);
  assert.equal(normalized.occlusion, false);
});

test('camera settings save independently for each account', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  saveCameraSettings('PilotOne', { ...DEFAULT_CAMERA_SETTINGS, fov: 91 }, storage);
  saveCameraSettings('PilotTwo', { ...DEFAULT_CAMERA_SETTINGS, fov: 63 }, storage);
  assert.notEqual(cameraSettingsStorageKey('PilotOne'), cameraSettingsStorageKey('PilotTwo'));
  assert.equal(loadCameraSettings('PilotOne', storage).fov, 91);
  assert.equal(loadCameraSettings('PilotTwo', storage).fov, 63);
});
