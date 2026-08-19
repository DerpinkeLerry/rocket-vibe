import { ARENA_TUNING } from '../shared/arena-tuning.js';
import { INPUT_FLAGS } from '../shared/game-tuning.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const smoothstep = (a, b, value) => {
  const t = clamp((Number(value) - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const SOLO_DIFFICULTIES = Object.freeze([
  Object.freeze({ id: 'rookie', name: 'ROOKIE', description: 'Ruhige Reaktionen, wenig Boost und einfachere Schüsse.' }),
  Object.freeze({ id: 'pro', name: 'PRO', description: 'Gute Rotation, Ballvorhersage, Boost und sichere Sprünge.' }),
  Object.freeze({ id: 'all-star', name: 'ALL-STAR', description: 'Schnelle Entscheidungen, präzise Winkel und aggressive Flips.' })
]);

const DIFFICULTY = Object.freeze({
  rookie: Object.freeze({ reaction: 0.18, prediction: 0.38, aimError: 2.2, steerAngle: 0.56, maxSteer: 0.78, boost: false, jump: false }),
  pro: Object.freeze({ reaction: 0.085, prediction: 0.68, aimError: 0.75, steerAngle: 0.43, maxSteer: 0.96, boost: true, jump: true }),
  'all-star': Object.freeze({ reaction: 0.035, prediction: 0.92, aimError: 0.16, steerAngle: 0.34, maxSteer: 1, boost: true, jump: true })
});

export function normalizeSoloDifficulty(value) {
  const id = String(value || '').toLowerCase();
  return DIFFICULTY[id] ? id : 'pro';
}

export function normalizeSoloBotConfig(value = {}) {
  return Object.freeze({
    teammates: Math.round(clamp(value.teammates, 0, 3)),
    opponents: Math.round(clamp(value.opponents ?? 1, 0, 4)),
    teammateDifficulty: normalizeSoloDifficulty(value.teammateDifficulty),
    opponentDifficulty: normalizeSoloDifficulty(value.opponentDifficulty)
  });
}

function readBodyState(car) {
  const position = car?.body?.translation?.() ?? {};
  const velocity = car?.body?.linvel?.() ?? {};
  const rotation = car?.body?.rotation?.() ?? {};
  return {
    position: { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 },
    velocity: { x: Number(velocity.x) || 0, y: Number(velocity.y) || 0, z: Number(velocity.z) || 0 },
    rotation: {
      x: Number(rotation.x) || 0,
      y: Number(rotation.y) || 0,
      z: Number(rotation.z) || 0,
      w: Number.isFinite(Number(rotation.w)) ? Number(rotation.w) : 1
    }
  };
}

function carForward(rotation = {}) {
  const x = Number(rotation.x) || 0;
  const y = Number(rotation.y) || 0;
  const z = Number(rotation.z) || 0;
  const w = Number.isFinite(Number(rotation.w)) ? Number(rotation.w) : 1;
  const fx = -2 * (x * z + w * y);
  const fz = -(1 - 2 * (x * x + y * y));
  const length = Math.max(1e-6, Math.hypot(fx, fz));
  return { x: fx / length, z: fz / length };
}

function planarDistance(a, b) {
  return Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.z) || 0) - (Number(b?.z) || 0));
}

export function chooseSoloBotTarget(options = {}) {
  const team = options.team === 'blue' ? 'blue' : 'orange';
  const profile = DIFFICULTY[normalizeSoloDifficulty(options.difficulty)];
  const car = options.carState ?? { position: {}, velocity: {} };
  const ball = options.ballState ?? { position: {}, velocity: {} };
  const teamCars = Array.isArray(options.teamCars) ? options.teamCars : [];
  const halfLength = Math.max(20, Number(options.arenaLength) || ARENA_TUNING.length) * 0.5;
  const ownSign = team === 'orange' ? 1 : -1;
  const ownGoalZ = ownSign * halfLength;
  const opponentGoalZ = -ownGoalZ;
  const ballDistance = planarDistance(car.position, ball.position);
  let localPlayerClaimsBall = false;
  const closestDistance = teamCars.reduce((closest, teammate) => {
    const state = teammate?.position ? teammate : readBodyState(teammate);
    const distance = planarDistance(state.position, ball.position);
    if (teammate?.isLocalPlayer && distance <= ballDistance + 0.30) localPlayerClaimsBall = true;
    return Math.min(closest, distance);
  }, Infinity);
  const roleIndex = Math.max(0, Number(options.roleIndex) || 0);
  const winsBotTie = roleIndex === 0 && ballDistance <= closestDistance + 0.05;
  const striker = !localPlayerClaimsBall
    && (teamCars.length === 0 || ballDistance < closestDistance - 0.12 || winsBotTie);
  const defensiveDanger = (Number(ball.position?.z) || 0) * ownSign > halfLength * 0.16;

  if (!striker && !defensiveDanger) {
    const lane = Number(options.roleIndex) % 2 === 0 ? -1 : 1;
    return Object.freeze({
      x: clamp((Number(ball.position?.x) || 0) * 0.48 + lane * 5.2, -halfLength * 0.62, halfLength * 0.62),
      y: 0,
      z: clamp(ownGoalZ * 0.52 + (Number(ball.position?.z) || 0) * 0.38, -halfLength + 5, halfLength - 5),
      role: 'support',
      ballDistance
    });
  }

  if (!striker && defensiveDanger) {
    return Object.freeze({
      x: clamp((Number(ball.position?.x) || 0) * 0.72, -12, 12),
      y: 0,
      z: clamp(ownGoalZ - ownSign * 8.5, -halfLength + 4, halfLength - 4),
      role: 'defend',
      ballDistance
    });
  }

  const carSpeed = Math.hypot(Number(car.velocity?.x) || 0, Number(car.velocity?.z) || 0);
  const leadTime = clamp(ballDistance / Math.max(9, carSpeed + 4), 0.04, profile.prediction);
  const predictedX = (Number(ball.position?.x) || 0) + (Number(ball.velocity?.x) || 0) * leadTime;
  const predictedZ = (Number(ball.position?.z) || 0) + (Number(ball.velocity?.z) || 0) * leadTime;
  const goalDx = -predictedX;
  const goalDz = opponentGoalZ - predictedZ;
  const goalDistance = Math.max(1e-6, Math.hypot(goalDx, goalDz));
  const shotX = goalDx / goalDistance;
  const shotZ = goalDz / goalDistance;
  const approachX = predictedX - (Number(car.position?.x) || 0);
  const approachZ = predictedZ - (Number(car.position?.z) || 0);
  const approachDistance = Math.max(1e-6, Math.hypot(approachX, approachZ));
  const alignment = smoothstep(-0.15, 0.72, (approachX * shotX + approachZ * shotZ) / approachDistance);
  const contactOffset = 1.72 * alignment * smoothstep(1.8, 6.5, ballDistance);
  const phase = (Number(options.elapsed) || 0) * 0.72 + (Number(options.seed) || 1) * 1.731;
  const error = Math.sin(phase) * profile.aimError;

  return Object.freeze({
    x: predictedX - shotX * contactOffset + error,
    y: Number(ball.position?.y) || 0,
    z: predictedZ - shotZ * contactOffset,
    role: defensiveDanger ? 'clear' : 'attack',
    ballDistance,
    leadTime,
    alignment
  });
}

export function computeSoloBotDrive(options = {}) {
  const profile = DIFFICULTY[normalizeSoloDifficulty(options.difficulty)];
  const car = options.carState ?? { position: {}, velocity: {}, rotation: {} };
  const target = options.target ?? {};
  const forward = carForward(car.rotation);
  const dx = (Number(target.x) || 0) - (Number(car.position?.x) || 0);
  const dz = (Number(target.z) || 0) - (Number(car.position?.z) || 0);
  const distance = Math.max(1e-6, Math.hypot(dx, dz));
  const angle = Math.atan2(forward.z * dx - forward.x * dz, forward.x * dx + forward.z * dz);
  const speed = Math.hypot(Number(car.velocity?.x) || 0, Number(car.velocity?.z) || 0);
  const absAngle = Math.abs(angle);
  const reversing = absAngle > 2.48 && distance < 8;
  const steerDirection = reversing ? -1 : 1;
  const steer = clamp(angle / profile.steerAngle, -profile.maxSteer, profile.maxSteer) * steerDirection;
  const throttle = reversing ? -0.68 : clamp(1.08 - absAngle * 0.38, 0.30, 1);
  const boost = profile.boost && !reversing && absAngle < 0.17 && distance > 7.5 && speed < 22
    && Number(options.boost) > 8 && target.role !== 'defend';
  const drift = !reversing && absAngle > 0.78 && speed > 8 && profile.maxSteer > 0.8;
  return Object.freeze({ throttle, steer, boost, drift, angle, distance });
}

export class SoloBotController {
  constructor(car, input, options = {}) {
    this.car = car;
    this.input = input;
    this.team = options.team === 'blue' ? 'blue' : 'orange';
    this.difficulty = normalizeSoloDifficulty(options.difficulty);
    this.profile = DIFFICULTY[this.difficulty];
    this.roleIndex = Math.max(0, Number(options.roleIndex) || 0);
    this.seed = Math.max(1, Number(options.seed) || 1);
    this.elapsed = 0;
    this.decisionRemaining = 0;
    this.jumpCooldown = 0;
    this.jumpHeldFor = 0;
    this.secondJumpReady = false;
    this.stuckFor = 0;
    this.drive = { throttle: 0, steer: 0, boost: false, drift: false, angle: 0, distance: Infinity };
    this.target = { x: 0, y: 0, z: 0, role: 'support', ballDistance: Infinity };
  }

  reset() {
    this.input.clear?.();
    this.decisionRemaining = 0;
    this.jumpCooldown = 0;
    this.jumpHeldFor = 0;
    this.secondJumpReady = false;
    this.stuckFor = 0;
  }

  update(dt, ball, cars) {
    this.elapsed += dt;
    this.decisionRemaining -= dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.jumpHeldFor = Math.max(0, this.jumpHeldFor - dt);
    const carState = readBodyState(this.car);
    const ballState = readBodyState(ball);
    const speed = Math.hypot(carState.velocity.x, carState.velocity.z);
    this.stuckFor = speed < 0.7 && Math.abs(this.drive.throttle) > 0.7 ? this.stuckFor + dt : Math.max(0, this.stuckFor - dt * 2);
    let edges = 0;

    if (this.decisionRemaining <= 0) {
      const teammates = cars.filter((candidate) => candidate !== this.car && candidate?.team === this.team && candidate?.group?.visible !== false);
      this.target = chooseSoloBotTarget({
        team: this.team,
        difficulty: this.difficulty,
        carState,
        ballState,
        teamCars: teammates,
        roleIndex: this.roleIndex,
        elapsed: this.elapsed,
        seed: this.seed,
        arenaLength: ARENA_TUNING.length
      });
      this.drive = computeSoloBotDrive({
        difficulty: this.difficulty,
        carState,
        target: this.target,
        boost: this.car.getBoost?.() ?? this.car.boost
      });

      const verticalDelta = ballState.position.y - carState.position.y;
      const canReachBall = this.target.role === 'attack' || this.target.role === 'clear';
      if (this.profile.jump && canReachBall && this.car.grounded && this.jumpCooldown <= 0
        && this.target.ballDistance < 4.8 && verticalDelta > 0.72 && verticalDelta < 3.8
        && Math.abs(this.drive.angle) < 0.30) {
        edges |= 1;
        this.jumpHeldFor = this.difficulty === 'all-star' ? 0.16 : 0.11;
        this.jumpCooldown = 0.72;
        this.secondJumpReady = true;
      } else if (this.profile.jump && this.secondJumpReady && this.car.jumpCount === 1
        && this.car.airTime > 0.13 && this.target.ballDistance < 3.2
        && Math.abs(this.drive.angle) < 0.32) {
        edges |= 1;
        this.secondJumpReady = false;
      }

      if (this.stuckFor > 3.2) {
        edges |= 1 << 1;
        this.stuckFor = 0;
      }
      this.decisionRemaining = this.profile.reaction;
    }

    let mask = 0;
    if (this.drive.boost) mask |= 1 << 6;
    if (this.jumpHeldFor > 0) mask |= 1 << 7;
    const flags = INPUT_FLAGS.ANALOG | (this.drive.drift ? INPUT_FLAGS.DRIFT : 0);
    this.input.applyPacket({
      mask,
      flags,
      edges,
      throttle: this.drive.throttle,
      steer: this.drive.steer
    });
    return Object.freeze({ ...this.drive, target: this.target });
  }
}
