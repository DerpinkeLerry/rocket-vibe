import * as THREE from 'three';
import { ALL_BOOST_PADS_MASK, BOOST_PADS } from '../shared/boost-tuning.js';

export class BoostPads {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.lowDetail = Boolean(options.lowDetail);
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.elapsed = 0;
    this.activeMask = ALL_BOOST_PADS_MASK;
    this.pads = BOOST_PADS.map((spec) => this.createPad(spec));
  }

  createPad(spec) {
    const group = new THREE.Group();
    group.position.set(spec.x, 0.035, spec.z);
    group.userData.cameraOcclusionIgnore = true;
    this.scene.add(group);

    const large = spec.kind === 'large';
    const baseRadius = large ? 2.35 : 1.08;
    const baseMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: large ? 0xff9b35 : 0xffc65b, transparent: true, opacity: 0.48 })
      : new THREE.MeshStandardMaterial({
          color: large ? 0xff9b35 : 0xffc65b,
          emissive: large ? 0xff5a00 : 0xff9a16,
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
      ? new THREE.MeshBasicMaterial({ color: 0xffd27a, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      : new THREE.MeshStandardMaterial({
          color: 0xffd27a,
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
          color: 0xffc15a,
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
    this.activeMask = Number(mask) & ALL_BOOST_PADS_MASK;
    for (const pad of this.pads) {
      const active = Boolean(this.activeMask & (1 << pad.spec.id));
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
          this.activeMask |= 1 << pad.spec.id;
          this.applyVisualState(pad);
        }
        continue;
      }

      if (p.y > 2.45) continue;
      const dx = p.x - pad.spec.x;
      const dz = p.z - pad.spec.z;
      if (dx * dx + dz * dz > pad.spec.radius * pad.spec.radius) continue;

      const collected = car.collectBoostPad?.(pad.spec.amount, pad.spec.kind === 'large');
      if (!collected) continue;
      pad.active = false;
      pad.respawnRemaining = pad.spec.respawn;
      this.activeMask &= ~(1 << pad.spec.id);
      this.applyVisualState(pad);
    }
  }

  update(dt) {
    this.elapsed += dt;
    for (const pad of this.pads) {
      if (!pad.active) continue;
      const large = pad.spec.kind === 'large';
      pad.pickup.rotation.y += dt * (large ? 1.8 : 2.8);
      pad.pickup.rotation.x += dt * (large ? 0.7 : 1.1);
      const pulse = 1 + Math.sin(this.elapsed * (large ? 3.0 : 4.8) + pad.spec.id) * (large ? 0.08 : 0.12);
      pad.pickup.scale.setScalar(pulse);
      pad.ring.rotation.z += dt * (large ? 0.55 : 0.85);
    }
  }

  applyVisualState(pad) {
    pad.pickup.visible = pad.active;
    pad.ring.visible = pad.active;
    pad.base.material.opacity = pad.active ? 0.5 : 0.16;
  }
}
