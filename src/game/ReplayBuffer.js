import { ALL_BOOST_PADS_MASK } from '../shared/boost-tuning.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function copyEntity(entity = {}) {
  return {
    p: Array.from(entity.p ?? [0, 0, 0], Number),
    r: Array.from(entity.r ?? [0, 0, 0, 1], Number),
    v: Array.from(entity.v ?? [0, 0, 0], Number),
    w: Array.from(entity.w ?? [0, 0, 0], Number),
    g: Number(entity.g) || 0,
    d: Number(entity.d) || 0,
    b: Number.isFinite(Number(entity.b)) ? Number(entity.b) : 100
  };
}

export function cloneReplayState(state) {
  return {
    tick: Math.max(0, Number(state?.tick) || 0),
    orangeScore: Math.max(0, Number(state?.orangeScore) || 0),
    blueScore: Math.max(0, Number(state?.blueScore) || 0),
    boostPadMask: Number.isFinite(Number(state?.boostPadMask)) ? Number(state.boostPadMask) : ALL_BOOST_PADS_MASK,
    connected: Array.from(state?.connected ?? [0, 0, 0, 0], (value) => Number(value) ? 1 : 0),
    cars: Array.from({ length: 4 }, (_, index) => copyEntity(state?.cars?.[index])),
    ball: copyEntity(state?.ball)
  };
}

function lerpArray(a, b, t) {
  const length = Math.min(a.length, b.length);
  const result = new Array(length);
  for (let i = 0; i < length; i++) result[i] = a[i] + (b[i] - a[i]) * t;
  return result;
}

function nlerpQuaternion(a, b, t) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let x = a[0] + (bx - a[0]) * t;
  let y = a[1] + (by - a[1]) * t;
  let z = a[2] + (bz - a[2]) * t;
  let w = a[3] + (bw - a[3]) * t;
  const length = Math.hypot(x, y, z, w) || 1;
  x /= length; y /= length; z /= length; w /= length;
  return [x, y, z, w];
}

function interpolateEntity(a, b, t) {
  return {
    p: lerpArray(a.p, b.p, t),
    r: nlerpQuaternion(a.r, b.r, t),
    v: lerpArray(a.v, b.v, t),
    w: lerpArray(a.w, b.w, t),
    g: t < 0.5 ? a.g : b.g,
    d: t < 0.5 ? a.d : b.d,
    b: a.b + (b.b - a.b) * t
  };
}

export function sampleReplayFrames(frames, progress) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  if (frames.length === 1) return cloneReplayState(frames[0]);

  const first = frames[0];
  const last = frames[frames.length - 1];
  const targetTick = first.tick + (last.tick - first.tick) * clamp01(progress);
  let high = 1;
  while (high < frames.length && frames[high].tick < targetTick) high++;
  if (high >= frames.length) return cloneReplayState(last);
  const low = Math.max(0, high - 1);
  const a = frames[low];
  const b = frames[high];
  const span = Math.max(1e-6, b.tick - a.tick);
  const t = clamp01((targetTick - a.tick) / span);
  return {
    tick: targetTick,
    orangeScore: t < 0.5 ? a.orangeScore : b.orangeScore,
    blueScore: t < 0.5 ? a.blueScore : b.blueScore,
    boostPadMask: t < 0.5 ? a.boostPadMask : b.boostPadMask,
    connected: t < 0.5 ? [...a.connected] : [...b.connected],
    cars: a.cars.map((entity, index) => interpolateEntity(entity, b.cars[index], t)),
    ball: interpolateEntity(a.ball, b.ball, t)
  };
}

export class ReplayBuffer {
  constructor(serverHz = 60, maxSeconds = 8) {
    this.serverHz = Math.max(1, Number(serverHz) || 60);
    this.maxSeconds = Math.max(2, Number(maxSeconds) || 8);
    this.frames = [];
  }

  push(state) {
    if (!state || !Number.isFinite(Number(state.tick))) return;
    const frame = cloneReplayState(state);
    const previous = this.frames[this.frames.length - 1];
    if (previous && frame.tick <= previous.tick) {
      if (frame.tick === previous.tick) this.frames[this.frames.length - 1] = frame;
      return;
    }
    this.frames.push(frame);
    const minimumTick = frame.tick - this.serverHz * this.maxSeconds;
    while (this.frames.length > 2 && this.frames[0].tick < minimumTick) this.frames.shift();
  }

  window(goalTick, lookbackSeconds = 5) {
    const endTick = Math.max(0, Number(goalTick) || 0);
    const startTick = endTick - Math.max(1, Number(lookbackSeconds) || 5) * this.serverHz;
    const selected = this.frames.filter((frame) => frame.tick >= startTick && frame.tick <= endTick);
    if (selected.length >= 2) return selected;
    // If the goal happened between network snapshots, include the closest older
    // authoritative frame so the replay still reaches the scoring moment.
    const older = this.frames.filter((frame) => frame.tick <= endTick);
    return older.slice(Math.max(0, older.length - Math.max(2, Math.ceil(this.serverHz * lookbackSeconds / 2))));
  }

  clear() {
    this.frames.length = 0;
  }
}
