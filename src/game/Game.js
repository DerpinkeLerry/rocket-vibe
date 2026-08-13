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
import { ReplayBuffer, sampleReplayFrames } from './ReplayBuffer.js';
import { GoalExplosion } from './GoalExplosion.js';
import { ARENA_TUNING } from '../shared/arena-tuning.js';
import { DEFAULT_CAR_STYLE, normalizeCarStyle } from '../shared/car-styles.js';

const CLIENT_INPUT_HEARTBEAT_HZ = 15;

const PLAYER_CONFIGS = [
  { spawn: { x: -13, y: 0.52, z: 44 }, spawnYaw: 0, color: 0xf45a13, team: 'orange' },
  { spawn: { x: -13, y: 0.52, z: -44 }, spawnYaw: Math.PI, color: 0x087dff, team: 'blue' },
  { spawn: { x: 13, y: 0.52, z: 44 }, spawnYaw: 0, color: 0xff8b16, team: 'orange' },
  { spawn: { x: 13, y: 0.52, z: -44 }, spawnYaw: Math.PI, color: 0x23bfff, team: 'blue' }
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
    this.profile = getPerformanceProfile(this.networked, options.graphicsMode);

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
    this.kickoffActive = false;
    this.replayActive = false;
    this.replayWaiting = false;
    this.replayFrames = [];
    this.replayStartedAt = 0;
    this.replayPlaybackSeconds = 5;
    this.replayState = null;
    this.replayBuffer = new ReplayBuffer(network?.serverHz ?? 60, 8);
    this.goalCelebrationActive = false;
    this.goalCelebrationUntil = 0;
    this.offlineGoalTimeRemaining = 0;
    this.offlineQuickChatUsed = 0;
    this.offlineQuickChatCooldownUntil = 0;

    this.perfElapsed = 0;
    this.perfFrames = 0;
    this.measuredFps = 60;
    this.shadowFrameCounter = 0;
    this.renderPixelRatio = this.profile.ultraHigh
      ? this.profile.initialPixelRatio
      : Math.min(window.devicePixelRatio || 1, this.profile.initialPixelRatio);

    this.scene = new THREE.Scene();
    // Bright daylight is intentionally cheap: a flat background + light fog do
    // most of the work, while the sky dome below is a single unlit draw call.
    const daylightSky = this.profile.ultraHigh ? 0x5687ad : 0x7fb4d3;
    this.scene.background = new THREE.Color(daylightSky);
    this.scene.fog = this.profile.useFog
      ? new THREE.Fog(this.profile.ultraHigh ? 0x6f8790 : 0x9bb9c5, 155, 360)
      : null;

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, this.profile.ultraLow ? 230 : (this.profile.ultraHigh ? 520 : 390));
    this.camera.position.set(0, 5, 10);

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.profile.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      precision: this.profile.ultraLow ? 'mediump' : 'highp',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false
    });
    this.renderer.setPixelRatio(this.renderPixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.profile.useShadows;
    if (this.profile.useShadows) {
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.renderer.sortObjects = !this.profile.ultraLow;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.profile.useToneMapping ? THREE.AgXToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = this.profile.ultraHigh ? 0.96 : 1.02;
    this.root.appendChild(this.renderer.domElement);
    this.root.classList.toggle('perf-ultra', this.profile.ultraLow);
    this.root.classList.toggle('perf-ultra-low', this.profile.ultraLow);
    this.root.classList.toggle('perf-ultra-high', this.profile.ultraHigh);
    this.composer = null;
    this.ultraHighPipelineReady = false;

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
      ultraHigh: this.profile.ultraHigh,
      mobile: this.profile.mobile,
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy?.() || 1,
      createPhysics: !this.networked
    });
    this.boostPads = new BoostPads(this.scene, { lowDetail: this.profile.lowDetail, ultraHigh: this.profile.ultraHigh });
    this.goalExplosion = new GoalExplosion(this.scene, {
      lowDetail: this.profile.lowDetail,
      ultraHigh: this.profile.ultraHigh,
      mobile: this.profile.mobile
    });

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
        ultraHigh: this.profile.ultraHigh,
        clientOnly: this.networked,
        playerName: index === this.playerId ? this.playerName : `Spieler ${index + 1}`,
        carStyle: index === this.playerId ? this.playerCarStyle : (initialCarStyles.get(index) || DEFAULT_CAR_STYLE),
        localPlayer: index === this.playerId
      }
    ));
    [this.car0, this.car1, this.car2, this.car3] = this.cars;
    this.ball = new Ball(this.scene, this.world, RAPIER, this.passiveInput, {
      lowDetail: this.profile.lowDetail,
      ultraHigh: this.profile.ultraHigh,
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
          lowLatency: this.profile.ultraLow
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
    this.mobileControls.setQuickChatHandler?.(() => this.requestQuickChat());
    this.hud.setReplaySkipHandler(() => this.network?.sendReplaySkip?.());

    if (this.network) {
      this.network.onStatus = (text) => this.hud.setNetworkStatus(text);
      this.network.onState = (state) => {
        // Goal-celebration snapshots contain the explosion knockback. Keep them
        // live for gameplay, but out of the pre-goal replay ring buffer.
        if (!this.goalCelebrationActive) this.replayBuffer.push(state);
        this.latestNetworkState = state;
        this.latestNetworkStateReceivedAt = performance.now() / 1000;
      };
      this.network.onRoster = (players, maxPlayers) => this.setRoster(players, maxPlayers);
      this.network.onLatency = (rttMs) => this.hud.setPing(rttMs);
      this.network.onKickoff = (kickoff) => this.handleKickoff(kickoff);
      this.network.onReplay = (replay) => this.handleReplay(replay);
      this.network.onGoal = (goal) => this.handleGoal(goal);
      this.network.onQuickChat = (chat) => this.hud.addQuickChat(chat);
      this.network.onQuickChatLimit = (limit) => {
        const cooldownMs = Math.max(0, Number(limit?.cooldownMs) || 0);
        this.hud.setQuickChatCooldown(cooldownMs);
        this.mobileControls.setQuickChatCooldown?.(cooldownMs);
      };
      if (this.network.kickoff) this.handleKickoff(this.network.kickoff);
      if (this.network.replay && this.network.replay.phase !== 'end') this.handleReplay(this.network.replay);

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
    if (this.profile.ultraHigh) {
      if (this.profile.useShadows) this.enableUltraHighShadows();
      if (this.profile.usePostProcessing) this.setupUltraHighRendering();
    }

    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
    this.onPerfToggle = this.onPerfToggle.bind(this);
    this.onQuickChatKeyDown = this.onQuickChatKeyDown.bind(this);
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.addEventListener('keydown', this.onPerfToggle, { passive: false });
    window.addEventListener('keydown', this.onQuickChatKeyDown, { passive: false });
    this.onResize();
  }

  onPerfToggle(event) {
    if (event.code !== 'F2' || event.repeat) return;
    event.preventDefault();
    togglePerformanceProfile();
  }

  onQuickChatKeyDown(event) {
    if ((event.code !== 'Digit1' && event.code !== 'Numpad1') || event.repeat) return;
    event.preventDefault();
    this.requestQuickChat();
  }

  requestQuickChat() {
    if (this.networked) {
      const sent = this.network?.sendQuickChat?.('what-a-save');
      if (!sent) {
        const remaining = this.network?.quickChatCooldownRemaining?.() || 0;
        if (remaining > 0) {
          this.hud.setQuickChatCooldown(remaining);
          this.mobileControls.setQuickChatCooldown?.(remaining);
        }
      }
      return Boolean(sent);
    }

    const now = performance.now();
    if (now < this.offlineQuickChatCooldownUntil) {
      const remaining = this.offlineQuickChatCooldownUntil - now;
      this.hud.setQuickChatCooldown(remaining);
      this.mobileControls.setQuickChatCooldown?.(remaining);
      return false;
    }

    this.hud.addQuickChat({ playerName: this.playerName, team: this.playerTeam, text: 'What a save!' });
    this.offlineQuickChatUsed += 1;
    if (this.offlineQuickChatUsed >= 3) {
      this.offlineQuickChatUsed = 0;
      this.offlineQuickChatCooldownUntil = now + 2000;
      this.hud.setQuickChatCooldown(2000);
      this.mobileControls.setQuickChatCooldown?.(2000);
    }
    return true;
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
    const radius = this.profile.ultraHigh ? 340 : 260;
    const domeGeometry = new THREE.SphereGeometry(
      radius,
      this.profile.lowDetail ? 16 : (this.profile.ultraHigh ? 40 : 24),
      this.profile.lowDetail ? 8 : (this.profile.ultraHigh ? 20 : 12)
    );
    const positions = domeGeometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const horizon = new THREE.Color(this.profile.ultraHigh ? 0x8fa8aa : 0xb8ced0);
    const midSky = new THREE.Color(this.profile.ultraHigh ? 0x5f91b7 : 0x79afd0);
    const zenith = new THREE.Color(this.profile.ultraHigh ? 0x2e6598 : 0x4a8dbb);
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
      color: 0xffdc9b,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: true,
      fog: false
    }));
    sun.position.set(-118, 104, -156);
    sun.scale.set(this.profile.ultraHigh ? 28 : 24, this.profile.ultraHigh ? 28 : 24, 1);
    sun.userData.cameraOcclusionIgnore = true;
    this.scene.add(sun);

    if (this.profile.ultraHigh) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xffbe69,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        depthTest: true,
        fog: false,
        blending: THREE.AdditiveBlending
      }));
      halo.position.copy(sun.position);
      halo.scale.set(52, 52, 1);
      halo.userData.cameraOcclusionIgnore = true;
      this.scene.add(halo);
    }

    // A handful of flattened, instanced cloud blobs break up the empty sky.
    // Even in normal mode this remains one draw call.
    const cloudGeometry = new THREE.SphereGeometry(1, this.profile.lowDetail ? 5 : (this.profile.ultraHigh ? 10 : 7), this.profile.ultraHigh ? 6 : 4);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xeaf3f8,
      transparent: true,
      opacity: this.profile.lowDetail ? 0.30 : (this.profile.ultraHigh ? 0.44 : 0.40),
      depthWrite: false,
      fog: false
    });
    const cloudGroups = this.profile.lowDetail ? 6 : (this.profile.ultraHigh ? 18 : 11);
    const blobsPerCloud = this.profile.ultraHigh ? 4 : 3;
    const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, cloudGroups * blobsPerCloud);
    const dummy = new THREE.Object3D();
    let instance = 0;
    for (let group = 0; group < cloudGroups; group++) {
      const angle = -2.65 + group * (5.3 / Math.max(1, cloudGroups - 1));
      const baseX = Math.sin(angle) * 150;
      const baseZ = Math.cos(angle) * 185;
      const baseY = 44 + (group % 3) * 7;
      for (let blob = 0; blob < blobsPerCloud; blob++) {
        if (this.profile.ultraHigh) {
          const centeredBlob = blob - (blobsPerCloud - 1) * 0.5;
          dummy.position.set(baseX + centeredBlob * 5.2, baseY + (Math.abs(centeredBlob) < 0.6 ? 1.4 : 0), baseZ);
          dummy.scale.set(8.7 - Math.abs(centeredBlob) * 0.7, 1.8 + (Math.abs(centeredBlob) < 0.6 ? 0.55 : 0), 3.7 + (blob % 2) * 0.45);
        } else {
          dummy.position.set(baseX + (blob - 1) * 5.2, baseY + (blob === 1 ? 1.4 : 0), baseZ);
          dummy.scale.set(8.5 - blob * 0.8, 1.8 + (blob === 1 ? 0.5 : 0), 3.6 + blob * 0.5);
        }
        dummy.rotation.set(0, angle * 0.4, 0);
        dummy.updateMatrix();
        clouds.setMatrixAt(instance++, dummy.matrix);
      }
    }
    clouds.instanceMatrix.needsUpdate = true;
    clouds.userData.cameraOcclusionIgnore = true;
    this.scene.add(clouds);
  }

  enableUltraHighShadows() {
    // Keep the expensive dynamic shadow pass focused on gameplay silhouettes.
    // Static scenery and glass never render into the shadow map; only the turf
    // and solid arena surfaces receive it.
    this.arena.group.traverse((object) => {
      if (!object?.isMesh && !object?.isInstancedMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const transparent = materials.some((material) => material?.transparent && material.opacity < 0.72);
      const role = object.userData?.shadowRole;
      object.castShadow = false;
      object.receiveShadow = !transparent && (role === 'field' || role === 'arena-surface');
    });

    for (const car of this.cars) {
      car.group.traverse((object) => {
        if (!object?.isMesh && !object?.isInstancedMesh) return;
        object.castShadow = false;
        object.receiveShadow = true;
      });
      const parts = car.visualParts || {};
      if (parts.lower) parts.lower.castShadow = true;
      if (parts.cabin) parts.cabin.castShadow = true;
      if (parts.body) parts.body.castShadow = true;
    }

    this.ball.mesh.traverse((object) => {
      if (!object?.isMesh && !object?.isInstancedMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    for (const pad of this.boostPads.pads) {
      pad.group.traverse((object) => {
        if (!object?.isMesh && !object?.isInstancedMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
    }
  }

  async setupUltraHighRendering() {
    try {
      const [composerModule, renderPassModule, bloomModule, outputModule, roomModule] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
        import('three/addons/environments/RoomEnvironment.js')
      ]);
      if (!this.profile.ultraHigh) return;

      const { EffectComposer } = composerModule;
      const { RenderPass } = renderPassModule;
      const { UnrealBloomPass } = bloomModule;
      const { OutputPass } = outputModule;
      const { RoomEnvironment } = roomModule;

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room, 0.035).texture;
      this.scene.environment = environment;
      if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.36;
      room.dispose?.();
      pmrem.dispose();

      const width = Math.max(1, this.root.clientWidth || window.innerWidth);
      const height = Math.max(1, this.root.clientHeight || window.innerHeight);
      const renderTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
        samples: this.profile.mobile ? 0 : 4
      });
      const composer = new EffectComposer(this.renderer, renderTarget);
      composer.setPixelRatio(this.renderPixelRatio);
      composer.setSize(width, height);
      composer.addPass(new RenderPass(this.scene, this.camera));

      const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), this.profile.mobile ? 0.08 : 0.16, 0.28, 1.05);
      bloom.threshold = this.profile.mobile ? 1.12 : 1.05;
      bloom.strength = this.profile.mobile ? 0.08 : 0.16;
      bloom.radius = this.profile.mobile ? 0.18 : 0.24;
      composer.addPass(bloom);
      composer.addPass(new OutputPass());

      this.composer = composer;
      this.ultraHighPipelineReady = true;
      this.onResize();
    } catch (error) {
      console.warn('Ultra High post-processing unavailable; using renderer fallback.', error);
      this.composer = null;
      this.ultraHighPipelineReady = false;
    }
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

    if (!this.networked && this.goalCelebrationActive && now >= this.goalCelebrationUntil) {
      this.goalCelebrationActive = false;
      this.goalCelebrationUntil = 0;
    }

    if (this.networked) {
      this.inputAccumulator += frameDt;
      if (this.inputAccumulator >= 1 / CLIENT_INPUT_HEARTBEAT_HZ) {
        this.inputAccumulator %= 1 / CLIENT_INPUT_HEARTBEAT_HZ;
        this.sendNetworkInput();
      }

      if (this.replayActive) {
        this.updateReplay(now);
      } else {
        this.applyNetworkState(frameDt, now);
        if (!this.kickoffActive && !this.goalCelebrationActive) this.localPredictor?.step(frameDt);
      }
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
      if (!this.replayActive && this.input.consumePressed('KeyC')) {
        const cameraMode = this.chaseCamera.toggleMode();
        this.hud.setCameraMode(cameraMode);
        this.mobileControls.setCameraMode?.(cameraMode);
      }
      this.boostPads.update(renderDt);
      this.goalExplosion?.update(renderDt);
      this.chaseCamera.update(renderDt);
      this.arena.updateVisuals?.(this.camera);

      this.hudAccumulator += renderDt;
      if (this.hudAccumulator >= 1 / this.profile.hudHz) {
        this.hudAccumulator = 0;
        this.hud.update(this.replayActive ? this.chaseCamera.car : this.car);
      }

      this.chaseCamera.prepareRender();
      try {
        if (this.profile.useShadows) {
          this.shadowFrameCounter += 1;
          const interval = Math.max(1, this.profile.shadowUpdateInterval || 1);
          if (this.shadowFrameCounter >= interval) {
            this.renderer.shadowMap.needsUpdate = true;
            this.shadowFrameCounter = 0;
          }
        }
        if (this.composer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
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
      const lowThreshold = this.profile.ultraHigh ? (this.profile.mobile ? 47 : 52) : (this.profile.mobile ? 46 : 52);
      const highThreshold = this.profile.ultraHigh ? (this.profile.mobile ? 56 : 59) : (this.profile.mobile ? 57 : 59);
      const downStep = this.profile.ultraHigh ? 0.08 : (this.profile.mobile ? 0.05 : 0.06);
      const upStep = this.profile.ultraHigh ? 0.035 : (this.profile.mobile ? 0.03 : 0.02);
      if (this.measuredFps < lowThreshold) next -= downStep;
      else if (this.measuredFps > highThreshold) next += upStep;

      const dpr = window.devicePixelRatio || 1;
      const maxRenderRatio = this.profile.ultraHigh
        ? this.profile.maxPixelRatio
        : Math.min(this.profile.maxPixelRatio, dpr);
      next = THREE.MathUtils.clamp(next, this.profile.minPixelRatio, maxRenderRatio);
      if (Math.abs(next - this.renderPixelRatio) >= 0.015) {
        this.renderPixelRatio = next;
        this.renderer.setPixelRatio(this.renderPixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);
        this.composer?.setPixelRatio?.(this.renderPixelRatio);
        this.composer?.setSize?.(window.innerWidth, window.innerHeight);
      }
    }

    this.hud.setPerformance(this.profile.name, this.measuredFps, this.renderPixelRatio);
  }

  sendNetworkInput() {
    if (!this.networked) return;
    const packet = this.input.takeNetworkPacket();
    // Keep held controls warm during kickoff so W/Boost can launch on LOS, but
    // never buffer a jump/reset edge inside local prediction. The server applies
    // the same rule, so prediction and authority unlock from the same state.
    const predictorPacket = (this.kickoffActive || this.replayActive || this.goalCelebrationActive)
      ? { ...packet, edges: 0 }
      : packet;
    this.localPredictor?.setInput(predictorPacket);
    this.network.sendInput(packet);
  }

  handleGoal(goal) {
    if (!goal) return;
    const durationMs = Math.max(250, Number(goal.durationMs) || 1250);
    this.goalCelebrationActive = true;
    this.goalCelebrationUntil = performance.now() / 1000 + durationMs / 1000;
    this.kickoffActive = false;
    this.hud.setScore(goal.orangeScore, goal.blueScore);
    this.goalExplosion?.trigger({
      goalSign: goal.goalSign,
      scoringTeam: goal.scoringTeam,
      position: goal.position,
      durationMs
    });
  }

  handleKickoff(kickoff) {
    if (!this.networked || !kickoff) return;
    if (kickoff.phase === 'countdown') {
      const count = Math.max(1, Math.min(3, Math.round(Number(kickoff.count) || 1)));
      const startingFreshCountdown = count === 3 || !this.kickoffActive;
      this.goalCelebrationActive = false;
      this.goalCelebrationUntil = 0;
      this.goalExplosion?.stop();
      this.kickoffActive = true;
      if (startingFreshCountdown) this.resetForNetworkKickoff(Boolean(kickoff.resetScore));
      this.hud.setKickoff('countdown', count);
      return;
    }

    if (kickoff.phase === 'go') {
      this.kickoffActive = false;
      this.hud.setKickoff('go');
    }
  }

  handleReplay(replay) {
    if (!this.networked || !replay) return;
    if (replay.phase === 'progress') {
      this.replayState = { ...(this.replayState || {}), ...replay };
      this.hud.setReplay(this.replayState);
      return;
    }
    if (replay.phase === 'end') {
      this.endReplay();
      return;
    }
    if (replay.phase !== 'start' && replay.phase !== 'wait') return;

    this.goalCelebrationActive = false;
    this.goalCelebrationUntil = 0;
    this.goalExplosion?.stop();
    this.replayActive = true;
    this.replayWaiting = replay.phase === 'wait';
    this.kickoffActive = false;
    this.replayState = { ...replay };
    this.replayFrames = this.replayWaiting
      ? []
      : this.replayBuffer.window(replay.goalTick, replay.lookbackSeconds || 5);
    this.replayStartedAt = performance.now() / 1000;

    if (this.replayFrames.length >= 2) {
      const sourceSeconds = (this.replayFrames.at(-1).tick - this.replayFrames[0].tick) / Math.max(1, this.network?.serverHz || 60);
      const serverWindow = Math.max(1, (Number(replay.durationMs) || 5500) / 1000 - 0.35);
      this.replayPlaybackSeconds = Math.max(0.75, Math.min(serverWindow, sourceSeconds || serverWindow));
    } else {
      this.replayPlaybackSeconds = 1;
    }

    const scorerId = Number(replay.scorerId);
    const scorerCar = Number.isInteger(scorerId) && scorerId >= 0 && scorerId < this.cars.length
      ? this.cars[scorerId]
      : this.car;
    this.chaseCamera.beginReplay(scorerCar);
    this.root.classList.add('replay-active');
    this.hud.setScore(replay.orangeScore, replay.blueScore);
    this.hud.setKickoff('hidden');
    this.hud.setReplay(this.replayState);
  }

  updateReplay(now) {
    if (!this.replayActive || this.replayWaiting || this.replayFrames.length === 0) return;
    const elapsed = Math.max(0, now - this.replayStartedAt);
    const progress = Math.min(1, elapsed / Math.max(0.001, this.replayPlaybackSeconds));
    const frame = sampleReplayFrames(this.replayFrames, progress);
    if (frame) this.applyReplayState(frame);
  }

  applyReplayState(state) {
    const applyEntity = (body, entity) => {
      if (!body || !entity) return;
      body.setTranslation({ x: entity.p[0], y: entity.p[1], z: entity.p[2] }, true);
      body.setRotation({ x: entity.r[0], y: entity.r[1], z: entity.r[2], w: entity.r[3] }, true);
      body.setLinvel({ x: entity.v[0], y: entity.v[1], z: entity.v[2] }, true);
      body.setAngvel({ x: entity.w[0], y: entity.w[1], z: entity.w[2] }, true);
    };

    for (let i = 0; i < this.cars.length; i++) {
      const entity = state.cars?.[i];
      if (!entity) continue;
      applyEntity(this.cars[i].body, entity);
      this.cars[i].grounded = Boolean(entity.g);
      this.cars[i].setBoost?.(entity.b);
    }
    applyEntity(this.ball.body, state.ball);
    this.boostPads.setActiveMask(state.boostPadMask);
  }

  endReplay() {
    if (!this.replayActive) return;
    this.replayActive = false;
    this.replayWaiting = false;
    this.replayFrames = [];
    this.replayState = null;
    this.chaseCamera.endReplay();
    this.root.classList.remove('replay-active');
    this.hud.setReplay({ phase: 'end' });
    this.lastReconciledTick = -1;
  }

  resetForNetworkKickoff(resetScore = false) {
    for (let i = 0; i < this.cars.length; i++) {
      if (i === this.playerId) continue;
      this.cars[i]?.reset();
    }
    this.localPredictor?.resetForKickoff();
    this.ball.reset();
    this.boostPads.resetAll();
    if (resetScore) this.hud.setScore(0, 0);
    this.lastReconciledTick = -1;
  }

  stepOffline(dt) {
    if (this.offlineGoalTimeRemaining > 0) {
      this.offlineGoalTimeRemaining = Math.max(0, this.offlineGoalTimeRemaining - dt);
      this.ball.fixedUpdate(dt);
      this.world.step();
      this.car0.enforceSpeedLimit();
      if (this.offlineGoalTimeRemaining <= 0) {
        this.car0.reset();
        this.ball.reset();
        this.boostPads.resetAll();
        this.goalCelebrationActive = false;
        this.goalCelebrationUntil = 0;
      }
      return;
    }

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

  applyOfflineGoalKnockback(goalSign) {
    const sign = goalSign >= 0 ? 1 : -1;
    const position = this.car0.body.translation();
    const originZ = sign * (ARENA_TUNING.length * 0.5 + 1.4);
    let x = position.x;
    let z = position.z - originZ;
    const length = Math.hypot(x, z) || 1;
    x /= length;
    z /= length;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      x = 0;
      z = -sign;
    }
    this.car0.body.setLinvel({ x: x * 29.5, y: 13.0, z: z * 29.5 }, true);
    this.car0.body.setAngvel({ x: 4.6, y: sign * 2.1, z: -sign * 5.0 }, true);
    this.ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  detectOfflineGoal() {
    if (this.offlineGoalTimeRemaining > 0) return;
    const position = this.ball.body.translation();
    const halfLength = ARENA_TUNING.length * 0.5;
    if (Math.abs(position.z) <= halfLength + this.ball.radius * 0.35) return;
    if (Math.abs(position.x) + this.ball.radius > ARENA_TUNING.goalWidth * 0.5
      || position.y + this.ball.radius > ARENA_TUNING.goalHeight) return;

    const goalSign = position.z >= 0 ? 1 : -1;
    const scoringTeam = goalSign > 0 ? 'blue' : 'orange';
    if (goalSign > 0) this.blueScore += 1;
    else this.orangeScore += 1;

    const durationMs = 1250;
    this.offlineGoalTimeRemaining = durationMs / 1000;
    this.goalCelebrationActive = true;
    this.goalCelebrationUntil = performance.now() / 1000 + this.offlineGoalTimeRemaining;
    this.goalExplosion?.trigger({
      goalSign,
      scoringTeam,
      position: [position.x, position.y, position.z],
      durationMs
    });
    this.applyOfflineGoalKnockback(goalSign);
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
    this.composer?.setPixelRatio?.(this.renderPixelRatio);
    this.composer?.setSize?.(width, height);
  }
}
