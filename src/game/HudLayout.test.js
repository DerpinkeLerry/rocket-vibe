import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hudSource = await readFile(new URL('./Hud.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./Game.js', import.meta.url), 'utf8');

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


test('mobile quick chat is compact and anchored to the top-right gameplay lane', () => {
  assert.match(cssSource, /v1\.10\.22 — unobtrusive mobile quick chat/);
  assert.match(cssSource, /\.mobile-active \.hud__quickchat\s*\{[\s\S]*?left:\s*auto;[\s\S]*?right:\s*calc\(env\(safe-area-inset-right/);
  assert.match(cssSource, /\.mobile-active \.hud__quickchat-line\s*\{[\s\S]*?font-size:\s*8px;/);
  assert.match(cssSource, /nth-last-child\(n \+ 5\)/);
});


test('desktop replay advertises a blinking Space shortcut and routes it through the skip vote', () => {
  assert.match(hudSource, /PRESS <kbd>SPACE<\/kbd> TO SKIP/);
  assert.match(hudSource, /requestReplaySkip\(\)/);
  assert.match(cssSource, /@keyframes replay-space-skip-blink/);
  assert.match(cssSource, /animation:\s*replay-space-skip-blink/);
  assert.match(gameSource, /onReplaySkipKeyDown\(event\)/);
  assert.match(gameSource, /event\.code !== 'Space'/);
  assert.match(gameSource, /this\.hud\?\.requestReplaySkip\?\.\(\)/);
});
