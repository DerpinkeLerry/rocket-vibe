import * as THREE from 'three';
import { getBallCamHighBallAssist } from '../shared/camera-tuning.js';

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
    this.goalCelebrationActive = false;
    this.respawnSelectionActive = false;
    this.respawnTeamSign = 1;
    this.respawnPoints = [];

    this.position = new THREE.Vector3(0, 4.4, 8.8);
    this.desired = new THREE.Vector3();
    this.carPosition = new THREE.Vector3();
    this.ballPosition = new THREE.Vector3();
    this.pivot = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.desiredLookTarget = new THREE.Vector3();
    this.toBall = new THREE.Vector3();
    this.carForward = new THREE.Vector3(0, 0, -1);
    this.carUp = new THREE.Vector3(0, 1, 0);
    this.targetOrbitDirection = new THREE.Vector3(0, 0, -1);
    this.orbitDirection = new THREE.Vector3(0, 0, -1);
    this.carHeadingDirection = new THREE.Vector3(0, 0, -1);
    this.celebrationOrbitDirection = new THREE.Vector3(0, 0, -1);
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

  setGoalCelebrationActive(active) {
    const next = Boolean(active);
    if (next === this.goalCelebrationActive) return;
    this.goalCelebrationActive = next;

    if (next) {
      // Freeze a world-horizontal camera bearing before the authoritative goal
      // blast starts tumbling the car. The car is still free to spin visually,
      // but the chase camera no longer inherits that angular momentum.
      const source = this.mode === MODE_BALL ? this.orbitDirection : this.carHeadingDirection;
      this.celebrationOrbitDirection.set(source.x, 0, source.z);
      if (this.celebrationOrbitDirection.lengthSq() < 0.0001) {
        this.celebrationOrbitDirection.set(this.carForward.x, 0, this.carForward.z);
      }
      if (this.celebrationOrbitDirection.lengthSq() < 0.0001) this.celebrationOrbitDirection.set(0, 0, -1);
      this.celebrationOrbitDirection.normalize();
    }
  }


  beginRespawnSelection(team = 'orange', points = []) {
    this.respawnSelectionActive = true;
    this.respawnTeamSign = team === 'blue' ? -1 : 1;
    this.respawnPoints = Array.isArray(points) ? points : [];
    const centerZ = this.respawnPoints.length
      ? this.respawnPoints.reduce((sum, point) => sum + (Number(point?.z) || 0), 0) / this.respawnPoints.length
      : this.respawnTeamSign * 52;
    const portrait = this.camera.aspect < 0.82;
    const height = portrait ? 86 : 70;
    this.position.set(0, height, centerZ + this.respawnTeamSign * (portrait ? 33 : 28));
    this.lookTarget.set(0, 0.5, centerZ - this.respawnTeamSign * 7);
    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);
    this.restoreOccluders();
  }

  endRespawnSelection() {
    if (!this.respawnSelectionActive) return;
    this.respawnSelectionActive = false;
    this.respawnPoints = [];
    this.resetTargetTracking();
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
      this.carUp.set(0, 1, 0).applyQuaternion(this.q).normalize();
    }
    this.carHeadingDirection.set(this.carForward.x, 0, this.carForward.z);
    if (this.carHeadingDirection.lengthSq() < 0.0001) this.carHeadingDirection.set(0, 0, -1);
    this.carHeadingDirection.normalize();
    this.orbitDirection.copy(this.carHeadingDirection);
    this.targetOrbitDirection.copy(this.carHeadingDirection);
    this.pivot.copy(this.carPosition).addScaledVector(this.carUp, CAR_TARGET_LOCAL_HEIGHT);
    this.lookTarget.copy(this.pivot);
    this.desiredLookTarget.copy(this.pivot);
    this.occlusionCandidates = null;
  }

  update(dt) {
    if (this.respawnSelectionActive) {
      this.updateRespawnSelectionCam(dt);
      return;
    }

    const p = this.car.body.translation();
    const r = this.car.body.rotation();
    const bp = this.ball.body.translation();

    this.carPosition.set(p.x, p.y, p.z);
    this.ballPosition.set(bp.x, bp.y, bp.z);
    this.q.set(r.x, r.y, r.z, r.w).normalize();

    this.carForward.set(0, 0, -1).applyQuaternion(this.q).normalize();
    this.carUp.set(0, 1, 0).applyQuaternion(this.q).normalize();

    // Normal driving aims at the car in LOCAL up-space so wall/ceiling driving
    // remains correct. During the goal blast, however, the car intentionally
    // tumbles with very high angular velocity. Using local up there makes the
    // camera target orbit around the chassis and causes the unpleasant shaking.
    // Keep the explosion camera world-upright instead.
    if (this.goalCelebrationActive) {
      this.pivot.copy(this.carPosition);
      this.pivot.y += CAR_TARGET_LOCAL_HEIGHT;
    } else {
      this.pivot.copy(this.carPosition).addScaledVector(this.carUp, CAR_TARGET_LOCAL_HEIGHT);
    }

    const speed = Math.min(this.car.getSpeedKmh() / 120, 1);

    this.desiredLookTarget.copy(this.pivot);
    if (this.goalCelebrationActive) this.updateGoalCelebrationCam(speed);
    else if (this.mode === MODE_BALL) this.updateBallCam(dt, speed);
    else this.updateCarCam(dt, speed);

    const positionT = 1 - Math.exp(-14.5 * dt);
    this.position.lerp(this.desired, positionT);
    this.camera.position.copy(this.position);

    // Normal ball-cam keeps the car almost perfectly centered. When the ball is
    // very high above us, a smooth high-ball assist raises both camera and aim
    // target so the ball remains visible instead of disappearing above the FOV.
    const lookT = 1 - Math.exp(-13.5 * dt);
    if (this.lookTarget.lengthSq() < 0.0001) this.lookTarget.copy(this.desiredLookTarget);
    else this.lookTarget.lerp(this.desiredLookTarget, lookT);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);
  }


  updateRespawnSelectionCam(dt) {
    const centerZ = this.respawnPoints.length
      ? this.respawnPoints.reduce((sum, point) => sum + (Number(point?.z) || 0), 0) / this.respawnPoints.length
      : this.respawnTeamSign * 52;
    const portrait = this.camera.aspect < 0.82;
    const height = portrait ? 86 : 70;
    const backOffset = portrait ? 33 : 28;
    this.desired.set(0, height, centerZ + this.respawnTeamSign * backOffset);
    this.desiredLookTarget.set(0, 0.55, centerZ - this.respawnTeamSign * 7);

    const positionT = 1 - Math.exp(-7.5 * dt);
    const lookT = 1 - Math.exp(-9 * dt);
    this.position.lerp(this.desired, positionT);
    this.lookTarget.lerp(this.desiredLookTarget, lookT);
    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);
    this.pivot.copy(this.desiredLookTarget);
  }

  updateGoalCelebrationCam(speed) {
    // Rocket-style goal explosion camera: follow the translated car but ignore
    // its forced tumble. A fixed world-horizontal bearing removes roll/pitch
    // wobble while still showing the car being launched by the explosion.
    const distance = 8.2 + speed * 1.4;
    const height = 3.65 + speed * 0.55;
    this.desired.copy(this.pivot)
      .addScaledVector(this.celebrationOrbitDirection, -distance);
    this.desired.y += height;
    this.desiredLookTarget.copy(this.pivot);
    this.desiredLookTarget.y += 0.24;
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
    const highBall = getBallCamHighBallAssist(ballHeight);
    const distance = 7.45
      + speed * 1.0
      + THREE.MathUtils.clamp(fullBallDistance * 0.012, 0, 1.15)
      + highBall.distanceExtra;

    // Rocket-style high-ball assist: rise and pull back as the ball climbs. The
    // camera only starts giving up exact car centering once the ball is several
    // metres overhead, which keeps normal driving stable but makes aerial reads
    // possible directly underneath the ball.
    const height = THREE.MathUtils.clamp(
      3.0 + speed * 0.3 + highBall.heightExtra,
      2.2,
      15.0
    );
    const lookLift = highBall.lookLift;

    this.desired.copy(this.pivot)
      .addScaledVector(this.orbitDirection, -distance);
    this.desired.y += height;
    this.desiredLookTarget.copy(this.pivot);
    this.desiredLookTarget.y += lookLift;
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
    if (!this.scene || this.respawnSelectionActive) return;

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
