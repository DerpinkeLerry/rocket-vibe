import { WebSocketServer, WebSocket } from 'ws';

const MAX_PLAYERS = 4;

export function attachGameSockets(httpServer, options = {}) {
  const path = options.path ?? '/lan';
  const label = options.label ?? 'GAME';
  const game = options.game;
  if (!game) throw new Error('attachGameSockets requires an authoritative game instance.');

  const wss = new WebSocketServer({ noServer: true });
  const players = new Map();
  const inputSeen = new WeakSet();
  const motionConfirmed = new WeakSet();
  const motionProbePending = new WeakSet();

  function availablePlayerId() {
    const used = new Set(players.values());
    for (let id = 0; id < MAX_PLAYERS; id++) if (!used.has(id)) return id;
    return -1;
  }

  function send(ws, payload) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const ws of players.keys()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  function connectedIds() {
    return [...players.values()].sort((a, b) => a - b);
  }

  function broadcastRoster() {
    broadcast({ type: 'roster', connectedPlayers: connectedIds(), maxPlayers: MAX_PLAYERS });
  }

  game.start((state) => {
    if (players.size > 0) broadcast({ type: 'state', state });
  });

  wss.on('connection', (ws) => {
    const playerId = availablePlayerId();
    if (playerId < 0) {
      send(ws, { type: 'server-full', maxPlayers: MAX_PLAYERS });
      ws.close(1000, 'Match full');
      return;
    }

    players.set(ws, playerId);
    game.setPlayerConnected(playerId, true);
    send(ws, {
      type: 'welcome',
      playerId,
      maxPlayers: MAX_PLAYERS,
      connectedPlayers: connectedIds()
    });
    broadcastRoster();
    console.log(`[${label}] Spieler ${playerId + 1} verbunden (${players.size}/${MAX_PLAYERS}).`);

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const senderId = players.get(ws);
      if (senderId === undefined) return;

      if (message.type === 'input') {
        const seq = Number(message.seq) || 0;
        const input = {
          mask: (Number(message.input?.mask) || 0) & 0x7f,
          edges: (Number(message.input?.edges) || 0) & 0x07
        };
        game.setInput(senderId, input);
        const active = input.mask !== 0 || input.edges !== 0;
        send(ws, { type: 'input-ack', seq, playerId: senderId, active });
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
            const wantsTranslation = Boolean(input.mask & ((1 << 0) | (1 << 1) | (1 << 6)));
            const wantsRotation = Boolean(input.mask & ((1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)));
            const wantsJump = Boolean(input.edges & (1 << 0));
            const movedAsRequested =
              (wantsTranslation && horizontalSpeed > 0.2) ||
              (wantsRotation && angularSpeed > 0.05) ||
              (wantsJump && Math.abs(vy) > 0.2);

            if (movedAsRequested) {
              motionConfirmed.add(ws);
              send(ws, { type: 'motion-ack', playerId: senderId, speed: horizontalSpeed, angularSpeed });
              console.log(`[${label}] Serverbewegung von Spieler ${senderId + 1} bestaetigt (vXZ=${horizontalSpeed.toFixed(2)}, w=${angularSpeed.toFixed(2)}).`);
            } else {
              console.warn(`[${label}] Input da, aber Spieler ${senderId + 1} reagiert noch nicht. mask=${diag.mask} enabled=${diag.enabled} grounded=${diag.grounded} mass=${diag.mass.toFixed(2)} v=${diag.velocity.map((n) => n.toFixed(2)).join(',')} w=${diag.angularVelocity.map((n) => n.toFixed(2)).join(',')} pos=${diag.position.map((n) => n.toFixed(2)).join(',')}`);
            }
          }, 350);
          timer.unref?.();
        }
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
