import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA_TUNING } from '../shared/arena-tuning.js';
import { BOOST_PADS, BOOST_PAD_VISUAL_SCALE } from '../shared/boost-tuning.js';

let FIELD_W = ARENA_TUNING.width;
let FIELD_L = ARENA_TUNING.length;
let WALL_H = ARENA_TUNING.wallHeight;
let WALL_T = ARENA_TUNING.wallThickness;
let CORNER_R = ARENA_TUNING.cornerRadius;
let RAMP_R = ARENA_TUNING.rampRadius;
let CEILING_R = ARENA_TUNING.ceilingRampRadius;
let RAMP_SEGMENTS = ARENA_TUNING.rampSegments;
let GOAL_W = ARENA_TUNING.goalWidth;
let GOAL_H = ARENA_TUNING.goalHeight;
let GOAL_D = ARENA_TUNING.goalDepth;
let GOAL_R = ARENA_TUNING.goalRampRadius;
let GOAL_MOUTH_R = ARENA_TUNING.goalMouthRadius;
const BASKETBALL_HOOP = Object.freeze({
  height: 6.1,
  rimRadius: 12.5,
  rimTubeRadius: 0.96,
  wallInset: 11.5,
  backboardOffset: 6.8,
  backboardWidth: 10.4,
  backboardHeight: 5.9,
  backboardBottom: 6.3,
  backboardDepth: 0.72,
  backboardBeamThickness: 0.9,
  netBottomRadius: 14.2,
  netDepth: 6.1
});
// A compact quarter-pipe plus a short solid kick-wall makes the glass begin
// much earlier than in the previous seven-metre ramp layout.
const LOWER_WALL_HEIGHT = 0.46;
let GLASS_START_Y = RAMP_R + LOWER_WALL_HEIGHT;

// The online entry bundle is evaluated before a player selects a lobby. Refresh
// these cached values after applyServerArenaConfig() and before constructing
// Arena so custom lobby geometry remains authoritative and visually correct.
export function refreshArenaRuntimeTuning() {
  FIELD_W = ARENA_TUNING.width;
  FIELD_L = ARENA_TUNING.length;
  WALL_H = ARENA_TUNING.wallHeight;
  WALL_T = ARENA_TUNING.wallThickness;
  CORNER_R = ARENA_TUNING.cornerRadius;
  RAMP_R = ARENA_TUNING.rampRadius;
  CEILING_R = ARENA_TUNING.ceilingRampRadius;
  RAMP_SEGMENTS = ARENA_TUNING.rampSegments;
  GOAL_W = ARENA_TUNING.goalWidth;
  GOAL_H = ARENA_TUNING.goalHeight;
  GOAL_D = ARENA_TUNING.goalDepth;
  GOAL_R = ARENA_TUNING.goalRampRadius;
  GOAL_MOUTH_R = ARENA_TUNING.goalMouthRadius;
  GLASS_START_Y = RAMP_R + LOWER_WALL_HEIGHT;
}

function roundedRectGeometry(width, length, radius, segments) {
  const halfWidth = width * 0.5;
  const halfLength = length * 0.5;
  const shape = new THREE.Shape();
  // RL's four plan-view corners are single 45-degree planes. Keeping this
  // helper name avoids churn for callers, but the generated pitch is the
  // documented eight-sided outline rather than a circular rounded rectangle.
  shape.moveTo(-halfWidth + radius, -halfLength);
  shape.lineTo(halfWidth - radius, -halfLength);
  shape.lineTo(halfWidth, -halfLength + radius);
  shape.lineTo(halfWidth, halfLength - radius);
  shape.lineTo(halfWidth - radius, halfLength);
  shape.lineTo(-halfWidth + radius, halfLength);
  shape.lineTo(-halfWidth, halfLength - radius);
  shape.lineTo(-halfWidth, -halfLength + radius);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape, segments);
  geometry.rotateX(-Math.PI / 2);

  // ShapeGeometry's default UVs are world-sized shape coordinates. With a
  // clamp-to-edge full-field texture that means almost the entire pitch samples
  // texture edge pixels. Rebuild UVs explicitly so 0..1 spans the whole arena.
  const positions = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (positions && uv) {
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      uv.setXY(
        index,
        THREE.MathUtils.clamp((x + halfWidth) / width, 0, 1),
        THREE.MathUtils.clamp((z + halfLength) / length, 0, 1)
      );
    }
    uv.needsUpdate = true;
  }
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
    this.gameMode = options.gameMode === 'basketball' ? 'basketball' : 'normal';
    this.basketballMode = this.gameMode === 'basketball';
    this.group = new THREE.Group();
    this.scene.add(this.group);

    if (this.lowDetail) {
      // VM/software-WebGL path: the normal arena contains many separate wall,
      // glass, ramp and decorative meshes. Even when they use cheap materials,
      // their draw-call overhead is expensive when WebGL is rasterized on the
      // CPU. Keep the authoritative physics unchanged, but render only a flat
      // pitch plus batched line geometry for boundaries and goals.
      this.createUltraLowVisual();
      if (this.enablePhysics) this.createPhysics();
    } else {
      this.createExteriorGround();
      this.createField();
      if (this.enablePhysics) this.createPhysics();
      // Grandstands/crowd were intentionally removed. Keep only the exterior
      // skyline, buildings and trees so the stadium stays open and uncluttered.
      this.createExteriorDecoration();
      if (this.ultraHigh) this.createUltraHighStadiumDetails();
      this.createLights();
    }

    // Collapse compatible static meshes into spatial render batches. The arena is
    // immutable after construction, so baking transforms into shared geometry removes
    // draw-call/object overhead without changing materials, silhouettes or gameplay.
    if (!this.lowDetail) this.optimizeStaticRenderMeshes();

    // The whole arena is static. Avoid rebuilding local matrices every frame.
    this.group.traverse((object) => {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
    this.group.updateMatrixWorld(true);
  }

  optimizeStaticRenderMeshes() {
    this.group.updateMatrixWorld(true);
    const rootInverse = this.group.matrixWorld.clone().invert();
    const buckets = new Map();
    const bucketSize = 48;
    let sourceMeshCount = 0;

    const attributeSignature = (geometry) => Object.entries(geometry.attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.isInterleavedBufferAttribute ? 1 : 0}`)
      .join('|');

    this.group.traverse((object) => {
      if (!object?.isMesh || object.isInstancedMesh || object.isSkinnedMesh) return;
      if (!object.visible || !object.geometry || Array.isArray(object.material) || !object.material) return;
      if (object.children.length > 0 || object.userData?.noStaticBatch) return;
      const material = object.material;
      // Transparent surfaces need individual depth sorting. Keep glass, labels,
      // glows and other blended details separate so batching cannot alter the look.
      if (material.transparent || material.opacity < 0.999 || material.depthWrite === false || material.alphaTest > 0) return;
      if (Object.keys(object.geometry.morphAttributes || {}).length > 0) return;

      const geometry = object.geometry;
      if (!geometry.attributes?.position) return;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const center = geometry.boundingSphere.center.clone().applyMatrix4(object.matrixWorld);
      const cellX = Math.floor(center.x / bucketSize);
      const cellZ = Math.floor(center.z / bucketSize);
      const shadowRole = object.userData?.shadowRole || '';
      const cameraIgnore = object.userData?.cameraOcclusionIgnore ? 1 : 0;
      const indexed = geometry.index ? 1 : 0;
      const signature = attributeSignature(geometry);
      const key = [
        material.uuid,
        object.renderOrder,
        object.frustumCulled ? 1 : 0,
        shadowRole,
        cameraIgnore,
        indexed,
        signature,
        cellX,
        cellZ
      ].join('::');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(object);
      sourceMeshCount += 1;
    });

    let batchCount = 0;
    let mergedSourceCount = 0;
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const baked = [];
      for (const mesh of meshes) {
        const relativeMatrix = rootInverse.clone().multiply(mesh.matrixWorld);
        const geometry = mesh.geometry.clone();
        geometry.applyMatrix4(relativeMatrix);
        baked.push(geometry);
      }

      let geometry = null;
      try {
        geometry = mergeGeometries(baked, false);
      } catch {
        geometry = null;
      }
      for (const bakedGeometry of baked) bakedGeometry.dispose();
      if (!geometry) continue;

      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const template = meshes[0];
      const batch = new THREE.Mesh(geometry, template.material);
      batch.name = `arena-static-batch-${batchCount + 1}`;
      batch.renderOrder = template.renderOrder;
      batch.frustumCulled = template.frustumCulled;
      batch.castShadow = template.castShadow;
      batch.receiveShadow = template.receiveShadow;
      batch.userData = {
        ...template.userData,
        staticBatch: true,
        sourceMeshCount: meshes.length
      };
      this.group.add(batch);

      for (const mesh of meshes) mesh.parent?.remove(mesh);
      batchCount += 1;
      mergedSourceCount += meshes.length;
    }

    // Empty transform-only groups still cost traversal work. Remove only groups
    // that became completely empty as a result of the static bake.
    const groups = [];
    this.group.traverse((object) => {
      if (object !== this.group && object.isGroup) groups.push(object);
    });
    for (let index = groups.length - 1; index >= 0; index--) {
      const group = groups[index];
      if (group.children.length === 0) group.parent?.remove(group);
    }

    this.optimizationStats = Object.freeze({
      staticMeshCandidates: sourceMeshCount,
      staticMeshBatches: batchCount,
      staticMeshesMerged: mergedSourceCount,
      staticDrawCallsSaved: Math.max(0, mergedSourceCount - batchCount)
    });
  }

  panelTeamSign(panel) {
    const explicit = Number(panel?.teamSign) || 0;
    if (Math.abs(explicit) > 0.001) return explicit > 0 ? 1 : -1;
    const z = Number(panel?.z) || 0;
    if (Math.abs(z) > 0.001) return z > 0 ? 1 : -1;
    return 0;
  }

  splitVisualPanelsByTeam(panels) {
    const straightZ = FIELD_L * 0.5 - CORNER_R;
    const result = [];
    for (const panel of panels) {
      // The physical side wall is intentionally one long collider. Visually we
      // split it at midfield so the lower quarter-pipe can carry a clean blue
      // and orange half without introducing a physics seam.
      const isLongSide = Math.abs(panel.nx) > 0.9
        && Math.abs(panel.nz) < 0.1
        && Math.abs(panel.z) < 0.001
        && panel.length > straightZ * 1.5;
      if (isLongSide) {
        const halfLength = panel.length * 0.5;
        for (const sign of [-1, 1]) {
          result.push({
            ...panel,
            z: sign * halfLength * 0.5,
            length: halfLength,
            teamSign: sign,
            midfieldTeamSeam: true
          });
        }
        continue;
      }
      result.push({ ...panel, teamSign: this.panelTeamSign(panel) });
    }
    return result;
  }

  visualPanelLength(panel, lengthScale = 1) {
    // Curved panel runs overlap very slightly to hide cracks between facets.
    // The two differently coloured side-wall halves are coplanar, though, so
    // that same overlap causes severe z-fighting at midfield. Keep a hairline
    // clearance there while retaining the overlap everywhere else.
    if (panel.midfieldTeamSeam) return Math.max(0.01, panel.length - 0.02);
    return Math.max(0.01, panel.length * lengthScale);
  }

  createUltraLowVisual() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_W + 18, FIELD_L + 18, 1, 1),
      new THREE.MeshBasicMaterial({ color: this.basketballMode ? 0x9b5c2a : 0x244734 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    floor.userData.cameraOcclusionIgnore = true;
    floor.name = 'vm-flat-pitch';
    this.group.add(floor);

    const lineY = 0.035;
    const halfW = FIELD_W * 0.5;
    const halfL = FIELD_L * 0.5;
    const topY = Math.min(WALL_H, 8);
    const points = [];
    const segment = (ax, ay, az, bx, by, bz) => {
      points.push(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz));
    };

    // Floor boundary + midfield.
    segment(-halfW, lineY, -halfL, halfW, lineY, -halfL);
    segment(halfW, lineY, -halfL, halfW, lineY, halfL);
    segment(halfW, lineY, halfL, -halfW, lineY, halfL);
    segment(-halfW, lineY, halfL, -halfW, lineY, -halfL);
    segment(-halfW, lineY, 0, halfW, lineY, 0);

    // A single batched wire outline communicates the playable wall volume
    // without any transparent glass surfaces or extra lighting passes.
    segment(-halfW, topY, -halfL, halfW, topY, -halfL);
    segment(halfW, topY, -halfL, halfW, topY, halfL);
    segment(halfW, topY, halfL, -halfW, topY, halfL);
    segment(-halfW, topY, halfL, -halfW, topY, -halfL);
    for (const [x, z] of [[-halfW, -halfL], [halfW, -halfL], [halfW, halfL], [-halfW, halfL]]) {
      segment(x, lineY, z, x, topY, z);
    }

    // Center circle is folded into the same LineSegments draw call.
    const circleSegments = 20;
    const circleRadius = Math.min(10.5, halfW * 0.28);
    for (let i = 0; i < circleSegments; i++) {
      const a0 = i / circleSegments * Math.PI * 2;
      const a1 = (i + 1) / circleSegments * Math.PI * 2;
      segment(
        Math.cos(a0) * circleRadius, lineY, Math.sin(a0) * circleRadius,
        Math.cos(a1) * circleRadius, lineY, Math.sin(a1) * circleRadius
      );
    }

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const fieldLines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: 0xd9e7df })
    );
    fieldLines.frustumCulled = false;
    fieldLines.userData.cameraOcclusionIgnore = true;
    fieldLines.name = 'vm-field-lines';
    this.group.add(fieldLines);

    const createGoalWire = (sign, color) => {
      const zFront = sign * halfL;
      const zBack = sign * (halfL + GOAL_D);
      const halfGoal = GOAL_W * 0.5;
      const goalPoints = [];
      const goalSegment = (ax, ay, az, bx, by, bz) => {
        goalPoints.push(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz));
      };
      const corners = [
        [-halfGoal, 0, zFront], [halfGoal, 0, zFront],
        [-halfGoal, GOAL_H, zFront], [halfGoal, GOAL_H, zFront],
        [-halfGoal, 0, zBack], [halfGoal, 0, zBack],
        [-halfGoal, GOAL_H, zBack], [halfGoal, GOAL_H, zBack]
      ];
      const edges = [
        [0,1],[2,3],[4,5],[6,7],
        [0,2],[1,3],[4,6],[5,7],
        [0,4],[1,5],[2,6],[3,7]
      ];
      for (const [a, b] of edges) {
        const p0 = corners[a];
        const p1 = corners[b];
        goalSegment(p0[0], p0[1] + lineY, p0[2], p1[0], p1[1] + lineY, p1[2]);
      }
      const wire = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(goalPoints),
        new THREE.LineBasicMaterial({ color })
      );
      wire.frustumCulled = false;
      wire.userData.cameraOcclusionIgnore = true;
      wire.name = sign > 0 ? 'vm-orange-goal' : 'vm-blue-goal';
      this.group.add(wire);
    };

    if (this.basketballMode) {
      this.createUltraLowBasketballHoopWire(1, 0xff8a22);
      this.createUltraLowBasketballHoopWire(-1, 0x268dff);
    } else {
      createGoalWire(1, 0xff8a22);
      createGoalWire(-1, 0x268dff);
    }
  }

  createUltraLowBasketballHoopWire(sign, color) {
    const signZ = sign >= 0 ? 1 : -1;
    const rimZ = signZ * (FIELD_L * 0.5 - BASKETBALL_HOOP.wallInset);
    const backboardZ = rimZ + signZ * BASKETBALL_HOOP.backboardOffset;
    const supportZ = signZ * (FIELD_L * 0.5 - 2.0);
    const frameHalfW = BASKETBALL_HOOP.backboardWidth * 0.5;
    const frameBottom = BASKETBALL_HOOP.backboardBottom;
    const frameTop = frameBottom + BASKETBALL_HOOP.backboardHeight;
    const frameCenterY = frameBottom + BASKETBALL_HOOP.backboardHeight * 0.5;
    const netBottomY = BASKETBALL_HOOP.height - BASKETBALL_HOOP.netDepth;
    const points = [];
    const add = (a, b) => points.push(a, b);
    const segments = 24;
    for (let index = 0; index < segments; index++) {
      const a0 = index / segments * Math.PI * 2;
      const a1 = (index + 1) / segments * Math.PI * 2;
      add(
        new THREE.Vector3(Math.cos(a0) * BASKETBALL_HOOP.rimRadius, BASKETBALL_HOOP.height, rimZ + Math.sin(a0) * BASKETBALL_HOOP.rimRadius),
        new THREE.Vector3(Math.cos(a1) * BASKETBALL_HOOP.rimRadius, BASKETBALL_HOOP.height, rimZ + Math.sin(a1) * BASKETBALL_HOOP.rimRadius)
      );
      add(
        new THREE.Vector3(Math.cos(a0) * BASKETBALL_HOOP.netBottomRadius, netBottomY, rimZ + Math.sin(a0) * BASKETBALL_HOOP.netBottomRadius),
        new THREE.Vector3(Math.cos(a1) * BASKETBALL_HOOP.netBottomRadius, netBottomY, rimZ + Math.sin(a1) * BASKETBALL_HOOP.netBottomRadius)
      );
      add(
        new THREE.Vector3(Math.cos(a0) * BASKETBALL_HOOP.rimRadius * 0.96, BASKETBALL_HOOP.height - 0.1, rimZ + Math.sin(a0) * BASKETBALL_HOOP.rimRadius * 0.96),
        new THREE.Vector3(Math.cos(a0) * BASKETBALL_HOOP.netBottomRadius, netBottomY, rimZ + Math.sin(a0) * BASKETBALL_HOOP.netBottomRadius)
      );
    }
    add(new THREE.Vector3(-frameHalfW, frameBottom, backboardZ), new THREE.Vector3(frameHalfW, frameBottom, backboardZ));
    add(new THREE.Vector3(frameHalfW, frameBottom, backboardZ), new THREE.Vector3(frameHalfW, frameTop, backboardZ));
    add(new THREE.Vector3(frameHalfW, frameTop, backboardZ), new THREE.Vector3(-frameHalfW, frameTop, backboardZ));
    add(new THREE.Vector3(-frameHalfW, frameTop, backboardZ), new THREE.Vector3(-frameHalfW, frameBottom, backboardZ));
    add(new THREE.Vector3(0, 2.2, supportZ), new THREE.Vector3(0, frameCenterY, supportZ));
    add(new THREE.Vector3(0, frameCenterY, supportZ), new THREE.Vector3(-frameHalfW * 0.9, frameTop, backboardZ));
    add(new THREE.Vector3(0, frameCenterY, supportZ), new THREE.Vector3(frameHalfW * 0.9, frameTop, backboardZ));
    const wire = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color }));
    wire.name = signZ > 0 ? 'vm-orange-basketball-hoop' : 'vm-blue-basketball-hoop';
    wire.frustumCulled = false;
    wire.userData.cameraOcclusionIgnore = true;
    this.group.add(wire);
  }

  createExteriorGround() {
    // A large visual-only apron prevents the camera from revealing a black void
    // when it moves behind the transparent arena walls.
    const material = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x3f6a4e })
      : (this.ultraHigh
        ? new THREE.MeshStandardMaterial({ color: 0x385e46, roughness: 1.0, metalness: 0.0 })
        : new THREE.MeshStandardMaterial({ color: 0x456f53, roughness: 1.0, metalness: 0.0 }));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(250, 320), material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.055;
    ground.userData.cameraOcclusionIgnore = true;
    this.group.add(ground);
  }

  drawFieldSurfaceGraphics(ctx, canvas, highDetail = false) {
    if (this.basketballMode) {
      this.drawBasketballSurfaceGraphics(ctx, canvas, highDetail);
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    const scaleX = width / FIELD_W;
    const scaleZ = height / FIELD_L;
    const lineScale = (scaleX + scaleZ) * 0.5;
    const worldPoint = (x, z) => ({
      x: (x / FIELD_W + 0.5) * width,
      // CanvasTexture is uploaded with Three.js' default vertical flip, so
      // world -Z must be painted at the bottom of the source canvas. Keeping
      // this conversion explicit prevents the blue/orange halves from being
      // mirrored when the overlay is sampled on the field geometry.
      y: (-z / FIELD_L + 0.5) * height
    });

    const traceSmoothPath = (points) => {
      if (!points?.length) return;
      const mapped = points.map(([x, z]) => worldPoint(x, z));
      ctx.beginPath();
      ctx.moveTo(mapped[0].x, mapped[0].y);
      if (mapped.length === 2) {
        ctx.lineTo(mapped[1].x, mapped[1].y);
        return;
      }
      for (let index = 1; index < mapped.length - 1; index++) {
        const current = mapped[index];
        const next = mapped[index + 1];
        const midX = (current.x + next.x) * 0.5;
        const midY = (current.y + next.y) * 0.5;
        ctx.quadraticCurveTo(current.x, current.y, midX, midY);
      }
      const penultimate = mapped[mapped.length - 2];
      const last = mapped[mapped.length - 1];
      ctx.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
    };

    const strokeSmoothPath = (points, color, widthWorld, alpha = 1, dash = []) => {
      if (!points?.length) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1, widthWorld * lineScale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash.map((value) => value * lineScale));
      traceSmoothPath(points);
      ctx.stroke();
      ctx.restore();
    };

    const drawRoute = (points, color, soft) => {
      // Every route uses the same restrained three-layer language: a dark
      // recessed channel, one team-coloured rail and a fine highlight. Keeping
      // this consistent is what makes the floor read cleanly instead of noisy.
      strokeSmoothPath(points, '#071514', 1.18, 0.48);
      strokeSmoothPath(points, color, highDetail ? 0.42 : 0.38, 0.82);
      strokeSmoothPath(points, soft, highDetail ? 0.095 : 0.085, 0.72);
    };

    const drawWorldArc = (centerX, centerZ, radiusX, radiusZ, start, end, color, widthWorld, alpha = 1) => {
      const center = worldPoint(centerX, centerZ);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1, widthWorld * lineScale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, radiusX * scaleX, radiusZ * scaleZ, 0, start, end);
      ctx.stroke();
      ctx.restore();
    };

    const fillWorldArcSector = (centerX, centerZ, radiusX, radiusZ, start, end, color, alpha = 1) => {
      const center = worldPoint(centerX, centerZ);
      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      const steps = highDetail ? 96 : 64;
      for (let index = 0; index <= steps; index++) {
        const angle = start + (end - start) * index / steps;
        ctx.lineTo(
          center.x + Math.cos(angle) * radiusX * scaleX,
          center.y + Math.sin(angle) * radiusZ * scaleZ
        );
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const fillWorldPolygon = (points, color, alpha = 1) => {
      if (!points?.length) return;
      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      const first = worldPoint(points[0][0], points[0][1]);
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < points.length; index++) {
        const point = worldPoint(points[index][0], points[index][1]);
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const blue = '#118df4';
    const blueSoft = '#8ad8ff';
    const orange = '#ff7114';
    const orangeSoft = '#ffd08a';
    const ink = '#071513';

    // One quiet, symmetrical end-zone shape per team. The old design stacked
    // many polygons, chevrons and crossing rails; this broad wash gives the
    // field identity without competing with gameplay markings.
    fillWorldPolygon([[-18, -50.5], [18, -50.5], [25, -39], [18, -34], [-18, -34], [-25, -39]], blue, 0.070);
    fillWorldPolygon([[-18, 50.5], [18, 50.5], [25, 39], [18, 34], [-18, 34], [-25, 39]], orange, 0.070);

    for (const sign of [-1, 1]) {
      const color = sign < 0 ? blue : orange;
      const soft = sign < 0 ? blueSoft : orangeSoft;
      const goalZ = sign * (FIELD_L * 0.5 - 0.25);
      const arcStart = sign < 0 ? 0 : Math.PI;
      const arcEnd = sign < 0 ? Math.PI : Math.PI * 2;

      // A single strong goal crease plus one restrained inner contour. This is
      // deliberately much cleaner than the previous stack of four concentric
      // arcs and multiple shoulder traces.
      fillWorldArcSector(0, goalZ, 23.0, 20.2, arcStart, arcEnd, color, highDetail ? 0.095 : 0.082);
      drawWorldArc(0, goalZ, 23.0, 20.2, arcStart, arcEnd, ink, 1.50, 0.66);
      drawWorldArc(0, goalZ, 23.0, 20.2, arcStart, arcEnd, color, 0.62, 0.98);
      drawWorldArc(0, goalZ, 16.7, 14.4, arcStart, arcEnd, soft, 0.20, 0.46);

      // Three primary rotation lanes correspond to the real boost-pad rows.
      // They never cross one another, and the exact same layout is mirrored on
      // both halves so players can read it instantly while driving.
      drawRoute([[0, sign * 42.40], [0, sign * 28.16], [0, sign * 10.24], [0, 0]], color, soft);
      drawRoute([[-17.92, sign * 41.84], [-9.40, sign * 33.08], [-17.88, sign * 23], [-20.48, sign * 10.36], [-10.24, 0]], color, soft);
      drawRoute([[17.92, sign * 41.84], [9.40, sign * 33.08], [17.88, sign * 23], [20.48, sign * 10.36], [10.24, 0]], color, soft);

      // Outer wall rotation: midfield full boost -> wall small boost -> corner
      // full boost. These remain independent from the inner lanes, eliminating
      // the old web of intersecting lines around the centre of the pitch.
      drawRoute([[-35.84, 0], [-35.84, sign * 24.84], [-30.72, sign * 40.96]], color, soft);
      drawRoute([[35.84, 0], [35.84, sign * 24.84], [30.72, sign * 40.96]], color, soft);

      // A short backline connects the three small pads directly in front of the
      // goal without extending through other routes.
      drawRoute([[-17.92, sign * 41.84], [0, sign * 42.40], [17.92, sign * 41.84]], color, soft);
    }

    // One subtle split midfield ring gives the floor a finished centrepiece.
    // The actual white gameplay circle mesh is rendered above it and stays the
    // dominant line.
    drawWorldArc(0, 0, 14.3, 14.3, 0, Math.PI, orange, 0.30, 0.36);
    drawWorldArc(0, 0, 14.3, 14.3, Math.PI, Math.PI * 2, blue, 0.30, 0.36);

    // Permanent pad locators use one consistent visual scale and sit above the
    // routes. Full boosts get a restrained second ring; no extra halos, dashes
    // or crossing ornaments are drawn around small pads.
    for (const pad of BOOST_PADS) {
      const point = worldPoint(pad.x, pad.z);
      const large = pad.kind === 'large';
      const radiusWorld = (large ? 3.05 : 1.44) * BOOST_PAD_VISUAL_SCALE;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.strokeStyle = large ? '#ffe06b' : '#ffd35b';
      ctx.globalAlpha = large ? 0.92 : 0.64;
      ctx.lineWidth = Math.max(1.2, (large ? 0.34 : 0.22) * lineScale);
      ctx.beginPath();
      ctx.ellipse(0, 0, radiusWorld * scaleX, radiusWorld * scaleZ, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (large) {
        ctx.globalAlpha = 0.24;
        ctx.lineWidth = Math.max(1, 0.12 * lineScale);
        ctx.beginPath();
        ctx.ellipse(0, 0, radiusWorld * 1.18 * scaleX, radiusWorld * 1.18 * scaleZ, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  createWoodTexture(highDetail = false) {
    const canvas = document.createElement('canvas');
    if (highDetail) {
      canvas.width = 2048;
      canvas.height = 3072;
    } else if (this.lowDetail) {
      canvas.width = 768;
      canvas.height = 1152;
    } else {
      canvas.width = 1536;
      canvas.height = 2304;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // A deterministic premium hardwood court replaces the old green turf.
    // Detail is built from broad plank-to-plank colour variation, long grain
    // bands and a few soft knots rather than pixel noise, so the floor remains
    // clean and stable under mipmapping even from the low chase-camera angle.
    let seed = 0x4f1bbcdc;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, '#604638');
    background.addColorStop(0.32, '#8a654a');
    background.addColorStop(0.68, '#76533d');
    background.addColorStop(1, '#523a31');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Denser boards restore a believable scale beside the car. This changes
    // only the generated texture detail, never field or collision dimensions.
    const columns = highDetail ? 126 : (this.lowDetail ? 70 : 104);
    const plankWidth = canvas.width / columns;
    const basePlankLength = canvas.height / (highDetail ? 30 : 27);
    const grainPasses = highDetail ? 3 : (this.lowDetail ? 0 : 2);

    for (let column = 0; column < columns; column++) {
      const x = column * plankWidth;
      let y = -basePlankLength * (0.18 + (column % 5) * 0.17);
      let segmentIndex = 0;
      while (y < canvas.height) {
        const length = basePlankLength * (0.82 + random() * 0.42);
        const hue = 24 + random() * 7;
        const saturation = 27 + random() * 11;
        const lightness = 37 + random() * 14;
        const edgeLight = Math.min(68, lightness + 7 + random() * 4);
        const edgeDark = Math.max(25, lightness - 8 - random() * 4);

        const plank = ctx.createLinearGradient(x, y, x + plankWidth, y);
        plank.addColorStop(0, `hsl(${hue}, ${saturation}%, ${edgeDark}%)`);
        plank.addColorStop(0.13, `hsl(${hue + 1}, ${saturation}%, ${lightness}%)`);
        plank.addColorStop(0.55, `hsl(${hue + 2}, ${Math.max(22, saturation - 5)}%, ${edgeLight}%)`);
        plank.addColorStop(0.88, `hsl(${hue}, ${saturation}%, ${lightness - 2}%)`);
        plank.addColorStop(1, `hsl(${hue}, ${saturation}%, ${edgeDark}%)`);
        ctx.fillStyle = plank;
        ctx.fillRect(x, y, plankWidth + 1, length + 1);

        if (grainPasses > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 1, y + 1, Math.max(1, plankWidth - 2), Math.max(1, length - 2));
          ctx.clip();
          for (let grain = 0; grain < grainPasses; grain++) {
            const gx = x + plankWidth * (0.20 + random() * 0.60);
            const amplitude = plankWidth * (0.05 + random() * 0.09);
            const phase = random() * Math.PI * 2;
            ctx.strokeStyle = grain % 2 === 0
              ? 'rgba(73,37,18,0.16)'
              : 'rgba(244,196,132,0.075)';
            ctx.lineWidth = Math.max(0.8, canvas.width / 1850);
            ctx.beginPath();
            const steps = 8;
            for (let step = 0; step <= steps; step++) {
              const py = y + length * step / steps;
              const px = gx + Math.sin(phase + step * 0.92 + segmentIndex * 0.27) * amplitude;
              if (step === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          ctx.restore();
        }

        // Fine recessed seams give each board a readable edge without the
        // thick grid look of parquet tiles.
        ctx.strokeStyle = 'rgba(42,22,12,0.24)';
        ctx.lineWidth = Math.max(0.85, canvas.width / 1900);
        ctx.strokeRect(
          x + 0.5,
          y + 0.5,
          Math.max(1, plankWidth - 1),
          Math.max(1, length - 1)
        );
        ctx.strokeStyle = 'rgba(255,216,160,0.050)';
        ctx.lineWidth = Math.max(0.7, canvas.width / 2400);
        ctx.beginPath();
        ctx.moveTo(x + 1.2, y + 1.2);
        ctx.lineTo(x + plankWidth - 1.2, y + 1.2);
        ctx.stroke();

        y += length;
        segmentIndex++;
      }
    }

    // Sparse, large knots add natural variation. Their soft gradients survive
    // minification far better than tiny speckles and never compete with field
    // markings or boost-pad locators.
    const knotCount = highDetail ? 26 : (this.lowDetail ? 5 : 15);
    for (let index = 0; index < knotCount; index++) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const radius = plankWidth * (0.20 + random() * 0.34);
      const squash = 0.52 + random() * 0.24;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, squash);
      const knot = ctx.createRadialGradient(0, 0, radius * 0.12, 0, 0, radius);
      knot.addColorStop(0, 'rgba(45,21,10,0.42)');
      knot.addColorStop(0.34, 'rgba(88,43,19,0.24)');
      knot.addColorStop(0.70, 'rgba(53,27,15,0.10)');
      knot.addColorStop(1, 'rgba(53,27,15,0)');
      ctx.fillStyle = knot;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // A broad satin variation prevents the large court from reading as one
    // flat colour while staying subtle beneath the crisp gameplay overlay.
    const finish = ctx.createLinearGradient(0, 0, canvas.width, 0);
    finish.addColorStop(0, 'rgba(31,13,7,0.10)');
    finish.addColorStop(0.24, 'rgba(255,214,151,0.055)');
    finish.addColorStop(0.54, 'rgba(255,226,175,0.020)');
    finish.addColorStop(0.78, 'rgba(255,206,136,0.050)');
    finish.addColorStop(1, 'rgba(35,15,8,0.095)');
    ctx.fillStyle = finish;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(highDetail ? 16 : 12, this.maxAnisotropy);
    return texture;
  }

  createFieldMarkingsTexture(highDetail = false) {
    const canvas = document.createElement('canvas');
    if (highDetail) {
      canvas.width = 2048;
      canvas.height = 3072;
    } else if (this.lowDetail) {
      canvas.width = 1024;
      canvas.height = 1536;
    } else {
      canvas.width = 1536;
      canvas.height = 2304;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawFieldSurfaceGraphics(ctx, canvas, highDetail);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(16, this.maxAnisotropy);
    return texture;
  }

  createUltraWoodBumpTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1536;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // The bump map only carries long plank seams and broad grain. No random
    // pixel-height noise is used, so moonlight produces a satin wood response
    // rather than shimmering micro-detail.
    const columns = 108;
    const plankWidth = canvas.width / columns;
    const plankLength = canvas.height / 30;
    for (let column = 0; column <= columns; column++) {
      const x = Math.round(column * plankWidth) + 0.5;
      ctx.strokeStyle = 'rgba(72,72,72,0.72)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();

      const offset = ((column * 37) % 11) / 11 * plankLength;
      for (let y = -offset; y < canvas.height; y += plankLength) {
        ctx.strokeStyle = 'rgba(82,82,82,0.58)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(column * plankWidth, y);
        ctx.lineTo((column + 1) * plankWidth, y);
        ctx.stroke();
      }

      for (let grain = 0; grain < 2; grain++) {
        const gx = column * plankWidth + plankWidth * (0.30 + grain * 0.34);
        ctx.strokeStyle = grain === 0 ? 'rgba(112,112,112,0.30)' : 'rgba(146,146,146,0.23)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        for (let step = 0; step <= 24; step++) {
          const y = canvas.height * step / 24;
          const x = gx + Math.sin(step * 0.84 + column * 0.43 + grain) * plankWidth * 0.07;
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(16, this.maxAnisotropy);
    return texture;
  }

  createTeamRampTexture(teamSign, highDetail = false) {
    const canvas = document.createElement('canvas');
    canvas.width = highDetail ? 512 : 384;
    canvas.height = highDetail ? 512 : 384;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const orange = teamSign > 0;
    const baseA = orange ? '#3b1708' : '#061b35';
    const baseB = orange ? '#5a2208' : '#072a51';
    const panelA = orange ? '#6c2a0b' : '#0a3768';
    const panelB = orange ? '#4b1d09' : '#082846';
    const accent = orange ? '#ff6a0a' : '#098cff';
    const accentSoft = orange ? '#ffc05b' : '#63ceff';

    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, baseB);
    bg.addColorStop(0.50, baseA);
    bg.addColorStop(1, '#071111');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const rows = 8;
    const cols = 5;
    const rowH = canvas.height / rows;
    const colW = canvas.width / cols;
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 ? colW * 0.5 : 0;
      for (let col = -1; col < cols + 1; col++) {
        const x = col * colW + offset;
        const y = row * rowH;
        ctx.fillStyle = (row + col) % 2 ? panelA : panelB;
        ctx.globalAlpha = 0.58;
        ctx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
      }
    }
    ctx.globalAlpha = 1;

    // Baked light rails and circuit traces give the quarter-pipe an illuminated
    // team identity without real point lights or post-processing.
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = highDetail ? 18 : 12;
    for (const yRatio of [0.18, 0.51, 0.84]) {
      const y = canvas.height * yRatio;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.78;
      ctx.lineWidth = highDetail ? 5 : 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
      ctx.strokeStyle = accentSoft;
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = highDetail ? 1.4 : 1.0;
      ctx.beginPath();
      ctx.moveTo(0, y - 1);
      ctx.lineTo(canvas.width, y - 1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(2,8,12,0.74)';
    ctx.lineWidth = highDetail ? 3 : 2;
    for (let row = 0; row <= rows; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * rowH);
      ctx.lineTo(canvas.width, row * rowH);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(highDetail ? 12 : 8, this.maxAnisotropy);
    return texture;
  }

  createTeamRampMaterial(teamSign) {
    const orange = teamSign > 0;
    const teamColor = orange ? 0xff6308 : 0x078cff;
    const key = `${orange ? 'orange' : 'blue'}-${this.lowDetail ? 'low' : (this.ultraHigh ? 'high' : 'normal')}`;
    this.teamRampMaterials ??= new Map();
    if (this.teamRampMaterials.has(key)) return this.teamRampMaterials.get(key);

    let material;
    if (this.lowDetail) {
      material = new THREE.MeshBasicMaterial({
        color: orange ? 0x8f3508 : 0x064887,
        side: THREE.DoubleSide
      });
    } else {
      this.teamRampTextures ??= new Map();
      if (!this.teamRampTextures.has(key)) {
        this.teamRampTextures.set(key, this.createTeamRampTexture(teamSign, this.ultraHigh));
      }
      const wallBump = this.ultraHigh
        ? (this.wallBumpTexture ??= this.createWallBumpTexture(true))
        : null;
      material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.teamRampTextures.get(key),
        bumpMap: wallBump,
        bumpScale: this.ultraHigh ? 0.045 : 0,
        emissive: teamColor,
        emissiveIntensity: this.ultraHigh ? 0.36 : 0.50,
        roughness: this.ultraHigh ? 0.78 : 0.84,
        metalness: this.ultraHigh ? 0.08 : 0.04,
        side: THREE.DoubleSide
      });
    }
    this.teamRampMaterials.set(key, material);
    return material;
  }

  createWallTileTexture(highDetail = false) {
    const canvas = document.createElement('canvas');
    canvas.width = highDetail ? 512 : 256;
    canvas.height = highDetail ? 512 : 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Dark graphite panels give the glass cage a much stronger contrast than
    // the old pale teal wall while still retaining visible surface detail.
    ctx.fillStyle = '#111a21';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rows = highDetail ? 12 : 8;
    const cols = highDetail ? 8 : 6;
    const rowHeight = canvas.height / rows;
    const colWidth = canvas.width / cols;
    const panelTones = ['#1b2931', '#202f37', '#18252d', '#23343b'];

    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : colWidth * 0.5;
      for (let column = -1; column <= cols; column++) {
        const x = column * colWidth + offset;
        const y = row * rowHeight;
        ctx.fillStyle = panelTones[(row * 3 + column + 8) % panelTones.length];
        ctx.fillRect(x + 2, y + 2, colWidth - 4, rowHeight - 4);
        const gradient = ctx.createLinearGradient(x, y, x, y + rowHeight);
        gradient.addColorStop(0, 'rgba(126,151,160,0.13)');
        gradient.addColorStop(0.14, 'rgba(70,93,102,0.045)');
        gradient.addColorStop(0.70, 'rgba(11,23,29,0.04)');
        gradient.addColorStop(1, 'rgba(0,4,8,0.28)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 2, y + 2, colWidth - 4, rowHeight - 4);
      }
    }

    ctx.lineWidth = highDetail ? 3 : 2;
    ctx.strokeStyle = 'rgba(2,7,11,0.88)';
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
    for (let i = 0; i < (highDetail ? 1900 : 520); i++) {
      const cool = random() > 0.50;
      const alpha = 0.025 + random() * 0.05;
      ctx.fillStyle = cool
        ? `rgba(79,123,143,${alpha})`
        : `rgba(131,101,72,${alpha * 0.75})`;
      const size = 0.5 + random() * (highDetail ? 2.3 : 1.5);
      ctx.fillRect(random() * canvas.width, random() * canvas.height, size, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.anisotropy = Math.min(highDetail ? 12 : 6, this.maxAnisotropy);
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

  drawBasketballSurfaceGraphics(ctx, canvas, highDetail = false) {
    const width = canvas.width;
    const height = canvas.height;
    const scaleX = width / FIELD_W;
    const scaleZ = height / FIELD_L;
    const lineScale = (scaleX + scaleZ) * 0.5;
    const point = (x, z) => ({ x: (x / FIELD_W + 0.5) * width, y: (-z / FIELD_L + 0.5) * height });
    const line = (ax, az, bx, bz, color = 'rgba(244,246,238,.92)', lineWidth = 0.25) => {
      const a = point(ax, az);
      const b = point(bx, bz);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, lineWidth * lineScale);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    };
    const ellipse = (x, z, rx, rz, color = 'rgba(244,246,238,.92)', lineWidth = 0.25, start = 0, end = Math.PI * 2) => {
      const p = point(x, z);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, lineWidth * lineScale);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx * scaleX, rz * scaleZ, 0, start, end);
      ctx.stroke();
      ctx.restore();
    };

    ctx.clearRect(0, 0, width, height);
    const halfW = FIELD_W * 0.5;
    const halfL = FIELD_L * 0.5;
    const keyW = Math.min(24, FIELD_W * 0.34);
    const keyDepth = Math.min(22, FIELD_L * 0.17);
    const threeRadius = Math.min(30, FIELD_W * 0.42);
    const paintAlpha = highDetail ? 0.26 : 0.21;

    // Team-coloured painted areas, inspired by a professional hoops court but
    // kept original to Rocket Vibe rather than copying a branded arena texture.
    for (const sign of [-1, 1]) {
      const team = sign > 0 ? 'rgba(238,93,22,' : 'rgba(17,107,238,';
      const zOuter = sign * halfL;
      const zInner = sign * (halfL - keyDepth);
      const a = point(-keyW * 0.5, zOuter);
      const b = point(keyW * 0.5, zInner);
      ctx.save();
      ctx.fillStyle = `${team}${paintAlpha})`;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();

      const baselineZ = sign * (halfL - 1.2);
      const freeThrowZ = sign * (halfL - keyDepth);
      line(-keyW * 0.5, baselineZ, -keyW * 0.5, freeThrowZ);
      line(keyW * 0.5, baselineZ, keyW * 0.5, freeThrowZ);
      line(-keyW * 0.5, freeThrowZ, keyW * 0.5, freeThrowZ);
      ellipse(0, freeThrowZ, 5.8, 5.8, 'rgba(244,246,238,.88)', 0.23);

      const hoopZ = sign * (halfL - BASKETBALL_HOOP.wallInset);
      const arcStart = sign > 0 ? Math.PI : 0;
      const arcEnd = sign > 0 ? Math.PI * 2 : Math.PI;
      ellipse(0, hoopZ, threeRadius, threeRadius, 'rgba(244,246,238,.88)', 0.30, arcStart, arcEnd);
      ellipse(0, hoopZ, 2.2, 2.2, sign > 0 ? 'rgba(255,127,40,.85)' : 'rgba(54,146,255,.85)', 0.22);
    }

    line(-halfW + 1.2, 0, halfW - 1.2, 0, 'rgba(244,246,238,.92)', 0.28);
    ellipse(0, 0, 10.5, 10.5, 'rgba(244,246,238,.92)', 0.28);
    ellipse(0, 0, 0.42, 0.42, 'rgba(244,246,238,.96)', 0.18);

    if (highDetail) {
      ctx.save();
      ctx.globalAlpha = 0.09;
      ctx.strokeStyle = '#fff2d3';
      ctx.lineWidth = 1;
      for (let z = -halfL; z <= halfL; z += 5) {
        const a = point(-halfW, z);
        const b = point(halfW, z);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  createField() {
    const woodTexture = this.createWoodTexture(this.ultraHigh);
    const woodBump = this.ultraHigh ? this.createUltraWoodBumpTexture() : null;
    const markingsTexture = this.createFieldMarkingsTexture(this.ultraHigh);
    const floorMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0xffffff, map: woodTexture })
      : (this.ultraHigh
        ? new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: woodTexture,
            bumpMap: woodBump,
            bumpScale: 0.032,
            roughness: 0.72,
            metalness: 0.0
          })
        : new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: woodTexture,
            roughness: 0.80,
            metalness: 0.0
          }));
    const floor = new THREE.Mesh(
      roundedRectGeometry(FIELD_W, FIELD_L, CORNER_R, this.lowDetail ? 4 : 12),
      floorMaterial
    );
    floor.name = 'arena-hardwood-floor';
    floor.userData.shadowRole = 'field';
    this.group.add(floor);

    // Team graphics and boost routes live on one unlit overlay so they stay
    // saturated from the normal driving camera instead of being dulled by
    // daylight, tone mapping or the grass material. This is one extra draw call.
    if (markingsTexture) {
      const markingsMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: markingsTexture,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        alphaTest: 0.012,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const markings = new THREE.Mesh(
        roundedRectGeometry(FIELD_W, FIELD_L, CORNER_R, this.lowDetail ? 4 : 12),
        markingsMaterial
      );
      markings.name = 'arena-field-markings';
      markings.position.y = 0.020;
      markings.renderOrder = 3;
      markings.userData.cameraOcclusionIgnore = true;
      this.group.add(markings);
    }

    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf7ffff, transparent: true, opacity: 0.97, toneMapped: false });
    const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W - 2, 0.14), lineMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.038;
    this.group.add(centerLine);

    const circle = new THREE.Mesh(new THREE.RingGeometry(10.5, 10.68, this.lowDetail ? 24 : 56), lineMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.040;
    this.group.add(circle);

    const centerDot = new THREE.Mesh(new THREE.CircleGeometry(0.38, this.lowDetail ? 8 : 20), lineMaterial);
    centerDot.rotation.x = -Math.PI / 2;
    centerDot.position.y = 0.042;
    this.group.add(centerDot);

    const glassMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({
          color: 0x98c3d2,
          transparent: true,
          opacity: 0.070,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      : new THREE.MeshStandardMaterial({
          color: this.ultraHigh ? 0x9fbecb : 0xa8d0dc,
          transparent: true,
          opacity: this.ultraHigh ? 0.075 : 0.095,
          roughness: this.ultraHigh ? 0.56 : 0.48,
          metalness: this.ultraHigh ? 0.015 : 0.0,
          depthWrite: false,
          side: THREE.DoubleSide
        });
    const frameMaterial = this.lowDetail
      ? new THREE.MeshBasicMaterial({ color: 0x294653 })
      : new THREE.MeshStandardMaterial({
          color: this.ultraHigh ? 0x294c5c : 0x315b69,
          emissive: this.ultraHigh ? 0x0a2b3d : 0x0b3b50,
          emissiveIntensity: this.ultraHigh ? 0.25 : 0.38,
          roughness: this.ultraHigh ? 0.61 : 0.54,
          metalness: this.ultraHigh ? 0.38 : 0.34
        });

    this.createGlassEnclosure(glassMaterial, frameMaterial);
    if (this.basketballMode) {
      this.createBasketballHoop(1);
      this.createBasketballHoop(-1);
    } else {
      this.createGoal(1);
      this.createGoal(-1);
    }
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

    const roundedOpeningHalfWidth = this.basketballMode ? 0 : goalHalfWidth + GOAL_MOUTH_R;
    const endSegmentLength = straightX - roundedOpeningHalfWidth;
    const endSegmentCenter = roundedOpeningHalfWidth + endSegmentLength * 0.5;
    for (const signZ of [-1, 1]) {
      const z = signZ * (halfLength + WALL_T * 0.5);
      panels.push(
        { x: -endSegmentCenter, z, length: endSegmentLength, yaw: 0, nx: 0, nz: signZ, minY: RAMP_R },
        { x: endSegmentCenter, z, length: endSegmentLength, yaw: 0, nx: 0, nz: signZ, minY: RAMP_R }
      );
      if (!this.basketballMode) {
        panels.push({
          x: 0,
          z,
          length: GOAL_W + GOAL_MOUTH_R * 2,
          minY: GOAL_H,
          yaw: 0,
          nx: 0,
          nz: signZ,
          ramp: false,
          goalHeader: true
        });
      }
    }

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const nx = sx * Math.SQRT1_2;
        const nz = sz * Math.SQRT1_2;
        panels.push({
          x: sx * (halfWidth - CORNER_R * 0.5) + nx * WALL_T * 0.5,
          z: sz * (halfLength - CORNER_R * 0.5) + nz * WALL_T * 0.5,
          length: CORNER_R * Math.SQRT2,
          yaw: Math.atan2(nx, nz),
          nx,
          nz,
          minY: RAMP_R,
          arenaCorner: true
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
      const length = this.visualPanelLength(panel, options.lengthScale ?? 1.0);
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
      const length = this.visualPanelLength(panel, options.lengthScale ?? 1.025);
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
    const lowerPanels = this.splitVisualPanelsByTeam(panels).filter(
      (panel) => panel.ramp !== false
        && this.panelGlassMinY(panel) > (panel.minY ?? 0) + 0.05
    );
    if (lowerPanels.length === 0) return;

    for (const teamSign of [-1, 1]) {
      const teamPanels = lowerPanels.filter((panel) => this.panelTeamSign(panel) === teamSign);
      if (teamPanels.length === 0) continue;
      const material = this.createTeamRampMaterial(teamSign);
      this.createPanelSurfaceMesh(teamPanels, material, {
        minY: (panel) => panel.minY ?? 0,
        maxY: (panel) => this.panelGlassMinY(panel),
        lengthScale: 1.018,
        tileWidth: 3.2,
        tileHeight: 2.4,
        name: teamSign > 0 ? 'arena-orange-kick-wall' : 'arena-blue-kick-wall',
        shadowRole: 'arena-surface'
      });
    }
  }

  createHexGlassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 296;
    const ctx = canvas.getContext('2d');
    const radiusX = canvas.width / 3;
    const radiusY = canvas.height / 2;
    const columnStep = canvas.width / 2;
    const rowStep = canvas.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = this.ultraHigh ? 2.4 : 2.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,255,255,.82)';
    ctx.shadowBlur = this.ultraHigh ? 7 : 4;

    // Two staggered columns are one seamless repeat. Drawing cells beyond the
    // canvas bounds makes every clipped edge continue in the next texture tile.
    for (let column = -2; column <= 3; column++) {
      const centerX = column * columnStep;
      const stagger = Math.abs(column % 2) * rowStep * 0.5;
      for (let row = -2; row <= 2; row++) {
        const centerY = row * rowStep + stagger;
        ctx.beginPath();
        ctx.moveTo(centerX + radiusX, centerY);
        ctx.lineTo(centerX + radiusX * 0.5, centerY + radiusY);
        ctx.lineTo(centerX - radiusX * 0.5, centerY + radiusY);
        ctx.lineTo(centerX - radiusX, centerY);
        ctx.lineTo(centerX - radiusX * 0.5, centerY - radiusY);
        ctx.lineTo(centerX + radiusX * 0.5, centerY - radiusY);
        ctx.closePath();
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  createHexGlassGrid(panels) {
    if (this.lowDetail) return;
    const texture = this.hexGlassTexture ??= this.createHexGlassTexture();
    const visualPanels = this.splitVisualPanelsByTeam(panels);
    const colors = new Map([
      [-1, 0x158dff],
      [0, 0x83d9ff],
      [1, 0xff6a28]
    ]);
    for (const teamSign of [-1, 0, 1]) {
      const teamPanels = visualPanels.filter((panel) => this.panelTeamSign(panel) === teamSign);
      if (teamPanels.length === 0) continue;
      const material = new THREE.MeshBasicMaterial({
        color: colors.get(teamSign),
        map: texture,
        transparent: true,
        opacity: this.ultraHigh ? 0.58 : 0.46,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      this.createPanelSurfaceMesh(teamPanels, material, {
        minY: (panel) => this.panelGlassMinY(panel),
        maxY: (panel) => {
          const minY = this.panelGlassMinY(panel);
          const naturalMaxY = panel.upperRamp === false ? WALL_H : WALL_H - CEILING_R;
          return panel.height ? minY + panel.height : Math.max(minY + 0.2, naturalMaxY);
        },
        lengthScale: 1.01,
        tileWidth: 13.8,
        tileHeight: 7.96,
        surfaceOffset: 0.026,
        name: teamSign > 0
          ? 'arena-orange-hex-glass-lines'
          : teamSign < 0
            ? 'arena-blue-hex-glass-lines'
            : 'arena-neutral-hex-glass-lines',
        renderOrder: 6,
        shadowRole: 'glass'
      });
    }

    // Keep one slim team-coloured rail at ground level. The old black rectangular
    // cage members are gone; the hex overlay now carries the full glass pattern.
    const accentPanels = visualPanels.filter((panel) => this.panelTeamSign(panel) !== 0);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const accentMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const accents = new THREE.InstancedMesh(geometry, accentMaterial, accentPanels.length);
    accents.name = 'arena-team-lower-accent';
    accents.userData.shadowRole = 'arena-frame';
    const blue = new THREE.Color(0x078fff);
    const orange = new THREE.Color(0xff6208);
    const dummy = new THREE.Object3D();
    for (let panelIndex = 0; panelIndex < accentPanels.length; panelIndex++) {
      const panel = accentPanels[panelIndex];
      const minY = this.panelGlassMinY(panel);
      const surfaceX = panel.x - panel.nx * (WALL_T * 0.5 + 0.018);
      const surfaceZ = panel.z - panel.nz * (WALL_T * 0.5 + 0.018);
      dummy.position.set(surfaceX, minY + 0.14, surfaceZ);
      dummy.rotation.set(0, panel.yaw, 0);
      dummy.scale.set(this.visualPanelLength(panel, 1.022), 0.16, 0.27);
      dummy.updateMatrix();
      accents.setMatrixAt(panelIndex, dummy.matrix);
      accents.setColorAt(panelIndex, this.panelTeamSign(panel) > 0 ? orange : blue);
    }
    accents.instanceMatrix.needsUpdate = true;
    if (accents.instanceColor) accents.instanceColor.needsUpdate = true;
    accents.renderOrder = 7;
    this.group.add(accents);
  }

  createTeamSideRibbons() {
    if (this.lowDetail) return;
    const halfWidth = FIELD_W * 0.5;
    const halfLength = FIELD_L * 0.5;
    const straightZ = halfLength - CORNER_R;
    const endStraightX = halfWidth - CORNER_R;
    const roundedGoalHalf = GOAL_W * 0.5 + GOAL_MOUTH_R;
    const endSpan = Math.max(1, endStraightX - roundedGoalHalf);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

    // 12 long side-wall ribbons + 8 end-wall ribbons. All use one instanced
    // draw call and no real lights, so the stronger team separation is almost
    // free even on phones.
    const ribbons = new THREE.InstancedMesh(geometry, material, 20);
    ribbons.name = 'arena-team-side-ribbons';
    ribbons.userData.shadowRole = 'arena-frame';
    ribbons.renderOrder = 6;
    const orange = new THREE.Color(0xff6508);
    const blue = new THREE.Color(0x078fff);
    const dummy = new THREE.Object3D();
    let index = 0;
    const ribbonHeights = [
      GLASS_START_Y + 0.52,
      GLASS_START_Y + (WALL_H - CEILING_R - GLASS_START_Y) * 0.50,
      WALL_H - CEILING_R - 0.46
    ];

    for (const signX of [-1, 1]) {
      for (const signZ of [-1, 1]) {
        for (const ribbonY of ribbonHeights) {
          dummy.position.set(
            signX * (halfWidth - 0.045),
            ribbonY,
            signZ * straightZ * 0.5
          );
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.22, 0.30, straightZ * 0.985);
          dummy.updateMatrix();
          ribbons.setMatrixAt(index, dummy.matrix);
          ribbons.setColorAt(index, signZ > 0 ? orange : blue);
          index += 1;
        }
      }
    }

    const endCenter = roundedGoalHalf + endSpan * 0.5;
    const endHeights = [GLASS_START_Y + 0.58, WALL_H - CEILING_R - 0.52];
    for (const signZ of [-1, 1]) {
      for (const signX of [-1, 1]) {
        for (const ribbonY of endHeights) {
          dummy.position.set(
            signX * endCenter,
            ribbonY,
            signZ * (halfLength - 0.045)
          );
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(endSpan * 0.98, 0.30, 0.22);
          dummy.updateMatrix();
          ribbons.setMatrixAt(index, dummy.matrix);
          ribbons.setColorAt(index, signZ > 0 ? orange : blue);
          index += 1;
        }
      }
    }

    ribbons.count = index;
    ribbons.instanceMatrix.needsUpdate = true;
    if (ribbons.instanceColor) ribbons.instanceColor.needsUpdate = true;
    this.group.add(ribbons);
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

    this.createHexGlassGrid(panels);
    this.createTeamSideRibbons();

    const straightX = FIELD_W * 0.5 - CORNER_R;
    const straightZ = FIELD_L * 0.5 - CORNER_R;
    const halfWidth = FIELD_W * 0.5;
    const halfLength = FIELD_L * 0.5;
    const supportPositions = [
      [-halfWidth, -straightZ], [-halfWidth, straightZ], [halfWidth, -straightZ], [halfWidth, straightZ],
      [-straightX, -halfLength], [straightX, -halfLength], [-straightX, halfLength], [straightX, halfLength]
    ];

    // Do not place full-height arena supports on the two goal-mouth edges.
    // The rounded goal rim already defines those edges; a normal wall support
    // there would continue far above GOAL_H and read as a goal post sticking
    // through the roof. Leaving the mouth free lets the coloured rounded rim
    // terminate cleanly at the upper goal curve.
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
    const rampPanels = this.splitVisualPanelsByTeam(panels).filter((panel) => panel.ramp !== false);
    for (const teamSign of [-1, 1]) {
      const teamPanels = rampPanels.filter((panel) => this.panelTeamSign(panel) === teamSign);
      if (teamPanels.length === 0) continue;
      const material = this.createTeamRampMaterial(teamSign);
      this.createRoundedRampSurfaceMesh(teamPanels, RAMP_R, RAMP_R, false, material, {
        tileWidth: 3.6,
        tileHeight: 3.2,
        lengthScale: 1.028,
        name: teamSign > 0 ? 'arena-orange-lower-quarter-pipe' : 'arena-blue-lower-quarter-pipe',
        shadowRole: 'arena-surface'
      });
    }
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
    const roundedPanels = panels.filter((panel) => !panel.goalMouth);
    const wallHeight = Math.max(0.4, GOAL_H - GOAL_R * 2);

    // A single continuous inner face replaces the old row of scaled cubes.
    // Its UVs follow every mouth/back fillet so the tile pattern and silhouette
    // remain visually connected from the field wall into the tunnel.
    this.createPanelSurfaceMesh(panels, wallMaterial, {
      // The horizontal mouth fillet is already rounded in plan. Giving every
      // tiny fillet panel another vertical quarter-pipe creates a fan of long
      // plates that sticks into the field above and below the goal. A clean
      // full-height mouth wall removes that overhang; the tunnel proper keeps
      // its smooth floor/ceiling transitions.
      minY: (panel) => panel.goalMouth ? 0 : GOAL_R,
      maxY: (panel) => panel.goalMouth ? GOAL_H : GOAL_R + wallHeight,
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
    this.createRoundedTunnelRampVisual(roundedPanels, GOAL_R, GOAL_H, false, lowerMaterial);
    this.createRoundedTunnelRampVisual(roundedPanels, GOAL_R, GOAL_H, true, upperMaterial);
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

  createBasketballHoop(sign) {
    const signZ = sign >= 0 ? 1 : -1;
    const isOrange = signZ > 0;
    const teamColor = isOrange ? 0xff7419 : 0x1d8cff;
    const rimZ = signZ * (FIELD_L * 0.5 - BASKETBALL_HOOP.wallInset);
    const backboardZ = rimZ + signZ * BASKETBALL_HOOP.backboardOffset;
    const backboardY = BASKETBALL_HOOP.backboardBottom + BASKETBALL_HOOP.backboardHeight * 0.5;
    const supportZ = signZ * (FIELD_L * 0.5 - 2.0);
    const halfW = BASKETBALL_HOOP.backboardWidth * 0.5;
    const halfH = BASKETBALL_HOOP.backboardHeight * 0.5;
    const frameThickness = BASKETBALL_HOOP.backboardBeamThickness;
    const beamHalf = frameThickness * 0.5;

    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d242d,
      emissive: teamColor,
      emissiveIntensity: this.ultraHigh ? 0.24 : 0.12,
      roughness: 0.32,
      metalness: 0.82
    });
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(BASKETBALL_HOOP.rimRadius, BASKETBALL_HOOP.rimTubeRadius, this.ultraHigh ? 20 : 14, this.ultraHigh ? 72 : 48),
      rimMaterial
    );
    rim.rotation.x = Math.PI * 0.5;
    rim.position.set(0, BASKETBALL_HOOP.height, rimZ);
    rim.name = isOrange ? 'basketball-rim-orange' : 'basketball-rim-blue';
    this.group.add(rim);

    const rimGlow = new THREE.Mesh(
      new THREE.TorusGeometry(BASKETBALL_HOOP.rimRadius + 0.12, Math.max(0.12, BASKETBALL_HOOP.rimTubeRadius * 0.18), 10, this.ultraHigh ? 72 : 48),
      new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: this.ultraHigh ? 0.95 : 0.78 })
    );
    rimGlow.rotation.x = Math.PI * 0.5;
    rimGlow.position.set(0, BASKETBALL_HOOP.height + BASKETBALL_HOOP.rimTubeRadius * 0.58, rimZ);
    rimGlow.name = isOrange ? 'basketball-rim-glow-orange' : 'basketball-rim-glow-blue';
    this.group.add(rimGlow);

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a232d,
      emissive: teamColor,
      emissiveIntensity: this.ultraHigh ? 0.28 : 0.18,
      roughness: 0.44,
      metalness: 0.76
    });
    const lightMaterial = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: this.ultraHigh ? 0.90 : 0.72 });
    const addFrameBeam = (x, y, w, h) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w, h, BASKETBALL_HOOP.backboardDepth), frameMaterial);
      beam.position.set(x, y, backboardZ);
      beam.name = 'basketball-backboard-frame';
      this.group.add(beam);

      const lightDepth = 0.08;
      const lightInsetX = Math.min(0.20, w * 0.16);
      const lightInsetY = Math.min(0.20, h * 0.16);
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.12, w - lightInsetX * 2), Math.max(0.12, h - lightInsetY * 2), lightDepth),
        lightMaterial
      );
      light.position.set(x, y, backboardZ - signZ * (BASKETBALL_HOOP.backboardDepth * 0.5 - lightDepth * 0.5));
      light.name = 'basketball-backboard-light';
      this.group.add(light);
    };
    addFrameBeam(0, BASKETBALL_HOOP.backboardBottom + beamHalf, BASKETBALL_HOOP.backboardWidth, frameThickness);
    addFrameBeam(0, BASKETBALL_HOOP.backboardBottom + BASKETBALL_HOOP.backboardHeight - beamHalf, BASKETBALL_HOOP.backboardWidth, frameThickness);
    addFrameBeam(-halfW + beamHalf, backboardY, frameThickness, BASKETBALL_HOOP.backboardHeight - frameThickness * 0.2);
    addFrameBeam(halfW - beamHalf, backboardY, frameThickness, BASKETBALL_HOOP.backboardHeight - frameThickness * 0.2);

    const targetMaterial = new THREE.LineBasicMaterial({ color: 0xf7fbff, transparent: true, opacity: 0.92 });
    const targetW = BASKETBALL_HOOP.backboardWidth * 0.52;
    const targetH = targetW * 0.58;
    const targetY = backboardY + BASKETBALL_HOOP.backboardHeight * 0.02;
    const targetZ = backboardZ - signZ * (BASKETBALL_HOOP.backboardDepth * 0.5 + 0.025);
    const targetPoints = [
      new THREE.Vector3(-targetW / 2, targetY - targetH / 2, targetZ), new THREE.Vector3(targetW / 2, targetY - targetH / 2, targetZ),
      new THREE.Vector3(targetW / 2, targetY - targetH / 2, targetZ), new THREE.Vector3(targetW / 2, targetY + targetH / 2, targetZ),
      new THREE.Vector3(targetW / 2, targetY + targetH / 2, targetZ), new THREE.Vector3(-targetW / 2, targetY + targetH / 2, targetZ),
      new THREE.Vector3(-targetW / 2, targetY + targetH / 2, targetZ), new THREE.Vector3(-targetW / 2, targetY - targetH / 2, targetZ)
    ];
    const target = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(targetPoints), targetMaterial);
    target.name = 'basketball-backboard-target';
    this.group.add(target);

    const netPoints = [];
    const ringLevels = 5;
    const netSegments = this.ultraHigh ? 22 : 16;
    const topRadius = BASKETBALL_HOOP.rimRadius * 0.98;
    const bottomRadius = BASKETBALL_HOOP.netBottomRadius;
    for (let level = 0; level < ringLevels; level++) {
      const t = level / (ringLevels - 1);
      const radius = THREE.MathUtils.lerp(topRadius, bottomRadius, Math.pow(t, 0.82));
      const y = BASKETBALL_HOOP.height - THREE.MathUtils.lerp(0.12, BASKETBALL_HOOP.netDepth, Math.pow(t, 1.08));
      for (let index = 0; index < netSegments; index++) {
        const angle = index / netSegments * Math.PI * 2;
        const next = (index + 1) / netSegments * Math.PI * 2;
        const point = new THREE.Vector3(Math.cos(angle) * radius, y, rimZ + Math.sin(angle) * radius);
        const pointNext = new THREE.Vector3(Math.cos(next) * radius, y, rimZ + Math.sin(next) * radius);
        netPoints.push(point, pointNext);
        if (level < ringLevels - 1) {
          const nextT = (level + 1) / (ringLevels - 1);
          const nextRadius = THREE.MathUtils.lerp(topRadius, bottomRadius, Math.pow(nextT, 0.82));
          const nextY = BASKETBALL_HOOP.height - THREE.MathUtils.lerp(0.12, BASKETBALL_HOOP.netDepth, Math.pow(nextT, 1.08));
          const down = new THREE.Vector3(Math.cos(angle) * nextRadius, nextY, rimZ + Math.sin(angle) * nextRadius);
          const skew = new THREE.Vector3(Math.cos(next) * nextRadius, nextY, rimZ + Math.sin(next) * nextRadius);
          netPoints.push(point, down, point, skew);
        }
      }
    }
    const net = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(netPoints),
      new THREE.LineBasicMaterial({ color: 0xf3f6f6, transparent: true, opacity: this.ultraHigh ? 0.58 : 0.48 })
    );
    net.name = 'basketball-net';
    this.group.add(net);

    const supportMaterial = new THREE.MeshStandardMaterial({ color: 0x263746, roughness: 0.52, metalness: 0.66 });
    const postHeight = backboardY + halfH + 1.4;
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.45, postHeight, 1.45), supportMaterial);
    post.position.set(0, postHeight * 0.5, supportZ);
    post.name = 'basketball-support-post';
    this.group.add(post);

    const upperJointY = backboardY + halfH + 0.7;
    const rearJointY = upperJointY + 0.3;
    const spineLength = Math.max(1.2, Math.abs(backboardZ - supportZ));
    const spine = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, spineLength), supportMaterial);
    spine.position.set(0, rearJointY, (backboardZ + supportZ) * 0.5);
    spine.name = 'basketball-support-spine';
    this.group.add(spine);

    const createBrace = (targetX, targetY, targetZ) => {
      const start = new THREE.Vector3(0, rearJointY, supportZ);
      const end = new THREE.Vector3(targetX, targetY, targetZ);
      const delta = end.clone().sub(start);
      const length = delta.length();
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, length), supportMaterial);
      brace.position.copy(start.clone().add(end).multiplyScalar(0.5));
      brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
      brace.name = 'basketball-support-brace';
      this.group.add(brace);
    };
    createBrace(-halfW * 0.92, backboardY + halfH * 0.76, backboardZ - signZ * 0.12);
    createBrace(halfW * 0.92, backboardY + halfH * 0.76, backboardZ - signZ * 0.12);
  }

  createGoal(sign) {
    const signZ = sign >= 0 ? 1 : -1;
    const zThroat = signZ * (FIELD_L * 0.5 + GOAL_MOUTH_R);
    const isOrange = signZ > 0;
    const color = isOrange ? 0xff6800 : 0x087dff;
    const darkColor = isOrange ? 0x2f2119 : 0x152536;
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
          color: this.ultraHigh ? 0xffffff : 0xf5faf9,
          map: wallTexture,
          bumpMap: wallBump,
          bumpScale: this.ultraHigh ? 0.075 : 0,
          emissive: color,
          emissiveIntensity: this.ultraHigh ? 0.040 : 0.060,
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
          color: isOrange ? 0x85796d : 0x687888,
          map: floorTexture,
          bumpMap: floorBump,
          bumpScale: this.ultraHigh ? 0.052 : 0,
          emissive: color,
          emissiveIntensity: this.ultraHigh ? 0.030 : 0.045,
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
      context.fillStyle = isOrange ? '#ff7b21' : '#3d9cff';
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
    // The arena never moves, so all static colliders can share one fixed rigid
    // body. Rapier still keeps every collider/query shape intact, but avoids
    // hundreds of redundant fixed-body allocations and body bookkeeping entries.
    this.staticPhysicsBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    this.world.createCollider(
      R.ColliderDesc.cuboid(FIELD_W / 2, 0.2, FIELD_L / 2)
        .setTranslation(0, -0.2, 0)
        .setFriction(0.72)
        .setRestitution(0)
        .setContactSkin(0.01),
      this.staticPhysicsBody
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

    if (!this.basketballMode) {
      for (const sign of [-1, 1]) {
        const panels = this.buildGoalBoundarySegments(sign);
        const wallHeight = Math.max(0.4, GOAL_H - GOAL_R * 2);
        for (const panel of panels) {
          const isMouthFillet = panel.goalMouth === true;
          const panelMinY = isMouthFillet ? 0 : GOAL_R;
          const panelHeight = isMouthFillet ? GOAL_H : wallHeight;
          this.addFixedColliderRotated(
            panel.x,
            panelMinY + panelHeight * 0.5,
            panel.z,
            panel.length * 0.5 * 1.02,
            panelHeight * 0.5,
            WALL_T * 0.5,
            panel.yaw,
            0.12,
            0
          );
          // Match the corrected render geometry: the mouth curve itself is a
          // vertical wall, so no hidden quarter-pipe collider may protrude into
          // the playable field above or below it.
          if (!isMouthFillet) {
            this.addRoundedTunnelRampPhysics(panel, GOAL_R, GOAL_H, false, 0.72);
            this.addRoundedTunnelRampPhysics(panel, GOAL_R, GOAL_H, true, 0.16);
          }
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
    } else {
      this.createBasketballPhysics();
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

  createBasketballPhysics() {
    const R = this.RAPIER;
    const halfLength = FIELD_L * 0.5;
    const beamHalf = BASKETBALL_HOOP.backboardBeamThickness * 0.5;
    for (const sign of [-1, 1]) {
      const signZ = sign >= 0 ? 1 : -1;
      const rimZ = signZ * (halfLength - BASKETBALL_HOOP.wallInset);
      const backboardZ = rimZ + signZ * BASKETBALL_HOOP.backboardOffset;
      const backboardY = BASKETBALL_HOOP.backboardBottom + BASKETBALL_HOOP.backboardHeight * 0.5;
      const halfW = BASKETBALL_HOOP.backboardWidth * 0.5;
      this.addFixedCollider(
        0, BASKETBALL_HOOP.backboardBottom + beamHalf, backboardZ,
        halfW,
        beamHalf,
        BASKETBALL_HOOP.backboardDepth * 0.5,
        0.45, 0.34
      );
      this.addFixedCollider(
        0, BASKETBALL_HOOP.backboardBottom + BASKETBALL_HOOP.backboardHeight - beamHalf, backboardZ,
        halfW,
        beamHalf,
        BASKETBALL_HOOP.backboardDepth * 0.5,
        0.45, 0.34
      );
      this.addFixedCollider(
        -halfW + beamHalf, backboardY, backboardZ,
        beamHalf,
        BASKETBALL_HOOP.backboardHeight * 0.5,
        BASKETBALL_HOOP.backboardDepth * 0.5,
        0.45, 0.34
      );
      this.addFixedCollider(
        halfW - beamHalf, backboardY, backboardZ,
        beamHalf,
        BASKETBALL_HOOP.backboardHeight * 0.5,
        BASKETBALL_HOOP.backboardDepth * 0.5,
        0.45, 0.34
      );

      // Approximate the torus with small fixed spheres. This keeps local Rapier
      // practice close to the authoritative Go torus collision without a mesh collider.
      const segments = 28;
      for (let index = 0; index < segments; index++) {
        const angle = index / segments * Math.PI * 2;
        const x = Math.cos(angle) * BASKETBALL_HOOP.rimRadius;
        const z = rimZ + Math.sin(angle) * BASKETBALL_HOOP.rimRadius;
        this.world.createCollider(
          R.ColliderDesc.ball(BASKETBALL_HOOP.rimTubeRadius)
            .setTranslation(x, BASKETBALL_HOOP.height, z)
            .setFriction(0.42)
            .setRestitution(0.46)
            .setContactSkin(0.01),
          this.staticPhysicsBody
        );
      }

      // The visual net is approximated with several ring levels of tiny fixed
      // spheres so offline practice also gets a tangible bounce from the mesh.
      const netLevels = 5;
      const netSegments = 18;
      const topRadius = BASKETBALL_HOOP.rimRadius * 0.98;
      const colliderRadius = 0.18;
      for (let level = 0; level < netLevels; level++) {
        const t = level / (netLevels - 1);
        const radius = THREE.MathUtils.lerp(topRadius, BASKETBALL_HOOP.netBottomRadius, Math.pow(t, 0.82));
        const y = BASKETBALL_HOOP.height - THREE.MathUtils.lerp(0.12, BASKETBALL_HOOP.netDepth, Math.pow(t, 1.08));
        for (let index = 0; index < netSegments; index++) {
          const angle = index / netSegments * Math.PI * 2;
          const x = Math.cos(angle) * radius;
          const z = rimZ + Math.sin(angle) * radius;
          this.world.createCollider(
            R.ColliderDesc.ball(colliderRadius)
              .setTranslation(x, y, z)
              .setFriction(0.36)
              .setRestitution(0.30)
              .setContactSkin(0.005),
            this.staticPhysicsBody
          );
        }
      }
    }
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
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setFriction(friction)
        .setRestitution(restitution)
        .setContactSkin(0.01),
      this.staticPhysicsBody
    );
  }

  addFixedColliderRotated(x, y, z, hx, hy, hz, yaw, friction, restitution) {
    const R = this.RAPIER;
    const halfYaw = yaw * 0.5;
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) })
        .setFriction(friction)
        .setRestitution(restitution)
        .setContactSkin(0.01),
      this.staticPhysicsBody
    );
  }

  addFixedColliderQuaternion(x, y, z, hx, hy, hz, quaternion, friction, restitution) {
    const R = this.RAPIER;
    this.world.createCollider(
      R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
        .setFriction(friction)
        .setRestitution(restitution)
        .setContactSkin(0.01),
      this.staticPhysicsBody
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
    const trunkMaterial = new THREE.MeshBasicMaterial({ color: this.ultraHigh ? 0x3c2d32 : 0x5f432e });
    const crownMaterial = new THREE.MeshBasicMaterial({ color: this.ultraHigh ? 0x183e35 : 0x2f6f40 });
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
    const colors = this.ultraHigh
      ? [
          new THREE.Color(0x263343), new THREE.Color(0x1e2c3b), new THREE.Color(0x334052),
          new THREE.Color(0x202b38)
        ]
      : [
          new THREE.Color(0x657986), new THREE.Color(0x506775), new THREE.Color(0x7a8790),
          new THREE.Color(0x485f6b)
        ];
    const buildingData = [];
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 + 0.05;
      const radiusX = FIELD_W * 0.5 + 62 + (index % 3) * 5;
      const radiusZ = FIELD_L * 0.5 + 62 + (index % 4) * 4;
      const height = 10 + (index % 7) * 2.8;
      const width = 6 + (index % 4) * 1.7;
      const depth = 6 + ((index + 2) % 4) * 1.5;
      const x = Math.sin(angle) * radiusX;
      const z = Math.cos(angle) * radiusZ;
      dummy.position.set(x, height * 0.5 - 0.05, z);
      dummy.rotation.set(0, -angle * 0.32, 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      buildings.setMatrixAt(index, dummy.matrix);
      buildings.setColorAt(index, colors[index % colors.length]);
      buildingData.push({ x, z, height, width, depth });
    }
    buildings.instanceMatrix.needsUpdate = true;
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    this.group.add(buildings);

    if (this.ultraHigh) {
      // A few glowing window ribbons make the distant city feel alive at dusk.
      // They are unlit instanced boxes (one draw call), not dozens of PointLights.
      const rowsPerBuilding = this.mobile ? 2 : 3;
      const windowGeometry = new THREE.BoxGeometry(1, 1, 1);
      const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: true });
      const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, count * rowsPerBuilding);
      const warm = new THREE.Color(0xffbd70);
      const cool = new THREE.Color(0x72cfff);
      let windowIndex = 0;
      for (let index = 0; index < buildingData.length; index++) {
        const data = buildingData[index];
        const inwardX = -data.x;
        const inwardZ = -data.z;
        const inwardLength = Math.hypot(inwardX, inwardZ) || 1;
        const nx = inwardX / inwardLength;
        const nz = inwardZ / inwardLength;
        const yaw = Math.atan2(nx, nz);
        for (let row = 0; row < rowsPerBuilding; row++) {
          const y = 2.4 + (row + 1) * (data.height - 3.4) / (rowsPerBuilding + 1);
          dummy.position.set(
            data.x + nx * (data.depth * 0.5 + 0.08),
            y,
            data.z + nz * (data.depth * 0.5 + 0.08)
          );
          dummy.rotation.set(0, yaw, 0);
          dummy.scale.set(data.width * (0.38 + (row % 2) * 0.08), 0.34, 0.07);
          dummy.updateMatrix();
          windows.setMatrixAt(windowIndex, dummy.matrix);
          windows.setColorAt(windowIndex, (index + row) % 4 === 0 ? cool : warm);
          windowIndex++;
        }
      }
      windows.instanceMatrix.needsUpdate = true;
      if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
      windows.userData.cameraOcclusionIgnore = true;
      this.group.add(windows);
    }
  }


  createUltraHighStadiumDetails() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    // The old freestanding steel strips had no supporting structure. From the
    // wall camera they appeared as random black bars floating outside the map,
    // especially in High mode. Keep the purposeful floodlights only.
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: 0xf1f7ff,
      emissive: 0xb7dcff,
      emissiveIntensity: 1.45,
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
    lamps.name = 'arena-ultra-stadium-lamps';
    lamps.userData.cameraOcclusionIgnore = true;
    this.group.add(lamps);
  }

  updateVisuals() {
    // Kept for Game's generic arena update hook. 3D grass was removed in
    // v1.10.23, so the arena no longer needs per-frame visibility work.
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(
      this.ultraHigh ? 0x5f79a8 : 0xb9dded,
      this.ultraHigh ? 0x172a24 : 0x33553b,
      this.lowDetail ? 1.70 : (this.ultraHigh ? 1.02 : 1.72)
    );
    this.scene.add(hemi);

    // Ultra High is a permanent blue-hour/moonlight scene. This directional
    // light is the only shadow caster; the additional fills below are shadowless
    // and therefore comparatively cheap while keeping the field actively lit.
    const key = new THREE.DirectionalLight(
      this.ultraHigh ? 0xc6ddff : 0xffe6bd,
      this.lowDetail ? 1.55 : (this.ultraHigh ? 1.62 : 2.02)
    );
    if (this.ultraHigh) key.position.set(-78, 92, -118);
    else key.position.set(-34, 62, -28);
    key.castShadow = this.ultraHigh;
    if (this.ultraHigh) {
      const shadowSize = this.mobile ? 1024 : 2048;
      key.shadow.mapSize.set(shadowSize, shadowSize);
      key.shadow.camera.left = -88;
      key.shadow.camera.right = 88;
      key.shadow.camera.top = 112;
      key.shadow.camera.bottom = -112;
      key.shadow.camera.near = 10;
      key.shadow.camera.far = 230;
      key.shadow.bias = -0.00016;
      key.shadow.normalBias = 0.042;
      key.shadow.radius = this.mobile ? 1.4 : 1.8;
    }
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(
      this.ultraHigh ? 0x789dff : 0xaedcff,
      this.lowDetail ? 0.34 : (this.ultraHigh ? 0.34 : 0.52)
    );
    fill.position.set(34, 38, 42);
    fill.castShadow = false;
    this.scene.add(fill);

    if (this.ultraHigh) {
      const duskRim = new THREE.DirectionalLight(0xff8b70, 0.34);
      duskRim.position.set(72, 24, -92);
      duskRim.castShadow = false;
      this.scene.add(duskRim);

      const overhead = new THREE.DirectionalLight(0x9fbfff, this.mobile ? 0.18 : 0.24);
      overhead.position.set(0, 90, 8);
      overhead.castShadow = false;
      this.scene.add(overhead);
    }
  }
}
