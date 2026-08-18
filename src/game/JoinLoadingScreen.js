const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class JoinLoadingScreen {
  constructor(root) {
    this.startedAt = performance.now();
    this.progress = 0;
    this.element = document.createElement('div');
    this.element.className = 'game-loading';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.innerHTML = `
      <div class="game-loading__card">
        <div class="game-loading__eyebrow">ROCKET VIBE</div>
        <div class="game-loading__mark" aria-hidden="true"><span></span><i></i></div>
        <h1>MATCH WIRD GELADEN</h1>
        <p class="game-loading__stage">Verbindung wird vorbereitet</p>
        <div class="game-loading__track" role="progressbar" aria-label="Ladefortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="game-loading__bar"></span>
        </div>
        <div class="game-loading__meta"><span class="game-loading__detail">Bitte kurz warten</span><strong class="game-loading__percent">0%</strong></div>
      </div>`;
    root.appendChild(this.element);
    this.stage = this.element.querySelector('.game-loading__stage');
    this.detail = this.element.querySelector('.game-loading__detail');
    this.percent = this.element.querySelector('.game-loading__percent');
    this.track = this.element.querySelector('.game-loading__track');
    this.bar = this.element.querySelector('.game-loading__bar');
  }

  setStage(stage, progress, detail = '') {
    if (!this.element?.isConnected) return;
    this.progress = Math.max(this.progress, Math.min(1, Math.max(0, Number(progress) || 0)));
    this.stage.textContent = String(stage || 'Match wird geladen');
    this.detail.textContent = String(detail || 'Bitte kurz warten');
    const value = Math.round(this.progress * 100);
    this.percent.textContent = `${value}%`;
    this.bar.style.transform = `scaleX(${this.progress})`;
    this.track.setAttribute('aria-valuenow', String(value));
  }

  nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  remove() {
    this.element?.remove();
  }

  async finish(detail = 'Alle Objekte sind bereit') {
    this.setStage('BEREIT', 1, detail);
    await this.nextPaint();
    const remaining = Math.max(0, 420 - (performance.now() - this.startedAt));
    if (remaining > 0) await wait(remaining);
    this.element?.classList.add('is-complete');
    await wait(180);
    this.remove();
  }
}
