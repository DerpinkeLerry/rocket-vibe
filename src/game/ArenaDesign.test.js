import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./Arena.js', import.meta.url), 'utf8');

test('field has no geometric 3D grass or grass culling', () => {
  assert.doesNotMatch(source, /createUltraGrass\s*\(/);
  assert.doesNotMatch(source, /createGrassTuftTexture\s*\(/);
  assert.doesNotMatch(source, /grassChunks/);
  assert.doesNotMatch(source, /ultra-high-3d-grass/);
  assert.match(source, /3D grass was removed in/);
});

test('field markings use a high-resolution clean overlay', () => {
  assert.match(source, /canvas\.width = 2048;/);
  assert.match(source, /canvas\.height = 3072;/);
  assert.match(source, /drawRoute\(\[\[0, sign \* 42\.40\]/);
  assert.doesNotMatch(source, /directional chevrons/i);
  assert.doesNotMatch(source, /side runways/i);
});

test('field marking canvas maps world Z without mirroring the team halves', () => {
  assert.match(source, /y:\s*\(-z\s*\/\s*FIELD_L\s*\+\s*0\.5\)\s*\*\s*height/);
  assert.match(source, /const color = sign < 0 \? blue : orange/);
  assert.match(source, /const isOrange = signZ > 0/);
});

test('green turf is replaced by deterministic high-resolution hardwood', () => {
  assert.match(source, /createWoodTexture\s*\(/);
  assert.match(source, /premium hardwood court/);
  assert.match(source, /createUltraWoodBumpTexture\s*\(/);
  assert.match(source, /arena-hardwood-floor/);
  assert.match(source, /const columns = highDetail \? 126 : \(this\.lowDetail \? 70 : 104\)/);
  assert.match(source, /const columns = 108;/);
  assert.doesNotMatch(source, /createTurfTexture\s*\(/);
  assert.doesNotMatch(source, /createUltraTurfBumpTexture\s*\(/);
  assert.doesNotMatch(source, /broadcast-style turf/);
});

test('basketball mode closes soccar goals and renders physical hoops and court graphics', () => {
  assert.match(source, /this\.basketballMode = this\.gameMode === 'basketball'/);
  assert.match(source, /drawBasketballSurfaceGraphics\s*\(/);
  assert.match(source, /createBasketballHoop\s*\(/);
  assert.match(source, /basketball-rim-orange/);
  assert.match(source, /createBasketballPhysics\s*\(/);
  assert.match(source, /roundedOpeningHalfWidth = this\.basketballMode \? 0/);
});

test('glass walls use glowing team-coloured hexagons instead of black rectangular bars', () => {
  assert.match(source, /createHexGlassTexture\s*\(/);
  assert.match(source, /texture\.wrapS = THREE\.RepeatWrapping/);
  assert.match(source, /arena-orange-hex-glass-lines/);
  assert.match(source, /arena-blue-hex-glass-lines/);
  assert.match(source, /tileWidth:\s*13\.8/);
  assert.match(source, /blending:\s*THREE\.AdditiveBlending/);
  assert.doesNotMatch(source, /createWallFrameGrid\s*\(/);
  assert.doesNotMatch(source, /arena-glass-grid/);
  assert.doesNotMatch(source, /new THREE\.MeshBasicMaterial\(\{ color: 0x111b24 \}\)/);
});

test('arena floor, walls and colliders share the RL 45-degree corner planes', () => {
  assert.match(source, /shape\.lineTo\(halfWidth, -halfLength \+ radius\)/);
  assert.match(source, /length: CORNER_R \* Math\.SQRT2/);
  assert.match(source, /yaw: Math\.atan2\(nx, nz\)/);
  assert.doesNotMatch(source, /Math\.PI \* 0\.5 \/ CORNER_SEGMENTS/);
});

test('team wall meshes meet cleanly at midfield without coplanar overlap', () => {
  assert.match(source, /midfieldTeamSeam:\s*true/);
  assert.match(source, /visualPanelLength\s*\(/);
  assert.match(source, /panel\.midfieldTeamSeam\) return Math\.max\(0\.01, panel\.length - 0\.02\)/);
  assert.match(source, /this\.visualPanelLength\(panel, options\.lengthScale/);
  assert.match(source, /this\.visualPanelLength\(panel, 1\.022\)/);
});

test('goal mouth has no protruding vertical ramp meshes or colliders', () => {
  assert.match(source, /const roundedPanels = panels\.filter\(\(panel\) => !panel\.goalMouth\)/);
  assert.match(source, /minY:\s*\(panel\) => panel\.goalMouth \? 0 : GOAL_R/);
  assert.match(source, /const isMouthFillet = panel\.goalMouth === true/);
  assert.match(source, /if \(!isMouthFillet\) \{[\s\S]*?this\.addRoundedTunnelRampPhysics/);
});

test('high graphics keeps supported lamps but removes floating exterior steel bars', () => {
  assert.match(source, /arena-ultra-stadium-lamps/);
  assert.doesNotMatch(source, /const beamData = \[\]/);
  assert.doesNotMatch(source, /this\.group\.add\(beams\)/);
});
