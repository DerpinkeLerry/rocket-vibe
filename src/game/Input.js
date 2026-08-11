export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();

    window.addEventListener('keydown', (event) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
      }
      if (!event.repeat) this.pressed.add(event.code);
      this.down.add(event.code);
    }, { passive: false });

    window.addEventListener('keyup', (event) => {
      this.down.delete(event.code);
    });

    window.addEventListener('blur', () => {
      this.down.clear();
      this.pressed.clear();
    });
  }

  isDown(...codes) {
    return codes.some((code) => this.down.has(code));
  }

  consumePressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

}
