import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./Arena.js', import.meta.url), 'utf8');

test('clean pitch removes geometric 3D grass and per-frame grass culling', () => {
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

test('turf texture no longer paints thousands of random one-pixel blades', () => {
  assert.doesNotMatch(source, /bladeCount/);
  assert.match(source, /broadcast-style turf/);
});
