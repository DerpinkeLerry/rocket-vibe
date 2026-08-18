import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlsSource = readFileSync(new URL('./MobileControls.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const menuSource = readFileSync(new URL('./MobileGameMenu.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gameSource = readFileSync(new URL('./Game.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const authSource = readFileSync(new URL('../auth/AccountGate.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('mobile controls remove the small in-match fullscreen button', () => {
  assert.doesNotMatch(controlsSource, /data-fullscreen|fullscreenButton|toggleGameFullscreen/);
});

test('mobile menu can leave the match and edit account or session camera settings', () => {
  assert.match(menuSource, /data-game-menu-open/);
  assert.match(menuSource, /data-leave-match/);
  assert.match(menuSource, /CAMERA_SETTING_FIELDS\.map/);
  assert.match(menuSource, /saveCameraSettings\(\s*this\.accountName/);
  assert.match(menuSource, /this\.persistSettings \? globalThis\.localStorage : null/);
  assert.match(gameSource, /new MobileGameMenu/);
  assert.match(gameSource, /this\.network\?\.disconnect\?\.\(\)/);
});

test('match menu is available on desktop and leave always navigates back to the application', () => {
  assert.match(gameSource, /new MobileGameMenu[\s\S]*?enabled: true/);
  assert.match(cssSource, /\.mobile-game-menu\s*\{\s*display:\s*block;/);
  assert.doesNotMatch(menuSource, /window\.confirm/);
  assert.match(gameSource, /window\.location\.assign\(destination\.toString\(\)\)/);
  assert.match(gameSource, /window\.setTimeout\(\(\) => window\.location\.reload\(\), 250\)/);
});

test('production startup offers account login, registration and temporary guest access', () => {
  assert.match(authSource, /data-account-tab="login"/);
  assert.match(authSource, /data-account-tab="register"/);
  assert.match(authSource, /data-account-guest/);
  assert.match(authSource, /\/api\/auth\/guest/);
  assert.match(authSource, /\/api\/auth\/\$\{mode\}/);
  assert.doesNotMatch(authSource, /passwordConfirm|Passwort wiederholen/);
  assert.doesNotMatch(authSource, /localStorage.*password|password.*localStorage/);
  assert.match(gameSource, /loadCameraSettings\(this\.accountName, this\.isGuest \? null : globalThis\.localStorage\)/);
});

test('phone UI uses dense choice rails, compact lobbies and a camera bottom sheet', () => {
  assert.match(cssSource, /Compact phone UI/);
  assert.match(cssSource, /\.car-select__grid\s*\{\s*grid-template-columns:\s*repeat\(3,/);
  assert.match(cssSource, /\.boost-select__grid\s*\{\s*grid-template-columns:\s*repeat\(4,/);
  assert.match(cssSource, /\.graphics-select__grid\s*\{\s*grid-template-columns:\s*repeat\(3,/);
  assert.match(cssSource, /\.lobby-row-wrap\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) 38px/);
  assert.match(cssSource, /\.mobile-game-menu__sheet\s*\{[\s\S]*?height:\s*min\(84dvh, 640px\);[\s\S]*?border-radius:\s*18px 18px 0 0/);
  assert.match(cssSource, /\.mobile-game-menu__settings\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(cssSource, /\.mobile-btn--jump\s*\{\s*width:\s*64px;\s*height:\s*64px/);
  assert.match(cssSource, /max-height:\s*480px[\s\S]*?max-width:\s*920px[\s\S]*?\.mobile-controls__left\s*\{\s*width:\s*215px/);
});
