import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cueSource = await readFile(new URL('./UltraLowBallCue.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./Game.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../style.css', import.meta.url), 'utf8');

test('ultra-low ball cue is gated to the lowest graphics profile', () => {
  assert.match(gameSource, /this\.profile\.ultraLow\s*\? new UltraLowBallCue/);
  assert.match(gameSource, /this\.ultraLowBallCue\?\.update\(\)/);
});

test('ultra-low cue adds floor anchor height stem and sparse range ticks in one line draw', () => {
  assert.match(cueSource, /new THREE\.LineSegments\(this\.geometry, this\.material\)/);
  assert.match(cueSource, /const RING_SEGMENTS = 16/);
  assert.match(cueSource, /const RANGE_TICK_METERS = 20/);
  assert.match(cueSource, /const stemTop = Math\.max/);
  assert.match(cueSource, /groundDistance >= MIN_RANGE_LINE_DISTANCE/);
});

test('ultra-low cue exposes a compact exact range label only when the ball is not close', () => {
  assert.match(cueSource, /groundDistance < 14/);
  assert.match(cueSource, /`\$\{roundedRange\} m/);
  assert.match(cueSource, /roundedHeight >= 4/);
  assert.match(styleSource, /\.ultra-low-ball-range\s*\{/);
});
