import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game/Game.js';
import { LanClient } from './network/LanClient.js';
import './style.css';

async function boot() {
  await RAPIER.init();
  const app = document.querySelector('#app');

  let network = null;
  const multiplayerEnabled = import.meta.env.MODE === 'lan' || import.meta.env.PROD;
  if (multiplayerEnabled) {
    network = new LanClient();
    await network.connect();
  }

  const game = new Game(app, RAPIER, network);
  game.start();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <pre style="white-space:pre-wrap;color:#fff;background:#120b12;padding:24px;min-height:100vh;margin:0">
Fehler beim Starten:\n\n${error?.stack ?? error}\n\nMultiplayer lokal: "npm run lan".\nRailway/Production: "npm run build" und danach "npm start".\nOffline: "npm run dev".
    </pre>`;
});
