import * as THREE from 'three';

const FLOOR_Y = 0.09;
const RING_SEGMENTS = 16;
const MAX_TICKS = 8;
const MAX_SEGMENTS = RING_SEGMENTS + 4 + 1 + MAX_TICKS;
const MIN_RANGE_LINE_DISTANCE = 12;
const RANGE_TICK_METERS = 20;

function bodyTranslation(body) {
  const p = body?.translation?.();
  if (!p) return null;
  return { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 };
}

export class UltraLowBallCue {
  constructor(scene, root, ball, car, camera) {
    this.scene = scene;
    this.root = root;
    this.ball = ball;
    this.car = car;
    this.camera = camera;
    this.positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setDrawRange(0, 0);

    // One tiny dynamic line draw call replaces expensive lighting/shadows as a
    // depth cue in Ultra Low. The ring anchors the ball to the floor, the stem
    // communicates height and the sparse 20 m ticks make long range readable.
    this.material = new THREE.LineBasicMaterial({
      color: 0xc9efff,
      depthTest: true,
      depthWrite: false,
      toneMapped: false
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.name = 'ultra-low-ball-depth-cue';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.scene.add(this.lines);

    this.label = document.createElement('div');
    this.label.className = 'ultra-low-ball-range';
    this.label.hidden = true;
    this.label.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.label);

    this.projected = new THREE.Vector3();
    this.lastLabelText = '';
  }

  writeSegment(index, ax, ay, az, bx, by, bz) {
    const offset = index * 6;
    this.positions[offset] = ax;
    this.positions[offset + 1] = ay;
    this.positions[offset + 2] = az;
    this.positions[offset + 3] = bx;
    this.positions[offset + 4] = by;
    this.positions[offset + 5] = bz;
    return index + 1;
  }

  update() {
    const ballPosition = bodyTranslation(this.ball?.body);
    const carPosition = bodyTranslation(this.car?.body);
    if (!ballPosition || !carPosition || this.ball?.mesh?.visible === false || this.car?.group?.visible === false) {
      this.lines.visible = false;
      this.label.hidden = true;
      return;
    }

    const dx = ballPosition.x - carPosition.x;
    const dz = ballPosition.z - carPosition.z;
    const dy = ballPosition.y - carPosition.y;
    const groundDistance = Math.hypot(dx, dz);
    const spatialDistance = Math.hypot(dx, dy, dz);
    const ballHeight = Math.max(0, ballPosition.y - (Number(this.ball?.radius) || 0));
    const cueStrength = THREE.MathUtils.smoothstep(groundDistance, 8, 24);

    // Nearby balls already have plenty of perspective information. Fade the
    // helper out there so Ultra Low stays uncluttered during close control.
    this.lines.visible = cueStrength > 0.02;
    let segment = 0;
    if (this.lines.visible) {
      const ringRadius = THREE.MathUtils.lerp(2.75, 3.75, THREE.MathUtils.clamp(groundDistance / 100, 0, 1));
      for (let index = 0; index < RING_SEGMENTS; index++) {
        const a0 = index / RING_SEGMENTS * Math.PI * 2;
        const a1 = (index + 1) / RING_SEGMENTS * Math.PI * 2;
        segment = this.writeSegment(
          segment,
          ballPosition.x + Math.cos(a0) * ringRadius,
          FLOOR_Y,
          ballPosition.z + Math.sin(a0) * ringRadius,
          ballPosition.x + Math.cos(a1) * ringRadius,
          FLOOR_Y,
          ballPosition.z + Math.sin(a1) * ringRadius
        );
      }

      const cross = ringRadius * 1.35;
      segment = this.writeSegment(segment, ballPosition.x - cross, FLOOR_Y, ballPosition.z, ballPosition.x - ringRadius * 0.7, FLOOR_Y, ballPosition.z);
      segment = this.writeSegment(segment, ballPosition.x + ringRadius * 0.7, FLOOR_Y, ballPosition.z, ballPosition.x + cross, FLOOR_Y, ballPosition.z);
      segment = this.writeSegment(segment, ballPosition.x, FLOOR_Y, ballPosition.z - cross, ballPosition.x, FLOOR_Y, ballPosition.z - ringRadius * 0.7);
      segment = this.writeSegment(segment, ballPosition.x, FLOOR_Y, ballPosition.z + ringRadius * 0.7, ballPosition.x, FLOOR_Y, ballPosition.z + cross);

      // The vertical stem is the important height cue: even at a tiny internal
      // resolution the player can instantly see whether the ball is on the floor
      // or several car-heights above it.
      const stemTop = Math.max(FLOOR_Y, ballPosition.y - (Number(this.ball?.radius) || 0) * 0.92);
      segment = this.writeSegment(segment, ballPosition.x, FLOOR_Y, ballPosition.z, ballPosition.x, stemTop, ballPosition.z);

      if (groundDistance >= MIN_RANGE_LINE_DISTANCE) {
        const invDistance = 1 / Math.max(groundDistance, 0.001);
        const ux = dx * invDistance;
        const uz = dz * invDistance;
        const startDistance = Math.min(3.5, groundDistance * 0.18);
        segment = this.writeSegment(
          segment,
          carPosition.x + ux * startDistance,
          FLOOR_Y,
          carPosition.z + uz * startDistance,
          ballPosition.x - ux * ringRadius,
          FLOOR_Y,
          ballPosition.z - uz * ringRadius
        );

        const px = -uz;
        const pz = ux;
        const tickHalf = 0.72;
        let ticks = 0;
        for (let meters = RANGE_TICK_METERS; meters < groundDistance - ringRadius && ticks < MAX_TICKS; meters += RANGE_TICK_METERS) {
          const tx = carPosition.x + ux * meters;
          const tz = carPosition.z + uz * meters;
          segment = this.writeSegment(
            segment,
            tx - px * tickHalf,
            FLOOR_Y,
            tz - pz * tickHalf,
            tx + px * tickHalf,
            FLOOR_Y,
            tz + pz * tickHalf
          );
          ticks += 1;
        }
      }

      this.geometry.setDrawRange(0, segment * 2);
      this.positionAttribute.needsUpdate = true;
    }

    // A tiny numeric readout removes the final ambiguity at extreme range. It
    // follows the ball but only appears outside close-control distance.
    this.projected.set(ballPosition.x, ballPosition.y + (Number(this.ball?.radius) || 0) + 1.35, ballPosition.z).project(this.camera);
    const onScreen = this.projected.z > -1 && this.projected.z < 1
      && Math.abs(this.projected.x) < 1.08
      && Math.abs(this.projected.y) < 1.08;
    if (!onScreen || groundDistance < 14) {
      this.label.hidden = true;
      return;
    }

    const width = Math.max(1, this.root.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, this.root.clientHeight || window.innerHeight || 1);
    const x = (this.projected.x * 0.5 + 0.5) * width;
    const y = (-this.projected.y * 0.5 + 0.5) * height;
    const roundedRange = Math.round(spatialDistance);
    const roundedHeight = Math.round(ballHeight);
    const labelText = roundedHeight >= 4 ? `${roundedRange} m  ↑${roundedHeight} m` : `${roundedRange} m`;
    if (labelText !== this.lastLabelText) {
      this.label.textContent = labelText;
      this.lastLabelText = labelText;
    }
    this.label.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -115%)`;
    this.label.style.opacity = String(THREE.MathUtils.clamp(cueStrength * 0.92, 0.28, 0.92));
    this.label.hidden = false;
  }

  dispose() {
    this.scene.remove(this.lines);
    this.geometry.dispose();
    this.material.dispose();
    this.label.remove();
  }
}
