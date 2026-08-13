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
      <div class="hud__title">ROCKET VIBE // ONLINE 1.10.15 <span class="hud__perf" data-perf>${profile}</span></div>
      <div class="hud__scoreboard" aria-label="Spielstand Orange gegen Blau">
        <div class="hud__score-team hud__score-team--orange"><span>ORANGE</span><strong data-orange-score>0</strong></div>
        <div class="hud__score-separator">:</div>
        <div class="hud__score-team hud__score-team--blue"><strong data-blue-score>0</strong><span>BLAU</span></div>
      </div>
      <div class="hud__kickoff" data-kickoff hidden aria-live="polite" aria-atomic="true">
        <strong data-kickoff-value>3</strong>
        <span data-kickoff-caption>KICKOFF</span>
      </div>
      <div class="hud__replay" data-replay hidden aria-live="polite">
        <div class="hud__replay-top">
          <span>WIEDERHOLUNG</span>
          <strong data-replay-scorer>TOR</strong>
        </div>
        <div class="hud__replay-bottom">
          <button type="button" data-replay-skip>REPLAY ÜBERSPRINGEN</button>
          <span data-replay-votes>0/0 bereit</span>
        </div>
      </div>
      <div class="hud__quickchat" aria-label="Quick Chat">
        <div class="hud__quickchat-feed" data-quickchat-feed aria-live="polite" aria-relevant="additions"></div>
        <div class="hud__quickchat-status" data-quickchat-status hidden>QUICK CHAT COOLDOWN</div>
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
        <kbd>STRG</kbd><span>Drift / Handbremse</span>
        <kbd>1</kbd><span>Quick Chat · What a save! (3×, dann 2 s Cooldown)</span>
        <kbd>Q / E</kbd><span>Air Roll</span>
        <kbd>B</kbd><span>Ball Reset</span>
        <kbd>R</kbd><span>Eigenes Auto Reset</span>
      </div>
      <div class="hud__boost" aria-label="Boost Anzeige">
        <div class="hud__boost-head"><span>BOOST</span><strong data-boost-value>100</strong></div>
        <div class="hud__boost-track" data-boost-track><div class="hud__boost-fill" data-boost-fill></div><div class="hud__boost-sparks" aria-hidden="true"><i class="hud__boost-spark" style="--spark-delay:-0ms;--spark-x:-18px;--spark-y:-15px"></i><i class="hud__boost-spark" style="--spark-delay:-53ms;--spark-x:-11px;--spark-y:11px"></i><i class="hud__boost-spark" style="--spark-delay:-106ms;--spark-x:-6px;--spark-y:-8px"></i><i class="hud__boost-spark" style="--spark-delay:-159ms;--spark-x:8px;--spark-y:-13px"></i><i class="hud__boost-spark" style="--spark-delay:-212ms;--spark-x:14px;--spark-y:9px"></i><i class="hud__boost-spark" style="--spark-delay:-265ms;--spark-x:20px;--spark-y:4px"></i><i class="hud__boost-spark" style="--spark-delay:-318ms;--spark-x:-15px;--spark-y:15px"></i><i class="hud__boost-spark" style="--spark-delay:-371ms;--spark-x:5px;--spark-y:-17px"></i><i class="hud__boost-spark" style="--spark-delay:-424ms;--spark-x:12px;--spark-y:16px"></i><i class="hud__boost-spark" style="--spark-delay:-477ms;--spark-x:-8px;--spark-y:6px"></i></div></div>
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
    this.boostTrack = this.el.querySelector('[data-boost-track]');
    this.identity.textContent = playerName;
    this.orangeScore = this.el.querySelector('[data-orange-score]');
    this.blueScore = this.el.querySelector('[data-blue-score]');
    this.kickoff = this.el.querySelector('[data-kickoff]');
    this.kickoffValue = this.el.querySelector('[data-kickoff-value]');
    this.kickoffCaption = this.el.querySelector('[data-kickoff-caption]');
    this.kickoffHideTimer = null;
    this.replay = this.el.querySelector('[data-replay]');
    this.replayScorer = this.el.querySelector('[data-replay-scorer]');
    this.replaySkip = this.el.querySelector('[data-replay-skip]');
    this.replayVotes = this.el.querySelector('[data-replay-votes]');
    this.replaySkipHandler = null;
    this.replaySkipRequested = false;
    this.quickChatFeed = this.el.querySelector('[data-quickchat-feed]');
    this.quickChatStatus = this.el.querySelector('[data-quickchat-status]');
    this.quickChatCooldownTimer = null;
    this.replaySkip?.addEventListener('click', () => {
      if (this.replaySkipRequested || !this.replaySkipHandler) return;
      this.replaySkipRequested = true;
      this.replaySkip.disabled = true;
      this.replaySkip.textContent = 'SKIP ✓';
      this.replaySkipHandler();
    });
  }

  addQuickChat(chat) {
    if (!this.quickChatFeed) return;
    const line = document.createElement('div');
    const team = chat?.team === 'blue' ? 'blue' : 'orange';
    line.className = `hud__quickchat-line hud__quickchat-line--${team}`;

    const name = document.createElement('span');
    name.textContent = String(chat?.playerName || 'Spieler').slice(0, 16);
    const text = document.createElement('strong');
    text.textContent = 'What a save!';
    line.append(name, text);
    this.quickChatFeed.appendChild(line);

    while (this.quickChatFeed.children.length > 6) {
      this.quickChatFeed.firstElementChild?.remove();
    }
    if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(() => line.classList.add('is-visible'));
    else line.classList.add('is-visible');
    setTimeout(() => {
      line.classList.remove('is-visible');
      setTimeout(() => line.remove(), 180);
    }, 4200);
  }

  setQuickChatCooldown(milliseconds = 0) {
    if (!this.quickChatStatus) return;
    if (this.quickChatCooldownTimer) {
      clearTimeout(this.quickChatCooldownTimer);
      this.quickChatCooldownTimer = null;
    }
    const duration = Math.max(0, Number(milliseconds) || 0);
    if (duration <= 0) {
      this.quickChatStatus.hidden = true;
      return;
    }
    this.quickChatStatus.hidden = false;
    this.quickChatStatus.textContent = `QUICK CHAT COOLDOWN · ${(duration / 1000).toFixed(1)} s`;
    this.quickChatCooldownTimer = setTimeout(() => {
      this.quickChatStatus.hidden = true;
      this.quickChatCooldownTimer = null;
    }, duration);
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

  setKickoff(phase, count = 0) {
    if (!this.kickoff) return;
    if (this.kickoffHideTimer) {
      clearTimeout(this.kickoffHideTimer);
      this.kickoffHideTimer = null;
    }

    if (phase === 'countdown') {
      const value = Math.max(1, Math.min(3, Math.round(Number(count) || 1)));
      this.kickoff.hidden = false;
      this.kickoff.classList.remove('hud__kickoff--go');
      this.kickoffValue.textContent = String(value);
      this.kickoffCaption.textContent = value === 3 ? 'MATCH STARTET' : 'KICKOFF';
      this.pulseKickoff();
      return;
    }

    if (phase === 'go') {
      this.kickoff.hidden = false;
      this.kickoff.classList.add('hud__kickoff--go');
      this.kickoffValue.textContent = 'LOS!';
      this.kickoffCaption.textContent = 'SPIELEN';
      this.pulseKickoff();
      this.kickoffHideTimer = setTimeout(() => {
        this.kickoff.hidden = true;
        this.kickoff.classList.remove('hud__kickoff--go');
      }, 700);
      return;
    }

    this.kickoff.hidden = true;
    this.kickoff.classList.remove('hud__kickoff--go');
  }


  setReplaySkipHandler(handler) {
    this.replaySkipHandler = typeof handler === 'function' ? handler : null;
  }

  setReplay(replay) {
    if (!this.replay) return;
    const phase = replay?.phase;
    if (!replay || phase === 'end' || phase === 'hidden') {
      this.replay.hidden = true;
      this.replaySkipRequested = false;
      if (this.replaySkip) {
        this.replaySkip.disabled = false;
        this.replaySkip.textContent = 'REPLAY ÜBERSPRINGEN';
      }
      return;
    }

    this.replay.hidden = false;
    const scorerName = String(replay.scorerName || 'Unbekannt').slice(0, 16);
    if (this.replayScorer) this.replayScorer.textContent = `TOR VON ${scorerName.toUpperCase()}`;
    const skipped = Math.max(0, Number(replay.skipped) || 0);
    const required = Math.max(0, Number(replay.required) || 0);
    if (this.replayVotes) {
      this.replayVotes.textContent = phase === 'wait'
        ? 'Replay läuft · Einstieg nach Kickoff'
        : `${skipped}/${required} Skip${required === 1 ? '' : 's'}`;
    }
    if (this.replaySkip) {
      const canSkip = phase !== 'wait';
      this.replaySkip.hidden = !canSkip;
      if (!this.replaySkipRequested) {
        this.replaySkip.disabled = !canSkip;
        this.replaySkip.textContent = 'REPLAY ÜBERSPRINGEN';
      }
    }
  }

  pulseKickoff() {
    this.kickoff?.animate?.([
      { transform: 'translate(-50%, -50%) scale(0.72)', opacity: 0.2 },
      { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
    ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  update(car) {
    this.speed.textContent = String(Math.round(car.getSpeedKmh())).padStart(3, '0');
    this.state.textContent = car.grounded ? 'GROUND' : 'AIR';
    const boost = Math.max(0, Math.min(100, Number(car.getBoost?.() ?? car.boost) || 0));
    if (this.boostValue) this.boostValue.textContent = String(Math.round(boost));
    if (this.boostFill) this.boostFill.style.transform = `scaleX(${boost / 100})`;
    if (this.boostTrack) this.boostTrack.style.setProperty('--boost-level', `${boost}%`);
    this.el.classList.toggle('hud--boost-low', boost <= 20);
    this.el.classList.toggle('hud--boosting', Boolean(car.boosting) && boost > 0.01);
  }
}
