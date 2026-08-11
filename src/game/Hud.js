export class Hud {
  constructor(root, options = {}) {
    const multiplayer = Boolean(options.lan);
    const playerId = options.playerId ?? 0;
    const playerCount = options.playerCount ?? 1;
    const maxPlayers = options.maxPlayers ?? 4;
    const role = multiplayer ? `SPIELER ${playerId + 1}` : 'OFFLINE';

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__title">ROCKET VIBE // ONLINE 1.0 <span class="hud__perf">LOW LATENCY</span></div>
      <div class="hud__network">
        <strong>${role}</strong>
        <span data-network>${multiplayer ? 'Spielserver verbunden' : 'Lokaler Modus'}</span>
        <span data-player-count>${playerCount}/${maxPlayers} Spieler</span>
        <span data-ping>Ping -- ms</span>
      </div>
      <div class="hud__controls">
        <kbd>W / S</kbd><span>Boden: Gas · Luft: Pitch</span>
        <kbd>A / D</kbd><span>Boden: Lenken · Luft: Yaw</span>
        <kbd>SPACE</kbd><span>Jump / Double Jump</span>
        <kbd>SHIFT</kbd><span>Boost</span>
        <kbd>Q / E</kbd><span>Air Roll</span>
        <kbd>B</kbd><span>Ball Reset</span>
        <kbd>R</kbd><span>Eigenes Auto Reset</span>
      </div>
      <div class="hud__speed">
        <div class="hud__speed-number" data-speed>000</div>
        <div class="hud__speed-label">km/h</div>
        <div class="hud__state" data-state>GROUND</div>
      </div>
    `;
    root.appendChild(this.el);
    this.speed = this.el.querySelector('[data-speed]');
    this.state = this.el.querySelector('[data-state]');
    this.network = this.el.querySelector('[data-network]');
    this.playerCount = this.el.querySelector('[data-player-count]');
    this.ping = this.el.querySelector('[data-ping]');
  }

  setNetworkStatus(text) {
    this.network.textContent = text;
  }

  setPlayerCount(count, maxPlayers = 4) {
    this.playerCount.textContent = `${count}/${maxPlayers} Spieler`;
  }

  setPing(rttMs) {
    if (!this.ping) return;
    this.ping.textContent = `Ping ${Math.round(rttMs)} ms`;
  }

  update(car) {
    this.speed.textContent = String(Math.round(car.getSpeedKmh())).padStart(3, '0');
    this.state.textContent = car.grounded ? 'GROUND' : 'AIR';
  }
}
