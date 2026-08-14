import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

test('lobby numeric settings use visible range sliders', () => {
  assert.match(source, /type="range" data-lobby-setting=/);
  assert.match(source, /data-lobby-value-for=/);
  assert.match(source, /lobby-range-limits/);
  assert.match(source, /bindLobbyRangeOutputs\(form\)/);
});

test('lobby speed sliders cover the shipped km\/h defaults', () => {
  assert.match(source, /config\.car\.maxGroundSpeed'.*7\.2, 288, 0\.1, 'km\/h', 3\.6/);
  assert.match(source, /config\.car\.maxBoostSpeed'.*7\.2, 432, 0\.1, 'km\/h', 3\.6/);
  assert.match(source, /config\.ball\.maxSpeed'.*7\.2, 576, 0\.1, 'km\/h', 3\.6/);
});

test('lobby player capacity slider exposes one through eight players', () => {
  assert.match(source, /renderLobbyRangeControl\('config\.maxPlayers', 'Max\. Spieler', 1, 8, 1, 'Spieler'/);
});

test('lobby create form uses explicit visible validation', () => {
  assert.match(source, /data-lobby-create-form novalidate/);
  assert.match(source, /validateLobbyCreationForm\(form, error\)/);
});

test('lobby browser exposes public delete action', () => {
  assert.match(source, /data-delete-lobby=/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /\/api\/lobbies\/\$\{encodeURIComponent\(lobby\.id\)\}/);
});

test('lobby creation exposes normal and basketball game modes', () => {
  assert.match(source, /name="gameMode" value="normal"/);
  assert.match(source, /name="gameMode" value="basketball"/);
  assert.match(source, /request\.config\.gameMode/);
  assert.match(source, /config\.gameMode === 'basketball' \? 'BASKETBALL' : 'NORMAL'/);
});
