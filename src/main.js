import { Game } from './game/Game.js';
import { LanClient } from './network/LanClient.js';
import './style.css';

function rememberedPlayerName() {
  try {
    return localStorage.getItem('rocket-vibe-player-name') || '';
  } catch {
    return '';
  }
}

function requestPlayerName(root) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'join-screen';
    overlay.innerHTML = `
      <form class="join-card">
        <div class="join-card__eyebrow">ROCKET VIBE</div>
        <h1>Wie heißt du?</h1>
        <p>Dein Name erscheint über deinem Auto.</p>
        <label for="player-name">Spielername</label>
        <input id="player-name" name="playerName" type="text" minlength="2" maxlength="16"
          autocomplete="nickname" spellcheck="false" placeholder="z. B. Goofy" required />
        <div class="join-card__error" aria-live="polite"></div>
        <button type="submit">MATCH BEITRETEN</button>
      </form>`;
    root.appendChild(overlay);

    const form = overlay.querySelector('form');
    const input = overlay.querySelector('input');
    const error = overlay.querySelector('.join-card__error');
    input.value = rememberedPlayerName();
    requestAnimationFrame(() => input.focus());

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2) {
        error.textContent = 'Bitte mindestens 2 Zeichen eingeben.';
        input.focus();
        return;
      }
      try {
        localStorage.setItem('rocket-vibe-player-name', name);
      } catch {
        // Private browsing may disable storage; the match can still start.
      }
      overlay.remove();
      resolve(name.slice(0, 16));
    });
  });
}

async function boot() {
  const app = document.querySelector('#app');
  const multiplayerEnabled = import.meta.env.MODE === 'lan' || import.meta.env.PROD;
  const playerName = await requestPlayerName(app);

  let network = null;
  let RAPIER = null;

  if (multiplayerEnabled) {
    network = new LanClient(playerName);
    await network.connect();
    // No Rapier import in the browser for online play. Railway owns physics.
  } else {
    const rapierModule = await import('@dimforge/rapier3d-compat');
    RAPIER = rapierModule.default;
    await RAPIER.init();
  }

  const game = new Game(app, RAPIER, network, { playerName });
  game.start();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <pre style="white-space:pre-wrap;color:#fff;background:#120b12;padding:24px;min-height:100vh;margin:0">
Fehler beim Starten:\n\n${error?.stack ?? error}\n\nGo/LAN: "npm run lan".\nRailway baut das enthaltene Dockerfile automatisch.\nOffline: "npm run dev".
    </pre>`;
});
