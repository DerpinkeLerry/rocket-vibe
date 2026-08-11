export class TransformBody {
  constructor(spawn = { x: 0, y: 0, z: 0 }, yaw = 0) {
    const half = yaw * 0.5;
    this._p = { x: spawn.x ?? 0, y: spawn.y ?? 0, z: spawn.z ?? 0 };
    this._r = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
    this._v = { x: 0, y: 0, z: 0 };
    this._w = { x: 0, y: 0, z: 0 };
  }

  translation() { return this._p; }
  rotation() { return this._r; }
  linvel() { return this._v; }
  angvel() { return this._w; }

  setTranslation(value) {
    this._p.x = Number(value?.x) || 0;
    this._p.y = Number(value?.y) || 0;
    this._p.z = Number(value?.z) || 0;
  }

  setRotation(value) {
    this._r.x = Number(value?.x) || 0;
    this._r.y = Number(value?.y) || 0;
    this._r.z = Number(value?.z) || 0;
    this._r.w = Number.isFinite(Number(value?.w)) ? Number(value.w) : 1;
  }

  setLinvel(value) {
    this._v.x = Number(value?.x) || 0;
    this._v.y = Number(value?.y) || 0;
    this._v.z = Number(value?.z) || 0;
  }

  setAngvel(value) {
    this._w.x = Number(value?.x) || 0;
    this._w.y = Number(value?.y) || 0;
    this._w.z = Number(value?.z) || 0;
  }

  resetForces() {}
  resetTorques() {}
  setEnabled() {}
  setAdditionalSolverIterations() {}
}
