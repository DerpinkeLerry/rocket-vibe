import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const performanceSource = await readFile(new URL('./PerformanceProfile.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./Game.js', import.meta.url), 'utf8');
const arenaSource = await readFile(new URL('./Arena.js', import.meta.url), 'utf8');
const padsSource = await readFile(new URL('./BoostPads.js', import.meta.url), 'utf8');
const carSource = await readFile(new URL('./Car.js', import.meta.url), 'utf8');
const ballSource = await readFile(new URL('./Ball.js', import.meta.url), 'utf8');
const hudSource = await readFile(new URL('./Hud.js', import.meta.url), 'utf8');

function methodBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('ultra-low targets software-rendered VMs with a 30 Hz render cap and tiny framebuffer', () => {
  assert.match(performanceSource, /initialPixelRatio:\s*ultraLow \? 0\.32/);
  assert.match(performanceSource, /minPixelRatio:\s*ultraLow \? 0\.18/);
  assert.match(performanceSource, /maxPixelRatio:\s*ultraLow \? 0\.40/);
  assert.match(performanceSource, /renderHz:\s*ultraLow \? 30 : 60/);
  assert.match(performanceSource, /useSky:\s*!ultraLow/);
  assert.match(gameSource, /this\.renderInterval = 1 \/ Math\.max\(1, Number\(this\.profile\?\.renderHz\) \|\| 60\)/);
});

test('ultra-low arena bypasses the normal textured lit arena', () => {
  const constructor = methodBody(arenaSource, '  constructor(scene, world, RAPIER, options = {}) {', '\n\n  panelTeamSign(');
  assert.match(constructor, /if \(this\.lowDetail\) \{[\s\S]*this\.createUltraLowVisual\(\)/);
  assert.match(constructor, /\} else \{[\s\S]*this\.createExteriorGround\(\)[\s\S]*this\.createField\(\)[\s\S]*this\.createLights\(\)/);
  const lowVisual = methodBody(arenaSource, '  createUltraLowVisual() {', '\n\n  createExteriorGround() {');
  assert.match(lowVisual, /new THREE\.MeshBasicMaterial/);
  assert.match(lowVisual, /new THREE\.LineSegments/);
  assert.doesNotMatch(lowVisual, /CanvasTexture|MeshStandardMaterial|MeshPhysicalMaterial|transparent:\s*true|PointLight|DirectionalLight|HemisphereLight/);
});

test('ultra-low boost pads are one static instanced draw path', () => {
  assert.match(padsSource, /this\.pads = this\.lowDetail \? this\.createUltraLowPads\(\)/);
  const lowPads = methodBody(padsSource, '  createUltraLowPads() {', '\n\n  writeUltraLowInstance(');
  assert.match(lowPads, /new THREE\.InstancedMesh\(geometry, material, BOOST_PADS\.length\)/);
  assert.match(padsSource, /update\(dt\) \{\s*if \(this\.lowDetail\) return;/);
});

test('ultra-low car and ball avoid animated or textured premium-style visuals', () => {
  const lowCar = methodBody(carSource, '  createLowDetailVisual() {', '\n\n  applyCarStyleVisual() {');
  assert.equal((lowCar.match(/new THREE\.Mesh\(/g) || []).length, 2);
  assert.doesNotMatch(lowCar, /CylinderGeometry|InstancedMesh|MeshStandardMaterial|MeshPhysicalMaterial|transparent:\s*true/);
  assert.match(carSource, /updateBoostEffects\(dt\) \{\s*if \(this\.lowDetail\) return;/);

  const ballVisual = methodBody(ballSource, '  createVisual() {', '\n\n  prepareCarHit(');
  assert.match(ballVisual, /if \(this\.lowDetail\) \{[\s\S]*IcosahedronGeometry[\s\S]*MeshBasicMaterial/);
});

test('ultra-low HUD skips the 42-segment boost animation and kickoff Web Animation', () => {
  assert.match(hudSource, /this\.lowDetail = String\(options\.performanceProfile/);
  assert.match(hudSource, /if \(!this\.lowDetail\) this\.buildBoostGaugeSegments\(\)/);
  assert.match(hudSource, /pulseKickoff\(\) \{\s*if \(this\.lowDetail\) return;/);
});
