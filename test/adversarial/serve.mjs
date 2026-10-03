#!/usr/bin/env node
// Zero-dependency static server for the adversarial suite. Serves ./site on
// TWO ports: 8787 is the "wrapped" origin the harness wraps; 8788 exists so
// the suite's iframe is genuinely cross-origin (subframe gate probe).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'site');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  console.log(`[req] :${req.socket.localPort} ${req.method} ${url.pathname}${url.search}`);
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  p = p.replace(/\.\./g, ''); // no traversal — the hostile page must earn nothing here
  try {
    const body = await readFile(join(root, p));
    // no-store: a stale probe page would report last run's verdicts — the
    // webview also caches per app title (per-title WKWebsiteDataStore), so
    // the harness varies the title per run too.
    res.writeHead(200, {
      'content-type': types[extname(p)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('nope');
  }
}

for (const port of [8787, 8788]) {
  // Dual-stack ('::' accepts v4-mapped too): WebKit may reach the loopback
  // over IPv6 first — an IPv4-only bind made the wrapped nav fail cold.
  const srv = createServer(handler);
  srv.on('error', (e) => {
    // Die loudly: a stale server from a previous run would silently poison
    // every result with the wrong site build.
    console.error(`[serve] port ${port} unavailable (${e.code}) — kill the stale server first`);
    process.exit(2);
  });
  srv.listen(port, '::', () =>
    console.log(`[serve] hostile site on http://127.0.0.1:${port} (dual-stack)`));
}
