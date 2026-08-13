import * as THREE from 'three';
import { TransformBody } from '../network/TransformBody.js';
import { BALL_TUNING } from '../shared/game-tuning.js';
import { CAR_HITBOX } from '../shared/arena-tuning.js';

function hexPath(ctx, cx, cy, radius) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 3 * i + Math.PI / 6;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function createSoccarBallTextures(lowDetail, ultraHigh) {
  const width = lowDetail ? 384 : (ultraHigh ? 1536 : 768);
  const height = width / 2;
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colorCanvas.width = width;
  colorCanvas.height = height;
  bumpCanvas.width = width;
  bumpCanvas.height = height;

  const ctx = colorCanvas.getContext('2d');
  const bump = bumpCanvas.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#7f8790');
  base.addColorStop(0.48, '#555d66');
  base.addColorStop(1, '#8b9299');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  bump.fillStyle = '#a7a7a7';
  bump.fillRect(0, 0, width, height);

  const rows = lowDetail ? 5 : 7;
  const cols = lowDetail ? 10 : 14;
  const cellW = width / cols;
  const cellH = height / rows;
  const radius = Math.min(cellW * 0.52, cellH * 0.62);

  for (let row = -1; row <= rows; row += 1) {
    for (let col = -1; col <= cols; col += 1) {
      const cx = (col + 0.5 + (row & 1) * 0.5) * cellW;
      const cy = (row + 0.5) * cellH;
      const seed = ((row + 5) * 31 + (col + 7) * 17) & 7;
      const dark = seed === 0 || seed === 3;
      const bright = seed === 5;

      hexPath(ctx, cx, cy, radius * 0.9);
      ctx.fillStyle = dark ? '#22282e' : (bright ? '#aab0b4' : '#666e75');
      ctx.fill();
      ctx.lineWidth = Math.max(2, width / 300);
      ctx.strokeStyle = '#171c21';
      ctx.stroke();

      hexPath(bump, cx, cy, radius * 0.9);
      bump.fillStyle = dark ? '#777' : (bright ? '#c7c7c7' : '#aaa');
      bump.fill();
      bump.lineWidth = Math.max(4, width / 180);
      bump.strokeStyle = '#3b3b3b';
      bump.stroke();

      // Thin inset seam gives the ball a machined, segmented look without
      // requiring extra panel meshes.
      hexPath(ctx, cx, cy, radius * 0.72);
      ctx.lineWidth = Math.max(1, width / 640);
      ctx.strokeStyle = dark ? 'rgba(147,166,177,0.45)' : 'rgba(218,226,230,0.35)';
      ctx.stroke();

      if (!lowDetail && (seed === 0 || seed === 5)) {
        const glowR = radius * (seed === 0 ? 0.16 : 0.11);
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR * 3.3);
        glow.addColorStop(0, 'rgba(225,247,255,0.95)');
        glow.addColorStop(0.25, 'rgba(126,218,255,0.78)');
        glow.addColorStop(1, 'rgba(52,154,205,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR * 3.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#eaf8ff';
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Dark equatorial hardware band. It breaks up the repeated hex pattern and
  // reads like the reinforced belt on a futuristic arena ball.
  const bandY = height * 0.5;
  const bandH = Math.max(6, height * 0.022);
  ctx.fillStyle = 'rgba(18,23,28,0.72)';
  ctx.fillRect(0, bandY - bandH / 2, width, bandH);
  ctx.fillStyle = 'rgba(160,182,192,0.45)';
  ctx.fillRect(0, bandY - bandH * 0.12, width, Math.max(1, bandH * 0.16));
  bump.fillStyle = '#595959';
  bump.fillRect(0, bandY - bandH / 2, width, bandH);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = ultraHigh ? 8 : 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;
  bumpMap.anisotropy = ultraHigh ? 8 : 4;

  return { map, bumpMap };
}

function createSoccarBallGeometry(radius, lowDetail, ultraHigh) {
  return new THREE.SphereGeometry(
    radius,
    lowDetail ? 20 : (ultraHigh ? 64 : 40),
    lowDetail ? 14 : (ultraHigh ? 40 : 28)
  );
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

    const { map, bumpMap } = createSoccarBallTextures(this.lowDetail, this.ultraHigh);
    const ballMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ map, color: 0xe5e7e9 })
      : (this.ultraHigh
        ? new THREE.MeshPhysicalMaterial({
            map,
            bumpMap,
            bumpScale: this.radius * 0.014,
            color: 0xe4e7ea,
            roughness: 0.38,
            metalness: 0.34,
            clearcoat: 0.08,
            clearcoatRoughness: 0.48,
            envMapIntensity: 0.38
          })
        : new THREE.MeshStandardMaterial({
            map,
            bumpMap,
            bumpScale: this.radius * 0.012,
            color: 0xe1e4e7,
            roughness: 0.44,
            metalness: 0.26
          }));

    const body = new THREE.Mesh(
      createSoccarBallGeometry(this.radius, this.lowDetail, this.ultraHigh),
      ballMaterial
    );
    body.castShadow = this.ultraHigh;
    body.receiveShadow = this.ultraHigh;
    this.mesh.add(body);

    // A very subtle dark inner shell prevents bright environment light from
    // washing the ball out and gives the seams more depth in Normal/Ultra High.
    if (!this.lowDetail) {
      const inner = new THREE.Mesh(
        createSoccarBallGeometry(this.radius * 0.986, false, false),
        new THREE.MeshBasicMaterial({ color: 0x151b20, side: THREE.BackSide })
      );
      this.mesh.add(inner);
    }

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
