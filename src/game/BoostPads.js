import * as THREE from 'three';
import {
  ALL_BOOST_PADS_MASK,
  BOOST_PADS,
  BOOST_PAD_VISUAL_SCALE,
  isBoostPadActive,
  isWithinBoostPadPickup,
  withBoostPadActive
} from '../shared/boost-tuning.js';

export class BoostPads {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.lowDetail = Boolean(options.lowDetail);
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.elapsed = 0;
    this.activeMask = ALL_BOOST_PADS_MASK;
    this.lowMesh = null;
    this.lowDummy = null;
    this.pads = this.lowDetail ? this.createUltraLowPads() : BOOST_PADS.map((spec) => this.createPad(spec));
  }

  createUltraLowPads() {
    // One unlit instanced disc replaces 34 groups x 3 animated meshes.  This is
    // intentionally static: active/inactive state is the only matrix update.
    const geometry = new THREE.CircleGeometry(1, 8);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.lowMesh = new THREE.InstancedMesh(geometry, material, BOOST_PADS.length);
    this.lowMesh.name = 'vm-boost-pads';
    this.lowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lowMesh.userData.cameraOcclusionIgnore = true;
    this.lowDummy = new THREE.Object3D();

    const pads = BOOST_PADS.map((spec, index) => ({
      spec,
      index,
      group: null,
      base: null,
      ring: null,
      pickup: null,
      active: true,
      respawnRemaining: 0
    }));

    for (const pad of pads) {
      this.writeUltraLowInstance(pad);
      this.lowMesh.setColorAt(
        pad.index,
        new THREE.Color(pad.spec.kind === 'large' ? 0xff8a22 : 0xffcf59)
      );
    }
    this.lowMesh.instanceMatrix.needsUpdate = true;
    if (this.lowMesh.instanceColor) this.lowMesh.instanceColor.needsUpdate = true;
    this.lowMesh.computeBoundingSphere?.();
    this.scene.add(this.lowMesh);
    return pads;
  }

  writeUltraLowInstance(pad) {
    if (!this.lowMesh || !this.lowDummy || !pad) return;
    const radius = (pad.spec.kind === 'large' ? 1.55 : 0.68) * BOOST_PAD_VISUAL_SCALE;
    const scale = pad.active ? radius : 0.001;
    this.lowDummy.position.set(pad.spec.x, 0.045, pad.spec.z);
    this.lowDummy.rotation.set(0, 0, 0);
    this.lowDummy.scale.set(scale, scale, scale);
    this.lowDummy.updateMatrix();
    this.lowMesh.setMatrixAt(pad.index, this.lowDummy.matrix);
  }

  createPad(spec) {
    const group = new THREE.Group();
    group.position.set(spec.x, 0.035, spec.z);
    group.scale.setScalar(BOOST_PAD_VISUAL_SCALE);
    group.userData.cameraOcclusionIgnore = true;
    this.scene.add(group);

    const large = spec.kind === 'large';
    const baseRadius = large ? 2.35 : 1.08;
    const baseMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: large ? 0xff8a22 : 0xffc34e, transparent: true, opacity: 0.48 })
      : new THREE.MeshStandardMaterial({
          color: large ? 0xff8a22 : 0xffc34e,
          emissive: large ? 0xff4b00 : 0xff8b0b,
          emissiveIntensity: large ? (this.ultraHigh ? 0.88 : 0.8) : (this.ultraHigh ? 0.56 : 0.45),
          roughness: this.ultraHigh ? 0.5 : 0.48,
          metalness: this.ultraHigh ? 0.24 : 0.22,
          transparent: true,
          opacity: 0.5
        });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(baseRadius, baseRadius, 0.09, large ? 28 : 18), baseMaterial);
    base.position.y = 0.015;
    group.add(base);

    const ringMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0xffd36b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      : new THREE.MeshStandardMaterial({
          color: 0xffd36b,
          emissive: 0xff8a14,
          emissiveIntensity: large ? (this.ultraHigh ? 3.5 : 3.1) : (this.ultraHigh ? 2.6 : 2.1),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.94,
          depthWrite: false
        });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(baseRadius * 0.58, baseRadius * 0.92, large ? 32 : 20),
      ringMaterial
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);

    const pickupMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0xffb13b })
      : new THREE.MeshStandardMaterial({
          color: 0xffbd43,
          emissive: 0xff760d,
          emissiveIntensity: large ? (this.ultraHigh ? 5.1 : 4.5) : (this.ultraHigh ? 3.6 : 3.0),
          roughness: this.ultraHigh ? 0.3 : 0.2,
          metalness: this.ultraHigh ? 0.22 : 0.2
        });
    const pickup = new THREE.Mesh(
      large ? new THREE.IcosahedronGeometry(0.83, 1) : new THREE.OctahedronGeometry(0.34, 0),
      pickupMaterial
    );
    pickup.position.y = large ? 1.15 : 0.42;
    group.add(pickup);

    return { spec, group, base, ring, pickup, active: true, respawnRemaining: 0 };
  }

  resetAll() {
    this.activeMask = ALL_BOOST_PADS_MASK;
    for (const pad of this.pads) {
      pad.active = true;
      pad.respawnRemaining = 0;
      this.applyVisualState(pad);
    }
  }

  setActiveMask(mask) {
    if (!Number.isFinite(Number(mask))) return;
    this.activeMask = Math.max(0, Math.min(ALL_BOOST_PADS_MASK, Math.floor(Number(mask))));
    for (const pad of this.pads) {
      const active = isBoostPadActive(this.activeMask, pad.spec.id);
      if (pad.active === active) continue;
      pad.active = active;
      pad.respawnRemaining = 0;
      this.applyVisualState(pad);
    }
  }

  updateOffline(car, dt) {
    const p = car?.body?.translation?.();
    if (!p) return;

    for (const pad of this.pads) {
      if (!pad.active) {
        pad.respawnRemaining = Math.max(0, pad.respawnRemaining - dt);
        if (pad.respawnRemaining <= 0) {
          pad.active = true;
          this.activeMask = withBoostPadActive(this.activeMask, pad.spec.id, true);
          this.applyVisualState(pad);
        }
        continue;
      }

      if (p.y > 2.45) continue;
      if (!isWithinBoostPadPickup(pad.spec, p.x, p.z)) continue;

      const collected = car.collectBoostPad?.(pad.spec.amount, pad.spec.kind === 'large');
      if (!collected) continue;
      pad.active = false;
      pad.respawnRemaining = pad.spec.respawn;
      this.activeMask = withBoostPadActive(this.activeMask, pad.spec.id, false);
      this.applyVisualState(pad);
    }
  }

  update(dt) {
    if (this.lowDetail) return;
    this.elapsed += dt;
    for (const pad of this.pads) {
      if (!pad.active) continue;
      const large = pad.spec.kind === 'large';
      pad.pickup.rotation.y += dt * (large ? 1.8 : 2.8);
      pad.pickup.rotation.x += dt * (large ? 0.7 : 1.1);
      const wave = Math.sin(this.elapsed * (large ? 3.0 : 4.8) + pad.spec.id);
      const pulse = 1 + wave * (large ? 0.08 : 0.12);
      pad.pickup.scale.setScalar(pulse);
      pad.ring.rotation.z += dt * (large ? 0.55 : 0.85);
      // A material-only pulse makes the 34-pad network feel alive without any
      // extra meshes, lights or draw calls.
      pad.ring.material.opacity = large ? 0.82 + wave * 0.10 : 0.72 + wave * 0.14;
    }
  }

  applyVisualState(pad) {
    if (this.lowDetail) {
      this.writeUltraLowInstance(pad);
      if (this.lowMesh) this.lowMesh.instanceMatrix.needsUpdate = true;
      return;
    }
    pad.pickup.visible = pad.active;
    pad.ring.visible = pad.active;
    pad.base.material.opacity = pad.active ? 0.5 : 0.16;
  }
}
