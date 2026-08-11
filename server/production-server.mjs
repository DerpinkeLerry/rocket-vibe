import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGameSockets } from './game-sockets.mjs';
import { createAuthoritativeGame } from './authoritative-game.mjs';

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');
let shuttingDown = false;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json'
};

function setCommonHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function sendJson(res, statusCode, value) {
  setCommonHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value));
}

async function resolveStaticFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = normalize(join(DIST_DIR, relative));
  const distPrefix = DIST_DIR.endsWith(sep) ? DIST_DIR : `${DIST_DIR}${sep}`;

  if (candidate !== DIST_DIR && !candidate.startsWith(distPrefix)) return null;

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const indexFile = join(candidate, 'index.html');
      const indexInfo = await stat(indexFile);
      if (indexInfo.isFile()) return indexFile;
    }
  } catch {
    // Fall through to SPA fallback.
  }

  return null;
}

async function serveFile(req, res, filePath) {
  const info = await stat(filePath);
  const ext = extname(filePath).toLowerCase();
  const isAsset = filePath.includes(`${sep}assets${sep}`);

  setCommonHeaders(res);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': isAsset
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', (error) => {
    console.error('[HTTP] Datei konnte nicht gelesen werden:', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      sendJson(res, shuttingDown ? 503 : 200, {
        ok: !shuttingDown,
        service: 'rocket-vibe',
        version: '1.0.0',
        players: sockets.getPlayerCount()
      });
      return;
    }

    if (url.pathname === '/debug/game') {
      sendJson(res, 200, game.debugState());
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    let filePath = await resolveStaticFile(url.pathname);

    // Fallback to index.html for browser navigation. Static assets still 404 cleanly.
    if (!filePath && !extname(url.pathname)) {
      filePath = join(DIST_DIR, 'index.html');
    }

    if (!filePath) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    await serveFile(req, res, filePath);
  } catch (error) {
    console.error('[HTTP] Request fehlgeschlagen:', error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
    else res.end();
  }
});

const game = await createAuthoritativeGame();
const sockets = attachGameSockets(server, { path: '/lan', label: 'ONLINE', game });

server.listen(PORT, HOST, () => {
  console.log('\n==============================================');
  console.log(' ROCKET VIBE ONLINE 1.0 · LOW LATENCY');
  console.log('==============================================');
  console.log(`Listening on ${HOST}:${PORT}`);
  console.log('HTTP healthcheck: /health');
  console.log('WebSocket: /lan');
  console.log('Railway: dieselbe Domain fuer bis zu vier Spieler nutzen.');
  console.log('==============================================\n');
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] ${signal} empfangen - fahre sauber herunter ...`);

  sockets.closeAll(1012, 'Server restarting');
  server.close(() => process.exit(0));

  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
