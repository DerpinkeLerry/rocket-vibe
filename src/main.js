import { Game } from './game/Game.js';
import { LanClient } from './network/LanClient.js';
import './style.css';

async function boot() {
  const app = document.querySelector('#app');
  const multiplayerEnabled = import.meta.env.MODE === 'lan' || import.meta.env.PROD;

  let network = null;
  let RAPIER = null;

  if (multiplayerEnabled) {
    network = new LanClient();
    await network.connect();
    // No Rapier import in the browser for online play. Railway owns physics.
  } else {
    const rapierModule = await import('@dimforge/rapier3d-compat');
    RAPIER = rapierModule.default;
    await RAPIER.init();
  }

  const game = new Game(app, RAPIER, network);
  game.start();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <pre style="white-space:pre-wrap;color:#fff;background:#120b12;padding:24px;min-height:100vh;margin:0">
Fehler beim Starten:\n\n${error?.stack ?? error}\n\nGo/LAN: "npm run lan".\nRailway baut das enthaltene Dockerfile automatisch.\nOffline: "npm run dev".
    </pre>`;
});
