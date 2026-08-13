import * as THREE from 'three';
import { getBoostStyle } from '../shared/boost-styles.js';

const REAR = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function makeSpriteTexture(shape) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.translate(32, 32);

  if (shape === 'star') {
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 4;
      const radius = i % 2 === 0 ? 27 : 7;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (shape === 'diamond') {
    const gradient = ctx.createRadialGradient(0, 0, 1, 0, 0, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,.96)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-17, -17, 34, 34);
  } else if (shape === 'ring') {
    const gradient = ctx.createRadialGradient(0, 0, 7, 0, 0, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,.15)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.68, 'rgba(255,255,255,.52)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 31, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const gradient = ctx.createRadialGradient(-5, -5, 2, 0, 0, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,.92)');
    gradient.addColorStop(0.67, 'rgba(255,255,255,.38)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 31, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export class BoostTrail {
  constructor(scene, car, options = {}) {
    this.scene = scene;
    this.car = car;
    this.mobile = Boolean(options.mobile);
    this.maxParticles = this.mobile ? 64 : 112;
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.particles = Array.from({ length: this.maxParticles }, () => ({
      life: 0,
      maxLife: 1,
      velocity: new THREE.Vector3(),
      color: new THREE.Color()
    }));
    for (let i = 0; i < this.maxParticles; i++) {
      this.positions[i * 3 + 1] = -9999;
    }

    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);

    this.style = getBoostStyle(options.style);
    this.spriteTexture = makeSpriteTexture(this.style.shape);
    this.material = new THREE.PointsMaterial({
      size: this.style.particleSize,
      map: this.spriteTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      alphaTest: 0.025,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    this.points.userData.cameraOcclusionIgnore = true;
    scene.add(this.points);

    this.cursor = 0;
    this.spawnAccumulator = 0;
    this.origin = new THREE.Vector3();
    this.rear = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.baseVelocity = new THREE.Vector3();
    this.colorA = new THREE.Color();
    this.colorB = new THREE.Color();
    this.setStyle(options.style);
  }

  setStyle(value) {
    this.style = getBoostStyle(value);
    this.colorA.setHex(this.style.primary);
    this.colorB.setHex(this.style.secondary);
    if (this.material) {
      this.material.size = this.style.particleSize * (this.mobile ? 0.92 : 1);
      const oldTexture = this.spriteTexture;
      this.spriteTexture = makeSpriteTexture(this.style.shape);
      this.material.map = this.spriteTexture;
      this.material.needsUpdate = true;
      oldTexture?.dispose?.();
    }
  }

  spawn(exhaustX, exhaustZ) {
    const index = this.cursor++ % this.maxParticles;
    const particle = this.particles[index];
    const group = this.car.group;
    const style = this.style;

    this.origin.set(exhaustX, -0.03, exhaustZ + 0.05).applyQuaternion(group.quaternion).add(group.position);
    this.rear.copy(REAR).applyQuaternion(group.quaternion).normalize();
    this.right.copy(RIGHT).applyQuaternion(group.quaternion).normalize();
    this.up.copy(UP).applyQuaternion(group.quaternion).normalize();

    const bodyVelocity = this.car.body?.linvel?.() || { x: 0, y: 0, z: 0 };
    this.baseVelocity.set(bodyVelocity.x || 0, bodyVelocity.y || 0, bodyVelocity.z || 0).multiplyScalar(0.28);
    const spreadX = (Math.random() - 0.5) * style.spread;
    const spreadY = (Math.random() - 0.5) * style.spread;
    const rearSpeed = style.trailSpeed * (0.82 + Math.random() * 0.38);
    particle.velocity.copy(this.baseVelocity)
      .addScaledVector(this.rear, rearSpeed)
      .addScaledVector(this.right, spreadX * style.trailSpeed)
      .addScaledVector(this.up, spreadY * style.trailSpeed);
    particle.life = style.life * (0.72 + Math.random() * 0.5);
    particle.maxLife = particle.life;
    particle.color.copy(Math.random() > 0.42 ? this.colorA : this.colorB);
    if (Math.random() > 0.84) particle.color.setHex(style.core);

    const offset = index * 3;
    this.positions[offset] = this.origin.x;
    this.positions[offset + 1] = this.origin.y;
    this.positions[offset + 2] = this.origin.z;
  }

  update(dt, active, exhaustX, exhaustZ) {
    const style = this.style;
    if (active) {
      const rate = style.spawnRate * (this.mobile ? 0.62 : 1);
      this.spawnAccumulator += rate * dt;
      const spawnCount = Math.min(12, Math.floor(this.spawnAccumulator));
      this.spawnAccumulator -= spawnCount;
      for (let i = 0; i < spawnCount; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        this.spawn(side * exhaustX, exhaustZ);
      }
    } else {
      this.spawnAccumulator = Math.min(this.spawnAccumulator, 0.5);
    }

    const damping = Math.exp(-style.drag * dt);
    for (let i = 0; i < this.maxParticles; i++) {
      const particle = this.particles[i];
      if (particle.life <= 0) continue;
      particle.life -= dt;
      const offset = i * 3;
      if (particle.life <= 0) {
        this.positions[offset + 1] = -9999;
        this.colors[offset] = 0;
        this.colors[offset + 1] = 0;
        this.colors[offset + 2] = 0;
        continue;
      }
      particle.velocity.multiplyScalar(damping);
      particle.velocity.y -= style.gravity * dt;
      this.positions[offset] += particle.velocity.x * dt;
      this.positions[offset + 1] += particle.velocity.y * dt;
      this.positions[offset + 2] += particle.velocity.z * dt;
      const fade = Math.min(1, Math.max(0, particle.life / particle.maxLife));
      const brightness = Math.min(1.45, 0.34 + fade * 1.18);
      this.colors[offset] = particle.color.r * brightness;
      this.colors[offset + 1] = particle.color.g * brightness;
      this.colors[offset + 2] = particle.color.b * brightness;
    }
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
  }

  clear() {
    this.spawnAccumulator = 0;
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i].life = 0;
      const offset = i * 3;
      this.positions[offset] = 0;
      this.positions[offset + 1] = -9999;
      this.positions[offset + 2] = 0;
      this.colors[offset] = 0;
      this.colors[offset + 1] = 0;
      this.colors[offset + 2] = 0;
    }
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
  }

  setVisible(visible) {
    if (this.points) this.points.visible = Boolean(visible);
    if (!visible) this.clear();
  }

  dispose() {
    this.scene?.remove(this.points);
    this.geometry?.dispose?.();
    this.material?.dispose?.();
    this.spriteTexture?.dispose?.();
  }
}
