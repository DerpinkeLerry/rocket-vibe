import * as THREE from 'three';

// RLBot reference: supersonic begins at 2200 uu/s and the hard cap is
// 2300 uu/s (79.2 and 82.8 km/h respectively).
const SPEED_START_KMH = 79.2;
const SPEED_FULL_KMH = 82.8;
const PULSE_SPEED_KMH = 81.0;
const TRAIL_LIFE = 0.82;
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const RING_NORMAL = new THREE.Vector3(0, 0, 1);

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function getHighSpeedIntensity(speedKmh) {
  return smoothstep01((Number(speedKmh || 0) - SPEED_START_KMH) / (SPEED_FULL_KMH - SPEED_START_KMH));
}

export class HighSpeedEffects {
  constructor(scene, car, options = {}) {
    this.scene = scene;
    this.car = car;
    this.mobile = Boolean(options.mobile);
    this.maxTrailSamples = this.mobile ? 22 : 34;
    this.maxStreaks = this.mobile ? 16 : 30;
    this.intensity = 0;
    this.previousSpeedKmh = 0;
    this.sampleAccumulator = 0;
    this.streakAccumulator = 0;
    this.pulseLife = 0;
    this.pulseCooldown = 0;
    this.history = [];
    this.accent = new THREE.Color(0x65d9ff);
    this.secondary = new THREE.Color(0xffffff);
    this.velocity = new THREE.Vector3();
    this.velocityDirection = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.work = new THREE.Vector3();
    this.workB = new THREE.Vector3();
    this.lastAccentHex = -1;

    this.createTrail();
    this.createAirflow();
    this.createPulse();
    this.createAeroLight();
  }

  createTrail() {
    const maxVertices = Math.max(4, (this.maxTrailSamples - 1) * 4);
    this.trailPositions = new Float32Array(maxVertices * 3);
    this.trailColors = new Float32Array(maxVertices * 3);
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailPositionAttribute = new THREE.BufferAttribute(this.trailPositions, 3);
    this.trailColorAttribute = new THREE.BufferAttribute(this.trailColors, 3);
    this.trailPositionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.trailColorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.trailGeometry.setAttribute('position', this.trailPositionAttribute);
    this.trailGeometry.setAttribute('color', this.trailColorAttribute);
    this.trailGeometry.setDrawRange(0, 0);

    this.trailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.mobile ? 0.48 : 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    this.trail = new THREE.LineSegments(this.trailGeometry, this.trailMaterial);
    this.trail.name = 'ultra-high-speed-ribbon';
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 11;
    this.trail.userData.cameraOcclusionIgnore = true;
    this.trail.visible = false;
    this.scene.add(this.trail);
  }

  createAirflow() {
    this.streakPositions = new Float32Array(this.maxStreaks * 2 * 3);
    this.streakColors = new Float32Array(this.maxStreaks * 2 * 3);
    this.streaks = Array.from({ length: this.maxStreaks }, () => ({
      life: 0,
      maxLife: 1,
      length: 1,
      position: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 0, -1),
      drift: new THREE.Vector3(),
      color: new THREE.Color()
    }));
    this.streakGeometry = new THREE.BufferGeometry();
    this.streakPositionAttribute = new THREE.BufferAttribute(this.streakPositions, 3);
    this.streakColorAttribute = new THREE.BufferAttribute(this.streakColors, 3);
    this.streakPositionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.streakColorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.streakGeometry.setAttribute('position', this.streakPositionAttribute);
    this.streakGeometry.setAttribute('color', this.streakColorAttribute);

    this.streakMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.mobile ? 0.34 : 0.46,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    this.airflow = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    this.airflow.name = 'ultra-high-airflow-streaks';
    this.airflow.frustumCulled = false;
    this.airflow.renderOrder = 10;
    this.airflow.userData.cameraOcclusionIgnore = true;
    this.airflow.visible = false;
    this.scene.add(this.airflow);
  }

  createPulse() {
    this.pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.04, this.mobile ? 32 : 56), this.pulseMaterial);
    this.pulse.name = 'ultra-high-speed-pulse';
    this.pulse.visible = false;
    this.pulse.frustumCulled = false;
    this.pulse.renderOrder = 12;
    this.pulse.userData.cameraOcclusionIgnore = true;
    this.scene.add(this.pulse);
  }

  createAeroLight() {
    this.aeroLight = new THREE.PointLight(0x65d9ff, 0, this.mobile ? 5 : 7, 2.1);
    this.aeroLight.name = 'ultra-high-speed-aero-light';
    this.aeroLight.castShadow = false;
    this.scene.add(this.aeroLight);
  }

  updateAccent() {
    const hex = Number(this.car?.boostStyle?.primary ?? this.car?.paintColor ?? 0x65d9ff) >>> 0;
    if (hex === this.lastAccentHex) return;
    this.lastAccentHex = hex;
    this.accent.setHex(hex);
    this.secondary.copy(this.accent).lerp(new THREE.Color(0xffffff), 0.68);
    this.pulseMaterial.color.copy(this.secondary);
    this.aeroLight.color.copy(this.accent);
  }

  update(dt, enabled = true) {
    const safeDt = THREE.MathUtils.clamp(Number(dt) || 0, 0, 0.08);
    const bodyVelocity = this.car?.body?.linvel?.() || { x: 0, y: 0, z: 0 };
    this.velocity.set(Number(bodyVelocity.x) || 0, Number(bodyVelocity.y) || 0, Number(bodyVelocity.z) || 0);
    const speedKmh = this.velocity.length() * 3.6;
    const target = enabled ? getHighSpeedIntensity(speedKmh) : 0;
    const response = 1 - Math.exp(-(target > this.intensity ? 4.8 : 6.2) * safeDt);
    this.intensity = THREE.MathUtils.lerp(this.intensity, target, response);
    this.updateAccent();

    if (this.velocity.lengthSq() > 0.001) this.velocityDirection.copy(this.velocity).normalize();
    else this.velocityDirection.copy(FORWARD).applyQuaternion(this.car.group.quaternion).normalize();
    this.right.copy(RIGHT).applyQuaternion(this.car.group.quaternion).normalize();
    this.up.copy(UP).applyQuaternion(this.car.group.quaternion).normalize();
    this.forward.copy(FORWARD).applyQuaternion(this.car.group.quaternion).normalize();

    this.updateTrail(safeDt, enabled);
    this.updateAirflow(safeDt, enabled);
    this.updatePulse(safeDt, speedKmh, enabled);
    this.updateAeroLight();
    this.previousSpeedKmh = speedKmh;
    this.pulseCooldown = Math.max(0, this.pulseCooldown - safeDt);
  }

  updateTrail(dt, enabled) {
    for (const sample of this.history) sample.age += dt;
    this.history = this.history.filter((sample) => sample.age <= TRAIL_LIFE);

    const sampleInterval = this.mobile ? 1 / 36 : 1 / 54;
    if (enabled && this.intensity > 0.025) {
      this.sampleAccumulator += dt;
      while (this.sampleAccumulator >= sampleInterval) {
        this.sampleAccumulator -= sampleInterval;
        this.history.unshift({
          age: 0,
          position: this.car.group.position.clone(),
          right: this.right.clone(),
          up: this.up.clone()
        });
        if (this.history.length > this.maxTrailSamples) this.history.length = this.maxTrailSamples;
      }
    } else {
      this.sampleAccumulator = Math.min(this.sampleAccumulator, sampleInterval);
    }

    let vertex = 0;
    const sideOffset = 0.68;
    const verticalOffset = 0.06;
    for (let index = 0; index < this.history.length - 1 && vertex + 4 <= this.trailPositions.length / 3; index++) {
      const current = this.history[index];
      const next = this.history[index + 1];
      const fadeA = Math.max(0, 1 - current.age / TRAIL_LIFE) * this.intensity;
      const fadeB = Math.max(0, 1 - next.age / TRAIL_LIFE) * this.intensity;
      for (const side of [-1, 1]) {
        this.writeTrailVertex(vertex++, current, side, sideOffset, verticalOffset, fadeA);
        this.writeTrailVertex(vertex++, next, side, sideOffset, verticalOffset, fadeB);
      }
    }
    this.trailGeometry.setDrawRange(0, vertex);
    this.trailPositionAttribute.needsUpdate = true;
    this.trailColorAttribute.needsUpdate = true;
    this.trail.visible = vertex > 0 && this.intensity > 0.008;
  }

  writeTrailVertex(vertex, sample, side, sideOffset, verticalOffset, fade) {
    const offset = vertex * 3;
    this.work.copy(sample.position)
      .addScaledVector(sample.right, side * sideOffset)
      .addScaledVector(sample.up, verticalOffset);
    this.trailPositions[offset] = this.work.x;
    this.trailPositions[offset + 1] = this.work.y;
    this.trailPositions[offset + 2] = this.work.z;

    const edgeMix = side < 0 ? 0.14 : 0.28;
    const brightness = fade * (1.05 + this.intensity * 1.1);
    this.workColor ??= new THREE.Color();
    this.workColor.copy(this.accent).lerp(this.secondary, edgeMix).multiplyScalar(brightness);
    this.trailColors[offset] = this.workColor.r;
    this.trailColors[offset + 1] = this.workColor.g;
    this.trailColors[offset + 2] = this.workColor.b;
  }

  spawnStreak() {
    let streak = this.streaks.find((candidate) => candidate.life <= 0);
    if (!streak) streak = this.streaks[Math.floor(Math.random() * this.streaks.length)];

    const lateral = (Math.random() * 2 - 1) * (2.2 + Math.random() * 2.8);
    const vertical = (Math.random() * 2 - 0.35) * (1.0 + Math.random() * 1.8);
    const forward = 1.5 + Math.random() * 5.5;
    streak.position.copy(this.car.group.position)
      .addScaledVector(this.right, lateral)
      .addScaledVector(this.up, vertical)
      .addScaledVector(this.velocityDirection, forward);
    streak.direction.copy(this.velocityDirection);
    streak.drift.copy(this.velocity).multiplyScalar(0.06 + Math.random() * 0.07);
    streak.length = 0.65 + this.intensity * (1.1 + Math.random() * 2.2);
    streak.life = 0.13 + Math.random() * 0.17;
    streak.maxLife = streak.life;
    streak.color.copy(Math.random() > 0.54 ? this.secondary : this.accent);
  }

  updateAirflow(dt, enabled) {
    if (enabled && this.intensity > 0.04) {
      const spawnRate = (this.mobile ? 10 : 18) * this.intensity;
      this.streakAccumulator += spawnRate * dt;
      const count = Math.min(4, Math.floor(this.streakAccumulator));
      this.streakAccumulator -= count;
      for (let index = 0; index < count; index++) this.spawnStreak();
    } else {
      this.streakAccumulator = Math.min(this.streakAccumulator, 0.5);
    }

    let active = 0;
    for (let index = 0; index < this.maxStreaks; index++) {
      const streak = this.streaks[index];
      const base = index * 6;
      if (streak.life <= 0) {
        for (let i = 0; i < 6; i++) {
          this.streakPositions[base + i] = 0;
          this.streakColors[base + i] = 0;
        }
        continue;
      }

      streak.life -= dt;
      if (streak.life <= 0) {
        for (let i = 0; i < 6; i++) {
          this.streakPositions[base + i] = 0;
          this.streakColors[base + i] = 0;
        }
        continue;
      }
      active += 1;
      streak.position.addScaledVector(streak.drift, dt);
      this.workB.copy(streak.direction).multiplyScalar(streak.length);
      const fade = Math.max(0, streak.life / streak.maxLife) * this.intensity;
      const brightness = fade * (0.72 + this.intensity * 0.78);

      this.streakPositions[base] = streak.position.x;
      this.streakPositions[base + 1] = streak.position.y;
      this.streakPositions[base + 2] = streak.position.z;
      this.streakPositions[base + 3] = streak.position.x - this.workB.x;
      this.streakPositions[base + 4] = streak.position.y - this.workB.y;
      this.streakPositions[base + 5] = streak.position.z - this.workB.z;
      for (let endpoint = 0; endpoint < 2; endpoint++) {
        const colorOffset = base + endpoint * 3;
        const endpointFade = endpoint === 0 ? 1 : 0.28;
        this.streakColors[colorOffset] = streak.color.r * brightness * endpointFade;
        this.streakColors[colorOffset + 1] = streak.color.g * brightness * endpointFade;
        this.streakColors[colorOffset + 2] = streak.color.b * brightness * endpointFade;
      }
    }
    this.streakPositionAttribute.needsUpdate = true;
    this.streakColorAttribute.needsUpdate = true;
    this.airflow.visible = active > 0 && this.intensity > 0.01;
  }

  updatePulse(dt, speedKmh, enabled) {
    if (enabled && speedKmh >= PULSE_SPEED_KMH && this.previousSpeedKmh < PULSE_SPEED_KMH && this.pulseCooldown <= 0) {
      this.pulseLife = 0.46;
      this.pulseCooldown = 1.7;
      this.pulse.position.copy(this.car.group.position).addScaledVector(this.velocityDirection, -0.8);
      this.pulse.quaternion.setFromUnitVectors(RING_NORMAL, this.velocityDirection);
      this.pulse.scale.setScalar(1.15);
      this.pulse.visible = true;
    }

    if (this.pulseLife <= 0) {
      this.pulse.visible = false;
      this.pulseMaterial.opacity = 0;
      return;
    }

    this.pulseLife = Math.max(0, this.pulseLife - dt);
    const progress = 1 - this.pulseLife / 0.46;
    const fade = Math.sin(Math.PI * THREE.MathUtils.clamp(progress, 0, 1));
    const scale = THREE.MathUtils.lerp(1.15, this.mobile ? 3.4 : 4.4, progress);
    this.pulse.scale.setScalar(scale);
    this.pulseMaterial.opacity = fade * (this.mobile ? 0.075 : 0.105) * Math.max(0.35, this.intensity);
    this.pulse.visible = this.pulseLife > 0;
  }

  updateAeroLight() {
    if (!this.aeroLight) return;
    this.aeroLight.position.copy(this.car.group.position)
      .addScaledVector(this.forward, -0.9)
      .addScaledVector(this.up, 0.15);
    this.aeroLight.intensity = this.intensity * (this.mobile ? 1.25 : 2.1);
  }

  clear() {
    this.history.length = 0;
    this.intensity = 0;
    this.sampleAccumulator = 0;
    this.streakAccumulator = 0;
    this.pulseLife = 0;
    this.trail.visible = false;
    this.airflow.visible = false;
    this.pulse.visible = false;
    this.aeroLight.intensity = 0;
    this.trailGeometry.setDrawRange(0, 0);
    for (const streak of this.streaks) streak.life = 0;
  }

  dispose() {
    this.scene.remove(this.trail, this.airflow, this.pulse, this.aeroLight);
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    this.streakGeometry.dispose();
    this.streakMaterial.dispose();
    this.pulse.geometry.dispose();
    this.pulseMaterial.dispose();
    this.aeroLight.dispose?.();
  }
}
