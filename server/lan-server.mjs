import os from 'node:os';
import { createServer as createViteServer } from 'vite';
import { attachGameSockets } from './game-sockets.mjs';
import { createAuthoritativeGame } from './authoritative-game.mjs';

const PORT = Number(process.env.PORT || 5173);
const HOST = '0.0.0.0';

const vite = await createViteServer({
  mode: 'lan',
  server: {
    host: HOST,
    port: PORT,
    strictPort: true
  }
});

await vite.listen();

const httpServer = vite.httpServer;
if (!httpServer) throw new Error('Vite HTTP server konnte nicht gestartet werden.');

const game = await createAuthoritativeGame();
attachGameSockets(httpServer, { path: '/lan', label: 'LAN', game });

function lanAddresses() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const info of entries || []) {
      if (info.family === 'IPv4' && !info.internal) result.push(info.address);
    }
  }
  return [...new Set(result)];
}

console.log('\n==============================================');
console.log(' ROCKET VIBE LAN 0.9 · 4 PLAYER SERVER');
console.log('==============================================');
console.log(`Host:   http://localhost:${PORT}`);
for (const ip of lanAddresses()) console.log(`Freund: http://${ip}:${PORT}`);
console.log('\nDie ersten vier Browser/Geraete werden Spieler 1 bis 4.');
console.log('Alle Autos und der Ball werden zentral auf diesem Server simuliert.');
console.log('Falls Windows fragt: Zugriff im privaten Netzwerk erlauben.');
console.log('==============================================\n');
