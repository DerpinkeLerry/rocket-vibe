import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

test('lobby speed fields accept the shipped km/h defaults', () => {
  assert.match(source, /config\.car\.maxGroundSpeed'.*7\.2, 288, 0\.1, 'km\/h', 3\.6/);
  assert.match(source, /config\.car\.maxBoostSpeed'.*7\.2, 432, 0\.1, 'km\/h', 3\.6/);
  assert.match(source, /config\.ball\.maxSpeed'.*7\.2, 576, 0\.1, 'km\/h', 3\.6/);
  assert.match(source, /config\.car\.boostConsumptionPerSecond'.*0, 200, 'any'/);
  assert.match(source, /config\.car\.dodgeAngularSpeed'.*0, 40, 'any'/);
  assert.match(source, /config\.car\.dodgeRotation'.*0, 25\.1327, 'any'/);
});

test('lobby create form uses explicit visible validation', () => {
  assert.match(source, /data-lobby-create-form novalidate/);
  assert.match(source, /validateLobbyCreationForm\(form, error\)/);
});
