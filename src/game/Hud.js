export class Hud {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud__title">ROCKET VIBE // BALL PHYSICS 0.4 <span class="hud__perf">PERFORMANCE MODE</span></div>
      <div class="hud__controls">
        <kbd>W / S</kbd><span>Boden: Gas · Luft: Pitch</span>
        <kbd>A / D</kbd><span>Boden: Lenken · Luft: Yaw</span>
        <kbd>SPACE</kbd><span>Jump / Double Jump</span>
        <kbd>SHIFT</kbd><span>Boost</span>
        <kbd>Q / E</kbd><span>Air Roll</span>
        <kbd>B</kbd><span>Ball Reset</span>
        <kbd>R</kbd><span>Auto Reset</span>
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
  }

  update(car) {
    this.speed.textContent = String(Math.round(car.getSpeedKmh())).padStart(3, '0');
    this.state.textContent = car.grounded ? 'GROUND' : 'AIR';
  }
}
