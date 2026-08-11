import * as THREE from 'three';
import { TransformBody } from '../network/TransformBody.js';
import { BALL_TUNING } from '../shared/game-tuning.js';

function createAppleBodyGeometry(radius, lowDetail) {
  // Revolved silhouette: wide shoulders, rounded belly, tapered bottom and a
  // small top indentation. The widest point stays inside the physics sphere.
  const r = radius;
  const profile = [
    [0.10, -0.96],
    [0.43, -0.86],
    [0.73, -0.64],
    [0.91, -0.34],
    [0.97,  0.02],
    [0.95,  0.34],
    [0.84,  0.61],
    [0.61,  0.80],
    [0.30,  0.88],
    [0.13,  0.82]
  ];

  const points = profile.map(([radial, y]) => new THREE.Vector2(radial * r, y * r));
  const geometry = new THREE.LatheGeometry(points, lowDetail ? 12 : 24);
  geometry.computeVertexNormals();
  return geometry;
}

function createLeafGeometry(radius) {
  const shape = new THREE.Shape();
  const s = radius;
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.34 * s, 0.14 * s, 0.56 * s, 0.06 * s);
  shape.quadraticCurveTo(0.35 * s, -0.18 * s, 0, 0);
  const geometry = new THREE.ShapeGeometry(shape, 2);
  geometry.translate(0.02 * s, 0, 0);
  return geometry;
}

export class Ball {
  constructor(scene, world, RAPIER, input, options = {}) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.input = input;
    this.lowDetail = Boolean(options.lowDetail);
    this.clientOnly = Boolean(options.clientOnly);
    this.radius = BALL_TUNING.radius;
    this.spawn = new THREE.Vector3(0, BALL_TUNING.spawnY, 0);
    this.maxSpeed = BALL_TUNING.maxSpeed;
    this.maxAngularSpeed = BALL_TUNING.maxAngularSpeed;

    this.createPhysics();
    this.createVisual();
  }

  createPhysics() {
    if (this.clientOnly) {
      this.body = new TransformBody(this.spawn, 0);
      this.collider = null;
      return;
    }

    const R = this.RAPIER;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
      .setLinearDamping(0.035)
      .setAngularDamping(0.06)
      .setCcdEnabled(true)
      .setCanSleep(true);

    this.body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = R.ColliderDesc.ball(this.radius)
      // Radius is much larger than before. Lower density keeps total ball mass
      // close to v1.2 so cars can still launch it instead of hitting a boulder.
      .setDensity(BALL_TUNING.density)
      .setFriction(0.24)
      .setRestitution(0.62);

    this.collider = this.world.createCollider(colliderDesc, this.body);
    this.body.setAdditionalSolverIterations(2);
  }

  createVisual() {
    this.mesh = new THREE.Group();

    const appleMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0xd92b2b })
      : new THREE.MeshStandardMaterial({
          color: 0xe53b35,
          roughness: 0.68,
          metalness: 0.0
        });

    const body = new THREE.Mesh(createAppleBodyGeometry(this.radius, this.lowDetail), appleMaterial);
    this.mesh.add(body);

    const stemMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x5f371c })
      : new THREE.MeshStandardMaterial({ color: 0x5a341c, roughness: 0.95, metalness: 0 });
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(
        this.radius * 0.055,
        this.radius * 0.075,
        this.radius * 0.43,
        this.lowDetail ? 6 : 10
      ),
      stemMaterial
    );
    stem.position.set(0, this.radius * 1.01, 0);
    stem.rotation.z = -0.12;
    this.mesh.add(stem);

    const leafMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x36a84a, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({
          color: 0x3ca653,
          roughness: 0.82,
          metalness: 0,
          side: THREE.DoubleSide
        });
    const leaf = new THREE.Mesh(createLeafGeometry(this.radius), leafMaterial);
    leaf.position.set(this.radius * 0.04, this.radius * 1.08, 0);
    leaf.rotation.set(-0.38, 0.48, 0.24);
    this.mesh.add(leaf);

    this.scene.add(this.mesh);

    if (this.lowDetail) {
      this.shadow = null;
      return;
    }

    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(this.radius * 1.08, 16), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.018;
    this.scene.add(this.shadow);
  }

  fixedUpdate() {
    if (this.body.translation().y < -12) {
      this.reset();
      return;
    }

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

    if (this.shadow) {
      this.shadow.position.x = p.x;
      this.shadow.position.z = p.z;
      const height = Math.max(0, p.y - this.radius);
      const scale = THREE.MathUtils.clamp(1.12 - height * 0.045, 0.5, 1.12);
      this.shadow.scale.setScalar(scale);
      this.shadow.material.opacity = THREE.MathUtils.clamp(0.3 - height * 0.016, 0.06, 0.3);
    }
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
