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
const GOAL_MOUTH_R = ARENA_TUNING.goalMouthRadius;
const CORNER_SEGMENTS = 10;
// A compact quarter-pipe plus a short solid kick-wall makes the glass begin
// much earlier than in the previous seven-metre ramp layout.
const LOWER_WALL_HEIGHT = 0.46;
const GLASS_START_Y = RAMP_R + LOWER_WALL_HEIGHT;

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


function goalPlanGeometry(sign, segments = 12) {
  const halfWidth = GOAL_W * 0.5;
  const backRadius = Math.min(GOAL_R, halfWidth - 0.1, GOAL_D - 0.1);
  const mouthRadius = Math.min(GOAL_MOUTH_R, halfWidth - 0.1, GOAL_D - 0.1);
  const shape = new THREE.Shape();

  // Local shape Y is depth into the goal. The two quarter circles at the mouth
  // exactly match the wall panels/colliders and eliminate the old rectangular
  // floor overlap at the goal line.
  shape.moveTo(-halfWidth - mouthRadius, 0);
  for (let index = 1; index <= segments; index++) {
    const angle = index / segments * Math.PI * 0.5;
    shape.lineTo(
      -halfWidth - (mouthRadius - mouthRadius * Math.sin(angle)),
      mouthRadius - mouthRadius * Math.cos(angle)
    );
  }
  shape.lineTo(-halfWidth, GOAL_D - backRadius);
  shape.absarc(-halfWidth + backRadius, GOAL_D - backRadius, backRadius, Math.PI, Math.PI * 0.5, true);
  shape.lineTo(halfWidth - backRadius, GOAL_D);
  shape.absarc(halfWidth - backRadius, GOAL_D - backRadius, backRadius, Math.PI * 0.5, 0, true);
  shape.lineTo(halfWidth, mouthRadius);
  for (let index = segments - 1; index >= 0; index--) {
    const angle = index / segments * Math.PI * 0.5;
    shape.lineTo(
      halfWidth + (mouthRadius - mouthRadius * Math.sin(angle)),
      mouthRadius - mouthRadius * Math.cos(angle)
    );
  }
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, Math.max(2, segments));
  geometry.rotateX(sign >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
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
    this.grassChunks = [];
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

  createTurfTexture(highDetail = false) {
    const canvas = document.createElement('canvas');
    canvas.width = highDetail ? 1024 : 512;
    canvas.height = highDetail ? 2048 : 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Baked mowing bands, blade speckles and subtle dry patches add most of the
    // perceived grass detail without adding geometry or another render pass.
    const stripeHeight = highDetail ? 148 : 92;
    for (let y = 0; y < canvas.height; y += stripeHeight) {
      ctx.fillStyle = Math.floor(y / stripeHeight) % 2 === 0 ? '#2a805f' : '#257456';
      ctx.fillRect(0, y, canvas.width, stripeHeight);
    }
    let seed = 0x13579bdf;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const bladeCount = highDetail ? 14500 : 4200;
    for (let i = 0; i < bladeCount; i++) {
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
    for (let i = 0; i < (highDetail ? 380 : 110); i++) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const radius = 2 + random() * 8;
      ctx.fillStyle = random() > 0.5 ? 'rgba(198,180,116,0.035)' : 'rgba(5,45,33,0.045)';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 4.8);
    texture.anisotropy = Math.min(highDetail ? 12 : 6, this.maxAnisotropy);
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

  createWallTileTexture(highDetail = false) {
    const canvas = document.createElement('canvas');
    canvas.width = highDetail ? 512 : 256;
    canvas.height = highDetail ? 512 : 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#25383c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rows = highDetail ? 12 : 8;
    const cols = highDetail ? 8 : 6;
    const rowHeight = canvas.height / rows;
    const colWidth = canvas.width / cols;

    // Baked edge darkening/highlights give the wall panels depth without a
    // normal map or extra material pass.
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : colWidth * 0.5;
      for (let column = -1; column <= cols; column++) {
        const x = column * colWidth + offset;
        const y = row * rowHeight;
        const gradient = ctx.createLinearGradient(x, y, x, y + rowHeight);
        gradient.addColorStop(0, 'rgba(102,126,127,0.16)');
        gradient.addColorStop(0.13, 'rgba(64,87,89,0.05)');
        gradient.addColorStop(1, 'rgba(4,15,18,0.18)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 2, y + 2, colWidth - 4, rowHeight - 4);
      }
    }

    ctx.lineWidth = highDetail ? 3 : 2;
    ctx.strokeStyle = 'rgba(6,15,18,0.72)';
    for (let row = 0; row <= rows; row++) {
      const y = Math.round(row * rowHeight) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : colWidth * 0.5;
      for (let column = -1; column <= cols; column++) {
        const x = Math.round(column * colWidth + offset) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, row * rowHeight);
        ctx.lineTo(x, (row + 1) * rowHeight);
        ctx.stroke();
      }
    }

    let seed = 0x791bc421;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < (highDetail ? 1500 : 420); i++) {
      const shade = 75 + Math.floor(random() * 45);
      ctx.fillStyle = `rgba(${shade},${shade + 8},${shade + 7},${0.025 + random() * 0.045})`;
      const size = 0.5 + random() * (highDetail ? 2.2 : 1.5);
      ctx.fillRect(random() * canvas.width, random() * canvas.height, size, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.anisotropy = Math.min(highDetail ? 10 : 5, this.maxAnisotropy);
    return texture;
  }

  createWallBumpTexture(highDetail = false) {
    const canvas = document.createElement('canvas');
    canvas.width = highDetail ? 512 : 256;
    canvas.height = highDetail ? 512 : 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const rows = highDetail ? 12 : 8;
    const cols = highDetail ? 8 : 6;
    const rowHeight = canvas.height / rows;
    const colWidth = canvas.width / cols;
    ctx.fillStyle = '#858585';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Raised panel faces and recessed mortar lines make the wall read as
    // physical tile/brickwork without adding any extra meshes or draw calls.
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : colWidth * 0.5;
      for (let column = -1; column <= cols; column++) {
        const x = column * colWidth + offset;
        const y = row * rowHeight;
        const gradient = ctx.createLinearGradient(x, y, x, y + rowHeight);
        gradient.addColorStop(0, '#b7b7b7');
        gradient.addColorStop(0.16, '#999999');
        gradient.addColorStop(0.82, '#888888');
        gradient.addColorStop(1, '#6e6e6e');
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 3, y + 3, colWidth - 6, rowHeight - 6);
      }
    }

    ctx.strokeStyle = '#343434';
    ctx.lineWidth = highDetail ? 5 : 4;
    for (let row = 0; row <= rows; row++) {
      const y = Math.round(row * rowHeight) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : colWidth * 0.5;
      for (let column = -1; column <= cols; column++) {
        const x = Math.round(column * colWidth + offset) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, row * rowHeight);
        ctx.lineTo(x, (row + 1) * rowHeight);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.anisotropy = Math.min(highDetail ? 8 : 4, this.maxAnisotropy);
    return texture;
  }

  createGrassTuftTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // One tiny alpha-tested card contains many painted blades. Three crossed
    // cards therefore look like a dense tuft while costing only six triangles.
    let seed = 0x6d2b79f5;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const bladeColors = ['#4f9c67', '#3f8959', '#66aa76', '#347b50', '#78b47e'];
    for (let index = 0; index < 52; index++) {
      const baseX = 10 + random() * 236;
      const baseY = 255;
      const height = 84 + random() * 158;
      const lean = (random() - 0.5) * 42;
      const controlX = baseX + lean * 0.35 + (random() - 0.5) * 9;
      const tipX = baseX + lean;
      ctx.strokeStyle = bladeColors[Math.floor(random() * bladeColors.length)];
      ctx.globalAlpha = 0.68 + random() * 0.30;
      ctx.lineWidth = 1.35 + random() * 2.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.quadraticCurveTo(controlX, baseY - height * 0.58, tipX, baseY - height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // A dark, irregular foot hides the card intersection without a visible
    // rectangular alpha fringe.
    const foot = ctx.createLinearGradient(0, 205, 0, 256);
    foot.addColorStop(0, 'rgba(35,105,67,0)');
    foot.addColorStop(1, 'rgba(31,91,59,0.75)');
    ctx.fillStyle = foot;
    for (let index = 0; index < 28; index++) {
      const x = random() * 256;
      const radius = 5 + random() * 13;
      ctx.beginPath();
      ctx.ellipse(x, 249 + random() * 7, radius, 4 + random() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, this.maxAnisotropy);
    return texture;
  }

  createUltraGrass() {
    // Dense grass is built from alpha-tested crossed cards instead of one mesh
    // per blade. This version draws substantially more visible blades than the
    // previous geometry while reducing triangle count and draw calls.
    const cardWidth = this.mobile ? 0.62 : 0.58;
    const cardHeight = this.mobile ? 0.105 : 0.118;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let card = 0; card < 4; card++) {
      const angle = card * Math.PI / 4;
      const dx = Math.cos(angle) * cardWidth * 0.5;
      const dz = Math.sin(angle) * cardWidth * 0.5;
      const base = positions.length / 3;
      positions.push(
        -dx, 0, -dz,
         dx, 0,  dz,
         dx, cardHeight,  dz,
        -dx, cardHeight, -dz
      );
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const texture = this.createGrassTuftTexture();
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: texture,
      alphaTest: 0.26,
      transparent: false,
      vertexColors: true,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    material.alphaToCoverage = true;

    // Twelve chunks keep draw calls low while still allowing Three.js frustum
    // culling and a cheap distance cutoff on mobile hardware.
    const chunksX = 3;
    const chunksZ = 4;
    const patchesPerChunk = this.mobile ? 320 : 900;
    const halfW = FIELD_W * 0.5 - 0.48;
    const halfL = FIELD_L * 0.5 - 0.48;
    const corner = Math.max(0.1, CORNER_R - 0.48);
    const chunkWidth = halfW * 2 / chunksX;
    const chunkLength = halfL * 2 / chunksZ;
    const instancePalette = [
      new THREE.Color(0xa9d2ae),
      new THREE.Color(0x9bc7a2),
      new THREE.Color(0xb7d9b8),
      new THREE.Color(0x8fbc98)
    ];
    const insideField = (x, z) => {
      const ax = Math.abs(x);
      const az = Math.abs(z);
      if (ax > halfW || az > halfL) return false;
      if (ax <= halfW - corner || az <= halfL - corner) return true;
      const dx = ax - (halfW - corner);
      const dz = az - (halfL - corner);
      return dx * dx + dz * dz <= corner * corner;
    };
    const dummy = new THREE.Object3D();
    let seed = 0x52a4f19d;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let chunkZ = 0; chunkZ < chunksZ; chunkZ++) {
      for (let chunkX = 0; chunkX < chunksX; chunkX++) {
        const minX = -halfW + chunkX * chunkWidth;
        const minZ = -halfL + chunkZ * chunkLength;
        const centerX = minX + chunkWidth * 0.5;
        const centerZ = minZ + chunkLength * 0.5;
        const grass = new THREE.InstancedMesh(geometry, material, patchesPerChunk);
        grass.name = `ultra-high-3d-grass-${chunkX}-${chunkZ}`;
        grass.userData.grassBlades = true;
        grass.userData.cameraOcclusionIgnore = true;
        grass.userData.grassCenter = new THREE.Vector3(centerX, 0, centerZ);
        grass.userData.grassCullDistance = this.mobile ? 68 : 104;
        grass.castShadow = false;
        grass.receiveShadow = false;
        grass.frustumCulled = true;

        let placed = 0;
        let attempts = 0;
        while (placed < patchesPerChunk && attempts < patchesPerChunk * 10) {
          attempts += 1;
          const x = minX + random() * chunkWidth;
          const z = minZ + random() * chunkLength;
          if (!insideField(x, z)) continue;

          // Preserve the centre line, centre spot and circle. The cards are
          // wider than their origin, so use a generous margin around markings.
          const centreRadius = Math.hypot(x, z);
          if (Math.abs(z) < 0.30 || centreRadius < 0.62 || (centreRadius > 10.15 && centreRadius < 10.92)) continue;

          const scale = 0.82 + random() * 0.35;
          dummy.position.set(x, 0.006, z);
          dummy.rotation.set(0, random() * Math.PI * 2, 0);
          dummy.scale.set(scale, 0.88 + random() * 0.26, scale);
          dummy.updateMatrix();
          grass.setMatrixAt(placed, dummy.matrix);
          grass.setColorAt(placed, instancePalette[Math.floor(random() * instancePalette.length)]);
          placed += 1;
        }

        grass.count = placed;
        grass.instanceMatrix.needsUpdate = true;
        if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
        grass.computeBoundingBox?.();
        grass.computeBoundingSphere?.();
        this.group.add(grass);
        this.grassChunks.push(grass);
      }
    }
  }

  createField() {
    const turfTexture = this.lowDetail ? null : this.createTurfTexture(this.ultraHigh);
    const turfBump = this.ultraHigh ? this.createUltraTurfBumpTexture() : null;
    const turfMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x2b8767 })
      : (this.ultraHigh
        ? new THREE.MeshStandardMaterial({
            color: 0xc7dfcb,
            map: turfTexture,
            bumpMap: turfBump,
            bumpScale: 0.048,
            roughness: 0.98,
            metalness: 0.0
          })
        : new THREE.MeshStandardMaterial({
            color: 0xe7f3e8,
            map: turfTexture,
            roughness: 0.97,
            metalness: 0.0
          }));
    const turf = new THREE.Mesh(
      roundedRectGeometry(FIELD_W, FIELD_L, CORNER_R, this.lowDetail ? 4 : 12),
      turfMat
    );
    turf.name = 'arena-turf';
    turf.userData.shadowRole = 'field';
    this.group.add(turf);
    if (this.ultraHigh) this.createUltraGrass();

    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xd7fbff, transparent: true, opacity: 0.72 });
    const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W - 2, 0.14), lineMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.012;
    this.group.add(centerLine);

    const circle = new THREE.Mesh(new THREE.RingGeometry(10.5, 10.68, this.lowDetail ? 24 : 56), lineMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.014;
    this.group.add(circle);

    const centerDot = new THREE.Mesh(new THREE.CircleGeometry(0.38, this.lowDetail ? 8 : 20), lineMaterial);
    centerDot.rotation.x = -Math.PI / 2;
    centerDot.position.y = 0.016;
    this.group.add(centerDot);

    const glassMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({
          color: 0x91d9e9,
          transparent: true,
          opacity: 0.085,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      : new THREE.MeshStandardMaterial({
          color: this.ultraHigh ? 0xaedbe4 : 0xa4dce8,
          transparent: true,
          opacity: this.ultraHigh ? 0.095 : 0.115,
          roughness: this.ultraHigh ? 0.48 : 0.40,
          metalness: this.ultraHigh ? 0.015 : 0.0,
          depthWrite: false,
          side: THREE.DoubleSide
        });
    const frameMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x294650 })
      : new THREE.MeshStandardMaterial({
          color: this.ultraHigh ? 0x293a43 : 0x304650,
          emissive: this.ultraHigh ? 0x082c36 : 0x0d4150,
          emissiveIntensity: this.ultraHigh ? 0.30 : 0.48,
          roughness: this.ultraHigh ? 0.67 : 0.58,
          metalness: this.ultraHigh ? 0.46 : 0.42
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

    const roundedOpeningHalfWidth = goalHalfWidth + GOAL_MOUTH_R;
    const endSegmentLength = straightX - roundedOpeningHalfWidth;
    const endSegmentCenter = roundedOpeningHalfWidth + endSegmentLength * 0.5;
    for (const signZ of [-1, 1]) {
      const z = signZ * (halfLength + WALL_T * 0.5);
      panels.push(
        { x: -endSegmentCenter, z, length: endSegmentLength, yaw: 0, nx: 0, nz: signZ, minY: RAMP_R },
        { x: endSegmentCenter, z, length: endSegmentLength, yaw: 0, nx: 0, nz: signZ, minY: RAMP_R },
        {
          x: 0,
          z,
          length: GOAL_W + GOAL_MOUTH_R * 2,
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
    const cornerLength = 2 * panelRadius * Math.sin(delta * 0.5) * 1.025;
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

    // Straight tunnel walls begin only after the horizontal mouth fillet.
    const sideLength = Math.max(0.2, straightDepth - GOAL_MOUTH_R);
    for (const signX of [-1, 1]) {
      panels.push({
        x: signX * (halfWidth + WALL_T * 0.5),
        z: signZ * (halfLength + GOAL_MOUTH_R + sideLength * 0.5),
        length: sideLength,
        yaw: signX > 0 ? Math.PI / 2 : -Math.PI / 2,
        nx: signX,
        nz: 0,
        goalSide: true
      });
    }

    panels.push({
      x: 0,
      z: signZ * (halfLength + GOAL_D + WALL_T * 0.5),
      length: straightX * 2,
      yaw: signZ > 0 ? 0 : Math.PI,
      nx: 0,
      nz: signZ,
      goalBack: true
    });

    // Quarter-circle fillets join the arena end wall to each goal side wall.
    const mouthSegments = Math.max(8, Math.round(RAMP_SEGMENTS * 0.6));
    const mouthDelta = Math.PI * 0.5 / mouthSegments;
    const mouthCentrelineRadius = Math.max(0.2, GOAL_MOUTH_R - WALL_T * 0.5);
    const mouthPanelLength = 2 * mouthCentrelineRadius * Math.sin(mouthDelta * 0.5) * 1.035;
    for (const signX of [-1, 1]) {
      for (let index = 0; index < mouthSegments; index++) {
        const angle = (index + 0.5) * mouthDelta;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        const u = GOAL_MOUTH_R - GOAL_MOUTH_R * sine;
        const v = GOAL_MOUTH_R - GOAL_MOUTH_R * cosine;
        const nx = signX * sine;
        const nz = signZ * cosine;
        const innerX = signX * (halfWidth + u);
        const innerZ = signZ * (halfLength + v);
        panels.push({
          x: innerX + nx * WALL_T * 0.5,
          z: innerZ + nz * WALL_T * 0.5,
          length: mouthPanelLength,
          yaw: Math.atan2(nx, nz),
          nx,
          nz,
          goalMouth: true
        });
      }
    }

    const cornerSegments = Math.max(8, Math.round(RAMP_SEGMENTS * 0.65));
    const delta = Math.PI * 0.5 / cornerSegments;
    const panelRadius = GOAL_R + WALL_T * 0.5;
    const cornerLength = 2 * panelRadius * Math.sin(delta * 0.5) * 1.03;
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
          nz,
          goalBackCorner: true
        });
      }
    }
    return panels;
  }

  panelGlassMinY(panel) {
    const minY = panel.minY ?? 0;
    return panel.ramp === false ? minY : Math.max(minY, GLASS_START_Y);
  }

  createPanelSurfaceMesh(panels, material, options = {}) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const tileWidth = Math.max(0.2, Number(options.tileWidth) || 3.0);
    const tileHeight = Math.max(0.2, Number(options.tileHeight) || 1.25);
    const surfaceOffset = Number(options.surfaceOffset) || 0.004;
    const minYFor = typeof options.minY === 'function'
      ? options.minY
      : (panel) => options.minY ?? panel.minY ?? 0;
    const maxYFor = typeof options.maxY === 'function'
      ? options.maxY
      : (panel) => options.maxY ?? panel.maxY ?? WALL_H;

    for (const panel of panels) {
      const minY = minYFor(panel);
      const maxY = maxYFor(panel);
      const height = Math.max(0.01, maxY - minY);
      const length = Math.max(0.01, panel.length * (options.lengthScale ?? 1.0));
      const tangentX = Math.cos(panel.yaw);
      const tangentZ = -Math.sin(panel.yaw);
      const inwardX = -panel.nx;
      const inwardZ = -panel.nz;
      const surfaceX = panel.x - panel.nx * (WALL_T * 0.5 + surfaceOffset);
      const surfaceZ = panel.z - panel.nz * (WALL_T * 0.5 + surfaceOffset);
      const halfLength = length * 0.5;
      const leftX = surfaceX - tangentX * halfLength;
      const leftZ = surfaceZ - tangentZ * halfLength;
      const rightX = surfaceX + tangentX * halfLength;
      const rightZ = surfaceZ + tangentZ * halfLength;
      const base = positions.length / 3;

      positions.push(
        leftX, minY, leftZ,
        rightX, minY, rightZ,
        rightX, maxY, rightZ,
        leftX, maxY, leftZ
      );
      for (let vertex = 0; vertex < 4; vertex++) normals.push(inwardX, 0, inwardZ);
      const u = length / tileWidth;
      const v = height / tileHeight;
      uvs.push(0, 0, u, 0, u, v, 0, v);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = options.name || 'arena-panel-surface';
    mesh.renderOrder = options.renderOrder || 0;
    if (options.shadowRole) mesh.userData.shadowRole = options.shadowRole;
    this.group.add(mesh);
    return mesh;
  }

  createRoundedRampSurfaceMesh(panels, radius, ceilingY, upper, material, options = {}) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const delta = Math.PI * 0.5 / RAMP_SEGMENTS;
    const tileWidth = Math.max(0.2, Number(options.tileWidth) || 3.0);
    const tileHeight = Math.max(0.2, Number(options.tileHeight) || 0.95);
    const surfaceOffset = Number(options.surfaceOffset) || 0.006;

    for (const panel of panels) {
      const boundaryX = panel.x - panel.nx * WALL_T * 0.5;
      const boundaryZ = panel.z - panel.nz * WALL_T * 0.5;
      const tangentX = panel.nz;
      const tangentZ = -panel.nx;
      const length = panel.length * (options.lengthScale ?? 1.025);
      const halfLength = length * 0.5;
      const firstVertex = positions.length / 3;

      for (let step = 0; step <= RAMP_SEGMENTS; step++) {
        const angle = step * delta;
        const sine = Math.sin(angle);
        const cosine = Math.cos(angle);
        let normalX;
        let normalY;
        let normalZ;
        let centerX;
        let centerY;
        let centerZ;
        if (upper) {
          normalX = -panel.nx * cosine;
          normalY = -sine;
          normalZ = -panel.nz * cosine;
          centerX = boundaryX - panel.nx * (radius - radius * cosine);
          centerY = ceilingY - radius + radius * sine;
          centerZ = boundaryZ - panel.nz * (radius - radius * cosine);
        } else {
          normalX = -panel.nx * sine;
          normalY = cosine;
          normalZ = -panel.nz * sine;
          centerX = boundaryX - panel.nx * (radius - radius * sine);
          centerY = radius - radius * cosine;
          centerZ = boundaryZ - panel.nz * (radius - radius * sine);
        }
        centerX += normalX * surfaceOffset;
        centerY += normalY * surfaceOffset;
        centerZ += normalZ * surfaceOffset;

        positions.push(
          centerX - tangentX * halfLength, centerY, centerZ - tangentZ * halfLength,
          centerX + tangentX * halfLength, centerY, centerZ + tangentZ * halfLength
        );
        normals.push(normalX, normalY, normalZ, normalX, normalY, normalZ);
        const v = radius * angle / tileHeight;
        const u = length / tileWidth;
        uvs.push(0, v, u, v);
      }

      for (let step = 0; step < RAMP_SEGMENTS; step++) {
        const row = firstVertex + step * 2;
        const next = row + 2;
        indices.push(row, next + 1, row + 1, row, next, next + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = options.name || (upper ? 'arena-upper-ramp-surface' : 'arena-lower-ramp-surface');
    mesh.renderOrder = options.renderOrder || 0;
    if (options.shadowRole) mesh.userData.shadowRole = options.shadowRole;
    this.group.add(mesh);
    return mesh;
  }

  createLowerWallPanels(panels) {
    const lowerPanels = panels.filter(
      (panel) => panel.ramp !== false
        && this.panelGlassMinY(panel) > (panel.minY ?? 0) + 0.05
    );
    if (lowerPanels.length === 0) return;

    const wallTexture = this.lowDetail
      ? null
      : (this.wallTileTexture ??= this.createWallTileTexture(this.ultraHigh));
    const wallBump = this.ultraHigh
      ? (this.wallBumpTexture ??= this.createWallBumpTexture(true))
      : null;
    const material = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x253f43, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({
          color: this.ultraHigh ? 0xc8d2ce : 0xbdcbc7,
          map: wallTexture,
          bumpMap: wallBump,
          bumpScale: this.ultraHigh ? 0.075 : 0,
          roughness: 0.98,
          metalness: 0.01,
          side: THREE.DoubleSide
        });

    this.createPanelSurfaceMesh(lowerPanels, material, {
      minY: (panel) => panel.minY ?? 0,
      maxY: (panel) => this.panelGlassMinY(panel),
      lengthScale: 1.018,
      tileWidth: 2.8,
      tileHeight: 0.72,
      name: 'arena-tiled-kick-wall',
      shadowRole: 'arena-surface'
    });
  }

  createWallFrameGrid(panels, frameMaterial) {
    if (this.lowDetail) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    let frameCount = 0;
    for (const panel of panels) {
      const minY = this.panelGlassMinY(panel);
      const maxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
      const height = panel.height ?? Math.max(0.2, maxY - minY);
      if (height < 0.8) continue;
      frameCount += Math.max(0, Math.floor(panel.length / 7.0));
      frameCount += Math.max(0, Math.floor(height / 4.25));
    }

    const gridMaterial = frameMaterial.clone();
    gridMaterial.transparent = false;
    gridMaterial.opacity = 1;
    if ('emissiveIntensity' in gridMaterial) gridMaterial.emissiveIntensity *= 0.24;
    const frames = new THREE.InstancedMesh(geometry, gridMaterial, frameCount);
    frames.name = 'arena-glass-grid';
    frames.userData.shadowRole = 'arena-frame';
    const dummy = new THREE.Object3D();
    let index = 0;
    for (const panel of panels) {
      const minY = this.panelGlassMinY(panel);
      const maxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
      const height = panel.height ?? Math.max(0.2, maxY - minY);
      if (height < 0.8) continue;
      const tx = Math.cos(panel.yaw);
      const tz = -Math.sin(panel.yaw);
      const surfaceX = panel.x - panel.nx * (WALL_T * 0.5 + 0.012);
      const surfaceZ = panel.z - panel.nz * (WALL_T * 0.5 + 0.012);
      const verticalCount = Math.max(0, Math.floor(panel.length / 7.0));
      for (let column = 1; column <= verticalCount; column++) {
        const offset = -panel.length * 0.5 + panel.length * column / (verticalCount + 1);
        dummy.position.set(surfaceX + tx * offset, minY + height * 0.5, surfaceZ + tz * offset);
        dummy.rotation.set(0, panel.yaw, 0);
        dummy.scale.set(0.11, height, 0.14);
        dummy.updateMatrix();
        frames.setMatrixAt(index++, dummy.matrix);
      }
      const rowCount = Math.max(0, Math.floor(height / 4.25));
      for (let row = 1; row <= rowCount; row++) {
        dummy.position.set(surfaceX, minY + height * row / (rowCount + 1), surfaceZ);
        dummy.rotation.set(0, panel.yaw, 0);
        dummy.scale.set(panel.length * 1.014, 0.10, 0.14);
        dummy.updateMatrix();
        frames.setMatrixAt(index++, dummy.matrix);
      }
    }
    frames.count = index;
    frames.instanceMatrix.needsUpdate = true;
    this.group.add(frames);

    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x4fb3c9,
      emissive: 0x124e60,
      emissiveIntensity: this.ultraHigh ? 0.42 : 0.70,
      roughness: 0.64,
      metalness: 0.24
    });
    const accents = new THREE.InstancedMesh(geometry, accentMaterial, panels.length);
    accents.name = 'arena-lower-accent';
    accents.userData.shadowRole = 'arena-frame';
    for (let panelIndex = 0; panelIndex < panels.length; panelIndex++) {
      const panel = panels[panelIndex];
      const minY = this.panelGlassMinY(panel);
      const surfaceX = panel.x - panel.nx * (WALL_T * 0.5 + 0.014);
      const surfaceZ = panel.z - panel.nz * (WALL_T * 0.5 + 0.014);
      dummy.position.set(surfaceX, minY + 0.14, surfaceZ);
      dummy.rotation.set(0, panel.yaw, 0);
      dummy.scale.set(panel.length * 1.018, 0.065, 0.18);
      dummy.updateMatrix();
      accents.setMatrixAt(panelIndex, dummy.matrix);
    }
    accents.instanceMatrix.needsUpdate = true;
    this.group.add(accents);
  }

  createGlassEnclosure(glassMaterial, frameMaterial) {
    const panels = this.buildBoundarySegments();
    this.createWallRamps(panels);
    this.createLowerWallPanels(panels);
    this.createCeilingRamps(panels, glassMaterial);

    // Only the playable glass face is rendered. This cuts transparent overdraw
    // by roughly six times compared with one scaled cube per panel.
    this.createPanelSurfaceMesh(panels, glassMaterial, {
      minY: (panel) => this.panelGlassMinY(panel),
      maxY: (panel) => {
        const minY = this.panelGlassMinY(panel);
        const naturalMaxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
        return panel.height ? minY + panel.height : Math.max(minY + 0.2, naturalMaxY);
      },
      lengthScale: 1.006,
      name: 'arena-glass-panels',
      renderOrder: 2,
      shadowRole: 'glass'
    });

    const panelGeometry = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    const rails = new THREE.InstancedMesh(panelGeometry, frameMaterial, panels.length * 2);
    let railIndex = 0;
    for (const panel of panels) {
      const minY = this.panelGlassMinY(panel);
      const maxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
      const height = panel.height ?? Math.max(0.2, maxY - minY);
      const centerY = minY + height * 0.5;
      const surfaceX = panel.x - panel.nx * (WALL_T * 0.5 + 0.01);
      const surfaceZ = panel.z - panel.nz * (WALL_T * 0.5 + 0.01);
      for (const y of [minY + 0.13, centerY + height * 0.5 - 0.13]) {
        dummy.position.set(surfaceX, y, surfaceZ);
        dummy.rotation.set(0, panel.yaw, 0);
        dummy.scale.set(panel.length * 1.008, 0.21, 0.14);
        dummy.updateMatrix();
        rails.setMatrixAt(railIndex++, dummy.matrix);
      }
    }
    rails.instanceMatrix.needsUpdate = true;
    rails.name = 'arena-boundary-rails';
    rails.userData.shadowRole = 'arena-frame';
    this.group.add(rails);

    this.createWallFrameGrid(panels, frameMaterial);

    const straightX = FIELD_W * 0.5 - CORNER_R;
    const straightZ = FIELD_L * 0.5 - CORNER_R;
    const halfWidth = FIELD_W * 0.5;
    const halfLength = FIELD_L * 0.5;
    const goalHalf = GOAL_W * 0.5 + GOAL_MOUTH_R;
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
      dummy.scale.set(0.25, supportHeight, 0.25);
      dummy.updateMatrix();
      supports.setMatrixAt(index, dummy.matrix);
    }
    supports.instanceMatrix.needsUpdate = true;
    supports.name = 'arena-main-supports';
    supports.userData.shadowRole = 'arena-frame';
    this.group.add(supports);

    const roofMaterial = glassMaterial.clone();
    roofMaterial.opacity = this.lowDetail ? 0.04 : 0.065;
    roofMaterial.depthWrite = false;
    const roof = new THREE.Mesh(
      roundedRectGeometry(
        FIELD_W - CEILING_R * 2,
        FIELD_L - CEILING_R * 2,
        Math.max(1, CORNER_R - CEILING_R),
        this.lowDetail ? 4 : 12
      ),
      roofMaterial
    );
    roof.position.y = ARENA_TUNING.ceiling;
    roof.renderOrder = 1;
    roof.name = 'arena-glass-roof';
    roof.userData.shadowRole = 'glass';
    this.group.add(roof);
  }

  createWallRamps(panels) {
    const rampPanels = panels.filter((panel) => panel.ramp !== false);
    const wallTexture = this.lowDetail
      ? null
      : (this.wallTileTexture ??= this.createWallTileTexture(this.ultraHigh));
    const wallBump = this.ultraHigh
      ? (this.wallBumpTexture ??= this.createWallBumpTexture(true))
      : null;
    const material = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x31575a, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({
          color: this.ultraHigh ? 0xd9e0dd : 0xd2dcda,
          map: wallTexture,
          bumpMap: wallBump,
          bumpScale: this.ultraHigh ? 0.075 : 0,
          roughness: 0.98,
          metalness: 0.01,
          side: THREE.DoubleSide
        });

    this.createRoundedRampSurfaceMesh(rampPanels, RAMP_R, RAMP_R, false, material, {
      tileWidth: 2.8,
      tileHeight: 0.72,
      lengthScale: 1.028,
      name: 'arena-lower-quarter-pipe',
      shadowRole: 'arena-surface'
    });
  }

  createCeilingRamps(panels, glassMaterial) {
    const upperPanels = panels.filter((panel) => panel.upperRamp !== false);
    const material = glassMaterial.clone();
    material.opacity = this.lowDetail ? 0.06 : 0.09;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    this.createRoundedRampSurfaceMesh(
      upperPanels,
      CEILING_R,
      ARENA_TUNING.ceiling,
      true,
      material,
      {
        lengthScale: 1.028,
        name: 'arena-upper-glass-ramp',
        renderOrder: 1,
        shadowRole: 'glass'
      }
    );
  }

  createRoundedTunnelRampVisual(panels, radius, ceilingY, upper, material) {
    material.side = THREE.DoubleSide;
    return this.createRoundedRampSurfaceMesh(panels, radius, ceilingY, upper, material, {
      tileWidth: 2.8,
      tileHeight: 0.72,
      lengthScale: 1.032,
      name: upper ? 'goal-upper-rounded-surface' : 'goal-lower-rounded-surface',
      renderOrder: upper ? 1 : 0,
      shadowRole: 'arena-surface'
    });
  }

  createGoalWallGrid(panels, teamColor) {
    if (this.lowDetail) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const wallHeight = Math.max(0.4, GOAL_H - GOAL_R * 2);
    let count = panels.length;
    for (const panel of panels) count += Math.max(0, Math.floor(panel.length / 4.0));

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x263238,
      emissive: teamColor,
      emissiveIntensity: this.ultraHigh ? 0.09 : 0.13,
      roughness: 0.70,
      metalness: 0.38
    });
    const frames = new THREE.InstancedMesh(geometry, frameMaterial, count);
    frames.name = 'goal-tunnel-grid';
    frames.userData.shadowRole = 'arena-frame';
    const dummy = new THREE.Object3D();
    let instance = 0;
    for (const panel of panels) {
      const tx = Math.cos(panel.yaw);
      const tz = -Math.sin(panel.yaw);
      const surfaceX = panel.x - panel.nx * (WALL_T * 0.5 + 0.014);
      const surfaceZ = panel.z - panel.nz * (WALL_T * 0.5 + 0.014);
      const columns = Math.max(0, Math.floor(panel.length / 4.0));
      for (let column = 1; column <= columns; column++) {
        const offset = -panel.length * 0.5 + panel.length * column / (columns + 1);
        dummy.position.set(surfaceX + tx * offset, GOAL_R + wallHeight * 0.5, surfaceZ + tz * offset);
        dummy.rotation.set(0, panel.yaw, 0);
        dummy.scale.set(0.095, wallHeight, 0.13);
        dummy.updateMatrix();
        frames.setMatrixAt(instance++, dummy.matrix);
      }
      dummy.position.set(surfaceX, GOAL_R + wallHeight * 0.54, surfaceZ);
      dummy.rotation.set(0, panel.yaw, 0);
      dummy.scale.set(panel.length * 1.014, 0.085, 0.13);
      dummy.updateMatrix();
      frames.setMatrixAt(instance++, dummy.matrix);
    }
    frames.count = instance;
    frames.instanceMatrix.needsUpdate = true;
    this.group.add(frames);

    const accentMaterial = new THREE.MeshStandardMaterial({
      color: teamColor,
      emissive: teamColor,
      emissiveIntensity: this.ultraHigh ? 0.72 : 1.05,
      roughness: 0.60,
      metalness: 0.24
    });
    const accents = new THREE.InstancedMesh(geometry, accentMaterial, panels.length * 2);
    accents.name = 'goal-tunnel-accents';
    accents.userData.shadowRole = 'arena-frame';
    instance = 0;
    for (const panel of panels) {
      const surfaceX = panel.x - panel.nx * (WALL_T * 0.5 + 0.018);
      const surfaceZ = panel.z - panel.nz * (WALL_T * 0.5 + 0.018);
      for (const y of [Math.min(GOAL_H - GOAL_R - 0.35, GLASS_START_Y + 0.14), GOAL_H - GOAL_R - 0.10]) {
        dummy.position.set(surfaceX, y, surfaceZ);
        dummy.rotation.set(0, panel.yaw, 0);
        dummy.scale.set(panel.length * 1.018, 0.065, 0.15);
        dummy.updateMatrix();
        accents.setMatrixAt(instance++, dummy.matrix);
      }
    }
    accents.instanceMatrix.needsUpdate = true;
    this.group.add(accents);
  }

  createRoundedGoalFrame(sign, color) {
    if (this.lowDetail) return;
    const halfLength = FIELD_L * 0.5;
    const z = sign * (halfLength + GOAL_MOUTH_R + 0.025);
    const halfWidth = GOAL_W * 0.5;
    const radius = Math.min(GOAL_R, halfWidth - 0.2, GOAL_H * 0.5 - 0.2);
    const straightX = halfWidth - radius;
    const topY = GOAL_H;
    const upperStraightY = topY - radius;
    const path = new THREE.CurvePath();

    // The goal rim follows the same floor/side/ceiling radii as the physical
    // tunnel. Unlike the old rectangular posts it never cuts through the
    // rounded driving surface at the four corners.
    path.add(new THREE.LineCurve3(
      new THREE.Vector3(-straightX, 0.10, z),
      new THREE.Vector3(straightX, 0.10, z)
    ));
    path.add(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(straightX, 0.10, z),
      new THREE.Vector3(halfWidth, 0.10, z),
      new THREE.Vector3(halfWidth, radius, z)
    ));
    path.add(new THREE.LineCurve3(
      new THREE.Vector3(halfWidth, radius, z),
      new THREE.Vector3(halfWidth, upperStraightY, z)
    ));
    path.add(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(halfWidth, upperStraightY, z),
      new THREE.Vector3(halfWidth, topY, z),
      new THREE.Vector3(straightX, topY, z)
    ));
    path.add(new THREE.LineCurve3(
      new THREE.Vector3(straightX, topY, z),
      new THREE.Vector3(-straightX, topY, z)
    ));
    path.add(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-straightX, topY, z),
      new THREE.Vector3(-halfWidth, topY, z),
      new THREE.Vector3(-halfWidth, upperStraightY, z)
    ));
    path.add(new THREE.LineCurve3(
      new THREE.Vector3(-halfWidth, upperStraightY, z),
      new THREE.Vector3(-halfWidth, radius, z)
    ));
    path.add(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-halfWidth, radius, z),
      new THREE.Vector3(-halfWidth, 0.10, z),
      new THREE.Vector3(-straightX, 0.10, z)
    ));

    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: this.ultraHigh ? 0.58 : 0.82,
      roughness: 0.72,
      metalness: 0.22
    });
    const frame = new THREE.Mesh(
      new THREE.TubeGeometry(path, this.ultraHigh ? 82 : 58, 0.18, this.ultraHigh ? 8 : 6, true),
      material
    );
    frame.name = 'rounded-goal-mouth-frame';
    frame.userData.shadowRole = 'arena-frame';
    this.group.add(frame);
  }

  createGoalMouthFloorAccents(sign, color) {
    if (this.lowDetail) return;
    const signZ = sign >= 0 ? 1 : -1;
    const halfLength = FIELD_L * 0.5;
    const halfWidth = GOAL_W * 0.5;
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: this.ultraHigh ? 0.36 : 0.58,
      roughness: 0.74,
      metalness: 0.16
    });

    // A restrained team-coloured strip follows the exact horizontal mouth
    // fillet. Besides matching the Rocket-League-like visual language, it
    // makes the field-wall/goal-tunnel hand-off read as one intentional curve.
    for (const signX of [-1, 1]) {
      const points = [];
      const segments = this.ultraHigh ? 18 : 12;
      for (let index = 0; index <= segments; index++) {
        const angle = index / segments * Math.PI * 0.5;
        const u = GOAL_MOUTH_R - GOAL_MOUTH_R * Math.sin(angle);
        const v = GOAL_MOUTH_R - GOAL_MOUTH_R * Math.cos(angle);
        points.push(new THREE.Vector3(
          signX * (halfWidth + u),
          0.052,
          signZ * (halfLength + v)
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      const accent = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments * 2, 0.055, this.ultraHigh ? 7 : 5, false),
        material
      );
      accent.name = 'goal-mouth-floor-accent';
      accent.userData.shadowRole = 'arena-frame';
      this.group.add(accent);
    }
  }


  createGoalTunnel(sign, wallMaterial, floorMaterial, teamColor) {
    const panels = this.buildGoalBoundarySegments(sign);
    const wallHeight = Math.max(0.4, GOAL_H - GOAL_R * 2);

    // A single continuous inner face replaces the old row of scaled cubes.
    // Its UVs follow every mouth/back fillet so the tile pattern and silhouette
    // remain visually connected from the field wall into the tunnel.
    this.createPanelSurfaceMesh(panels, wallMaterial, {
      minY: GOAL_R,
      maxY: GOAL_R + wallHeight,
      lengthScale: 1.035,
      tileWidth: 2.8,
      tileHeight: 0.72,
      name: 'goal-tunnel-tiled-walls',
      shadowRole: 'arena-surface'
    });

    const lowerMaterial = wallMaterial.clone();
    const upperMaterial = wallMaterial.clone();
    lowerMaterial.side = THREE.DoubleSide;
    upperMaterial.side = THREE.DoubleSide;
    this.createRoundedTunnelRampVisual(panels, GOAL_R, GOAL_H, false, lowerMaterial);
    this.createRoundedTunnelRampVisual(panels, GOAL_R, GOAL_H, true, upperMaterial);
    this.createGoalWallGrid(panels, teamColor);

    const halfLength = FIELD_L * 0.5;
    const signZ = sign >= 0 ? 1 : -1;
    const goalFloorMaterial = floorMaterial.clone();
    goalFloorMaterial.side = THREE.DoubleSide;
    const floor = new THREE.Mesh(goalPlanGeometry(signZ, this.ultraHigh ? 18 : 12), goalFloorMaterial);
    floor.position.set(0, 0.006, signZ * halfLength);
    floor.name = 'rounded-goal-floor';
    floor.userData.shadowRole = 'arena-surface';
    this.group.add(floor);

    // Keep the flat roof away from the side/back quarter-pipes. This leaves the
    // rounded surfaces as the only visible and physical transition normals.
    const roofWidth = Math.max(1, GOAL_W - GOAL_R * 2);
    const roofDepth = Math.max(0.8, GOAL_D - GOAL_MOUTH_R - GOAL_R);
    const roofMaterial = floorMaterial.clone();
    roofMaterial.side = THREE.DoubleSide;
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(roofWidth, roofDepth), roofMaterial);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(
      0,
      GOAL_H,
      signZ * (halfLength + GOAL_MOUTH_R + roofDepth * 0.5)
    );
    roof.name = 'rounded-goal-roof';
    roof.userData.shadowRole = 'arena-surface';
    this.group.add(roof);
  }

  addBoxVisual(x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }

  createGoal(sign) {
    const signZ = sign >= 0 ? 1 : -1;
    const zThroat = signZ * (FIELD_L * 0.5 + GOAL_MOUTH_R);
    const isOrange = signZ > 0;
    const color = isOrange ? 0xff7a18 : 0x238cff;
    const darkColor = isOrange ? 0x352b25 : 0x26323d;
    const teamName = isOrange ? 'ORANGE' : 'BLAU';
    const wallTexture = this.lowDetail
      ? null
      : (this.wallTileTexture ??= this.createWallTileTexture(this.ultraHigh));
    const wallBump = this.ultraHigh
      ? (this.wallBumpTexture ??= this.createWallBumpTexture(true))
      : null;
    const wallMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: darkColor, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({
          color: this.ultraHigh ? 0xcbd3cf : 0xbfcac6,
          map: wallTexture,
          bumpMap: wallBump,
          bumpScale: this.ultraHigh ? 0.075 : 0,
          emissive: color,
          emissiveIntensity: this.ultraHigh ? 0.025 : 0.045,
          roughness: 0.98,
          metalness: 0.01,
          side: THREE.DoubleSide
        });

    if (this.lowDetail) {
      const half = GOAL_W / 2;
      const points = [
        -half, 0, zThroat, -half, GOAL_H, zThroat,
         half, 0, zThroat,  half, GOAL_H, zThroat,
        -half, GOAL_H, zThroat, half, GOAL_H, zThroat
      ];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const goalLine = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
      this.group.add(goalLine);
    } else {
      this.createRoundedGoalFrame(signZ, color);
      this.createGoalMouthFloorAccents(signZ, color);
    }

    const floorTexture = wallTexture?.clone() ?? null;
    if (floorTexture) {
      floorTexture.wrapS = THREE.RepeatWrapping;
      floorTexture.wrapT = THREE.RepeatWrapping;
      floorTexture.repeat.set(5.4, 4.2);
      floorTexture.needsUpdate = true;
    }
    const floorBump = wallBump?.clone() ?? null;
    if (floorBump) {
      floorBump.wrapS = THREE.RepeatWrapping;
      floorBump.wrapT = THREE.RepeatWrapping;
      floorBump.repeat.set(5.4, 4.2);
      floorBump.needsUpdate = true;
    }
    const goalFloorMat = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: darkColor, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({
          color: isOrange ? 0x99a59c : 0x929fa7,
          map: floorTexture,
          bumpMap: floorBump,
          bumpScale: this.ultraHigh ? 0.052 : 0,
          emissive: color,
          emissiveIntensity: this.ultraHigh ? 0.018 : 0.032,
          roughness: 0.99,
          metalness: 0.0,
          side: THREE.DoubleSide
        });
    this.createGoalTunnel(signZ, wallMaterial, goalFloorMat, color);

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
      label.position.set(0, GOAL_H + 1.7, zThroat - signZ * 0.08);
      label.rotation.y = signZ > 0 ? Math.PI : 0;
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

      // Cover the widened, rounded mouth as well as the rectangular tunnel.
      // The collider overlaps the field floor slightly, removing the narrow
      // seam that could let the ball dip below the surface at oblique angles.
      this.addFixedCollider(
        0,
        -0.2,
        signZ * (halfLength + GOAL_MOUTH_R * 0.5),
        GOAL_W * 0.5 + GOAL_MOUTH_R + 0.12,
        0.2,
        GOAL_MOUTH_R * 0.5 + 0.12,
        0.72,
        0
      );

      // The flat ceiling starts behind the mouth fillet and ends before the
      // back-wall radius, so all perimeter transitions remain rounded.
      const roofDepth = Math.max(0.8, GOAL_D - GOAL_MOUTH_R - GOAL_R);
      this.addFixedCollider(
        0,
        GOAL_H + 0.2,
        signZ * (halfLength + GOAL_MOUTH_R + roofDepth * 0.5),
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
    const steel = new THREE.MeshStandardMaterial({
      color: 0x354850,
      roughness: 0.76,
      metalness: 0.38
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
      emissiveIntensity: 1.75,
      roughness: 0.48,
      metalness: 0.14,
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

  updateVisuals(camera) {
    if (!camera || this.grassChunks.length === 0) return;
    const cameraX = camera.position.x;
    const cameraZ = camera.position.z;
    for (const chunk of this.grassChunks) {
      const center = chunk.userData.grassCenter;
      const maxDistance = chunk.userData.grassCullDistance || 116;
      const dx = center.x - cameraX;
      const dz = center.z - cameraZ;
      chunk.visible = dx * dx + dz * dz <= maxDistance * maxDistance;
    }
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(
      this.ultraHigh ? 0xcbdfe6 : 0xd6efff,
      this.ultraHigh ? 0x526152 : 0x5e765c,
      this.lowDetail ? 1.85 : (this.ultraHigh ? 0.98 : 2.15)
    );
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(
      this.ultraHigh ? 0xffefd2 : 0xfff2d0,
      this.lowDetail ? 1.65 : (this.ultraHigh ? 1.36 : 2.35)
    );
    if (this.ultraHigh) sun.position.set(-42, 76, -36);
    else sun.position.set(-34, 62, -28);
    sun.castShadow = this.ultraHigh;
    if (this.ultraHigh) {
      // 2048/1024 plus staggered updates provides a much larger performance
      // win than supersampling, while still keeping car/ball silhouettes crisp.
      const shadowSize = this.mobile ? 1024 : 2048;
      sun.shadow.mapSize.set(shadowSize, shadowSize);
      sun.shadow.camera.left = -88;
      sun.shadow.camera.right = 88;
      sun.shadow.camera.top = 112;
      sun.shadow.camera.bottom = -112;
      sun.shadow.camera.near = 10;
      sun.shadow.camera.far = 205;
      sun.shadow.bias = -0.00016;
      sun.shadow.normalBias = 0.042;
      sun.shadow.radius = this.mobile ? 1.4 : 1.8;
    }
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(
      0xaedcff,
      this.lowDetail ? 0.34 : (this.ultraHigh ? 0.16 : 0.52)
    );
    fill.position.set(32, 24, 38);
    fill.castShadow = false;
    this.scene.add(fill);

    if (this.ultraHigh) {
      const warmRim = new THREE.DirectionalLight(0xffc98e, 0.045);
      warmRim.position.set(26, 18, -50);
      warmRim.castShadow = false;
      this.scene.add(warmRim);
    }
  }
}
