import { WebSocketServer, WebSocket } from 'ws';

export function attachGameSockets(httpServer, options = {}) {
  const path = options.path ?? '/lan';
  const label = options.label ?? 'GAME';
  const wss = new WebSocketServer({ noServer: true });
  const players = new Map();
  const inputSeen = new WeakSet();

  function availablePlayerId() {
    if (![...players.values()].includes(0)) return 0;
    if (![...players.values()].includes(1)) return 1;
    return -1;
  }

  function send(ws, payload) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function socketForPlayer(id) {
    for (const [ws, playerId] of players) {
      if (playerId === id) return ws;
    }
    return null;
  }

  function notifyPeer(type, playerId) {
    for (const [ws, id] of players) {
      if (id !== playerId) send(ws, { type, playerId });
    }
  }

  wss.on('connection', (ws) => {
    const playerId = availablePlayerId();
    if (playerId < 0) {
      send(ws, { type: 'server-full' });
      ws.close(1000, 'Match full');
      return;
    }

    players.set(ws, playerId);
    const peerConnected = socketForPlayer(playerId === 0 ? 1 : 0) !== null;
    send(ws, { type: 'welcome', playerId, peerConnected });
    notifyPeer('peer-joined', playerId);
    console.log(`[${label}] Spieler ${playerId + 1} verbunden.`);

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const senderId = players.get(ws);
      if (senderId === undefined) return;

      if (senderId === 1 && message.type === 'input') {
        const host = socketForPlayer(0);
        if (!inputSeen.has(ws)) {
          inputSeen.add(ws);
          console.log(`[${label}] Erste Eingabe von Spieler 2 empfangen.`);
        }
        const seq = Number(message.seq) || 0;
        const input = {
          mask: Number(message.input?.mask) || 0,
          edges: Number(message.input?.edges) || 0
        };

        // Acknowledge the client and forward the exact same packet to player 1.
        // WebSockets are ordered/reliable; the sequence id makes the path
        // explicit and avoids accidental stale packets in future changes.
        send(ws, { type: 'input-ack', seq });
        if (host) {
          send(host, { type: 'remote-input', playerId: 1, seq, input });
        }
        return;
      }

      if (senderId === 0 && message.type === 'state') {
        const client = socketForPlayer(1);
        if (client) send(client, { type: 'state', state: message.state });
      }
    });

    ws.on('close', () => {
      const id = players.get(ws);
      players.delete(ws);
      if (id === undefined) return;

      console.log(`[${label}] Spieler ${id + 1} getrennt.`);

      if (id === 0) {
        const client = socketForPlayer(1);
        if (client) send(client, { type: 'host-lost' });
      } else {
        const host = socketForPlayer(0);
        if (host) send(host, { type: 'peer-left', playerId: 1 });
      }
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

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  return {
    wss,
    getPlayerCount: () => players.size,
    closeAll(code = 1012, reason = 'Server restarting') {
      for (const ws of players.keys()) {
        try {
          ws.close(code, reason);
        } catch {
          // Ignore sockets that are already gone.
        }
      }
    }
  };
}
