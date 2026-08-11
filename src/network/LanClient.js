export class LanClient {
  constructor() {
    this.socket = null;
    this.playerId = 0;
    this.maxPlayers = 4;
    this.connectedPlayers = [];
    this.connected = false;
    this.inputSeq = 0;
    this.lastInputAck = 0;
    this.activeInputConfirmed = false;
    this.onState = null;
    this.onStatus = null;
    this.onRoster = null;
  }

  async connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${location.host}/lan`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
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
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === 'welcome') {
          this.playerId = Number(message.playerId) || 0;
          this.maxPlayers = Number(message.maxPlayers) || 4;
          this.connectedPlayers = Array.isArray(message.connectedPlayers) ? message.connectedPlayers : [this.playerId];
          this.connected = true;
          clearTimeout(timeout);
          this.emitStatus(this.statusText('ONLINE'));
          if (!settled) {
            settled = true;
            resolve(this);
          }
          return;
        }

        if (message.type === 'input-ack') {
          const previousAck = this.lastInputAck;
          this.lastInputAck = Math.max(this.lastInputAck, Number(message.seq) || 0);
          if (message.active) this.activeInputConfirmed = true;
          if (this.activeInputConfirmed) {
            this.emitStatus(this.statusText('STEUERUNG OK'));
          } else if (previousAck === 0 && this.lastInputAck > 0) {
            this.emitStatus(this.statusText('NETZWERK OK'));
          }
          return;
        }

        if (message.type === 'state') {
          this.onState?.(message.state);
          return;
        }

        if (message.type === 'roster') {
          this.maxPlayers = Number(message.maxPlayers) || this.maxPlayers;
          this.connectedPlayers = Array.isArray(message.connectedPlayers) ? message.connectedPlayers : this.connectedPlayers;
          this.onRoster?.(this.connectedPlayers, this.maxPlayers);
          this.emitStatus(this.statusText(this.activeInputConfirmed ? 'STEUERUNG OK' : (this.lastInputAck > 0 ? 'NETZWERK OK' : 'ONLINE')));
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
        if (!settled) fail('Spielverbindung wurde geschlossen.');
        else this.emitStatus('Spielverbindung getrennt');
      });

      socket.addEventListener('error', () => {
        if (!settled) fail('WebSocket zum Spielserver konnte nicht geöffnet werden.');
      });
    });
  }

  statusText(state) {
    return `SPIELER ${this.playerId + 1} · ${state} · ${this.connectedPlayers.length}/${this.maxPlayers}`;
  }

  emitStatus(text) {
    this.onStatus?.(text);
  }

  sendInput(input) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    const seq = ++this.inputSeq;
    this.socket.send(JSON.stringify({ type: 'input', seq, input }));
    return true;
  }
}
