import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game/Game.js';
import './style.css';

async function boot() {
  await RAPIER.init();
  const app = document.querySelector('#app');
  const game = new Game(app, RAPIER);
  game.start();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <pre style="white-space:pre-wrap;color:#fff;background:#120b12;padding:24px;min-height:100vh;margin:0">
Fehler beim Starten:\n\n${error?.stack ?? error}\n\nBitte einmal "npm install" und danach "npm run dev" ausführen.
    </pre>`;
});
