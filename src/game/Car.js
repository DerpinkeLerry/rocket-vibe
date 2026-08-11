import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TransformBody } from '../network/TransformBody.js';

const VEC3_UP = new THREE.Vector3(0, 1, 0);
const VEC3_FORWARD = new THREE.Vector3(0, 0, -1);
const VEC3_RIGHT = new THREE.Vector3(1, 0, 0);

const clamp = THREE.MathUtils.clamp;
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

export class Car {
  constructor(scene, world, RAPIER, input, options = {}) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.input = input;
    this.lowDetail = Boolean(options.lowDetail);
    this.clientOnly = Boolean(options.clientOnly);

    const spawn = options.spawn ?? { x: 0, y: 1.25, z: 34 };
    this.spawn = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.spawnYaw = options.spawnYaw ?? 0;
    this.paintColor = options.color ?? 0xf46b20;
    this.maxGroundSpeed = 39;
    this.maxBoostSpeed = 52;
    this.driveForce = 12200;
    this.reverseForce = 9200;
    this.boostForce = 16800;
    this.grip = 13.5;
    this.steerRate = 2.55;
    this.steerResponse = 10.0;
    this.airPitchTorque = 1650;
    this.airYawTorque = 1320;
    this.airRollTorque = 1500;
    this.jumpImpulse = 4300;
    this.downforce = 3300;

    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.jumpCount = 0;
    this.airTime = 0;
    this.groundContactLockout = 0;
    this.wheelSpin = 0;

    this.tempQ = new THREE.Quaternion();
    this.velocityVec = new THREE.Vector3();
    this.workVec = new THREE.Vector3();
    this.groundAvg = new THREE.Vector3();
    this.sampleWorld = new THREE.Vector3();
    this.wheelSamples = [
      new THREE.Vector3(-0.67, -0.28, -0.92),
      new THREE.Vector3(0.67, -0.28, -0.92),
      new THREE.Vector3(-0.67, -0.28, 0.94),
      new THREE.Vector3(0.67, -0.28, 0.94)
    ];
    this.rayDir = { x: 0, y: -1, z: 0 };
    this.rayOrigin = { x: 0, y: 0, z: 0 };
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();

    this.createPhysics();
    this.createVisual();
  }

  createPhysics() {
    if (this.clientOnly) {
      this.body = new TransformBody(this.spawn, this.spawnYaw);
      this.collider = null;
      return;
    }

    const R = this.RAPIER;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
      .setLinearDamping(0.08)
      .setAngularDamping(0.32)
      .setCcdEnabled(true)
      .setCanSleep(false);

    this.body = this.world.createRigidBody(bodyDesc);
    this.setSpawnRotation();

    const colliderDesc = R.ColliderDesc.cuboid(0.83, 0.39, 1.48)
      .setTranslation(0, -0.06, 0)
      .setDensity(145)
      .setFriction(0.04)
      .setRestitution(0.06);

    this.collider = this.world.createCollider(colliderDesc, this.body);
    this.body.setAdditionalSolverIterations(4);
  }

  createVisual() {
    if (this.lowDetail) {
      this.createLowDetailVisual();
      return;
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);

    const paint = new THREE.MeshStandardMaterial({
      color: this.paintColor,
      roughness: 0.34,
      metalness: 0.34
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111a22, roughness: 0.3, metalness: 0.55 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x182f43,
      roughness: 0.24,
      metalness: 0.18,
      transparent: true,
      opacity: 0.9
    });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xd7fbff, emissive: 0x5bd5ff, emissiveIntensity: 3.0 });

    const lower = new THREE.Mesh(new RoundedBoxGeometry(1.66, 0.62, 2.95, 5, 0.13), paint);
    lower.position.y = 0.02;
    this.group.add(lower);

    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.54, 0.28, 1.02, 4, 0.08), paint);
    hood.position.set(0, 0.38, -0.87);
    hood.rotation.x = -0.05;
    this.group.add(hood);

    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.48, 0.58, 1.18, 5, 0.12), glass);
    cabin.position.set(0, 0.66, 0.19);
    this.group.add(cabin);

    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.12, 0.9, 3, 0.06), dark);
    roof.position.set(0, 0.98, 0.25);
    this.group.add(roof);

    const frontBumper = new THREE.Mesh(new RoundedBoxGeometry(1.72, 0.22, 0.25, 3, 0.06), dark);
    frontBumper.position.set(0, -0.12, -1.5);
    this.group.add(frontBumper);

    const rearBumper = frontBumper.clone();
    rearBumper.position.z = 1.5;
    this.group.add(rearBumper);

    const spoilerBar = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.11, 0.23, 3, 0.05), dark);
    spoilerBar.position.set(0, 0.62, 1.45);
    this.group.add(spoilerBar);
    for (const x of [-0.55, 0.55]) {
      const strut = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.38, 0.09, 2, 0.03), dark);
      strut.position.set(x, 0.45, 1.39);
      this.group.add(strut);
    }

    for (const x of [-0.55, 0.55]) {
      const lamp = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.14, 0.06, 2, 0.03), lightMat);
      lamp.position.set(x, 0.13, -1.505);
      this.group.add(lamp);
    }

    this.wheels = [];
    this.frontWheelPivots = [];
    const wheelPositions = [
      [-0.86, -0.2, -0.92, true],
      [0.86, -0.2, -0.92, true],
      [-0.86, -0.2, 0.96, false],
      [0.86, -0.2, 0.96, false]
    ];

    for (const [x, y, z, isFront] of wheelPositions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      this.group.add(pivot);

      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.28, 18),
        new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.86, metalness: 0.06 })
      );
      tire.rotation.z = Math.PI / 2;
      pivot.add(tire);

      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.19, 0.3, 12),
        new THREE.MeshStandardMaterial({ color: 0xb8c5cf, roughness: 0.25, metalness: 0.82 })
      );
      rim.rotation.z = Math.PI / 2;
      pivot.add(rim);

      this.wheels.push(tire, rim);
      if (isFront) this.frontWheelPivots.push(pivot);
    }

    // No dynamic point light: emissive exhaust gives the boost look much cheaper.
    this.boostLight = null;

    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0xffa34d, emissive: 0xff4c00, emissiveIntensity: 4.0 });
    this.exhaust = [];
    for (const x of [-0.34, 0.34]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.72, 10), exhaustMat);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(x, -0.03, 1.82);
      flame.visible = false;
      this.group.add(flame);
      this.exhaust.push(flame);
    }

    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.24,
      depthWrite: false
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.55, 16), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(0.72, 1.0, 1.0);
    this.shadow.position.y = 0.017;
    this.scene.add(this.shadow);
  }


  createLowDetailVisual() {
    this.group = new THREE.Group();
    this.scene.add(this.group);

    const paint = new THREE.MeshBasicMaterial({ color: this.paintColor });
    const dark = new THREE.MeshBasicMaterial({ color: 0x071019 });
    const glass = new THREE.MeshBasicMaterial({ color: 0x18354d });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.62, 2.95), paint);
    body.position.y = 0.02;
    this.group.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.52, 1.12), glass);
    cabin.position.set(0, 0.60, 0.18);
    this.group.add(cabin);

    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.18, 0.22), dark);
    bumper.position.set(0, -0.12, -1.50);
    this.group.add(bumper);
    const rear = bumper.clone();
    rear.position.z = 1.50;
    this.group.add(rear);

    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 8);
    const wheels = new THREE.InstancedMesh(wheelGeo, dark, 4);
    const dummy = new THREE.Object3D();
    const positions = [
      [-0.86, -0.20, -0.92], [0.86, -0.20, -0.92],
      [-0.86, -0.20, 0.96], [0.86, -0.20, 0.96]
    ];
    for (let i = 0; i < positions.length; i++) {
      const [x, y, z] = positions[i];
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, Math.PI / 2);
      dummy.updateMatrix();
      wheels.setMatrixAt(i, dummy.matrix);
    }
    wheels.instanceMatrix.needsUpdate = true;
    this.group.add(wheels);

    this.wheels = [];
    this.frontWheelPivots = [];
    this.exhaust = [];
    this.boostLight = null;
    this.shadow = null;

    // Ultra car parts never animate independently. Freeze their local matrices;
    // only the root group moves each render frame.
    this.group.traverse((object) => {
      if (object === this.group) return;
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
  }

  setSpawnRotation() {
    const half = this.spawnYaw * 0.5;
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
  }

  getTransformBasis() {
    const rot = this.body.rotation();
    this.tempQ.set(rot.x, rot.y, rot.z, rot.w);
    this.forward.copy(VEC3_FORWARD).applyQuaternion(this.tempQ).normalize();
    this.right.copy(VEC3_RIGHT).applyQuaternion(this.tempQ).normalize();
    this.up.copy(VEC3_UP).applyQuaternion(this.tempQ).normalize();
  }

  sampleGround(dt) {
    // After jumping, ignore wheel-ray ground hits briefly. Otherwise the rays
    // can still reach the floor while the car is already moving upward and
    // would switch WASD back to ground controls for a few frames.
    if (this.groundContactLockout > 0) {
      this.grounded = false;
      return;
    }

    const R = this.RAPIER;
    const pos = this.body.translation();
    const rot = this.body.rotation();
    this.tempQ.set(rot.x, rot.y, rot.z, rot.w);

    let hits = 0;
    this.groundAvg.set(0, 0, 0);

    for (const sample of this.wheelSamples) {
      this.sampleWorld.copy(sample).applyQuaternion(this.tempQ);
      this.rayOrigin.x = this.sampleWorld.x + pos.x;
      this.rayOrigin.y = this.sampleWorld.y + pos.y;
      this.rayOrigin.z = this.sampleWorld.z + pos.z;

      const ray = new R.Ray(this.rayOrigin, this.rayDir);
      const hit = this.world.castRayAndGetNormal(ray, 1.15, true, undefined, undefined, undefined, this.body);
      if (hit) {
        hits += 1;
        this.groundAvg.x += hit.normal.x;
        this.groundAvg.y += hit.normal.y;
        this.groundAvg.z += hit.normal.z;
      }
    }

    // One valid wheel ray is enough for input responsiveness on edges/bumps.
    // Multiple hits still contribute to the averaged ground normal.
    this.grounded = hits >= 1 && this.groundAvg.lengthSq() > 0;
    if (this.grounded) {
      this.groundAvg.normalize();
      this.groundNormal.lerp(this.groundAvg, 0.45).normalize();
      this.airTime = 0;
      if (this.jumpCount > 0) this.jumpCount = 0;
    } else {
      this.airTime += dt;
    }
  }

  fixedUpdate(dt) {
    if (this.input.consumePressed('KeyR') || this.body.translation().y < -8) {
      this.reset();
      return;
    }

    this.getTransformBasis();
    this.groundContactLockout = Math.max(0, this.groundContactLockout - dt);
    this.sampleGround(dt);

    // Context-sensitive Rocket-League-style controls:
    // GROUND: W/S = throttle/reverse, A/D = steering.
    // AIR:    W/S = pitch, A/D = yaw, Q/E = roll.
    // Shift remains boost in both states.
    const forwardInput = (this.input.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.input.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const sideInput = (this.input.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (this.input.isDown('KeyD', 'ArrowRight') ? 1 : 0);
    const rollInput = (this.input.isDown('KeyQ') ? 1 : 0) - (this.input.isDown('KeyE') ? 1 : 0);
    const boosting = this.input.isDown('ShiftLeft', 'ShiftRight');

    const vRaw = this.body.linvel();
    this.velocityVec.set(vRaw.x, vRaw.y, vRaw.z);
    const speedForward = this.velocityVec.dot(this.forward);
    const speedLateral = this.velocityVec.dot(this.right);
    const flatSpeed = Math.hypot(vRaw.x, vRaw.z);

    if (this.grounded) {
      this.applyGroundDrive(dt, forwardInput, sideInput, speedForward, speedLateral, flatSpeed, boosting);
    } else {
      this.applyAirControl(dt, forwardInput, sideInput, rollInput);
    }

    if (boosting) {
      const speed = this.velocityVec.dot(this.forward);
      if (speed < this.maxBoostSpeed) {
        const boostImpulse = this.boostForce * dt;
        this.body.applyImpulse({
          x: this.forward.x * boostImpulse,
          y: this.forward.y * boostImpulse,
          z: this.forward.z * boostImpulse
        }, true);
      }
    }

    if (this.input.consumePressed('Space')) {
      if (this.grounded && this.jumpCount === 0) {
        this.body.applyImpulse({
          x: this.groundNormal.x * this.jumpImpulse * 0.08,
          y: this.jumpImpulse,
          z: this.groundNormal.z * this.jumpImpulse * 0.08
        }, true);
        this.jumpCount = 1;
        this.grounded = false;
        this.groundContactLockout = 0.16;
      } else if (!this.grounded && this.jumpCount === 1 && this.airTime < 1.4) {
        this.body.applyImpulse({ x: 0, y: this.jumpImpulse * 0.82, z: 0 }, true);
        this.jumpCount = 2;
      }
    }

    if (this.grounded) {
      const downImpulse = this.downforce * dt;
      this.body.applyImpulse({
        x: -this.groundNormal.x * downImpulse,
        y: -this.groundNormal.y * downImpulse,
        z: -this.groundNormal.z * downImpulse
      }, true);
    }

    this.updateVisualAnimation(dt, this.grounded ? sideInput : 0, speedForward, boosting);
  }

  applyGroundDrive(dt, throttle, steer, speedForward, speedLateral, flatSpeed, boosting) {
    const maxSpeed = boosting ? this.maxBoostSpeed : this.maxGroundSpeed;
    const force = throttle >= 0 ? this.driveForce : this.reverseForce;

    if (throttle !== 0 && (Math.abs(speedForward) < maxSpeed || Math.sign(throttle) !== Math.sign(speedForward))) {
      const driveImpulse = force * throttle * dt;
      this.body.applyImpulse({
        x: this.forward.x * driveImpulse,
        y: 0,
        z: this.forward.z * driveImpulse
      }, true);
    }

    const lin = this.body.linvel();
    const gripAmount = clamp(this.grip * dt, 0, 1);
    const corrected = this.workVec.set(lin.x, lin.y, lin.z)
      .addScaledVector(this.right, -speedLateral * gripAmount);

    if (Math.abs(throttle) < 0.01) {
      const coast = Math.exp(-1.25 * dt);
      const along = corrected.dot(this.forward);
      corrected.addScaledVector(this.forward, along * (coast - 1));
    }

    this.body.setLinvel({ x: corrected.x, y: corrected.y, z: corrected.z }, true);

    const steerStrength = clamp(Math.abs(speedForward) / 6, 0, 1) * clamp(1 - flatSpeed / 58, 0.35, 1);
    const reverseSign = Math.sign(speedForward || throttle || 1);
    const targetYaw = steer * this.steerRate * steerStrength * reverseSign;
    const ang = this.body.angvel();
    const yaw = damp(ang.y, targetYaw, this.steerResponse, dt);
    this.body.setAngvel({
      x: damp(ang.x, 0, 7.5, dt),
      y: yaw,
      z: damp(ang.z, 0, 7.5, dt)
    }, true);
  }

  applyAirControl(dt, forwardInput, sideInput, rollInput) {
    // With this coordinate system positive local X pitches the nose up,
    // therefore W uses a negative pitch impulse (nose down) and S positive.
    const pitch = -forwardInput;
    const yaw = sideInput;
    const roll = rollInput;

    const torque = this.workVec.set(0, 0, 0)
      .addScaledVector(this.right, pitch * this.airPitchTorque)
      .addScaledVector(this.up, yaw * this.airYawTorque)
      .addScaledVector(this.forward, roll * this.airRollTorque);

    if (torque.lengthSq() > 0) {
      this.body.applyTorqueImpulse({
        x: torque.x * dt,
        y: torque.y * dt,
        z: torque.z * dt
      }, true);
    }

    // Cap rotation so keyboard input stays controllable instead of spinning
    // forever after a long key press. The motion itself still has inertia.
    const ang = this.body.angvel();
    const maxAirAngular = 6.5;
    const mag = Math.hypot(ang.x, ang.y, ang.z);
    if (mag > maxAirAngular) {
      const s = maxAirAngular / mag;
      this.body.setAngvel({ x: ang.x * s, y: ang.y * s, z: ang.z * s }, true);
    }
  }

  updateVisualAnimation(dt, steer, speedForward, boosting) {
    const visualSteer = steer * 0.34;
    for (const pivot of this.frontWheelPivots) {
      pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, visualSteer, 1 - Math.exp(-12 * dt));
    }

    this.wheelSpin += speedForward * dt / 0.36;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;

    if (this.boostLight) this.boostLight.intensity = boosting ? 16 : 0;
    for (let i = 0; i < this.exhaust.length; i++) {
      const flame = this.exhaust[i];
      flame.visible = boosting;
      if (boosting) {
        const flicker = 0.86 + Math.sin(performance.now() * 0.04 + i * 2) * 0.12;
        flame.scale.set(1, flicker, 1);
      }
    }
  }

  syncVisual() {
    const p = this.body.translation();
    const r = this.body.rotation();
    this.group.position.set(p.x, p.y, p.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);

    if (this.shadow) {
      this.shadow.position.x = p.x;
      this.shadow.position.z = p.z;
      const height = Math.max(0, p.y - 0.45);
      const shadowScale = THREE.MathUtils.clamp(1.0 - height * 0.035, 0.58, 1.0);
      this.shadow.scale.set(0.72 * shadowScale, shadowScale, 1);
      this.shadow.material.opacity = THREE.MathUtils.clamp(0.24 - height * 0.01, 0.05, 0.24);
    }
  }

  getSpeedKmh() {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z) * 3.6;
  }

  reset() {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.setSpawnRotation();
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.jumpCount = 0;
    this.airTime = 0;
    this.groundContactLockout = 0;
    this.grounded = false;
  }
}
