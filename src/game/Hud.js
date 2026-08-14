import { CAR_TUNING } from '../shared/game-tuning.js';

export class Hud {
  constructor(root, options = {}) {
    this.lowDetail = String(options.performanceProfile || '').toUpperCase() === 'ULTRA LOW';
    const playerCount = options.playerCount ?? 1;
    const maxPlayers = options.maxPlayers ?? 4;

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__scoreboard" aria-label="Spielstand Orange gegen Blau">
        <div class="hud__score-team hud__score-team--orange"><span>ORANGE</span><strong data-orange-score>0</strong></div>
        <div class="hud__score-separator">:</div>
        <div class="hud__score-team hud__score-team--blue"><strong data-blue-score>0</strong><span>BLAU</span></div>
      </div>
      <div class="hud__match-clock" data-match-clock hidden>5:00</div>
      <div class="hud__match-over" data-match-over hidden aria-live="polite"></div>
      <div class="hud__kickoff" data-kickoff hidden aria-live="polite" aria-atomic="true">
        <strong data-kickoff-value>3</strong>
        <span data-kickoff-caption>KICKOFF</span>
      </div>
      <div class="hud__replay" data-replay hidden aria-live="polite">
        <div class="hud__replay-top">
          <span>WIEDERHOLUNG</span>
          <strong data-replay-scorer>TOR</strong>
        </div>
        <div class="hud__replay-keyhint" data-replay-keyhint hidden aria-hidden="true">PRESS <kbd>SPACE</kbd> TO SKIP</div>
        <div class="hud__replay-bottom">
          <button type="button" data-replay-skip>REPLAY ÜBERSPRINGEN</button>
          <span data-replay-votes>0/0 bereit</span>
        </div>
      </div>
      <div class="hud__respawn" data-respawn hidden aria-live="polite">
        <div class="hud__respawn-title">DEMOLISHED</div>
        <div class="hud__respawn-countdown">RESPAWN IN <strong data-respawn-seconds>4.0</strong>s</div>
        <div class="hud__respawn-hint">SPAWNPUNKT WÄHLEN</div>
        <div class="hud__respawn-choices" role="group" aria-label="Spawnpunkt wählen">
          <button type="button" data-respawn-choice="0"><kbd>1</kbd><span>LINKS</span></button>
          <button type="button" data-respawn-choice="1"><kbd>2</kbd><span>MITTE</span></button>
          <button type="button" data-respawn-choice="2"><kbd>3</kbd><span>RECHTS</span></button>
        </div>
      </div>
      <div class="hud__quickchat" aria-label="Quick Chat">
        <div class="hud__quickchat-feed" data-quickchat-feed aria-live="polite" aria-relevant="additions"></div>
        <div class="hud__quickchat-status" data-quickchat-status hidden>QUICK CHAT COOLDOWN</div>
      </div>
      <div class="hud__network" aria-label="Performance und Verbindung">
        <span data-ping>PING --</span>
        <span data-fps>FPS --</span>
        <span data-player-count>${playerCount}/${maxPlayers} SPIELER</span>
      </div>
      <button class="hud__controls-toggle" type="button" data-controls-toggle aria-expanded="false" aria-controls="desktop-controls">STEUERUNG</button>
      <div class="hud__controls" id="desktop-controls" data-controls-panel hidden>
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
      <div class="hud__boost-gauge" data-boost-gauge role="meter" aria-label="Boost" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
        <div class="hud__boost-gauge-glow" aria-hidden="true"></div>
        <div class="hud__boost-segments" data-boost-segments aria-hidden="true"></div>
        <div class="hud__boost-core">
          <strong data-boost-value>100</strong>
          <span>BOOST</span>
        </div>
        <div class="hud__boost-gauge-sparks" aria-hidden="true">
          <i style="--spark-delay:-0ms;--spark-angle:-118deg"></i>
          <i style="--spark-delay:-78ms;--spark-angle:-72deg"></i>
          <i style="--spark-delay:-156ms;--spark-angle:-24deg"></i>
          <i style="--spark-delay:-234ms;--spark-angle:24deg"></i>
          <i style="--spark-delay:-312ms;--spark-angle:72deg"></i>
          <i style="--spark-delay:-390ms;--spark-angle:118deg"></i>
        </div>
      </div>
    `;
    root.appendChild(this.el);
    this.network = this.el.querySelector('[data-network]');
    this.playerCount = this.el.querySelector('[data-player-count]');
    this.ping = this.el.querySelector('[data-ping]');
    this.fps = this.el.querySelector('[data-fps]');
    this.perf = this.el.querySelector('[data-perf]');
    this.identity = this.el.querySelector('[data-identity]');
    this.cameraMode = this.el.querySelector('[data-camera-mode]');
    this.controlsToggle = this.el.querySelector('[data-controls-toggle]');
    this.controlsPanel = this.el.querySelector('[data-controls-panel]');
    this.boostValue = this.el.querySelector('[data-boost-value]');
    this.boostGauge = this.el.querySelector('[data-boost-gauge]');
    this.boostSegmentsRoot = this.el.querySelector('[data-boost-segments]');
    this.boostSegments = [];
    this.lastBoostSegmentCount = -1;
    if (!this.lowDetail) this.buildBoostGaugeSegments();
    this.orangeScore = this.el.querySelector('[data-orange-score]');
    this.blueScore = this.el.querySelector('[data-blue-score]');
    this.matchClock = this.el.querySelector('[data-match-clock]');
    this.matchOver = this.el.querySelector('[data-match-over]');
    this.matchOverTimer = null;
    this.kickoff = this.el.querySelector('[data-kickoff]');
    this.kickoffValue = this.el.querySelector('[data-kickoff-value]');
    this.kickoffCaption = this.el.querySelector('[data-kickoff-caption]');
    this.kickoffHideTimer = null;
    this.replay = this.el.querySelector('[data-replay]');
    this.replayScorer = this.el.querySelector('[data-replay-scorer]');
    this.replaySkip = this.el.querySelector('[data-replay-skip]');
    this.replayKeyHint = this.el.querySelector('[data-replay-keyhint]');
    this.replayVotes = this.el.querySelector('[data-replay-votes]');
    this.replaySkipHandler = null;
    this.replaySkipRequested = false;
    this.respawn = this.el.querySelector('[data-respawn]');
    this.respawnSeconds = this.el.querySelector('[data-respawn-seconds]');
    this.respawnChoices = [...this.el.querySelectorAll('[data-respawn-choice]')];
    this.respawnSelectionHandler = null;
    this.respawnSelectedIndex = 1;
    this.quickChatFeed = this.el.querySelector('[data-quickchat-feed]');
    this.quickChatStatus = this.el.querySelector('[data-quickchat-status]');
    this.quickChatCooldownTimer = null;
    this.controlsToggle?.addEventListener('click', () => {
      const open = this.controlsPanel?.hasAttribute('hidden') ?? true;
      if (open) this.controlsPanel?.removeAttribute('hidden');
      else this.controlsPanel?.setAttribute('hidden', '');
      this.controlsToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
      this.controlsToggle?.classList.toggle('is-open', open);
    });
    this.replaySkip?.addEventListener('click', () => this.requestReplaySkip());
    this.respawnChoices.forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.respawnChoice);
        if (Number.isInteger(index)) this.requestRespawnSelection(index);
      });
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

  setNetworkStatus(_text) {
    // Connection diagnostics are intentionally omitted from the compact HUD.
  }

  setPlayerCount(count, maxPlayers = 4) {
    this.playerCount.textContent = `${count}/${maxPlayers} SPIELER`;
  }

  setPing(rttMs) {
    if (!this.ping) return;
    this.ping.textContent = `PING ${Math.round(rttMs)} ms`;
  }

  setPerformance(_profile, fps, _pixelRatio) {
    if (this.fps) this.fps.textContent = `FPS ${Math.round(fps)}`;
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

  setMatchClock(clock) {
    if (!this.matchClock) return;
    if (!clock) {
      this.matchClock.hidden = true;
      return;
    }
    this.matchClock.hidden = false;
    if (clock.overtime) {
      this.matchClock.textContent = 'OVERTIME';
      this.matchClock.classList.add('is-overtime');
      return;
    }
    this.matchClock.classList.remove('is-overtime');
    const total = Math.max(0, Math.round(Number(clock.seconds) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    this.matchClock.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  showMatchOver(result) {
    if (!this.matchOver) return;
    if (this.matchOverTimer) clearTimeout(this.matchOverTimer);
    const orange = Math.max(0, Number(result?.orangeScore) || 0);
    const blue = Math.max(0, Number(result?.blueScore) || 0);
    const outcome = orange === blue ? 'UNENTSCHIEDEN' : (orange > blue ? 'ORANGE GEWINNT' : 'BLAU GEWINNT');
    this.matchOver.textContent = `${outcome} · ${orange}:${blue}`;
    this.matchOver.hidden = false;
    this.matchOverTimer = setTimeout(() => { this.matchOver.hidden = true; }, 2300);
  }

  setKickoff(phase, count = 0) {
    if (!this.kickoff) return;
    if (this.kickoffHideTimer) {
      clearTimeout(this.kickoffHideTimer);
      this.kickoffHideTimer = null;
    }

    if (phase === 'countdown') {
      const value = Math.max(1, Math.min(10, Math.round(Number(count) || 1)));
      this.kickoff.hidden = false;
      this.kickoff.classList.remove('hud__kickoff--go');
      this.kickoffValue.textContent = String(value);
      this.kickoffCaption.textContent = 'KICKOFF';
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



  setRespawnSelectionHandler(handler) {
    this.respawnSelectionHandler = typeof handler === 'function' ? handler : null;
  }

  requestRespawnSelection(index) {
    if (!this.respawn || this.respawn.hidden) return false;
    const choice = Math.max(0, Math.min(2, Math.round(Number(index) || 0)));
    this.respawnSelectedIndex = choice;
    this.respawnChoices.forEach((button, buttonIndex) => {
      const selected = buttonIndex === choice;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    this.respawnSelectionHandler?.(choice);
    return true;
  }

  setRespawnSelection(active, remainingMs = 0, selectedIndex = 1) {
    if (!this.respawn) return;
    if (!active) {
      this.respawn.hidden = true;
      return;
    }
    this.respawn.hidden = false;
    if (this.respawnSeconds) {
      const seconds = Math.max(0, Number(remainingMs) || 0) / 1000;
      this.respawnSeconds.textContent = seconds.toFixed(1);
    }
    const choice = Math.max(0, Math.min(2, Math.round(Number(selectedIndex) || 0)));
    if (choice !== this.respawnSelectedIndex || !this.respawnChoices.some((button) => button.classList.contains('is-selected'))) {
      this.respawnSelectedIndex = choice;
      this.respawnChoices.forEach((button, buttonIndex) => {
        const selected = buttonIndex === choice;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
  }

  setReplaySkipHandler(handler) {
    this.replaySkipHandler = typeof handler === 'function' ? handler : null;
  }

  requestReplaySkip() {
    if (this.replaySkipRequested || !this.replaySkipHandler || this.replay?.hidden || this.replaySkip?.hidden) return false;
    this.replaySkipRequested = true;
    if (this.replaySkip) {
      this.replaySkip.disabled = true;
      this.replaySkip.textContent = 'SKIP ✓';
    }
    if (this.replayKeyHint) this.replayKeyHint.hidden = true;
    this.replaySkipHandler();
    return true;
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
      if (this.replayKeyHint) this.replayKeyHint.hidden = true;
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
      if (this.replayKeyHint) this.replayKeyHint.hidden = !canSkip || this.replaySkipRequested;
    }
  }

  pulseKickoff() {
    if (this.lowDetail) return;
    this.kickoff?.animate?.([
      { transform: 'translate(-50%, -50%) scale(0.72)', opacity: 0.2 },
      { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
    ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  buildBoostGaugeSegments() {
    if (!this.boostSegmentsRoot) return;
    const count = 42;
    const startAngle = -138;
    const endAngle = 138;
    const span = endAngle - startAngle;

    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0 : i / (count - 1);
      const angle = startAngle + span * t;
      const segment = document.createElement('i');
      segment.className = 'hud__boost-segment';
      segment.style.setProperty('--segment-angle', `${angle}deg`);
      segment.style.setProperty('--segment-color', this.boostSegmentColor(t));
      this.boostSegmentsRoot.appendChild(segment);
      this.boostSegments.push(segment);
    }
  }

  boostSegmentColor(t) {
    // Warm RL-inspired sweep: deep orange near the gap, bright yellow on top,
    // then pale warm-white toward the far side.
    if (t < 0.52) {
      const u = t / 0.52;
      const hue = 25 + 28 * u;
      const light = 58 + 14 * u;
      return `hsl(${hue.toFixed(1)} 100% ${light.toFixed(1)}%)`;
    }
    const u = (t - 0.52) / 0.48;
    const hue = 53 - 43 * u;
    const saturation = 100 - 26 * u;
    const light = 72 + 12 * u;
    return `hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${light.toFixed(1)}%)`;
  }

  updateBoostGauge(boost) {
    const capacity = Math.max(1, Number(CAR_TUNING.boostCapacity) || 100);
    const amount = Math.max(0, Math.min(capacity, Number(boost) || 0));
    const normalized = (amount / capacity) * 100;
    if (this.boostValue) this.boostValue.textContent = String(Math.round(amount));
    if (this.boostGauge) {
      this.boostGauge.setAttribute('aria-valuemax', String(Math.round(capacity)));
      this.boostGauge.setAttribute('aria-valuenow', String(Math.round(amount)));
      this.boostGauge.style.setProperty('--boost-strength', (normalized / 100).toFixed(3));
    }

    const activeCount = Math.round((normalized / 100) * this.boostSegments.length);
    if (activeCount === this.lastBoostSegmentCount) return;
    this.lastBoostSegmentCount = activeCount;
    this.boostSegments.forEach((segment, index) => {
      segment.classList.toggle('is-empty', index >= activeCount);
    });
  }

  update(car) {
    const capacity = Math.max(1, Number(CAR_TUNING.boostCapacity) || 100);
    const boost = Math.max(0, Math.min(capacity, Number(car.getBoost?.() ?? car.boost) || 0));
    this.updateBoostGauge(boost);
    this.el.classList.toggle('hud--boost-low', boost <= 20);
    this.el.classList.toggle('hud--boosting', Boolean(car.boosting) && boost > 0.01);
  }
}
