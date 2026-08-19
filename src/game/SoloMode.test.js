import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gameSource = readFileSync(new URL('./Game.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const boostSource = readFileSync(new URL('./BoostPads.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('authenticated startup asks for solo or multiplayer before routing', () => {
  assert.match(mainSource, /function requestPlayMode\(/);
  assert.match(mainSource, /data-play-mode="solo"/);
  assert.match(mainSource, /data-play-mode="multiplayer"/);
  assert.match(mainSource, /requestAuthentication\([\s\S]*?requestPlayMode\(app, account\)/);
  assert.match(cssSource, /\.play-mode-grid/);
});

test('solo configurator exposes teams, independent difficulties, rules and physics', () => {
  assert.match(mainSource, /data-solo-match-form/);
  assert.match(mainSource, /'solo\.teammates'.*0, 3/);
  assert.match(mainSource, /'solo\.opponents'.*0, 4/);
  assert.match(mainSource, /name="teammateDifficulty"/);
  assert.match(mainSource, /name="opponentDifficulty"/);
  assert.match(mainSource, /collectSoloSettings\(form, defaults\)/);
  assert.match(mainSource, /applyServerPhysicsConfig\(soloSettings\.config\)/);
  assert.match(mainSource, /applyServerArenaConfig\(soloSettings\.config\)/);
});

test('solo game creates one input per bot and advances every physical car', () => {
  assert.match(gameSource, /new SoloBotController\(/);
  assert.match(gameSource, /this\.soloBotConfig\.teammates/);
  assert.match(gameSource, /this\.soloBotConfig\.opponents/);
  assert.match(gameSource, /for \(const bot of this\.soloBots\) bot\.update/);
  assert.match(gameSource, /for \(const car of this\.cars\) car\.fixedUpdate\(dt\)/);
  assert.match(gameSource, /this\.ball\.prepareCarHit\(car\)/);
  assert.match(boostSource, /Array\.isArray\(carOrCars\)/);
});

test('solo match lifecycle applies clock, score limit, overtime and a solo return route', () => {
  assert.match(gameSource, /updateOfflineMatchClock\(dt\)/);
  assert.match(gameSource, /this\.soloRules\.overtimeOnTie/);
  assert.match(gameSource, /this\.soloRules\.scoreLimit/);
  assert.match(gameSource, /destination\.searchParams\.set\('return', 'solo'\)/);
  assert.match(mainSource, /consumeSoloReturnRequest\(\)/);
});
