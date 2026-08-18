import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./Arena.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

function methodBody(start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing method start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing method end: ${end}`);
  return source.slice(from, to);
}

test('static opaque arena meshes are spatially batched without touching transparent surfaces', () => {
  assert.match(source, /mergeGeometries/);
  const body = methodBody('  optimizeStaticRenderMeshes() {', '\n\n  panelTeamSign(');
  assert.match(body, /bucketSize = 48/);
  assert.match(body, /material\.transparent/);
  assert.match(body, /material\.depthWrite === false/);
  assert.match(body, /staticDrawCallsSaved/);
  assert.match(body, /cellX/);
  assert.match(body, /cellZ/);
});

test('all local arena colliders share one immutable fixed rigid body', () => {
  const physics = methodBody('  createPhysics() {', '\n\n  createBasketballPhysics() {');
  assert.match(physics, /this\.staticPhysicsBody = this\.world\.createRigidBody\(R\.RigidBodyDesc\.fixed\(\)\)/);
  assert.doesNotMatch(physics, /RigidBodyDesc\.fixed\(\)\.setTranslation/);

  const helpers = methodBody('  addFixedCollider(', '\n\n  createExteriorDecoration() {');
  assert.match(helpers, /\.setTranslation\(x, y, z\)/);
  assert.match(helpers, /this\.staticPhysicsBody/);
  assert.doesNotMatch(helpers, /createRigidBody/);

  const basketball = methodBody('  createBasketballPhysics() {', '\n\n  addRampPhysics(');
  assert.match(basketball, /\.setTranslation\(x, BASKETBALL_HOOP\.height, z\)/);
  assert.match(basketball, /\.setTranslation\(x, y, z\)/);
  assert.doesNotMatch(basketball, /createRigidBody/);
});
