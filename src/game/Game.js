import * as THREE from 'three';
import { Arena } from './Arena.js';
import { Ball } from './Ball.js';
import { Car } from './Car.js';
import { ChaseCamera } from './ChaseCamera.js';
import { Input } from './Input.js';
import { Hud } from './Hud.js';
import { VirtualInput } from '../network/VirtualInput.js';

const SNAPSHOT_HZ = 30;
const CLIENT_INPUT_HEARTBEAT_HZ = 20;

export class Game {
  constructor(root, RAPIER, network = null) {
    this.root = root;
    this.RAPIER = RAPIER;
    this.network = network;
    this.lanMode = Boolean(network);
    this.isAuthority = !network || network.isHost;
    this.playerId = network?.playerId ?? 0;

    this.fixedDt = 1 / 60;
    this.accumulator = 0;
    this.lastTime = performance.now() / 1000;
    this.lastRenderTime = 0;
    this.renderInterval = 1 / 60;
    this.snapshotAccumulator = 0;
    this.inputAccumulator = 0;
    this.latestNetworkState = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07111f);
    this.scene.fog = new THREE.Fog(0x07111f, 125, 295);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 390);
    this.camera.position.set(0, 5, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.9));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.root.appendChild(this.renderer.domElement);

    this.world = new RAPIER.World({ x: 0, y: -20.5, z: 0 });
    this.world.timestep = this.fixedDt;

    this.input = new Input();
    this.remoteInput = new VirtualInput();
    this.passiveInput = new VirtualInput();
    this.arena = new Arena(this.scene, this.world, RAPIER);

    const car0Input = this.isAuthority ? this.input : this.passiveInput;
    const car1Input = this.isAuthority ? this.remoteInput : this.passiveInput;

    this.car0 = new Car(this.scene, this.world, RAPIER, car0Input, {
      spawn: { x: 0, y: 1.25, z: 44 },
      spawnYaw: 0,
      color: 0xf46b20
    });
    this.car1 = new Car(this.scene, this.world, RAPIER, car1Input, {
      spawn: { x: 0, y: 1.25, z: -44 },
      spawnYaw: Math.PI,
      color: 0x238cff
    });

    this.ball = new Ball(this.scene, this.world, RAPIER, this.passiveInput);

    if (!this.lanMode) {
      this.car1.group.visible = false;
      this.car1.shadow.visible = false;
      this.car1.collider.setEnabled(false);
    } else if (this.isAuthority && !this.network.peerConnected) {
      this.setRemoteCarActive(false);
    }

    this.car = this.playerId === 1 ? this.car1 : this.car0;
    this.chaseCamera = new ChaseCamera(this.camera, this.car);
    this.hud = new Hud(this.root, { lan: this.lanMode, playerId: this.playerId });

    if (this.network) {
      this.network.onStatus = (text) => this.hud.setNetworkStatus(text);
      this.network.onPeerChange = (connected) => {
        if (this.isAuthority) this.setRemoteCarActive(connected);
      };
      if (this.isAuthority) {
        this.network.onRemoteInput = (packet, playerId) => {
          if (playerId === 1) this.remoteInput.applyPacket(packet);
        };
        this.hud.setNetworkStatus(this.network.peerConnected ? 'HOST · Spieler 2 verbunden' : 'HOST · Warte auf Spieler 2');
      } else {
        this.network.onState = (state) => { this.latestNetworkState = state; };
        this.hud.setNetworkStatus('SPIELER 2 · Mit Host verbunden');

        // Key changes are sent immediately instead of waiting for the render
        // loop. A low-rate heartbeat resends the current held-key mask so a
        // remote car can never become unresponsive because of frame timing.
        this.input.setNetworkChangeHandler(() => this.sendClientInput());
        this.sendClientInput();
      }
    }

    this.netPos = new THREE.Vector3();
    this.netTargetPos = new THREE.Vector3();
    this.netQuat = new THREE.Quaternion();
    this.netTargetQuat = new THREE.Quaternion();

    this.addSkyDecoration();
    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', this.onResize);
  }

  setRemoteCarActive(active) {
    this.remoteInput.clear();
    this.car1.group.visible = active;
    this.car1.shadow.visible = active;
    this.car1.collider.setEnabled(active);
    if (active) this.car1.reset();
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
    this.car0.syncVisual();
    this.car1.syncVisual();
    this.ball.syncVisual();
    requestAnimationFrame(this.loop);
  }

  loop(nowMs) {
    const now = nowMs / 1000;
    let frameDt = Math.min(now - this.lastTime, 0.08);
    this.lastTime = now;

    if (this.lanMode && !this.isAuthority) {
      this.inputAccumulator += frameDt;
      if (this.inputAccumulator >= 1 / CLIENT_INPUT_HEARTBEAT_HZ) {
        this.inputAccumulator %= 1 / CLIENT_INPUT_HEARTBEAT_HZ;
        this.sendClientInput();
      }
      this.applyNetworkState(frameDt);
    } else {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < 4) {
        this.stepAuthority(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps += 1;
      }
      if (steps === 4 && this.accumulator > this.fixedDt * 2) this.accumulator = this.fixedDt;
    }

    if (this.lastRenderTime === 0 || now - this.lastRenderTime >= this.renderInterval - 0.001) {
      const renderDt = this.lastRenderTime === 0 ? frameDt : Math.min(now - this.lastRenderTime, 0.08);
      this.lastRenderTime = now;

      this.car0.syncVisual();
      this.car1.syncVisual();
      this.ball.syncVisual();
      this.chaseCamera.update(renderDt);
      this.hud.update(this.car);
      this.renderer.render(this.scene, this.camera);
    }

    requestAnimationFrame(this.loop);
  }

  sendClientInput() {
    if (!this.lanMode || this.isAuthority) return;
    this.network.sendInput(this.input.takeNetworkPacket());
  }

  stepAuthority(dt) {
    if (this.input.consumePressed('KeyB') || this.remoteInput.consumePressed('KeyB')) this.ball.reset();

    this.car0.fixedUpdate(dt);
    if (this.lanMode && this.network.peerConnected) this.car1.fixedUpdate(dt);
    this.ball.fixedUpdate(dt);
    this.world.step();

    if (this.network?.isHost) {
      this.snapshotAccumulator += dt;
      if (this.snapshotAccumulator >= 1 / SNAPSHOT_HZ) {
        this.snapshotAccumulator %= 1 / SNAPSHOT_HZ;
        this.network.sendState(this.createSnapshot());
      }
    }
  }

  createSnapshot() {
    return {
      cars: [this.bodySnapshot(this.car0.body, this.car0.grounded), this.bodySnapshot(this.car1.body, this.car1.grounded)],
      ball: this.bodySnapshot(this.ball.body, false)
    };
  }

  bodySnapshot(body, grounded) {
    const p = body.translation();
    const r = body.rotation();
    const v = body.linvel();
    const w = body.angvel();
    return {
      p: [p.x, p.y, p.z],
      r: [r.x, r.y, r.z, r.w],
      v: [v.x, v.y, v.z],
      w: [w.x, w.y, w.z],
      g: grounded ? 1 : 0
    };
  }

  applyNetworkState(dt) {
    const state = this.latestNetworkState;
    if (!state?.cars?.[0] || !state?.cars?.[1] || !state?.ball) return;

    this.smoothBody(this.car0.body, state.cars[0], dt);
    this.smoothBody(this.car1.body, state.cars[1], dt);
    this.smoothBody(this.ball.body, state.ball, dt);
    this.car0.grounded = Boolean(state.cars[0].g);
    this.car1.grounded = Boolean(state.cars[1].g);
  }

  smoothBody(body, target, dt) {
    const alpha = 1 - Math.exp(-24 * dt);
    const p = body.translation();
    const r = body.rotation();

    this.netPos.set(p.x, p.y, p.z);
    this.netTargetPos.fromArray(target.p);
    this.netPos.lerp(this.netTargetPos, alpha);

    this.netQuat.set(r.x, r.y, r.z, r.w);
    this.netTargetQuat.fromArray(target.r);
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.9));
  }
}
