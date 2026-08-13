import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';
import { getPremiumCarExhaustAnchor, hasPremiumCarModel, PREMIUM_CAR_ASSET_INFO } from './PremiumCarModels.js';
import { PREMIUM_BALL_ASSET_INFO } from './PremiumBallModel.js';

const carAssets = [
  ['octane', '../assets/octane-rocket-league.glb'],
  ['dominus', '../assets/dominus-rocket-league.glb'],
  ['mclaren', '../assets/mclaren-570s-rocket-league.glb'],
  ['fennec', '../assets/fennec-rocket-league.glb']
];

test('all premium car configurations and GLB files are present', async () => {
  for (const [id, relativePath] of carAssets) {
    assert.equal(hasPremiumCarModel(id), true);
    const anchor = getPremiumCarExhaustAnchor(id);
    assert.ok(anchor.x > 0.2 && anchor.z > 1.4);
    assert.equal(PREMIUM_CAR_ASSET_INFO[id].license, 'CC-BY-4.0');
    const file = new URL(relativePath, import.meta.url);
    assert.ok((await stat(file)).size > 500_000);
  }
});

test('premium ball GLB and attribution are present', async () => {
  assert.equal(PREMIUM_BALL_ASSET_INFO.license, 'CC-BY-4.0');
  const file = new URL('../assets/rocket-league-ball.glb', import.meta.url);
  assert.ok((await stat(file)).size > 500_000);
});
