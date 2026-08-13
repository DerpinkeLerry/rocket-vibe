import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hudSource = await readFile(new URL('./Hud.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../style.css', import.meta.url), 'utf8');

test('desktop control help is collapsed by default behind a Steuerung button', () => {
  assert.match(hudSource, /data-controls-toggle[^>]*>STEUERUNG<\/button>/);
  assert.match(hudSource, /data-controls-panel hidden/);
  assert.match(cssSource, /\.hud__controls\[hidden\]\s*\{\s*display:\s*none !important;/);
});

test('top-right diagnostics contain only ping fps and player count without a panel background', () => {
  const networkMarkup = hudSource.match(/<div class="hud__network"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(networkMarkup, /data-ping/);
  assert.match(networkMarkup, /data-fps/);
  assert.match(networkMarkup, /data-player-count/);
  assert.doesNotMatch(networkMarkup, /data-identity|data-network/);
  assert.match(cssSource, /\.hud__network\s*\{[\s\S]*?background:\s*transparent;/);
});
