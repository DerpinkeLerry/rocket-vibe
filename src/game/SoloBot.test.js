import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOLO_DIFFICULTIES,
  chooseSoloBotTarget,
  computeSoloBotDrive,
  normalizeSoloBotConfig
} from './SoloBot.js';

test('solo bot config supports three teammates, four opponents and three difficulties', () => {
  assert.deepEqual(SOLO_DIFFICULTIES.map((difficulty) => difficulty.id), ['rookie', 'pro', 'all-star']);
  assert.deepEqual(normalizeSoloBotConfig({
    teammates: 99,
    opponents: 99,
    teammateDifficulty: 'rookie',
    opponentDifficulty: 'all-star'
  }), {
    teammates: 3,
    opponents: 4,
    teammateDifficulty: 'rookie',
    opponentDifficulty: 'all-star'
  });
});

test('striker predicts the ball and chooses its goal-facing contact side', () => {
  const target = chooseSoloBotTarget({
    team: 'orange',
    difficulty: 'all-star',
    seed: 1,
    elapsed: 0,
    arenaLength: 102.4,
    carState: { position: { x: 0, z: 10 }, velocity: { x: 0, z: -12 } },
    ballState: { position: { x: 3, y: 1.2, z: 0 }, velocity: { x: 2, z: -1 } },
    teamCars: []
  });
  assert.equal(target.role, 'attack');
  assert.ok(target.leadTime > 0);
  assert.ok(target.x > 3, target);
  assert.ok(target.alignment > 0.7, target);
});

test('non-striker rotates into support instead of double-committing', () => {
  const target = chooseSoloBotTarget({
    team: 'orange',
    difficulty: 'pro',
    roleIndex: 1,
    carState: { position: { x: 20, z: 30 }, velocity: {} },
    ballState: { position: { x: 0, y: 1.2, z: -10 }, velocity: {} },
    teamCars: [{ position: { x: 0, z: -8 } }]
  });
  assert.equal(target.role, 'support');
  assert.ok(target.z > -10);
});

test('teammate yields a near-equal challenge to the local player', () => {
  const target = chooseSoloBotTarget({
    team: 'orange',
    difficulty: 'all-star',
    roleIndex: 0,
    carState: { position: { x: -2, z: 9 }, velocity: {} },
    ballState: { position: { x: 0, y: 1.2, z: 0 }, velocity: {} },
    teamCars: [{
      isLocalPlayer: true,
      body: {
        translation: () => ({ x: 2, y: 0.5, z: 9 }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 })
      }
    }]
  });
  assert.equal(target.role, 'support');
});

test('bot drive steers, drifts and boosts only on a clean line', () => {
  const straight = computeSoloBotDrive({
    difficulty: 'all-star',
    carState: { position: { x: 0, z: 10 }, velocity: { x: 0, z: -10 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    target: { x: 0.2, z: -10, role: 'attack' },
    boost: 50
  });
  const turn = computeSoloBotDrive({
    difficulty: 'pro',
    carState: { position: { x: 0, z: 0 }, velocity: { x: 0, z: -12 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    target: { x: 12, z: -2, role: 'attack' },
    boost: 50
  });
  assert.equal(straight.boost, true);
  assert.ok(straight.steer < 0, straight);
  assert.equal(turn.boost, false);
  assert.equal(turn.drift, true);
});
