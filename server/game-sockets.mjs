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
