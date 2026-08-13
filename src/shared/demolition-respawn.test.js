import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDemolitionSnapshot } from './demolition-respawn.js';

test('stale pre-demolition snapshot cannot close a modern desktop spawn picker', () => {
  const stale = evaluateDemolitionSnapshot({
    active: true,
    demolished: false,
    snapshotTick: 411,
    demolitionStartTick: 412,
    snapshotConfirmed: false
  });
  assert.equal(stale.shouldEnd, false);
  assert.equal(stale.snapshotConfirmed, false);
});

test('modern picker remains active through demolished snapshots and ends on a newer respawn snapshot', () => {
  const demolished = evaluateDemolitionSnapshot({
    active: true,
    demolished: true,
    snapshotTick: 413,
    demolitionStartTick: 412,
    snapshotConfirmed: false
  });
  assert.equal(demolished.shouldEnd, false);
  assert.equal(demolished.snapshotConfirmed, true);

  const respawned = evaluateDemolitionSnapshot({
    active: true,
    demolished: false,
    snapshotTick: 650,
    demolitionStartTick: 412,
    snapshotConfirmed: demolished.snapshotConfirmed
  });
  assert.equal(respawned.shouldEnd, true);
});

test('legacy server needs a d=1 confirmation before d=0 can end selection', () => {
  const stale = evaluateDemolitionSnapshot({ active: true, demolished: false, snapshotTick: 10, demolitionStartTick: -1 });
  assert.equal(stale.shouldEnd, false);

  const demolished = evaluateDemolitionSnapshot({ active: true, demolished: true, snapshotTick: 11, demolitionStartTick: -1 });
  assert.equal(demolished.snapshotConfirmed, true);

  const respawned = evaluateDemolitionSnapshot({
    active: true,
    demolished: false,
    snapshotTick: 12,
    demolitionStartTick: -1,
    snapshotConfirmed: demolished.snapshotConfirmed
  });
  assert.equal(respawned.shouldEnd, true);
});
