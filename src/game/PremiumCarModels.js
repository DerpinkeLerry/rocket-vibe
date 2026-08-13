import * as THREE from 'three';

const FENNEC_MODEL_URL = new URL('../assets/fennec-rocket-league.glb', import.meta.url).href;
const FENNEC_TARGET_LENGTH = 3.10;
const FENNEC_BOTTOM_Y = -0.52;

let fennecTemplatePromise = null;

function normalizeFennecTemplate(scene) {
  const wrapper = new THREE.Group();
  wrapper.name = 'FennecPremiumTemplate';
  wrapper.add(scene);

  scene.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.x > 1e-6 ? FENNEC_TARGET_LENGTH / size.x : 1;
  scene.scale.multiplyScalar(scale);
  scene.updateMatrixWorld(true);

  bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y += FENNEC_BOTTOM_Y - bounds.min.y;

  // The uploaded Sketchfab asset uses +X as the vehicle's forward direction.
  // Rocket Vibe uses -Z, so a +90 degree Y rotation aligns it with every
  // existing car transform without touching the gameplay hitbox.
  wrapper.rotation.y = Math.PI / 2;
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

async function getFennecTemplate() {
  if (!fennecTemplatePromise) {
    fennecTemplatePromise = import('three/addons/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(FENNEC_MODEL_URL))
      .then((gltf) => normalizeFennecTemplate(gltf.scene))
      .catch((error) => {
        fennecTemplatePromise = null;
        throw error;
      });
  }
  return fennecTemplatePromise;
}

function cloneInstanceMaterials(root, paintColor) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = false;

    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sourceMaterials.map((source) => {
      const material = source?.clone?.() || source;
      if (!material) return material;

      const name = String(material.name || '').toLowerCase();
      if (name.includes('fennec_-_body') || name === 'fennec - body') {
        material.color?.setHex(paintColor);
        if ('roughness' in material) material.roughness = Math.max(0.38, material.roughness ?? 0.38);
        if ('metalness' in material) material.metalness = Math.min(0.42, material.metalness ?? 0.3);
        if ('clearcoat' in material) material.clearcoat = 0.24;
        if ('clearcoatRoughness' in material) material.clearcoatRoughness = 0.42;
      } else if (name === 'paint') {
        material.color?.setHex(0x11171d);
        if ('roughness' in material) material.roughness = 0.55;
        if ('metalness' in material) material.metalness = 0.28;
      } else if (name === 'window') {
        material.color?.setHex(0x091a25);
        if ('roughness' in material) material.roughness = 0.30;
        if ('metalness' in material) material.metalness = 0.02;
      } else if (name === 'headlights') {
        material.color?.setHex(0xe9faff);
        if (material.emissive) material.emissive.setHex(0x9feaff);
        if ('emissiveIntensity' in material) material.emissiveIntensity = 2.2;
        if ('roughness' in material) material.roughness = 0.30;
      } else if (name.includes('alpha_rim')) {
        if ('roughness' in material) material.roughness = Math.max(0.34, material.roughness ?? 0.34);
        if ('metalness' in material) material.metalness = Math.max(0.62, material.metalness ?? 0.62);
      }
      material.needsUpdate = true;
      return material;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
}

function collectWheelParts(root) {
  const wheelGroups = [];
  const wheelMeshes = [];
  root.traverse((object) => {
    const name = String(object.name || '');
    if (!object.isMesh && /^Alpha - (FR|FL|BR|BL) \(Fennec\)$/.test(name)) {
      object.userData.baseQuaternion = object.quaternion.clone();
      object.userData.frontWheel = name.includes('FR') || name.includes('FL');
      wheelGroups.push(object);
    }
    if (object.isMesh && (name.includes('Alpha Rim') || name.includes('Dieci Tread'))) {
      object.userData.baseRotationY = object.rotation.y;
      wheelMeshes.push(object);
    }
  });
  return { wheelGroups, wheelMeshes };
}

export async function createFennecPremiumVisual(paintColor = 0xf46b20) {
  const template = await getFennecTemplate();
  const root = template.clone(true);
  root.name = 'FennecPremiumVisual';
  cloneInstanceMaterials(root, paintColor);
  const { wheelGroups, wheelMeshes } = collectWheelParts(root);
  return { root, wheelGroups, wheelMeshes };
}

export const PREMIUM_CAR_ASSET_INFO = Object.freeze({
  fennec: Object.freeze({
    author: 'Jako (fairlight51)',
    license: 'CC-BY-4.0',
    source: 'Sketchfab model 5b43b50b6eeb4a12a29671df3418f57a'
  })
});
