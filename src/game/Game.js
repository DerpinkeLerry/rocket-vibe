import * as THREE from 'three';
import { Arena } from './Arena.js';
import { Ball } from './Ball.js';
import { Car } from './Car.js';
import { ChaseCamera } from './ChaseCamera.js';
import { Input } from './Input.js';
import { Hud } from './Hud.js';
import { VirtualInput } from '../network/VirtualInput.js';
import { LocalCarPredictor } from '../network/LocalCarPredictor.js';

// Key changes are sent immediately. This is only a safety heartbeat for held keys.
const CLIENT_INPUT_HEARTBEAT_HZ = 15;

const PLAYER_CONFIGS = [
  { spawn: { x: -13, y: 1.25, z: 44 }, spawnYaw: 0, color: 0xf46b20 },
  { spawn: { x: -13, y: 1.25, z: -44 }, spawnYaw: Math.PI, color: 0x238cff },
  { spawn: { x: 13, y: 1.25, z: 44 }, spawnYaw: 0, color: 0xffa51f },
  { spawn: { x: 13, y: 1.25, z: -44 }, spawnYaw: Math.PI, color: 0x35d7ff }
];

export class Game {
  constructor(root, RAPIER, network = null) {
    this.root = root;
    this.RAPIER = RAPIER;
    this.network = network;
    this.networked = Boolean(network);
    this.playerId = network?.playerId ?? 0;

    this.fixedDt = 1 / 60;
    this.accumulator = 0;
    this.lastTime = performance.now() / 1000;
    this.lastRenderTime = 0;
    this.renderInterval = 1 / 60;
    this.inputAccumulator = 0;
    this.latestNetworkState = null;
    this.latestNetworkStateReceivedAt = 0;
    this.connectedPlayers = new Set(network?.connectedPlayers ?? (this.networked ? [this.playerId] : [0]));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07111f);
    this.scene.fog = new THREE.Fog(0x07111f, 125, 295);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 390);
    this.camera.position.set(0, 5, 10);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true
    });
    this.pixelRatioCap = this.networked ? 0.75 : 0.9;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.root.appendChild(this.renderer.domElement);

    // Online: Rapier in the browser is only a lightweight transform store.
    // Railway remains authoritative for collisions and final match state.
    this.world = new RAPIER.World({ x: 0, y: -20.5, z: 0 });
    this.world.timestep = this.fixedDt;

    this.input = new Input();
    this.passiveInput = new VirtualInput();
    this.arena = new Arena(this.scene, this.world, RAPIER);

    this.cars = PLAYER_CONFIGS.map((config, index) => new Car(
      this.scene,
      this.world,
      RAPIER,
      !this.networked && index === 0 ? this.input : this.passiveInput,
      config
    ));
    [this.car0, this.car1, this.car2, this.car3] = this.cars;
    this.ball = new Ball(this.scene, this.world, RAPIER, this.passiveInput);

    if (this.networked) {
      for (const car of this.cars) car.collider.setEnabled(false);
      this.ball.collider.setEnabled(false);
      this.setRoster([...this.connectedPlayers], network?.maxPlayers ?? 4);
    } else {
      for (let i = 1; i < this.cars.length; i++) this.setCarVisible(i, false);
    }

    this.car = this.cars[this.playerId] ?? this.car0;
    this.localPredictor = this.networked ? new LocalCarPredictor(this.car) : null;
    this.chaseCamera = new ChaseCamera(this.camera, this.car, this.ball);
    this.hud = new Hud(this.root, {
      lan: this.networked,
      playerId: this.playerId,
      playerCount: this.connectedPlayers.size,
      maxPlayers: network?.maxPlayers ?? 4
    });

    if (this.network) {
      this.network.onStatus = (text) => this.hud.setNetworkStatus(text);
      this.network.onState = (state) => {
        this.latestNetworkState = state;
        this.latestNetworkStateReceivedAt = performance.now() / 1000;
      };
      this.network.onRoster = (players, maxPlayers) => this.setRoster(players, maxPlayers);
      this.network.onLatency = (rttMs) => this.hud.setPing(rttMs);

      // Every key transition is transmitted instantly and also fed into local
      // prediction before the server round-trip finishes.
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

    this.addSkyDecoration();
    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', this.onResize);
  }

  setCarVisible(index, visible) {
    const car = this.cars[index];
    if (!car) return;
    car.group.visible = visible;
    car.shadow.visible = visible;
  }

  setRoster(players, maxPlayers = 4) {
    this.connectedPlayers = new Set((players ?? []).map(Number));
    if (this.networked) {
      for (let i = 0; i < this.cars.length; i++) this.setCarVisible(i, this.connectedPlayers.has(i));
    }
    this.hud?.setPlayerCount(this.connectedPlayers.size, maxPlayers);
  }

  addSkyDecoration() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(220, 20, 10),
      new THREE.MeshBasicMaterial({ color: 0x0b2038, side: THREE.BackSide, fog: false })
    );
    dome.position.y = 26;
    this.scene.add(dome);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(102, 0.16, 6, 64),
      new THREE.MeshBasicMaterial({ color: 0x2bcaff, transparent: true, opacity: 0.28, fog: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 36;
    this.scene.add(ring);
  }

  start() {
    for (const car of this.cars) car.syncVisual();
    this.ball.syncVisual();
    requestAnimationFrame(this.loop);
  }

  loop(nowMs) {
    const now = nowMs / 1000;
    const frameDt = Math.min(now - this.lastTime, 0.08);
    this.lastTime = now;

    if (this.networked) {
      this.inputAccumulator += frameDt;
      if (this.inputAccumulator >= 1 / CLIENT_INPUT_HEARTBEAT_HZ) {
        this.inputAccumulator %= 1 / CLIENT_INPUT_HEARTBEAT_HZ;
        this.sendNetworkInput();
      }

      // First reconcile toward the latest authoritative present-time estimate,
      // then predict this frame from local input. That ordering keeps controls
      // immediate instead of allowing a snapshot to cancel the newest key press.
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

      for (const car of this.cars) {
        if (car.group.visible) car.syncVisual();
      }
      this.ball.syncVisual();
      this.chaseCamera.update(renderDt);
      this.hud.update(this.car);
      this.renderer.render(this.scene, this.camera);
    }

    requestAnimationFrame(this.loop);
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
    this.world.step();
  }

  applyNetworkState(dt, now) {
    const state = this.latestNetworkState;
    if (!state?.ball || !Array.isArray(state.cars) || state.cars.length < 4) return;

    if (Array.isArray(state.connected)) {
      const roster = [];
      for (let i = 0; i < state.connected.length; i++) if (state.connected[i]) roster.push(i);
      this.setRoster(roster, this.network?.maxPlayers ?? 4);
    }

    const packetAge = Math.max(0, now - this.latestNetworkStateReceivedAt);
    const rttMs = this.network?.rttMs ?? 0;

    for (let i = 0; i < this.cars.length; i++) {
      const target = state.cars[i];
      if (!target) continue;

      if (i === this.playerId) {
        this.localPredictor?.reconcile(target, dt, packetAge, rttMs);
      } else {
        this.smoothRemoteBody(this.cars[i].body, target, dt, packetAge, rttMs, 28, 0.12);
        this.cars[i].grounded = Boolean(target.g);
      }
    }

    this.smoothRemoteBody(this.ball.body, state.ball, dt, packetAge, rttMs, 30, 0.10);
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
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
  }
}
