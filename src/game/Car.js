import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TransformBody } from '../network/TransformBody.js';
import { CAR_TUNING } from '../shared/game-tuning.js';
import { getCarStyle, normalizeCarStyle } from '../shared/car-styles.js';

const VEC3_UP = new THREE.Vector3(0, 1, 0);
const VEC3_FORWARD = new THREE.Vector3(0, 0, -1);
const VEC3_RIGHT = new THREE.Vector3(1, 0, 0);

const clamp = THREE.MathUtils.clamp;
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
const moveTowards = (current, target, maxDelta) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

export class Car {
  constructor(scene, world, RAPIER, input, options = {}) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.input = input;
    this.lowDetail = Boolean(options.lowDetail);
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.clientOnly = Boolean(options.clientOnly);

    const spawn = options.spawn ?? { x: 0, y: 0.52, z: 34 };
    this.spawn = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.spawnYaw = options.spawnYaw ?? 0;
    this.paintColor = options.color ?? 0xf46b20;
    this.playerName = String(options.playerName || 'Spieler').slice(0, 16);
    this.team = options.team === 'blue' ? 'blue' : 'orange';
    this.isLocalPlayer = Boolean(options.localPlayer);
    this.carStyle = getCarStyle(options.carStyle);
    this.visualParts = null;
    this.wheelPivots = [];
    this.maxGroundSpeed = CAR_TUNING.maxGroundSpeed;
    this.maxBoostSpeed = CAR_TUNING.maxBoostSpeed;
    this.boost = CAR_TUNING.boostCapacity;
    this.boosting = false;
    this.grip = CAR_TUNING.grip;
    this.steerRate = CAR_TUNING.steerRate;
    this.steerResponse = CAR_TUNING.steerResponse;
    this.airPitchTorque = 2100;
    this.airYawTorque = 1700;
    this.airRollTorque = 2050;

    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.jumpCount = 0;
    this.airTime = 0;
    this.groundContactLockout = 0;
    this.dodgeTime = 0;
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
      new THREE.Vector3(-0.67, -0.28, -0.92),
      new THREE.Vector3(0.67, -0.28, -0.92),
      new THREE.Vector3(-0.67, -0.28, 0.94),
      new THREE.Vector3(0.67, -0.28, 0.94)
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

    this.createPhysics();
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

    const colliderDesc = R.ColliderDesc.cuboid(0.83, 0.45, 1.48)
      .setDensity(145)
      .setFriction(0.04)
      .setRestitution(0)
      .setContactSkin(0.015);

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
    this.group.add(lower);

    const hood = new THREE.Mesh(new RoundedBoxGeometry(1.54, 0.28, 1.02, 4, 0.08), paint);
    hood.position.set(0, 0.38, -0.87);
    hood.rotation.x = -0.05;
    this.group.add(hood);

    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.48, 0.58, 1.18, 5, 0.12), glass);
    cabin.position.set(0, 0.66, 0.19);
    this.group.add(cabin);

    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.12, 0.9, 3, 0.06), dark);
    roof.position.set(0, 0.98, 0.25);
    this.group.add(roof);

    const frontBumper = new THREE.Mesh(new RoundedBoxGeometry(1.72, 0.22, 0.25, 3, 0.06), dark);
    frontBumper.position.set(0, -0.12, -1.5);
    this.group.add(frontBumper);

    const rearBumper = frontBumper.clone();
    rearBumper.position.z = 1.5;
    this.group.add(rearBumper);

    const spoilerBar = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.11, 0.23, 3, 0.05), dark);
    spoilerBar.position.set(0, 0.62, 1.45);
    this.group.add(spoilerBar);
    const spoilerStruts = [];
    for (const x of [-0.55, 0.55]) {
      const strut = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.38, 0.09, 2, 0.03), dark);
      strut.position.set(x, 0.45, 1.39);
      this.group.add(strut);
      spoilerStruts.push(strut);
    }

    const lamps = [];
    for (const x of [-0.55, 0.55]) {
      const lamp = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.14, 0.06, 2, 0.03), lightMat);
      lamp.position.set(x, 0.13, -1.505);
      this.group.add(lamp);
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
      this.group.add(pivot);
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
    this.boostLight = this.ultraHigh ? new THREE.PointLight(0xff7b25, 0, 6.5, 2.0) : null;
    if (this.boostLight) {
      this.boostLight.position.set(0, 0.02, 1.78);
      this.group.add(this.boostLight);
    }

    const exhaustMat = new THREE.MeshStandardMaterial({ color: this.ultraHigh ? 0xffb15f : 0xffa34d, emissive: 0xff4c00, emissiveIntensity: this.ultraHigh ? 5.0 : 4.0, toneMapped: !this.ultraHigh });
    this.exhaust = [];
    for (const x of [-0.34, 0.34]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.72, 10), exhaustMat);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(x, -0.03, 1.82);
      flame.visible = false;
      this.group.add(flame);
      this.exhaust.push(flame);
    }

    this.visualParts = {
      lower, hood, cabin, roof, frontBumper, rearBumper, spoilerBar, spoilerStruts, lamps,
      lowDetail: false
    };
    this.applyCarStyleVisual();

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

    const paint = new THREE.MeshBasicMaterial({ color: this.paintColor });
    const dark = new THREE.MeshBasicMaterial({ color: 0x071019 });
    const glass = new THREE.MeshBasicMaterial({ color: 0x18354d });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.62, 2.95), paint);
    body.position.y = 0.02;
    this.group.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.52, 1.12), glass);
    cabin.position.set(0, 0.60, 0.18);
    this.group.add(cabin);

    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.18, 0.22), dark);
    bumper.position.set(0, -0.12, -1.50);
    this.group.add(bumper);
    const rear = bumper.clone();
    rear.position.z = 1.50;
    this.group.add(rear);

    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 8);
    const wheels = new THREE.InstancedMesh(wheelGeo, dark, 4);
    const dummy = new THREE.Object3D();
    const positions = [
      [-0.86, -0.20, -0.92], [0.86, -0.20, -0.92],
      [-0.86, -0.20, 0.96], [0.86, -0.20, 0.96]
    ];
    for (let i = 0; i < positions.length; i++) {
      const [x, y, z] = positions[i];
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, Math.PI / 2);
      dummy.updateMatrix();
      wheels.setMatrixAt(i, dummy.matrix);
    }
    wheels.instanceMatrix.needsUpdate = true;
    this.group.add(wheels);

    this.wheels = [];
    this.frontWheelPivots = [];
    this.wheelPivots = [];
    this.exhaust = [];
    this.boostLight = null;
    this.shadow = null;
    this.visualParts = { body, cabin, frontBumper: bumper, rearBumper: rear, wheelMesh: wheels, lowDetail: true };
    this.applyCarStyleVisual();

    // Ultra car parts never animate independently. Freeze their local matrices;
    // only the root group moves each render frame.
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
      parts.frontBumper.scale.set(...style.bumperScale);
      parts.frontBumper.position.z = -style.bumperZ;
      parts.rearBumper.scale.set(...style.bumperScale);
      parts.rearBumper.position.z = style.bumperZ;

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
      for (const object of [parts.body, parts.cabin, parts.frontBumper, parts.rearBumper, parts.wheelMesh]) {
        object.updateMatrix();
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
      this.exhaust[index].position.set(side * style.exhaustX, -0.03, style.exhaustZ);
    }
  }

  setCarStyle(value) {
    const normalized = normalizeCarStyle(value);
    if (this.carStyle?.id === normalized) return;
    this.carStyle = getCarStyle(normalized);
    this.applyCarStyleVisual();
  }

  getCarStyleId() {
    return this.carStyle?.id || 'vortex';
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
    this.nameTag.position.set(0, 2.05, 0);
    this.nameTag.scale.set(4.8, 1.2, 1);
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
      const hit = this.world.castRayAndGetNormal(ray, 1.15, true, undefined, undefined, undefined, this.body);
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
      this.dodgeTime = 0;
    } else {
      this.airTime += dt;
    }
  }

  fixedUpdate(dt) {
    if (this.input.consumePressed('KeyR') || this.body.translation().y < -8) {
      this.reset();
      return;
    }

    this.getTransformBasis();
    this.groundContactLockout = Math.max(0, this.groundContactLockout - dt);
    this.dodgeTime = Math.max(0, this.dodgeTime - dt);
    this.sampleGround(dt);

    if (this.grounded) {
      this.projectForwardToSurface();
      this.right.crossVectors(this.forward, this.groundNormal).normalize();
    }

    // Context-sensitive Rocket-League-style controls:
    // GROUND: W/S = throttle/reverse, A/D = steering.
    // AIR:    W/S = pitch, A/D = yaw, Q/E = roll.
    const forwardInput = (this.input.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.input.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const sideInput = (this.input.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (this.input.isDown('KeyD', 'ArrowRight') ? 1 : 0);
    const rollInput = (this.input.isDown('KeyQ') ? 1 : 0) - (this.input.isDown('KeyE') ? 1 : 0);
    const wantsBoost = this.input.isDown('ShiftLeft', 'ShiftRight');
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
      this.applyGroundDrive(dt, forwardInput, sideInput, boosting);
      this.airTime = 0;
    } else {
      this.applyAirControl(dt, forwardInput, sideInput, rollInput, boosting);
    }

    if (this.input.consumePressed('Space')) {
      if (driveGrounded && this.jumpCount === 0) {
        const lin = this.body.linvel();
        const normalSpeed = lin.x * this.groundNormal.x + lin.y * this.groundNormal.y + lin.z * this.groundNormal.z;
        const deltaSpeed = Math.max(0, CAR_TUNING.jumpSpeed - normalSpeed);
        this.body.setLinvel({
          x: lin.x + this.groundNormal.x * deltaSpeed,
          y: lin.y + this.groundNormal.y * deltaSpeed,
          z: lin.z + this.groundNormal.z * deltaSpeed
        }, true);
        this.jumpCount = 1;
        this.airTime = 0;
        this.grounded = false;
        this.groundContactLockout = 0.16;
        driveGrounded = false;
      } else if (!driveGrounded && this.jumpCount === 1 && this.airTime <= CAR_TUNING.dodgeWindow) {
        this.applySecondJumpOrDodge(forwardInput, sideInput);
      }
    }

    if (this.input.isDown('Space') && this.jumpCount === 1 && this.airTime <= CAR_TUNING.jumpHoldDuration) {
      const lin = this.body.linvel();
      this.body.setLinvel({
        x: lin.x + this.up.x * CAR_TUNING.jumpHoldAcceleration * dt,
        y: lin.y + this.up.y * CAR_TUNING.jumpHoldAcceleration * dt,
        z: lin.z + this.up.z * CAR_TUNING.jumpHoldAcceleration * dt
      }, true);
    }

    if (driveGrounded) {
      this.applySurfaceForces(dt);
      this.alignToGround(dt);
    }

    this.updateVisualAnimation(dt, driveGrounded ? sideInput : 0, speedForward, boosting);
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

  applyGroundDrive(dt, throttle, steer, boosting) {
    const lin = this.body.linvel();
    this.velocityVec.set(lin.x, lin.y, lin.z);
    const speedForward = this.velocityVec.dot(this.forward);
    const speedLateral = this.velocityVec.dot(this.right);
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
    const normalSpeed = Math.min(0, this.velocityVec.dot(this.groundNormal));
    this.workVec.copy(this.forward).multiplyScalar(nextForward)
      .addScaledVector(this.right, nextLateral)
      .addScaledVector(this.groundNormal, normalSpeed);
    this.body.setLinvel({ x: this.workVec.x, y: this.workVec.y, z: this.workVec.z }, true);

    const steerStrength = clamp(Math.max(Math.abs(nextForward), 1.5) / 7, 0.18, 1)
      * clamp(1 - tangentSpeed / 70, 0.48, 1);
    const reverseSign = Math.sign(nextForward || throttle || 1);
    const targetYaw = steer * CAR_TUNING.steerRate * steerStrength * reverseSign;
    const ang = this.body.angvel();
    const spin = ang.x * this.groundNormal.x + ang.y * this.groundNormal.y + ang.z * this.groundNormal.z;
    const tangentDamping = Math.exp(-CAR_TUNING.angularGroundDamping * dt);
    const yaw = damp(spin, targetYaw, CAR_TUNING.steerResponse, dt);
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
    const controlScale = this.dodgeTime > 0 ? CAR_TUNING.dodgeControlScale : 1;
    const torque = this.workVec.set(0, 0, 0)
      .addScaledVector(this.right, -forwardInput * this.airPitchTorque * controlScale)
      .addScaledVector(this.up, sideInput * this.airYawTorque * controlScale)
      .addScaledVector(this.forward, rollInput * this.airRollTorque * controlScale);

    if (torque.lengthSq() > 0) {
      this.body.applyTorqueImpulse({
        x: torque.x * dt,
        y: torque.y * dt,
        z: torque.z * dt
      }, true);
    }

    const ang = this.body.angvel();
    const maxAirAngular = this.dodgeTime > 0
      ? Math.max(CAR_TUNING.maxAirAngular, CAR_TUNING.dodgeAngularSpeed)
      : CAR_TUNING.maxAirAngular;
    const mag = Math.hypot(ang.x, ang.y, ang.z);
    if (mag > maxAirAngular) {
      const scale = maxAirAngular / mag;
      this.body.setAngvel({ x: ang.x * scale, y: ang.y * scale, z: ang.z * scale }, true);
    }

    if (boosting) {
      const lin = this.body.linvel();
      this.velocityVec.set(lin.x, lin.y, lin.z).addScaledVector(this.forward, CAR_TUNING.boostAcceleration * dt);
      const speed = this.velocityVec.length();
      if (speed > CAR_TUNING.maxBoostSpeed) this.velocityVec.multiplyScalar(CAR_TUNING.maxBoostSpeed / speed);
      this.body.setLinvel({ x: this.velocityVec.x, y: this.velocityVec.y, z: this.velocityVec.z }, true);
    }
  }

  applySecondJumpOrDodge(forwardInput, sideInput) {
    const directionMagnitude = Math.hypot(forwardInput, sideInput);
    const lin = this.body.linvel();
    this.velocityVec.set(lin.x, lin.y, lin.z);

    if (directionMagnitude < 0.25) {
      this.velocityVec.addScaledVector(this.up, CAR_TUNING.doubleJumpSpeed);
      this.body.setLinvel({ x: this.velocityVec.x, y: this.velocityVec.y, z: this.velocityVec.z }, true);
      this.jumpCount = 2;
      return;
    }

    const forwardAmount = forwardInput / directionMagnitude;
    const sideAmount = sideInput / directionMagnitude;
    this.dodgeDir.copy(this.forward).multiplyScalar(forwardAmount)
      .addScaledVector(this.right, -sideAmount)
      .normalize();
    this.velocityVec.addScaledVector(this.dodgeDir, CAR_TUNING.dodgeImpulse)
      .addScaledVector(this.up, CAR_TUNING.dodgeLift);
    this.body.setLinvel({ x: this.velocityVec.x, y: this.velocityVec.y, z: this.velocityVec.z }, true);

    this.flipAxis.copy(this.right).multiplyScalar(-forwardAmount)
      .addScaledVector(this.forward, sideAmount)
      .normalize();
    const ang = this.body.angvel();
    const currentFlipSpeed = ang.x * this.flipAxis.x + ang.y * this.flipAxis.y + ang.z * this.flipAxis.z;
    const deltaFlip = CAR_TUNING.dodgeAngularSpeed - currentFlipSpeed;
    this.body.setAngvel({
      x: ang.x + this.flipAxis.x * deltaFlip,
      y: ang.y + this.flipAxis.y * deltaFlip,
      z: ang.z + this.flipAxis.z * deltaFlip
    }, true);
    this.dodgeTime = CAR_TUNING.dodgeDuration;
    this.jumpCount = 2;
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

    if (this.boostLight) this.boostLight.intensity = boosting ? 16 : 0;
    for (let i = 0; i < this.exhaust.length; i++) {
      const flame = this.exhaust[i];
      flame.visible = boosting;
      if (boosting) {
        const flicker = 0.86 + Math.sin(performance.now() * 0.04 + i * 2) * 0.12;
        flame.scale.set(1, flicker, 1);
      }
    }
  }

  syncVisual() {
    const p = this.body.translation();
    const r = this.body.rotation();
    this.group.position.set(p.x, p.y, p.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);

    if (this.shadow) {
      this.shadow.position.x = p.x;
      this.shadow.position.z = p.z;
      const height = Math.max(0, p.y - 0.45);
      const shadowScale = THREE.MathUtils.clamp(1.0 - height * 0.035, 0.58, 1.0);
      this.shadow.scale.set(0.72 * shadowScale, shadowScale, 1);
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
    this.boost = THREE.MathUtils.clamp(Number(value) || 0, 0, CAR_TUNING.boostCapacity);
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
    this.airTime = 0;
    this.groundContactLockout = 0;
    this.dodgeTime = 0;
    this.grounded = false;
    this.boost = CAR_TUNING.boostCapacity;
    this.boosting = false;
  }
}
