import * as THREE from 'three';
import { Arena } from './Arena.js';
import { Ball } from './Ball.js';
import { BoostPads } from './BoostPads.js';
import { Car } from './Car.js';
import { ChaseCamera } from './ChaseCamera.js';
import { Input } from './Input.js';
import { MobileControls } from './MobileControls.js';
import { MobileGameMenu } from './MobileGameMenu.js';
import { loadCameraSettings } from './CameraSettings.js';
import { Hud } from './Hud.js';
import { ChatPanel } from './ChatPanel.js';
import { getPerformanceProfile, togglePerformanceProfile } from './PerformanceProfile.js';
import { VirtualInput } from '../network/VirtualInput.js';
import { LocalCarPredictor } from '../network/LocalCarPredictor.js';
import { ReplayBuffer, sampleReplayFrames } from './ReplayBuffer.js';
import { GoalExplosion } from './GoalExplosion.js';
import { DemolitionExplosion } from './DemolitionExplosion.js';
import { HighSpeedEffects } from './HighSpeedEffects.js';
import { BallLandingCue } from './BallLandingCue.js';
import { ARENA_TUNING, CAR_HITBOX } from '../shared/arena-tuning.js';
import { CAR_TUNING } from '../shared/game-tuning.js';
import { evaluateDemolitionSnapshot } from '../shared/demolition-respawn.js';
import { DEFAULT_CAR_STYLE, normalizeCarStyle } from '../shared/car-styles.js';
import { DEFAULT_BOOST_STYLE, normalizeBoostStyle } from '../shared/boost-styles.js';
import { QUICK_CHAT_OPTIONS, findQuickChat } from '../shared/quick-chat.js';

const CLIENT_INPUT_HEARTBEAT_HZ = 30;

const PLAYER_CONFIGS = [
  { spawn: { x: 20.48, y: CAR_HITBOX.y, z: 25.60 }, spawnYaw: Math.PI / 4, color: 0xf45a13, team: 'orange' },
  { spawn: { x: -20.48, y: CAR_HITBOX.y, z: -25.60 }, spawnYaw: -3 * Math.PI / 4, color: 0x087dff, team: 'blue' },
  { spawn: { x: -20.48, y: CAR_HITBOX.y, z: 25.60 }, spawnYaw: -Math.PI / 4, color: 0xff8b16, team: 'orange' },
  { spawn: { x: 20.48, y: CAR_HITBOX.y, z: -25.60 }, spawnYaw: 3 * Math.PI / 4, color: 0x23bfff, team: 'blue' },
  { spawn: { x: 2.56, y: CAR_HITBOX.y, z: 38.40 }, spawnYaw: 0, color: 0xff7430, team: 'orange' },
  { spawn: { x: -2.56, y: CAR_HITBOX.y, z: -38.40 }, spawnYaw: Math.PI, color: 0x398dff, team: 'blue' },
  { spawn: { x: -2.56, y: CAR_HITBOX.y, z: 38.40 }, spawnYaw: 0, color: 0xffa02e, team: 'orange' },
  { spawn: { x: 2.56, y: CAR_HITBOX.y, z: -38.40 }, spawnYaw: Math.PI, color: 0x52caff, team: 'blue' }
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
    this.playerBoostStyle = normalizeBoostStyle(network?.boostStyle || options.boostStyle || DEFAULT_BOOST_STYLE);
    this.playerTeam = network?.team === 'blue' ? 'blue' : 'orange';
    this.isGuest = Boolean(options.isGuest);
    this.accountName = String(options.accountUsername || this.playerName || 'Gast');
    this.cameraSettings = loadCameraSettings(this.accountName, this.isGuest ? null : globalThis.localStorage);
    this.gameMode = network?.matchConfig?.gameMode === 'basketball' || options.gameMode === 'basketball' ? 'basketball' : 'normal';
    this.quickChatOptions = network?.quickChats?.length ? network.quickChats : QUICK_CHAT_OPTIONS;
    this.profile = getPerformanceProfile(this.networked, options.graphicsMode);

    this.fixedDt = 1 / 120;
    this.accumulator = 0;
    this.lastTime = performance.now() / 1000;
    this.lastRenderTime = 0;
    this.renderInterval = 1 / Math.max(1, Number(this.profile?.renderHz) || 60);
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
    this.replayPlaybackSeconds = 6.25;
    this.replayState = null;
    this.replayBuffer = new ReplayBuffer(network?.serverHz ?? 60, 8);
    this.goalCelebrationActive = false;
    this.goalCelebrationUntil = 0;
    this.offlineGoalTimeRemaining = 0;
    this.offlinePreviousBallPosition = new THREE.Vector3(0, 0, 0);
    this.offlineQuickChatUsed = 0;
    this.offlineQuickChatCooldownUntil = 0;
    this.demolishedPlayers = new Set();
    this.demolitionRespawnActive = false;
    this.demolitionRespawnEndsAt = 0;
    this.demolitionStartTick = -1;
    this.demolitionSnapshotConfirmed = false;
    this.lastRespawnSelectionSentAt = 0;
    this.lastRespawnSelectionSentIndex = -1;
    this.respawnSelectedIndex = 1;
    this.respawnPoints = [];
    this.respawnMarkerGroup = null;
    this.respawnMarkers = [];

    this.perfElapsed = 0;
    this.perfFrames = 0;
    this.measuredFps = this.profile.ultraLow ? this.profile.renderHz : 60;
    this.shadowFrameCounter = 0;
    this.renderPixelRatio = this.profile.ultraHigh
      ? this.profile.initialPixelRatio
      : Math.min(window.devicePixelRatio || 1, this.profile.initialPixelRatio);

    this.scene = new THREE.Scene();
    // Normal/low keep the bright daylight look. Ultra High uses a permanent
    // blue-hour dusk palette with a moonlit sky; the arena lights below provide
    // active illumination so the pitch stays readable rather than simply dark.
    const skyColor = this.profile.ultraHigh ? 0x161a34 : 0x7fb4d3;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = this.profile.useFog
      ? new THREE.Fog(this.profile.ultraHigh ? 0x30344d : 0x9bb9c5, this.profile.ultraHigh ? 135 : 155, this.profile.ultraHigh ? 350 : 360)
      : null;

    this.camera = new THREE.PerspectiveCamera(this.cameraSettings.fov, window.innerWidth / window.innerHeight, 0.08, this.profile.ultraLow ? 230 : (this.profile.ultraHigh ? 520 : 390));
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
    this.renderer.toneMappingExposure = this.profile.ultraHigh ? 1.00 : 1.02;
    this.root.appendChild(this.renderer.domElement);
    this.root.classList.toggle('perf-ultra', this.profile.ultraLow);
    this.root.classList.toggle('perf-ultra-low', this.profile.ultraLow);
    this.root.classList.toggle('perf-ultra-high', this.profile.ultraHigh);
    this.composer = null;
    this.ultraHighPipelineReady = false;
    this.ultraBloomPass = null;
    this.ultraBloomBaseStrength = this.profile.mobile ? 0.08 : 0.16;
    this.ultraBloomBaseRadius = this.profile.mobile ? 0.18 : 0.24;
    this.baseCameraFov = this.cameraSettings.fov;

    // In online mode the Go server owns all real physics. The browser uses tiny JS
    // transform stores instead of loading/stepping Rapier/WASM.
    if (this.networked) {
      this.world = null;
    } else {
      this.world = new RAPIER.World({ x: 0, y: -CAR_TUNING.gravity, z: 0 });
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
      createPhysics: !this.networked,
      gameMode: this.gameMode
    });
    this.boostPads = new BoostPads(this.scene, { lowDetail: this.profile.lowDetail, ultraHigh: this.profile.ultraHigh });
    this.goalExplosion = new GoalExplosion(this.scene, {
      lowDetail: this.profile.lowDetail,
      ultraHigh: this.profile.ultraHigh,
      mobile: this.profile.mobile
    });
    this.demolitionExplosion = new DemolitionExplosion(this.scene, {
      lowDetail: this.profile.lowDetail,
      ultraHigh: this.profile.ultraHigh,
      mobile: this.profile.mobile
    });

    const initialCarStyles = new Map((network?.players ?? []).map((player) => [
      Number(player?.playerId),
      normalizeCarStyle(player?.carStyle)
    ]));
    const initialBoostStyles = new Map((network?.players ?? []).map((player) => [
      Number(player?.playerId),
      normalizeBoostStyle(player?.boostStyle)
    ]));

    const lobbyCapacity = Math.max(1, Math.min(PLAYER_CONFIGS.length, Number(network?.maxPlayers) || 4));
    this.cars = PLAYER_CONFIGS.slice(0, lobbyCapacity).map((config, index) => new Car(
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
        boostStyle: index === this.playerId ? this.playerBoostStyle : (initialBoostStyles.get(index) || DEFAULT_BOOST_STYLE),
        mobile: this.profile.mobile,
        localPlayer: index === this.playerId,
        initiallyVisible: this.networked
          ? (index === this.playerId || this.connectedPlayers.has(index))
          : index === 0
      }
    ));
    [this.car0, this.car1, this.car2, this.car3] = this.cars;
    this.ball = new Ball(this.scene, this.world, RAPIER, this.passiveInput, {
      lowDetail: this.profile.lowDetail,
      ultraHigh: this.profile.ultraHigh,
      clientOnly: this.networked,
      gameMode: this.gameMode
    });

    if (this.networked) {
      this.setRoster(network?.players ?? [...this.connectedPlayers], network?.maxPlayers ?? 4);
    } else {
      for (let i = 1; i < this.cars.length; i++) this.setCarVisible(i, false);
      this.car0.setPlayerIdentity(this.playerName, 'orange', true);
      this.car0.setCarStyle(this.playerCarStyle);
      this.car0.setBoostStyle(this.playerBoostStyle);
    }

    this.car = this.cars[this.playerId] ?? this.car0;
    this.localPredictor = this.networked
      ? new LocalCarPredictor(this.car, {
          simulationHz: 120,
          lowLatency: this.profile.ultraLow
        })
      : null;
    this.chaseCamera = new ChaseCamera(this.camera, this.car, this.ball, this.scene, this.cameraSettings);
    this.ballLandingCue = new BallLandingCue(this.scene, {
      lowDetail: this.profile.lowDetail,
      ultraHigh: this.profile.ultraHigh,
      mobile: this.profile.mobile
    });
    this.highSpeedEffects = this.profile.ultraHigh
      ? new HighSpeedEffects(this.scene, this.car, { mobile: this.profile.mobile })
      : null;
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
    this.chatPanel = new ChatPanel(this.root, {
      quickChats: this.quickChatOptions,
      mobile: this.mobileControls.enabled,
      onQuickChat: (id) => this.requestQuickChat(id),
      onTextChat: (text) => this.requestTextChat(text),
      onOpenChange: (open) => {
        this.input.setTextInputActive?.(open);
        if (open) this.mobileControls.releaseAll?.();
      }
    });
    this.mobileControls.setChatHandler?.(() => this.chatPanel.toggle('quick'));
    this.mobileGameMenu = new MobileGameMenu(this.root, {
      enabled: true,
      accountName: this.accountName,
      isGuest: this.isGuest,
      persistSettings: !this.isGuest,
      getCameraSettings: () => this.chaseCamera.getSettings(),
      onCameraPreview: (settings) => this.applyCameraSettings(settings),
      onCameraMode: (mode) => this.setCameraMode(mode),
      onOpenChange: (open) => {
        if (open) {
          this.chatPanel.close?.();
          this.mobileControls.releaseAll?.();
        }
        this.input.setTextInputActive?.(open);
      },
      onLeave: () => this.leaveMatch()
    });
    this.hud.setReplaySkipHandler(() => this.network?.sendReplaySkip?.());
    this.hud.setRespawnSelectionHandler?.((index) => this.selectRespawnPoint(index));

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
      this.network.onDemolition = (demolition) => this.handleDemolition(demolition);
      this.network.onRespawn = (respawn) => this.handleRespawn(respawn);
      this.network.onDemolitionCancel = () => this.endDemolitionRespawn();
      this.network.onQuickChat = (chat) => this.hud.addChat(chat);
      this.network.onQuickChatLimit = (limit) => {
        const cooldownMs = Math.max(0, Number(limit?.cooldownMs) || 0);
        this.hud.setQuickChatCooldown(cooldownMs);
        this.chatPanel.setQuickChatCooldown(cooldownMs);
      };
      this.network.onChat = (chat) => this.hud.addChat(chat);
      this.network.onChatLimit = (limit) => {
        const cooldownMs = Math.max(0, Number(limit?.cooldownMs) || 0);
        this.chatPanel.setTextChatCooldown(cooldownMs);
      };
      this.network.onMatchClock = (clock) => this.hud.setMatchClock?.(clock);
      this.network.onMatchOver = (result) => this.hud.showMatchOver?.(result);
      if (this.network.kickoff) this.handleKickoff(this.network.kickoff);
      if (this.network.replay && this.network.replay.phase !== 'end') this.handleReplay(this.network.replay);
      if (this.network.matchClock) this.hud.setMatchClock?.(this.network.matchClock);

      // Key transitions bypass requestAnimationFrame and go to the server immediately.
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
    this.onReplaySkipKeyDown = this.onReplaySkipKeyDown.bind(this);
    this.onRespawnSelectKeyDown = this.onRespawnSelectKeyDown.bind(this);
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.addEventListener('keydown', this.onPerfToggle, { passive: false });
    window.addEventListener('keydown', this.onQuickChatKeyDown, { passive: false });
    window.addEventListener('keydown', this.onReplaySkipKeyDown, { passive: false });
    window.addEventListener('keydown', this.onRespawnSelectKeyDown, { passive: false });
    this.onResize();
  }

  onPerfToggle(event) {
    if (event.code !== 'F2' || event.repeat) return;
    event.preventDefault();
    togglePerformanceProfile(!this.isGuest);
  }

  onQuickChatKeyDown(event) {
    if (event.repeat) return;
    if (event.code === 'KeyT') {
      event.preventDefault();
      this.chatPanel.toggle('text');
      return;
    }
    if (event.code === 'KeyY') {
      event.preventDefault();
      this.chatPanel.toggle('quick');
      return;
    }
    if (this.demolitionRespawnActive || this.chatPanel.isOpen()) return;
    const shortcut = { Digit1: 0, Numpad1: 0, Digit2: 1, Numpad2: 1, Digit3: 2, Numpad3: 2, Digit4: 3, Numpad4: 3 }[event.code];
    if (shortcut === undefined) return;
    const option = this.quickChatOptions[shortcut];
    if (!option) return;
    event.preventDefault();
    this.requestQuickChat(option.id);
  }

  onReplaySkipKeyDown(event) {
    if (event.code !== 'Space' || event.repeat || !this.replayActive || this.replayWaiting) return;
    // The touch JUMP button does not dispatch DOM keyboard events, so this is a
    // desktop/browser shortcut without stealing the existing mobile replay UI.
    if (this.mobileControls?.enabled) return;
    event.preventDefault();
    this.hud?.requestReplaySkip?.();
  }


  onRespawnSelectKeyDown(event) {
    if (!this.demolitionRespawnActive || event.repeat) return;
    let choice = null;
    if (event.code === 'Digit1' || event.code === 'Numpad1') choice = 0;
    else if (event.code === 'Digit2' || event.code === 'Numpad2') choice = 1;
    else if (event.code === 'Digit3' || event.code === 'Numpad3') choice = 2;
    else if (event.code === 'Digit4' || event.code === 'Numpad4') choice = 3;
    else if (event.code === 'ArrowLeft' || event.code === 'KeyA') choice = (this.respawnSelectedIndex + 3) % 4;
    else if (event.code === 'ArrowRight' || event.code === 'KeyD') choice = (this.respawnSelectedIndex + 1) % 4;
    if (choice === null) return;
    event.preventDefault();
    event.stopPropagation?.();
    this.selectRespawnPoint(choice);
  }

  requestQuickChat(id = 'what-a-save') {
    const option = findQuickChat(this.quickChatOptions, id);
    if (!option) return false;
    if (this.networked) {
      const sent = this.network?.sendQuickChat?.(option.id);
      if (!sent) {
        const remaining = this.network?.quickChatCooldownRemaining?.() || 0;
        if (remaining > 0) {
          this.hud.setQuickChatCooldown(remaining);
          this.chatPanel.setQuickChatCooldown(remaining);
        }
      }
      return Boolean(sent);
    }

    const now = performance.now();
    if (now < this.offlineQuickChatCooldownUntil) {
      const remaining = this.offlineQuickChatCooldownUntil - now;
      this.hud.setQuickChatCooldown(remaining);
      this.chatPanel.setQuickChatCooldown(remaining);
      return false;
    }

    this.hud.addChat({ kind: 'quick', playerName: this.playerName, team: this.playerTeam, text: option.text });
    this.offlineQuickChatUsed += 1;
    if (this.offlineQuickChatUsed >= 3) {
      this.offlineQuickChatUsed = 0;
      this.offlineQuickChatCooldownUntil = now + 2000;
      this.hud.setQuickChatCooldown(2000);
      this.chatPanel.setQuickChatCooldown(2000);
    }
    return true;
  }

  requestTextChat(text) {
    const value = Array.from(String(text || '').trim().replace(/\s+/g, ' ')).slice(0, 160).join('');
    if (!value) return false;
    if (this.networked) {
      const sent = this.network?.sendTextChat?.(value);
      if (!sent) {
        const remaining = this.network?.textChatCooldownRemaining?.() || 0;
        if (remaining > 0) this.chatPanel.setTextChatCooldown(remaining);
      }
      return Boolean(sent);
    }
    this.hud.addChat({ kind: 'text', playerName: this.playerName, team: this.playerTeam, text: value });
    return true;
  }

  setCarVisible(index, visible) {
    const car = this.cars[index];
    if (!car) return;
    car.group.visible = visible;
    car.setPremiumVisualsEnabled?.(visible);
    if (car.shadow) car.shadow.visible = visible;
    car.boostTrail?.setVisible?.(visible);
  }

  setRoster(players, maxPlayers = 4) {
    const roster = (players ?? []).map((player) => {
      if (typeof player === 'object' && player !== null) {
        return {
          playerId: Number(player.playerId),
          name: String(player.name || `Spieler ${Number(player.playerId) + 1}`).slice(0, 16),
          team: player.team === 'blue' ? 'blue' : 'orange',
          carStyle: normalizeCarStyle(player.carStyle),
          boostStyle: normalizeBoostStyle(player.boostStyle)
        };
      }
      const playerId = Number(player);
      return { playerId, name: `Spieler ${playerId + 1}`, team: playerId % 2 === 0 ? 'orange' : 'blue', carStyle: DEFAULT_CAR_STYLE, boostStyle: DEFAULT_BOOST_STYLE };
    }).filter((player) => Number.isInteger(player.playerId) && player.playerId >= 0 && player.playerId < this.cars.length);
    const signature = roster.map((player) => `${player.playerId}:${player.name}:${player.team}:${player.carStyle}:${player.boostStyle}`).join('|');
    if (signature === this.rosterSignature) return;
    this.rosterSignature = signature;
    this.connectedPlayers = new Set(roster.map((player) => player.playerId));
    for (const player of roster) {
      const car = this.cars[player.playerId];
      car?.setPlayerIdentity(player.name, player.team, player.playerId === this.playerId);
      car?.setCarStyle(player.carStyle);
      car?.setBoostStyle(player.boostStyle);
    }
    if (this.networked) {
      for (let i = 0; i < this.cars.length; i++) {
        this.setCarVisible(i, this.connectedPlayers.has(i) && !this.demolishedPlayers.has(i));
      }
    }
    this.hud?.setPlayerCount(this.connectedPlayers.size, maxPlayers);
  }

  addSkyDecoration() {
    const ultraHigh = this.profile.ultraHigh;
    const radius = ultraHigh ? 350 : 260;
    const domeGeometry = new THREE.SphereGeometry(
      radius,
      this.profile.lowDetail ? 16 : (ultraHigh ? 40 : 24),
      this.profile.lowDetail ? 8 : (ultraHigh ? 20 : 12)
    );
    const positions = domeGeometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const horizon = new THREE.Color(ultraHigh ? 0xa35f72 : 0xb8ced0);
    const midSky = new THREE.Color(ultraHigh ? 0x39456f : 0x79afd0);
    const zenith = new THREE.Color(ultraHigh ? 0x10162f : 0x4a8dbb);
    const color = new THREE.Color();
    for (let index = 0; index < positions.count; index++) {
      const h = THREE.MathUtils.clamp(positions.getY(index) / radius, -1, 1);
      if (h < 0.13) {
        color.copy(horizon).lerp(midSky, THREE.MathUtils.clamp((h + 0.20) / 0.33, 0, 1));
      } else {
        color.copy(midSky).lerp(zenith, THREE.MathUtils.clamp((h - 0.13) / 0.87, 0, 1));
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
    dome.renderOrder = -20;
    dome.userData.cameraOcclusionIgnore = true;
    this.scene.add(dome);

    const makeGlowTexture = (moon = false) => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 256, 256);
      if (moon) {
        const disc = ctx.createRadialGradient(112, 92, 12, 128, 128, 103);
        disc.addColorStop(0, '#ffffff');
        disc.addColorStop(0.48, '#e8f1ff');
        disc.addColorStop(0.82, '#aebfda');
        disc.addColorStop(1, 'rgba(104,122,157,0)');
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(128, 128, 104, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#667694';
        for (const [x, y, r] of [[92, 86, 15], [159, 111, 10], [128, 158, 18], [76, 143, 8], [170, 164, 7]]) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const glow = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        glow.addColorStop(0, 'rgba(255,255,255,0.95)');
        glow.addColorStop(0.16, 'rgba(178,207,255,0.52)');
        glow.addColorStop(0.50, 'rgba(112,143,232,0.14)');
        glow.addColorStop(1, 'rgba(70,80,160,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 256, 256);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    };

    if (ultraHigh) {
      // One static point cloud gives the dusk sky hundreds of stars for a single
      // draw call. No twinkle animation is needed; the high-contrast moonlight
      // and arena LEDs provide the motion/energy in the foreground.
      let seed = 0x42c0ffee;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
      };
      const starCount = this.profile.mobile ? 260 : 560;
      const starPositions = new Float32Array(starCount * 3);
      const starColors = new Float32Array(starCount * 3);
      const starRadius = radius * 0.90;
      const warmStar = new THREE.Color(0xffe6c4);
      const coolStar = new THREE.Color(0xcce4ff);
      const starColor = new THREE.Color();
      for (let index = 0; index < starCount; index++) {
        const azimuth = random() * Math.PI * 2;
        const yNorm = 0.12 + Math.pow(random(), 0.68) * 0.82;
        const ring = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
        starPositions[index * 3] = Math.cos(azimuth) * ring * starRadius;
        starPositions[index * 3 + 1] = yNorm * starRadius;
        starPositions[index * 3 + 2] = Math.sin(azimuth) * ring * starRadius;
        starColor.copy(coolStar).lerp(warmStar, random() * 0.34);
        const intensity = 0.66 + random() * 0.34;
        starColors[index * 3] = starColor.r * intensity;
        starColors[index * 3 + 1] = starColor.g * intensity;
        starColors[index * 3 + 2] = starColor.b * intensity;
      }
      const starGeometry = new THREE.BufferGeometry();
      starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
      starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
      const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
        size: this.profile.mobile ? 0.78 : 0.95,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        fog: false
      }));
      stars.position.y = 18;
      stars.renderOrder = -15;
      stars.frustumCulled = false;
      stars.userData.cameraOcclusionIgnore = true;
      this.scene.add(stars);

      const moonTexture = makeGlowTexture(true);
      const moon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: moonTexture,
        color: 0xe8f3ff,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false
      }));
      moon.position.set(-122, 100, -182);
      moon.scale.set(25, 25, 1);
      moon.renderOrder = -12;
      moon.userData.cameraOcclusionIgnore = true;
      this.scene.add(moon);

      const haloTexture = makeGlowTexture(false);
      const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTexture,
        color: 0x9cbcff,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        depthTest: true,
        fog: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      }));
      moonHalo.position.copy(moon.position);
      moonHalo.scale.set(68, 68, 1);
      moonHalo.renderOrder = -13;
      moonHalo.userData.cameraOcclusionIgnore = true;
      this.scene.add(moonHalo);

      const horizonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTexture,
        color: 0xff826e,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        depthTest: true,
        fog: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      }));
      horizonGlow.position.set(148, 34, -238);
      horizonGlow.scale.set(118, 76, 1);
      horizonGlow.renderOrder = -14;
      horizonGlow.userData.cameraOcclusionIgnore = true;
      this.scene.add(horizonGlow);
    } else {
      const sun = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xffdc9b,
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
    }

    // Flattened instanced cloud banks remain very cheap. Ultra High tints them
    // lavender/blue so they catch the permanent dusk rather than looking like
    // bright daytime cotton in front of the stars.
    const cloudGeometry = new THREE.SphereGeometry(1, this.profile.lowDetail ? 5 : (ultraHigh ? 9 : 7), ultraHigh ? 5 : 4);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: ultraHigh ? 0x7e819b : 0xeaf3f8,
      transparent: true,
      opacity: this.profile.lowDetail ? 0.30 : (ultraHigh ? 0.22 : 0.40),
      depthWrite: false,
      fog: false
    });
    const cloudGroups = this.profile.lowDetail ? 6 : (ultraHigh ? (this.profile.mobile ? 10 : 15) : 11);
    const blobsPerCloud = ultraHigh ? 4 : 3;
    const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, cloudGroups * blobsPerCloud);
    const dummy = new THREE.Object3D();
    let instance = 0;
    for (let group = 0; group < cloudGroups; group++) {
      const angle = -2.65 + group * (5.3 / Math.max(1, cloudGroups - 1));
      const baseX = Math.sin(angle) * 150;
      const baseZ = Math.cos(angle) * 185;
      const baseY = 44 + (group % 3) * 7;
      for (let blob = 0; blob < blobsPerCloud; blob++) {
        if (ultraHigh) {
          const centeredBlob = blob - (blobsPerCloud - 1) * 0.5;
          dummy.position.set(baseX + centeredBlob * 5.2, baseY + (Math.abs(centeredBlob) < 0.6 ? 1.4 : 0), baseZ);
          dummy.scale.set(9.4 - Math.abs(centeredBlob) * 0.75, 1.65 + (Math.abs(centeredBlob) < 0.6 ? 0.5 : 0), 4.0 + (blob % 2) * 0.55);
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
    clouds.renderOrder = -11;
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

      const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), this.ultraBloomBaseStrength, 0.28, 1.05);
      bloom.threshold = this.profile.mobile ? 1.12 : 1.05;
      bloom.strength = this.ultraBloomBaseStrength;
      bloom.radius = this.ultraBloomBaseRadius;
      this.ultraBloomPass = bloom;
      composer.addPass(bloom);
      composer.addPass(new OutputPass());

      this.composer = composer;
      this.ultraHighPipelineReady = true;
      this.onResize();
    } catch (error) {
      console.warn('Ultra High post-processing unavailable; using renderer fallback.', error);
      this.composer = null;
      this.ultraHighPipelineReady = false;
      this.ultraBloomPass = null;
    }
  }

  async prepareInitialFrame() {
    // The templates were fetched by InitialGameLoader. Wait for each car/ball
    // to finish its cheap clone + material pass so no procedural placeholder is
    // visible for a frame before the premium model replaces it.
    const pendingVisuals = [
      ...this.cars.map((car) => car.premiumVisualLoad),
      this.ball.premiumVisualLoad
    ].filter(Boolean);
    await Promise.allSettled(pendingVisuals);

    for (const car of this.cars) car.syncVisual();
    this.ball.syncVisual();
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);

    // Compile and perform one covered render while the loading screen is still
    // on top. This uploads geometry/textures and removes the large first-frame
    // shader hitch common on slower integrated GPUs.
    try {
      if (typeof this.renderer.compileAsync === 'function') {
        await this.renderer.compileAsync(this.scene, this.camera);
      } else {
        this.renderer.compile(this.scene, this.camera);
      }
    } catch (error) {
      console.warn('Shader warm-up was unavailable; continuing with normal rendering.', error);
    }
    this.renderer.render(this.scene, this.camera);
  }

  setCameraMode(mode) {
    const cameraMode = this.chaseCamera.setMode(mode);
    this.cameraSettings = this.chaseCamera.getSettings();
    this.hud.setCameraMode(cameraMode);
    this.mobileControls.setCameraMode?.(cameraMode);
    return cameraMode;
  }

  applyCameraSettings(settings) {
    this.cameraSettings = this.chaseCamera.setSettings(settings);
    this.setCameraMode(this.cameraSettings.mode);
    this.onResize();
    return this.cameraSettings;
  }

  leaveMatch() {
    if (this.leavingMatch) return;
    this.leavingMatch = true;
    this.mobileControls?.releaseAll?.();
    this.input.setTextInputActive?.(true);
    try {
      this.network?.disconnect?.();
    } catch (error) {
      console.warn('Match disconnect failed; returning to the lobby anyway.', error);
    }

    // A short-lived route marker lets startup resume the valid account/guest
    // session directly at the lobby browser instead of showing the account gate.
    const destination = new URL(window.location.href);
    destination.hash = '';
    destination.searchParams.set('return', 'lobbies');
    const destinationHref = destination.toString();
    try {
      window.location.replace(destinationHref);
    } catch (error) {
      console.warn('Lobby navigation was blocked; trying a normal navigation.', error);
      try {
        window.location.assign(destinationHref);
      } catch {
        window.location.reload();
      }
    }
    // Some embedded browsers delay navigation while the WebSocket closes.
    window.setTimeout(() => {
      try {
        window.location.replace(destinationHref);
      } catch {
        window.location.reload();
      }
    }, 250);
  }

  start() {
    for (const car of this.cars) car.syncVisual();
    this.ball.syncVisual();
    // Loading and shader compilation may take seconds on a cold cache. Begin
    // frame timing here so that time is never mistaken for one huge game step.
    this.lastTime = performance.now() / 1000;
    this.hud.setPerformance(this.profile.name, this.measuredFps, this.renderPixelRatio);
    requestAnimationFrame(this.loop);
  }

  loop(nowMs) {
    const now = nowMs / 1000;
    const frameDt = Math.min(now - this.lastTime, 0.08);
    this.lastTime = now;

    this.perfElapsed += frameDt;
    this.updateAdaptivePerformance();

    if (!this.networked && this.goalCelebrationActive && now >= this.goalCelebrationUntil) {
      this.goalCelebrationActive = false;
      this.goalCelebrationUntil = 0;
      this.chaseCamera?.setGoalCelebrationActive?.(false);
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
        if (!this.kickoffActive && !this.goalCelebrationActive && !this.demolitionRespawnActive) this.localPredictor?.step(frameDt);
      }
    } else {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < 8) {
        this.stepOffline(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps += 1;
      }
      if (steps === 8 && this.accumulator > this.fixedDt * 2) this.accumulator = this.fixedDt;
    }

    // Feed current speed back into the mobile response curve. The analog stick
    // keeps full steering at the edge, but its center becomes more precise as
    // the car approaches boost speeds. This is visual/input shaping only; the
    // exact shaped value is what server and predictor both receive.
    if (this.mobileControls?.enabled && this.car?.body?.linvel) {
      const mobileVelocity = this.car.body.linvel();
      const mobileSpeedKmh = Math.hypot(mobileVelocity.x, mobileVelocity.y, mobileVelocity.z) * 3.6;
      this.mobileControls.setVehicleSpeed?.(mobileSpeedKmh);
    }

    if (this.demolitionRespawnActive) this.updateDemolitionRespawn(now);

    if (this.lastRenderTime === 0 || now - this.lastRenderTime >= this.renderInterval - 0.001) {
      this.perfFrames += 1;
      const renderDt = this.lastRenderTime === 0 ? frameDt : Math.min(now - this.lastRenderTime, 0.08);
      this.lastRenderTime = now;

      for (const car of this.cars) {
        if (!car.group.visible) continue;
        car.syncVisual();
        car.updateBoostEffects?.(renderDt);
      }
      this.ball.syncVisual();
      this.ballLandingCue?.update(this.ball, renderDt);
      if (!this.replayActive && !this.demolitionRespawnActive && this.input.consumePressed('KeyC')) {
        this.setCameraMode(this.chaseCamera.toggleMode());
      }
      this.boostPads.update(renderDt);
      this.goalExplosion?.update(renderDt);
      this.demolitionExplosion?.update(renderDt);
      this.updateRespawnMarkers(now);
      this.chaseCamera.update(renderDt);
      const highSpeedImmersionActive = !this.replayActive
        && !this.kickoffActive
        && !this.goalCelebrationActive
        && !this.demolitionRespawnActive
        && Boolean(this.car?.group?.visible);
      this.highSpeedEffects?.update(renderDt, highSpeedImmersionActive);
      this.updateUltraHighImmersion(renderDt, highSpeedImmersionActive);
      if (!this.profile.ultraLow) this.arena.updateVisuals?.(this.camera);

      this.hudAccumulator += renderDt;
      if (this.hudAccumulator >= 1 / this.profile.hudHz) {
        this.hudAccumulator = 0;
        this.hud.update(this.replayActive ? this.chaseCamera.car : this.car);
      }

      if (!this.profile.ultraLow) this.chaseCamera.prepareRender();
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
        if (!this.profile.ultraLow) this.chaseCamera.restoreOccluders();
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
      const lowThreshold = this.profile.ultraLow
        ? 24
        : (this.profile.ultraHigh ? (this.profile.mobile ? 44 : 52) : (this.profile.mobile ? 46 : 52));
      const highThreshold = this.profile.ultraLow
        ? 29
        : (this.profile.ultraHigh ? (this.profile.mobile ? 57 : 59) : (this.profile.mobile ? 57 : 59));
      const downStep = this.profile.ultraLow
        ? 0.04
        : (this.profile.ultraHigh ? (this.profile.mobile ? 0.05 : 0.08) : (this.profile.mobile ? 0.05 : 0.06));
      const upStep = this.profile.ultraLow
        ? 0.015
        : (this.profile.ultraHigh ? (this.profile.mobile ? 0.03 : 0.035) : (this.profile.mobile ? 0.03 : 0.02));
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
    const zeroPacket = { mask: 0, edges: 0, flags: 0, throttle: 0, steer: 0 };
    const predictorPacket = this.demolitionRespawnActive
      ? zeroPacket
      : (this.kickoffActive || this.replayActive || this.goalCelebrationActive)
        ? { ...packet, edges: 0 }
        : packet;
    // During the four-second demolition selection we also transmit zero input.
    // This consumes one-shot jump/reset edges locally instead of letting a key
    // pressed in bird view leak into the first authoritative respawn tick.
    const networkPacket = this.demolitionRespawnActive ? zeroPacket : packet;
    this.localPredictor?.setInput(predictorPacket);
    this.network.sendInput(networkPacket);
  }

  handleGoal(goal) {
    if (!goal) return;
    this.endDemolitionRespawn();
    const parsedDurationMs = Number(goal.durationMs);
    const durationMs = Number.isFinite(parsedDurationMs) ? Math.max(0, parsedDurationMs) : 1250;
    this.goalCelebrationActive = durationMs > 0;
    this.goalCelebrationUntil = performance.now() / 1000 + durationMs / 1000;
    this.chaseCamera?.setGoalCelebrationActive?.(durationMs > 0);
    this.kickoffActive = false;
    this.hud.setScore(goal.orangeScore, goal.blueScore);
    this.goalExplosion?.trigger({
      goalSign: goal.goalSign,
      scoringTeam: goal.scoringTeam,
      position: goal.position,
      durationMs
    });
  }


  defaultRespawnPoints(team = this.playerTeam) {
    if (team === 'blue') {
      return [
        { x: -23.04, y: CAR_HITBOX.y, z: -46.08, yaw: Math.PI },
        { x: -26.88, y: CAR_HITBOX.y, z: -46.08, yaw: Math.PI },
        { x: 23.04, y: CAR_HITBOX.y, z: -46.08, yaw: Math.PI },
        { x: 26.88, y: CAR_HITBOX.y, z: -46.08, yaw: Math.PI }
      ];
    }
    return [
      { x: 23.04, y: CAR_HITBOX.y, z: 46.08, yaw: 0 },
      { x: 26.88, y: CAR_HITBOX.y, z: 46.08, yaw: 0 },
      { x: -23.04, y: CAR_HITBOX.y, z: 46.08, yaw: 0 },
      { x: -26.88, y: CAR_HITBOX.y, z: 46.08, yaw: 0 }
    ];
  }

  handleDemolition(demolition) {
    if (!demolition) return;
    const victimId = Number(demolition.victimId);
    if (!Number.isInteger(victimId) || victimId < 0 || victimId >= this.cars.length) return;
    this.demolishedPlayers.add(victimId);
    this.demolitionExplosion?.trigger(demolition.position);
    this.setCarVisible(victimId, false);
    const victim = this.cars[victimId];
    if (victim) {
      victim.boosting = false;
      victim.boostVisualHold = 0;
      victim.boostTrail?.clear?.();
    }
    if (victimId !== this.playerId) return;

    this.demolitionRespawnActive = true;
    const parsedRespawnMs = Number(demolition.durationMs);
    const respawnMs = Number.isFinite(parsedRespawnMs) ? Math.max(200, parsedRespawnMs) : 4000;
    this.demolitionRespawnEndsAt = performance.now() / 1000 + respawnMs / 1000;
    this.demolitionStartTick = Number.isFinite(Number(demolition.stateTick))
      ? Math.max(0, Math.floor(Number(demolition.stateTick)))
      : -1;
    this.demolitionSnapshotConfirmed = false;
    this.lastRespawnSelectionSentAt = 0;
    this.lastRespawnSelectionSentIndex = -1;
    this.respawnSelectedIndex = Math.max(0, Math.min(3, Math.round(Number(demolition.selectedIndex) || 1)));
    this.respawnPoints = Array.isArray(demolition.spawnPoints) && demolition.spawnPoints.length >= 4
      ? demolition.spawnPoints.slice(0, 4)
      : this.defaultRespawnPoints(this.playerTeam);
    this.root.classList.add('demolition-respawn-active');
    this.mobileControls?.releaseAll?.();
    this.hud.setRespawnSelection?.(true, Math.max(0, this.demolitionRespawnEndsAt - performance.now() / 1000) * 1000, this.respawnSelectedIndex);
    this.chaseCamera.beginRespawnSelection?.(this.playerTeam, this.respawnPoints);
    this.createRespawnMarkers();
    this.selectRespawnPoint(this.respawnSelectedIndex, false);
  }

  handleRespawn(respawn) {
    if (!respawn) return;
    const playerId = Number(respawn.playerId);
    if (!Number.isInteger(playerId) || playerId < 0 || playerId >= this.cars.length) return;
    const position = Array.isArray(respawn.position)
      ? { x: Number(respawn.position[0]) || 0, y: Number(respawn.position[1]) || CAR_HITBOX.y, z: Number(respawn.position[2]) || 0 }
      : { x: 0, y: CAR_HITBOX.y, z: 0 };
    const yaw = Number(respawn.yaw) || 0;
    const boost = Math.max(0, Math.min(100, Number(respawn.boost) || 0));
    const car = this.cars[playerId];
    const half = yaw * 0.5;
    car?.body?.setTranslation?.(position, true);
    car?.body?.setRotation?.({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    car?.body?.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
    car?.body?.setAngvel?.({ x: 0, y: 0, z: 0 }, true);
    car?.setBoost?.(boost);
    this.demolishedPlayers.delete(playerId);
    this.setCarVisible(playerId, this.connectedPlayers.has(playerId));

    if (playerId === this.playerId) {
      this.localPredictor?.resetForRespawn?.(position, yaw, boost);
      this.lastReconciledTick = -1;
      this.endDemolitionRespawn();
    }
  }

  selectRespawnPoint(index, send = true) {
    if (!this.demolitionRespawnActive) return false;
    const choice = Math.max(0, Math.min(3, Math.round(Number(index) || 0)));
    this.respawnSelectedIndex = choice;
    const remainingMs = Math.max(0, (this.demolitionRespawnEndsAt - performance.now() / 1000) * 1000);
    this.hud.setRespawnSelection?.(true, remainingMs, choice);
    this.updateRespawnMarkerSelection();
    if (send) {
      const sent = this.network?.sendRespawnSelection?.(choice);
      if (sent) {
        this.lastRespawnSelectionSentAt = performance.now() / 1000;
        this.lastRespawnSelectionSentIndex = choice;
      }
    }
    return true;
  }

  updateDemolitionRespawn(now) {
    const remainingMs = Math.max(0, (this.demolitionRespawnEndsAt - now) * 1000);
    this.hud.setRespawnSelection?.(true, remainingMs, this.respawnSelectedIndex);

    // Re-affirm the current choice a few times during the four-second window.
    // WebSocket delivery itself is reliable, but the server deliberately uses
    // bounded game-loop queues; this makes the selection resilient even if one
    // application-level enqueue ever happens during a busy tick.
    const shouldResend = this.networked && remainingMs > 120
      && (this.lastRespawnSelectionSentIndex !== this.respawnSelectedIndex
        || now - this.lastRespawnSelectionSentAt >= 0.55);
    if (shouldResend && this.network?.sendRespawnSelection?.(this.respawnSelectedIndex)) {
      this.lastRespawnSelectionSentAt = now;
      this.lastRespawnSelectionSentIndex = this.respawnSelectedIndex;
    }
  }

  createRespawnMarkers() {
    this.clearRespawnMarkers();
    const group = new THREE.Group();
    group.name = 'DemolitionRespawnMarkers';
    group.userData.cameraOcclusionIgnore = true;
    const teamColor = this.playerTeam === 'blue' ? 0x35a6ff : 0xff8a2a;
    this.respawnMarkers = this.respawnPoints.map((point, index) => {
      const root = new THREE.Group();
      root.position.set(Number(point?.x) || 0, 0.045, Number(point?.z) || 0);
      root.userData.cameraOcclusionIgnore = true;

      const ringMaterial = new THREE.MeshBasicMaterial({
        color: teamColor,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.75, 48), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.userData.cameraOcclusionIgnore = true;
      root.add(ring);

      const coreMaterial = new THREE.MeshBasicMaterial({
        color: teamColor,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      });
      const core = new THREE.Mesh(new THREE.CircleGeometry(1.78, 40), coreMaterial);
      core.rotation.x = -Math.PI / 2;
      core.position.y = 0.008;
      core.userData.cameraOcclusionIgnore = true;
      root.add(core);

      const beaconMaterial = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.20, depthWrite: false, toneMapped: false });
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 1.15, 5.2, 24, 1, true), beaconMaterial);
      beacon.position.y = 2.6;
      beacon.userData.cameraOcclusionIgnore = true;
      root.add(beacon);
      group.add(root);
      return { root, ring, core, beacon, ringMaterial, coreMaterial, beaconMaterial, index };
    });
    this.scene.add(group);
    this.respawnMarkerGroup = group;
    this.updateRespawnMarkerSelection();
  }

  updateRespawnMarkerSelection() {
    for (const marker of this.respawnMarkers) {
      const selected = marker.index === this.respawnSelectedIndex;
      marker.ringMaterial.opacity = selected ? 0.96 : 0.34;
      marker.coreMaterial.opacity = selected ? 0.34 : 0.10;
      marker.beaconMaterial.opacity = selected ? 0.40 : 0.13;
      marker.root.scale.setScalar(selected ? 1.12 : 0.92);
    }
  }

  updateRespawnMarkers(now) {
    if (!this.demolitionRespawnActive || this.respawnMarkers.length === 0) return;
    const pulse = 1 + Math.sin(now * 5.2) * 0.055;
    for (const marker of this.respawnMarkers) {
      if (marker.index !== this.respawnSelectedIndex) continue;
      marker.ring.scale.setScalar(pulse);
      marker.beaconMaterial.opacity = 0.32 + (Math.sin(now * 5.2) * 0.5 + 0.5) * 0.16;
    }
  }

  clearRespawnMarkers() {
    if (!this.respawnMarkerGroup) {
      this.respawnMarkers = [];
      return;
    }
    this.respawnMarkerGroup.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    this.scene.remove(this.respawnMarkerGroup);
    this.respawnMarkerGroup = null;
    this.respawnMarkers = [];
  }

  endDemolitionRespawn() {
    if (!this.demolitionRespawnActive && !this.respawnMarkerGroup) return;
    this.demolitionRespawnActive = false;
    this.demolitionRespawnEndsAt = 0;
    this.demolitionStartTick = -1;
    this.demolitionSnapshotConfirmed = false;
    this.lastRespawnSelectionSentAt = 0;
    this.lastRespawnSelectionSentIndex = -1;
    this.respawnPoints = [];
    this.root.classList.remove('demolition-respawn-active');
    this.hud.setRespawnSelection?.(false);
    this.clearRespawnMarkers();
    this.chaseCamera.endRespawnSelection?.();
  }

  handleKickoff(kickoff) {
    if (!this.networked || !kickoff) return;
    if (kickoff.phase === 'countdown') {
      this.endDemolitionRespawn();
      const count = Math.max(1, Math.min(3, Math.round(Number(kickoff.count) || 1)));
      const startingFreshCountdown = count === 3 || !this.kickoffActive;
      this.goalCelebrationActive = false;
      this.goalCelebrationUntil = 0;
      this.chaseCamera?.setGoalCelebrationActive?.(false);
      this.goalExplosion?.stop();
      this.demolitionExplosion?.stop();
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
    if (replay.phase === 'start' || replay.phase === 'wait') this.endDemolitionRespawn();
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
    this.chaseCamera?.setGoalCelebrationActive?.(false);
    this.goalExplosion?.stop();
    this.demolitionExplosion?.stop();
    this.replayActive = true;
    this.replayWaiting = replay.phase === 'wait';
    this.kickoffActive = false;
    this.replayState = { ...replay };
    for (const car of this.cars) {
      car.boosting = false;
      car.boostVisualHold = 0;
      car.boostTrail?.clear?.();
    }
    this.replayFrames = this.replayWaiting
      ? []
      : this.replayBuffer.window(replay.goalTick, replay.lookbackSeconds || 6.25);
    this.replayStartedAt = performance.now() / 1000;

    if (this.replayFrames.length >= 2) {
      const sourceSeconds = (this.replayFrames.at(-1).tick - this.replayFrames[0].tick) / Math.max(1, this.network?.serverHz || 60);
      const serverWindow = Math.max(1, (Number(replay.durationMs) || 6800) / 1000 - 0.35);
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
      this.setCarVisible(i, this.connectedPlayers.has(i) && !Boolean(entity.d));
      this.cars[i].boosting = false;
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
    for (let i = 0; i < this.cars.length; i++) {
      this.setCarVisible(i, this.connectedPlayers.has(i) && !this.demolishedPlayers.has(i));
    }
    this.lastReconciledTick = -1;
  }

  resetForNetworkKickoff(resetScore = false) {
    this.endDemolitionRespawn();
    this.demolishedPlayers.clear();
    for (let i = 0; i < this.cars.length; i++) {
      if (i === this.playerId) continue;
      this.cars[i]?.reset();
    }
    this.localPredictor?.resetForKickoff();
    for (let i = 0; i < this.cars.length; i++) this.setCarVisible(i, this.connectedPlayers.has(i));
    this.ball.reset();
    this.boostPads.resetAll();
    if (resetScore) this.hud.setScore(0, 0);
    this.lastReconciledTick = -1;
  }

  stepOffline(dt) {
    if (this.offlineGoalTimeRemaining > 0) {
      this.offlineGoalTimeRemaining = Math.max(0, this.offlineGoalTimeRemaining - dt);
      this.ball.fixedUpdate(dt);
      this.offlinePreviousBallPosition.copy(this.ball.body.translation());
      this.world.step();
      this.car0.enforceSpeedLimit();
      if (this.offlineGoalTimeRemaining <= 0) {
        this.car0.reset();
        this.ball.reset();
        this.boostPads.resetAll();
        this.goalCelebrationActive = false;
        this.goalCelebrationUntil = 0;
        this.chaseCamera?.setGoalCelebrationActive?.(false);
      }
      return;
    }

    if (this.input.consumePressed('KeyB')) this.ball.reset();
    this.car0.fixedUpdate(dt);
    this.ball.fixedUpdate(dt);
    this.ball.prepareCarHit(this.car0);
    this.offlinePreviousBallPosition.copy(this.ball.body.translation());
    this.world.step();
    this.ball.applyPreparedCarHit();
    this.car0.enforceSpeedLimit();
    this.boostPads.updateOffline(this.car0, dt);
    this.detectOfflineGoal();
  }

  applyOfflineGoalKnockback(goalSign) {
    const sign = goalSign >= 0 ? 1 : -1;
    const position = this.car0.body.translation();
    const originZ = this.gameMode === 'basketball'
      ? sign * (ARENA_TUNING.length * 0.5 - 11.5)
      : sign * (ARENA_TUNING.length * 0.5 + 1.4);
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
    let goalSign = 0;

    if (this.gameMode === 'basketball') {
      const velocity = this.ball.body.linvel();
      const hoopY = 6.1;
      if (velocity.y >= -0.05 || this.offlinePreviousBallPosition.y <= hoopY || position.y > hoopY) return;
      const hoopZ = ARENA_TUNING.length * 0.5 - 11.5;
      const scoreRadius = Math.max(0.05, 12.5 - 0.96 - this.ball.radius + 0.08);
      for (const sign of [-1, 1]) {
        if (Math.hypot(position.x, position.z - sign * hoopZ) <= scoreRadius) {
          goalSign = sign;
          break;
        }
      }
      if (!goalSign) return;
    } else {
      const halfLength = ARENA_TUNING.length * 0.5;
      // Match the authoritative whole-ball rule: the back edge of the sphere must
      // be completely beyond the goal plane before the score can trigger.
      if (Math.abs(position.z) - this.ball.radius <= halfLength) return;
      if (Math.abs(position.x) + this.ball.radius > ARENA_TUNING.goalWidth * 0.5
        || position.y + this.ball.radius > ARENA_TUNING.goalHeight) return;
      goalSign = position.z >= 0 ? 1 : -1;
    }

    const scoringTeam = goalSign > 0 ? 'blue' : 'orange';
    if (goalSign > 0) this.blueScore += 1;
    else this.orangeScore += 1;

    const durationMs = 1250;
    this.offlineGoalTimeRemaining = durationMs / 1000;
    this.goalCelebrationActive = durationMs > 0;
    this.goalCelebrationUntil = performance.now() / 1000 + this.offlineGoalTimeRemaining;
    this.chaseCamera?.setGoalCelebrationActive?.(durationMs > 0);
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
    if (!state?.ball || !Array.isArray(state.cars) || state.cars.length < this.cars.length) return;

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

      const demolished = Boolean(target.d);
      if (demolished) this.demolishedPlayers.add(i);
      else this.demolishedPlayers.delete(i);
      this.setCarVisible(i, this.connectedPlayers.has(i) && !demolished);

      if (i === this.playerId && this.demolitionRespawnActive) {
        const demolitionState = evaluateDemolitionSnapshot({
          active: true,
          demolished,
          snapshotTick: state.tick,
          demolitionStartTick: this.demolitionStartTick,
          snapshotConfirmed: this.demolitionSnapshotConfirmed
        });
        this.demolitionSnapshotConfirmed = demolitionState.snapshotConfirmed;
        if (demolitionState.shouldEnd) this.endDemolitionRespawn();
      }
      if (demolished) continue;

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

  updateUltraHighImmersion(dt, enabled = true) {
    const intensity = enabled && this.profile.ultraHigh
      ? THREE.MathUtils.clamp(this.highSpeedEffects?.intensity || 0, 0, 1)
      : 0;
    const fovGain = (this.profile.mobile ? 3.8 : 5.2) * this.cameraSettings.dynamicFov;
    const targetFov = this.baseCameraFov + intensity * fovGain;
    const fovBlend = 1 - Math.exp(-5.4 * Math.max(0, Number(dt) || 0));
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, fovBlend);
    if (Math.abs(nextFov - this.camera.fov) > 0.002) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    if (this.ultraBloomPass) {
      this.ultraBloomPass.strength = this.ultraBloomBaseStrength + intensity * (this.profile.mobile ? 0.025 : 0.055);
      this.ultraBloomPass.radius = this.ultraBloomBaseRadius + intensity * (this.profile.mobile ? 0.018 : 0.035);
    }
    if (this.profile.ultraHigh) {
      this.renderer.toneMappingExposure = 1.00 + intensity * 0.012;
    }
  }

  onResize() {
    const width = Math.max(1, this.root.clientWidth || window.innerWidth);
    const height = Math.max(1, this.root.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.baseCameraFov = this.cameraSettings.fov;
    const liveGain = this.profile.ultraHigh
      ? (this.highSpeedEffects?.intensity || 0) * (this.profile.mobile ? 3.8 : 5.2) * this.cameraSettings.dynamicFov
      : 0;
    this.camera.fov = this.baseCameraFov + liveGain;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio?.(this.renderPixelRatio);
    this.composer?.setSize?.(width, height);
  }
}
