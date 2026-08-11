import * as THREE from 'three';

const BALL_RADIUS = 0.92;

function makeBallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, '#dbe5e8');
  bg.addColorStop(0.5, '#9eaeb5');
  bg.addColorStop(1, '#687981');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // A lightweight, original sci-fi panel pattern inspired by arena footballs.
  // It is deliberately not a copy of Rocket League's texture/asset.
  const hexR = 28;
  const hexH = Math.sqrt(3) * hexR;
  const cols = 8;
  const rows = 5;

  function hexPath(cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i + Math.PI / 6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  for (let row = -1; row <= rows; row++) {
    for (let col = -1; col <= cols; col++) {
      const cx = col * hexR * 1.52 + (row % 2 ? hexR * 0.76 : 0) + 20;
      const cy = row * hexH * 0.86 + 26;
      const hash = Math.abs((row * 17 + col * 31) % 7);
      const darkPanel = hash === 0 || hash === 3;

      hexPath(cx, cy, hexR * 0.78);
      ctx.fillStyle = darkPanel ? '#18242b' : 'rgba(238,246,248,0.18)';
      ctx.fill();
      ctx.lineWidth = darkPanel ? 4 : 2;
      ctx.strokeStyle = darkPanel ? '#071016' : 'rgba(28,48,58,0.52)';
      ctx.stroke();

      if (darkPanel) {
        hexPath(cx, cy, hexR * 0.48);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#47dfff';
        ctx.stroke();
      }
    }
  }

  // Small orange accents keep the ball readable at distance.
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#ff8a2a';
  ctx.lineWidth = 4;
  for (let x = -30; x < canvas.width + 40; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, canvas.height * 0.2);
    ctx.lineTo(x + 50, canvas.height * 0.28);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class Ball {
  constructor(scene, world, RAPIER, input) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.input = input;
    this.radius = BALL_RADIUS;
    this.spawn = new THREE.Vector3(0, 4.2, 0);
    this.maxSpeed = 56;
    this.maxAngularSpeed = 32;

    this.createPhysics();
    this.createVisual();
  }

  createPhysics() {
    const R = this.RAPIER;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
      .setLinearDamping(0.035)
      .setAngularDamping(0.06)
      .setCcdEnabled(true)
      .setCanSleep(true);

    this.body = this.world.createRigidBody(bodyDesc);

    // ~30 kg ball against the current car mass. High restitution gives the
    // familiar lively arena-ball bounce without becoming a superball.
    const colliderDesc = R.ColliderDesc.ball(this.radius)
      .setDensity(9.1)
      .setFriction(0.24)
      .setRestitution(0.62);

    this.collider = this.world.createCollider(colliderDesc, this.body);
    this.body.setAdditionalSolverIterations(2);
  }

  createVisual() {
    const texture = makeBallTexture();
    const geometry = new THREE.SphereGeometry(this.radius, 24, 16);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.48,
      metalness: 0.36,
      emissive: new THREE.Color(0x062735),
      emissiveIntensity: 0.42
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    // Cheap fake shadow: no shadow-map render pass required.
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(this.radius * 1.1, 16), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.018;
    this.scene.add(this.shadow);
  }

  fixedUpdate() {
    if (this.input.consumePressed('KeyB') || this.body.translation().y < -12) {
      this.reset();
      return;
    }

    // Prevent rare tunnelling/energy spikes after hard car-wall-ball impacts.
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > this.maxSpeed) {
      const s = this.maxSpeed / speed;
      this.body.setLinvel({ x: v.x * s, y: v.y * s, z: v.z * s }, true);
    }

    const w = this.body.angvel();
    const spin = Math.hypot(w.x, w.y, w.z);
    if (spin > this.maxAngularSpeed) {
      const s = this.maxAngularSpeed / spin;
      this.body.setAngvel({ x: w.x * s, y: w.y * s, z: w.z * s }, true);
    }
  }

  syncVisual() {
    const p = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    this.shadow.position.x = p.x;
    this.shadow.position.z = p.z;
    const height = Math.max(0, p.y - this.radius);
    const scale = THREE.MathUtils.clamp(1.12 - height * 0.045, 0.5, 1.12);
    this.shadow.scale.setScalar(scale);
    this.shadow.material.opacity = THREE.MathUtils.clamp(0.3 - height * 0.016, 0.06, 0.3);
  }

  reset() {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
  }
}
