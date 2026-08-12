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
const GOAL_R = ARENA_TUNING.goalRampRadius;
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
    this.ultraHigh = Boolean(options.ultraHigh) && !this.lowDetail;
    this.mobile = Boolean(options.mobile);
    this.maxAnisotropy = Math.max(1, Number(options.maxAnisotropy) || 1);
    this.enablePhysics = options.createPhysics !== false;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.createExteriorGround();
    this.createField();
    if (this.enablePhysics) this.createPhysics();
    // All decoration below is static and mostly instanced/unlit. Keeping it in
    // low-detail mode makes the arena feel alive without adding shadow cost.
    // Grandstands/crowd were intentionally removed. Keep only the exterior
    // skyline, buildings and trees so the stadium stays open and uncluttered.
    this.createExteriorDecoration();
    if (this.ultraHigh) this.createUltraHighStadiumDetails();
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
      : (this.ultraHigh
        ? new THREE.MeshStandardMaterial({ color: 0x6f8d75, roughness: 1.0, metalness: 0.0 })
        : new THREE.MeshStandardMaterial({ color: 0x78967f, roughness: 1.0, metalness: 0.0 }));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(250, 320), material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.055;
    ground.userData.cameraOcclusionIgnore = true;
    this.group.add(ground);
  }

  createUltraTurfTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Layered procedural turf: broad mowing bands + fine blade clusters +
    // subtle soil/dry-grass variation. This costs nothing after upload and is
    // much less "flat green" than the normal preset.
    const stripeHeight = 148;
    for (let y = 0; y < canvas.height; y += stripeHeight) {
      ctx.fillStyle = Math.floor(y / stripeHeight) % 2 === 0 ? '#27785b' : '#236d54';
      ctx.fillRect(0, y, canvas.width, stripeHeight);
    }
    let seed = 0x13579bdf;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 14500; i++) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const blade = 1 + random() * 3.2;
      const light = random();
      ctx.strokeStyle = light > 0.72
        ? `rgba(166,210,151,${0.07 + random() * 0.09})`
        : `rgba(12,67,46,${0.055 + random() * 0.085})`;
      ctx.lineWidth = random() > 0.9 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 1.4, y - blade);
      ctx.stroke();
    }
    for (let i = 0; i < 380; i++) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const r = 2 + random() * 8;
      ctx.fillStyle = random() > 0.5 ? 'rgba(198,180,116,0.035)' : 'rgba(5,45,33,0.045)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 4.8);
    texture.anisotropy = Math.min(16, this.maxAnisotropy);
    return texture;
  }

  createUltraTurfBumpTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#707070';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = 0x2468ace1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 9500; i++) {
      const shade = Math.floor(74 + random() * 88);
      ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
      ctx.lineWidth = random() > 0.86 ? 1.4 : 0.7;
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 1.2, y - 1.5 - random() * 3.6);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 4.8);
    texture.anisotropy = Math.min(16, this.maxAnisotropy);
    return texture;
  }

  createUltraGrass() {
    // Actual 3D grass geometry. Every instance is a tiny cluster of three
    // crossed triangular blades, so tens of thousands of stems stay a single
    // draw call. Smartphone Ultra High uses a lighter density.
    const vertices = [];
    const bladeWidth = 0.022;
    for (let blade = 0; blade < 3; blade++) {
      const angle = blade * Math.PI / 3;
      const dx = Math.cos(angle) * bladeWidth;
      const dz = Math.sin(angle) * bladeWidth;
      vertices.push(
        -dx, 0, -dz,
         dx, 0,  dz,
         0,  1,  0
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide
    });

    const clusterCount = this.mobile ? 9000 : 26000;
    const grass = new THREE.InstancedMesh(geometry, material, clusterCount);
    grass.name = 'ultra-high-3d-grass';
    grass.userData.grassBlades = true;
    grass.userData.cameraOcclusionIgnore = true;
    grass.castShadow = false;
    grass.receiveShadow = false;

    const dummy = new THREE.Object3D();
    const palette = [
      new THREE.Color(0x2f8a60),
      new THREE.Color(0x277b55),
      new THREE.Color(0x3c9366),
      new THREE.Color(0x246f4e),
      new THREE.Color(0x4b9b6c)
    ];
    let seed = 0x52a4f19d;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const halfW = FIELD_W * 0.5 - 0.7;
    const halfL = FIELD_L * 0.5 - 0.7;
    const corner = Math.max(0.1, CORNER_R - 0.7);
    const insideField = (x, z) => {
      const ax = Math.abs(x);
      const az = Math.abs(z);
      if (ax > halfW || az > halfL) return false;
      if (ax <= halfW - corner || az <= halfL - corner) return true;
      const dx = ax - (halfW - corner);
      const dz = az - (halfL - corner);
      return dx * dx + dz * dz <= corner * corner;
    };

    let placed = 0;
    let attempts = 0;
    while (placed < clusterCount && attempts < clusterCount * 4) {
      attempts += 1;
      const x = (random() * 2 - 1) * halfW;
      const z = (random() * 2 - 1) * halfL;
      if (!insideField(x, z)) continue;

      // Keep the painted midfield markings readable instead of covering them
      // with green geometry.
      const centerRadius = Math.hypot(x, z);
      if (Math.abs(z) < 0.13 || centerRadius < 0.52 || (centerRadius > 10.3 && centerRadius < 10.9)) continue;

      const height = 0.045 + random() * (this.mobile ? 0.045 : 0.065);
      const widthScale = 0.72 + random() * 0.62;
      dummy.position.set(x, 0.002, z);
      dummy.rotation.set((random() - 0.5) * 0.08, random() * Math.PI, (random() - 0.5) * 0.08);
      dummy.scale.set(widthScale, height, widthScale);
      dummy.updateMatrix();
      grass.setMatrixAt(placed, dummy.matrix);
      grass.setColorAt(placed, palette[Math.floor(random() * palette.length)]);
      placed += 1;
    }

    grass.count = placed;
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.computeBoundingBox?.();
    grass.computeBoundingSphere?.();
    this.group.add(grass);
  }

  createField() {
    const turfTexture = this.ultraHigh ? this.createUltraTurfTexture() : null;
    const turfBump = this.ultraHigh ? this.createUltraTurfBumpTexture() : null;
    const turfMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x2b8767 })
      : (this.ultraHigh
        ? new THREE.MeshStandardMaterial({
            color: 0xf2f7ee,
            map: turfTexture,
            bumpMap: turfBump,
            bumpScale: 0.075,
            roughness: 0.96,
            metalness: 0.0
          })
        : new THREE.MeshStandardMaterial({ color: 0x287f63, roughness: 0.9, metalness: 0.0 }));
    const turf = new THREE.Mesh(
      roundedRectGeometry(FIELD_W, FIELD_L, CORNER_R, this.lowDetail ? 4 : 10),
      turfMat
    );
    this.group.add(turf);
    if (this.ultraHigh) this.createUltraGrass();

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
      : (this.ultraHigh
        ? new THREE.MeshPhysicalMaterial({
            color: 0x8fcfe0,
            transparent: true,
            opacity: 0.17,
            roughness: 0.24,
            metalness: 0.0,
            transmission: 0.05,
            thickness: 0.12,
            ior: 1.38,
            clearcoat: 0.18,
            clearcoatRoughness: 0.48,
            envMapIntensity: 0.42,
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
          }));
    const frameMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x31c9ef })
      : (this.ultraHigh
        ? new THREE.MeshPhysicalMaterial({
            color: 0x86c5d5,
            emissive: 0x0d5d77,
            emissiveIntensity: 0.95,
            roughness: 0.42,
            metalness: 0.58,
            clearcoat: 0.12,
            clearcoatRoughness: 0.55,
            envMapIntensity: 0.48
          })
        : new THREE.MeshStandardMaterial({
            color: 0xa7edff,
            emissive: 0x12799b,
            emissiveIntensity: 1.2,
            roughness: 0.28,
            metalness: 0.64
          }));

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

  buildGoalBoundarySegments(sign) {
    const halfLength = FIELD_L * 0.5;
    const halfWidth = GOAL_W * 0.5;
    const straightX = halfWidth - GOAL_R;
    const straightDepth = GOAL_D - GOAL_R;
    const signZ = sign >= 0 ? 1 : -1;
    const panels = [];

    // Open tunnel: two side walls, one rounded back wall, no front wall.
    for (const signX of [-1, 1]) {
      panels.push({
        x: signX * (halfWidth + WALL_T * 0.5),
        z: signZ * (halfLength + straightDepth * 0.5),
        length: straightDepth,
        yaw: signX > 0 ? Math.PI / 2 : -Math.PI / 2,
        nx: signX,
        nz: 0
      });
    }
    panels.push({
      x: 0,
      z: signZ * (halfLength + GOAL_D + WALL_T * 0.5),
      length: straightX * 2,
      yaw: signZ > 0 ? 0 : Math.PI,
      nx: 0,
      nz: signZ
    });

    const cornerSegments = Math.max(6, Math.round(RAMP_SEGMENTS * 0.6));
    const delta = Math.PI * 0.5 / cornerSegments;
    const panelRadius = GOAL_R + WALL_T * 0.5;
    const cornerLength = 2 * panelRadius * Math.sin(delta * 0.5) * 1.04;
    for (const signX of [-1, 1]) {
      const centerX = signX * straightX;
      const centerZ = signZ * (halfLength + straightDepth);
      for (let index = 0; index < cornerSegments; index++) {
        const angle = (index + 0.5) * delta;
        const nx = signX * Math.cos(angle);
        const nz = signZ * Math.sin(angle);
        panels.push({
          x: centerX + nx * panelRadius,
          z: centerZ + nz * panelRadius,
          length: cornerLength,
          yaw: Math.atan2(nx, nz),
          nx,
          nz
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
      : (this.ultraHigh
        ? new THREE.MeshStandardMaterial({ color: 0x326f63, roughness: 0.88, metalness: 0.02 })
        : new THREE.MeshStandardMaterial({ color: 0x3a706c, roughness: 0.78, metalness: 0.08 }));
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

  createRoundedTunnelRampVisual(panels, radius, ceilingY, upper, material) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const ramps = new THREE.InstancedMesh(geometry, material, panels.length * RAMP_SEGMENTS);
    const matrix = new THREE.Matrix4();
    const basis = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const slope = new THREE.Vector3();
    const delta = Math.PI * 0.5 / RAMP_SEGMENTS;
    const arcLength = radius * delta * 1.055;
    let instance = 0;

    for (const panel of panels) {
      const boundaryX = panel.x - panel.nx * WALL_T * 0.5;
      const boundaryZ = panel.z - panel.nz * WALL_T * 0.5;
      tangent.set(panel.nz, 0, -panel.nx).normalize();
      for (let index = 0; index < RAMP_SEGMENTS; index++) {
        const angle = (index + 0.5) * delta;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        if (upper) {
          normal.set(-panel.nx * cosine, -sine, -panel.nz * cosine).normalize();
          position.set(
            boundaryX - panel.nx * (radius - radius * cosine),
            ceilingY - radius + radius * sine,
            boundaryZ - panel.nz * (radius - radius * cosine)
          );
        } else {
          normal.set(-panel.nx * sine, cosine, -panel.nz * sine).normalize();
          position.set(
            boundaryX - panel.nx * (radius - radius * sine),
            radius - radius * cosine,
            boundaryZ - panel.nz * (radius - radius * sine)
          );
        }
        slope.crossVectors(tangent, normal).normalize();
        basis.makeBasis(tangent, normal, slope);
        quaternion.setFromRotationMatrix(basis);
        position.addScaledVector(normal, -0.10);
        scale.set(panel.length * 1.04, 0.20, arcLength);
        matrix.compose(position, quaternion, scale);
        ramps.setMatrixAt(instance++, matrix);
      }
    }
    ramps.instanceMatrix.needsUpdate = true;
    ramps.renderOrder = 1;
    this.group.add(ramps);
    return ramps;
  }

  createGoalTunnel(sign, wallMaterial, floorMaterial) {
    const panels = this.buildGoalBoundarySegments(sign);
    const panelGeometry = new THREE.BoxGeometry(1, 1, 1);
    const wallHeight = Math.max(0.4, GOAL_H - GOAL_R * 2);
    const walls = new THREE.InstancedMesh(panelGeometry, wallMaterial, panels.length);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < panels.length; index++) {
      const panel = panels[index];
      dummy.position.set(panel.x, GOAL_R + wallHeight * 0.5, panel.z);
      dummy.rotation.set(0, panel.yaw, 0);
      dummy.scale.set(panel.length * 1.02, wallHeight, WALL_T);
      dummy.updateMatrix();
      walls.setMatrixAt(index, dummy.matrix);
    }
    walls.instanceMatrix.needsUpdate = true;
    this.group.add(walls);

    const lowerMaterial = this.lowDetail
      ? wallMaterial
      : wallMaterial.clone();
    const upperMaterial = this.lowDetail
      ? wallMaterial
      : wallMaterial.clone();
    if (!this.lowDetail) {
      lowerMaterial.opacity = Math.min(0.9, wallMaterial.opacity ?? 1);
      upperMaterial.opacity = Math.min(0.82, wallMaterial.opacity ?? 1);
    }
    this.createRoundedTunnelRampVisual(panels, GOAL_R, GOAL_H, false, lowerMaterial);
    this.createRoundedTunnelRampVisual(panels, GOAL_R, GOAL_H, true, upperMaterial);

    const halfLength = FIELD_L * 0.5;
    const signZ = sign >= 0 ? 1 : -1;
    const goalCenterZ = signZ * (halfLength + GOAL_D * 0.5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_D), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.004, goalCenterZ);
    this.group.add(floor);

    const roofWidth = Math.max(1, GOAL_W - GOAL_R * 2);
    const roofDepth = Math.max(1, GOAL_D - GOAL_R);
    const roofMaterial = wallMaterial.clone();
    roofMaterial.opacity = this.lowDetail ? 0.72 : 0.52;
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(roofWidth, roofDepth), roofMaterial);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, GOAL_H, signZ * (halfLength + roofDepth * 0.5));
    this.group.add(roof);
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
      const frameMat = this.ultraHigh
        ? new THREE.MeshPhysicalMaterial({
            color,
            emissive: color,
            emissiveIntensity: 1.65,
            roughness: 0.42,
            metalness: 0.48,
            clearcoat: 0.14,
            clearcoatRoughness: 0.52,
            envMapIntensity: 0.5
          })
        : new THREE.MeshStandardMaterial({
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

    const goalFloorMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: darkColor })
      : new THREE.MeshStandardMaterial({
          color: darkColor,
          emissive: color,
          emissiveIntensity: this.ultraHigh ? 0.075 : 0.12,
          roughness: 0.94,
          metalness: 0
        });
    this.createGoalTunnel(sign, wallMaterial, goalFloorMat);

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
      const panels = this.buildGoalBoundarySegments(sign);
      const wallHeight = Math.max(0.4, GOAL_H - GOAL_R * 2);
      for (const panel of panels) {
        this.addFixedColliderRotated(
          panel.x,
          GOAL_R + wallHeight * 0.5,
          panel.z,
          panel.length * 0.5 * 1.02,
          wallHeight * 0.5,
          WALL_T * 0.5,
          panel.yaw,
          0.12,
          0
        );
        this.addRoundedTunnelRampPhysics(panel, GOAL_R, GOAL_H, false, 0.72);
        this.addRoundedTunnelRampPhysics(panel, GOAL_R, GOAL_H, true, 0.16);
      }

      const signZ = sign >= 0 ? 1 : -1;
      const zCenter = signZ * (halfLength + GOAL_D * 0.5);
      this.addFixedCollider(0, -0.2, zCenter, GOAL_W * 0.5, 0.2, GOAL_D * 0.5, 0.72, 0);

      // The flat ceiling is inset from the side/back walls so only the rounded
      // quarter-pipes own the transition normals near the tunnel perimeter.
      const roofDepth = GOAL_D - GOAL_R;
      this.addFixedCollider(
        0,
        GOAL_H + 0.2,
        signZ * (halfLength + roofDepth * 0.5),
        GOAL_W * 0.5 - GOAL_R,
        0.2,
        roofDepth * 0.5,
        0.12,
        0
      );
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

  addRoundedTunnelRampPhysics(panel, radius, ceilingY, upper, friction) {
    const delta = Math.PI * 0.5 / RAMP_SEGMENTS;
    const arcLength = radius * delta * 1.065;
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
      let position;
      if (upper) {
        normal.set(-panel.nx * cosine, -sine, -panel.nz * cosine).normalize();
        position = new THREE.Vector3(
          boundaryX - panel.nx * (radius - radius * cosine),
          ceilingY - radius + radius * sine,
          boundaryZ - panel.nz * (radius - radius * cosine)
        );
      } else {
        normal.set(-panel.nx * sine, cosine, -panel.nz * sine).normalize();
        position = new THREE.Vector3(
          boundaryX - panel.nx * (radius - radius * sine),
          radius - radius * cosine,
          boundaryZ - panel.nz * (radius - radius * sine)
        );
      }
      slope.crossVectors(tangent, normal).normalize();
      basis.makeBasis(tangent, normal, slope);
      quaternion.setFromRotationMatrix(basis);
      position.addScaledVector(normal, -0.11);
      this.addFixedColliderQuaternion(
        position.x,
        position.y,
        position.z,
        panel.length * 0.5 * 1.04,
        0.11,
        arcLength * 0.5,
        quaternion,
        friction,
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

  createExteriorDecoration() {
    this.createTrees();
    if (!this.lowDetail) this.createSkyline();
  }

  createTrees() {
    const count = this.lowDetail ? 14 : (this.ultraHigh ? 54 : 28);
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

  createUltraHighStadiumDetails() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const steel = new THREE.MeshPhysicalMaterial({
      color: 0x354b59,
      roughness: 0.52,
      metalness: 0.72,
      clearcoat: 0.08,
      clearcoatRoughness: 0.65,
      envMapIntensity: 0.42
    });
    const beamData = [];
    for (const sign of [-1, 1]) {
      for (let i = -4; i <= 4; i++) beamData.push([i * 11.5, 13.2, sign * (FIELD_L * 0.5 + 14.8), 9.4, 0.38, 0.38]);
      for (let i = -5; i <= 5; i++) beamData.push([sign * (FIELD_W * 0.5 + 14.8), 13.2, i * 10.2, 0.38, 0.38, 8.4]);
    }
    const beams = new THREE.InstancedMesh(box, steel, beamData.length);
    const dummy = new THREE.Object3D();
    beamData.forEach(([x, y, z, w, h, d], index) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      beams.setMatrixAt(index, dummy.matrix);
    });
    beams.instanceMatrix.needsUpdate = true;
    this.group.add(beams);

    const lampMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7f5ff,
      emissive: 0xcfeeff,
      emissiveIntensity: 3.2,
      roughness: 0.18,
      metalness: 0.22,
      toneMapped: false
    });
    const lampPositions = [
      [-FIELD_W * 0.5 - 13, 16.5, -FIELD_L * 0.5 - 8], [FIELD_W * 0.5 + 13, 16.5, -FIELD_L * 0.5 - 8],
      [-FIELD_W * 0.5 - 13, 16.5, FIELD_L * 0.5 + 8], [FIELD_W * 0.5 + 13, 16.5, FIELD_L * 0.5 + 8]
    ];
    const lamps = new THREE.InstancedMesh(box, lampMaterial, lampPositions.length * 3);
    let lampIndex = 0;
    for (const [x, y, z] of lampPositions) {
      for (let offset = -1; offset <= 1; offset++) {
        dummy.position.set(x + (Math.abs(x) > Math.abs(z) ? 0 : offset * 1.5), y, z + (Math.abs(x) > Math.abs(z) ? offset * 1.5 : 0));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1.25, 0.55, 0.22);
        dummy.updateMatrix();
        lamps.setMatrixAt(lampIndex++, dummy.matrix);
      }
    }
    lamps.instanceMatrix.needsUpdate = true;
    this.group.add(lamps);
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(
      this.ultraHigh ? 0xcfe3ea : 0xd6efff,
      this.ultraHigh ? 0x4f6250 : 0x5e765c,
      this.lowDetail ? 1.85 : (this.ultraHigh ? 1.20 : 2.15)
    );
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d0, this.lowDetail ? 1.65 : (this.ultraHigh ? 2.25 : 2.35));
    if (this.ultraHigh) sun.position.set(-42, 76, -36);
    else sun.position.set(-34, 62, -28);
    sun.castShadow = this.ultraHigh;
    if (this.ultraHigh) {
      const shadowSize = this.mobile ? 2048 : 4096;
      sun.shadow.mapSize.set(shadowSize, shadowSize);
      sun.shadow.camera.left = -92;
      sun.shadow.camera.right = 92;
      sun.shadow.camera.top = 118;
      sun.shadow.camera.bottom = -118;
      sun.shadow.camera.near = 10;
      sun.shadow.camera.far = 210;
      sun.shadow.bias = -0.00018;
      sun.shadow.normalBias = 0.035;
      sun.shadow.radius = 2.2;
    }
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xaedcff, this.lowDetail ? 0.34 : (this.ultraHigh ? 0.30 : 0.52));
    fill.position.set(32, 24, 38);
    fill.castShadow = false;
    this.scene.add(fill);

    if (this.ultraHigh) {
      const warmRim = new THREE.DirectionalLight(0xffc98e, 0.12);
      warmRim.position.set(26, 18, -50);
      warmRim.castShadow = false;
      this.scene.add(warmRim);
    }
  }
}
