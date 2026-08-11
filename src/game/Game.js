import * as THREE from 'three';
import { Arena } from './Arena.js';
import { Ball } from './Ball.js';
import { Car } from './Car.js';
import { ChaseCamera } from './ChaseCamera.js';
import { Input } from './Input.js';
import { Hud } from './Hud.js';

export class Game {
  constructor(root, RAPIER) {
    this.root = root;
    this.RAPIER = RAPIER;

    // Performance-first defaults. 60 Hz is plenty for this arcade prototype
    // and halves physics work compared with v0.3's 120 Hz.
    this.fixedDt = 1 / 60;
    this.accumulator = 0;
    this.lastTime = performance.now() / 1000;
    this.lastRenderTime = 0;
    this.renderInterval = 1 / 60;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.9));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Real-time shadow maps were the single largest GPU cost in v0.3.
    // Car and ball use cheap fake blob shadows instead.
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.root.appendChild(this.renderer.domElement);

    this.world = new RAPIER.World({ x: 0, y: -20.5, z: 0 });
    this.world.timestep = this.fixedDt;

    this.input = new Input();
    this.arena = new Arena(this.scene, this.world, RAPIER);
    this.car = new Car(this.scene, this.world, RAPIER, this.input);
    this.ball = new Ball(this.scene, this.world, RAPIER, this.input);
    this.chaseCamera = new ChaseCamera(this.camera, this.car);
    this.hud = new Hud(this.root);

    this.addSkyDecoration();

    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
    window.addEventListener('resize', this.onResize);
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
    this.car.syncVisual();
    this.ball.syncVisual();
    requestAnimationFrame(this.loop);
  }

  loop(nowMs) {
    const now = nowMs / 1000;
    let frameDt = now - this.lastTime;
    this.lastTime = now;
    frameDt = Math.min(frameDt, 0.08);
    this.accumulator += frameDt;

    // Avoid spiral-of-death on weak PCs. At most 4 catch-up steps per frame;
    // dropping excess simulation time feels better than a multi-second freeze.
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < 4) {
      this.car.fixedUpdate(this.fixedDt);
      this.ball.fixedUpdate(this.fixedDt);
      this.world.step();
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    if (steps === 4 && this.accumulator > this.fixedDt * 2) {
      this.accumulator = this.fixedDt;
    }

    // Cap rendering at 60 FPS even on 120/144/240 Hz monitors. This keeps
    // GPU/CPU usage predictable and is a large win on weaker systems.
    if (this.lastRenderTime === 0 || now - this.lastRenderTime >= this.renderInterval - 0.001) {
      const renderDt = this.lastRenderTime === 0 ? frameDt : Math.min(now - this.lastRenderTime, 0.08);
      this.lastRenderTime = now;

      this.car.syncVisual();
      this.ball.syncVisual();
      this.chaseCamera.update(renderDt);
      this.hud.update(this.car);
      this.renderer.render(this.scene, this.camera);
    }

    requestAnimationFrame(this.loop);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.9));
  }
}
