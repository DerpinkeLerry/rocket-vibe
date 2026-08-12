export class Hud {
  constructor(root, options = {}) {
    const multiplayer = Boolean(options.lan);
    const playerId = options.playerId ?? 0;
    const playerCount = options.playerCount ?? 1;
    const maxPlayers = options.maxPlayers ?? 4;
    const role = multiplayer ? `SPIELER ${playerId + 1}` : 'OFFLINE';
    const profile = options.performanceProfile ?? 'NORMAL';
    const playerName = options.playerName || role;
    const team = options.team === 'blue' ? 'blue' : 'orange';

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__title">ROCKET VIBE // ONLINE 1.9 <span class="hud__perf" data-perf>${profile}</span></div>
      <div class="hud__scoreboard" aria-label="Spielstand Orange gegen Blau">
        <div class="hud__score-team hud__score-team--orange"><span>ORANGE</span><strong data-orange-score>0</strong></div>
        <div class="hud__score-separator">:</div>
        <div class="hud__score-team hud__score-team--blue"><strong data-blue-score>0</strong><span>BLAU</span></div>
      </div>
      <div class="hud__network">
        <strong class="hud__identity hud__identity--${team}" data-identity></strong>
        <span data-network>${multiplayer ? 'Spielserver verbunden' : 'Lokaler Modus'}</span>
        <span data-player-count>${playerCount}/${maxPlayers} Spieler</span>
        <span data-ping>Ping -- ms</span>
        <span data-fps>FPS -- · Render --%</span>
      </div>
      <div class="hud__controls">
        <kbd>F2</kbd><span>Normal / Ultra High / Ultra Low</span>
        <kbd>C</kbd><span data-camera-mode>Ball Cam / Car Cam · aktuell: BALL CAM</span>
        <kbd>W / S</kbd><span>Boden: Gas · Luft: Pitch</span>
        <kbd>A / D</kbd><span>Boden: Lenken · Luft: Yaw</span>
        <kbd>SPACE</kbd><span>Jump / Double Jump</span>
        <kbd>SHIFT</kbd><span>Boost</span>
        <kbd>Q / E</kbd><span>Air Roll</span>
        <kbd>B</kbd><span>Ball Reset</span>
        <kbd>R</kbd><span>Eigenes Auto Reset</span>
      </div>
      <div class="hud__boost" aria-label="Boost Anzeige">
        <div class="hud__boost-head"><span>BOOST</span><strong data-boost-value>100</strong></div>
        <div class="hud__boost-track"><div class="hud__boost-fill" data-boost-fill></div></div>
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
    this.fps = this.el.querySelector('[data-fps]');
    this.perf = this.el.querySelector('[data-perf]');
    this.identity = this.el.querySelector('[data-identity]');
    this.cameraMode = this.el.querySelector('[data-camera-mode]');
    this.boostValue = this.el.querySelector('[data-boost-value]');
    this.boostFill = this.el.querySelector('[data-boost-fill]');
    this.identity.textContent = playerName;
    this.orangeScore = this.el.querySelector('[data-orange-score]');
    this.blueScore = this.el.querySelector('[data-blue-score]');
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

  setPerformance(profile, fps, pixelRatio) {
    if (this.perf) this.perf.textContent = profile;
    if (this.fps) this.fps.textContent = `FPS ${Math.round(fps)} · Render ${Math.round(pixelRatio * 100)}%`;
  }

  setCameraMode(mode) {
    if (!this.cameraMode) return;
    const label = mode === 'CAR' ? 'CAR CAM' : 'BALL CAM';
    this.cameraMode.textContent = `Ball Cam / Car Cam · aktuell: ${label}`;
  }

  setScore(orange, blue) {
    this.orangeScore.textContent = String(Math.max(0, Number(orange) || 0));
    this.blueScore.textContent = String(Math.max(0, Number(blue) || 0));
  }

  update(car) {
    this.speed.textContent = String(Math.round(car.getSpeedKmh())).padStart(3, '0');
    this.state.textContent = car.grounded ? 'GROUND' : 'AIR';
    const boost = Math.max(0, Math.min(100, Number(car.getBoost?.() ?? car.boost) || 0));
    if (this.boostValue) this.boostValue.textContent = String(Math.round(boost));
    if (this.boostFill) this.boostFill.style.transform = `scaleX(${boost / 100})`;
    this.el.classList.toggle('hud--boost-low', boost <= 20);
  }
}
