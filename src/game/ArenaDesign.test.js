import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./Arena.js', import.meta.url), 'utf8');

test('field has no geometric 3D grass or grass culling', () => {
  assert.doesNotMatch(source, /createUltraGrass\s*\(/);
  assert.doesNotMatch(source, /createGrassTuftTexture\s*\(/);
  assert.doesNotMatch(source, /grassChunks/);
  assert.doesNotMatch(source, /ultra-high-3d-grass/);
  assert.match(source, /3D grass was removed in/);
});

test('field markings use a high-resolution clean overlay', () => {
  assert.match(source, /canvas\.width = 2048;/);
  assert.match(source, /canvas\.height = 3072;/);
  assert.match(source, /drawRoute\(\[\[0, sign \* 68\]/);
  assert.doesNotMatch(source, /directional chevrons/i);
  assert.doesNotMatch(source, /side runways/i);
});

test('field marking canvas maps world Z without mirroring the team halves', () => {
  assert.match(source, /y:\s*\(-z\s*\/\s*FIELD_L\s*\+\s*0\.5\)\s*\*\s*height/);
  assert.match(source, /const color = sign < 0 \? blue : orange/);
  assert.match(source, /const isOrange = signZ > 0/);
});

test('green turf is replaced by deterministic high-resolution hardwood', () => {
  assert.match(source, /createWoodTexture\s*\(/);
  assert.match(source, /premium hardwood court/);
  assert.match(source, /createUltraWoodBumpTexture\s*\(/);
  assert.match(source, /arena-hardwood-floor/);
  assert.doesNotMatch(source, /createTurfTexture\s*\(/);
  assert.doesNotMatch(source, /createUltraTurfBumpTexture\s*\(/);
  assert.doesNotMatch(source, /broadcast-style turf/);
});

test('basketball mode closes soccar goals and renders physical hoops and court graphics', () => {
  assert.match(source, /this\.basketballMode = this\.gameMode === 'basketball'/);
  assert.match(source, /drawBasketballSurfaceGraphics\s*\(/);
  assert.match(source, /createBasketballHoop\s*\(/);
  assert.match(source, /basketball-rim-orange/);
  assert.match(source, /createBasketballPhysics\s*\(/);
  assert.match(source, /roundedOpeningHalfWidth = this\.basketballMode \? 0/);
});
