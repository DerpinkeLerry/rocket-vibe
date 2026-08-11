import { WebSocketServer, WebSocket } from 'ws';

const MAX_PLAYERS = 4;
const MSG_INPUT = 1;
const MSG_STATE = 2;
const ENTITY_FLOATS = 13;
const STATE_BYTES = 7 + ENTITY_FLOATS * 5 * 4;
const MAX_STATE_BACKLOG = 16 * 1024;

function writeEntity(buffer, offset, entity) {
  for (const value of entity.p) { buffer.writeFloatLE(value, offset); offset += 4; }
  for (const value of entity.r) { buffer.writeFloatLE(value, offset); offset += 4; }
  for (const value of entity.v) { buffer.writeFloatLE(value, offset); offset += 4; }
  for (const value of entity.w) { buffer.writeFloatLE(value, offset); offset += 4; }
  return offset;
}

function encodeState(state) {
  const buffer = Buffer.allocUnsafe(STATE_BYTES);
  buffer.writeUInt8(MSG_STATE, 0);
  buffer.writeUInt32LE(state.tick >>> 0, 1);

  let connectedMask = 0;
  let groundMask = 0;
  for (let i = 0; i < 4; i++) {
    if (state.connected[i]) connectedMask |= 1 << i;
    if (state.cars[i]?.g) groundMask |= 1 << i;
  }
  buffer.writeUInt8(connectedMask, 5);
  buffer.writeUInt8(groundMask, 6);

  let offset = 7;
  for (let i = 0; i < 4; i++) offset = writeEntity(buffer, offset, state.cars[i]);
  writeEntity(buffer, offset, state.ball);
  return buffer;
}

function decodeInput(raw, isBinary) {
  if (isBinary && raw?.length >= 7 && raw[0] === MSG_INPUT) {
    return {
      seq: raw.readUInt32LE(1),
      input: {
        mask: raw[5] & 0x7f,
        edges: raw[6] & 0x07
      }
    };
  }

  try {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'input') return null;
    return {
      seq: Number(message.seq) || 0,
      input: {
        mask: (Number(message.input?.mask) || 0) & 0x7f,
        edges: (Number(message.input?.edges) || 0) & 0x07
      }
    };
  } catch {
    return null;
  }
}

export function attachGameSockets(httpServer, options = {}) {
  const path = options.path ?? '/lan';
  const label = options.label ?? 'GAME';
  const game = options.game;
  if (!game) throw new Error('attachGameSockets requires an authoritative game instance.');

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: 4096
  });
  const players = new Map();
  const inputSeen = new WeakSet();
  const ackedAny = new WeakSet();
  const ackedActive = new WeakSet();
  const motionConfirmed = new WeakSet();
  const motionProbePending = new WeakSet();

  function availablePlayerId() {
    const used = new Set(players.values());
    for (let id = 0; id < MAX_PLAYERS; id++) if (!used.has(id)) return id;
    return -1;
  }

  function sendJson(ws, payload) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload), { compress: false });
  }

  function broadcastJson(payload) {
    const data = JSON.stringify(payload);
    for (const ws of players.keys()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { compress: false });
    }
  }

  function broadcastState(state) {
    const data = encodeState(state);
    for (const ws of players.keys()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // Fresh state is more valuable than queued old state. If a connection is
      // congested, skip this snapshot instead of increasing input/display lag.
      if (ws.bufferedAmount > MAX_STATE_BACKLOG) continue;
      ws.send(data, { binary: true, compress: false });
    }
  }

  function connectedIds() {
    return [...players.values()].sort((a, b) => a - b);
  }

  function broadcastRoster() {
    broadcastJson({ type: 'roster', connectedPlayers: connectedIds(), maxPlayers: MAX_PLAYERS });
  }

  game.start((state) => {
    if (players.size > 0) broadcastState(state);
  });

  wss.on('connection', (ws) => {
    const playerId = availablePlayerId();
    if (playerId < 0) {
      sendJson(ws, { type: 'server-full', maxPlayers: MAX_PLAYERS });
      ws.close(1000, 'Match full');
      return;
    }

    players.set(ws, playerId);
    game.setPlayerConnected(playerId, true);
    sendJson(ws, {
      type: 'welcome',
      playerId,
      maxPlayers: MAX_PLAYERS,
      connectedPlayers: connectedIds(),
      protocol: 2,
      serverHz: 120,
      snapshotHz: 60
    });
    broadcastRoster();
    console.log(`[${label}] Spieler ${playerId + 1} verbunden (${players.size}/${MAX_PLAYERS}).`);

    ws.on('message', (raw, isBinary) => {
      const senderId = players.get(ws);
      if (senderId === undefined) return;

      if (!isBinary) {
        let control;
        try { control = JSON.parse(raw.toString()); } catch { control = null; }
        if (control?.type === 'ping') {
          sendJson(ws, { type: 'pong', t: Number(control.t) || 0 });
          return;
        }
      }

      const packet = decodeInput(raw, isBinary);
      if (!packet) return;

      game.setInput(senderId, packet.input);
      const active = packet.input.mask !== 0 || packet.input.edges !== 0;

      // Debug acknowledgements are intentionally sparse in v1.0. Acknowledging
      // every 7-byte input would create avoidable reverse traffic on the socket.
      if (!ackedAny.has(ws) || (active && !ackedActive.has(ws))) {
        ackedAny.add(ws);
        if (active) ackedActive.add(ws);
        sendJson(ws, { type: 'input-ack', seq: packet.seq, playerId: senderId, active });
      }

      if (active && !inputSeen.has(ws)) {
        inputSeen.add(ws);
        console.log(`[${label}] Aktive Steuerung von Spieler ${senderId + 1} empfangen.`);
      }

      if (active && !motionConfirmed.has(ws) && !motionProbePending.has(ws)) {
        motionProbePending.add(ws);
        const timer = setTimeout(() => {
          motionProbePending.delete(ws);
          if (players.get(ws) !== senderId) return;
          const diag = game.diagnostics(senderId);
          if (!diag) return;
          const [vx, vy, vz] = diag.velocity;
          const [wx, wy, wz] = diag.angularVelocity;
          const horizontalSpeed = Math.hypot(vx, vz);
          const angularSpeed = Math.hypot(wx, wy, wz);
          if (horizontalSpeed > 0.2 || angularSpeed > 0.05 || Math.abs(vy) > 0.2) {
            motionConfirmed.add(ws);
            sendJson(ws, { type: 'motion-ack', playerId: senderId, speed: horizontalSpeed, angularSpeed });
            console.log(`[${label}] Serverbewegung von Spieler ${senderId + 1} bestaetigt.`);
          }
        }, 180);
        timer.unref?.();
      }
    });

    ws.on('close', () => {
      const id = players.get(ws);
      players.delete(ws);
      if (id === undefined) return;
      game.setPlayerConnected(id, false);
      console.log(`[${label}] Spieler ${id + 1} getrennt (${players.size}/${MAX_PLAYERS}).`);
      broadcastRoster();
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== path) {
      socket.destroy();
      return;
    }

    // Disable Nagle buffering for latency-sensitive control packets.
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10000);
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  return {
    wss,
    getPlayerCount: () => players.size,
    closeAll(code = 1012, reason = 'Server restarting') {
      game.stop();
      for (const ws of players.keys()) {
        try { ws.close(code, reason); } catch { /* already gone */ }
      }
    }
  };
}
