import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlsSource = readFileSync(new URL('./MobileControls.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const menuSource = readFileSync(new URL('./MobileGameMenu.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gameSource = readFileSync(new URL('./Game.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const authSource = readFileSync(new URL('../auth/AccountGate.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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

test('mobile match menu exposes the default-on persistent goal assist toggle', () => {
  assert.match(menuSource, /data-ball-assist-toggle/);
  assert.match(menuSource, /TOR-ASSISTENT/);
  assert.match(menuSource, /onBallAssistChange/);
  assert.match(gameSource, /showBallAssist:\s*this\.mobileControls\.enabled/);
  assert.match(gameSource, /loadGameplaySettings\(this\.accountName, this\.isGuest \? null : globalThis\.localStorage\)/);
  assert.match(gameSource, /setMobileBallAssistEnabled/);
});

test('match menu is available on desktop and leave returns directly to the lobby browser', () => {
  assert.match(gameSource, /new MobileGameMenu[\s\S]*?enabled: true/);
  assert.match(cssSource, /\.mobile-game-menu\s*\{\s*display:\s*block;/);
  assert.doesNotMatch(menuSource, /window\.confirm/);
  assert.match(gameSource, /destination\.searchParams\.set\('return', 'lobbies'\)/);
  assert.match(gameSource, /window\.location\.replace\(destinationHref\)/);
  assert.match(mainSource, /consumeLobbyReturnRequest\(\)/);
  assert.match(mainSource, /requestAuthentication\(app, \{ autoContinue: returnToLobbies \}\)/);
  assert.match(authSource, /options\.autoContinue && \(currentUser\?\.username \|\| currentUser\?\.guest\)/);
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
  assert.match(cssSource, /\.mobile-game-menu__settings\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(cssSource, /\.mobile-btn--jump\s*\{\s*width:\s*64px;\s*height:\s*64px/);
  assert.match(cssSource, /max-height:\s*480px[\s\S]*?max-width:\s*920px[\s\S]*?\.mobile-controls__left\s*\{\s*width:\s*215px/);
});

test('notched phones keep every overlay in the safe area and expand only the camera editor', () => {
  assert.match(cssSource, /Unified compact \+ notch-safe shell/);
  assert.match(cssSource, /--rv-safe-left:\s*env\(safe-area-inset-left, 0px\)/);
  assert.match(cssSource, /\.join-screen,[\s\S]*?padding-right:\s*max\(var\(--rv-page-gap\), var\(--rv-safe-right\)\)/);
  assert.match(cssSource, /\.mobile-game-menu__sheet\s*\{[\s\S]*?width:\s*min\(330px, 100%\);[\s\S]*?height:\s*auto;/);
  assert.match(cssSource, /\.mobile-game-menu\.is-camera-editor \.mobile-game-menu__sheet/);
  assert.match(menuSource, /classList\.add\('is-camera-editor'\)/);
  assert.match(menuSource, /classList\.remove\('is-camera-editor'\)/);
});
