import * as THREE from 'three';

const PREMIUM_BALL_URL = new URL('../assets/rocket-league-ball.glb', import.meta.url).href;
let ballTemplatePromise = null;

function normalizeBallTemplate(scene, radius) {
  const wrapper = new THREE.Group();
  wrapper.name = 'RocketLeaguePremiumBallTemplate';
  wrapper.add(scene);

  scene.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const diameter = radius * 2;
  const maxAxis = Math.max(size.x, size.y, size.z, 1e-6);
  scene.scale.multiplyScalar(diameter / maxAxis);
  scene.updateMatrixWorld(true);

  bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.sub(center);
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

async function getTemplate(radius) {
  if (!ballTemplatePromise) {
    ballTemplatePromise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(PREMIUM_BALL_URL))
      .then((gltf) => normalizeBallTemplate(gltf.scene, radius))
      .catch((error) => {
        ballTemplatePromise = null;
        throw error;
      });
  }
  return ballTemplatePromise;
}

function tuneBallMaterials(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sources.map((source) => {
      const material = source?.clone?.() || source;
      if (!material) return material;
      const name = String(material.name || '').toLowerCase();
      if (name === 'mat.3') {
        if ('roughness' in material) material.roughness = 0.46;
        if ('metalness' in material) material.metalness = 0.30;
        if ('clearcoat' in material) material.clearcoat = 0.12;
        if ('clearcoatRoughness' in material) material.clearcoatRoughness = 0.52;
        if ('envMapIntensity' in material) material.envMapIntensity = 0.42;
      } else if (name === 'mat.4') {
        material.color?.setHex(0xbce9ff);
        if (material.emissive) material.emissive.setHex(0x4aaeff);
        if ('emissiveIntensity' in material) material.emissiveIntensity = 1.7;
        if ('roughness' in material) material.roughness = 0.28;
      }
      material.needsUpdate = true;
      return material;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
}

export async function createPremiumBallVisual(radius) {
  const template = await getTemplate(radius);
  const root = template.clone(true);
  root.name = 'RocketLeaguePremiumBallVisual';
  tuneBallMaterials(root);
  return root;
}

export const PREMIUM_BALL_ASSET_INFO = Object.freeze({
  author: 'Jako (fairlight51)',
  license: 'CC-BY-4.0',
  source: 'https://sketchfab.com/3d-models/ball-rocket-league-2c8911aa1dcd4c53bad842f2d354dfe2'
});
