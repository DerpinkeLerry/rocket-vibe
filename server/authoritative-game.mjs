import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const FIELD_W = 110;
const FIELD_L = 160;
const WALL_H = 9.0;
const WALL_T = 1.0;
const GOAL_W = 13.0;
const GOAL_H = 5.2;
const GOAL_D = 8.0;
const BALL_RADIUS = 0.92;
const FIXED_DT = 1 / 60;
const SNAPSHOT_EVERY_STEPS = 2; // 30 Hz network snapshots.

const BIT_W = 1 << 0;
const BIT_S = 1 << 1;
const BIT_A = 1 << 2;
const BIT_D = 1 << 3;
const BIT_Q = 1 << 4;
const BIT_E = 1 << 5;
const BIT_BOOST = 1 << 6;

const EDGE_JUMP = 1 << 0;
const EDGE_RESET = 1 << 1;
const EDGE_BALL_RESET = 1 << 2;

const VEC3_UP = new THREE.Vector3(0, 1, 0);
const VEC3_FORWARD = new THREE.Vector3(0, 0, -1);
const VEC3_RIGHT = new THREE.Vector3(1, 0, 0);
const clamp = THREE.MathUtils.clamp;
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
const moveTowards = (current, target, maxDelta) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

export const PLAYER_SLOTS = [
  { spawn: { x: -13, y: 1.25, z: 44 }, yaw: 0 },
  { spawn: { x: -13, y: 1.25, z: -44 }, yaw: Math.PI },
  { spawn: { x: 13, y: 1.25, z: 44 }, yaw: 0 },
  { spawn: { x: 13, y: 1.25, z: -44 }, yaw: Math.PI }
];

class ServerCar {
  constructor(world, R, slot) {
    this.world = world;
    this.R = R;
    this.spawn = slot.spawn;
    this.spawnYaw = slot.yaw;
    this.connected = false;
    this.mask = 0;
    this.edges = 0;

    this.maxGroundSpeed = 39;
    this.maxBoostSpeed = 52;
    this.driveAcceleration = 25.5;
    this.reverseAcceleration = 20.0;
    this.brakeAcceleration = 34.0;
    this.boostAcceleration = 31.0;
    this.grip = 13.5;
    this.steerRate = 2.55;
    this.steerResponse = 10.0;
    this.airPitchAcceleration = 8.5;
    this.airYawAcceleration = 7.4;
    this.airRollAcceleration = 8.0;
    this.jumpSpeed = 11.8;
    this.doubleJumpSpeed = 8.4;
    this.downAcceleration = 5.5;

    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.jumpCount = 0;
    this.airTime = 0;
    this.groundContactLockout = 0;

    this.tempQ = new THREE.Quaternion();
    this.velocityVec = new THREE.Vector3();
    this.workVec = new THREE.Vector3();
    this.groundAvg = new THREE.Vector3();
    this.sampleWorld = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.wheelSamples = [
      new THREE.Vector3(-0.67, -0.28, -0.92),
      new THREE.Vector3(0.67, -0.28, -0.92),
      new THREE.Vector3(-0.67, -0.28, 0.94),
      new THREE.Vector3(0.67, -0.28, 0.94)
    ];
    this.rayDir = { x: 0, y: -1, z: 0 };
    this.rayOrigin = { x: 0, y: 0, z: 0 };

    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
      .setLinearDamping(0.08)
      .setAngularDamping(0.32)
      .setCcdEnabled(true)
      .setCanSleep(false);

    this.body = world.createRigidBody(bodyDesc);
    this.setSpawnRotation();
    this.collider = world.createCollider(
      R.ColliderDesc.cuboid(0.83, 0.39, 1.48)
        .setTranslation(0, -0.06, 0)
        .setMass(420)
        .setFriction(0.04)
        .setRestitution(0.06),
      this.body
    );
    this.body.setAdditionalSolverIterations(4);
    this.body.setEnabled(false);
  }

  setConnected(connected) {
    this.connected = Boolean(connected);
    this.mask = 0;
    this.edges = 0;
    this.body.setEnabled(this.connected);
    if (this.connected) {
      this.body.recomputeMassPropertiesFromColliders();
      this.reset();
    }
  }

  setInput(packet) {
    if (!this.connected) return;
    this.mask = (Number(packet?.mask) || 0) & 0x7f;
    // Edge-triggered actions are accumulated until the next physics tick.
    this.edges |= (Number(packet?.edges) || 0) & 0x07;
  }

  consumeEdge(bit) {
    const had = Boolean(this.edges & bit);
    this.edges &= ~bit;
    return had;
  }

  isDown(bit) {
    return Boolean(this.mask & bit);
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
    if (this.groundContactLockout > 0) {
      this.grounded = false;
      return;
    }

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
      const ray = new this.R.Ray(this.rayOrigin, this.rayDir);
      const hit = this.world.castRayAndGetNormal(ray, 1.15, true, undefined, undefined, undefined, this.body);
      if (!hit) continue;
      hits += 1;
      this.groundAvg.x += hit.normal.x;
      this.groundAvg.y += hit.normal.y;
      this.groundAvg.z += hit.normal.z;
    }

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
    if (!this.connected) return;

    if (this.consumeEdge(EDGE_RESET) || this.body.translation().y < -8) {
      this.reset();
      return;
    }

    this.getTransformBasis();
    this.groundContactLockout = Math.max(0, this.groundContactLockout - dt);
    this.sampleGround(dt);

    const forwardInput = (this.isDown(BIT_W) ? 1 : 0) - (this.isDown(BIT_S) ? 1 : 0);
    const sideInput = (this.isDown(BIT_A) ? 1 : 0) - (this.isDown(BIT_D) ? 1 : 0);
    const rollInput = (this.isDown(BIT_Q) ? 1 : 0) - (this.isDown(BIT_E) ? 1 : 0);
    const boosting = this.isDown(BIT_BOOST);

    const vRaw = this.body.linvel();
    this.velocityVec.set(vRaw.x, vRaw.y, vRaw.z);
    const speedForward = this.velocityVec.dot(this.forward);
    const speedLateral = this.velocityVec.dot(this.right);
    const flatSpeed = Math.hypot(vRaw.x, vRaw.z);

    // The server uses a small flat-pitch fallback in addition to raycasts.
    // That guarantees drive controls stay active even if a query update is one tick late.
    const pos = this.body.translation();
    const nearPitch = pos.y < 1.55 && this.up.y > 0.35 && Math.abs(vRaw.y) < 6.5;
    const driveGrounded = this.grounded || nearPitch;

    if (driveGrounded) {
      this.applyGroundDrive(dt, forwardInput, sideInput, speedForward, speedLateral, flatSpeed, boosting);
    } else {
      this.applyAirControl(dt, forwardInput, sideInput, rollInput);
      if (boosting) this.applyBoostVelocity(dt);
    }

    if (this.consumeEdge(EDGE_JUMP)) {
      const current = this.body.linvel();
      if (driveGrounded && this.jumpCount === 0) {
        this.body.setLinvel({ x: current.x, y: Math.max(current.y, this.jumpSpeed), z: current.z }, true);
        this.jumpCount = 1;
        this.grounded = false;
        this.groundContactLockout = 0.18;
      } else if (!driveGrounded && this.jumpCount === 1 && this.airTime < 1.4) {
        this.body.setLinvel({ x: current.x, y: current.y + this.doubleJumpSpeed, z: current.z }, true);
        this.jumpCount = 2;
      }
    }

    if (driveGrounded) {
      const lin = this.body.linvel();
      this.body.setLinvel({ x: lin.x, y: lin.y - this.downAcceleration * dt, z: lin.z }, true);
    }
  }

  applyGroundDrive(dt, throttle, steer, speedForward, speedLateral, flatSpeed, boosting) {
    const maxSpeed = boosting ? this.maxBoostSpeed : this.maxGroundSpeed;
    const targetForward = throttle * (throttle < 0 ? this.maxGroundSpeed * 0.68 : maxSpeed);
    let accel = throttle < 0 ? this.reverseAcceleration : this.driveAcceleration;

    if (throttle !== 0 && Math.sign(speedForward) !== 0 && Math.sign(throttle) !== Math.sign(speedForward)) {
      accel = this.brakeAcceleration;
    }

    let nextForward = speedForward;
    if (throttle !== 0) nextForward = moveTowards(speedForward, targetForward, accel * dt);
    else nextForward = moveTowards(speedForward, 0, 5.5 * dt);

    if (boosting) nextForward = moveTowards(nextForward, this.maxBoostSpeed, this.boostAcceleration * dt);

    const nextLateral = speedLateral * Math.exp(-this.grip * dt);
    const lin = this.body.linvel();

    const fx = this.forward.x;
    const fz = this.forward.z;
    const fl = Math.hypot(fx, fz) || 1;
    const rx = this.right.x;
    const rz = this.right.z;
    const rl = Math.hypot(rx, rz) || 1;

    this.body.setLinvel({
      x: (fx / fl) * nextForward + (rx / rl) * nextLateral,
      y: lin.y,
      z: (fz / fl) * nextForward + (rz / rl) * nextLateral
    }, true);

    const steerStrength = clamp(Math.max(Math.abs(nextForward), 1.5) / 7, 0.18, 1) * clamp(1 - flatSpeed / 62, 0.38, 1);
    const reverseSign = Math.sign(nextForward || throttle || 1);
    const targetYaw = steer * this.steerRate * steerStrength * reverseSign;
    const ang = this.body.angvel();
    this.body.setAngvel({
      x: damp(ang.x, 0, 8.5, dt),
      y: damp(ang.y, targetYaw, this.steerResponse, dt),
      z: damp(ang.z, 0, 8.5, dt)
    }, true);
  }

  applyBoostVelocity(dt) {
    const lin = this.body.linvel();
    const add = this.boostAcceleration * dt;
    let nx = lin.x + this.forward.x * add;
    let ny = lin.y + this.forward.y * add;
    let nz = lin.z + this.forward.z * add;
    const speed = Math.hypot(nx, ny, nz);
    if (speed > this.maxBoostSpeed) {
      const scale = this.maxBoostSpeed / speed;
      nx *= scale;
      ny *= scale;
      nz *= scale;
    }
    this.body.setLinvel({ x: nx, y: ny, z: nz }, true);
  }

  applyAirControl(dt, forwardInput, sideInput, rollInput) {
    const ang = this.body.angvel();
    this.workVec.set(ang.x, ang.y, ang.z)
      .addScaledVector(this.right, -forwardInput * this.airPitchAcceleration * dt)
      .addScaledVector(this.up, sideInput * this.airYawAcceleration * dt)
      .addScaledVector(this.forward, rollInput * this.airRollAcceleration * dt);

    const maxAirAngular = 6.5;
    const mag = this.workVec.length();
    if (mag > maxAirAngular) this.workVec.multiplyScalar(maxAirAngular / mag);

    this.body.setAngvel({ x: this.workVec.x, y: this.workVec.y, z: this.workVec.z }, true);
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

class ServerBall {
  constructor(world, R) {
    this.world = world;
    this.spawn = { x: 0, y: 4.2, z: 0 };
    this.maxSpeed = 56;
    this.maxAngularSpeed = 32;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(this.spawn.x, this.spawn.y, this.spawn.z)
        .setLinearDamping(0.035)
        .setAngularDamping(0.06)
        .setCcdEnabled(true)
        .setCanSleep(true)
    );
    this.collider = world.createCollider(
      R.ColliderDesc.ball(BALL_RADIUS)
        .setDensity(9.1)
        .setFriction(0.24)
        .setRestitution(0.62),
      this.body
    );
    this.body.setAdditionalSolverIterations(2);
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

  reset() {
    this.body.setTranslation(this.spawn, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
  }
}

function addFixedCollider(world, R, x, y, z, hx, hy, hz, friction, restitution) {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(
    R.ColliderDesc.cuboid(hx, hy, hz)
      .setFriction(friction)
      .setRestitution(restitution),
    body
  );
}

function createArenaPhysics(world, R) {
  const floorBody = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.18, 0));
  world.createCollider(
    R.ColliderDesc.cuboid(FIELD_W / 2, 0.18, FIELD_L / 2)
      .setFriction(0.06)
      .setRestitution(0.28),
    floorBody
  );

  addFixedCollider(world, R, FIELD_W / 2 + WALL_T / 2, WALL_H / 2, 0, WALL_T / 2, WALL_H / 2, FIELD_L / 2, 0.24, 0.42);
  addFixedCollider(world, R, -FIELD_W / 2 - WALL_T / 2, WALL_H / 2, 0, WALL_T / 2, WALL_H / 2, FIELD_L / 2, 0.24, 0.42);

  for (const sign of [-1, 1]) {
    const z = sign * (FIELD_L / 2 + WALL_T / 2);
    const sideW = (FIELD_W - GOAL_W) / 2;
    const sideX = GOAL_W / 2 + sideW / 2;
    const topH = WALL_H - GOAL_H;
    addFixedCollider(world, R, -sideX, WALL_H / 2, z, sideW / 2, WALL_H / 2, WALL_T / 2, 0.24, 0.42);
    addFixedCollider(world, R, sideX, WALL_H / 2, z, sideW / 2, WALL_H / 2, WALL_T / 2, 0.24, 0.42);
    addFixedCollider(world, R, 0, GOAL_H + topH / 2, z, GOAL_W / 2, topH / 2, WALL_T / 2, 0.24, 0.42);

    const zCenter = sign * (FIELD_L / 2 + GOAL_D / 2);
    const zBack = sign * (FIELD_L / 2 + GOAL_D);
    const t = 0.2;
    addFixedCollider(world, R, -GOAL_W / 2, GOAL_H / 2, zCenter, t, GOAL_H / 2, GOAL_D / 2, 0.2, 0.38);
    addFixedCollider(world, R, GOAL_W / 2, GOAL_H / 2, zCenter, t, GOAL_H / 2, GOAL_D / 2, 0.2, 0.38);
    addFixedCollider(world, R, 0, GOAL_H, zCenter, GOAL_W / 2, t, GOAL_D / 2, 0.2, 0.38);
    addFixedCollider(world, R, 0, GOAL_H / 2, zBack, GOAL_W / 2, GOAL_H / 2, t, 0.2, 0.38);
    addFixedCollider(world, R, 0, -0.18, zCenter, GOAL_W / 2, 0.18, GOAL_D / 2, 0.06, 0.28);
  }
}

function bodySnapshot(body, grounded = false) {
  const p = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const w = body.angvel();
  return {
    p: [p.x, p.y, p.z],
    r: [r.x, r.y, r.z, r.w],
    v: [v.x, v.y, v.z],
    w: [w.x, w.y, w.z],
    g: grounded ? 1 : 0
  };
}

export class AuthoritativeGame {
  constructor(R) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -20.5, z: 0 });
    this.world.timestep = FIXED_DT;
    createArenaPhysics(this.world, R);
    this.cars = PLAYER_SLOTS.map((slot) => new ServerCar(this.world, R, slot));
    this.ball = new ServerBall(this.world, R);
    this.timer = null;
    this.stepCount = 0;
    this.onSnapshot = null;
  }

  setPlayerConnected(playerId, connected) {
    const car = this.cars[playerId];
    if (!car) return;
    car.setConnected(connected);
  }

  setInput(playerId, packet) {
    this.cars[playerId]?.setInput(packet);
  }

  connectedIds() {
    const ids = [];
    for (let i = 0; i < this.cars.length; i++) if (this.cars[i].connected) ids.push(i);
    return ids;
  }

  step() {
    for (const car of this.cars) {
      if (car.connected && car.consumeEdge(EDGE_BALL_RESET)) this.ball.reset();
    }
    for (const car of this.cars) car.fixedUpdate(FIXED_DT);
    this.ball.fixedUpdate();
    this.world.step();
    this.stepCount += 1;
    if (this.stepCount % SNAPSHOT_EVERY_STEPS === 0) this.onSnapshot?.(this.snapshot());
  }

  snapshot() {
    return {
      tick: this.stepCount,
      connected: this.cars.map((car) => car.connected ? 1 : 0),
      cars: this.cars.map((car) => bodySnapshot(car.body, car.grounded)),
      ball: bodySnapshot(this.ball.body, false)
    };
  }


  diagnostics(playerId) {
    const car = this.cars[playerId];
    if (!car) return null;
    const p = car.body.translation();
    const v = car.body.linvel();
    const w = car.body.angvel();
    return {
      connected: car.connected,
      enabled: car.body.isEnabled(),
      mask: car.mask,
      grounded: car.grounded,
      mass: car.body.mass(),
      invMass: car.body.invMass(),
      position: [p.x, p.y, p.z],
      velocity: [v.x, v.y, v.z],
      angularVelocity: [w.x, w.y, w.z]
    };
  }

  debugState() {
    return { tick: this.stepCount, players: this.cars.map((_, i) => this.diagnostics(i)) };
  }

  start(onSnapshot) {
    this.onSnapshot = onSnapshot;
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / 60);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onSnapshot = null;
  }
}

export async function createAuthoritativeGame() {
  await RAPIER.init();
  return new AuthoritativeGame(RAPIER);
}
