import * as THREE from 'three';
import { clampPointToRoundedArena } from '../shared/arena-tuning.js';

const CAMERA_WALL_MARGIN = 0.72;

// Permanent ball camera.
// The camera orbits around the local car so the ball stays in view at all
// times, while keeping a stable world-up horizon. No toggle/input required.
export class ChaseCamera {
  constructor(camera, car, ball) {
    this.camera = camera;
    this.car = car;
    this.ball = ball;

    this.position = new THREE.Vector3(0, 4.4, 8.8);
    this.lookAt = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.carPosition = new THREE.Vector3();
    this.ballPosition = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.toBall = new THREE.Vector3();
    this.carForward = new THREE.Vector3(0, 0, -1);
    this.targetOrbitDirection = new THREE.Vector3(0, 0, -1);
    this.orbitDirection = new THREE.Vector3(0, 0, -1);
    this.q = new THREE.Quaternion();

    this.camera.up.set(0, 1, 0);
  }

  update(dt) {
    const p = this.car.body.translation();
    const r = this.car.body.rotation();
    const bp = this.ball.body.translation();

    this.carPosition.set(p.x, p.y, p.z);
    this.ballPosition.set(bp.x, bp.y, bp.z);
    this.q.set(r.x, r.y, r.z, r.w);

    // Car forward is only a stability fallback for the rare case where the
    // ball is almost exactly above/below the car and has no useful XZ bearing.
    this.carForward.set(0, 0, -1).applyQuaternion(this.q);
    this.carForward.y = 0;
    if (this.carForward.lengthSq() < 0.0001) this.carForward.set(0, 0, -1);
    else this.carForward.normalize();

    this.pivot.copy(this.carPosition);
    this.pivot.y += 0.62;

    this.toBall.copy(this.ballPosition).sub(this.pivot);
    const horizontalBallDistance = Math.hypot(this.toBall.x, this.toBall.z);
    const fullBallDistance = this.toBall.length();

    if (horizontalBallDistance > 1.35) {
      this.targetOrbitDirection.set(this.toBall.x, 0, this.toBall.z).normalize();
    } else {
      this.targetOrbitDirection.copy(this.carForward);
    }

    // Fast enough to keep the ball locked, but damped enough to avoid a hard
    // camera snap when the ball crosses behind the car.
    const orbitT = 1 - Math.exp(-10.5 * dt);
    this.orbitDirection.lerp(this.targetOrbitDirection, orbitT);
    if (this.orbitDirection.lengthSq() < 0.0001) this.orbitDirection.copy(this.targetOrbitDirection);
    this.orbitDirection.normalize();

    const speed = Math.min(this.car.getSpeedKmh() / 180, 1);
    const ballHeight = this.ballPosition.y - this.carPosition.y;

    // Pull back slightly at high speed / long ball distance. This keeps the
    // local car readable without adding an expensive second camera system.
    const distance = 7.5
      + speed * 1.0
      + THREE.MathUtils.clamp(fullBallDistance * 0.012, 0, 1.15);
    const height = 3.15
      + speed * 0.28
      + THREE.MathUtils.clamp(ballHeight * 0.055, -0.15, 1.0);

    // Camera sits on the opposite side of the car from the ball.
    this.desired.copy(this.carPosition)
      .addScaledVector(this.orbitDirection, -distance);
    this.desired.y += height;

    // The transparent enclosure is still a real camera boundary. Keeping the
    // desired point inside the convex rounded rectangle also keeps every
    // interpolated point inside, so the camera cannot cut through a corner.
    clampPointToRoundedArena(this.desired, CAMERA_WALL_MARGIN);

    const positionT = 1 - Math.exp(-14.5 * dt);
    this.position.lerp(this.desired, positionT);
    clampPointToRoundedArena(this.position, CAMERA_WALL_MARGIN);
    this.camera.position.copy(this.position);

    // Keep the ball itself as the permanent look target. A high response keeps
    // Ball Cam visually locked while still filtering tiny network jitter.
    const lookT = 1 - Math.exp(-28 * dt);
    this.lookAt.lerp(this.ballPosition, lookT);
    this.camera.lookAt(this.lookAt);
  }
}
