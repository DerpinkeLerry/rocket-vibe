import * as THREE from 'three';
import { ARENA_TUNING } from '../shared/arena-tuning.js';

const clamp = THREE.MathUtils.clamp;
const fract = (value) => value - Math.floor(value);
const hash = (index, salt = 0) => fract(Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453);

export class GoalExplosion {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.lowDetail = Boolean(options.lowDetail);
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.mobile = Boolean(options.mobile);
    this.enabled = !this.lowDetail;
    this.active = false;
    this.elapsed = 0;
    this.duration = 1.28;
    this.origin = new THREE.Vector3();
    this.teamColor = new THREE.Color(0x0a86ff);
    this.white = new THREE.Color(0xffffff);
    this.dummy = new THREE.Object3D();
    this.temp = new THREE.Vector3();

    if (!this.enabled) return;

    this.count = this.ultraHigh ? (this.mobile ? 108 : 176) : (this.mobile ? 72 : 104);
    this.directions = Array.from({ length: this.count }, () => new THREE.Vector3());
    this.speeds = new Float32Array(this.count);
    this.baseScales = new Float32Array(this.count);
    this.spins = new Float32Array(this.count);

    const particleGeometry = new THREE.TetrahedronGeometry(0.18, 0);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    this.particles = new THREE.InstancedMesh(particleGeometry, particleMaterial, this.count);
    this.particles.name = 'goal-explosion-particles';
    this.particles.frustumCulled = false;
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.userData.cameraOcclusionIgnore = true;
    this.particles.visible = false;
    scene.add(this.particles);

    const ringSegments = this.ultraHigh ? 64 : 40;
    this.rings = [0, 1].map((index) => {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1.02, ringSegments), material);
      ring.name = `goal-explosion-ring-${index}`;
      ring.visible = false;
      ring.frustumCulled = false;
      ring.renderOrder = 18;
      ring.userData.cameraOcclusionIgnore = true;
      scene.add(ring);
      return ring;
    });

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false
    }));
    this.flash.name = 'goal-explosion-flash';
    this.flash.visible = false;
    this.flash.userData.cameraOcclusionIgnore = true;
    scene.add(this.flash);

    this.light = null;
    if (this.ultraHigh) {
      this.light = new THREE.PointLight(0xffffff, 0, this.mobile ? 24 : 34, 2.0);
      this.light.name = 'goal-explosion-light';
      scene.add(this.light);
    }
  }

  trigger({ goalSign = 1, scoringTeam = 'blue', position = null, durationMs = null } = {}) {
    if (!this.enabled) return;
    const sign = Number(goalSign) >= 0 ? 1 : -1;
    const parsedDurationMs = Number(durationMs);
    this.duration = Number.isFinite(parsedDurationMs) ? clamp(parsedDurationMs / 1000, 0, 2.0) : 1.28;
    if (this.duration <= 0) {
      this.stop();
      return;
    }
    this.elapsed = 0;
    this.active = true;
    this.teamColor.set(scoringTeam === 'orange' ? 0xff6508 : 0x087dff);

    const fallbackZ = sign * (ARENA_TUNING.length * 0.5 + 1.25);
    const x = clamp(Number(position?.[0]) || 0, -ARENA_TUNING.goalWidth * 0.42, ARENA_TUNING.goalWidth * 0.42);
    const y = clamp(Number(position?.[1]) || ARENA_TUNING.goalHeight * 0.42, 2.4, ARENA_TUNING.goalHeight - 1.2);
    const z = Number.isFinite(Number(position?.[2])) ? Number(position[2]) : fallbackZ;
    this.origin.set(x, y, z);

    for (let index = 0; index < this.count; index++) {
      const a = hash(index, 1) * Math.PI * 2;
      const spread = 0.26 + hash(index, 2) * 0.92;
      const vertical = -0.10 + hash(index, 3) * 1.06;
      const towardField = -sign * (0.50 + hash(index, 4) * 0.92);
      this.directions[index].set(Math.cos(a) * spread, vertical, towardField).normalize();
      this.speeds[index] = 8.5 + hash(index, 5) * (this.ultraHigh ? 17 : 14);
      this.baseScales[index] = 0.58 + hash(index, 6) * 1.18;
      this.spins[index] = (hash(index, 7) - 0.5) * 8.0;
      const mix = hash(index, 8) > 0.76 ? 0.65 : hash(index, 9) * 0.22;
      const color = this.teamColor.clone().lerp(this.white, mix);
      this.particles.setColorAt(index, color);
    }
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;

    this.particles.visible = true;
    this.particles.material.opacity = 1;
    for (const ring of this.rings) {
      ring.position.copy(this.origin);
      ring.material.color.copy(this.teamColor);
      ring.material.opacity = 0.9;
      ring.scale.setScalar(1);
      ring.visible = true;
    }
    this.flash.position.copy(this.origin);
    this.flash.material.color.copy(this.teamColor).lerp(this.white, 0.26);
    this.flash.material.opacity = 0.92;
    this.flash.scale.set(5.5, 5.5, 1);
    this.flash.visible = true;
    if (this.light) {
      this.light.position.copy(this.origin);
      this.light.color.copy(this.teamColor);
      this.light.intensity = this.mobile ? 16 : 25;
    }
    this.update(0);
  }

  update(dt) {
    if (!this.enabled || !this.active) return;
    this.elapsed += Math.max(0, Number(dt) || 0);
    const p = clamp(this.elapsed / this.duration, 0, 1);
    const travelT = (1 - Math.exp(-2.45 * this.elapsed)) / 2.45;
    const fade = Math.pow(1 - p, 1.42);

    for (let index = 0; index < this.count; index++) {
      const direction = this.directions[index];
      const distance = this.speeds[index] * travelT;
      this.temp.copy(direction).multiplyScalar(distance).add(this.origin);
      this.temp.y -= 2.8 * this.elapsed * this.elapsed;
      this.dummy.position.copy(this.temp);
      const spin = this.spins[index] * this.elapsed;
      this.dummy.rotation.set(spin * 0.7, spin, spin * 0.45);
      const scale = this.baseScales[index] * (0.72 + p * 1.30);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.particles.setMatrixAt(index, this.dummy.matrix);
    }
    this.particles.instanceMatrix.needsUpdate = true;
    this.particles.material.opacity = fade;

    const ring1 = this.rings[0];
    const ring2 = this.rings[1];
    ring1.scale.setScalar(1 + p * 13.5);
    ring1.material.opacity = 0.74 * Math.pow(1 - p, 1.65);
    ring2.scale.setScalar(1 + p * 8.5);
    ring2.material.opacity = 0.48 * Math.pow(1 - p, 1.15);

    this.flash.scale.setScalar(5.5 + p * 18);
    this.flash.material.opacity = 0.74 * Math.pow(1 - p, 2.3);
    if (this.light) this.light.intensity = (this.mobile ? 16 : 25) * Math.pow(1 - p, 2.1);

    if (p >= 1) this.stop();
  }

  stop() {
    this.active = false;
    if (!this.enabled) return;
    this.particles.visible = false;
    this.particles.material.opacity = 0;
    for (const ring of this.rings) {
      ring.visible = false;
      ring.material.opacity = 0;
    }
    this.flash.visible = false;
    this.flash.material.opacity = 0;
    if (this.light) this.light.intensity = 0;
  }
}
