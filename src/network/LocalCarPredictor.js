import * as THREE from 'three';
import { CAR_TUNING, INPUT_BITS, INPUT_EDGES } from '../shared/game-tuning.js';
import { ARENA_TUNING, CAR_HITBOX } from '../shared/arena-tuning.js';

const VEC_FORWARD = new THREE.Vector3(0, 0, -1);
const VEC_RIGHT = new THREE.Vector3(1, 0, 0);
const VEC_UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const SURFACE_CONTACT_SLOP = 0.075;
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
    this.dodgeTime = 0;
    this.boost = Number.isFinite(Number(car.boost)) ? Number(car.boost) : CAR_TUNING.boostCapacity;
    this.car.boost = this.boost;

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
    this.mask = (Number(packet?.mask) || 0) & 0xff;
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
      this.jumpCount = 0;
      this.dodgeTime = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = false;
    }
    this.car.grounded = this.grounded;
  }

  step(frameDt) {
    // Keep prediction stable on low-FPS machines by splitting long render frames.
    let remaining = Math.min(frameDt, 0.05);
    while (remaining > 0.00001) {
      const dt = Math.min(remaining, 1 / this.simulationHz);
      this.stepSubframe(dt);
      remaining -= dt;
    }
  }

  stepSubframe(dt) {
    this.groundLockout = Math.max(0, this.groundLockout - dt);
    this.dodgeTime = Math.max(0, this.dodgeTime - dt);

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
    const wantsBoost = this.isDown(INPUT_BITS.BOOST);
    const boosting = wantsBoost && this.boost > 0.001;
    if (boosting) this.boost = Math.max(0, this.boost - CAR_TUNING.boostConsumptionPerSecond * dt);

    const nearFloor = this.pos.y <= CAR_HITBOX.y + 0.12 && this.up.y > 0.45 && Math.abs(this.vel.y) < 4.5;
    if (nearFloor && !this.grounded) this.groundNormal.set(0, 1, 0);
    let driveGrounded = this.groundLockout <= 0 && (this.grounded || nearFloor);

    if (this.consumeEdge(INPUT_EDGES.RESET)) {
      this.car.reset();
      this.grounded = false;
      this.jumpCount = 0;
      this.airTime = 0;
      this.groundLockout = 0;
      this.dodgeTime = 0;
      this.boost = CAR_TUNING.boostCapacity;
      this.car.boost = this.boost;
      return;
    }

    if (driveGrounded) {
      this.applyGroundDrive(dt, forwardInput, sideInput, boosting);
      this.airTime = 0;
    } else {
      this.applyAirControl(dt, forwardInput, sideInput, rollInput, boosting);
      this.airTime += dt;
    }

    if (this.consumeEdge(INPUT_EDGES.JUMP)) {
      if (driveGrounded && this.jumpCount === 0) {
        const normalSpeed = this.vel.dot(this.groundNormal);
        this.vel.addScaledVector(this.groundNormal, Math.max(0, CAR_TUNING.jumpSpeed - normalSpeed));
        this.jumpCount = 1;
        this.airTime = 0;
        this.grounded = false;
        this.groundLockout = 0.16;
        driveGrounded = false;
      } else if (!driveGrounded && this.jumpCount === 1 && this.airTime <= CAR_TUNING.dodgeWindow) {
        this.applySecondJumpOrDodge(forwardInput, sideInput);
      }
    }

    if (this.isDown(INPUT_BITS.JUMP) && this.jumpCount === 1 && this.airTime <= CAR_TUNING.jumpHoldDuration) {
      this.vel.addScaledVector(this.up, CAR_TUNING.jumpHoldAcceleration * dt);
    }

    if (driveGrounded) this.applySurfaceForces(dt);

    this.vel.y -= CAR_TUNING.gravity * dt;
    this.vel.multiplyScalar(Math.exp(-CAR_TUNING.linearDamping * dt));
    this.ang.multiplyScalar(Math.exp(-CAR_TUNING.angularDamping * dt));

    const maxSafetySpeed = CAR_TUNING.maxBoostSpeed;
    const speed = this.vel.length();
    if (speed > maxSafetySpeed) this.vel.multiplyScalar(maxSafetySpeed / speed);

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
    this.car.boost = this.boost;
    this.car.boosting = boosting;
  }

  projectForwardToSurface() {
    this.forward.addScaledVector(this.groundNormal, -this.forward.dot(this.groundNormal));
    if (this.forward.lengthSq() > 0.0125) {
      this.forward.normalize();
      return;
    }

    this.forward.copy(this.vel).addScaledVector(this.groundNormal, -this.vel.dot(this.groundNormal));
    if (this.forward.lengthSq() > 0.25) {
      this.forward.normalize();
      return;
    }

    this.forward.copy(VEC_UP).addScaledVector(this.groundNormal, -this.groundNormal.y);
    if (this.forward.lengthSq() < 0.0125) {
      this.forward.copy(VEC_FORWARD).addScaledVector(this.groundNormal, -VEC_FORWARD.dot(this.groundNormal));
    }
    this.forward.normalize();
  }

  applyGroundDrive(dt, throttle, steer, boosting) {
    this.projectForwardToSurface();
    this.right.crossVectors(this.forward, this.groundNormal).normalize();

    const speedForward = this.vel.dot(this.forward);
    const speedLateral = this.vel.dot(this.right);
    const tangentSpeed = Math.hypot(speedForward, speedLateral);
    const reverseTarget = -CAR_TUNING.maxGroundSpeed * 0.68;
    const opposing = throttle !== 0
      && Math.abs(speedForward) > 0.05
      && Math.sign(throttle) !== Math.sign(speedForward);

    let nextForward = speedForward;
    if (opposing) {
      const brakeTarget = throttle < 0 ? reverseTarget : CAR_TUNING.maxGroundSpeed;
      nextForward = moveTowards(speedForward, brakeTarget, CAR_TUNING.brakeAcceleration * dt);
    } else if (throttle > 0) {
      // Normal throttle can accelerate to 70 km/h, but it never drags a
      // previously boosted car back down from the 70-100 km/h momentum band.
      if (speedForward < CAR_TUNING.maxGroundSpeed) {
        nextForward = moveTowards(speedForward, CAR_TUNING.maxGroundSpeed, CAR_TUNING.driveAcceleration * dt);
      }
    } else if (throttle < 0) {
      nextForward = moveTowards(speedForward, reverseTarget, CAR_TUNING.reverseAcceleration * dt);
    } else if (speedForward <= CAR_TUNING.maxGroundSpeed + 0.01) {
      // Below normal top speed the familiar coast slowdown remains. Above it,
      // boosted momentum is retained until braking/collision actually slows us.
      nextForward = moveTowards(speedForward, 0, CAR_TUNING.coastDeceleration * dt);
    }

    if (boosting) {
      nextForward = moveTowards(nextForward, CAR_TUNING.maxBoostSpeed, CAR_TUNING.boostAcceleration * dt);
    }

    const nextLateral = speedLateral * Math.exp(-CAR_TUNING.grip * dt);
    const normalSpeed = Math.min(0, this.vel.dot(this.groundNormal));
    this.vel.copy(this.forward).multiplyScalar(nextForward)
      .addScaledVector(this.right, nextLateral)
      .addScaledVector(this.groundNormal, normalSpeed);

    const steerStrength = clamp(Math.max(Math.abs(nextForward), 1.5) / 7, 0.18, 1)
      * clamp(1 - tangentSpeed / 70, 0.48, 1);
    const reverseSign = Math.sign(nextForward || throttle || 1);
    const targetYaw = steer * CAR_TUNING.steerRate * steerStrength * reverseSign;
    let spin = this.ang.dot(this.groundNormal);
    this.ang.addScaledVector(this.groundNormal, -spin).multiplyScalar(Math.exp(-CAR_TUNING.angularGroundDamping * dt));
    spin = damp(spin, targetYaw, CAR_TUNING.steerResponse, dt);
    this.ang.addScaledVector(this.groundNormal, spin);
    this.grounded = true;
  }

  applyAirControl(dt, forwardInput, sideInput, rollInput, boosting) {
    const controlScale = this.dodgeTime > 0 ? CAR_TUNING.dodgeControlScale : 1;
    const maxAngular = this.dodgeTime > 0
      ? Math.max(CAR_TUNING.maxAirAngular, CAR_TUNING.dodgeAngularSpeed)
      : CAR_TUNING.maxAirAngular;

    this.ang
      .addScaledVector(this.right, -forwardInput * CAR_TUNING.airPitchAcceleration * controlScale * dt)
      .addScaledVector(this.up, sideInput * CAR_TUNING.airYawAcceleration * controlScale * dt)
      .addScaledVector(this.forward, rollInput * CAR_TUNING.airRollAcceleration * controlScale * dt);
    const angularLength = this.ang.length();
    if (angularLength > maxAngular) this.ang.multiplyScalar(maxAngular / angularLength);

    if (boosting) {
      this.vel.addScaledVector(this.forward, CAR_TUNING.boostAcceleration * dt);
      const speed = this.vel.length();
      if (speed > CAR_TUNING.maxBoostSpeed) this.vel.multiplyScalar(CAR_TUNING.maxBoostSpeed / speed);
    }
  }

  applySecondJumpOrDodge(forwardInput, sideInput) {
    const directionMagnitude = Math.hypot(forwardInput, sideInput);
    if (directionMagnitude < 0.25) {
      this.vel.addScaledVector(this.up, CAR_TUNING.doubleJumpSpeed);
      this.jumpCount = 2;
      return;
    }

    const forwardAmount = forwardInput / directionMagnitude;
    const sideAmount = sideInput / directionMagnitude;
    this.surfaceNormal.copy(this.forward).multiplyScalar(forwardAmount)
      .addScaledVector(this.right, -sideAmount)
      .normalize();
    this.vel.addScaledVector(this.surfaceNormal, CAR_TUNING.dodgeImpulse)
      .addScaledVector(this.up, CAR_TUNING.dodgeLift);

    this.surfaceNormal.copy(this.right).multiplyScalar(-forwardAmount)
      .addScaledVector(this.forward, sideAmount)
      .normalize();
    const currentFlipSpeed = this.ang.dot(this.surfaceNormal);
    this.ang.addScaledVector(this.surfaceNormal, CAR_TUNING.dodgeAngularSpeed - currentFlipSpeed);
    this.dodgeTime = CAR_TUNING.dodgeDuration;
    this.jumpCount = 2;
  }

  applySurfaceForces(dt) {
    const steepness = clamp(1 - Math.max(0, this.groundNormal.y), 0, 1);
    const gravityDotNormal = -CAR_TUNING.gravity * this.groundNormal.y;
    this.surfaceNormal.set(0, -CAR_TUNING.gravity, 0)
      .addScaledVector(this.groundNormal, -gravityDotNormal);
    this.vel.addScaledVector(this.surfaceNormal, -CAR_TUNING.wallGravityCancel * steepness * dt);
    this.vel.addScaledVector(this.groundNormal, -CAR_TUNING.downAcceleration * dt);
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

  goalMouthRadius() {
    const arena = ARENA_TUNING;
    const halfWidth = arena.goalWidth * 0.5;
    const requested = Number(arena.goalMouthRadius) > 0
      ? Number(arena.goalMouthRadius)
      : Math.min(arena.goalRampRadius, 3);
    return Math.max(0.2, Math.min(requested, halfWidth - 0.1, arena.goalDepth - 0.1));
  }

  goalOpeningHalfWidthAtDepth(depth) {
    const arena = ARENA_TUNING;
    const halfWidth = arena.goalWidth * 0.5;
    const radius = this.goalMouthRadius();
    if (radius <= 0.000001) return halfWidth;
    if (depth <= 0) return halfWidth + radius;
    if (depth >= radius) return halfWidth;

    const vertical = depth - radius;
    return halfWidth + radius - Math.sqrt(Math.max(0, radius * radius - vertical * vertical));
  }

  findNearestBoundary(goalOpeningHeight) {
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
    let bestDistance = 0;
    let bestNX = 0;
    let bestNZ = 0;
    const consider = (distance, nx, nz) => {
      const replace = !found
        || (bestDistance >= 0 && distance >= 0 && distance < bestDistance)
        || (bestDistance < 0 && distance < 0 && distance > bestDistance)
        || (bestDistance >= 0 && distance < 0);
      if (replace) {
        bestDistance = distance;
        bestNX = nx;
        bestNZ = nz;
      }
      found = true;
    };

    if (absZ <= straightZ) {
      consider(halfWidth - absX, Math.sign(this.pos.x || 1), 0);
    }
    if (absX <= straightX && !goalOpeningHeight) {
      consider(halfLength - absZ, 0, Math.sign(this.pos.z || 1));
    }

    if (goalOpeningHeight) {
      const radius = this.goalMouthRadius();
      const halfGoal = arena.goalWidth * 0.5;
      const depth = absZ - halfLength;
      const outsideOpening = absX - halfGoal;
      const signX = Math.sign(this.pos.x || 1);
      const signZ = Math.sign(this.pos.z || 1);
      // The compact wall ramp begins slightly before the horizontal goal-mouth
      // fillet. Keep the end-wall distance field active far enough into the
      // pitch so prediction does not leave a narrow ramp/contact gap.
      if (outsideOpening < radius && depth < radius) {
        const dx = outsideOpening - radius;
        const dz = depth - radius;
        const distanceToCenter = Math.hypot(dx, dz);
        if (distanceToCenter > 0.000001) {
          consider(
            distanceToCenter - radius,
            signX * (-dx / distanceToCenter),
            signZ * (-dz / distanceToCenter)
          );
        }
      }
      if (outsideOpening >= radius) consider(-depth, 0, signZ);
      if (depth >= radius) consider(-outsideOpening, signX, 0);
    }

    if (found) {
      this.boundaryDistance = bestDistance;
      this.boundaryNX = bestNX;
      this.boundaryNZ = bestNZ;
    }
    return found;
  }

  isInGoalTunnel(extentX, extentY, extentZ) {
    const arena = ARENA_TUNING;
    const halfLength = arena.length * 0.5;
    const depth = Math.abs(this.pos.z) - halfLength;
    if (depth < -extentZ - SURFACE_CONTACT_SLOP
      || depth > arena.goalDepth + extentZ + SURFACE_CONTACT_SLOP) return false;

    return Math.abs(this.pos.x) <= this.goalOpeningHalfWidthAtDepth(depth) + extentX + SURFACE_CONTACT_SLOP
      && this.pos.y <= arena.goalHeight + extentY + SURFACE_CONTACT_SLOP;
  }

  findNearestGoalBoundary() {
    const arena = ARENA_TUNING;
    const halfLength = arena.length * 0.5;
    const depth = Math.abs(this.pos.z) - halfLength;
    const mouthRadius = this.goalMouthRadius();
    if (depth < -mouthRadius - SURFACE_CONTACT_SLOP) return false;

    const halfWidth = arena.goalWidth * 0.5;
    const radius = Math.max(0.2, Math.min(arena.goalRampRadius, halfWidth - 0.1, arena.goalDepth - 0.1));
    const straightX = halfWidth - radius;
    const straightDepth = arena.goalDepth - radius;
    const absX = Math.abs(this.pos.x);
    const signX = Math.sign(this.pos.x || 1);
    const signZ = Math.sign(this.pos.z || 1);

    if (absX > straightX && depth > straightDepth) {
      const centerX = signX * straightX;
      const dx = this.pos.x - centerX;
      const dd = depth - straightDepth;
      const distance = Math.hypot(dx, dd);
      if (distance > 0.000001) {
        this.boundaryDistance = radius - distance;
        this.boundaryNX = dx / distance;
        this.boundaryNZ = signZ * dd / distance;
        return true;
      }
    }

    let found = false;
    let bestDistance = 0;
    let bestNX = 0;
    let bestNZ = 0;
    const consider = (distance, nx, nz) => {
      const replace = !found
        || (bestDistance >= 0 && distance >= 0 && distance < bestDistance)
        || (bestDistance < 0 && distance < 0 && distance > bestDistance)
        || (bestDistance >= 0 && distance < 0);
      if (replace) {
        bestDistance = distance;
        bestNX = nx;
        bestNZ = nz;
      }
      found = true;
    };

    const outsideOpening = absX - halfWidth;
    if (outsideOpening < mouthRadius && depth < mouthRadius) {
      const dx = outsideOpening - mouthRadius;
      const dz = depth - mouthRadius;
      const distanceToCenter = Math.hypot(dx, dz);
      if (distanceToCenter > 0.000001) {
        consider(
          distanceToCenter - mouthRadius,
          signX * (-dx / distanceToCenter),
          signZ * (-dz / distanceToCenter)
        );
      }
    }
    if (outsideOpening >= mouthRadius) consider(-depth, 0, signZ);
    if (depth >= mouthRadius) consider(-outsideOpening, signX, 0);
    if (depth >= 0) consider(arena.goalDepth - depth, 0, signZ);

    if (found) {
      this.boundaryDistance = bestDistance;
      this.boundaryNX = bestNX;
      this.boundaryNZ = bestNZ;
    }
    return found;
  }

  resolveGoalTunnelCollision(extentX, extentY, extentZ) {
    const arena = ARENA_TUNING;
    if (!this.isInGoalTunnel(extentX, extentY, extentZ)) return;
    const hasBoundary = this.findNearestGoalBoundary();
    const radius = arena.goalRampRadius;

    const lowerRampZone = hasBoundary
      && this.boundaryDistance < radius + SURFACE_CONTACT_SLOP
      && this.pos.y <= radius + extentY + SURFACE_CONTACT_SLOP;
    let floorContact = false;
    if (!lowerRampZone) {
      floorContact = this.pos.y <= extentY + SURFACE_CONTACT_SLOP;
      if (this.pos.y < extentY) {
        this.pos.y = extentY;
        if (this.vel.y < 0) this.vel.y = 0;
      }
    }

    const upperRampZone = hasBoundary
      && this.boundaryDistance < radius + SURFACE_CONTACT_SLOP
      && this.pos.y >= arena.goalHeight - radius - extentY - SURFACE_CONTACT_SLOP;
    let ceilingContact = false;
    if (!upperRampZone) {
      const ceilingY = arena.goalHeight - extentY;
      ceilingContact = this.pos.y >= ceilingY - SURFACE_CONTACT_SLOP;
      if (this.pos.y > ceilingY) {
        this.pos.y = ceilingY;
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }

    if (hasBoundary) {
      const outwardX = this.boundaryNX;
      const outwardZ = this.boundaryNZ;
      let roundedResolved = false;
      const lowerHorizontal = radius - this.boundaryDistance;
      const lowerVertical = this.pos.y - radius;
      if (lowerHorizontal >= 0 && lowerVertical <= 0) {
        const distance = Math.hypot(lowerHorizontal, lowerVertical);
        if (distance > 0.000001) {
          const nx = -outwardX * lowerHorizontal / distance;
          const ny = -lowerVertical / distance;
          const nz = -outwardZ * lowerHorizontal / distance;
          const support = this.supportAlong(nx, ny, nz);
          const maximumDistance = Math.max(0.1, radius - support);
          const penetration = distance - maximumDistance;
          if (penetration >= -SURFACE_CONTACT_SLOP) {
            if (penetration > 0) this.resolveIntoPlayable(nx, ny, nz, penetration);
            this.markSurfaceContact(nx, ny, nz);
            roundedResolved = true;
          }
        }
      }

      if (!roundedResolved) {
        const upperHorizontal = radius - this.boundaryDistance;
        const upperVertical = this.pos.y - (arena.goalHeight - radius);
        if (upperHorizontal >= 0 && upperVertical >= 0) {
          const distance = Math.hypot(upperHorizontal, upperVertical);
          if (distance > 0.000001) {
            const nx = -outwardX * upperHorizontal / distance;
            const ny = -upperVertical / distance;
            const nz = -outwardZ * upperHorizontal / distance;
            const support = this.supportAlong(nx, ny, nz);
            const maximumDistance = Math.max(0.1, radius - support);
            const penetration = distance - maximumDistance;
            if (penetration >= -SURFACE_CONTACT_SLOP) {
              if (penetration > 0) this.resolveIntoPlayable(nx, ny, nz, penetration);
              this.markSurfaceContact(nx, ny, nz);
              roundedResolved = true;
            }
          }
        }
      }

      if (!roundedResolved) {
        const nx = -outwardX;
        const nz = -outwardZ;
        const support = this.supportAlong(nx, 0, nz);
        const penetration = support - this.boundaryDistance;
        if (penetration >= -SURFACE_CONTACT_SLOP) {
          if (penetration > 0) this.resolveIntoPlayable(nx, 0, nz, penetration);
          this.markSurfaceContact(nx, 0, nz);
          this.ang.multiplyScalar(0.985);
        }
      }
    }

    if (!this.surfaceContactThisStep && floorContact) this.markSurfaceContact(0, 1, 0);
    if (!this.surfaceContactThisStep && ceilingContact) this.markSurfaceContact(0, -1, 0);
  }

  markSurfaceContact(nx, ny, nz) {
    if (this.groundLockout > 0) return;
    this.surfaceNormal.set(nx, ny, nz).normalize();
    if (this.up.dot(this.surfaceNormal) <= 0.06) return;

    if (this.groundNormal.dot(this.surfaceNormal) > 0.05) {
      this.groundNormal.lerp(this.surfaceNormal, CAR_TUNING.surfaceNormalBlend).normalize();
    } else {
      this.groundNormal.copy(this.surfaceNormal);
    }
    this.grounded = true;
    this.surfaceContactThisStep = true;
    this.airTime = 0;
  }

  resolveArenaCollision() {
    const arena = ARENA_TUNING;
    const halfLength = arena.length * 0.5;
    this.surfaceContactThisStep = false;
    this.grounded = false;

    // Refresh the basis after integrating rotation so the oriented hitbox and
    // the server use the same support extents for this exact predicted pose.
    this.forward.copy(VEC_FORWARD).applyQuaternion(this.q).normalize();
    this.right.copy(VEC_RIGHT).applyQuaternion(this.q).normalize();
    this.up.copy(VEC_UP).applyQuaternion(this.q).normalize();

    const extentY = this.supportAlong(0, 1, 0);
    const extentX = this.supportAlong(1, 0, 0);
    const extentZ = this.supportAlong(0, 0, 1);
    const inGoal = this.isInGoalTunnel(extentX, extentY, extentZ);
    const goalOpeningHeight = this.pos.y + extentY <= arena.goalHeight;
    const hasBoundary = this.findNearestBoundary(goalOpeningHeight);

    const lowerRampZone = hasBoundary
      && this.boundaryDistance < arena.rampRadius + SURFACE_CONTACT_SLOP
      && this.pos.y <= arena.rampRadius + extentY + SURFACE_CONTACT_SLOP;
    let floorContact = false;
    if (!inGoal && !lowerRampZone) {
      floorContact = this.pos.y <= extentY + SURFACE_CONTACT_SLOP;
      if (this.pos.y < extentY) {
        this.pos.y = extentY;
        if (this.vel.y < 0) this.vel.y = 0;
      }
    }

    const upperRampZone = hasBoundary
      && this.boundaryDistance < arena.ceilingRampRadius + SURFACE_CONTACT_SLOP
      && this.pos.y >= arena.ceiling - arena.ceilingRampRadius - extentY - SURFACE_CONTACT_SLOP;
    let ceilingContact = false;
    if (!inGoal && !upperRampZone) {
      const ceilingY = arena.ceiling - extentY;
      ceilingContact = this.pos.y >= ceilingY - SURFACE_CONTACT_SLOP;
      if (this.pos.y > ceilingY) {
        this.pos.y = ceilingY;
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }

    if (hasBoundary) {
      const outwardX = this.boundaryNX;
      const outwardZ = this.boundaryNZ;
      let roundedResolved = false;

      const lowerHorizontal = arena.rampRadius - this.boundaryDistance;
      const lowerVertical = this.pos.y - arena.rampRadius;
      if (lowerHorizontal >= 0 && lowerVertical <= 0) {
        const distance = Math.hypot(lowerHorizontal, lowerVertical);
        if (distance > 0.000001) {
          const nx = -outwardX * lowerHorizontal / distance;
          const ny = -lowerVertical / distance;
          const nz = -outwardZ * lowerHorizontal / distance;
          const support = this.supportAlong(nx, ny, nz);
          const maximumDistance = Math.max(0.1, arena.rampRadius - support);
          const penetration = distance - maximumDistance;
          if (penetration >= -SURFACE_CONTACT_SLOP) {
            if (penetration > 0) this.resolveIntoPlayable(nx, ny, nz, penetration);
            this.markSurfaceContact(nx, ny, nz);
            roundedResolved = true;
          }
        }
      }

      if (!roundedResolved) {
        const upperHorizontal = arena.ceilingRampRadius - this.boundaryDistance;
        const upperVertical = this.pos.y - (arena.ceiling - arena.ceilingRampRadius);
        if (upperHorizontal >= 0 && upperVertical >= 0) {
          const distance = Math.hypot(upperHorizontal, upperVertical);
          if (distance > 0.000001) {
            const nx = -outwardX * upperHorizontal / distance;
            const ny = -upperVertical / distance;
            const nz = -outwardZ * upperHorizontal / distance;
            const support = this.supportAlong(nx, ny, nz);
            const maximumDistance = Math.max(0.1, arena.ceilingRampRadius - support);
            const penetration = distance - maximumDistance;
            if (penetration >= -SURFACE_CONTACT_SLOP) {
              if (penetration > 0) this.resolveIntoPlayable(nx, ny, nz, penetration);
              this.markSurfaceContact(nx, ny, nz);
              roundedResolved = true;
            }
          }
        }
      }

      if (!roundedResolved) {
        const nx = -outwardX;
        const nz = -outwardZ;
        const support = this.supportAlong(nx, 0, nz);
        const penetration = support - this.boundaryDistance;
        if (penetration >= -SURFACE_CONTACT_SLOP) {
          if (penetration > 0) this.resolveIntoPlayable(nx, 0, nz, penetration);
          this.markSurfaceContact(nx, 0, nz);
          this.ang.multiplyScalar(0.985);
        }
      }
    }

    if (inGoal || Math.abs(this.pos.z) + extentZ > halfLength - SURFACE_CONTACT_SLOP) {
      this.resolveGoalTunnelCollision(extentX, extentY, extentZ);
    }

    if (!this.surfaceContactThisStep && floorContact) this.markSurfaceContact(0, 1, 0);
    if (!this.surfaceContactThisStep && ceilingContact) this.markSurfaceContact(0, -1, 0);
  }

  alignToSurface(dt) {
    if (!this.grounded || this.groundLockout > 0) return;
    this.forward.copy(VEC_FORWARD).applyQuaternion(this.q);
    this.projectForwardToSurface();
    this.surfaceRight.crossVectors(this.forward, this.groundNormal).normalize();
    this.surfaceBack.copy(this.forward).multiplyScalar(-1);
    this.surfaceMatrix.makeBasis(this.surfaceRight, this.groundNormal, this.surfaceBack);
    this.surfaceQ.setFromRotationMatrix(this.surfaceMatrix).normalize();
    this.q.slerp(this.surfaceQ, 1 - Math.exp(-CAR_TUNING.surfaceAlignResponse * dt));
    this.jumpCount = 0;
    this.dodgeTime = 0;
    this.airTime = 0;
  }

  reconcile(target, dt, ageSec, rttMs) {
    if (!target) return;

    const serverBoost = Number(target.b);
    if (Number.isFinite(serverBoost)) {
      const clampedBoost = clamp(serverBoost, 0, CAR_TUNING.boostCapacity);
      if (clampedBoost > this.boost + 4) this.boost = clampedBoost;
      else this.boost = THREE.MathUtils.lerp(this.boost, clampedBoost, 0.38);
      this.car.boost = this.boost;
    }

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
