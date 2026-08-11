import * as THREE from 'three';
import { CAR_TUNING, INPUT_BITS, INPUT_EDGES } from '../shared/game-tuning.js';

const VEC_FORWARD = new THREE.Vector3(0, 0, -1);
const VEC_RIGHT = new THREE.Vector3(1, 0, 0);
const VEC_UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const moveTowards = (current, target, maxDelta) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

export class LocalCarPredictor {
  constructor(car) {
    this.car = car;
    this.body = car.body;
    this.mask = 0;
    this.edges = 0;
    this.grounded = false;
    this.jumpCount = 0;
    this.airTime = 0;
    this.groundLockout = 0;

    this.q = new THREE.Quaternion();
    this.targetQ = new THREE.Quaternion();
    this.deltaQ = new THREE.Quaternion();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3();
    this.axis = new THREE.Vector3();
    this.authPos = new THREE.Vector3();
    this.authVel = new THREE.Vector3();
    this.authAng = new THREE.Vector3();
  }

  setInput(packet) {
    this.mask = (Number(packet?.mask) || 0) & 0x7f;
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

  syncGrounded(serverGrounded) {
    if (serverGrounded && this.groundLockout <= 0) {
      if (!this.grounded) this.jumpCount = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = false;
    }
    this.car.grounded = this.grounded;
  }

  step(frameDt) {
    // Keep prediction stable on low-FPS machines by splitting long render frames.
    this.groundLockout = Math.max(0, this.groundLockout - frameDt);
    let remaining = Math.min(frameDt, 0.05);
    while (remaining > 0.00001) {
      const dt = Math.min(remaining, 1 / 120);
      this.stepSubframe(dt);
      remaining -= dt;
    }
  }

  stepSubframe(dt) {
    const pRaw = this.body.translation();
    const rRaw = this.body.rotation();
    const vRaw = this.body.linvel();
    const wRaw = this.body.angvel();

    this.pos.set(pRaw.x, pRaw.y, pRaw.z);
    this.q.set(rRaw.x, rRaw.y, rRaw.z, rRaw.w).normalize();
    this.vel.set(vRaw.x, vRaw.y, vRaw.z);
    this.ang.set(wRaw.x, wRaw.y, wRaw.z);

    this.forward.copy(VEC_FORWARD).applyQuaternion(this.q).normalize();
    this.right.copy(VEC_RIGHT).applyQuaternion(this.q).normalize();
    this.up.copy(VEC_UP).applyQuaternion(this.q).normalize();

    const forwardInput = (this.isDown(INPUT_BITS.W) ? 1 : 0) - (this.isDown(INPUT_BITS.S) ? 1 : 0);
    const sideInput = (this.isDown(INPUT_BITS.A) ? 1 : 0) - (this.isDown(INPUT_BITS.D) ? 1 : 0);
    const rollInput = (this.isDown(INPUT_BITS.Q) ? 1 : 0) - (this.isDown(INPUT_BITS.E) ? 1 : 0);
    const boosting = this.isDown(INPUT_BITS.BOOST);

    const nearFloor = this.pos.y < 1.55 && this.up.y > 0.35 && Math.abs(this.vel.y) < 6.5;
    let driveGrounded = this.grounded || nearFloor;

    if (this.consumeEdge(INPUT_EDGES.RESET)) {
      this.car.reset();
      this.grounded = false;
      this.jumpCount = 0;
      this.airTime = 0;
      this.groundLockout = 0;
      return;
    }

    if (this.consumeEdge(INPUT_EDGES.JUMP)) {
      if (driveGrounded && this.jumpCount === 0) {
        this.vel.y = Math.max(this.vel.y, CAR_TUNING.jumpSpeed);
        this.jumpCount = 1;
        this.grounded = false;
        this.groundLockout = 0.22;
        driveGrounded = false;
      } else if (!driveGrounded && this.jumpCount === 1 && this.airTime < 1.4) {
        this.vel.y += CAR_TUNING.doubleJumpSpeed;
        this.jumpCount = 2;
      }
    }

    if (driveGrounded) {
      const speedForward = this.vel.dot(this.forward);
      const speedLateral = this.vel.dot(this.right);
      const flatSpeed = Math.hypot(this.vel.x, this.vel.z);
      const maxSpeed = boosting ? CAR_TUNING.maxBoostSpeed : CAR_TUNING.maxGroundSpeed;
      const targetForward = forwardInput * (forwardInput < 0 ? CAR_TUNING.maxGroundSpeed * 0.68 : maxSpeed);
      let accel = forwardInput < 0 ? CAR_TUNING.reverseAcceleration : CAR_TUNING.driveAcceleration;
      if (forwardInput !== 0 && Math.sign(speedForward) !== 0 && Math.sign(forwardInput) !== Math.sign(speedForward)) {
        accel = CAR_TUNING.brakeAcceleration;
      }

      let nextForward = speedForward;
      if (forwardInput !== 0) nextForward = moveTowards(speedForward, targetForward, accel * dt);
      else nextForward = moveTowards(speedForward, 0, CAR_TUNING.coastDeceleration * dt);
      if (boosting) nextForward = moveTowards(nextForward, CAR_TUNING.maxBoostSpeed, CAR_TUNING.boostAcceleration * dt);

      const nextLateral = speedLateral * Math.exp(-CAR_TUNING.grip * dt);
      const fx = this.forward.x;
      const fz = this.forward.z;
      const fl = Math.hypot(fx, fz) || 1;
      const rx = this.right.x;
      const rz = this.right.z;
      const rl = Math.hypot(rx, rz) || 1;
      this.vel.x = (fx / fl) * nextForward + (rx / rl) * nextLateral;
      this.vel.z = (fz / fl) * nextForward + (rz / rl) * nextLateral;
      this.vel.y = 0;

      const steerStrength = clamp(Math.max(Math.abs(nextForward), 1.5) / 7, 0.18, 1) * clamp(1 - flatSpeed / 62, 0.38, 1);
      const reverseSign = Math.sign(nextForward || forwardInput || 1);
      const targetYaw = sideInput * CAR_TUNING.steerRate * steerStrength * reverseSign;
      this.ang.x = damp(this.ang.x, 0, CAR_TUNING.angularGroundDamping, dt);
      this.ang.y = damp(this.ang.y, targetYaw, CAR_TUNING.steerResponse, dt);
      this.ang.z = damp(this.ang.z, 0, CAR_TUNING.angularGroundDamping, dt);
      this.airTime = 0;
      this.grounded = true;
    } else {
      this.airTime += dt;
      this.grounded = false;
      this.ang
        .addScaledVector(this.right, -forwardInput * CAR_TUNING.airPitchAcceleration * dt)
        .addScaledVector(this.up, sideInput * CAR_TUNING.airYawAcceleration * dt)
        .addScaledVector(this.forward, rollInput * CAR_TUNING.airRollAcceleration * dt);
      const aLen = this.ang.length();
      if (aLen > CAR_TUNING.maxAirAngular) this.ang.multiplyScalar(CAR_TUNING.maxAirAngular / aLen);

      if (boosting) {
        this.vel.addScaledVector(this.forward, CAR_TUNING.boostAcceleration * dt);
        const speed = this.vel.length();
        if (speed > CAR_TUNING.maxBoostSpeed) this.vel.multiplyScalar(CAR_TUNING.maxBoostSpeed / speed);
      }

      this.vel.y -= CAR_TUNING.gravity * dt;
      this.vel.multiplyScalar(Math.exp(-CAR_TUNING.linearDamping * dt));
      this.ang.multiplyScalar(Math.exp(-CAR_TUNING.angularDamping * dt));
    }

    this.pos.addScaledVector(this.vel, dt);
    const angularSpeed = this.ang.length();
    if (angularSpeed > 0.00001) {
      this.axis.copy(this.ang).multiplyScalar(1 / angularSpeed);
      this.deltaQ.setFromAxisAngle(this.axis, angularSpeed * dt);
      this.q.premultiply(this.deltaQ).normalize();
    }

    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, false);
    this.body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, false);
    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, false);
    this.body.setAngvel({ x: this.ang.x, y: this.ang.y, z: this.ang.z }, false);
    this.car.grounded = this.grounded;
  }

  reconcile(target, dt, ageSec, rttMs) {
    if (!target) return;

    // The received snapshot describes the server a little in the past. Advance it
    // by half the measured RTT plus packet age before comparing against prediction.
    const lead = clamp(ageSec + Math.max(0, rttMs) * 0.0005, 0, 0.18);
    this.authPos.fromArray(target.p);
    this.authVel.fromArray(target.v);
    this.authPos.addScaledVector(this.authVel, lead);
    this.authAng.fromArray(target.w);

    const pRaw = this.body.translation();
    const rRaw = this.body.rotation();
    const vRaw = this.body.linvel();
    const wRaw = this.body.angvel();
    this.pos.set(pRaw.x, pRaw.y, pRaw.z);
    this.q.set(rRaw.x, rRaw.y, rRaw.z, rRaw.w).normalize();
    this.vel.set(vRaw.x, vRaw.y, vRaw.z);
    this.ang.set(wRaw.x, wRaw.y, wRaw.z);

    const posError = this.pos.distanceTo(this.authPos);
    this.targetQ.fromArray(target.r).normalize();
    const rotError = this.q.angleTo(this.targetQ);

    if (posError > 7.5 || rotError > 1.5) {
      this.pos.copy(this.authPos);
      this.q.copy(this.targetQ);
      this.vel.copy(this.authVel);
      this.ang.copy(this.authAng);
    } else {
      // Corrections are deliberately gentle. Input remains immediate while the
      // authoritative server continuously pulls us back toward the true result.
      const positionAlpha = 1 - Math.exp(-4.5 * dt);
      const rotationAlpha = 1 - Math.exp(-6.0 * dt);
      const velocityAlpha = 1 - Math.exp(-3.5 * dt);
      this.pos.lerp(this.authPos, positionAlpha);
      this.q.slerp(this.targetQ, rotationAlpha);
      this.vel.lerp(this.authVel, velocityAlpha);
      this.ang.lerp(this.authAng, velocityAlpha);
    }

    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, false);
    this.body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, false);
    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, false);
    this.body.setAngvel({ x: this.ang.x, y: this.ang.y, z: this.ang.z }, false);
    this.syncGrounded(Boolean(target.g));
  }
}
