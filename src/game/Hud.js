export class Hud {
  constructor(root, options = {}) {
    const multiplayer = Boolean(options.lan);
    const playerId = options.playerId ?? 0;
    const role = multiplayer ? (playerId === 0 ? 'SPIELER 1 · HOST' : 'SPIELER 2 · CLIENT') : 'OFFLINE';

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__title">ROCKET VIBE // ONLINE 0.6 <span class="hud__perf">PERFORMANCE MODE</span></div>
      <div class="hud__network">
        <strong>${role}</strong>
        <span data-network>${multiplayer ? 'Spielserver verbunden' : 'Lokaler Modus'}</span>
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
  }

  setNetworkStatus(text) {
    this.network.textContent = text;
  }

  update(car) {
    this.speed.textContent = String(Math.round(car.getSpeedKmh())).padStart(3, '0');
    this.state.textContent = car.grounded ? 'GROUND' : 'AIR';
  }
}
