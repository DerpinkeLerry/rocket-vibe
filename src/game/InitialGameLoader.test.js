import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectInitialAssetPlan, preloadInitialGameAssets } from './InitialGameLoader.js';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./Game.js', import.meta.url), 'utf8');
const carSource = await readFile(new URL('./Car.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../style.css', import.meta.url), 'utf8');

test('premium join plan is quality-aware and deduplicates roster car models', () => {
  const lightweight = collectInitialAssetPlan({
    identity: { carStyle: 'razor' },
    profile: { ultraHigh: false }
  });
  assert.deepEqual(lightweight, []);

  const premium = collectInitialAssetPlan({
    identity: { carStyle: 'vortex' },
    network: { players: [{ carStyle: 'vortex' }, { carStyle: 'apex' }] },
    profile: { ultraHigh: true },
    gameMode: 'normal'
  });
  assert.deepEqual(premium.map((task) => task.id), ['car:octane', 'car:dominus', 'ball:premium']);

  const basketball = collectInitialAssetPlan({
    identity: { carStyle: 'razor' },
    profile: { ultraHigh: true },
    gameMode: 'basketball'
  });
  assert.deepEqual(basketball.map((task) => task.id), ['car:fennec']);
});

test('lightweight join completes immediately without requesting premium GLBs', async () => {
  const updates = [];
  const result = await preloadInitialGameAssets({
    profile: { ultraHigh: false },
    onProgress: (update) => updates.push(update)
  });
  assert.deepEqual(result, { loaded: [], failed: [] });
  assert.equal(updates.at(-1).fraction, 1);
});

test('join screen remains above the game through model attachment and GPU warm-up', () => {
  assert.match(mainSource, /new JoinLoadingScreen\(app\)/);
  assert.match(mainSource, /await preloadInitialGameAssets\(/);
  assert.match(mainSource, /const game = new Game\([\s\S]*await game\.prepareInitialFrame\(\);[\s\S]*await loadingScreen\.finish/);
  assert.match(gameSource, /async prepareInitialFrame\(\)/);
  assert.match(gameSource, /await Promise\.allSettled\(pendingVisuals\)/);
  assert.match(gameSource, /renderer\.compileAsync/);
  assert.match(gameSource, /this\.renderer\.render\(this\.scene, this\.camera\)/);
  assert.match(cssSource, /\.game-loading\s*\{[\s\S]*z-index:\s*180/);
});

test('cars outside the visible roster do not trigger unnecessary premium loads', () => {
  assert.match(carSource, /this\.premiumVisualsEnabled = options\.initiallyVisible !== false/);
  assert.match(carSource, /this\.premiumVisualsEnabled && shouldUsePremiumCarModel/);
  assert.match(gameSource, /car\.setPremiumVisualsEnabled\?\.\(visible\)/);
});
