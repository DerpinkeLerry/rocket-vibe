import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cueSource = await readFile(new URL('./BallLandingCue.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./Game.js', import.meta.url), 'utf8');

test('ball landing cue predicts a future ground impact point and clamps it to the playable arena', () => {
  assert.match(cueSource, /computeImpactTime\(posY, velY, radius\)/);
  assert.match(cueSource, /CAR_TUNING\.gravity/);
  assert.match(cueSource, /BALL_TUNING\.restingHeight/);
  assert.doesNotMatch(cueSource, /const GRAVITY = 20\.5/);
  assert.match(cueSource, /translation\.x \+ velocity\.x \* impactTime/);
  assert.match(cueSource, /translation\.z \+ velocity\.z \* impactTime/);
  assert.match(cueSource, /clampPointToRoundedArena\(this\.impactPoint/);
});

test('ball landing cue draws subtle ground and impact rings without a text-distance overlay', () => {
  assert.match(cueSource, /ball-ground-ring/);
  assert.match(cueSource, /ball-impact-ring/);
  assert.match(cueSource, /ball-impact-ticks/);
  assert.doesNotMatch(cueSource, /textContent|innerText|createElement\('div'\)|createElement\("div"\)/);
});

test('all graphics modes create and update the shared ball landing cue', () => {
  assert.match(gameSource, /this\.ballLandingCue = new BallLandingCue\(this\.scene/);
  assert.match(gameSource, /this\.ballLandingCue\?\.update\(this\.ball, renderDt\)/);
  assert.doesNotMatch(gameSource, /ultraLow\s*\?\s*new BallLandingCue/);
});
