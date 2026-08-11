import * as THREE from 'three';

export class ChaseCamera {
  constructor(camera, car) {
    this.camera = camera;
    this.car = car;
    this.position = new THREE.Vector3(0, 4.4, 8.8);
    this.lookAt = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.target = new THREE.Vector3();
    this.heightOffset = new THREE.Vector3();
    this.q = new THREE.Quaternion();
  }

  update(dt) {
    const p = this.car.body.translation();
    const r = this.car.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);

    this.forward.set(0, 0, -1).applyQuaternion(this.q);
    this.forward.y *= 0.28;
    this.forward.normalize();

    const speed = Math.min(this.car.getSpeedKmh() / 180, 1);
    const distance = 7.2 + speed * 1.4;
    const height = 3.2 + speed * 0.35;

    this.heightOffset.set(0, height, 0);
    this.desired.set(p.x, p.y, p.z)
      .addScaledVector(this.forward, -distance)
      .add(this.heightOffset);

    const posT = 1 - Math.exp(-7.5 * dt);
    this.position.lerp(this.desired, posT);
    this.camera.position.copy(this.position);

    this.target.set(p.x, p.y + 0.55, p.z).addScaledVector(this.forward, 3.0);
    this.lookAt.lerp(this.target, 1 - Math.exp(-10 * dt));
    this.camera.lookAt(this.lookAt);
  }
}
