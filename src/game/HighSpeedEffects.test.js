import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const effectsSource = await readFile(new URL('./HighSpeedEffects.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./Game.js', import.meta.url), 'utf8');

test('ultra-high speed immersion begins subtly above 80 km/h and reaches full strength by boost top speed', () => {
  assert.match(effectsSource, /const SPEED_START_KMH = 80;/);
  assert.match(effectsSource, /const SPEED_FULL_KMH = 120;/);
  assert.match(effectsSource, /smoothstep01/);
});

test('high-speed visuals include glowing path ribbons, airflow streaks and a restrained threshold pulse', () => {
  assert.match(effectsSource, /ultra-high-speed-ribbon/);
  assert.match(effectsSource, /ultra-high-airflow-streaks/);
  assert.match(effectsSource, /ultra-high-speed-pulse/);
  assert.match(effectsSource, /THREE\.AdditiveBlending/);
});

test('speed immersion is created only in ultra-high graphics and disabled during non-gameplay camera states', () => {
  assert.match(gameSource, /this\.profile\.ultraHigh\s*\? new HighSpeedEffects/);
  assert.match(gameSource, /!this\.replayActive/);
  assert.match(gameSource, /!this\.goalCelebrationActive/);
  assert.match(gameSource, /!this\.demolitionRespawnActive/);
});

test('ultra-high speed adds only a modest FOV gain and gently raises bloom', () => {
  assert.match(gameSource, /const fovGain = this\.profile\.mobile \? 3\.8 : 5\.2;/);
  assert.match(gameSource, /this\.ultraBloomPass\.strength = this\.ultraBloomBaseStrength \+ intensity/);
  assert.match(gameSource, /toneMappingExposure = 1\.00 \+ intensity \* 0\.012/);
});
