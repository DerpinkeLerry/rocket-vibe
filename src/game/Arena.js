import * as THREE from 'three';
import { ARENA_TUNING } from '../shared/arena-tuning.js';

const FIELD_W = ARENA_TUNING.width;
const FIELD_L = ARENA_TUNING.length;
const WALL_H = ARENA_TUNING.wallHeight;
const WALL_T = ARENA_TUNING.wallThickness;
const CORNER_R = ARENA_TUNING.cornerRadius;
const GOAL_W = ARENA_TUNING.goalWidth;
const GOAL_H = ARENA_TUNING.goalHeight;
const GOAL_D = ARENA_TUNING.goalDepth;
const CORNER_SEGMENTS = 8;

function roundedRectGeometry(width, length, radius, segments) {
  const halfWidth = width * 0.5;
  const halfLength = length * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + radius, -halfLength);
  shape.lineTo(halfWidth - radius, -halfLength);
  shape.absarc(halfWidth - radius, -halfLength + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(halfWidth, halfLength - radius);
  shape.absarc(halfWidth - radius, halfLength - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-halfWidth + radius, halfLength);
  shape.absarc(-halfWidth + radius, halfLength - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-halfWidth, -halfLength + radius);
  shape.absarc(-halfWidth + radius, -halfLength + radius, radius, Math.PI, Math.PI * 1.5, false);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class Arena {
  constructor(scene, world, RAPIER, options = {}) {
    this.scene = scene;
    this.world = world;
    this.RAPIER = RAPIER;
    this.lowDetail = Boolean(options.lowDetail);
    this.enablePhysics = options.createPhysics !== false;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.createField();
    if (this.enablePhysics) this.createPhysics();
    if (!this.lowDetail) {
      this.createStands();
      this.createLights();
    }

    // The whole arena is static. Avoid rebuilding local matrices every frame.
    this.group.traverse((object) => {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
    this.group.updateMatrixWorld(true);
  }

  createField() {
    const turfMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x1b7563 })
      : new THREE.MeshStandardMaterial({ color: 0x196958, roughness: 0.9, metalness: 0.0 });
    const turf = new THREE.Mesh(
      roundedRectGeometry(FIELD_W, FIELD_L, CORNER_R, this.lowDetail ? 4 : 10),
      turfMat
    );
    this.group.add(turf);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xd7fbff, transparent: true, opacity: 0.68 });
    const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W - 2, 0.14), lineMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.012;
    this.group.add(centerLine);

    const circle = new THREE.Mesh(new THREE.RingGeometry(10.5, 10.68, this.lowDetail ? 24 : 48), lineMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.014;
    this.group.add(circle);

    const centerDot = new THREE.Mesh(new THREE.CircleGeometry(0.38, this.lowDetail ? 8 : 16), lineMaterial);
    centerDot.rotation.x = -Math.PI / 2;
    centerDot.position.y = 0.016;
    this.group.add(centerDot);

    const glassMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({
          color: 0x67d8f7,
          transparent: true,
          opacity: 0.13,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      : new THREE.MeshStandardMaterial({
          color: 0x93e9ff,
          transparent: true,
          opacity: 0.17,
          roughness: 0.12,
          metalness: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide
        });
    const frameMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x31c9ef })
      : new THREE.MeshStandardMaterial({
          color: 0xa7edff,
          emissive: 0x12799b,
          emissiveIntensity: 1.2,
          roughness: 0.28,
          metalness: 0.64
        });

    this.createGlassEnclosure(glassMaterial, frameMaterial);

    const goalWallMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x12374b, transparent: true, opacity: 0.5 })
      : new THREE.MeshStandardMaterial({
          color: 0x15384b,
          transparent: true,
          opacity: 0.62,
          roughness: 0.4,
          metalness: 0.16,
          depthWrite: false
        });
    this.createGoal(1, goalWallMaterial);
    this.createGoal(-1, goalWallMaterial);
  }

  buildBoundarySegments() {
    const halfWidth = FIELD_W * 0.5;
    const halfLength = FIELD_L * 0.5;
    const straightX = halfWidth - CORNER_R;
    const straightZ = halfLength - CORNER_R;
    const goalHalfWidth = GOAL_W * 0.5;
    const panels = [
      { x: halfWidth + WALL_T * 0.5, z: 0, length: straightZ * 2, yaw: Math.PI / 2 },
      { x: -halfWidth - WALL_T * 0.5, z: 0, length: straightZ * 2, yaw: Math.PI / 2 }
    ];

    const endSegmentLength = straightX - goalHalfWidth;
    const endSegmentCenter = goalHalfWidth + endSegmentLength * 0.5;
    for (const signZ of [-1, 1]) {
      const z = signZ * (halfLength + WALL_T * 0.5);
      panels.push(
        { x: -endSegmentCenter, z, length: endSegmentLength, yaw: 0 },
        { x: endSegmentCenter, z, length: endSegmentLength, yaw: 0 },
        {
          x: 0,
          y: GOAL_H + (WALL_H - GOAL_H) * 0.5,
          z,
          length: GOAL_W,
          height: WALL_H - GOAL_H,
          yaw: 0
        }
      );
    }

    const corners = [
      { start: 0, sx: 1, sz: 1 },
      { start: Math.PI / 2, sx: -1, sz: 1 },
      { start: Math.PI, sx: -1, sz: -1 },
      { start: Math.PI * 1.5, sx: 1, sz: -1 }
    ];
    const delta = Math.PI * 0.5 / CORNER_SEGMENTS;
    const panelRadius = CORNER_R + WALL_T * 0.5;
    const cornerLength = 2 * panelRadius * Math.sin(delta * 0.5) * 1.035;
    for (const corner of corners) {
      const centerX = corner.sx * straightX;
      const centerZ = corner.sz * straightZ;
      for (let index = 0; index < CORNER_SEGMENTS; index++) {
        const theta = corner.start + (index + 0.5) * delta;
        panels.push({
          x: centerX + Math.cos(theta) * panelRadius,
          z: centerZ + Math.sin(theta) * panelRadius,
          length: cornerLength,
          yaw: Math.PI / 2 - theta
        });
      }
    }
    return panels;
  }

  createGlassEnclosure(glassMaterial, frameMaterial) {
    const panels = this.buildBoundarySegments();
    const panelGeometry = new THREE.BoxGeometry(1, 1, 1);
    const glass = new THREE.InstancedMesh(panelGeometry, glassMaterial, panels.length);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < panels.length; index++) {
      const panel = panels[index];
      const height = panel.height ?? WALL_H;
      dummy.position.set(panel.x, panel.y ?? height * 0.5, panel.z);
      dummy.rotation.set(0, panel.yaw, 0);
      dummy.scale.set(panel.length, height, WALL_T);
      dummy.updateMatrix();
      glass.setMatrixAt(index, dummy.matrix);
    }
    glass.instanceMatrix.needsUpdate = true;
    glass.renderOrder = 2;
    this.group.add(glass);

    // Bottom and top metal rails make the transparent collision boundary easy
    // to read without filling the screen with opaque wall geometry.
    const rails = new THREE.InstancedMesh(panelGeometry, frameMaterial, panels.length * 2);
    let railIndex = 0;
    for (const panel of panels) {
      const height = panel.height ?? WALL_H;
      const centerY = panel.y ?? height * 0.5;
      for (const y of [centerY - height * 0.5 + 0.13, centerY + height * 0.5 - 0.13]) {
        dummy.position.set(panel.x, y, panel.z);
        dummy.rotation.set(0, panel.yaw, 0);
        dummy.scale.set(panel.length, 0.22, 0.24);
        dummy.updateMatrix();
        rails.setMatrixAt(railIndex++, dummy.matrix);
      }
    }
    rails.instanceMatrix.needsUpdate = true;
    this.group.add(rails);

    const straightX = FIELD_W * 0.5 - CORNER_R;
    const straightZ = FIELD_L * 0.5 - CORNER_R;
    const halfWidth = FIELD_W * 0.5;
    const halfLength = FIELD_L * 0.5;
    const goalHalf = GOAL_W * 0.5;
    const supportPositions = [
      [-halfWidth, -straightZ], [-halfWidth, straightZ], [halfWidth, -straightZ], [halfWidth, straightZ],
      [-straightX, -halfLength], [straightX, -halfLength], [-straightX, halfLength], [straightX, halfLength],
      [-goalHalf, -halfLength], [goalHalf, -halfLength], [-goalHalf, halfLength], [goalHalf, halfLength]
    ];
    const supports = new THREE.InstancedMesh(panelGeometry, frameMaterial, supportPositions.length);
    for (let index = 0; index < supportPositions.length; index++) {
      const [x, z] = supportPositions[index];
      dummy.position.set(x, WALL_H * 0.5, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.26, WALL_H, 0.26);
      dummy.updateMatrix();
      supports.setMatrixAt(index, dummy.matrix);
    }
    supports.instanceMatrix.needsUpdate = true;
    this.group.add(supports);

    const roofMaterial = glassMaterial.clone();
    roofMaterial.opacity = this.lowDetail ? 0.045 : 0.075;
    roofMaterial.depthWrite = false;
    const roof = new THREE.Mesh(
      roundedRectGeometry(FIELD_W, FIELD_L, CORNER_R, this.lowDetail ? 4 : 10),
      roofMaterial
    );
    roof.position.y = ARENA_TUNING.ceiling;
    roof.renderOrder = 1;
    this.group.add(roof);
  }

  addBoxVisual(x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }

  createGoal(sign, wallMaterial) {
    const zFront = sign * (FIELD_L / 2 - 0.4);
    const zCenter = sign * (FIELD_L / 2 + GOAL_D / 2);
    const zBack = sign * (FIELD_L / 2 + GOAL_D);

    if (this.lowDetail) {
      const half = GOAL_W / 2;
      const points = [
        -half, 0, zFront, -half, GOAL_H, zFront,
         half, 0, zFront,  half, GOAL_H, zFront,
        -half, GOAL_H, zFront, half, GOAL_H, zFront
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const goalLine = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xc9f2ff }));
      this.group.add(goalLine);
      return;
    }

    const goal = new THREE.Group();
    goal.position.set(0, 0, zFront);
    goal.rotation.y = sign > 0 ? Math.PI : 0;
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xe8f8ff,
      emissive: 0x123a47,
      emissiveIntensity: 0.8,
      roughness: 0.5
    });
    const postGeo = new THREE.BoxGeometry(0.3, GOAL_H, 0.3);
    const barGeo = new THREE.BoxGeometry(GOAL_W, 0.3, 0.3);
    for (const px of [-GOAL_W / 2 + 0.15, GOAL_W / 2 - 0.15]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(px, GOAL_H / 2, 0);
      goal.add(post);
    }
    const bar = new THREE.Mesh(barGeo, frameMat);
    bar.position.set(0, GOAL_H - 0.15, 0);
    goal.add(bar);
    this.group.add(goal);

    const sideT = 0.28;
    this.addBoxVisual(-GOAL_W / 2, GOAL_H / 2, zCenter, sideT, GOAL_H, GOAL_D, wallMaterial);
    this.addBoxVisual(GOAL_W / 2, GOAL_H / 2, zCenter, sideT, GOAL_H, GOAL_D, wallMaterial);
    this.addBoxVisual(0, GOAL_H, zCenter, GOAL_W, sideT, GOAL_D, wallMaterial);
    this.addBoxVisual(0, GOAL_H / 2, zBack, GOAL_W, GOAL_H, sideT, wallMaterial);

    const goalFloorMat = new THREE.MeshStandardMaterial({ color: 0x123b45, roughness: 0.92, metalness: 0 });
    const goalFloor = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_D), goalFloorMat);
    goalFloor.rotation.x = -Math.PI / 2;
    goalFloor.position.set(0, 0.004, zCenter);
    this.group.add(goalFloor);
  }

  createPhysics() {
    const R = this.RAPIER;
    const floorBody = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
    this.world.createCollider(
      R.ColliderDesc.cuboid(FIELD_W / 2, 0.2, FIELD_L / 2)
        .setFriction(0.72)
        .setRestitution(0)
        .setContactSkin(0.01),
      floorBody
    );

    const halfWidth = FIELD_W * 0.5;
    const halfLength = FIELD_L * 0.5;
    const straightX = halfWidth - CORNER_R;
    const straightZ = halfLength - CORNER_R;
    const goalHalfWidth = GOAL_W * 0.5;
    const endSegmentLength = straightX - goalHalfWidth;
    const endSegmentCenter = goalHalfWidth + endSegmentLength * 0.5;

    this.addFixedCollider(halfWidth + WALL_T * 0.5, WALL_H * 0.5, 0, WALL_T * 0.5, WALL_H * 0.5, straightZ, 0.12, 0);
    this.addFixedCollider(-halfWidth - WALL_T * 0.5, WALL_H * 0.5, 0, WALL_T * 0.5, WALL_H * 0.5, straightZ, 0.12, 0);

    for (const sign of [-1, 1]) {
      const z = sign * (halfLength + WALL_T * 0.5);
      this.addFixedCollider(-endSegmentCenter, WALL_H * 0.5, z, endSegmentLength * 0.5, WALL_H * 0.5, WALL_T * 0.5, 0.12, 0);
      this.addFixedCollider(endSegmentCenter, WALL_H * 0.5, z, endSegmentLength * 0.5, WALL_H * 0.5, WALL_T * 0.5, 0.12, 0);
      const topHeight = WALL_H - GOAL_H;
      this.addFixedCollider(0, GOAL_H + topHeight * 0.5, z, GOAL_W * 0.5, topHeight * 0.5, WALL_T * 0.5, 0.12, 0);

      const zCenter = sign * (halfLength + GOAL_D * 0.5);
      const zBack = sign * (halfLength + GOAL_D);
      const t = 0.2;
      this.addFixedCollider(-GOAL_W * 0.5, GOAL_H * 0.5, zCenter, t, GOAL_H * 0.5, GOAL_D * 0.5, 0.12, 0);
      this.addFixedCollider(GOAL_W * 0.5, GOAL_H * 0.5, zCenter, t, GOAL_H * 0.5, GOAL_D * 0.5, 0.12, 0);
      this.addFixedCollider(0, GOAL_H, zCenter, GOAL_W * 0.5, t, GOAL_D * 0.5, 0.12, 0);
      this.addFixedCollider(0, GOAL_H * 0.5, zBack, GOAL_W * 0.5, GOAL_H * 0.5, t, 0.12, 0);
      this.addFixedCollider(0, -0.2, zCenter, GOAL_W * 0.5, 0.2, GOAL_D * 0.5, 0.72, 0);
    }

    const delta = Math.PI * 0.5 / CORNER_SEGMENTS;
    const colliderRadius = CORNER_R + WALL_T * 0.5;
    const colliderLength = 2 * colliderRadius * Math.sin(delta * 0.5) * 1.05;
    const physicsCorners = [
      { start: 0, centerX: straightX, centerZ: straightZ },
      { start: Math.PI / 2, centerX: -straightX, centerZ: straightZ },
      { start: Math.PI, centerX: -straightX, centerZ: -straightZ },
      { start: Math.PI * 1.5, centerX: straightX, centerZ: -straightZ }
    ];
    for (const corner of physicsCorners) {
      for (let index = 0; index < CORNER_SEGMENTS; index++) {
        const theta = corner.start + (index + 0.5) * delta;
        const x = corner.centerX + Math.cos(theta) * colliderRadius;
        const z = corner.centerZ + Math.sin(theta) * colliderRadius;
        this.addFixedColliderRotated(
          x,
          WALL_H * 0.5,
          z,
          colliderLength * 0.5,
          WALL_H * 0.5,
          WALL_T * 0.5,
          Math.PI / 2 - theta,
          0.12,
          0
        );
      }
    }

    // A thin physical glass roof completes the enclosure. CCD plus four CCD
    // substeps in Game prevents fast cars/balls from tunnelling through it.
    this.addFixedCollider(0, ARENA_TUNING.ceiling + 0.2, 0, halfWidth, 0.2, halfLength, 0.08, 0);
  }

  addFixedCollider(x, y, z, hx, hy, hz, friction, restitution) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(friction)
        .setRestitution(restitution)
        .setContactSkin(0.01),
      body
    );
  }

  addFixedColliderRotated(x, y, z, hx, hy, hz, yaw, friction, restitution) {
    const R = this.RAPIER;
    const halfYaw = yaw * 0.5;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) })
    );
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(friction)
        .setRestitution(restitution)
        .setContactSkin(0.01),
      body
    );
  }

  createStands() {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x091724, roughness: 0.9, metalness: 0.02 });
    const outerW = FIELD_W + 30;
    const outerL = FIELD_L + 30;
    const pieces = [
      [0, 5.0, outerL / 2, outerW, 9.5, 4.0],
      [0, 5.0, -outerL / 2, outerW, 9.5, 4.0],
      [outerW / 2, 5.0, 0, 4.0, 9.5, outerL - 8],
      [-outerW / 2, 5.0, 0, 4.0, 9.5, outerL - 8]
    ];
    for (const [x, y, z, w, h, d] of pieces) this.addBoxVisual(x, y, z, w, h, d, standMat);

    const accentMat = new THREE.MeshBasicMaterial({ color: 0xff7a18 });
    const accentGeo = new THREE.BoxGeometry(7, 0.28, 0.28);
    const accents = new THREE.InstancedMesh(accentGeo, accentMat, 9);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < 9; index++) {
      dummy.position.set((index - 4) * 12.0, 8.0, FIELD_L / 2 + 15.0);
      dummy.updateMatrix();
      accents.setMatrixAt(index, dummy.matrix);
    }
    accents.instanceMatrix.needsUpdate = true;
    this.group.add(accents);
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(0x9bdfff, 0x152431, 2.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.55);
    sun.position.set(30, 48, 22);
    sun.castShadow = false;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x2cbcff, 0.7);
    rim.position.set(-28, 16, -35);
    this.scene.add(rim);
  }
}
