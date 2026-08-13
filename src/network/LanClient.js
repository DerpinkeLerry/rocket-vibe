import { DEFAULT_CAR_STYLE, normalizeCarStyle } from '../shared/car-styles.js';
import { DEFAULT_BOOST_STYLE, normalizeBoostStyle } from '../shared/boost-styles.js';
import { ALL_BOOST_PADS_MASK } from '../shared/boost-tuning.js';

const MSG_INPUT = 1;
const MSG_STATE = 2;
const ENTITY_FLOATS = 13;
const ENTITY_COUNT = 5; // 4 cars + ball.
const LEGACY_STATE_HEADER_BYTES = 11;
const PREVIOUS_STATE_HEADER_BYTES = 17;
const STATE_HEADER_BYTES = 23;
const LEGACY_STATE_BYTES = LEGACY_STATE_HEADER_BYTES + ENTITY_FLOATS * ENTITY_COUNT * 4;
const PREVIOUS_STATE_BYTES = PREVIOUS_STATE_HEADER_BYTES + ENTITY_FLOATS * ENTITY_COUNT * 4;
const STATE_BYTES = STATE_HEADER_BYTES + ENTITY_FLOATS * ENTITY_COUNT * 4;

function makeEntity() {
  return {
    p: [0, 0, 0],
    r: [0, 0, 0, 1],
    v: [0, 0, 0],
    w: [0, 0, 0],
    g: 0,
    b: 100
  };
}

function normalizePlayers(players, connectedPlayers = []) {
  if (Array.isArray(players) && players.length > 0) {
    return players
      .map((player) => ({
        playerId: Number(player?.playerId),
        name: String(player?.name || '').trim().slice(0, 16),
        team: player?.team === 'blue' ? 'blue' : 'orange',
        carStyle: normalizeCarStyle(player?.carStyle),
        boostStyle: normalizeBoostStyle(player?.boostStyle)
      }))
      .filter((player) => Number.isInteger(player.playerId) && player.playerId >= 0 && player.playerId < 4);
  }
  return connectedPlayers.map((playerId) => ({
    playerId: Number(playerId),
    name: `Spieler ${Number(playerId) + 1}`,
    team: Number(playerId) % 2 === 0 ? 'orange' : 'blue',
    carStyle: DEFAULT_CAR_STYLE,
    boostStyle: DEFAULT_BOOST_STYLE
  }));
}

export class LanClient {
  constructor(playerName = '', carStyle = DEFAULT_CAR_STYLE, boostStyle = DEFAULT_BOOST_STYLE) {
    this.socket = null;
    this.playerId = 0;
    this.playerName = String(playerName || '').trim().slice(0, 16);
    this.carStyle = normalizeCarStyle(carStyle);
    this.boostStyle = normalizeBoostStyle(boostStyle);
    this.team = 'orange';
    this.maxPlayers = 4;
    this.serverHz = 60;
    this.snapshotHz = 20;
    this.connectedPlayers = [];
    this.players = [];
    this.connected = false;
    this.inputSeq = 0;
    this.lastInputAck = 0;
    this.activeInputConfirmed = false;
    this.motionConfirmed = false;
    this.rttMs = 0;
    this.pingTimer = null;
    this.state = {
      tick: 0,
      orangeScore: 0,
      blueScore: 0,
      boostPadMask: ALL_BOOST_PADS_MASK,
      connected: [0, 0, 0, 0],
      cars: [makeEntity(), makeEntity(), makeEntity(), makeEntity()],
      ball: makeEntity()
    };
    this.onState = null;
    this.onStatus = null;
    this.onRoster = null;
    this.onLatency = null;
    this.onKickoff = null;
    this.kickoff = null;
    this.onReplay = null;
    this.replay = null;
    this.onGoal = null;
    this.goal = null;
    this.onQuickChat = null;
    this.onQuickChatLimit = null;
    this.quickChatLimit = { remaining: 3, cooldownMs: 0 };
    this.quickChatCooldownUntil = 0;
  }

  async connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = new URL(`${scheme}://${location.host}/lan`);
    url.searchParams.set('name', this.playerName);
    url.searchParams.set('car', this.carStyle);
    url.searchParams.set('boost', this.boostStyle);

    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url.toString());
      socket.binaryType = 'arraybuffer';
      this.socket = socket;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };

      const timeout = setTimeout(() => fail('Spielserver antwortet nicht.'), 8000);

      socket.addEventListener('open', () => {
        this.emitStatus('Verbunden – Spielerplatz wird zugewiesen …');
      });

      socket.addEventListener('message', (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.readBinaryMessage(event.data);
          return;
        }

        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === 'welcome') {
          this.playerId = Number(message.playerId) || 0;
          this.playerName = String(message.playerName || this.playerName || `Spieler ${this.playerId + 1}`);
          this.carStyle = normalizeCarStyle(message.carStyle || this.carStyle);
          this.boostStyle = normalizeBoostStyle(message.boostStyle || this.boostStyle);
          this.team = message.team === 'blue' ? 'blue' : 'orange';
          this.maxPlayers = Number(message.maxPlayers) || 4;
          this.serverHz = Math.max(1, Number(message.serverHz) || 60);
          this.snapshotHz = Math.max(1, Number(message.snapshotHz) || 20);
          this.connectedPlayers = Array.isArray(message.connectedPlayers) ? message.connectedPlayers : [this.playerId];
          this.players = normalizePlayers(message.players, this.connectedPlayers);
          this.connected = true;
          clearTimeout(timeout);
          this.emitStatus(this.statusText('ONLINE'));
          this.startPing();
          if (!settled) {
            settled = true;
            resolve(this);
          }
          return;
        }

        if (message.type === 'kickoff') {
          this.applyKickoffMessage(message);
          return;
        }

        if (message.type === 'replay') {
          this.applyReplayMessage(message);
          return;
        }

        if (message.type === 'goal') {
          this.applyGoalMessage(message);
          return;
        }

        if (message.type === 'quick-chat') {
          this.applyQuickChatMessage(message);
          return;
        }

        if (message.type === 'quick-chat-limit') {
          this.applyQuickChatLimitMessage(message);
          return;
        }

        if (message.type === 'input-ack') {
          const previousAck = this.lastInputAck;
          this.lastInputAck = Math.max(this.lastInputAck, Number(message.seq) || 0);
          if (message.active) this.activeInputConfirmed = true;
          if (this.activeInputConfirmed) this.emitStatus(this.statusText('INPUT OK'));
          else if (previousAck === 0 && this.lastInputAck > 0) this.emitStatus(this.statusText('NETZWERK OK'));
          return;
        }

        if (message.type === 'motion-ack') {
          this.motionConfirmed = true;
          this.emitStatus(this.statusText('PHYSIK OK'));
          return;
        }

        if (message.type === 'pong') {
          const sentAt = Number(message.t);
          if (Number.isFinite(sentAt)) {
            const sample = Math.max(0, performance.now() - sentAt);
            this.rttMs = this.rttMs === 0 ? sample : this.rttMs * 0.78 + sample * 0.22;
            this.onLatency?.(this.rttMs);
          }
          return;
        }

        if (message.type === 'state') {
          // Backwards-compatible fallback for an older server during a rolling deploy.
          this.onState?.(message.state);
          return;
        }

        if (message.type === 'roster') {
          this.maxPlayers = Number(message.maxPlayers) || this.maxPlayers;
          this.connectedPlayers = Array.isArray(message.connectedPlayers) ? message.connectedPlayers : this.connectedPlayers;
          this.players = normalizePlayers(message.players, this.connectedPlayers);
          this.onRoster?.(this.players, this.maxPlayers);
          this.emitStatus(this.statusText(this.motionConfirmed ? 'PHYSIK OK' : (this.activeInputConfirmed ? 'INPUT OK' : (this.lastInputAck > 0 ? 'NETZWERK OK' : 'ONLINE'))));
          return;
        }

        if (message.type === 'server-full') {
          clearTimeout(timeout);
          socket.close();
          fail(`Dieses Match hat bereits ${Number(message.maxPlayers) || 4} Spieler.`);
        }
      });

      socket.addEventListener('close', () => {
        this.connected = false;
        this.stopPing();
        if (!settled) fail('Spielverbindung wurde geschlossen.');
        else this.emitStatus('Spielverbindung getrennt');
      });

      socket.addEventListener('error', () => {
        if (!settled) fail('WebSocket zum Spielserver konnte nicht geöffnet werden.');
      });
    });
  }

  applyKickoffMessage(message) {
    const phase = message?.phase === 'go' ? 'go' : 'countdown';
    const count = phase === 'countdown'
      ? Math.max(1, Math.min(3, Math.round(Number(message?.count) || 1)))
      : 0;
    this.kickoff = { phase, count, resetScore: Boolean(message?.resetScore) };
    this.onKickoff?.(this.kickoff);
  }

  applyGoalMessage(message) {
    const position = Array.isArray(message?.position)
      ? [Number(message.position[0]) || 0, Number(message.position[1]) || 0, Number(message.position[2]) || 0]
      : [0, 0, 0];
    this.goal = {
      goalSign: Number(message?.goalSign) >= 0 ? 1 : -1,
      scoringTeam: message?.scoringTeam === 'orange' ? 'orange' : 'blue',
      scorerId: Number.isInteger(Number(message?.scorerId)) ? Number(message.scorerId) : -1,
      scorerName: String(message?.scorerName || 'Unbekannt').slice(0, 16),
      position,
      durationMs: Math.max(250, Number(message?.durationMs) || 1250),
      orangeScore: Math.max(0, Number(message?.orangeScore) || 0),
      blueScore: Math.max(0, Number(message?.blueScore) || 0)
    };
    this.onGoal?.(this.goal);
  }

  applyQuickChatMessage(message) {
    const chat = {
      id: message?.id === 'what-a-save' ? 'what-a-save' : 'what-a-save',
      text: 'What a save!',
      playerId: Number.isInteger(Number(message?.playerId)) ? Number(message.playerId) : -1,
      playerName: String(message?.playerName || 'Spieler').slice(0, 16),
      team: message?.team === 'blue' ? 'blue' : 'orange'
    };
    this.onQuickChat?.(chat);
    return chat;
  }

  applyQuickChatLimitMessage(message) {
    const remaining = Math.max(0, Math.min(3, Math.round(Number(message?.remaining) || 0)));
    const cooldownMs = Math.max(0, Math.min(10_000, Number(message?.cooldownMs) || 0));
    this.quickChatLimit = { remaining, cooldownMs, allowed: message?.allowed !== false };
    this.quickChatCooldownUntil = cooldownMs > 0 ? performance.now() + cooldownMs : 0;
    this.onQuickChatLimit?.(this.quickChatLimit);
    return this.quickChatLimit;
  }

  applyReplayMessage(message) {
    const phase = ['start', 'progress', 'end', 'wait'].includes(message?.phase) ? message.phase : 'progress';
    if (phase === 'start' || phase === 'wait') {
      this.replay = {
        phase,
        scorerId: Number.isInteger(Number(message?.scorerId)) ? Number(message.scorerId) : -1,
        scorerName: String(message?.scorerName || 'Unbekannt').slice(0, 16),
        goalTick: Math.max(0, Number(message?.goalTick) || 0),
        lookbackSeconds: Math.max(1, Number(message?.lookbackSeconds) || 5),
        durationMs: Math.max(500, Number(message?.durationMs ?? message?.remainingMs) || 5500),
        skipped: Math.max(0, Number(message?.skipped) || 0),
        required: Math.max(0, Number(message?.required) || 0),
        orangeScore: Math.max(0, Number(message?.orangeScore) || 0),
        blueScore: Math.max(0, Number(message?.blueScore) || 0)
      };
    } else if (phase === 'progress') {
      this.replay = {
        ...(this.replay || {}),
        phase,
        skipped: Math.max(0, Number(message?.skipped) || 0),
        required: Math.max(0, Number(message?.required) || 0)
      };
    } else {
      this.replay = { ...(this.replay || {}), phase: 'end', reason: String(message?.reason || 'complete') };
    }
    this.onReplay?.(this.replay);
  }

  readBinaryMessage(buffer) {
    if (buffer.byteLength < LEGACY_STATE_BYTES) return;
    const extendedLayout = buffer.byteLength >= STATE_BYTES;
    const modernLayout = extendedLayout || buffer.byteLength >= PREVIOUS_STATE_BYTES;
    const view = new DataView(buffer);
    if (view.getUint8(0) !== MSG_STATE) return;

    this.state.tick = view.getUint32(1, true);
    const connectedMask = view.getUint8(5);
    const groundMask = view.getUint8(6);
    this.state.orangeScore = view.getUint16(7, true);
    this.state.blueScore = view.getUint16(9, true);
    for (let i = 0; i < 4; i++) {
      this.state.connected[i] = (connectedMask >> i) & 1;
      this.state.cars[i].g = (groundMask >> i) & 1;
      this.state.cars[i].b = modernLayout ? view.getUint8(11 + i) : 100;
    }
    if (extendedLayout) {
      const lowMask = view.getUint32(15, true);
      const highMask = view.getUint32(19, true);
      this.state.boostPadMask = lowMask + highMask * 4294967296;
    } else {
      this.state.boostPadMask = modernLayout ? view.getUint16(15, true) : ALL_BOOST_PADS_MASK;
    }

    let offset = extendedLayout
      ? STATE_HEADER_BYTES
      : (modernLayout ? PREVIOUS_STATE_HEADER_BYTES : LEGACY_STATE_HEADER_BYTES);
    for (let entityIndex = 0; entityIndex < 5; entityIndex++) {
      const entity = entityIndex < 4 ? this.state.cars[entityIndex] : this.state.ball;
      for (let i = 0; i < 3; i++, offset += 4) entity.p[i] = view.getFloat32(offset, true);
      for (let i = 0; i < 4; i++, offset += 4) entity.r[i] = view.getFloat32(offset, true);
      for (let i = 0; i < 3; i++, offset += 4) entity.v[i] = view.getFloat32(offset, true);
      for (let i = 0; i < 3; i++, offset += 4) entity.w[i] = view.getFloat32(offset, true);
    }
    this.state.ball.g = 0;
    this.onState?.(this.state);
  }

  startPing() {
    this.stopPing();
    const ping = () => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping', t: performance.now() }));
      }
    };
    ping();
    this.pingTimer = setInterval(ping, 1000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  statusText(state) {
    return `${this.playerName || `SPIELER ${this.playerId + 1}`} · ${this.team.toUpperCase()} · ${state} · ${this.connectedPlayers.length}/${this.maxPlayers}`;
  }

  emitStatus(text) {
    this.onStatus?.(text);
  }

  sendReplaySkip() {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'replay-skip' }));
    return true;
  }

  quickChatCooldownRemaining() {
    return Math.max(0, this.quickChatCooldownUntil - performance.now());
  }

  sendQuickChat(id = 'what-a-save') {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (id !== 'what-a-save' || this.quickChatCooldownRemaining() > 0) return false;
    this.socket.send(JSON.stringify({ type: 'quick-chat', id }));
    return true;
  }

  sendInput(input) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    const seq = ++this.inputSeq;
    // Two signed axis bytes extend the old packet without changing its header.
    // Legacy servers can still read the first 8 bytes; v1.10.15+ consumes the
    // exact analog throttle/steer values when INPUT_FLAGS.ANALOG is set.
    const buffer = new ArrayBuffer(10);
    const view = new DataView(buffer);
    const clampAxis = (value) => Math.max(-1, Math.min(1, Number(value) || 0));
    view.setUint8(0, MSG_INPUT);
    view.setUint32(1, seq, true);
    view.setUint8(5, (Number(input?.mask) || 0) & 0xff);
    view.setUint8(6, (Number(input?.edges) || 0) & 0x07);
    view.setUint8(7, (Number(input?.flags) || 0) & 0x03);
    view.setInt8(8, Math.round(clampAxis(input?.throttle) * 127));
    view.setInt8(9, Math.round(clampAxis(input?.steer) * 127));
    this.socket.send(buffer);
    return true;
  }
}
