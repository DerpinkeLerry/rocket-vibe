import * as THREE from 'three';

const PREMIUM_CAR_CONFIGS = Object.freeze({
  octane: Object.freeze({
    name: 'OCTANE',
    url: new URL('../assets/octane-rocket-league.glb', import.meta.url).href,
    targetLength: 3.08,
    bottomY: -0.52,
    paintMaterials: ['octane_body'],
    darkMaterials: ['paint'],
    windowMaterials: ['window'],
    lightMaterials: [],
    rimMaterials: ['dieci_rim'],
    wheelGroupPattern: /dieci - (fr|fl|br|bl) \(octane\)$/i,
    wheelSpinAxis: 'y',
    exhaustAnchor: Object.freeze({ x: 0.34, z: 1.62 })
  }),
  dominus: Object.freeze({
    name: 'DOMINUS',
    url: new URL('../assets/dominus-rocket-league.glb', import.meta.url).href,
    targetLength: 3.16,
    bottomY: -0.52,
    paintMaterials: ['dominus_body'],
    darkMaterials: ['paint'],
    windowMaterials: ['window'],
    lightMaterials: ['headlights'],
    rimMaterials: ['cristiano'],
    wheelGroupPattern: /cristiano - (fr|fl|br|bl) \(dominus\)$/i,
    wheelSpinAxis: 'y',
    exhaustAnchor: Object.freeze({ x: 0.40, z: 1.66 })
  }),
  mclaren: Object.freeze({
    name: 'MCLAREN 570S',
    url: new URL('../assets/mclaren-570s-rocket-league.glb', import.meta.url).href,
    targetLength: 3.14,
    bottomY: -0.52,
    paintMaterials: ['mic_body_ron'],
    darkMaterials: ['mic_body_ron_chassis', 'mat_ron_chassis_detail_tiling'],
    windowMaterials: ['mat_vehicle_glass_translucent'],
    lightMaterials: [],
    rimMaterials: ['mic_wheel_ron'],
    wheelGroupPattern: /wheel_ron_flipped_sm/i,
    wheelSpinAxis: 'z',
    exhaustAnchor: Object.freeze({ x: 0.31, z: 1.63 })
  }),
  fennec: Object.freeze({
    name: 'FENNEC',
    url: new URL('../assets/fennec-rocket-league.glb', import.meta.url).href,
    targetLength: 3.10,
    bottomY: -0.52,
    paintMaterials: ['fennec_-_body', 'fennec - body'],
    darkMaterials: ['paint'],
    windowMaterials: ['window'],
    lightMaterials: ['headlights'],
    rimMaterials: ['alpha_rim'],
    wheelGroupPattern: /alpha - (fr|fl|br|bl) \(fennec\)$/i,
    wheelSpinAxis: 'y',
    exhaustAnchor: Object.freeze({ x: 0.34, z: 1.62 })
  })
});

const templatePromises = new Map();
let skeletonClonePromise = null;

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
  // All four supplied Rocket League assets use +X as vehicle forward.
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

async function cloneTemplate(template) {
  // SkeletonUtils is required for the McLaren's skinned chassis. It is loaded
  // only when a premium model is actually requested, so lower settings do not
  // pay for this path.
  if (!skeletonClonePromise) {
    skeletonClonePromise = import('three/addons/utils/SkeletonUtils.js').then((module) => module.clone);
  }
  const clone = await skeletonClonePromise;
  return clone(template);
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
    // Preserve textured chassis detail on McLaren while keeping untextured
    // secondary paint on the other cars dark and neutral.
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
  const root = await cloneTemplate(template);
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
  mclaren: Object.freeze({
    author: 'DhaniAstrowlrd',
    license: 'CC-BY-4.0',
    source: 'https://sketchfab.com/3d-models/mc-laren-570s-rocket-league-3e245bf7fb8446b8950b24999b3bf712'
  }),
  fennec: Object.freeze({
    author: 'Jako (fairlight51)',
    license: 'CC-BY-4.0',
    source: 'https://sketchfab.com/3d-models/fennec-rocket-league-car-5b43b50b6eeb4a12a29671df3418f57a'
  })
});
