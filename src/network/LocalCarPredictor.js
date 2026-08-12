import * as THREE from 'three';
import { CAR_TUNING, INPUT_BITS, INPUT_EDGES } from '../shared/game-tuning.js';
import { ARENA_TUNING, CAR_HITBOX } from '../shared/arena-tuning.js';

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
  constructor(car, options = {}) {
    this.car = car;
    this.simulationHz = Math.max(30, Number(options.simulationHz) || 120);
    this.lowLatency = Boolean(options.lowLatency);
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
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.surfaceRight = new THREE.Vector3();
    this.surfaceBack = new THREE.Vector3();
    this.surfaceNormal = new THREE.Vector3();
    this.surfaceMatrix = new THREE.Matrix4();
    this.surfaceQ = new THREE.Quaternion();
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
      const dt = Math.min(remaining, 1 / this.simulationHz);
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
    if (nearFloor && !this.grounded) this.groundNormal.set(0, 1, 0);
    let driveGrounded = this.groundLockout <= 0 && (this.grounded || nearFloor);

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
        const normalSpeed = this.vel.dot(this.groundNormal);
        this.vel.addScaledVector(this.groundNormal, Math.max(0, CAR_TUNING.jumpSpeed - normalSpeed));
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
      this.forward.addScaledVector(this.groundNormal, -this.forward.dot(this.groundNormal));
      if (this.forward.lengthSq() < 0.000001) {
        if (Math.abs(this.groundNormal.y) < 0.9) this.forward.set(0, -1, 0);
        else this.forward.set(0, 0, -1);
      }
      this.forward.normalize();
      this.right.crossVectors(this.forward, this.groundNormal).normalize();
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
      const normalSpeed = Math.min(0, this.vel.dot(this.groundNormal));
      this.vel.copy(this.forward).multiplyScalar(nextForward)
        .addScaledVector(this.right, nextLateral)
        .addScaledVector(this.groundNormal, normalSpeed);

      const steerStrength = clamp(Math.max(Math.abs(nextForward), 1.5) / 7, 0.18, 1) * clamp(1 - flatSpeed / 62, 0.38, 1);
      const reverseSign = Math.sign(nextForward || forwardInput || 1);
      const targetYaw = sideInput * CAR_TUNING.steerRate * steerStrength * reverseSign;
      let spin = this.ang.dot(this.groundNormal);
      this.ang.addScaledVector(this.groundNormal, -spin).multiplyScalar(Math.exp(-CAR_TUNING.angularGroundDamping * dt));
      spin = damp(spin, targetYaw, CAR_TUNING.steerResponse, dt);
      this.ang.addScaledVector(this.groundNormal, spin);
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

    }

    if (driveGrounded) this.vel.addScaledVector(this.groundNormal, -CAR_TUNING.downAcceleration * dt);
    this.vel.y -= CAR_TUNING.gravity * dt;
    this.vel.multiplyScalar(Math.exp(-CAR_TUNING.linearDamping * dt));
    this.ang.multiplyScalar(Math.exp(-CAR_TUNING.angularDamping * dt));

    this.pos.addScaledVector(this.vel, dt);
    const angularSpeed = this.ang.length();
    if (angularSpeed > 0.00001) {
      this.axis.copy(this.ang).multiplyScalar(1 / angularSpeed);
      this.deltaQ.setFromAxisAngle(this.axis, angularSpeed * dt);
      this.q.premultiply(this.deltaQ).normalize();
    }

    this.resolveArenaCollision();
    this.alignToSurface(dt);

    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, false);
    this.body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, false);
    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, false);
    this.body.setAngvel({ x: this.ang.x, y: this.ang.y, z: this.ang.z }, false);
    this.car.grounded = this.grounded;
  }

  supportAlong(nx, ny, nz) {
    return Math.abs(this.right.x * nx + this.right.y * ny + this.right.z * nz) * CAR_HITBOX.x
      + Math.abs(this.up.x * nx + this.up.y * ny + this.up.z * nz) * CAR_HITBOX.y
      + Math.abs(this.forward.x * nx + this.forward.y * ny + this.forward.z * nz) * CAR_HITBOX.z;
  }

  stopOutwardVelocity(nx, nz) {
    const outwardSpeed = this.vel.x * nx + this.vel.z * nz;
    if (outwardSpeed <= 0) return;
    this.vel.x -= nx * outwardSpeed;
    this.vel.z -= nz * outwardSpeed;
    // Wall contact should slide, not store energy and release it like a spring.
    this.ang.multiplyScalar(0.985);
  }

  resolveIntoPlayable(nx, ny, nz, penetration) {
    this.pos.x += nx * penetration;
    this.pos.y += ny * penetration;
    this.pos.z += nz * penetration;
    const intoSurfaceSpeed = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
    if (intoSurfaceSpeed < 0) {
      this.vel.x -= nx * intoSurfaceSpeed;
      this.vel.y -= ny * intoSurfaceSpeed;
      this.vel.z -= nz * intoSurfaceSpeed;
    }
  }

  findNearestBoundary(goalOpening) {
    const arena = ARENA_TUNING;
    const halfWidth = arena.width * 0.5;
    const halfLength = arena.length * 0.5;
    const straightX = halfWidth - arena.cornerRadius;
    const straightZ = halfLength - arena.cornerRadius;
    const absX = Math.abs(this.pos.x);
    const absZ = Math.abs(this.pos.z);

    if (absX > straightX && absZ > straightZ) {
      const centerX = Math.sign(this.pos.x || 1) * straightX;
      const centerZ = Math.sign(this.pos.z || 1) * straightZ;
      const dx = this.pos.x - centerX;
      const dz = this.pos.z - centerZ;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.000001) return false;
      this.boundaryDistance = arena.cornerRadius - distance;
      this.boundaryNX = dx / distance;
      this.boundaryNZ = dz / distance;
      return true;
    }

    let found = false;
    let distance = Number.POSITIVE_INFINITY;
    if (absZ <= straightZ) {
      found = true;
      distance = halfWidth - absX;
      this.boundaryNX = Math.sign(this.pos.x || 1);
      this.boundaryNZ = 0;
    }
    if (absX <= straightX && !goalOpening) {
      const endDistance = halfLength - absZ;
      if (!found || endDistance < distance) {
        distance = endDistance;
        this.boundaryNX = 0;
        this.boundaryNZ = Math.sign(this.pos.z || 1);
      }
      found = true;
    }
    this.boundaryDistance = distance;
    return found;
  }

  markSurfaceContact(nx, ny, nz) {
    if (this.groundLockout > 0 || this.up.x * nx + this.up.y * ny + this.up.z * nz <= 0.1) return;
    this.grounded = true;
    this.surfaceContactThisStep = true;
    this.airTime = 0;
    this.groundNormal.set(nx, ny, nz).normalize();
  }

  resolveArenaCollision() {
    const arena = ARENA_TUNING;
    const halfWidth = arena.width * 0.5;
    const halfLength = arena.length * 0.5;
    this.surfaceContactThisStep = false;

    // Refresh the basis after integrating rotation so the oriented hitbox and
    // the server use the same support extents for this exact predicted pose.
    this.forward.copy(VEC_FORWARD).applyQuaternion(this.q).normalize();
    this.right.copy(VEC_RIGHT).applyQuaternion(this.q).normalize();
    this.up.copy(VEC_UP).applyQuaternion(this.q).normalize();

    const extentY = this.supportAlong(0, 1, 0);
    const floorContact = this.pos.y <= extentY + 0.035;
    if (this.pos.y < extentY) {
      this.pos.y = extentY;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    const ceilingY = arena.ceiling - extentY;
    if (this.pos.y > ceilingY) {
      this.pos.y = ceilingY;
      if (this.vel.y > 0) this.vel.y = 0;
    }

    const extentX = this.supportAlong(1, 0, 0);
    const extentZ = this.supportAlong(0, 0, 1);
    const absX = Math.abs(this.pos.x);
    const absZ = Math.abs(this.pos.z);
    const goalFits = absX + extentX <= arena.goalWidth * 0.5
      && this.pos.y + extentY <= arena.goalHeight;

    if (this.findNearestBoundary(goalFits)) {
      const outwardX = this.boundaryNX;
      const outwardZ = this.boundaryNZ;
      const horizontal = arena.rampRadius - this.boundaryDistance;
      const vertical = this.pos.y - arena.rampRadius;
      let rampResolved = false;

      if (horizontal >= 0 && vertical <= 0) {
        const distance = Math.hypot(horizontal, vertical);
        if (distance > 0.000001) {
          const nx = -outwardX * horizontal / distance;
          const ny = -vertical / distance;
          const nz = -outwardZ * horizontal / distance;
          const support = this.supportAlong(nx, ny, nz);
          const maximumDistance = Math.max(0.1, arena.rampRadius - support);
          const penetration = distance - maximumDistance;
          if (penetration > 0) {
            this.resolveIntoPlayable(nx, ny, nz, penetration);
            this.markSurfaceContact(nx, ny, nz);
            rampResolved = true;
          }
        }
      }

      if (!rampResolved) {
        const nx = -outwardX;
        const nz = -outwardZ;
        const support = this.supportAlong(nx, 0, nz);
        const penetration = support - this.boundaryDistance;
        if (penetration > 0) {
          this.resolveIntoPlayable(nx, 0, nz, penetration);
          this.markSurfaceContact(nx, 0, nz);
          this.ang.multiplyScalar(0.985);
        }
      }
    }

    if (Math.abs(this.pos.z) > halfLength - 0.02) {
      const goalHalfWidth = arena.goalWidth * 0.5;
      const goalBack = halfLength + arena.goalDepth;
      const maximumGoalX = goalHalfWidth - extentX;
      if (this.pos.x > maximumGoalX) {
        this.pos.x = maximumGoalX;
        this.stopOutwardVelocity(1, 0);
      } else if (this.pos.x < -maximumGoalX) {
        this.pos.x = -maximumGoalX;
        this.stopOutwardVelocity(-1, 0);
      }

      const goalRoof = arena.goalHeight - extentY;
      if (this.pos.y > goalRoof) {
        this.pos.y = goalRoof;
        if (this.vel.y > 0) this.vel.y = 0;
      }

      const maximumGoalZ = goalBack - extentZ;
      if (this.pos.z > maximumGoalZ) {
        this.pos.z = maximumGoalZ;
        this.stopOutwardVelocity(0, 1);
      } else if (this.pos.z < -maximumGoalZ) {
        this.pos.z = -maximumGoalZ;
        this.stopOutwardVelocity(0, -1);
      }
    }

    if (!this.surfaceContactThisStep && floorContact && this.up.y > 0.3 && this.groundLockout <= 0) {
      this.grounded = true;
      this.airTime = 0;
      this.groundNormal.set(0, 1, 0);
    }
  }

  alignToSurface(dt) {
    if (!this.grounded || this.groundLockout > 0) return;
    this.forward.copy(VEC_FORWARD).applyQuaternion(this.q);
    this.forward.addScaledVector(this.groundNormal, -this.forward.dot(this.groundNormal));
    if (this.forward.lengthSq() < 0.000001) {
      if (Math.abs(this.groundNormal.y) < 0.9) this.forward.set(0, -1, 0);
      else this.forward.set(0, 0, -1);
    }
    this.forward.normalize();
    this.surfaceRight.crossVectors(this.forward, this.groundNormal).normalize();
    this.surfaceBack.copy(this.forward).multiplyScalar(-1);
    this.surfaceMatrix.makeBasis(this.surfaceRight, this.groundNormal, this.surfaceBack);
    this.surfaceQ.setFromRotationMatrix(this.surfaceMatrix).normalize();
    this.q.slerp(this.surfaceQ, 1 - Math.exp(-12 * dt));
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

    const snapDistance = this.lowLatency ? 10.0 : 7.5;
    const snapRotation = this.lowLatency ? 1.8 : 1.5;
    if (posError > snapDistance || rotError > snapRotation) {
      this.pos.copy(this.authPos);
      this.q.copy(this.targetQ);
      this.vel.copy(this.authVel);
      this.ang.copy(this.authAng);
    } else {
      // Ultra/VM mode deliberately trusts local prediction more. The server is
      // still authoritative, but correction no longer feels like input drag.
      const positionResponse = this.lowLatency ? 2.0 : 4.5;
      const rotationResponse = this.lowLatency ? 3.2 : 6.0;
      const velocityResponse = this.lowLatency ? 1.8 : 3.5;
      const positionAlpha = 1 - Math.exp(-positionResponse * dt);
      const rotationAlpha = 1 - Math.exp(-rotationResponse * dt);
      const velocityAlpha = 1 - Math.exp(-velocityResponse * dt);
      this.pos.lerp(this.authPos, positionAlpha);
      this.q.slerp(this.targetQ, rotationAlpha);
      this.vel.lerp(this.authVel, velocityAlpha);
      this.ang.lerp(this.authAng, velocityAlpha);
    }

    this.resolveArenaCollision();
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, false);
    this.body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, false);
    this.body.setLinvel({ x: this.vel.x, y: this.vel.y, z: this.vel.z }, false);
    this.body.setAngvel({ x: this.ang.x, y: this.ang.y, z: this.ang.z }, false);
    this.syncGrounded(Boolean(target.g));
  }
}
