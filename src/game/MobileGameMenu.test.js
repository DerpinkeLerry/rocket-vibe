import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlsSource = readFileSync(new URL('./MobileControls.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const menuSource = readFileSync(new URL('./MobileGameMenu.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gameSource = readFileSync(new URL('./Game.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const authSource = readFileSync(new URL('../auth/AccountGate.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('mobile controls remove the small in-match fullscreen button', () => {
  assert.doesNotMatch(controlsSource, /data-fullscreen|fullscreenButton|toggleGameFullscreen/);
});

test('mobile menu can leave the match and edit persistent camera settings', () => {
  assert.match(menuSource, /data-game-menu-open/);
  assert.match(menuSource, /data-leave-match/);
  assert.match(menuSource, /CAMERA_SETTING_FIELDS\.map/);
  assert.match(menuSource, /saveCameraSettings\(this\.accountName/);
  assert.match(gameSource, /new MobileGameMenu/);
  assert.match(gameSource, /this\.network\?\.disconnect\?\.\(\)/);
});

test('production startup requires login or registration before lobby selection', () => {
  assert.match(authSource, /data-account-tab="login"/);
  assert.match(authSource, /data-account-tab="register"/);
  assert.match(authSource, /\/api\/auth\/\$\{mode\}/);
  assert.doesNotMatch(authSource, /localStorage.*password|password.*localStorage/);
});
