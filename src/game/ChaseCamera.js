import * as THREE from 'three';
import { getBallCamFraming, getStableBallCamRig } from '../shared/camera-tuning.js';
import { normalizeCameraSettings } from './CameraSettings.js';

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
// - Ball Cam: the camera ORBITS around the local car based on the horizontal
//   ball bearing. Vertical framing keeps the ball above and the car inside a
//   lower safe band without ever lifting the physical camera toward the ball.
// - Car Cam: the camera stays behind the car's field-relative heading.
//
// The camera is intentionally NOT clamped to the arena. Before rendering we
// raycast from the camera to the local car and temporarily hide any meshes in
// the way, so walls, goal geometry, ramps, stands, etc. never block the car.
export class ChaseCamera {
  constructor(camera, car, ball, scene = car.scene, settings = {}) {
    this.camera = camera;
    this.car = car;
    this.ball = ball;
    this.scene = scene;
    this.settings = normalizeCameraSettings(settings);
    this.mode = this.settings.mode;
    this.replaySavedCar = null;
    this.replaySavedMode = null;
    this.goalCelebrationActive = false;
    this.respawnSelectionActive = false;
    this.respawnTeamSign = 1;
    this.respawnPoints = [];

    this.position = new THREE.Vector3(0, 1.8, 3.6);
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
    this.settings.mode = this.mode;
    return this.mode;
  }

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    this.mode = mode === MODE_CAR ? MODE_CAR : MODE_BALL;
    this.settings.mode = this.mode;
    return this.mode;
  }

  getSettings() {
    return { ...this.settings, mode: this.mode };
  }

  setSettings(settings = {}) {
    this.settings = normalizeCameraSettings({ ...this.settings, ...settings });
    this.mode = this.settings.mode;
    return this.getSettings();
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
      : this.respawnTeamSign * 46.08;
    const portrait = this.camera.aspect < 0.82;
    const height = portrait ? 55 : 45;
    this.position.set(0, height, centerZ + this.respawnTeamSign * (portrait ? 24 : 18));
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

    // Car cam may follow local up-space for wall/ceiling driving. Ball cam uses
    // a world-upright pivot so a flip cannot orbit the camera target around the
    // chassis and move the car away from its fixed screen anchor.
    if (this.goalCelebrationActive || this.mode === MODE_BALL) {
      this.pivot.copy(this.carPosition);
      this.pivot.y += CAR_TARGET_LOCAL_HEIGHT;
    } else {
      this.pivot.copy(this.carPosition).addScaledVector(this.carUp, CAR_TARGET_LOCAL_HEIGHT);
    }

    const speed = Math.min(this.car.getSpeedKmh() / 82.8, 1);

    this.desiredLookTarget.copy(this.pivot);
    if (this.goalCelebrationActive) this.updateGoalCelebrationCam(speed);
    else if (this.mode === MODE_BALL) this.updateBallCam(dt);
    else this.updateCarCam(dt, speed);

    const positionT = 1 - Math.exp(-this.settings.positionStiffness * dt);
    this.position.lerp(this.desired, positionT);
    this.camera.position.copy(this.position);

    // Smooth the two-subject composition as one look target. A high ball may
    // pitch the view upward and pull the camera back, but never raises the
    // physical camera or lets the controllable car leave its lower safe band.
    const lookT = 1 - Math.exp(-this.settings.lookStiffness * dt);
    if (this.lookTarget.lengthSq() < 0.0001) this.lookTarget.copy(this.desiredLookTarget);
    else this.lookTarget.lerp(this.desiredLookTarget, lookT);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);
  }


  updateRespawnSelectionCam(dt) {
    const centerZ = this.respawnPoints.length
      ? this.respawnPoints.reduce((sum, point) => sum + (Number(point?.z) || 0), 0) / this.respawnPoints.length
      : this.respawnTeamSign * 46.08;
    const portrait = this.camera.aspect < 0.82;
    const height = portrait ? 55 : 45;
    const backOffset = portrait ? 24 : 18;
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
    const distance = 3.3 + speed * 0.55;
    const height = 1.46 + speed * 0.22;
    this.desired.copy(this.pivot)
      .addScaledVector(this.celebrationOrbitDirection, -distance);
    this.desired.y += height;
    this.desiredLookTarget.copy(this.pivot);
    this.desiredLookTarget.y += 0.24;
  }

  updateBallCam(dt) {
    this.toBall.copy(this.ballPosition).sub(this.pivot);
    const horizontalBallDistance = Math.hypot(this.toBall.x, this.toBall.z);

    if (horizontalBallDistance > 0.65) {
      this.targetOrbitDirection.set(this.toBall.x, 0, this.toBall.z).normalize();
    } else {
      // When the ball is almost directly above/below the car, keep a stable
      // field-relative heading instead of spinning the camera unpredictably.
      this.updateCarHeadingDirection(dt);
      this.targetOrbitDirection.copy(this.carHeadingDirection);
    }

    const orbitT = 1 - Math.exp(-this.settings.rotationStiffness * dt);
    this.orbitDirection.lerp(this.targetOrbitDirection, orbitT);
    if (this.orbitDirection.lengthSq() < 0.0001) this.orbitDirection.copy(this.targetOrbitDirection);
    this.orbitDirection.normalize();

    const rig = getStableBallCamRig(this.settings);
    const ballForward = this.toBall.x * this.orbitDirection.x + this.toBall.z * this.orbitDirection.z;
    const ballLateral = Math.sqrt(Math.max(
      0,
      horizontalBallDistance * horizontalBallDistance - ballForward * ballForward
    ));
    const framing = getBallCamFraming({
      baseDistance: rig.distance,
      cameraHeight: rig.height,
      carAnchorDrop: CAR_TARGET_LOCAL_HEIGHT,
      ballHeight: this.toBall.y,
      ballForward,
      ballLateral,
      lookHeight: rig.lookHeight,
      verticalFovDegrees: this.camera.fov
    });

    this.desired.copy(this.pivot)
      .addScaledVector(this.orbitDirection, -framing.distance);
    this.desired.y += rig.height;
    const lookDistance = 10;
    const horizontalLook = Math.cos(framing.aimElevation) * lookDistance;
    this.desiredLookTarget.copy(this.desired)
      .addScaledVector(this.orbitDirection, horizontalLook);
    this.desiredLookTarget.y += Math.sin(framing.aimElevation) * lookDistance;
  }

  updateCarCam(dt, speed) {
    this.updateCarHeadingDirection(dt);

    const distance = this.settings.distance - 0.15 + speed * this.settings.speedDistance;
    const height = this.settings.height - 0.05 + speed * this.settings.speedHeight;

    this.desired.copy(this.pivot)
      .addScaledVector(this.carHeadingDirection, -distance);
    this.desired.y += height;
    this.desiredLookTarget.copy(this.pivot);
    this.desiredLookTarget.y += this.settings.lookHeight;
  }

  updateCarHeadingDirection(dt) {
    this.targetOrbitDirection.set(this.carForward.x, 0, this.carForward.z);
    if (this.targetOrbitDirection.lengthSq() < 0.0025) {
      this.targetOrbitDirection.copy(this.carHeadingDirection);
    } else {
      this.targetOrbitDirection.normalize();
    }

    const headingT = 1 - Math.exp(-this.settings.rotationStiffness * dt);
    this.carHeadingDirection.lerp(this.targetOrbitDirection, headingT);
    if (this.carHeadingDirection.lengthSq() < 0.0001) this.carHeadingDirection.set(0, 0, -1);
    this.carHeadingDirection.normalize();
  }

  // Call immediately before renderer.render(). Every visible mesh intersecting
  // the camera-to-car sight line is hidden for this render only. This lets the
  // camera pass outside/behind arena walls and through goal/stand geometry.
  prepareRender() {
    this.restoreOccluders();
    if (!this.scene || this.respawnSelectionActive || !this.settings.occlusion) return;

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
