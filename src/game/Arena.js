import * as THREE from 'three';
import { ARENA_TUNING } from '../shared/arena-tuning.js';

const FIELD_W = ARENA_TUNING.width;
const FIELD_L = ARENA_TUNING.length;
const WALL_H = ARENA_TUNING.wallHeight;
const WALL_T = ARENA_TUNING.wallThickness;
const CORNER_R = ARENA_TUNING.cornerRadius;
const RAMP_R = ARENA_TUNING.rampRadius;
const CEILING_R = ARENA_TUNING.ceilingRampRadius;
const RAMP_SEGMENTS = ARENA_TUNING.rampSegments;
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

    this.createExteriorGround();
    this.createField();
    if (this.enablePhysics) this.createPhysics();
    // All decoration below is static and mostly instanced/unlit. Keeping it in
    // low-detail mode makes the arena feel alive without adding shadow cost.
    this.createStands();
    this.createExteriorDecoration();
    this.createLights();

    // The whole arena is static. Avoid rebuilding local matrices every frame.
    this.group.traverse((object) => {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
    this.group.updateMatrixWorld(true);
  }

  createExteriorGround() {
    // A large visual-only apron prevents the camera from revealing a black void
    // when it moves behind the transparent arena walls.
    const material = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x76957c })
      : new THREE.MeshStandardMaterial({ color: 0x78967f, roughness: 1.0, metalness: 0.0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(250, 320), material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.055;
    ground.userData.cameraOcclusionIgnore = true;
    this.group.add(ground);
  }

  createField() {
    const turfMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x2b8767 })
      : new THREE.MeshStandardMaterial({ color: 0x287f63, roughness: 0.9, metalness: 0.0 });
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

    this.createGoal(1);
    this.createGoal(-1);
  }

  buildBoundarySegments() {
    const halfWidth = FIELD_W * 0.5;
    const halfLength = FIELD_L * 0.5;
    const straightX = halfWidth - CORNER_R;
    const straightZ = halfLength - CORNER_R;
    const goalHalfWidth = GOAL_W * 0.5;
    const panels = [
      { x: halfWidth + WALL_T * 0.5, z: 0, length: straightZ * 2, yaw: Math.PI / 2, nx: 1, nz: 0, minY: RAMP_R },
      { x: -halfWidth - WALL_T * 0.5, z: 0, length: straightZ * 2, yaw: Math.PI / 2, nx: -1, nz: 0, minY: RAMP_R }
    ];

    const endSegmentLength = straightX - goalHalfWidth;
    const endSegmentCenter = goalHalfWidth + endSegmentLength * 0.5;
    for (const signZ of [-1, 1]) {
      const z = signZ * (halfLength + WALL_T * 0.5);
      panels.push(
        { x: -endSegmentCenter, z, length: endSegmentLength, yaw: 0, nx: 0, nz: signZ, minY: RAMP_R },
        { x: endSegmentCenter, z, length: endSegmentLength, yaw: 0, nx: 0, nz: signZ, minY: RAMP_R },
        {
          x: 0,
          z,
          length: GOAL_W,
          minY: GOAL_H,
          yaw: 0,
          nx: 0,
          nz: signZ,
          ramp: false
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
          yaw: Math.PI / 2 - theta,
          nx: Math.cos(theta),
          nz: Math.sin(theta),
          minY: RAMP_R
        });
      }
    }
    return panels;
  }

  createGlassEnclosure(glassMaterial, frameMaterial) {
    const panels = this.buildBoundarySegments();
    this.createWallRamps(panels);
    this.createCeilingRamps(panels, glassMaterial);
    const panelGeometry = new THREE.BoxGeometry(1, 1, 1);
    const glass = new THREE.InstancedMesh(panelGeometry, glassMaterial, panels.length);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < panels.length; index++) {
      const panel = panels[index];
      const minY = panel.minY ?? 0;
      const maxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
      const height = panel.height ?? Math.max(0.2, maxY - minY);
      dummy.position.set(panel.x, minY + height * 0.5, panel.z);
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
      const minY = panel.minY ?? 0;
      const maxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
      const height = panel.height ?? Math.max(0.2, maxY - minY);
      const centerY = minY + height * 0.5;
      for (const y of [minY + 0.13, centerY + height * 0.5 - 0.13]) {
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
      const supportHeight = WALL_H - CEILING_R;
      dummy.position.set(x, supportHeight * 0.5, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.26, supportHeight, 0.26);
      dummy.updateMatrix();
      supports.setMatrixAt(index, dummy.matrix);
    }
    supports.instanceMatrix.needsUpdate = true;
    this.group.add(supports);

    const roofMaterial = glassMaterial.clone();
    roofMaterial.opacity = this.lowDetail ? 0.045 : 0.075;
    roofMaterial.depthWrite = false;
    const roof = new THREE.Mesh(
      roundedRectGeometry(
        FIELD_W - CEILING_R * 2,
        FIELD_L - CEILING_R * 2,
        Math.max(1, CORNER_R - CEILING_R),
        this.lowDetail ? 4 : 10
      ),
      roofMaterial
    );
    roof.position.y = ARENA_TUNING.ceiling;
    roof.renderOrder = 1;
    this.group.add(roof);
  }

  createWallRamps(panels) {
    const rampPanels = panels.filter((panel) => panel.ramp !== false);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x356b68 })
      : new THREE.MeshStandardMaterial({ color: 0x3a706c, roughness: 0.78, metalness: 0.08 });
    const ramps = new THREE.InstancedMesh(geometry, material, rampPanels.length * RAMP_SEGMENTS);
    const matrix = new THREE.Matrix4();
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const slope = new THREE.Vector3();
    const delta = Math.PI * 0.5 / RAMP_SEGMENTS;
    const arcLength = RAMP_R * delta * 1.055;
    let instance = 0;

    for (const panel of rampPanels) {
      const boundaryX = panel.x - panel.nx * WALL_T * 0.5;
      const boundaryZ = panel.z - panel.nz * WALL_T * 0.5;
      tangent.set(panel.nz, 0, -panel.nx).normalize();
      for (let index = 0; index < RAMP_SEGMENTS; index++) {
        const angle = (index + 0.5) * delta;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        normal.set(-panel.nx * sine, cosine, -panel.nz * sine).normalize();
        slope.crossVectors(tangent, normal).normalize();
        basis.makeBasis(tangent, normal, slope);
        quaternion.setFromRotationMatrix(basis);
        position.set(
          boundaryX - panel.nx * (RAMP_R - RAMP_R * sine),
          RAMP_R - RAMP_R * cosine,
          boundaryZ - panel.nz * (RAMP_R - RAMP_R * sine)
        ).addScaledVector(normal, -0.10);
        scale.set(panel.length * 1.035, 0.20, arcLength);
        matrix.compose(position, quaternion, scale);
        ramps.setMatrixAt(instance++, matrix);
      }
    }
    ramps.instanceMatrix.needsUpdate = true;
    this.group.add(ramps);
  }

  createCeilingRamps(panels, glassMaterial) {
    const upperPanels = panels.filter((panel) => panel.upperRamp !== false);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = glassMaterial.clone();
    material.opacity = this.lowDetail ? 0.07 : 0.12;
    material.depthWrite = false;
    const ramps = new THREE.InstancedMesh(geometry, material, upperPanels.length * RAMP_SEGMENTS);
    const matrix = new THREE.Matrix4();
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const slope = new THREE.Vector3();
    const delta = Math.PI * 0.5 / RAMP_SEGMENTS;
    const arcLength = CEILING_R * delta * 1.055;
    let instance = 0;

    for (const panel of upperPanels) {
      const boundaryX = panel.x - panel.nx * WALL_T * 0.5;
      const boundaryZ = panel.z - panel.nz * WALL_T * 0.5;
      tangent.set(panel.nz, 0, -panel.nx).normalize();
      for (let index = 0; index < RAMP_SEGMENTS; index++) {
        const angle = (index + 0.5) * delta;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        normal.set(-panel.nx * cosine, -sine, -panel.nz * cosine).normalize();
        slope.crossVectors(tangent, normal).normalize();
        basis.makeBasis(tangent, normal, slope);
        quaternion.setFromRotationMatrix(basis);
        position.set(
          boundaryX - panel.nx * (CEILING_R - CEILING_R * cosine),
          ARENA_TUNING.ceiling - CEILING_R + CEILING_R * sine,
          boundaryZ - panel.nz * (CEILING_R - CEILING_R * cosine)
        ).addScaledVector(normal, -0.10);
        scale.set(panel.length * 1.035, 0.20, arcLength);
        matrix.compose(position, quaternion, scale);
        ramps.setMatrixAt(instance++, matrix);
      }
    }
    ramps.instanceMatrix.needsUpdate = true;
    ramps.renderOrder = 1;
    this.group.add(ramps);
  }

  addBoxVisual(x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }

  createGoal(sign) {
    const zFront = sign * (FIELD_L / 2 - 0.4);
    const zCenter = sign * (FIELD_L / 2 + GOAL_D / 2);
    const zBack = sign * (FIELD_L / 2 + GOAL_D);

    const isOrange = sign > 0;
    const color = isOrange ? 0xff7a18 : 0x238cff;
    const darkColor = isOrange ? 0x532109 : 0x0b2d67;
    const teamName = isOrange ? 'ORANGE' : 'BLAU';
    const wallMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: darkColor, transparent: true, opacity: 0.72 })
      : new THREE.MeshStandardMaterial({
          color: darkColor,
          emissive: color,
          emissiveIntensity: 0.16,
          transparent: true,
          opacity: 0.76,
          roughness: 0.42,
          metalness: 0.14,
          depthWrite: false
        });

    if (this.lowDetail) {
      const half = GOAL_W / 2;
      const points = [
        -half, 0, zFront, -half, GOAL_H, zFront,
         half, 0, zFront,  half, GOAL_H, zFront,
        -half, GOAL_H, zFront, half, GOAL_H, zFront
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const goalLine = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
      this.group.add(goalLine);
    } else {
      const goal = new THREE.Group();
      goal.position.set(0, 0, zFront);
      goal.rotation.y = sign > 0 ? Math.PI : 0;
      const frameMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.7,
        roughness: 0.32,
        metalness: 0.44
      });
      const postGeo = new THREE.BoxGeometry(0.55, GOAL_H, 0.55);
      const barGeo = new THREE.BoxGeometry(GOAL_W, 0.55, 0.55);
      for (const px of [-GOAL_W / 2 + 0.275, GOAL_W / 2 - 0.275]) {
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(px, GOAL_H / 2, 0);
        goal.add(post);
      }
      const bar = new THREE.Mesh(barGeo, frameMat);
      bar.position.set(0, GOAL_H - 0.275, 0);
      goal.add(bar);
      this.group.add(goal);
    }

    const sideT = 0.28;
    this.addBoxVisual(-GOAL_W / 2, GOAL_H / 2, zCenter, sideT, GOAL_H, GOAL_D, wallMaterial);
    this.addBoxVisual(GOAL_W / 2, GOAL_H / 2, zCenter, sideT, GOAL_H, GOAL_D, wallMaterial);
    this.addBoxVisual(0, GOAL_H, zCenter, GOAL_W, sideT, GOAL_D, wallMaterial);
    this.addBoxVisual(0, GOAL_H / 2, zBack, GOAL_W, GOAL_H, sideT, wallMaterial);

    const goalFloorMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: darkColor })
      : new THREE.MeshStandardMaterial({ color: darkColor, emissive: color, emissiveIntensity: 0.12, roughness: 0.88, metalness: 0 });
    const goalFloor = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_D), goalFloorMat);
    goalFloor.rotation.x = -Math.PI / 2;
    goalFloor.position.set(0, 0.004, zCenter);
    this.group.add(goalFloor);

    if (!this.lowDetail) {
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      const context = labelCanvas.getContext('2d');
      context.fillStyle = isOrange ? '#ff9a43' : '#62aaff';
      context.font = '900 76px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(teamName, 256, 68);
      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 2.5),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
      );
      label.position.set(0, GOAL_H + 1.7, zFront - sign * 0.06);
      label.rotation.y = sign > 0 ? Math.PI : 0;
      this.group.add(label);
    }
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
    const panels = this.buildBoundarySegments();
    for (const panel of panels) {
      const minY = panel.minY ?? 0;
      const maxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
      const height = panel.height ?? Math.max(0.2, maxY - minY);
      this.addFixedColliderRotated(
        panel.x,
        minY + height * 0.5,
        panel.z,
        panel.length * 0.5,
        height * 0.5,
        WALL_T * 0.5,
        panel.yaw,
        0.12,
        0
      );
      if (panel.ramp !== false) this.addRampPhysics(panel);
      if (panel.upperRamp !== false) this.addCeilingRampPhysics(panel);
    }

    for (const sign of [-1, 1]) {
      const zCenter = sign * (halfLength + GOAL_D * 0.5);
      const zBack = sign * (halfLength + GOAL_D);
      const t = 0.2;
      this.addFixedCollider(-GOAL_W * 0.5, GOAL_H * 0.5, zCenter, t, GOAL_H * 0.5, GOAL_D * 0.5, 0.12, 0);
      this.addFixedCollider(GOAL_W * 0.5, GOAL_H * 0.5, zCenter, t, GOAL_H * 0.5, GOAL_D * 0.5, 0.12, 0);
      this.addFixedCollider(0, GOAL_H, zCenter, GOAL_W * 0.5, t, GOAL_D * 0.5, 0.12, 0);
      this.addFixedCollider(0, GOAL_H * 0.5, zBack, GOAL_W * 0.5, GOAL_H * 0.5, t, 0.12, 0);
      this.addFixedCollider(0, -0.2, zCenter, GOAL_W * 0.5, 0.2, GOAL_D * 0.5, 0.72, 0);
    }

    // The flat roof is inset because the outer band is now a rounded glass
    // transition. This avoids a sharp hidden box edge fighting the upper ramps.
    this.addFixedCollider(
      0,
      ARENA_TUNING.ceiling + 0.2,
      0,
      halfWidth - CEILING_R,
      0.2,
      halfLength - CEILING_R,
      0.08,
      0
    );
  }

  addRampPhysics(panel) {
    const delta = Math.PI * 0.5 / RAMP_SEGMENTS;
    const arcLength = RAMP_R * delta * 1.065;
    const boundaryX = panel.x - panel.nx * WALL_T * 0.5;
    const boundaryZ = panel.z - panel.nz * WALL_T * 0.5;
    const tangent = new THREE.Vector3(panel.nz, 0, -panel.nx).normalize();
    const normal = new THREE.Vector3();
    const slope = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();

    for (let index = 0; index < RAMP_SEGMENTS; index++) {
      const angle = (index + 0.5) * delta;
      const sine = Math.sin(angle);
      const cosine = Math.cos(angle);
      normal.set(-panel.nx * sine, cosine, -panel.nz * sine).normalize();
      slope.crossVectors(tangent, normal).normalize();
      basis.makeBasis(tangent, normal, slope);
      quaternion.setFromRotationMatrix(basis);
      const position = new THREE.Vector3(
        boundaryX - panel.nx * (RAMP_R - RAMP_R * sine),
        RAMP_R - RAMP_R * cosine,
        boundaryZ - panel.nz * (RAMP_R - RAMP_R * sine)
      ).addScaledVector(normal, -0.11);
      this.addFixedColliderQuaternion(
        position.x,
        position.y,
        position.z,
        panel.length * 0.5 * 1.035,
        0.11,
        arcLength * 0.5,
        quaternion,
        0.72,
        0
      );
    }
  }

  addCeilingRampPhysics(panel) {
    const delta = Math.PI * 0.5 / RAMP_SEGMENTS;
    const arcLength = CEILING_R * delta * 1.065;
    const boundaryX = panel.x - panel.nx * WALL_T * 0.5;
    const boundaryZ = panel.z - panel.nz * WALL_T * 0.5;
    const tangent = new THREE.Vector3(panel.nz, 0, -panel.nx).normalize();
    const normal = new THREE.Vector3();
    const slope = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();

    for (let index = 0; index < RAMP_SEGMENTS; index++) {
      const angle = (index + 0.5) * delta;
      const sine = Math.sin(angle);
      const cosine = Math.cos(angle);
      normal.set(-panel.nx * cosine, -sine, -panel.nz * cosine).normalize();
      slope.crossVectors(tangent, normal).normalize();
      basis.makeBasis(tangent, normal, slope);
      quaternion.setFromRotationMatrix(basis);
      const position = new THREE.Vector3(
        boundaryX - panel.nx * (CEILING_R - CEILING_R * cosine),
        ARENA_TUNING.ceiling - CEILING_R + CEILING_R * sine,
        boundaryZ - panel.nz * (CEILING_R - CEILING_R * cosine)
      ).addScaledVector(normal, -0.11);
      this.addFixedColliderQuaternion(
        position.x,
        position.y,
        position.z,
        panel.length * 0.5 * 1.035,
        0.11,
        arcLength * 0.5,
        quaternion,
        0.16,
        0
      );
    }
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

  addFixedColliderQuaternion(x, y, z, hx, hy, hz, quaternion, friction, restitution) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(x, y, z)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
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
    const concreteMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x748795 })
      : new THREE.MeshStandardMaterial({ color: 0x788b98, roughness: 0.93, metalness: 0.02 });
    const darkMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x405866 })
      : new THREE.MeshStandardMaterial({ color: 0x465d69, roughness: 0.88, metalness: 0.04 });

    // Tiered stand blocks are one instanced draw call instead of many meshes.
    const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
    const tierMatrices = [];
    const dummy = new THREE.Object3D();
    for (const sign of [-1, 1]) {
      for (let tier = 0; tier < 3; tier++) {
        dummy.position.set(0, 1.75 + tier * 1.65, sign * (FIELD_L * 0.5 + 8.5 + tier * 3.0));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(FIELD_W + 31 - tier * 2.0, 3.5 + tier * 0.55, 4.2);
        dummy.updateMatrix();
        tierMatrices.push(dummy.matrix.clone());
      }
    }
    for (const sign of [-1, 1]) {
      for (let tier = 0; tier < 3; tier++) {
        dummy.position.set(sign * (FIELD_W * 0.5 + 8.5 + tier * 3.0), 1.75 + tier * 1.65, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(4.2, 3.5 + tier * 0.55, FIELD_L + 14 - tier * 2.0);
        dummy.updateMatrix();
        tierMatrices.push(dummy.matrix.clone());
      }
    }
    const tiers = new THREE.InstancedMesh(blockGeometry, concreteMat, tierMatrices.length);
    tierMatrices.forEach((matrix, index) => tiers.setMatrixAt(index, matrix));
    tiers.instanceMatrix.needsUpdate = true;
    this.group.add(tiers);

    // Dark fascia underneath the first row gives the arena depth without lights.
    const fascia = new THREE.InstancedMesh(blockGeometry, darkMat, 4);
    const fasciaData = [
      [0, 2.5, FIELD_L * 0.5 + 6.1, FIELD_W + 27, 5.0, 1.15],
      [0, 2.5, -FIELD_L * 0.5 - 6.1, FIELD_W + 27, 5.0, 1.15],
      [FIELD_W * 0.5 + 6.1, 2.5, 0, 1.15, 5.0, FIELD_L + 11],
      [-FIELD_W * 0.5 - 6.1, 2.5, 0, 1.15, 5.0, FIELD_L + 11]
    ];
    fasciaData.forEach(([x, y, z, w, h, d], index) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      fascia.setMatrixAt(index, dummy.matrix);
    });
    fascia.instanceMatrix.needsUpdate = true;
    this.group.add(fascia);

    this.createCrowd();
    this.createStandBanners();
  }

  createCrowd() {
    // Each block represents a small cluster of spectators. Hundreds of visible
    // "people" still cost a single draw call thanks to InstancedMesh.
    const positions = [];
    const rowCount = this.lowDetail ? 1 : 2;
    const longStep = this.lowDetail ? 8.0 : 4.6;
    const endStep = this.lowDetail ? 7.0 : 4.1;

    for (const side of [-1, 1]) {
      for (let row = 0; row < rowCount; row++) {
        for (let z = -FIELD_L * 0.5 + 4; z <= FIELD_L * 0.5 - 4; z += longStep) {
          positions.push([side * (FIELD_W * 0.5 + 7.3 + row * 2.2), 4.1 + row * 1.65, z, Math.PI / 2]);
        }
        for (let x = -FIELD_W * 0.5 + 4; x <= FIELD_W * 0.5 - 4; x += endStep) {
          positions.push([x, 4.1 + row * 1.65, side * (FIELD_L * 0.5 + 7.3 + row * 2.2), 0]);
        }
      }
    }

    const crowdGeometry = new THREE.BoxGeometry(0.82, 0.68, 0.72);
    const crowdMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, positions.length);
    const dummy = new THREE.Object3D();
    const palette = [
      new THREE.Color(0xff8a3c), new THREE.Color(0x3f91e8), new THREE.Color(0xf0d066),
      new THREE.Color(0xe7edf2), new THREE.Color(0x365767), new THREE.Color(0x6fc58c)
    ];
    positions.forEach(([x, y, z, yaw], index) => {
      const wobble = Math.sin(index * 12.9898) * 0.16;
      dummy.position.set(x, y + wobble, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 0.86 + Math.abs(wobble), 1);
      dummy.updateMatrix();
      crowd.setMatrixAt(index, dummy.matrix);
      crowd.setColorAt(index, palette[index % palette.length]);
    });
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    this.group.add(crowd);
  }

  createStandBanners() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const banners = [];
    const spacing = this.lowDetail ? 22 : 13;
    for (let x = -FIELD_W * 0.5; x <= FIELD_W * 0.5; x += spacing) {
      banners.push([x, 7.9, FIELD_L * 0.5 + 5.45, 5.2, 1.0, 0.15, 0]);
      banners.push([x, 7.9, -FIELD_L * 0.5 - 5.45, 5.2, 1.0, 0.15, 0]);
    }
    for (let z = -FIELD_L * 0.5 + 10; z <= FIELD_L * 0.5 - 10; z += spacing) {
      banners.push([FIELD_W * 0.5 + 5.45, 7.9, z, 0.15, 1.0, 5.2, Math.PI / 2]);
      banners.push([-FIELD_W * 0.5 - 5.45, 7.9, z, 0.15, 1.0, 5.2, Math.PI / 2]);
    }

    const mesh = new THREE.InstancedMesh(geometry, material, banners.length);
    const dummy = new THREE.Object3D();
    const orange = new THREE.Color(0xff7a18);
    const blue = new THREE.Color(0x238cff);
    banners.forEach(([x, y, z, w, h, d, yaw], index) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, index % 2 === 0 ? orange : blue);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  createExteriorDecoration() {
    this.createTrees();
    if (!this.lowDetail) this.createSkyline();
  }

  createTrees() {
    const count = this.lowDetail ? 14 : 28;
    const trunkGeometry = new THREE.CylinderGeometry(0.28, 0.38, 3.0, 5);
    const crownGeometry = new THREE.ConeGeometry(2.2, 5.4, 6);
    const trunkMaterial = new THREE.MeshBasicMaterial({ color: 0x6f5439 });
    const crownMaterial = new THREE.MeshBasicMaterial({ color: 0x3e7851 });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
    const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, count);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 + 0.14;
      const wave = Math.sin(index * 2.37) * 3.5;
      const x = Math.sin(angle) * (FIELD_W * 0.5 + 27 + wave);
      const z = Math.cos(angle) * (FIELD_L * 0.5 + 27 + wave * 1.5);
      const scale = 0.78 + (index % 5) * 0.07;
      dummy.position.set(x, 1.5 * scale, z);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);

      dummy.position.set(x, 5.1 * scale, z);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      crowns.setMatrixAt(index, dummy.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    this.group.add(trunks, crowns);
  }

  createSkyline() {
    const count = 24;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    const buildings = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    const colors = [
      new THREE.Color(0x8ba1ac), new THREE.Color(0x718c9b), new THREE.Color(0xa0adb0),
      new THREE.Color(0x6f8790)
    ];
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 + 0.05;
      const radiusX = FIELD_W * 0.5 + 62 + (index % 3) * 5;
      const radiusZ = FIELD_L * 0.5 + 62 + (index % 4) * 4;
      const height = 10 + (index % 7) * 2.8;
      const width = 6 + (index % 4) * 1.7;
      const depth = 6 + ((index + 2) % 4) * 1.5;
      dummy.position.set(Math.sin(angle) * radiusX, height * 0.5 - 0.05, Math.cos(angle) * radiusZ);
      dummy.rotation.set(0, -angle * 0.32, 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      buildings.setMatrixAt(index, dummy.matrix);
      buildings.setColorAt(index, colors[index % colors.length]);
    }
    buildings.instanceMatrix.needsUpdate = true;
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    this.group.add(buildings);
  }

  createLights() {
    // Daylight without shadows: three tiny light objects, no shadow-map pass.
    const hemi = new THREE.HemisphereLight(0xd6efff, 0x5e765c, this.lowDetail ? 1.85 : 2.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d0, this.lowDetail ? 1.65 : 2.35);
    sun.position.set(-34, 62, -28);
    sun.castShadow = false;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xaedcff, this.lowDetail ? 0.34 : 0.52);
    fill.position.set(32, 24, 38);
    fill.castShadow = false;
    this.scene.add(fill);
  }
}
