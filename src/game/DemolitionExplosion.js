import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const fract = (value) => value - Math.floor(value);
const hash = (index, salt = 0) => fract(Math.sin((index + 1) * 19.193 + salt * 73.417) * 43758.5453);

export class DemolitionExplosion {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.enabled = Boolean(options.ultraHigh) && !Boolean(options.lowDetail);
    this.mobile = Boolean(options.mobile);
    this.duration = 0.72;
    this.slotCount = 2;
    this.particleCount = this.mobile ? 30 : 46;
    this.dummy = new THREE.Object3D();
    this.temp = new THREE.Vector3();
    this.white = new THREE.Color(0xfff7d2);
    this.orange = new THREE.Color(0xff7a12);
    this.gold = new THREE.Color(0xffc72d);
    this.slots = [];

    if (!this.enabled) return;

    this.geometry = new THREE.TetrahedronGeometry(this.mobile ? 0.105 : 0.125, 0);
    for (let slotIndex = 0; slotIndex < this.slotCount; slotIndex++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      });
      const particles = new THREE.InstancedMesh(this.geometry, material, this.particleCount);
      particles.name = `demolition-explosion-particles-${slotIndex}`;
      particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      particles.frustumCulled = false;
      particles.visible = false;
      particles.userData.cameraOcclusionIgnore = true;
      scene.add(particles);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.48, 0.68, this.mobile ? 32 : 48),
        new THREE.MeshBasicMaterial({
          color: 0xff8b18,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false
        })
      );
      ring.name = `demolition-explosion-ring-${slotIndex}`;
      ring.visible = false;
      ring.frustumCulled = false;
      ring.renderOrder = 19;
      ring.userData.cameraOcclusionIgnore = true;
      scene.add(ring);

      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xffd36a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }));
      flash.name = `demolition-explosion-flash-${slotIndex}`;
      flash.visible = false;
      flash.userData.cameraOcclusionIgnore = true;
      scene.add(flash);

      const light = new THREE.PointLight(0xff8a18, 0, this.mobile ? 10 : 14, 2.15);
      light.name = `demolition-explosion-light-${slotIndex}`;
      scene.add(light);

      this.slots.push({
        active: false,
        elapsed: 0,
        startedAt: -Infinity,
        origin: new THREE.Vector3(),
        particles,
        ring,
        flash,
        light,
        directions: Array.from({ length: this.particleCount }, () => new THREE.Vector3()),
        speeds: new Float32Array(this.particleCount),
        scales: new Float32Array(this.particleCount),
        spins: new Float32Array(this.particleCount)
      });
    }
  }

  trigger(position = null) {
    if (!this.enabled) return;
    let slot = this.slots.find((candidate) => !candidate.active);
    if (!slot) slot = this.slots.reduce((oldest, candidate) => candidate.startedAt < oldest.startedAt ? candidate : oldest, this.slots[0]);

    slot.elapsed = 0;
    slot.startedAt = performance.now();
    slot.active = true;
    const x = Number(position?.[0]) || 0;
    const y = Math.max(0.6, Number(position?.[1]) || 0.6) + 0.35;
    const z = Number(position?.[2]) || 0;
    slot.origin.set(x, y, z);

    for (let index = 0; index < this.particleCount; index++) {
      const angle = hash(index, slot.startedAt * 0.001 + 1) * Math.PI * 2;
      const horizontal = 0.34 + hash(index, 2) * 0.82;
      const vertical = -0.04 + hash(index, 3) * 0.95;
      slot.directions[index].set(Math.cos(angle) * horizontal, vertical, Math.sin(angle) * horizontal).normalize();
      slot.speeds[index] = 5.2 + hash(index, 4) * (this.mobile ? 8.5 : 11.0);
      slot.scales[index] = 0.58 + hash(index, 5) * 1.15;
      slot.spins[index] = (hash(index, 6) - 0.5) * 12;
      const colorPick = hash(index, 7);
      const color = colorPick > 0.78 ? this.white : (colorPick > 0.38 ? this.gold : this.orange);
      slot.particles.setColorAt(index, color);
    }
    if (slot.particles.instanceColor) slot.particles.instanceColor.needsUpdate = true;

    slot.particles.visible = true;
    slot.particles.material.opacity = 1;
    slot.ring.position.copy(slot.origin);
    slot.ring.rotation.set(-Math.PI / 2, 0, 0);
    slot.ring.scale.setScalar(1);
    slot.ring.material.opacity = 0.72;
    slot.ring.visible = true;
    slot.flash.position.copy(slot.origin);
    slot.flash.scale.setScalar(this.mobile ? 2.6 : 3.2);
    slot.flash.material.opacity = 0.88;
    slot.flash.visible = true;
    slot.light.position.copy(slot.origin);
    slot.light.intensity = this.mobile ? 7.5 : 11;
    this.updateSlot(slot, 0);
  }

  update(dt) {
    if (!this.enabled) return;
    const step = Math.max(0, Number(dt) || 0);
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.elapsed += step;
      this.updateSlot(slot, step);
    }
  }

  updateSlot(slot) {
    const p = clamp(slot.elapsed / this.duration, 0, 1);
    const fade = Math.pow(1 - p, 1.55);
    const travelT = (1 - Math.exp(-4.2 * slot.elapsed)) / 4.2;

    for (let index = 0; index < this.particleCount; index++) {
      const distance = slot.speeds[index] * travelT;
      this.temp.copy(slot.directions[index]).multiplyScalar(distance).add(slot.origin);
      this.temp.y -= 1.7 * slot.elapsed * slot.elapsed;
      this.dummy.position.copy(this.temp);
      const spin = slot.spins[index] * slot.elapsed;
      this.dummy.rotation.set(spin, spin * 0.72, spin * 0.48);
      const scale = slot.scales[index] * (0.70 + p * 0.75);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      slot.particles.setMatrixAt(index, this.dummy.matrix);
    }
    slot.particles.instanceMatrix.needsUpdate = true;
    slot.particles.material.opacity = fade;

    slot.ring.scale.setScalar(1 + p * 7.5);
    slot.ring.material.opacity = 0.58 * Math.pow(1 - p, 1.7);
    slot.flash.scale.setScalar((this.mobile ? 2.6 : 3.2) + p * (this.mobile ? 4.8 : 6.3));
    slot.flash.material.opacity = 0.72 * Math.pow(1 - p, 2.5);
    slot.light.intensity = (this.mobile ? 7.5 : 11) * Math.pow(1 - p, 2.6);

    if (p >= 1) this.stopSlot(slot);
  }

  stopSlot(slot) {
    slot.active = false;
    slot.particles.visible = false;
    slot.particles.material.opacity = 0;
    slot.ring.visible = false;
    slot.ring.material.opacity = 0;
    slot.flash.visible = false;
    slot.flash.material.opacity = 0;
    slot.light.intensity = 0;
  }

  stop() {
    if (!this.enabled) return;
    for (const slot of this.slots) this.stopSlot(slot);
  }
}
