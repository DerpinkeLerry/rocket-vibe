import * as THREE from 'three';
import { ARENA_TUNING, clampPointToRoundedArena } from '../shared/arena-tuning.js';
import { BALL_TUNING, CAR_TUNING } from '../shared/game-tuning.js';

const FLOOR_EPSILON = 0.03;

export class BallLandingCue {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.lowDetail = Boolean(options.lowDetail);
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.mobile = Boolean(options.mobile);

    this.group = new THREE.Group();
    this.group.name = 'ball-landing-cue';
    this.group.renderOrder = 7;
    this.scene.add(this.group);

    const ringSegments = this.lowDetail ? 20 : (this.ultraHigh ? 48 : 32);
    const groundMaterial = new THREE.MeshBasicMaterial({
      color: this.ultraHigh ? 0xbef3ff : 0xd6f7ff,
      transparent: true,
      opacity: this.ultraHigh ? 0.34 : 0.30,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    const impactMaterial = new THREE.MeshBasicMaterial({
      color: this.ultraHigh ? 0x80f1ff : 0xa7efff,
      transparent: true,
      opacity: this.ultraHigh ? 0.58 : 0.46,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: this.ultraHigh ? 0x6de8ff : 0xa2edff,
      transparent: true,
      opacity: this.ultraHigh ? 0.18 : 0.12,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    this.groundRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.02, ringSegments), groundMaterial);
    this.groundRing.rotation.x = -Math.PI * 0.5;
    this.groundRing.position.y = FLOOR_EPSILON;
    this.groundRing.name = 'ball-ground-ring';
    this.group.add(this.groundRing);

    this.impactRing = new THREE.Mesh(new THREE.RingGeometry(0.76, 1.00, ringSegments), impactMaterial);
    this.impactRing.rotation.x = -Math.PI * 0.5;
    this.impactRing.position.y = FLOOR_EPSILON * 1.35;
    this.impactRing.name = 'ball-impact-ring';
    this.group.add(this.impactRing);

    this.impactGlow = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.42, ringSegments), glowMaterial);
    this.impactGlow.rotation.x = -Math.PI * 0.5;
    this.impactGlow.position.y = FLOOR_EPSILON * 1.1;
    this.impactGlow.name = 'ball-impact-glow';
    this.group.add(this.impactGlow);

    const tickGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.24, 0, 0), new THREE.Vector3(-0.92, 0, 0),
      new THREE.Vector3(1.24, 0, 0), new THREE.Vector3(0.92, 0, 0),
      new THREE.Vector3(0, 0, -1.24), new THREE.Vector3(0, 0, -0.92),
      new THREE.Vector3(0, 0, 1.24), new THREE.Vector3(0, 0, 0.92)
    ]);
    const tickMaterial = new THREE.LineBasicMaterial({
      color: this.ultraHigh ? 0xdafcff : 0xe6fcff,
      transparent: true,
      opacity: this.ultraHigh ? 0.54 : 0.42,
      depthWrite: false,
      depthTest: true
    });
    this.impactTicks = new THREE.LineSegments(tickGeometry, tickMaterial);
    this.impactTicks.position.y = FLOOR_EPSILON * 1.45;
    this.impactTicks.name = 'ball-impact-ticks';
    this.group.add(this.impactTicks);

    this.group.visible = false;
    this.clock = 0;
    this.groundPoint = new THREE.Vector3();
    this.impactPoint = new THREE.Vector3();
  }

  computeImpactTime(posY, velY, radius) {
    const groundY = Math.max(radius, BALL_TUNING.restingHeight);
    const dy = posY - groundY;
    if (dy <= 0.0001 && velY <= 0.0001) return 0;
    const gravity = Math.max(0.000001, CAR_TUNING.gravity);
    const discriminant = velY * velY + 2 * gravity * Math.max(0, dy);
    if (discriminant < 0) return null;
    const time = (velY + Math.sqrt(discriminant)) / gravity;
    if (!Number.isFinite(time) || time < 0) return null;
    return time;
  }

  update(ball, dt = 0) {
    const translation = ball?.body?.translation?.();
    if (!translation) {
      this.group.visible = false;
      return;
    }

    this.clock += Math.max(0, Number(dt) || 0);

    const velocity = ball?.body?.linvel?.() || { x: 0, y: 0, z: 0 };
    const radius = Math.max(0.1, Number(ball?.radius) || 0.8);
    const groundY = Math.max(radius, BALL_TUNING.restingHeight);
    const heightAboveGround = Math.max(0, translation.y - groundY);

    this.group.visible = true;

    this.groundPoint.set(translation.x, groundY, translation.z);
    clampPointToRoundedArena(this.groundPoint, radius * 0.6);
    this.groundRing.position.set(this.groundPoint.x, FLOOR_EPSILON, this.groundPoint.z);
    const groundScale = THREE.MathUtils.clamp(0.85 + heightAboveGround * 0.06, 0.85, 1.9);
    this.groundRing.scale.setScalar(groundScale * radius);
    this.groundRing.material.opacity = THREE.MathUtils.clamp(0.18 + heightAboveGround * 0.018, 0.18, this.ultraHigh ? 0.40 : 0.34);

    const impactTime = this.computeImpactTime(translation.y, velocity.y, radius);
    const showImpact = impactTime != null && impactTime > 0.08 && impactTime < 2.6 && heightAboveGround > 0.22;
    this.impactRing.visible = showImpact;
    this.impactGlow.visible = showImpact;
    this.impactTicks.visible = showImpact;
    if (!showImpact) return;

    this.impactPoint.set(
      translation.x + velocity.x * impactTime,
      groundY,
      translation.z + velocity.z * impactTime
    );
    clampPointToRoundedArena(this.impactPoint, radius * 0.7);
    const pulse = 0.96 + Math.sin(this.clock * 5.5) * 0.04;
    const impactScale = radius * THREE.MathUtils.clamp(1.1 + Math.min(impactTime, 1.8) * 0.24, 1.1, 1.6) * pulse;
    this.impactRing.position.set(this.impactPoint.x, FLOOR_EPSILON * 1.35, this.impactPoint.z);
    this.impactGlow.position.set(this.impactPoint.x, FLOOR_EPSILON * 1.1, this.impactPoint.z);
    this.impactTicks.position.set(this.impactPoint.x, FLOOR_EPSILON * 1.45, this.impactPoint.z);
    this.impactRing.scale.setScalar(impactScale);
    this.impactGlow.scale.setScalar(impactScale * 1.22);
    this.impactTicks.scale.setScalar(impactScale * 0.96);

    const impactStrength = THREE.MathUtils.clamp(0.3 + heightAboveGround * 0.05 + impactTime * 0.07, 0.3, 1.0);
    this.impactRing.material.opacity = (this.ultraHigh ? 0.52 : 0.42) * impactStrength;
    this.impactGlow.material.opacity = (this.ultraHigh ? 0.16 : 0.11) * impactStrength;
    this.impactTicks.material.opacity = (this.ultraHigh ? 0.48 : 0.36) * impactStrength;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const child of this.group.children) {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
  }
}
