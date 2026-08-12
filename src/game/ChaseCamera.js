import * as THREE from 'three';

const MODE_BALL = 'BALL';
const MODE_CAR = 'CAR';

const CAR_TARGET_LOCAL_HEIGHT = 0.34;
const OCCLUSION_TARGET_PADDING = 1.7;

function isDescendantOf(object, root) {
  if (!root) return false;
  for (let current = object; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

// Rocket-League-style chase camera with two modes:
// - Ball Cam: the camera ORBITS around the local car based on the ball bearing,
//   but still looks at the car. This keeps the car dead-center on screen.
// - Car Cam: the camera stays behind the car's field-relative heading.
//
// The camera is intentionally NOT clamped to the arena. Before rendering we
// raycast from the camera to the local car and temporarily hide any meshes in
// the way, so walls, goal geometry, ramps, stands, etc. never block the car.
export class ChaseCamera {
  constructor(camera, car, ball, scene = car.scene) {
    this.camera = camera;
    this.car = car;
    this.ball = ball;
    this.scene = scene;
    this.mode = MODE_BALL;
    this.replaySavedCar = null;
    this.replaySavedMode = null;

    this.position = new THREE.Vector3(0, 4.4, 8.8);
    this.desired = new THREE.Vector3();
    this.carPosition = new THREE.Vector3();
    this.ballPosition = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.toBall = new THREE.Vector3();
    this.carForward = new THREE.Vector3(0, 0, -1);
    this.carUp = new THREE.Vector3(0, 1, 0);
    this.targetOrbitDirection = new THREE.Vector3(0, 0, -1);
    this.orbitDirection = new THREE.Vector3(0, 0, -1);
    this.carHeadingDirection = new THREE.Vector3(0, 0, -1);
    this.q = new THREE.Quaternion();

    this.raycaster = new THREE.Raycaster();
    this.occlusionDirection = new THREE.Vector3();
    this.occludedObjects = [];
    this.occludedSet = new Set();
    this.occlusionCandidates = null;

    this.camera.up.set(0, 1, 0);
  }

  toggleMode() {
    this.mode = this.mode === MODE_BALL ? MODE_CAR : MODE_BALL;
    return this.mode;
  }

  getMode() {
    return this.mode;
  }

  beginReplay(car) {
    if (!car || car === this.car && this.replaySavedCar) return;
    if (!this.replaySavedCar) {
      this.replaySavedCar = this.car;
      this.replaySavedMode = this.mode;
    }
    this.car = car;
    this.mode = MODE_BALL;
    this.resetTargetTracking();
  }

  endReplay() {
    if (!this.replaySavedCar) return;
    this.car = this.replaySavedCar;
    this.mode = this.replaySavedMode || MODE_BALL;
    this.replaySavedCar = null;
    this.replaySavedMode = null;
    this.resetTargetTracking();
  }

  resetTargetTracking() {
    const p = this.car?.body?.translation?.();
    const r = this.car?.body?.rotation?.();
    if (p) this.carPosition.set(p.x, p.y, p.z);
    if (r) {
      this.q.set(r.x, r.y, r.z, r.w).normalize();
      this.carForward.set(0, 0, -1).applyQuaternion(this.q).normalize();
    }
    this.carHeadingDirection.set(this.carForward.x, 0, this.carForward.z);
    if (this.carHeadingDirection.lengthSq() < 0.0001) this.carHeadingDirection.set(0, 0, -1);
    this.carHeadingDirection.normalize();
    this.orbitDirection.copy(this.carHeadingDirection);
    this.targetOrbitDirection.copy(this.carHeadingDirection);
    this.occlusionCandidates = null;
  }

  update(dt) {
    const p = this.car.body.translation();
    const r = this.car.body.rotation();
    const bp = this.ball.body.translation();

    this.carPosition.set(p.x, p.y, p.z);
    this.ballPosition.set(bp.x, bp.y, bp.z);
    this.q.set(r.x, r.y, r.z, r.w).normalize();

    this.carForward.set(0, 0, -1).applyQuaternion(this.q).normalize();
    this.carUp.set(0, 1, 0).applyQuaternion(this.q).normalize();

    // Aim at the visual center of the car in LOCAL up-space. This continues to
    // be correct while driving on side walls or the ceiling.
    this.pivot.copy(this.carPosition).addScaledVector(this.carUp, CAR_TARGET_LOCAL_HEIGHT);

    const speed = Math.min(this.car.getSpeedKmh() / 100, 1);

    if (this.mode === MODE_BALL) this.updateBallCam(dt, speed);
    else this.updateCarCam(dt, speed);

    const positionT = 1 - Math.exp(-14.5 * dt);
    this.position.lerp(this.desired, positionT);
    this.camera.position.copy(this.position);

    // The car, never the ball, is the look target. Therefore its visual center
    // stays in the exact middle of the viewport in both camera modes.
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.pivot);
  }

  updateBallCam(dt, speed) {
    this.toBall.copy(this.ballPosition).sub(this.pivot);
    const horizontalBallDistance = Math.hypot(this.toBall.x, this.toBall.z);
    const fullBallDistance = this.toBall.length();

    if (horizontalBallDistance > 0.65) {
      this.targetOrbitDirection.set(this.toBall.x, 0, this.toBall.z).normalize();
    } else {
      // When the ball is almost directly above/below the car, keep a stable
      // field-relative heading instead of spinning the camera unpredictably.
      this.updateCarHeadingDirection(dt);
      this.targetOrbitDirection.copy(this.carHeadingDirection);
    }

    const orbitT = 1 - Math.exp(-11.5 * dt);
    this.orbitDirection.lerp(this.targetOrbitDirection, orbitT);
    if (this.orbitDirection.lengthSq() < 0.0001) this.orbitDirection.copy(this.targetOrbitDirection);
    this.orbitDirection.normalize();

    const ballHeight = this.ballPosition.y - this.pivot.y;
    const distance = 7.45
      + speed * 1.0
      + THREE.MathUtils.clamp(fullBallDistance * 0.012, 0, 1.15);

    // Keep the camera above the car, but lower it a little for high balls so
    // the ball remains easier to read without ever moving the car off-center.
    const height = THREE.MathUtils.clamp(
      3.0 + speed * 0.3 - ballHeight * 0.07,
      1.65,
      4.2
    );

    this.desired.copy(this.pivot)
      .addScaledVector(this.orbitDirection, -distance);
    this.desired.y += height;
  }

  updateCarCam(dt, speed) {
    this.updateCarHeadingDirection(dt);

    const distance = 7.15 + speed * 0.9;
    const height = 2.85 + speed * 0.28;

    this.desired.copy(this.pivot)
      .addScaledVector(this.carHeadingDirection, -distance);
    this.desired.y += height;
  }

  updateCarHeadingDirection(dt) {
    this.targetOrbitDirection.set(this.carForward.x, 0, this.carForward.z);
    if (this.targetOrbitDirection.lengthSq() < 0.0025) {
      this.targetOrbitDirection.copy(this.carHeadingDirection);
    } else {
      this.targetOrbitDirection.normalize();
    }

    const headingT = 1 - Math.exp(-13 * dt);
    this.carHeadingDirection.lerp(this.targetOrbitDirection, headingT);
    if (this.carHeadingDirection.lengthSq() < 0.0001) this.carHeadingDirection.set(0, 0, -1);
    this.carHeadingDirection.normalize();
  }

  // Call immediately before renderer.render(). Every visible mesh intersecting
  // the camera-to-car sight line is hidden for this render only. This lets the
  // camera pass outside/behind arena walls and through goal/stand geometry.
  prepareRender() {
    this.restoreOccluders();
    if (!this.scene) return;

    if (!this.occlusionCandidates) {
      this.occlusionCandidates = [];
      this.scene.traverse((object) => {
        if (!object.isMesh) return;
        if (isDescendantOf(object, this.car.group)) return;
        if (isDescendantOf(object, this.ball.mesh)) return;
        if (object.userData?.cameraOcclusionIgnore) return;
        this.occlusionCandidates.push(object);
      });
    }

    this.occlusionDirection.copy(this.pivot).sub(this.camera.position);
    const targetDistance = this.occlusionDirection.length();
    if (targetDistance <= OCCLUSION_TARGET_PADDING + 0.05) return;

    this.occlusionDirection.multiplyScalar(1 / targetDistance);
    this.raycaster.near = 0.03;
    this.raycaster.far = targetDistance - OCCLUSION_TARGET_PADDING;
    this.raycaster.set(this.camera.position, this.occlusionDirection);

    const intersections = this.raycaster.intersectObjects(this.occlusionCandidates, false);
    for (const hit of intersections) {
      const object = hit.object;
      if (!object?.visible || !object.isMesh) continue;

      // Never make the local car or ball disappear. Everything else may be
      // hidden if it blocks the sight line, including other cars.
      if (isDescendantOf(object, this.car.group)) continue;
      if (isDescendantOf(object, this.ball.mesh)) continue;
      if (object.userData?.cameraOcclusionIgnore) continue;
      if (this.occludedSet.has(object)) continue;

      this.occludedSet.add(object);
      this.occludedObjects.push(object);
      object.visible = false;
    }
  }

  // Call immediately after renderer.render() so normal scene visibility is
  // restored for physics-independent logic and for the next raycast.
  restoreOccluders() {
    for (const object of this.occludedObjects) object.visible = true;
    this.occludedObjects.length = 0;
    this.occludedSet.clear();
  }
}
