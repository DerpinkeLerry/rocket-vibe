import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const arenaSource = readFileSync(new URL('./game/Arena.js', import.meta.url), 'utf8');
const viteSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

test('production join does not dynamically import the game after websocket welcome', () => {
  assert.match(mainSource, /import \{ Game \} from '\.\/game\/Game\.js';/);
  assert.doesNotMatch(mainSource, /await import\('\.\/game\/Game\.js'\)/);
});

test('cached arena geometry is refreshed after lobby config is applied', () => {
  assert.match(arenaSource, /export function refreshArenaRuntimeTuning\(\)/);
  assert.match(mainSource, /applyServerArenaConfig\(network\.matchConfig\);[\s\S]*refreshArenaRuntimeTuning\(\);[\s\S]*new Game\(/);
});

test('vite production target is compatible instead of esnext', () => {
  assert.doesNotMatch(viteSource, /target:\s*['"]esnext['"]/);
  assert.match(viteSource, /es2019/);
  assert.match(viteSource, /safari13\.1/);
  assert.match(viteSource, /ios13\.4/);
});

const renderSource = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
const dockerSource = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const serverMainSource = readFileSync(new URL('../cmd/server/main.go', import.meta.url), 'utf8');

test('Render blueprint keeps the in-memory lobby server on one Docker instance', () => {
  assert.match(renderSource, /runtime:\s*docker/);
  assert.match(renderSource, /healthCheckPath:\s*\/health/);
  assert.match(renderSource, /numInstances:\s*1/);
  assert.match(renderSource, /region:\s*frankfurt/);
});

test('Render-compatible server binds to the platform port on all interfaces', () => {
  assert.match(serverMainSource, /0\.0\.0\.0:" \+ port/);
  assert.match(dockerSource, /ENV PORT=10000/);
  assert.match(dockerSource, /EXPOSE 10000/);
});
