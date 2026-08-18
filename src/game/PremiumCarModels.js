import * as THREE from 'three';
import { GAMEPLAY_OBJECT_SCALE } from '../shared/game-tuning.js';

const PREMIUM_CAR_CONFIGS = Object.freeze({
  octane: Object.freeze({
    name: 'OCTANE',
    url: new URL('../assets/octane-rocket-league.glb', import.meta.url).href,
    targetLength: 1.18008 * GAMEPLAY_OBJECT_SCALE,
    bottomY: -0.20 * GAMEPLAY_OBJECT_SCALE,
    paintMaterials: ['octane_body'],
    darkMaterials: ['paint'],
    windowMaterials: ['window'],
    lightMaterials: [],
    rimMaterials: ['dieci_rim'],
    wheelGroupPattern: /dieci - (fr|fl|br|bl) \(octane\)$/i,
    wheelSpinAxis: 'y',
    exhaustAnchor: Object.freeze({ x: 0.14 * GAMEPLAY_OBJECT_SCALE, z: 0.63 * GAMEPLAY_OBJECT_SCALE })
  }),
  dominus: Object.freeze({
    name: 'DOMINUS',
    url: new URL('../assets/dominus-rocket-league.glb', import.meta.url).href,
    targetLength: 1.18008 * GAMEPLAY_OBJECT_SCALE,
    bottomY: -0.20 * GAMEPLAY_OBJECT_SCALE,
    paintMaterials: ['dominus_body'],
    darkMaterials: ['paint'],
    windowMaterials: ['window'],
    lightMaterials: ['headlights'],
    rimMaterials: ['cristiano'],
    wheelGroupPattern: /cristiano - (fr|fl|br|bl) \(dominus\)$/i,
    wheelSpinAxis: 'y',
    exhaustAnchor: Object.freeze({ x: 0.15 * GAMEPLAY_OBJECT_SCALE, z: 0.64 * GAMEPLAY_OBJECT_SCALE })
  }),
  fennec: Object.freeze({
    name: 'FENNEC',
    url: new URL('../assets/fennec-rocket-league.glb', import.meta.url).href,
    targetLength: 1.18008 * GAMEPLAY_OBJECT_SCALE,
    bottomY: -0.20 * GAMEPLAY_OBJECT_SCALE,
    paintMaterials: ['fennec_-_body', 'fennec - body'],
    darkMaterials: ['paint'],
    windowMaterials: ['window'],
    lightMaterials: ['headlights'],
    rimMaterials: ['alpha_rim'],
    wheelGroupPattern: /alpha - (fr|fl|br|bl) \(fennec\)$/i,
    wheelSpinAxis: 'y',
    exhaustAnchor: Object.freeze({ x: 0.14 * GAMEPLAY_OBJECT_SCALE, z: 0.63 * GAMEPLAY_OBJECT_SCALE })
  })
});

const templatePromises = new Map();

function getConfig(modelId) {
  return PREMIUM_CAR_CONFIGS[String(modelId || '').toLowerCase()] || null;
}

function normalizePremiumTemplate(scene, config) {
  const wrapper = new THREE.Group();
  wrapper.name = `${config.name.replace(/\s+/g, '')}PremiumTemplate`;
  wrapper.add(scene);

  scene.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  // All three supplied Rocket League car assets use +X as vehicle forward.
  const scale = size.x > 1e-6 ? config.targetLength / size.x : 1;
  scene.scale.multiplyScalar(scale);
  scene.updateMatrixWorld(true);

  bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y += config.bottomY - bounds.min.y;

  // Rocket Vibe uses -Z as forward. +90deg around Y maps asset +X to game -Z.
  wrapper.rotation.y = Math.PI / 2;
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

async function getPremiumTemplate(modelId) {
  const config = getConfig(modelId);
  if (!config) throw new Error(`Unknown premium car model: ${modelId}`);
  if (!templatePromises.has(modelId)) {
    const promise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(config.url))
      .then((gltf) => normalizePremiumTemplate(gltf.scene, config))
      .catch((error) => {
        templatePromises.delete(modelId);
        throw error;
      });
    templatePromises.set(modelId, promise);
  }
  return templatePromises.get(modelId);
}

// Join loading uses the same promise cache as live car creation. Once this
// resolves, later car instances only clone shared geometry/textures and tune
// their own paint materials; they do not fetch or parse the GLB again.
export function preloadPremiumCarModel(modelId) {
  return getPremiumTemplate(String(modelId || '').toLowerCase());
}

function cloneTemplate(template) {
  // Octane, Dominus and Fennec contain no skinned chassis, so a normal deep
  // Object3D clone is enough. Geometry/textures stay shared; materials are
  // cloned per car below for independent team paint.
  return template.clone(true);
}

function matchesAny(name, values = [], prefix = false) {
  return values.some((value) => name === value || (prefix && name.startsWith(value)));
}

function tuneMaterial(material, config, paintColor) {
  if (!material) return material;
  const name = String(material.name || '').toLowerCase();

  if (matchesAny(name, config.paintMaterials)) {
    material.color?.setHex(paintColor);
    if ('roughness' in material) material.roughness = THREE.MathUtils.clamp(material.roughness ?? 0.38, 0.30, 0.50);
    if ('metalness' in material) material.metalness = THREE.MathUtils.clamp(material.metalness ?? 0.28, 0.12, 0.52);
    if ('clearcoat' in material) material.clearcoat = 0.22;
    if ('clearcoatRoughness' in material) material.clearcoatRoughness = 0.44;
    if ('envMapIntensity' in material) material.envMapIntensity = Math.min(0.62, material.envMapIntensity ?? 0.5);
  } else if (matchesAny(name, config.darkMaterials)) {
    // Keep untextured secondary paint/chassis parts dark and neutral.
    if (!material.map) material.color?.setHex(0x11171d);
    if ('roughness' in material) material.roughness = Math.max(0.46, material.roughness ?? 0.46);
    if ('metalness' in material) material.metalness = Math.min(0.45, material.metalness ?? 0.28);
  } else if (matchesAny(name, config.windowMaterials)) {
    material.color?.setHex(0x102632);
    if ('roughness' in material) material.roughness = Math.max(0.22, material.roughness ?? 0.22);
    if ('metalness' in material) material.metalness = Math.min(0.08, material.metalness ?? 0.02);
    if ('opacity' in material && material.transparent) material.opacity = Math.max(0.72, material.opacity ?? 0.82);
  } else if (matchesAny(name, config.lightMaterials)) {
    material.color?.setHex(0xe9faff);
    if (material.emissive) material.emissive.setHex(0x9feaff);
    if ('emissiveIntensity' in material) material.emissiveIntensity = 2.2;
    if ('roughness' in material) material.roughness = 0.30;
  } else if (matchesAny(name, config.rimMaterials, true)) {
    if ('roughness' in material) material.roughness = Math.max(0.32, material.roughness ?? 0.32);
    if ('metalness' in material) material.metalness = Math.max(0.55, material.metalness ?? 0.55);
  }
  material.needsUpdate = true;
  return material;
}

function cloneInstanceMaterials(root, config, paintColor) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = false;

    const sources = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sources.map((source) => tuneMaterial(source?.clone?.() || source, config, paintColor));
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
}

function collectWheelGroups(root, config) {
  const wheelGroups = [];
  root.traverse((object) => {
    if (object.isMesh) return;
    const name = String(object.name || '');
    if (!config.wheelGroupPattern?.test(name)) return;
    // Regexes with /g would keep state; all current patterns are stateless, but
    // reset lastIndex defensively for future assets.
    config.wheelGroupPattern.lastIndex = 0;
    object.userData.baseQuaternion = object.quaternion.clone();
    object.userData.frontWheel = /\bfr\b|\bfl\b|\.mo_35$|\.mo\.002_37$/i.test(name);
    object.userData.spinAxis = config.wheelSpinAxis;
    wheelGroups.push(object);
  });
  return wheelGroups;
}

export async function createPremiumCarVisual(modelId, paintColor = 0xf46b20) {
  const config = getConfig(modelId);
  if (!config) throw new Error(`Unknown premium car model: ${modelId}`);
  const template = await getPremiumTemplate(modelId);
  const root = cloneTemplate(template);
  root.name = `${config.name.replace(/\s+/g, '')}PremiumVisual`;
  cloneInstanceMaterials(root, config, paintColor);
  const wheelGroups = collectWheelGroups(root, config);
  return { root, wheelGroups, modelId };
}

export function getPremiumCarExhaustAnchor(modelId) {
  const config = getConfig(modelId);
  return config?.exhaustAnchor || null;
}

export function hasPremiumCarModel(modelId) {
  return Boolean(getConfig(modelId));
}

export const PREMIUM_CAR_ASSET_INFO = Object.freeze({
  octane: Object.freeze({
    author: 'Jako (fairlight51)',
    license: 'CC-BY-4.0',
    source: 'https://sketchfab.com/3d-models/octane-rocket-league-car-9910f0a5d158425bbc7deb60c7a81f69'
  }),
  dominus: Object.freeze({
    author: 'Jako (fairlight51)',
    license: 'CC-BY-4.0',
    source: 'https://sketchfab.com/3d-models/dominus-rocket-league-car-f592f249a65f41cd81a0e5aa3d418cb2'
  }),
  fennec: Object.freeze({
    author: 'Jako (fairlight51)',
    license: 'CC-BY-4.0',
    source: 'https://sketchfab.com/3d-models/fennec-rocket-league-car-5b43b50b6eeb4a12a29671df3418f57a'
  })
});
