import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const effectSource = await readFile(new URL('./DemolitionExplosion.js', import.meta.url), 'utf8');
const gameSource = (await readFile(new URL('./Game.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('demolition explosion is gated to ultra high graphics', () => {
  assert.match(effectSource, /this\.enabled = Boolean\(options\.ultraHigh\) && !Boolean\(options\.lowDetail\)/);
  assert.match(effectSource, /demolition-explosion-particles/);
  assert.match(effectSource, /PointLight/);
});

test('every demolition event triggers the small visual burst before local respawn handling', () => {
  const handler = gameSource.match(/handleDemolition\(demolition\) \{[\s\S]*?\n  \}\n\n  handleRespawn/)?.[0] || '';
  assert.match(handler, /this\.demolitionExplosion\?\.trigger\(demolition\.position\)/);
  assert.match(gameSource, /this\.demolitionExplosion\?\.update\(renderDt\)/);
});
