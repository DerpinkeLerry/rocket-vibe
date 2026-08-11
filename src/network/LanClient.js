export class LanClient {
  constructor() {
    this.socket = null;
    this.playerId = 0;
    this.isHost = true;
    this.connected = false;
    this.peerConnected = false;
    this.inputSeq = 0;
    this.lastInputAck = 0;
    this.onRemoteInput = null;
    this.onState = null;
    this.onStatus = null;
    this.onPeerChange = null;
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

      const timeout = setTimeout(() => fail('Spielserver antwortet nicht.'), 6000);

      socket.addEventListener('open', () => {
        this.emitStatus('Verbunden – Rolle wird zugewiesen …');
      });

      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        if (message.type === 'welcome') {
          this.playerId = message.playerId;
          this.isHost = message.playerId === 0;
          this.peerConnected = Boolean(message.peerConnected);
          this.connected = true;
          clearTimeout(timeout);
          this.emitStatus(this.isHost
            ? (this.peerConnected ? 'HOST · Spieler 2 verbunden' : 'HOST · Warte auf Spieler 2')
            : 'SPIELER 2 · Mit Host verbunden');
          if (!settled) {
            settled = true;
            resolve(this);
          }
          return;
        }

        if (message.type === 'remote-input' && this.isHost) {
          // Treat input itself as proof that player 2 is alive. This protects
          // against any join-event race and makes the remote car active again.
          if (!this.peerConnected) {
            this.peerConnected = true;
            this.onPeerChange?.(true);
            this.emitStatus('HOST · Spieler 2 verbunden');
          }
          this.onRemoteInput?.(message.input, message.playerId ?? 1, message.seq ?? 0);
          return;
        }

        if (message.type === 'input-ack' && !this.isHost) {
          const previousAck = this.lastInputAck;
          this.lastInputAck = Math.max(this.lastInputAck, Number(message.seq) || 0);
          if (previousAck === 0 && this.lastInputAck > 0) {
            this.emitStatus('SPIELER 2 · Steuerung verbunden');
          }
          return;
        }

        if (message.type === 'state' && !this.isHost) {
          this.onState?.(message.state);
          return;
        }

        if (message.type === 'peer-joined') {
          this.peerConnected = true;
          this.onPeerChange?.(true);
          this.emitStatus(this.isHost ? 'HOST · Spieler 2 verbunden' : 'SPIELER 2 · Mit Host verbunden');
          return;
        }

        if (message.type === 'peer-left') {
          this.peerConnected = false;
          this.onPeerChange?.(false);
          this.emitStatus(this.isHost ? 'HOST · Spieler 2 getrennt' : 'Verbindung zum Host verloren');
          return;
        }

        if (message.type === 'server-full') {
          clearTimeout(timeout);
          socket.close();
          fail('Dieses Match hat bereits zwei Spieler.');
          return;
        }

        if (message.type === 'host-lost') {
          this.connected = false;
          this.onPeerChange?.(false);
          this.emitStatus('Host getrennt – Seite neu laden, sobald der Host wieder läuft.');
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

  emitStatus(text) {
    this.onStatus?.(text);
  }

  sendInput(input) {
    if (!this.connected || this.isHost || this.socket?.readyState !== WebSocket.OPEN) return false;
    const seq = ++this.inputSeq;
    this.socket.send(JSON.stringify({ type: 'input', seq, input }));
    return true;
  }

  sendState(state) {
    if (!this.connected || !this.isHost || !this.peerConnected || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'state', state }));
  }
}
