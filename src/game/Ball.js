import * as THREE from 'three';
import { TransformBody } from '../network/TransformBody.js';
import { BALL_TUNING } from '../shared/game-tuning.js';
import { CAR_HITBOX } from '../shared/arena-tuning.js';

function createAppleBodyGeometry(radius, lowDetail, ultraHigh = false) {
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
  const geometry = new THREE.LatheGeometry(points, lowDetail ? 12 : (ultraHigh ? 40 : 24));
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
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.clientOnly = Boolean(options.clientOnly);
    this.radius = BALL_TUNING.radius;
    this.spawn = new THREE.Vector3(0, BALL_TUNING.spawnY, 0);
    this.maxSpeed = BALL_TUNING.maxSpeed;
    this.maxAngularSpeed = BALL_TUNING.maxAngularSpeed;
    this.carContactActive = false;
    this.pendingHitSpeed = 0;
    this.pendingHitNormal = new THREE.Vector3();
    this.hitBallPos = new THREE.Vector3();
    this.hitCarPos = new THREE.Vector3();
    this.hitLocal = new THREE.Vector3();
    this.hitClosest = new THREE.Vector3();
    this.hitDelta = new THREE.Vector3();
    this.hitNormal = new THREE.Vector3();
    this.hitQuat = new THREE.Quaternion();
    this.hitInverseQuat = new THREE.Quaternion();

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
      .setLinearDamping(BALL_TUNING.linearDamping)
      .setAngularDamping(BALL_TUNING.angularDamping)
      .setCcdEnabled(true)
      .setSoftCcdPrediction(0.45)
      .setCanSleep(true);

    this.body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = R.ColliderDesc.ball(this.radius)
      // Radius is much larger than before. Lower density keeps total ball mass
      // close to v1.2 so cars can still launch it instead of hitting a boulder.
      .setDensity(BALL_TUNING.density)
      .setFriction(BALL_TUNING.friction)
      .setRestitution(BALL_TUNING.restitution)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
      .setContactSkin(0.01);

    this.collider = this.world.createCollider(colliderDesc, this.body);
    // Extra local solver work is cheap for a single ball and helps the sphere
    // stay stable where the flat floor meets the segmented wall ramp.
    this.body.setAdditionalSolverIterations(8);
  }

  createVisual() {
    this.mesh = new THREE.Group();

    const appleMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0xd92b2b })
      : (this.ultraHigh
        ? new THREE.MeshPhysicalMaterial({
            color: 0xe8443c,
            roughness: 0.64,
            metalness: 0.0,
            clearcoat: 0.16,
            clearcoatRoughness: 0.52,
            envMapIntensity: 0.42
          })
        : new THREE.MeshStandardMaterial({
            color: 0xe53b35,
            roughness: 0.68,
            metalness: 0.0
          }));

    const body = new THREE.Mesh(createAppleBodyGeometry(this.radius, this.lowDetail, this.ultraHigh), appleMaterial);
    this.mesh.add(body);

    const stemMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x5f371c })
      : new THREE.MeshStandardMaterial({ color: 0x5a341c, roughness: 0.95, metalness: 0 });
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(
        this.radius * 0.055,
        this.radius * 0.075,
        this.radius * 0.43,
        this.lowDetail ? 6 : (this.ultraHigh ? 16 : 10)
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

    if (this.lowDetail || this.ultraHigh) {
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

  prepareCarHit(car) {
    if (this.clientOnly || !car?.body) return;

    const ballPos = this.body.translation();
    const carPos = car.body.translation();
    const carRot = car.body.rotation();
    this.hitBallPos.set(ballPos.x, ballPos.y, ballPos.z);
    this.hitCarPos.set(carPos.x, carPos.y, carPos.z);
    this.hitQuat.set(carRot.x, carRot.y, carRot.z, carRot.w).normalize();
    this.hitInverseQuat.copy(this.hitQuat).invert();
    this.hitLocal.copy(this.hitBallPos).sub(this.hitCarPos).applyQuaternion(this.hitInverseQuat);
    this.hitClosest.set(
      THREE.MathUtils.clamp(this.hitLocal.x, -CAR_HITBOX.x, CAR_HITBOX.x),
      THREE.MathUtils.clamp(this.hitLocal.y, -CAR_HITBOX.y, CAR_HITBOX.y),
      THREE.MathUtils.clamp(this.hitLocal.z, -CAR_HITBOX.z, CAR_HITBOX.z)
    );
    this.hitDelta.copy(this.hitLocal).sub(this.hitClosest);
    const distance = this.hitDelta.length();
    const contactRange = this.radius + 0.42;
    if (distance > contactRange) {
      if (distance > this.radius + 0.65) this.carContactActive = false;
      this.pendingHitSpeed = 0;
      return;
    }

    if (distance > 0.0001) {
      this.hitNormal.copy(this.hitDelta).multiplyScalar(1 / distance).applyQuaternion(this.hitQuat).normalize();
    } else {
      this.hitNormal.copy(this.hitBallPos).sub(this.hitCarPos).normalize();
      if (this.hitNormal.lengthSq() < 0.0001) this.hitNormal.set(0, 0, -1).applyQuaternion(this.hitQuat);
    }

    const carVel = car.body.linvel();
    const ballVel = this.body.linvel();
    const relativeX = carVel.x - ballVel.x;
    const relativeY = carVel.y - ballVel.y;
    const relativeZ = carVel.z - ballVel.z;
    const closingSpeed = relativeX * this.hitNormal.x + relativeY * this.hitNormal.y + relativeZ * this.hitNormal.z;
    if (!this.carContactActive && closingSpeed > 1.0) {
      this.pendingHitSpeed = closingSpeed;
      this.pendingHitNormal.copy(this.hitNormal);
    }
    this.carContactActive = true;
  }

  applyPreparedCarHit() {
    if (this.clientOnly || this.pendingHitSpeed <= 0) return;
    const impactSpeed = this.pendingHitSpeed;
    const extraForward = THREE.MathUtils.clamp(impactSpeed * BALL_TUNING.carHitPower, 0, 7.5);
    const liftRamp = THREE.MathUtils.clamp((impactSpeed - 1) / 4, 0, 1);
    const lift = THREE.MathUtils.clamp(
      (BALL_TUNING.carHitLiftBase + impactSpeed * BALL_TUNING.carHitLift) * liftRamp,
      0,
      3.25
    );
    const velocity = this.body.linvel();
    let x = velocity.x + this.pendingHitNormal.x * extraForward;
    let y = velocity.y + this.pendingHitNormal.y * extraForward + lift;
    let z = velocity.z + this.pendingHitNormal.z * extraForward;
    const speed = Math.hypot(x, y, z);
    if (speed > this.maxSpeed) {
      const scale = this.maxSpeed / speed;
      x *= scale;
      y *= scale;
      z *= scale;
    }
    this.body.setLinvel({ x, y, z }, true);
    this.pendingHitSpeed = 0;
  }

  fixedUpdate(dt) {
    if (this.body.translation().y < -12) {
      this.reset();
      return;
    }

    const v = this.body.linvel();

    // Rapier has Coulomb friction but no dedicated rolling-resistance knob.
    // Apply the same gentle time-based decay as the authoritative server only
    // while the ball is actually resting/rolling on the floor.
    if (this.body.translation().y <= this.radius + 0.08 && v.y <= 0.35) {
      const decay = Math.exp(-BALL_TUNING.rollingResistance * dt);
      v.x *= decay;
      v.z *= decay;
      this.body.setLinvel(v, true);
    }

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
    this.carContactActive = false;
    this.pendingHitSpeed = 0;
  }
}
