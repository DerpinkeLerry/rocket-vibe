import * as THREE from 'three';

// Bigger than v0.3, while keeping geometry intentionally simple.
const FIELD_W = 110;
const FIELD_L = 160;
const WALL_H = 9.0;
const WALL_T = 1.0;
const GOAL_W = 13.0;
const GOAL_H = 5.2;
const GOAL_D = 8.0;

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
    const turf = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_L), turfMat);
    turf.rotation.x = -Math.PI / 2;
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

    const wallMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x0c2234 })
      : new THREE.MeshStandardMaterial({ color: 0x0c2234, roughness: 0.58, metalness: 0.12 });

    // Side walls are full length. End walls are split around a real goal mouth,
    // so both car and ball can actually enter the goal tunnel.
    this.addBoxVisual(FIELD_W / 2 + WALL_T / 2, WALL_H / 2, 0, WALL_T, WALL_H, FIELD_L, wallMat);
    this.addBoxVisual(-FIELD_W / 2 - WALL_T / 2, WALL_H / 2, 0, WALL_T, WALL_H, FIELD_L, wallMat);
    this.addEndWallVisual(1, wallMat);
    this.addEndWallVisual(-1, wallMat);

    if (!this.lowDetail) {
      const trimMat = new THREE.MeshBasicMaterial({ color: 0x42d9ff });
      const trims = [
        [0, 0.10, FIELD_L / 2 - 0.14, FIELD_W, 0.13, 0.13],
        [0, 0.10, -FIELD_L / 2 + 0.14, FIELD_W, 0.13, 0.13],
        [FIELD_W / 2 - 0.14, 0.10, 0, 0.13, 0.13, FIELD_L],
        [-FIELD_W / 2 + 0.14, 0.10, 0, 0.13, 0.13, FIELD_L]
      ];
      for (const [x, y, z, w, h, d] of trims) this.addBoxVisual(x, y, z, w, h, d, trimMat);
    }

    this.createGoal(1, wallMat);
    this.createGoal(-1, wallMat);
  }

  addBoxVisual(x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }

  addEndWallVisual(sign, material) {
    const z = sign * (FIELD_L / 2 + WALL_T / 2);
    const sideW = (FIELD_W - GOAL_W) / 2;
    const sideX = GOAL_W / 2 + sideW / 2;
    const topH = WALL_H - GOAL_H;

    this.addBoxVisual(-sideX, WALL_H / 2, z, sideW, WALL_H, WALL_T, material);
    this.addBoxVisual(sideX, WALL_H / 2, z, sideW, WALL_H, WALL_T, material);
    this.addBoxVisual(0, GOAL_H + topH / 2, z, GOAL_W, topH, WALL_T, material);
  }

  createGoal(sign, wallMat) {
    const zFront = sign * (FIELD_L / 2 - 0.4);
    const zCenter = sign * (FIELD_L / 2 + GOAL_D / 2);
    const zBack = sign * (FIELD_L / 2 + GOAL_D);

    if (this.lowDetail) {
      // One draw call per goal in Ultra/VM mode. The server still has the full
      // physical goal tunnel; the client only needs a readable goal outline.
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

    const frameMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0xc9f2ff })
      : new THREE.MeshStandardMaterial({
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

    // Dark, simple goal tunnel. Five boxes are much cheaper than a mesh net.
    const sideT = 0.28;
    this.addBoxVisual(-GOAL_W / 2, GOAL_H / 2, zCenter, sideT, GOAL_H, GOAL_D, wallMat);
    this.addBoxVisual(GOAL_W / 2, GOAL_H / 2, zCenter, sideT, GOAL_H, GOAL_D, wallMat);
    this.addBoxVisual(0, GOAL_H, zCenter, GOAL_W, sideT, GOAL_D, wallMat);
    this.addBoxVisual(0, GOAL_H / 2, zBack, GOAL_W, GOAL_H, sideT, wallMat);

    const goalFloorMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x123b45 })
      : new THREE.MeshStandardMaterial({ color: 0x123b45, roughness: 0.92, metalness: 0 });
    const goalFloor = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_D), goalFloorMat);
    goalFloor.rotation.x = -Math.PI / 2;
    goalFloor.position.set(0, 0.004, zCenter);
    this.group.add(goalFloor);
  }

  createPhysics() {
    const R = this.RAPIER;

    const floorBody = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.18, 0));
    this.world.createCollider(
      R.ColliderDesc.cuboid(FIELD_W / 2, 0.18, FIELD_L / 2)
        .setFriction(0.06)
        .setRestitution(0.28),
      floorBody
    );

    // Side walls.
    this.addFixedCollider(FIELD_W / 2 + WALL_T / 2, WALL_H / 2, 0, WALL_T / 2, WALL_H / 2, FIELD_L / 2, 0.24, 0.42);
    this.addFixedCollider(-FIELD_W / 2 - WALL_T / 2, WALL_H / 2, 0, WALL_T / 2, WALL_H / 2, FIELD_L / 2, 0.24, 0.42);

    // Split end walls + real goal tunnels.
    for (const sign of [-1, 1]) {
      const z = sign * (FIELD_L / 2 + WALL_T / 2);
      const sideW = (FIELD_W - GOAL_W) / 2;
      const sideX = GOAL_W / 2 + sideW / 2;
      const topH = WALL_H - GOAL_H;

      this.addFixedCollider(-sideX, WALL_H / 2, z, sideW / 2, WALL_H / 2, WALL_T / 2, 0.24, 0.42);
      this.addFixedCollider(sideX, WALL_H / 2, z, sideW / 2, WALL_H / 2, WALL_T / 2, 0.24, 0.42);
      this.addFixedCollider(0, GOAL_H + topH / 2, z, GOAL_W / 2, topH / 2, WALL_T / 2, 0.24, 0.42);

      const zCenter = sign * (FIELD_L / 2 + GOAL_D / 2);
      const zBack = sign * (FIELD_L / 2 + GOAL_D);
      const t = 0.2;
      this.addFixedCollider(-GOAL_W / 2, GOAL_H / 2, zCenter, t, GOAL_H / 2, GOAL_D / 2, 0.2, 0.38);
      this.addFixedCollider(GOAL_W / 2, GOAL_H / 2, zCenter, t, GOAL_H / 2, GOAL_D / 2, 0.2, 0.38);
      this.addFixedCollider(0, GOAL_H, zCenter, GOAL_W / 2, t, GOAL_D / 2, 0.2, 0.38);
      this.addFixedCollider(0, GOAL_H / 2, zBack, GOAL_W / 2, GOAL_H / 2, t, 0.2, 0.38);
      this.addFixedCollider(0, -0.18, zCenter, GOAL_W / 2, 0.18, GOAL_D / 2, 0.06, 0.28);
    }
  }

  addFixedCollider(x, y, z, hx, hy, hz, friction, restitution) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(friction)
        .setRestitution(restitution),
      body
    );
  }

  createStands() {
    // One compact stand ring. v0.3 used three full tiers.
    const standMat = new THREE.MeshStandardMaterial({ color: 0x091724, roughness: 0.9, metalness: 0.02 });
    const outerW = FIELD_W + 30;
    const outerL = FIELD_L + 30;
    const pieces = [
      [0, 5.0, outerL / 2, outerW, 9.5, 4.0],
      [0, 5.0, -outerL / 2, outerW, 9.5, 4.0],
      [outerW / 2, 5.0, 0, 4.0, 9.5, outerL - 8],
      [-outerW / 2, 5.0, 0, 4.0, 9.5, outerL - 8]
    ];

    for (const [x, y, z, w, h, d] of pieces) {
      this.addBoxVisual(x, y, z, w, h, d, standMat);
    }

    // Instanced accent strips = one draw call instead of nine.
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xff7a18 });
    const accentGeo = new THREE.BoxGeometry(7, 0.28, 0.28);
    const accents = new THREE.InstancedMesh(accentGeo, accentMat, 9);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 9; i++) {
      dummy.position.set((i - 4) * 12.0, 8.0, FIELD_L / 2 + 15.0);
      dummy.updateMatrix();
      accents.setMatrixAt(i, dummy.matrix);
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
