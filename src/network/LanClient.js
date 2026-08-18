import { DEFAULT_CAR_STYLE, normalizeCarStyle } from '../shared/car-styles.js';
import { DEFAULT_BOOST_STYLE, normalizeBoostStyle } from '../shared/boost-styles.js';
import { ALL_BOOST_PADS_MASK } from '../shared/boost-tuning.js';
import { QUICK_CHAT_OPTIONS, findQuickChat, normalizeQuickChatOptions } from '../shared/quick-chat.js';

const MSG_INPUT = 1;
const MSG_STATE = 2;
const MAX_PLAYERS = 8;
const LEGACY_PLAYERS = 4;
const ENTITY_FLOATS = 13;
const STATE_HEADER_BYTES = 28;
const FOUR_PLAYER_STATE_HEADER_BYTES = 23;
const PREVIOUS_STATE_HEADER_BYTES = 17;
const LEGACY_STATE_HEADER_BYTES = 11;
const STATE_BYTES = STATE_HEADER_BYTES + ENTITY_FLOATS * (MAX_PLAYERS + 1) * 4;
const FOUR_PLAYER_STATE_BYTES = FOUR_PLAYER_STATE_HEADER_BYTES + ENTITY_FLOATS * (LEGACY_PLAYERS + 1) * 4;
const PREVIOUS_STATE_BYTES = PREVIOUS_STATE_HEADER_BYTES + ENTITY_FLOATS * (LEGACY_PLAYERS + 1) * 4;
const LEGACY_STATE_BYTES = LEGACY_STATE_HEADER_BYTES + ENTITY_FLOATS * (LEGACY_PLAYERS + 1) * 4;

function makeEntity() {
  return {
    p: [0, 0, 0],
    r: [0, 0, 0, 1],
    v: [0, 0, 0],
    w: [0, 0, 0],
    g: 0,
    d: 0,
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
      .filter((player) => Number.isInteger(player.playerId) && player.playerId >= 0 && player.playerId < MAX_PLAYERS);
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
  constructor(playerName = '', carStyle = DEFAULT_CAR_STYLE, boostStyle = DEFAULT_BOOST_STYLE, lobbyId = '') {
    this.socket = null;
    this.lobbyId = String(lobbyId || '').trim();
    this.playerId = 0;
    this.playerName = String(playerName || '').trim().slice(0, 16);
    this.carStyle = normalizeCarStyle(carStyle);
    this.boostStyle = normalizeBoostStyle(boostStyle);
    this.team = 'orange';
    this.maxPlayers = 4;
    this.serverHz = 60;
    this.snapshotHz = 20;
    this.matchConfig = null;
    this.matchRules = null;
    this.matchClock = null;
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
      connected: Array.from({ length: MAX_PLAYERS }, () => 0),
      cars: Array.from({ length: MAX_PLAYERS }, () => makeEntity()),
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
    this.onDemolition = null;
    this.demolition = null;
    this.onRespawn = null;
    this.respawn = null;
    this.onDemolitionCancel = null;
    this.onQuickChat = null;
    this.onQuickChatLimit = null;
    this.onChat = null;
    this.onChatLimit = null;
    this.quickChats = QUICK_CHAT_OPTIONS.map((entry) => ({ ...entry }));
    this.onMatchClock = null;
    this.onMatchOver = null;
    this.quickChatLimit = { remaining: 3, cooldownMs: 0 };
    this.quickChatCooldownUntil = 0;
    this.chatLimit = { cooldownMs: 0, allowed: true };
    this.chatCooldownUntil = 0;
  }

  async connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = new URL(`${scheme}://${location.host}/lan`);
    url.searchParams.set('name', this.playerName);
    url.searchParams.set('car', this.carStyle);
    url.searchParams.set('boost', this.boostStyle);
    if (this.lobbyId) url.searchParams.set('lobby', this.lobbyId);

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
          this.matchConfig = message.config && typeof message.config === 'object' ? message.config : null;
          this.matchRules = message.rules && typeof message.rules === 'object' ? message.rules : null;
          this.quickChats = normalizeQuickChatOptions(message.quickChats);
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

        if (message.type === 'match-clock') {
          this.matchClock = {
            seconds: Math.max(0, Math.round(Number(message?.seconds) || 0)),
            overtime: Boolean(message?.overtime)
          };
          this.onMatchClock?.(this.matchClock);
          return;
        }

        if (message.type === 'match-over') {
          this.onMatchOver?.({
            reason: String(message?.reason || 'complete'),
            orangeScore: Math.max(0, Number(message?.orangeScore) || 0),
            blueScore: Math.max(0, Number(message?.blueScore) || 0)
          });
          return;
        }

        if (message.type === 'demolition') {
          this.applyDemolitionMessage(message);
          return;
        }

        if (message.type === 'respawn') {
          this.applyRespawnMessage(message);
          return;
        }

        if (message.type === 'demolition-cancel') {
          this.demolition = null;
          this.onDemolitionCancel?.({ reason: String(message?.reason || 'cancelled') });
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

        if (message.type === 'chat') {
          this.applyTextChatMessage(message);
          return;
        }

        if (message.type === 'chat-limit') {
          this.applyTextChatLimitMessage(message);
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
      ? Math.max(1, Math.min(10, Math.round(Number(message?.count) || 1)))
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
      durationMs: Number.isFinite(Number(message?.durationMs)) ? Math.max(0, Number(message.durationMs)) : 1250,
      orangeScore: Math.max(0, Number(message?.orangeScore) || 0),
      blueScore: Math.max(0, Number(message?.blueScore) || 0)
    };
    this.onGoal?.(this.goal);
  }


  applyDemolitionMessage(message) {
    const normalizePoint = (point) => ({
      x: Number(point?.x) || 0,
      y: Number(point?.y) || 0.52,
      z: Number(point?.z) || 0,
      yaw: Number(point?.yaw) || 0
    });
    const demolition = {
      attackerId: Number.isInteger(Number(message?.attackerId)) ? Number(message.attackerId) : -1,
      victimId: Number.isInteger(Number(message?.victimId)) ? Number(message.victimId) : -1,
      attackerName: String(message?.attackerName || 'Spieler').slice(0, 16),
      victimName: String(message?.victimName || 'Spieler').slice(0, 16),
      position: Array.isArray(message?.position)
        ? [Number(message.position[0]) || 0, Number(message.position[1]) || 0, Number(message.position[2]) || 0]
        : [0, 0, 0],
      durationMs: Math.max(200, Number(message?.durationMs) || 4000),
      stateTick: Number.isFinite(Number(message?.stateTick)) ? Math.max(0, Math.floor(Number(message.stateTick))) : -1,
      selectedIndex: Math.max(0, Math.min(2, Math.round(Number(message?.selectedIndex) || 1))),
      spawnPoints: Array.isArray(message?.spawnPoints) ? message.spawnPoints.slice(0, 3).map(normalizePoint) : []
    };
    this.demolition = demolition;
    this.onDemolition?.(demolition);
    return demolition;
  }

  applyRespawnMessage(message) {
    const position = Array.isArray(message?.position)
      ? [Number(message.position[0]) || 0, Number(message.position[1]) || 0.52, Number(message.position[2]) || 0]
      : [0, 0.52, 0];
    const respawn = {
      playerId: Number.isInteger(Number(message?.playerId)) ? Number(message.playerId) : -1,
      spawnIndex: Math.max(0, Math.min(2, Math.round(Number(message?.spawnIndex) || 1))),
      position,
      yaw: Number(message?.yaw) || 0,
      boost: Math.max(0, Math.min(100, Number(message?.boost) || 0))
    };
    this.respawn = respawn;
    if (this.demolition?.victimId === respawn.playerId) this.demolition = null;
    this.onRespawn?.(respawn);
    return respawn;
  }

  applyQuickChatMessage(message) {
    const option = findQuickChat(this.quickChats, message?.id);
    if (!option) return null;
    const chat = {
      kind: 'quick',
      id: option.id,
      text: option.text,
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


  applyTextChatMessage(message) {
    const text = String(message?.text || '').trim().replace(/\s+/g, ' ');
    if (!text) return null;
    const chat = {
      kind: 'text',
      text: Array.from(text).slice(0, 160).join(''),
      playerId: Number.isInteger(Number(message?.playerId)) ? Number(message.playerId) : -1,
      playerName: String(message?.playerName || 'Spieler').slice(0, 16),
      team: message?.team === 'blue' ? 'blue' : 'orange'
    };
    this.onChat?.(chat);
    return chat;
  }

  applyTextChatLimitMessage(message) {
    const cooldownMs = Math.max(0, Math.min(30_000, Number(message?.cooldownMs) || 0));
    this.chatLimit = { cooldownMs, allowed: message?.allowed !== false };
    this.chatCooldownUntil = cooldownMs > 0 ? performance.now() + cooldownMs : 0;
    this.onChatLimit?.(this.chatLimit);
    return this.chatLimit;
  }

  applyReplayMessage(message) {
    const phase = ['start', 'progress', 'end', 'wait'].includes(message?.phase) ? message.phase : 'progress';
    if (phase === 'start' || phase === 'wait') {
      this.replay = {
        phase,
        scorerId: Number.isInteger(Number(message?.scorerId)) ? Number(message.scorerId) : -1,
        scorerName: String(message?.scorerName || 'Unbekannt').slice(0, 16),
        goalTick: Math.max(0, Number(message?.goalTick) || 0),
        lookbackSeconds: Math.max(1, Number(message?.lookbackSeconds) || 6.25),
        durationMs: Math.max(500, Number(message?.durationMs ?? message?.remainingMs) || 6800),
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
    const eightPlayerLayout = buffer.byteLength >= STATE_BYTES;
    const fourPlayerLayout = !eightPlayerLayout && buffer.byteLength >= FOUR_PLAYER_STATE_BYTES;
    const previousLayout = !eightPlayerLayout && !fourPlayerLayout && buffer.byteLength >= PREVIOUS_STATE_BYTES;
    const view = new DataView(buffer);
    if (view.getUint8(0) !== MSG_STATE) return;

    this.state.tick = view.getUint32(1, true);
    this.state.connected.fill(0);
    for (const car of this.state.cars) {
      car.g = 0;
      car.d = 0;
    }

    let offset;
    let transmittedCars;
    if (eightPlayerLayout) {
      const connectedMask = view.getUint8(5);
      const groundMask = view.getUint8(6);
      const demolishedMask = view.getUint8(7);
      this.state.orangeScore = view.getUint16(8, true);
      this.state.blueScore = view.getUint16(10, true);
      for (let i = 0; i < MAX_PLAYERS; i++) {
        this.state.connected[i] = (connectedMask >> i) & 1;
        this.state.cars[i].g = (groundMask >> i) & 1;
        this.state.cars[i].d = (demolishedMask >> i) & 1;
        this.state.cars[i].b = view.getUint8(12 + i);
      }
      const lowMask = view.getUint32(20, true);
      const highMask = view.getUint32(24, true);
      this.state.boostPadMask = lowMask + highMask * 4294967296;
      offset = STATE_HEADER_BYTES;
      transmittedCars = MAX_PLAYERS;
    } else {
      // Rolling-deploy compatibility with the previous four-car packet formats.
      const connectedMask = view.getUint8(5);
      const stateFlags = view.getUint8(6);
      const groundMask = stateFlags & 0x0f;
      const demolishedMask = (stateFlags >> 4) & 0x0f;
      this.state.orangeScore = view.getUint16(7, true);
      this.state.blueScore = view.getUint16(9, true);
      for (let i = 0; i < LEGACY_PLAYERS; i++) {
        this.state.connected[i] = (connectedMask >> i) & 1;
        this.state.cars[i].g = (groundMask >> i) & 1;
        this.state.cars[i].d = (demolishedMask >> i) & 1;
        this.state.cars[i].b = (fourPlayerLayout || previousLayout) ? view.getUint8(11 + i) : 100;
      }
      for (let i = LEGACY_PLAYERS; i < MAX_PLAYERS; i++) this.state.cars[i].b = 100;
      if (fourPlayerLayout) {
        const lowMask = view.getUint32(15, true);
        const highMask = view.getUint32(19, true);
        this.state.boostPadMask = lowMask + highMask * 4294967296;
        offset = FOUR_PLAYER_STATE_HEADER_BYTES;
      } else if (previousLayout) {
        this.state.boostPadMask = view.getUint16(15, true);
        offset = PREVIOUS_STATE_HEADER_BYTES;
      } else {
        this.state.boostPadMask = ALL_BOOST_PADS_MASK;
        offset = LEGACY_STATE_HEADER_BYTES;
      }
      transmittedCars = LEGACY_PLAYERS;
    }

    for (let entityIndex = 0; entityIndex <= transmittedCars; entityIndex++) {
      const entity = entityIndex < transmittedCars ? this.state.cars[entityIndex] : this.state.ball;
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

  disconnect() {
    this.connected = false;
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'match left');
  }

  statusText(state) {
    return `${this.playerName || `SPIELER ${this.playerId + 1}`} · ${this.team.toUpperCase()} · ${state} · ${this.connectedPlayers.length}/${this.maxPlayers}`;
  }

  emitStatus(text) {
    this.onStatus?.(text);
  }

  sendRespawnSelection(index) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    const choice = Math.max(0, Math.min(2, Math.round(Number(index) || 0)));
    this.socket.send(JSON.stringify({ type: 'respawn-select', index: choice }));
    return true;
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
    const option = findQuickChat(this.quickChats, id);
    if (!option || this.quickChatCooldownRemaining() > 0) return false;
    this.socket.send(JSON.stringify({ type: 'quick-chat', id: option.id }));
    return true;
  }

  textChatCooldownRemaining() {
    return Math.max(0, this.chatCooldownUntil - performance.now());
  }

  sendTextChat(value) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.textChatCooldownRemaining() > 0) return false;
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    const text = Array.from(normalized).slice(0, 160).join('');
    if (!text) return false;
    this.socket.send(JSON.stringify({ type: 'chat', text }));
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
