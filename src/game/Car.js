import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TransformBody } from '../network/TransformBody.js';
import {
  CAR_TUNING,
  FULL_STEER_SPEED,
  FULL_STEER_TIME_CONSTANT,
  fullSteerDecelerationAtSpeed,
  getDirectionalDodgeLiftScale,
  throttleAccelerationAtSpeed,
  turningAngularSpeed
} from '../shared/game-tuning.js';
import { CAR_HITBOX } from '../shared/arena-tuning.js';
import { getCarStyle, normalizeCarStyle, shouldUsePremiumCarModel } from '../shared/car-styles.js';
import { getBoostStyle, normalizeBoostStyle } from '../shared/boost-styles.js';
import { BoostTrail } from './BoostTrail.js';
import { createPremiumCarVisual, getPremiumCarExhaustAnchor } from './PremiumCarModels.js';
import { getUprightRecoveryRotation, shouldUseCarRecoveryJump } from './CarRecovery.js';

const VEC3_UP = new THREE.Vector3(0, 1, 0);
const VEC3_FORWARD = new THREE.Vector3(0, 0, -1);
const VEC3_RIGHT = new THREE.Vector3(1, 0, 0);

const clamp = THREE.MathUtils.clamp;
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
const moveTowards = (current, target, maxDelta) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};
const CAR_VISUAL_SCALE = (CAR_HITBOX.z * 2) / 2.95;

export class Car {
  constructor(scene, world, RAPIER, input, options = {}) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.input = input;
    this.lowDetail = Boolean(options.lowDetail);
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.premiumVisualsEnabled = options.initiallyVisible !== false;
    this.clientOnly = Boolean(options.clientOnly);
    this.allowReset = options.allowReset !== false;

    const spawn = options.spawn ?? { x: 0, y: CAR_HITBOX.y, z: 25.6 };
    this.spawn = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.spawnYaw = options.spawnYaw ?? 0;
    this.paintColor = options.color ?? 0xf46b20;
    this.playerName = String(options.playerName || 'Spieler').slice(0, 16);
    this.team = options.team === 'blue' ? 'blue' : 'orange';
    this.isLocalPlayer = Boolean(options.localPlayer);
    this.mobile = Boolean(options.mobile);
    this.carStyle = getCarStyle(options.carStyle);
    this.boostStyle = getBoostStyle(options.boostStyle);
    this.boostVisualHold = 0;
    this.lastVisualBoost = CAR_TUNING.boostCapacity;
    this.boostTrail = null;
    this.visualParts = null;
    this.proceduralRoot = null;
    this.premiumVisual = null;
    this.premiumVisualModelId = null;
    this.premiumVisualLoad = null;
    this.premiumVisualLoadModelId = null;
    this.premiumWheelGroups = [];
    this.premiumSpinQuaternion = new THREE.Quaternion();
    this.premiumSpinAxis = new THREE.Vector3();
    this.wheelPivots = [];
    this.boost = CAR_TUNING.boostCapacity;
    this.boosting = false;
    this.boostVisualHold = 0;
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.jumpCount = 0;
    this.jumpHoldTime = 0;
    this.jumpHoldActive = false;
    this.jumpStickyTime = 0;
    this.airTime = 0;
    this.groundContactLockout = 0;
    this.dodgeTime = 0;
    this.dodgeAngleRemaining = 0;
    this.dodgeStopPending = false;
    this.dodgePitchLock = 0;
    this.dodgeYawLock = 0;
    this.wheelSpin = 0;

    this.tempQ = new THREE.Quaternion();
    this.velocityVec = new THREE.Vector3();
    this.workVec = new THREE.Vector3();
    this.dodgeDir = new THREE.Vector3();
    this.flipAxis = new THREE.Vector3();
    this.surfaceForce = new THREE.Vector3();
    this.groundAvg = new THREE.Vector3();
    this.sampleWorld = new THREE.Vector3();
    this.wheelSamples = [
      new THREE.Vector3(-CAR_HITBOX.x * 0.78, -CAR_HITBOX.y * 0.72, -CAR_HITBOX.z * 0.74),
      new THREE.Vector3(CAR_HITBOX.x * 0.78, -CAR_HITBOX.y * 0.72, -CAR_HITBOX.z * 0.74),
      new THREE.Vector3(-CAR_HITBOX.x * 0.78, -CAR_HITBOX.y * 0.72, CAR_HITBOX.z * 0.74),
      new THREE.Vector3(CAR_HITBOX.x * 0.78, -CAR_HITBOX.y * 0.72, CAR_HITBOX.z * 0.74)
    ];
    this.rayDir = { x: 0, y: -1, z: 0 };
    this.rayOrigin = { x: 0, y: 0, z: 0 };
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.surfaceRight = new THREE.Vector3();
    this.surfaceBack = new THREE.Vector3();
    this.surfaceMatrix = new THREE.Matrix4();
    this.surfaceTargetQ = new THREE.Quaternion();
    this.visualPreviousPosition = new THREE.Vector3();
    this.visualPreviousQuaternion = new THREE.Quaternion();
    this.visualPosition = new THREE.Vector3();
    this.visualQuaternion = new THREE.Quaternion();
    this.visualBodyQuaternion = new THREE.Quaternion();

    this.createPhysics();
    this.resetVisualInterpolation();
    this.createVisual();
    this.createNameTag();
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
      .setLinearDamping(CAR_TUNING.linearDamping)
      .setAngularDamping(CAR_TUNING.angularDamping)
      .setCcdEnabled(true)
      .setSoftCcdPrediction(0.6)
      .setCanSleep(false);

    this.body = this.world.createRigidBody(bodyDesc);
    this.setSpawnRotation();

    const colliderDesc = R.ColliderDesc.cuboid(CAR_HITBOX.x, CAR_HITBOX.y, CAR_HITBOX.z)
      .setDensity(CAR_TUNING.mass / (8 * CAR_HITBOX.x * CAR_HITBOX.y * CAR_HITBOX.z))
      .setFriction(0.04)
      .setRestitution(0)
      .setContactSkin(0);

    this.collider = this.world.createCollider(colliderDesc, this.body);
    this.body.setAdditionalSolverIterations(6);
  }

  createVisual() {
    if (this.lowDetail) {
      this.createLowDetailVisual();
      return;
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.proceduralRoot = new THREE.Group();
    this.proceduralRoot.name = 'ProceduralCarVisual';
    this.proceduralRoot.scale.setScalar(CAR_VISUAL_SCALE);
    this.group.add(this.proceduralRoot);

    const paint = this.ultraHigh
      ? new THREE.MeshPhysicalMaterial({
          color: this.paintColor,
          roughness: 0.46,
          metalness: 0.30,
          clearcoat: 0.34,
          clearcoatRoughness: 0.42,
          envMapIntensity: 0.58
        })
      : new THREE.MeshStandardMaterial({
          color: this.paintColor,
          roughness: 0.34,
          metalness: 0.34
        });
    const dark = this.ultraHigh
      ? new THREE.MeshPhysicalMaterial({ color: 0x111a22, roughness: 0.48, metalness: 0.58, clearcoat: 0.14, clearcoatRoughness: 0.5, envMapIntensity: 0.5 })
      : new THREE.MeshStandardMaterial({ color: 0x111a22, roughness: 0.3, metalness: 0.55 });
    const glass = this.ultraHigh
      ? new THREE.MeshPhysicalMaterial({
          color: 0x17364d,
          roughness: 0.26,
          metalness: 0.02,
          transmission: 0.08,
          thickness: 0.10,
          ior: 1.42,
          clearcoat: 0.18,
          clearcoatRoughness: 0.45,
          transparent: true,
          opacity: 0.86,
          envMapIntensity: 0.52
        })
      : new THREE.MeshStandardMaterial({
          color: 0x182f43,
          roughness: 0.24,
          metalness: 0.18,
          transparent: true,
          opacity: 0.9
        });
    const lightMat = new THREE.MeshStandardMaterial({ color: this.ultraHigh ? 0xe8fbff : 0xd7fbff, emissive: this.ultraHigh ? 0x64dcff : 0x5bd5ff, emissiveIntensity: this.ultraHigh ? 3.7 : 3.0, toneMapped: !this.ultraHigh });

    const lower = new THREE.Mesh(new RoundedBoxGeometry(1.66, 0.62, 2.95, 5, 0.13), paint);
    lower.position.y = 0.02;
    this.proceduralRoot.add(lower);

    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.54, 0.28, 1.02, 4, 0.08), paint);
    hood.position.set(0, 0.38, -0.87);
    hood.rotation.x = -0.05;
    this.proceduralRoot.add(hood);

    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.48, 0.58, 1.18, 5, 0.12), glass);
    cabin.position.set(0, 0.66, 0.19);
    this.proceduralRoot.add(cabin);

    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.12, 0.9, 3, 0.06), dark);
    roof.position.set(0, 0.98, 0.25);
    this.proceduralRoot.add(roof);

    const frontBumper = new THREE.Mesh(new RoundedBoxGeometry(1.72, 0.22, 0.25, 3, 0.06), dark);
    frontBumper.position.set(0, -0.12, -1.5);
    this.proceduralRoot.add(frontBumper);

    const rearBumper = frontBumper.clone();
    rearBumper.position.z = 1.5;
    this.proceduralRoot.add(rearBumper);

    const spoilerBar = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.11, 0.23, 3, 0.05), dark);
    spoilerBar.position.set(0, 0.62, 1.45);
    this.proceduralRoot.add(spoilerBar);
    const spoilerStruts = [];
    for (const x of [-0.55, 0.55]) {
      const strut = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.38, 0.09, 2, 0.03), dark);
      strut.position.set(x, 0.45, 1.39);
      this.proceduralRoot.add(strut);
      spoilerStruts.push(strut);
    }

    const lamps = [];
    for (const x of [-0.55, 0.55]) {
      const lamp = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.14, 0.06, 2, 0.03), lightMat);
      lamp.position.set(x, 0.13, -1.505);
      this.proceduralRoot.add(lamp);
      lamps.push(lamp);
    }

    this.wheels = [];
    this.frontWheelPivots = [];
    this.wheelPivots = [];
    const wheelPositions = [
      [-0.86, -0.2, -0.92, true],
      [0.86, -0.2, -0.92, true],
      [-0.86, -0.2, 0.96, false],
      [0.86, -0.2, 0.96, false]
    ];

    for (const [x, y, z, isFront] of wheelPositions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      this.proceduralRoot.add(pivot);
      this.wheelPivots.push(pivot);

      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.28, this.ultraHigh ? 28 : 18),
        this.ultraHigh
          ? new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.92, metalness: 0.02 })
          : new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.86, metalness: 0.06 })
      );
      tire.rotation.z = Math.PI / 2;
      pivot.add(tire);

      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.19, 0.3, this.ultraHigh ? 20 : 12),
        this.ultraHigh
          ? new THREE.MeshPhysicalMaterial({ color: 0xaeb9c1, roughness: 0.38, metalness: 0.78, clearcoat: 0.08, clearcoatRoughness: 0.56, envMapIntensity: 0.55 })
          : new THREE.MeshStandardMaterial({ color: 0xb8c5cf, roughness: 0.25, metalness: 0.82 })
      );
      rim.rotation.z = Math.PI / 2;
      pivot.add(rim);

      let rimDetail = null;
      if (this.ultraHigh) {
        const discMat = new THREE.MeshStandardMaterial({ color: 0x626b70, roughness: 0.5, metalness: 0.72 });
        const spokeMat = new THREE.MeshStandardMaterial({ color: 0xc1c8cc, roughness: 0.32, metalness: 0.8 });
        const caliperMat = new THREE.MeshStandardMaterial({ color: 0x9c3024, roughness: 0.5, metalness: 0.28 });
        rimDetail = new THREE.Group();
        pivot.add(rimDetail);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.305, 28), discMat);
        disc.rotation.z = Math.PI / 2;
        rimDetail.add(disc);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.325, 18), spokeMat);
        hub.rotation.z = Math.PI / 2;
        rimDetail.add(hub);
        const spokeGeo = new THREE.BoxGeometry(0.32, 0.038, 0.045);
        for (let spoke = 0; spoke < 8; spoke++) {
          const angle = spoke * Math.PI / 4;
          const arm = new THREE.Mesh(spokeGeo, spokeMat);
          arm.position.set(0, Math.cos(angle) * 0.105, Math.sin(angle) * 0.105);
          arm.rotation.set(angle, 0, Math.PI / 2);
          rimDetail.add(arm);
        }
        const caliper = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.11, 0.055, 2, 0.018), caliperMat);
        caliper.position.set(0, 0.12, 0.02);
        pivot.add(caliper);
      }

      this.wheels.push(tire, rim);
      if (rimDetail) this.wheels.push(rimDetail);
      if (isFront) this.frontWheelPivots.push(pivot);
    }

    // Ultra High adds one short-range light per car, enabled only while boosting.
    this.boostLight = this.ultraHigh ? new THREE.PointLight(this.boostStyle.primary, 0, 6.5, 2.0) : null;
    if (this.boostLight) {
      this.boostLight.position.set(0, 0.02, 1.78);
      this.group.add(this.boostLight);
    }

    this.exhaustMaterial = new THREE.MeshStandardMaterial({ color: this.boostStyle.secondary, emissive: this.boostStyle.primary, emissiveIntensity: this.ultraHigh ? 5.0 : 4.0, toneMapped: !this.ultraHigh });
    this.exhaust = [];
    for (const x of [-0.34, 0.34]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.72, 10), this.exhaustMaterial);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(x, -0.03, 1.82);
      flame.visible = false;
      this.group.add(flame);
      this.exhaust.push(flame);
    }

    if (this.ultraHigh) {
      this.boostTrail = new BoostTrail(this.scene, this, { style: this.boostStyle.id, mobile: this.mobile });
    }

    this.visualParts = {
      lower, hood, cabin, roof, frontBumper, rearBumper, spoilerBar, spoilerStruts, lamps,
      lowDetail: false
    };
    this.applyCarStyleVisual();
    this.applyBoostStyleVisual();
    this.updatePremiumVisualState();
    this.ensurePremiumCarVisual();

    if (this.ultraHigh) {
      this.shadow = null;
      return;
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
    this.proceduralRoot = new THREE.Group();
    this.proceduralRoot.name = 'ProceduralCarVisual';
    this.proceduralRoot.scale.setScalar(CAR_VISUAL_SCALE);
    this.group.add(this.proceduralRoot);

    // Software WebGL cares about draw calls more than cosmetic polygon detail.
    // Two opaque, unlit boxes are enough to preserve car/team/style readability
    // while avoiding wheels, bumpers, transparency, lights and animated parts.
    const paint = new THREE.MeshBasicMaterial({ color: this.paintColor });
    const cabinMaterial = new THREE.MeshBasicMaterial({ color: 0x17324a });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.62, 2.95), paint);
    body.position.y = 0.02;
    this.proceduralRoot.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.50, 1.06), cabinMaterial);
    cabin.position.set(0, 0.58, 0.22);
    this.proceduralRoot.add(cabin);

    this.wheels = [];
    this.frontWheelPivots = [];
    this.wheelPivots = [];
    this.exhaust = [];
    this.boostLight = null;
    this.exhaustMaterial = null;
    this.boostTrail = null;
    this.shadow = null;
    this.visualParts = {
      body,
      cabin,
      frontBumper: null,
      rearBumper: null,
      wheelMesh: null,
      lowDetail: true
    };
    this.applyCarStyleVisual();

    // Low-detail parts never animate independently. Freeze local matrices; only
    // the root transform is changed when a network snapshot is rendered.
    this.group.traverse((object) => {
      if (object === this.group) return;
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
  }

  applyCarStyleVisual() {
    const style = this.carStyle || getCarStyle();
    const parts = this.visualParts;
    if (!parts) return;

    if (parts.lowDetail) {
      parts.body.scale.set(...style.bodyScale);
      parts.body.position.y = style.bodyY;
      parts.cabin.scale.set(...style.cabinScale);
      parts.cabin.position.set(...style.cabinPosition);
      if (parts.frontBumper) {
        parts.frontBumper.scale.set(...style.bumperScale);
        parts.frontBumper.position.z = -style.bumperZ;
      }
      if (parts.rearBumper) {
        parts.rearBumper.scale.set(...style.bumperScale);
        parts.rearBumper.position.z = style.bumperZ;
      }

      if (parts.wheelMesh) {
        const dummy = new THREE.Object3D();
        const wheelPositions = [
          [-style.wheelX, -0.20, style.frontWheelZ],
          [ style.wheelX, -0.20, style.frontWheelZ],
          [-style.wheelX, -0.20, style.rearWheelZ],
          [ style.wheelX, -0.20, style.rearWheelZ]
        ];
        for (let index = 0; index < wheelPositions.length; index++) {
          const [x, y, z] = wheelPositions[index];
          dummy.position.set(x, y, z);
          dummy.rotation.set(0, 0, Math.PI / 2);
          dummy.scale.set(style.wheelRadiusScale, 1, style.wheelRadiusScale);
          dummy.updateMatrix();
          parts.wheelMesh.setMatrixAt(index, dummy.matrix);
        }
        parts.wheelMesh.instanceMatrix.needsUpdate = true;
      }

      for (const object of [parts.body, parts.cabin, parts.frontBumper, parts.rearBumper, parts.wheelMesh]) {
        object?.updateMatrix?.();
      }
      return;
    }

    parts.lower.scale.set(...style.bodyScale);
    parts.lower.position.y = style.bodyY;
    parts.hood.scale.set(...style.hoodScale);
    parts.hood.position.set(...style.hoodPosition);
    parts.cabin.scale.set(...style.cabinScale);
    parts.cabin.position.set(...style.cabinPosition);
    parts.roof.scale.set(...style.roofScale);
    parts.roof.position.set(...style.roofPosition);
    parts.frontBumper.scale.set(...style.bumperScale);
    parts.frontBumper.position.z = -style.bumperZ;
    parts.rearBumper.scale.set(...style.bumperScale);
    parts.rearBumper.position.z = style.bumperZ;
    parts.spoilerBar.scale.set(...style.spoilerScale);
    parts.spoilerBar.position.set(...style.spoilerPosition);
    parts.spoilerBar.visible = style.spoilerVisible;
    for (let index = 0; index < parts.spoilerStruts.length; index++) {
      const strut = parts.spoilerStruts[index];
      const side = index === 0 ? -1 : 1;
      strut.position.set(side * 0.55 * style.spoilerScale[0], style.spoilerPosition[1] - 0.17, style.spoilerPosition[2] - 0.06);
      strut.scale.set(1, style.spoilerScale[1], style.spoilerScale[2]);
      strut.visible = style.spoilerVisible;
    }
    for (let index = 0; index < parts.lamps.length; index++) {
      const lamp = parts.lamps[index];
      const side = index === 0 ? -1 : 1;
      lamp.position.set(side * 0.55 * style.bodyScale[0], 0.13 * style.bodyScale[1], -style.bumperZ - 0.005);
    }

    const wheelPositions = [
      [-style.wheelX, -0.2, style.frontWheelZ],
      [ style.wheelX, -0.2, style.frontWheelZ],
      [-style.wheelX, -0.2, style.rearWheelZ],
      [ style.wheelX, -0.2, style.rearWheelZ]
    ];
    for (let index = 0; index < this.wheelPivots.length; index++) {
      const pivot = this.wheelPivots[index];
      const [x, y, z] = wheelPositions[index];
      pivot.position.set(x, y, z);
      pivot.scale.set(style.wheelRadiusScale, style.wheelRadiusScale, style.wheelRadiusScale);
    }
    for (let index = 0; index < this.exhaust.length; index++) {
      const side = index === 0 ? -1 : 1;
      this.exhaust[index].position.set(
        side * style.exhaustX * CAR_VISUAL_SCALE,
        -0.03,
        style.exhaustZ * CAR_VISUAL_SCALE
      );
    }
  }


  wantsPremiumCarVisual() {
    return this.premiumVisualsEnabled && shouldUsePremiumCarModel(this.carStyle?.id, this.ultraHigh);
  }

  setPremiumVisualsEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.premiumVisualsEnabled === next) return;
    this.premiumVisualsEnabled = next;
    this.updatePremiumVisualState();
    if (this.premiumVisualsEnabled) this.ensurePremiumCarVisual();
  }

  getExhaustAnchor() {
    if (this.premiumVisual?.visible && this.premiumVisualModelId === this.carStyle?.premiumModel) {
      const premiumAnchor = getPremiumCarExhaustAnchor(this.premiumVisualModelId);
      if (premiumAnchor) return premiumAnchor;
    }
    const style = this.carStyle || getCarStyle();
    return { x: style.exhaustX * CAR_VISUAL_SCALE, z: style.exhaustZ * CAR_VISUAL_SCALE };
  }

  disposePremiumVisual() {
    if (!this.premiumVisual) return;
    this.group?.remove(this.premiumVisual);
    // Geometry/textures come from a shared lazy-loaded template. Only the
    // per-car cloned materials are owned by this instance.
    this.premiumVisual.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material?.dispose?.();
    });
    this.premiumVisual = null;
    this.premiumVisualModelId = null;
    this.premiumWheelGroups = [];
  }

  updatePremiumVisualState() {
    const desiredModelId = this.carStyle?.premiumModel || null;
    const usePremium = Boolean(
      this.premiumVisual &&
      this.wantsPremiumCarVisual() &&
      this.premiumVisualModelId === desiredModelId
    );
    if (this.premiumVisual) this.premiumVisual.visible = usePremium;
    if (this.proceduralRoot) this.proceduralRoot.visible = !usePremium;

    const anchor = this.getExhaustAnchor();
    for (let index = 0; index < this.exhaust.length; index++) {
      const side = index === 0 ? -1 : 1;
      this.exhaust[index].position.set(side * anchor.x, -0.03, anchor.z);
    }
    if (this.boostLight) this.boostLight.position.set(0, 0.02, anchor.z - 0.04);
  }

  ensurePremiumCarVisual() {
    const desiredModelId = this.carStyle?.premiumModel || null;
    if (!this.wantsPremiumCarVisual() || !desiredModelId) {
      this.updatePremiumVisualState();
      return;
    }

    if (this.premiumVisual && this.premiumVisualModelId !== desiredModelId) {
      this.disposePremiumVisual();
    }
    if (this.premiumVisual && this.premiumVisualModelId === desiredModelId) {
      this.updatePremiumVisualState();
      return;
    }
    if (this.premiumVisualLoad && this.premiumVisualLoadModelId === desiredModelId) return;

    // Real GLBs are requested only for cars that are actually visible in
    // ULTRA HIGH. NORMAL/ULTRA LOW keep the lightweight procedural fallback
    // and never download these multi-megabyte assets.
    const requestModelId = desiredModelId;
    this.premiumVisualLoadModelId = requestModelId;
    this.premiumVisualLoad = createPremiumCarVisual(requestModelId, this.paintColor)
      .then(({ root, wheelGroups, modelId }) => {
        // Style may have changed while the async GLB was loading.
        if (this.carStyle?.premiumModel !== modelId || !this.wantsPremiumCarVisual()) {
          root.traverse((object) => {
            if (!object.isMesh) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) material?.dispose?.();
          });
          return null;
        }
        this.disposePremiumVisual();
        this.premiumVisual = root;
        this.premiumVisualModelId = modelId;
        this.premiumWheelGroups = wheelGroups;
        root.visible = false;
        this.group.add(root);
        this.updatePremiumVisualState();
        return root;
      })
      .catch((error) => {
        console.warn(`${String(requestModelId).toUpperCase()} 3D model could not be loaded; using the lightweight fallback.`, error);
        return null;
      })
      .finally(() => {
        if (this.premiumVisualLoadModelId === requestModelId) {
          this.premiumVisualLoad = null;
          this.premiumVisualLoadModelId = null;
        }
      });
  }

  setCarStyle(value) {
    const normalized = normalizeCarStyle(value);
    if (this.carStyle?.id === normalized) return;
    this.carStyle = getCarStyle(normalized);
    this.applyCarStyleVisual();
    this.updatePremiumVisualState();
    this.ensurePremiumCarVisual();
  }

  getCarStyleId() {
    return this.carStyle?.id || 'vortex';
  }

  setBoostStyle(value) {
    const normalized = normalizeBoostStyle(value);
    if (this.boostStyle?.id === normalized) return;
    this.boostStyle = getBoostStyle(normalized);
    this.applyBoostStyleVisual();
  }

  getBoostStyleId() {
    return this.boostStyle?.id || 'solar';
  }

  applyBoostStyleVisual() {
    const style = this.boostStyle || getBoostStyle();
    if (this.exhaustMaterial) {
      this.exhaustMaterial.color.setHex(style.secondary);
      this.exhaustMaterial.emissive.setHex(style.primary);
      this.exhaustMaterial.needsUpdate = true;
    }
    if (this.boostLight) this.boostLight.color.setHex(style.primary);
    this.boostTrail?.setStyle(style.id);
  }

  createNameTag() {
    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 512;
    this.nameCanvas.height = 128;
    this.nameTexture = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTexture.colorSpace = THREE.SRGBColorSpace;
    this.nameTexture.minFilter = THREE.LinearFilter;
    this.nameTexture.generateMipmaps = false;
    const material = new THREE.SpriteMaterial({
      map: this.nameTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.nameTag = new THREE.Sprite(material);
    this.nameTag.position.set(0, 0.86, 0);
    this.nameTag.scale.set(2.15, 0.54, 1);
    this.nameTag.renderOrder = 30;
    this.group.add(this.nameTag);
    this.redrawNameTag();
  }

  setPlayerIdentity(name, team, localPlayer = false) {
    this.playerName = String(name || 'Spieler').trim().slice(0, 16) || 'Spieler';
    this.team = team === 'blue' ? 'blue' : 'orange';
    this.isLocalPlayer = Boolean(localPlayer);
    this.redrawNameTag();
  }

  redrawNameTag() {
    if (!this.nameCanvas || !this.nameTexture) return;
    const context = this.nameCanvas.getContext('2d');
    const teamColor = this.team === 'blue' ? '#238cff' : '#ff7a18';
    context.clearRect(0, 0, this.nameCanvas.width, this.nameCanvas.height);
    context.fillStyle = 'rgba(3, 10, 20, 0.82)';
    context.strokeStyle = teamColor;
    context.lineWidth = this.isLocalPlayer ? 8 : 5;
    context.beginPath();
    context.roundRect(12, 15, 488, 98, 24);
    context.fill();
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = `900 ${this.playerName.length > 12 ? 42 : 48}px Inter, Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(this.playerName, 256, 64, 445);
    this.nameTexture.needsUpdate = true;
    // The local player's own tag is never useful from their chase/replay POV
    // and can cover the ball or car roof. Keep only remote player tags visible.
    if (this.nameTag) this.nameTag.visible = !this.isLocalPlayer;
  }

  setSpawnRotation() {
    const half = this.spawnYaw * 0.5;
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
  }

  getTransformBasis() {
    const rot = this.body.rotation();
    this.tempQ.set(rot.x, rot.y, rot.z, rot.w);
    this.up.copy(VEC3_UP).applyQuaternion(this.tempQ).normalize();
    this.rayDir.x = -this.up.x;
    this.rayDir.y = -this.up.y;
    this.rayDir.z = -this.up.z;
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
      this.airTime += dt;
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
      const hit = this.world.castRayAndGetNormal(ray, CAR_HITBOX.y * 1.65, true, undefined, undefined, undefined, this.body);
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
      if (this.groundNormal.dot(this.groundAvg) > 0.05) {
        const normalAlpha = 1 - Math.exp(-CAR_TUNING.surfaceNormalResponse * dt);
        this.groundNormal.lerp(this.groundAvg, normalAlpha).normalize();
      } else {
        this.groundNormal.copy(this.groundAvg);
      }
      this.airTime = 0;
      if (this.jumpCount > 0) this.jumpCount = 0;
      this.jumpHoldTime = 0;
      this.jumpHoldActive = false;
      this.jumpStickyTime = 0;
      if (this.dodgeAngleRemaining > 1e-6 || this.dodgeStopPending) this.stopDodgeRotation();
      this.dodgeTime = 0;
      this.dodgeAngleRemaining = 0;
      this.dodgeStopPending = false;
      this.dodgePitchLock = 0;
      this.dodgeYawLock = 0;
    } else {
      this.airTime += dt;
    }
  }

  fixedUpdate(dt) {
    const resetPressed = this.input.consumePressed('KeyR');
    if ((resetPressed && this.allowReset) || this.body.translation().y < -8) {
      this.reset();
      return;
    }

    if (this.dodgeStopPending) this.stopDodgeRotation();
    this.getTransformBasis();
    this.groundContactLockout = Math.max(0, this.groundContactLockout - dt);
    this.sampleGround(dt);

    if (this.grounded) {
      this.projectForwardToSurface();
      this.right.crossVectors(this.forward, this.groundNormal).normalize();
    }

    // Context-sensitive Rocket-League-style controls:
    // GROUND: W/S = throttle/reverse, A/D = steering.
    // AIR:    W/S = pitch, A/D = yaw, Q/E = roll.
    const driveAxes = this.input.getDriveAxes?.() ?? {
      throttle: (this.input.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.input.isDown('KeyS', 'ArrowDown') ? 1 : 0),
      steer: (this.input.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (this.input.isDown('KeyD', 'ArrowRight') ? 1 : 0)
    };
    const forwardInput = driveAxes.throttle;
    const sideInput = driveAxes.steer;
    const rollInput = (this.input.isDown('KeyQ') ? 1 : 0) - (this.input.isDown('KeyE') ? 1 : 0);
    const wantsBoost = this.input.isDown('ShiftLeft', 'ShiftRight');
    const drifting = this.input.isDown('ControlLeft', 'ControlRight');
    const boosting = wantsBoost && this.boost > 0.001;
    if (boosting) this.boost = Math.max(0, this.boost - CAR_TUNING.boostConsumptionPerSecond * dt);
    this.boosting = boosting;

    const vRaw = this.body.linvel();
    this.velocityVec.set(vRaw.x, vRaw.y, vRaw.z);
    const speedForward = this.velocityVec.dot(this.forward);
    const speedLateral = this.velocityVec.dot(this.right);
    const tangentSpeed = Math.hypot(speedForward, speedLateral);

    let driveGrounded = this.grounded;
    if (driveGrounded) {
      this.applyGroundDrive(dt, forwardInput, sideInput, boosting, drifting);
      this.airTime = 0;
    } else {
      const [airForward, airSide] = this.filterPostDodgeAirInput(forwardInput, sideInput);
      this.applyAirControl(dt, airForward, airSide, rollInput, boosting);
    }

    if (this.input.consumePressed('Space')) {
      if (this.tryRecoveryJump()) {
        driveGrounded = false;
      } else if (driveGrounded && this.jumpCount === 0) {
        const lin = this.body.linvel();
        this.body.setLinvel({
          x: lin.x + this.groundNormal.x * CAR_TUNING.jumpSpeed,
          y: lin.y + this.groundNormal.y * CAR_TUNING.jumpSpeed,
          z: lin.z + this.groundNormal.z * CAR_TUNING.jumpSpeed
        }, true);
        this.jumpCount = 1;
        this.jumpHoldTime = 0;
        this.jumpHoldActive = true;
        this.jumpStickyTime = CAR_TUNING.jumpStickyDuration;
        this.airTime = 0;
        this.grounded = false;
        this.groundContactLockout = 0.16;
        driveGrounded = false;
      } else if (!driveGrounded && this.jumpCount === 1
        && this.airTime <= CAR_TUNING.dodgeWindow + Math.min(CAR_TUNING.jumpHoldDuration, this.jumpHoldTime)) {
        this.applySecondJumpOrDodge(forwardInput, sideInput);
      }
    }

    // Variable first-jump height: extra lift exists only while the original
    // press is held continuously. Releasing Space permanently ends hold lift
    // for this jump, so a later second press is reserved for double-jump/dodge.
    if (this.jumpCount === 1 && this.jumpHoldActive) {
      const released = !this.input.isDown('Space');
      if (released && this.jumpHoldTime >= CAR_TUNING.jumpMinimumHoldDuration) {
        this.jumpHoldActive = false;
      } else if (this.jumpHoldTime < CAR_TUNING.jumpHoldDuration) {
        const holdDt = Math.min(dt, CAR_TUNING.jumpHoldDuration - this.jumpHoldTime);
        const lin = this.body.linvel();
        this.body.setLinvel({
          x: lin.x + this.up.x * CAR_TUNING.jumpHoldAcceleration * holdDt,
          y: lin.y + this.up.y * CAR_TUNING.jumpHoldAcceleration * holdDt,
          z: lin.z + this.up.z * CAR_TUNING.jumpHoldAcceleration * holdDt
        }, true);
        this.jumpHoldTime += holdDt;
        if (this.jumpHoldTime >= CAR_TUNING.jumpHoldDuration - 1e-6
          || (released && this.jumpHoldTime >= CAR_TUNING.jumpMinimumHoldDuration - 1e-6)) this.jumpHoldActive = false;
      }
    }

    if (this.jumpStickyTime > 0) {
      const stickyDt = Math.min(dt, this.jumpStickyTime);
      const lin = this.body.linvel();
      this.body.setLinvel({
        x: lin.x - this.up.x * CAR_TUNING.jumpStickyAcceleration * stickyDt,
        y: lin.y - this.up.y * CAR_TUNING.jumpStickyAcceleration * stickyDt,
        z: lin.z - this.up.z * CAR_TUNING.jumpStickyAcceleration * stickyDt
      }, true);
      this.jumpStickyTime = Math.max(0, this.jumpStickyTime - stickyDt);
    }

    if (driveGrounded) {
      this.applySurfaceForces(dt);
      this.alignToGround(dt);
    }

    // Rapier integrates after fixedUpdate. Program exactly the next slice of
    // the dodge now, then clear its angular component on the following frame.
    this.driveDodgeRotation(dt);
    this.updateVisualAnimation(dt, driveGrounded ? sideInput : 0, speedForward, boosting);
  }

  isNearRecoveryFloor() {
    if (!this.world || !this.RAPIER || this.clientOnly) return false;
    const position = this.body.translation();
    if (position.y > 1.55) return false;
    const ray = new this.RAPIER.Ray(
      { x: position.x, y: position.y + 0.08, z: position.z },
      { x: 0, y: -1, z: 0 }
    );
    const hit = this.world.castRayAndGetNormal(ray, 1.7, true, undefined, undefined, undefined, this.body);
    return Boolean(hit && Number(hit.normal?.y) > 0.55);
  }

  tryRecoveryJump() {
    const rotation = this.body.rotation();
    const velocity = this.body.linvel();
    if (!this.canUseRecoveryJump(rotation, velocity)) return false;

    const upright = getUprightRecoveryRotation(rotation, velocity);
    const angular = this.body.angvel();
    this.body.setRotation(upright, true);
    this.body.setLinvel({
      x: velocity.x * 0.82,
      y: Math.max(Number(velocity.y) || 0, CAR_TUNING.jumpSpeed * 0.92),
      z: velocity.z * 0.82
    }, true);
    this.body.setAngvel({
      x: 0,
      y: clamp(Number(angular.y) || 0, -1.2, 1.2),
      z: 0
    }, true);
    this.jumpCount = 1;
    this.jumpHoldTime = 0;
    this.jumpHoldActive = false;
    this.jumpStickyTime = 0;
    this.airTime = 0;
    this.grounded = false;
    this.groundContactLockout = 0.16;
    this.dodgeAngleRemaining = 0;
    this.dodgeStopPending = false;
    return true;
  }

  canUseRecoveryJump(rotation = this.body.rotation(), velocity = this.body.linvel()) {
    const recoveryCandidate = shouldUseCarRecoveryJump({
      rotation,
      grounded: this.grounded,
      nearFloor: true,
      airTime: this.airTime,
      verticalSpeed: velocity.y
    });
    return recoveryCandidate && this.isNearRecoveryFloor();
  }

  projectForwardToSurface() {
    this.forward.addScaledVector(this.groundNormal, -this.forward.dot(this.groundNormal));
    if (this.forward.lengthSq() > 0.0125) {
      this.forward.normalize();
      return;
    }

    const lin = this.body.linvel();
    this.forward.set(lin.x, lin.y, lin.z)
      .addScaledVector(this.groundNormal, -(lin.x * this.groundNormal.x + lin.y * this.groundNormal.y + lin.z * this.groundNormal.z));
    if (this.forward.lengthSq() > 0.25) {
      this.forward.normalize();
      return;
    }

    this.forward.copy(VEC3_UP).addScaledVector(this.groundNormal, -this.groundNormal.y);
    if (this.forward.lengthSq() < 0.0125) {
      this.forward.copy(VEC3_FORWARD).addScaledVector(this.groundNormal, -VEC3_FORWARD.dot(this.groundNormal));
    }
    this.forward.normalize();
  }

  applyGroundDrive(dt, throttle, steer, boosting, drifting = false) {
    const lin = this.body.linvel();
    this.velocityVec.set(lin.x, lin.y, lin.z);
    const speedForward = this.velocityVec.dot(this.forward);
    const speedLateral = this.velocityVec.dot(this.right);
    const effectiveThrottle = boosting ? 1 : clamp(throttle, -1, 1);
    let nextForward = speedForward;
    const opposing = Math.abs(effectiveThrottle) >= 0.01
      && Math.abs(speedForward) > 0.01
      && Math.sign(effectiveThrottle) !== Math.sign(speedForward);
    if (opposing) {
      nextForward = moveTowards(speedForward, 0, CAR_TUNING.brakeAcceleration * dt);
    } else if (Math.abs(effectiveThrottle) < 0.01) {
      nextForward = moveTowards(speedForward, 0, CAR_TUNING.coastDeceleration * dt);
    } else {
      const direction = Math.sign(effectiveThrottle);
      const directionalSpeed = nextForward * direction;
      if (directionalSpeed < CAR_TUNING.maxGroundSpeed) {
        const accelerationScale = direction > 0
          ? CAR_TUNING.driveAcceleration / 16
          : CAR_TUNING.reverseAcceleration / 16;
        let acceleration = throttleAccelerationAtSpeed(directionalSpeed) * accelerationScale;
        const steerBlend = drifting ? 0 : Math.abs(clamp(steer, -1, 1)) ** 2;
        if (steerBlend > 0) {
          const turnAcceleration = Math.max(0, (FULL_STEER_SPEED - directionalSpeed) / FULL_STEER_TIME_CONSTANT);
          acceleration = acceleration * (1 - steerBlend) + turnAcceleration * steerBlend;
        }
        nextForward += direction * acceleration * Math.abs(effectiveThrottle) * dt;
        if (nextForward * direction > CAR_TUNING.maxGroundSpeed) nextForward = direction * CAR_TUNING.maxGroundSpeed;
      }
    }

    if (boosting) nextForward = Math.min(CAR_TUNING.maxBoostSpeed, nextForward + CAR_TUNING.boostAcceleration * dt);

    const steerAmount = Math.abs(clamp(steer, -1, 1));
    if (!drifting && steerAmount > 0.001) {
      const steerLimit = CAR_TUNING.maxGroundSpeed
        - (CAR_TUNING.maxGroundSpeed - FULL_STEER_SPEED) * steerAmount * steerAmount;
      if (Math.abs(speedForward) <= steerLimit + 0.02 && Math.abs(nextForward) > steerLimit) {
        nextForward = Math.sign(nextForward || 1) * steerLimit;
      } else if (Math.abs(speedForward) > FULL_STEER_SPEED) {
        nextForward = moveTowards(nextForward, Math.sign(nextForward || 1) * FULL_STEER_SPEED,
          fullSteerDecelerationAtSpeed(speedForward) * steerAmount * steerAmount * dt);
      }
    }

    const activeGrip = drifting ? CAR_TUNING.driftGrip : CAR_TUNING.grip;
    const nextLateral = speedLateral * Math.exp(-activeGrip * dt);
    const normalSpeed = Math.min(0, this.velocityVec.dot(this.groundNormal));
    this.workVec.copy(this.forward).multiplyScalar(nextForward)
      .addScaledVector(this.right, nextLateral)
      .addScaledVector(this.groundNormal, normalSpeed);
    this.body.setLinvel({ x: this.workVec.x, y: this.workVec.y, z: this.workVec.z }, true);

    const steerResponse = drifting ? CAR_TUNING.driftSteerResponse : CAR_TUNING.steerResponse;
    const targetYaw = drifting
      ? steer * CAR_TUNING.driftSteerRate * Math.sign(nextForward || 1)
      : turningAngularSpeed(nextForward, steer) * CAR_TUNING.steerRate / 2.75;
    const ang = this.body.angvel();
    const spin = ang.x * this.groundNormal.x + ang.y * this.groundNormal.y + ang.z * this.groundNormal.z;
    const tangentDamping = Math.exp(-CAR_TUNING.angularGroundDamping * dt);
    const yaw = damp(spin, targetYaw, steerResponse, dt);
    this.body.setAngvel({
      x: (ang.x - this.groundNormal.x * spin) * tangentDamping + this.groundNormal.x * yaw,
      y: (ang.y - this.groundNormal.y * spin) * tangentDamping + this.groundNormal.y * yaw,
      z: (ang.z - this.groundNormal.z * spin) * tangentDamping + this.groundNormal.z * yaw
    }, true);
  }

  alignToGround(dt) {
    const rotation = this.body.rotation();
    this.tempQ.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
    this.forward.copy(VEC3_FORWARD).applyQuaternion(this.tempQ);
    this.projectForwardToSurface();
    this.surfaceRight.crossVectors(this.forward, this.groundNormal).normalize();
    this.surfaceBack.copy(this.forward).multiplyScalar(-1);
    this.surfaceMatrix.makeBasis(this.surfaceRight, this.groundNormal, this.surfaceBack);
    this.surfaceTargetQ.setFromRotationMatrix(this.surfaceMatrix).normalize();
    this.tempQ.slerp(this.surfaceTargetQ, 1 - Math.exp(-CAR_TUNING.surfaceAlignResponse * dt));
    this.body.setRotation({ x: this.tempQ.x, y: this.tempQ.y, z: this.tempQ.z, w: this.tempQ.w }, true);
  }

  applyAirControl(dt, forwardInput, sideInput, rollInput, boosting) {
    const dodging = this.dodgeAngleRemaining > 1e-6;
    const maxAirAngular = dodging
      ? Math.max(CAR_TUNING.maxAirAngular, CAR_TUNING.dodgeAngularSpeed)
      : CAR_TUNING.maxAirAngular;

    if (!dodging) {
      const ang = this.body.angvel();
      this.workVec.set(ang.x, ang.y, ang.z);
      const pitchRate = moveTowards(this.workVec.dot(this.right), -forwardInput * CAR_TUNING.airPitchRate,
        CAR_TUNING.airPitchAcceleration * (Math.abs(forwardInput) || 1) * dt);
      const yawRate = moveTowards(this.workVec.dot(this.up), sideInput * CAR_TUNING.airYawRate,
        CAR_TUNING.airYawAcceleration * (Math.abs(sideInput) || 1) * dt);
      const rollRate = moveTowards(this.workVec.dot(this.forward), rollInput * CAR_TUNING.airRollRate,
        CAR_TUNING.airRollAcceleration * (Math.abs(rollInput) || 1) * dt);
      this.workVec.copy(this.right).multiplyScalar(pitchRate)
        .addScaledVector(this.up, yawRate)
        .addScaledVector(this.forward, rollRate);
      let nextX = this.workVec.x;
      let nextY = this.workVec.y;
      let nextZ = this.workVec.z;
      const mag = Math.hypot(nextX, nextY, nextZ);
      if (mag > maxAirAngular) {
        const scale = maxAirAngular / mag;
        nextX *= scale; nextY *= scale; nextZ *= scale;
      }
      this.body.setAngvel({ x: nextX, y: nextY, z: nextZ }, true);
    }

    const lin = this.body.linvel();
    const airThrottle = forwardInput >= 0
      ? CAR_TUNING.airThrottleAcceleration * forwardInput
      : CAR_TUNING.airReverseAcceleration * forwardInput;
    this.velocityVec.set(lin.x, lin.y, lin.z).addScaledVector(this.forward, airThrottle * dt);
    if (boosting) this.velocityVec.addScaledVector(this.forward, CAR_TUNING.airBoostAcceleration * dt);
    const speed = this.velocityVec.length();
    if (speed > CAR_TUNING.maxBoostSpeed) this.velocityVec.multiplyScalar(CAR_TUNING.maxBoostSpeed / speed);
    this.body.setLinvel({ x: this.velocityVec.x, y: this.velocityVec.y, z: this.velocityVec.z }, true);
  }

  applySecondJumpOrDodge(forwardInput, sideInput) {
    const directionMagnitude = Math.hypot(forwardInput, sideInput);
    const lin = this.body.linvel();
    this.velocityVec.set(lin.x, lin.y, lin.z);

    if (directionMagnitude < 0.25) {
      this.velocityVec.addScaledVector(this.up, CAR_TUNING.doubleJumpSpeed);
      this.body.setLinvel({ x: this.velocityVec.x, y: this.velocityVec.y, z: this.velocityVec.z }, true);
      this.jumpCount = 2;
      this.jumpHoldActive = false;
      return;
    }

    const forwardAmount = forwardInput / directionMagnitude;
    const sideAmount = sideInput / directionMagnitude;

    // Give the car a real dodge impulse in the requested local direction. A/D
    // is pure lateral movement and must not add a second upward kick. Forward/
    // back dodges retain the small configured lift; diagonals blend it smoothly.
    this.dodgeDir.copy(this.forward).multiplyScalar(forwardAmount)
      .addScaledVector(this.right, -sideAmount)
      .normalize();
    const dodgeLiftScale = getDirectionalDodgeLiftScale(forwardAmount);
    this.velocityVec.addScaledVector(this.dodgeDir, CAR_TUNING.dodgeImpulse)
      .addScaledVector(this.up, CAR_TUNING.dodgeLift * dodgeLiftScale);
    this.body.setLinvel({ x: this.velocityVec.x, y: this.velocityVec.y, z: this.velocityVec.z }, true);

    // Own one finite revolution. W = front flip, S = back flip, A = left
    // barrel roll, D = right barrel roll. The axis remains fixed for the whole
    // dodge, so held steering cannot turn it into an endless corkscrew.
    this.flipAxis.copy(this.right).multiplyScalar(-forwardAmount)
      .addScaledVector(this.forward, -sideAmount)
      .normalize();
    this.dodgeAngleRemaining = CAR_TUNING.dodgeRotation;
    this.dodgeTime = CAR_TUNING.dodgeDuration;
    this.dodgeStopPending = false;
    this.dodgePitchLock = Math.abs(forwardAmount) >= 0.25 ? Math.sign(forwardAmount) : 0;
    this.dodgeYawLock = Math.abs(sideAmount) >= 0.25 ? Math.sign(sideAmount) : 0;
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.jumpCount = 2;
    this.jumpHoldActive = false;
  }

  filterPostDodgeAirInput(forwardInput, sideInput) {
    let pitch = forwardInput;
    let yaw = sideInput;
    if (this.dodgePitchLock !== 0) {
      if (Math.abs(pitch) < 0.25 || pitch * this.dodgePitchLock <= 0) this.dodgePitchLock = 0;
      else pitch = 0;
    }
    if (this.dodgeYawLock !== 0) {
      if (Math.abs(yaw) < 0.25 || yaw * this.dodgeYawLock <= 0) this.dodgeYawLock = 0;
      else yaw = 0;
    }
    return [pitch, yaw];
  }

  driveDodgeRotation(dt) {
    if (this.dodgeAngleRemaining <= 1e-6 || dt <= 0 || CAR_TUNING.dodgeAngularSpeed <= 0) return;

    const stepAngle = Math.min(this.dodgeAngleRemaining, CAR_TUNING.dodgeAngularSpeed * dt);
    const requestedSpeed = stepAngle / dt;
    const ang = this.body.angvel();
    const axisSpeed = ang.x * this.flipAxis.x + ang.y * this.flipAxis.y + ang.z * this.flipAxis.z;
    this.body.setAngvel({
      x: ang.x + this.flipAxis.x * (requestedSpeed - axisSpeed),
      y: ang.y + this.flipAxis.y * (requestedSpeed - axisSpeed),
      z: ang.z + this.flipAxis.z * (requestedSpeed - axisSpeed)
    }, true);

    this.dodgeAngleRemaining = Math.max(0, this.dodgeAngleRemaining - stepAngle);
    this.dodgeTime = this.dodgeAngleRemaining / CAR_TUNING.dodgeAngularSpeed;
    if (this.dodgeAngleRemaining <= 1e-6) this.dodgeStopPending = true;
  }

  stopDodgeRotation() {
    const ang = this.body.angvel();
    if (this.flipAxis.lengthSq() > 1e-8) {
      const axisSpeed = ang.x * this.flipAxis.x + ang.y * this.flipAxis.y + ang.z * this.flipAxis.z;
      this.body.setAngvel({
        x: ang.x - this.flipAxis.x * axisSpeed,
        y: ang.y - this.flipAxis.y * axisSpeed,
        z: ang.z - this.flipAxis.z * axisSpeed
      }, true);
    }
    this.dodgeAngleRemaining = 0;
    this.dodgeTime = 0;
    this.dodgeStopPending = false;
    this.flipAxis.set(0, 0, 0);
  }

  applySurfaceForces(dt) {
    const steepness = clamp(1 - Math.max(0, this.groundNormal.y), 0, 1);
    const gravityDotNormal = -CAR_TUNING.gravity * this.groundNormal.y;
    this.surfaceForce.set(0, -CAR_TUNING.gravity, 0)
      .addScaledVector(this.groundNormal, -gravityDotNormal)
      .multiplyScalar(-CAR_TUNING.wallGravityCancel * steepness)
      .addScaledVector(this.groundNormal, -CAR_TUNING.downAcceleration);

    // Rapier already applies world gravity, so this impulse only adds the
    // wall-gravity cancellation and suspension adhesion acceleration.
    const mass = Math.max(1, Number(this.body.mass?.()) || 420);
    this.body.applyImpulse({
      x: this.surfaceForce.x * mass * dt,
      y: this.surfaceForce.y * mass * dt,
      z: this.surfaceForce.z * mass * dt
    }, true);
  }

  updateVisualAnimation(dt, steer, speedForward, boosting) {
    const visualSteer = steer * 0.34;
    for (const pivot of this.frontWheelPivots) {
      pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, visualSteer, 1 - Math.exp(-12 * dt));
    }

    this.wheelSpin += speedForward * dt / 0.36;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
    if (this.premiumVisual?.visible) {
      for (const wheel of this.premiumWheelGroups) {
        const base = wheel.userData.baseQuaternion;
        if (!base) continue;
        const axisName = wheel.userData.spinAxis || 'y';
        this.premiumSpinAxis.set(axisName === 'x' ? 1 : 0, axisName === 'y' ? 1 : 0, axisName === 'z' ? 1 : 0);
        this.premiumSpinQuaternion.setFromAxisAngle(this.premiumSpinAxis, this.wheelSpin);
        wheel.quaternion.copy(base).multiply(this.premiumSpinQuaternion);
      }
    }

    this.boosting = boosting;
  }

  updateBoostEffects(dt) {
    if (this.lowDetail) return;
    this.boostVisualHold = Math.max(0, this.boostVisualHold - dt);
    const active = Boolean(this.boosting || this.boostVisualHold > 0) && this.getBoost() > 0.001;
    const style = this.boostStyle || getBoostStyle();
    if (this.boostLight) this.boostLight.intensity = active ? 13 : 0;
    for (let i = 0; i < this.exhaust.length; i++) {
      const flame = this.exhaust[i];
      flame.visible = active;
      if (active) {
        const flicker = 0.86 + Math.sin(performance.now() * 0.04 + i * 2) * 0.12;
        flame.scale.set(1, style.flameLength * flicker, 1);
      }
    }
    if (this.boostTrail) {
      const anchor = this.getExhaustAnchor();
      this.boostTrail.update(dt, active, anchor.x, anchor.z);
    }
  }

  captureVisualTransform() {
    const position = this.body.translation();
    const rotation = this.body.rotation();
    this.visualPreviousPosition.set(position.x, position.y, position.z);
    this.visualPreviousQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
  }

  resetVisualInterpolation() {
    this.captureVisualTransform();
    this.visualPosition.copy(this.visualPreviousPosition);
    this.visualQuaternion.copy(this.visualPreviousQuaternion);
  }

  syncVisual(interpolationAlpha = 1) {
    const p = this.body.translation();
    const r = this.body.rotation();
    const alpha = clamp(Number(interpolationAlpha) || 0, 0, 1);
    this.visualPosition.copy(this.visualPreviousPosition).lerp({ x: p.x, y: p.y, z: p.z }, alpha);
    this.visualBodyQuaternion.set(r.x, r.y, r.z, r.w).normalize();
    this.visualQuaternion.copy(this.visualPreviousQuaternion).slerp(this.visualBodyQuaternion, alpha).normalize();
    this.group.position.copy(this.visualPosition);
    this.group.quaternion.copy(this.visualQuaternion);

    if (this.shadow) {
      this.shadow.position.x = this.visualPosition.x;
      this.shadow.position.z = this.visualPosition.z;
      const height = Math.max(0, this.visualPosition.y - CAR_HITBOX.y);
      const shadowScale = THREE.MathUtils.clamp(1.0 - height * 0.035, 0.58, 1.0);
      this.shadow.scale.set(0.72 * CAR_VISUAL_SCALE * shadowScale, CAR_VISUAL_SCALE * shadowScale, 1);
      this.shadow.material.opacity = THREE.MathUtils.clamp(0.24 - height * 0.01, 0.05, 0.24);
    }
  }

  getSpeedKmh() {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z) * 3.6;
  }

  getBoost() {
    return THREE.MathUtils.clamp(Number(this.boost) || 0, 0, CAR_TUNING.boostCapacity);
  }

  setBoost(value) {
    const next = THREE.MathUtils.clamp(Number(value) || 0, 0, CAR_TUNING.boostCapacity);
    if (next < this.boost - 0.18) this.boostVisualHold = Math.max(this.boostVisualHold, 0.18);
    this.boost = next;
    this.lastVisualBoost = next;
  }

  collectBoostPad(amount, full = false) {
    const before = this.getBoost();
    const next = full
      ? CAR_TUNING.boostCapacity
      : Math.min(CAR_TUNING.boostCapacity, before + Math.max(0, Number(amount) || 0));
    this.boost = next;
    return next > before + 0.001;
  }

  enforceSpeedLimit() {
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed <= CAR_TUNING.maxBoostSpeed || speed < 0.000001) return;
    const scale = CAR_TUNING.maxBoostSpeed / speed;
    this.body.setLinvel({ x: v.x * scale, y: v.y * scale, z: v.z * scale }, true);
  }

  reset() {
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
    this.setSpawnRotation();
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.jumpCount = 0;
    this.jumpHoldTime = 0;
    this.jumpHoldActive = false;
    this.jumpStickyTime = 0;
    this.airTime = 0;
    this.groundContactLockout = 0;
    this.dodgeTime = 0;
    this.dodgeAngleRemaining = 0;
    this.dodgeStopPending = false;
    this.dodgePitchLock = 0;
    this.dodgeYawLock = 0;
    this.flipAxis.set(0, 0, 0);
    this.grounded = false;
    this.boost = CAR_TUNING.boostCapacity;
    this.boosting = false;
    this.boostVisualHold = 0;
    this.resetVisualInterpolation();
  }
}
