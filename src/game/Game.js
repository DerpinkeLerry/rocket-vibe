import * as THREE from 'three';
import { Arena } from './Arena.js';
import { Ball } from './Ball.js';
import { BoostPads } from './BoostPads.js';
import { Car } from './Car.js';
import { ChaseCamera } from './ChaseCamera.js';
import { Input } from './Input.js';
import { MobileControls } from './MobileControls.js';
import { Hud } from './Hud.js';
import { getPerformanceProfile, togglePerformanceProfile } from './PerformanceProfile.js';
import { VirtualInput } from '../network/VirtualInput.js';
import { LocalCarPredictor } from '../network/LocalCarPredictor.js';
import { ARENA_TUNING } from '../shared/arena-tuning.js';
import { DEFAULT_CAR_STYLE, normalizeCarStyle } from '../shared/car-styles.js';

const CLIENT_INPUT_HEARTBEAT_HZ = 15;

const PLAYER_CONFIGS = [
  { spawn: { x: -13, y: 0.52, z: 44 }, spawnYaw: 0, color: 0xf46b20, team: 'orange' },
  { spawn: { x: -13, y: 0.52, z: -44 }, spawnYaw: Math.PI, color: 0x238cff, team: 'blue' },
  { spawn: { x: 13, y: 0.52, z: 44 }, spawnYaw: 0, color: 0xffa51f, team: 'orange' },
  { spawn: { x: 13, y: 0.52, z: -44 }, spawnYaw: Math.PI, color: 0x35d7ff, team: 'blue' }
];

export class Game {
  constructor(root, RAPIER, network = null, options = {}) {
    this.root = root;
    this.RAPIER = RAPIER;
    this.network = network;
    this.networked = Boolean(network);
    this.playerId = network?.playerId ?? 0;
    this.playerName = network?.playerName || options.playerName || 'Spieler';
    this.playerCarStyle = normalizeCarStyle(network?.carStyle || options.carStyle || DEFAULT_CAR_STYLE);
    this.playerTeam = network?.team === 'blue' ? 'blue' : 'orange';
    this.profile = getPerformanceProfile(this.networked);

    this.fixedDt = 1 / 60;
    this.accumulator = 0;
    this.lastTime = performance.now() / 1000;
    this.lastRenderTime = 0;
    this.renderInterval = 1 / 60;
    this.inputAccumulator = 0;
    this.hudAccumulator = 0;
    this.latestNetworkState = null;
    this.latestNetworkStateReceivedAt = 0;
    this.lastReconciledTick = -1;
    this.rosterSignature = '';
    this.connectedPlayers = new Set(network?.connectedPlayers ?? (this.networked ? [this.playerId] : [0]));
    this.orangeScore = 0;
    this.blueScore = 0;

    this.perfElapsed = 0;
    this.perfFrames = 0;
    this.measuredFps = 60;
    this.renderPixelRatio = Math.min(window.devicePixelRatio || 1, this.profile.initialPixelRatio);

    this.scene = new THREE.Scene();
    // Bright daylight is intentionally cheap: a flat background + light fog do
    // most of the work, while the sky dome below is a single unlit draw call.
    const daylightSky = 0x9fd3ed;
    this.scene.background = new THREE.Color(daylightSky);
    this.scene.fog = this.profile.useFog ? new THREE.Fog(0xb8d7e3, 150, 345) : null;

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, this.profile.ultra ? 230 : 390);
    this.camera.position.set(0, 5, 10);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      precision: this.profile.ultra ? 'mediump' : 'highp',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false
    });
    this.renderer.setPixelRatio(this.renderPixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = false;
    this.renderer.sortObjects = !this.profile.ultra;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.profile.useToneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.root.appendChild(this.renderer.domElement);
    this.root.classList.toggle('perf-ultra', this.profile.ultra);

    // In online mode Railway owns all real physics. The browser uses tiny JS
    // transform stores instead of loading/stepping Rapier/WASM.
    if (this.networked) {
      this.world = null;
    } else {
      this.world = new RAPIER.World({ x: 0, y: -20.5, z: 0 });
      this.world.timestep = this.fixedDt;
      this.world.numSolverIterations = 8;
      this.world.maxCcdSubsteps = 4;
    }

    this.input = new Input();
    this.passiveInput = new VirtualInput();
    this.arena = new Arena(this.scene, this.world, RAPIER, {
      lowDetail: this.profile.lowDetail,
      createPhysics: !this.networked
    });
    this.boostPads = new BoostPads(this.scene, { lowDetail: this.profile.lowDetail });

    const initialCarStyles = new Map((network?.players ?? []).map((player) => [
      Number(player?.playerId),
      normalizeCarStyle(player?.carStyle)
    ]));

    this.cars = PLAYER_CONFIGS.map((config, index) => new Car(
      this.scene,
      this.world,
      RAPIER,
      !this.networked && index === 0 ? this.input : this.passiveInput,
      {
        ...config,
        lowDetail: this.profile.lowDetail,
        clientOnly: this.networked,
        playerName: index === this.playerId ? this.playerName : `Spieler ${index + 1}`,
        carStyle: index === this.playerId ? this.playerCarStyle : (initialCarStyles.get(index) || DEFAULT_CAR_STYLE),
        localPlayer: index === this.playerId
      }
    ));
    [this.car0, this.car1, this.car2, this.car3] = this.cars;
    this.ball = new Ball(this.scene, this.world, RAPIER, this.passiveInput, {
      lowDetail: this.profile.lowDetail,
      clientOnly: this.networked
    });

    if (this.networked) {
      this.setRoster(network?.players ?? [...this.connectedPlayers], network?.maxPlayers ?? 4);
    } else {
      for (let i = 1; i < this.cars.length; i++) this.setCarVisible(i, false);
      this.car0.setPlayerIdentity(this.playerName, 'orange', true);
      this.car0.setCarStyle(this.playerCarStyle);
    }

    this.car = this.cars[this.playerId] ?? this.car0;
    this.localPredictor = this.networked
      ? new LocalCarPredictor(this.car, {
          simulationHz: this.profile.predictionHz,
          lowLatency: this.profile.ultra
        })
      : null;
    this.chaseCamera = new ChaseCamera(this.camera, this.car, this.ball, this.scene);
    this.hud = new Hud(this.root, {
      lan: this.networked,
      playerId: this.playerId,
      playerCount: this.connectedPlayers.size,
      maxPlayers: network?.maxPlayers ?? 4,
      performanceProfile: this.profile.name,
      playerName: this.playerName,
      team: this.playerTeam
    });
    this.mobileControls = new MobileControls(this.root, this.input);
    this.mobileControls.setCameraMode?.(this.chaseCamera.getMode());

    if (this.network) {
      this.network.onStatus = (text) => this.hud.setNetworkStatus(text);
      this.network.onState = (state) => {
        this.latestNetworkState = state;
        this.latestNetworkStateReceivedAt = performance.now() / 1000;
      };
      this.network.onRoster = (players, maxPlayers) => this.setRoster(players, maxPlayers);
      this.network.onLatency = (rttMs) => this.hud.setPing(rttMs);

      // Key transitions bypass requestAnimationFrame and go to Railway immediately.
      this.input.setNetworkChangeHandler(() => this.sendNetworkInput());
      this.sendNetworkInput();
      this.hud.setNetworkStatus(this.network.statusText('ONLINE'));
    }

    this.netPos = new THREE.Vector3();
    this.netTargetPos = new THREE.Vector3();
    this.netQuat = new THREE.Quaternion();
    this.netTargetQuat = new THREE.Quaternion();
    this.netAngAxis = new THREE.Vector3();
    this.netDeltaQuat = new THREE.Quaternion();

    if (this.profile.useSky) this.addSkyDecoration();

    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
    this.onPerfToggle = this.onPerfToggle.bind(this);
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.addEventListener('keydown', this.onPerfToggle, { passive: false });
    this.onResize();
  }

  onPerfToggle(event) {
    if (event.code !== 'F2' || event.repeat) return;
    event.preventDefault();
    togglePerformanceProfile();
  }

  setCarVisible(index, visible) {
    const car = this.cars[index];
    if (!car) return;
    car.group.visible = visible;
    if (car.shadow) car.shadow.visible = visible;
  }

  setRoster(players, maxPlayers = 4) {
    const roster = (players ?? []).map((player) => {
      if (typeof player === 'object' && player !== null) {
        return {
          playerId: Number(player.playerId),
          name: String(player.name || `Spieler ${Number(player.playerId) + 1}`).slice(0, 16),
          team: player.team === 'blue' ? 'blue' : 'orange',
          carStyle: normalizeCarStyle(player.carStyle)
        };
      }
      const playerId = Number(player);
      return { playerId, name: `Spieler ${playerId + 1}`, team: playerId % 2 === 0 ? 'orange' : 'blue', carStyle: DEFAULT_CAR_STYLE };
    }).filter((player) => Number.isInteger(player.playerId) && player.playerId >= 0 && player.playerId < this.cars.length);
    const signature = roster.map((player) => `${player.playerId}:${player.name}:${player.team}:${player.carStyle}`).join('|');
    if (signature === this.rosterSignature) return;
    this.rosterSignature = signature;
    this.connectedPlayers = new Set(roster.map((player) => player.playerId));
    for (const player of roster) {
      const car = this.cars[player.playerId];
      car?.setPlayerIdentity(player.name, player.team, player.playerId === this.playerId);
      car?.setCarStyle(player.carStyle);
    }
    if (this.networked) {
      for (let i = 0; i < this.cars.length; i++) this.setCarVisible(i, this.connectedPlayers.has(i));
    }
    this.hud?.setPlayerCount(this.connectedPlayers.size, maxPlayers);
  }

  addSkyDecoration() {
    // One very low-poly vertex-coloured dome gives us a daylight gradient with
    // no texture lookup, post processing, shadow map, or dynamic update cost.
    const radius = 260;
    const domeGeometry = new THREE.SphereGeometry(
      radius,
      this.profile.lowDetail ? 16 : 24,
      this.profile.lowDetail ? 8 : 12
    );
    const positions = domeGeometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const horizon = new THREE.Color(0xdce8e3);
    const midSky = new THREE.Color(0x92cae8);
    const zenith = new THREE.Color(0x5eafe0);
    const color = new THREE.Color();
    for (let index = 0; index < positions.count; index++) {
      const h = THREE.MathUtils.clamp(positions.getY(index) / radius, -1, 1);
      if (h < 0.18) {
        color.copy(horizon).lerp(midSky, THREE.MathUtils.clamp((h + 0.18) / 0.36, 0, 1));
      } else {
        color.copy(midSky).lerp(zenith, THREE.MathUtils.clamp((h - 0.18) / 0.82, 0, 1));
      }
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    domeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const dome = new THREE.Mesh(
      domeGeometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false
      })
    );
    dome.position.y = 18;
    dome.renderOrder = -10;
    dome.userData.cameraOcclusionIgnore = true;
    this.scene.add(dome);

    // Static sun sprite. No shadow casting: the directional light supplies the
    // daylight cue without allocating a shadow texture.
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xfff1b0,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: true,
      fog: false
    }));
    sun.position.set(-118, 104, -156);
    sun.scale.set(24, 24, 1);
    sun.userData.cameraOcclusionIgnore = true;
    this.scene.add(sun);

    // A handful of flattened, instanced cloud blobs break up the empty sky.
    // Even in normal mode this remains one draw call.
    const cloudGeometry = new THREE.SphereGeometry(1, this.profile.lowDetail ? 5 : 7, 4);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xf7fbff,
      transparent: true,
      opacity: this.profile.lowDetail ? 0.34 : 0.46,
      depthWrite: false,
      fog: false
    });
    const cloudGroups = this.profile.lowDetail ? 6 : 11;
    const blobsPerCloud = 3;
    const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, cloudGroups * blobsPerCloud);
    const dummy = new THREE.Object3D();
    let instance = 0;
    for (let group = 0; group < cloudGroups; group++) {
      const angle = -2.65 + group * (5.3 / Math.max(1, cloudGroups - 1));
      const baseX = Math.sin(angle) * 150;
      const baseZ = Math.cos(angle) * 185;
      const baseY = 44 + (group % 3) * 7;
      for (let blob = 0; blob < blobsPerCloud; blob++) {
        dummy.position.set(baseX + (blob - 1) * 5.2, baseY + (blob === 1 ? 1.4 : 0), baseZ);
        dummy.rotation.set(0, angle * 0.4, 0);
        dummy.scale.set(8.5 - blob * 0.8, 1.8 + (blob === 1 ? 0.5 : 0), 3.6 + blob * 0.5);
        dummy.updateMatrix();
        clouds.setMatrixAt(instance++, dummy.matrix);
      }
    }
    clouds.instanceMatrix.needsUpdate = true;
    clouds.userData.cameraOcclusionIgnore = true;
    this.scene.add(clouds);
  }

  start() {
    for (const car of this.cars) car.syncVisual();
    this.ball.syncVisual();
    this.hud.setPerformance(this.profile.name, this.measuredFps, this.renderPixelRatio);
    requestAnimationFrame(this.loop);
  }

  loop(nowMs) {
    const now = nowMs / 1000;
    const frameDt = Math.min(now - this.lastTime, 0.08);
    this.lastTime = now;

    this.perfElapsed += frameDt;
    this.perfFrames += 1;
    this.updateAdaptivePerformance();

    if (this.networked) {
      this.inputAccumulator += frameDt;
      if (this.inputAccumulator >= 1 / CLIENT_INPUT_HEARTBEAT_HZ) {
        this.inputAccumulator %= 1 / CLIENT_INPUT_HEARTBEAT_HZ;
        this.sendNetworkInput();
      }

      this.applyNetworkState(frameDt, now);
      this.localPredictor?.step(frameDt);
    } else {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < 4) {
        this.stepOffline(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps += 1;
      }
      if (steps === 4 && this.accumulator > this.fixedDt * 2) this.accumulator = this.fixedDt;
    }

    if (this.lastRenderTime === 0 || now - this.lastRenderTime >= this.renderInterval - 0.001) {
      const renderDt = this.lastRenderTime === 0 ? frameDt : Math.min(now - this.lastRenderTime, 0.08);
      this.lastRenderTime = now;

      for (const car of this.cars) if (car.group.visible) car.syncVisual();
      this.ball.syncVisual();
      if (this.input.consumePressed('KeyC')) {
        const cameraMode = this.chaseCamera.toggleMode();
        this.hud.setCameraMode(cameraMode);
        this.mobileControls.setCameraMode?.(cameraMode);
      }
      this.boostPads.update(renderDt);
      this.chaseCamera.update(renderDt);

      this.hudAccumulator += renderDt;
      if (this.hudAccumulator >= 1 / this.profile.hudHz) {
        this.hudAccumulator = 0;
        this.hud.update(this.car);
      }

      this.chaseCamera.prepareRender();
      try {
        this.renderer.render(this.scene, this.camera);
      } finally {
        this.chaseCamera.restoreOccluders();
      }
    }

    requestAnimationFrame(this.loop);
  }

  updateAdaptivePerformance() {
    if (this.perfElapsed < 1.5) return;

    const fps = this.perfFrames / this.perfElapsed;
    this.measuredFps = this.measuredFps * 0.55 + fps * 0.45;
    this.perfElapsed = 0;
    this.perfFrames = 0;

    if (this.profile.adaptiveResolution) {
      let next = this.renderPixelRatio;
      if (this.measuredFps < 52) next -= 0.06;
      else if (this.measuredFps > 59) next += 0.02;

      const dpr = window.devicePixelRatio || 1;
      next = THREE.MathUtils.clamp(next, this.profile.minPixelRatio, Math.min(this.profile.maxPixelRatio, dpr));
      if (Math.abs(next - this.renderPixelRatio) >= 0.015) {
        this.renderPixelRatio = next;
        this.renderer.setPixelRatio(this.renderPixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      }
    }

    this.hud.setPerformance(this.profile.name, this.measuredFps, this.renderPixelRatio);
  }

  sendNetworkInput() {
    if (!this.networked) return;
    const packet = this.input.takeNetworkPacket();
    this.localPredictor?.setInput(packet);
    this.network.sendInput(packet);
  }

  stepOffline(dt) {
    if (this.input.consumePressed('KeyB')) this.ball.reset();
    this.car0.fixedUpdate(dt);
    this.ball.fixedUpdate(dt);
    this.ball.prepareCarHit(this.car0);
    this.world.step();
    this.ball.applyPreparedCarHit();
    this.car0.enforceSpeedLimit();
    this.boostPads.updateOffline(this.car0, dt);
    this.detectOfflineGoal();
  }

  detectOfflineGoal() {
    const position = this.ball.body.translation();
    const halfLength = ARENA_TUNING.length * 0.5;
    if (Math.abs(position.z) <= halfLength + this.ball.radius * 0.35) return;
    if (Math.abs(position.x) + this.ball.radius > ARENA_TUNING.goalWidth * 0.5
      || position.y + this.ball.radius > ARENA_TUNING.goalHeight) return;
    if (position.z > 0) this.blueScore += 1;
    else this.orangeScore += 1;
    this.car0.reset();
    this.ball.reset();
    this.boostPads.resetAll();
    this.hud.setScore(this.orangeScore, this.blueScore);
  }

  applyNetworkState(dt, now) {
    const state = this.latestNetworkState;
    if (!state?.ball || !Array.isArray(state.cars) || state.cars.length < 4) return;

    if (Array.isArray(state.connected)) {
      const connectedIds = [];
      for (let i = 0; i < state.connected.length; i++) if (state.connected[i]) connectedIds.push(i);
      const roster = (this.network?.players ?? []).filter((player) => connectedIds.includes(Number(player.playerId)));
      this.setRoster(roster.length > 0 ? roster : connectedIds, this.network?.maxPlayers ?? 4);
    }

    this.hud.setScore(state.orangeScore, state.blueScore);
    this.boostPads.setActiveMask(state.boostPadMask);

    const packetAge = Math.max(0, now - this.latestNetworkStateReceivedAt);
    const rttMs = this.network?.rttMs ?? 0;
    const newSnapshot = state.tick !== this.lastReconciledTick;

    for (let i = 0; i < this.cars.length; i++) {
      const target = state.cars[i];
      if (!target) continue;

      if (i === this.playerId) {
        // Reconcile each authoritative snapshot once. Re-applying the same old
        // snapshot every render frame creates an artificial "rubber band" delay.
        if (newSnapshot) this.localPredictor?.reconcile(target, dt, packetAge, rttMs);
      } else {
        this.smoothRemoteBody(this.cars[i].body, target, dt, packetAge, rttMs, 28, 0.12);
        this.cars[i].grounded = Boolean(target.g);
        if (Number.isFinite(Number(target.b))) this.cars[i].setBoost(target.b);
      }
    }

    this.smoothRemoteBody(this.ball.body, state.ball, dt, packetAge, rttMs, 30, 0.10);
    if (newSnapshot) this.lastReconciledTick = state.tick;
  }

  smoothRemoteBody(body, target, dt, packetAge, rttMs, response = 28, maxLead = 0.12) {
    const alpha = 1 - Math.exp(-response * dt);
    const p = body.translation();
    const r = body.rotation();
    const lead = THREE.MathUtils.clamp(packetAge + Math.max(0, rttMs) * 0.00035, 0, maxLead);

    this.netPos.set(p.x, p.y, p.z);
    this.netTargetPos.fromArray(target.p);
    this.netTargetPos.x += target.v[0] * lead;
    this.netTargetPos.y += target.v[1] * lead;
    this.netTargetPos.z += target.v[2] * lead;
    this.netPos.lerp(this.netTargetPos, alpha);

    this.netQuat.set(r.x, r.y, r.z, r.w);
    this.netTargetQuat.fromArray(target.r).normalize();
    const angularSpeed = Math.hypot(target.w[0], target.w[1], target.w[2]);
    if (angularSpeed > 0.00001 && lead > 0) {
      this.netAngAxis.set(target.w[0], target.w[1], target.w[2]).multiplyScalar(1 / angularSpeed);
      this.netDeltaQuat.setFromAxisAngle(this.netAngAxis, angularSpeed * lead);
      this.netTargetQuat.premultiply(this.netDeltaQuat).normalize();
    }
    this.netQuat.slerp(this.netTargetQuat, alpha);

    body.setTranslation({ x: this.netPos.x, y: this.netPos.y, z: this.netPos.z }, false);
    body.setRotation({ x: this.netQuat.x, y: this.netQuat.y, z: this.netQuat.z, w: this.netQuat.w }, false);
    body.setLinvel({ x: target.v[0], y: target.v[1], z: target.v[2] }, false);
    body.setAngvel({ x: target.w[0], y: target.w[1], z: target.w[2] }, false);
  }

  onResize() {
    const width = Math.max(1, this.root.clientWidth || window.innerWidth);
    const height = Math.max(1, this.root.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.fov = this.mobileControls?.enabled && height > width ? 78 : 72;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
