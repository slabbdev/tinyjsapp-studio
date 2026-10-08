#!/usr/bin/env node
// Benchmark: a tinyjs wrap vs an Electron shell — same page, same signal.
//
// Methodology (both sides identical):
//   size      — du of the shipped app bundle (the .app / the electron dist)
//   cold start— spawn the app binary → the loaded page's JS fetches /loaded
//               from the local server → time-to-marker (median of N runs)
//   RAM       — sum of the RSS of the app's process tree, sampled 5 s after
//               the marker
// The electron side needs node_modules/electron (the ~250 MB runtime every
// Electron app ships — WebCatalog/Nativefier-class output). Runs on macOS.
import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RUNS = 3;
const HOME = '/tmp/tjs-bench-site';
mkdirSync(HOME, { recursive: true });

const PAGE = `<!doctype html><html><body><script>
  fetch('/loaded').catch(()=>{});
</script></body></html>`;

let server, loadedAt = 0;
function startServer() {
  return new Promise((res) => {
    server = createServer((req, res) => {
      if (req.url.startsWith('/loaded')) loadedAt = performance.now();
      if (req.url.startsWith('/loaded')) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE);
    });
    server.listen(8791, '127.0.0.1', res);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(pid) {
  try { execSync(`pkill -TERM -P ${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null`); } catch { }
}
function treeRss(pid) {
  // sum RSS of the process and all descendants (KB)
  let pids = [pid];
  for (let round = 0; round < 5; round++) {
    for (const p of [...pids]) {
      try {
        const kids = execSync(`pgrep -P ${p}`).toString().trim().split('\n').filter(Boolean);
        for (const k of kids) if (!pids.includes(Number(k))) pids.push(Number(k));
      } catch { }
    }
  }
  let total = 0;
  for (const p of pids) {
    try { total += Number(execSync(`ps -o rss= -p ${p}`).toString().trim() || 0); } catch { }
  }
  return total; // KB
}

async function runOnce(binary, args, cwd) {
  const t0 = performance.now();
  loadedAt = 0;
  const p = spawn(binary, args, { cwd, stdio: 'ignore', detached: true });
  const waited = await (async () => {
    for (let i = 0; i < 300; i++) {           // 30 s cap
      await sleep(100);
      if (loadedAt) return loadedAt - t0;
      if (i > 50 && p.exitCode !== null && p.signalCode === null) break;
    }
    return null;
  })();
  await sleep(5000);                           // let RAM settle
  const rss = treeRss(p.pid);
  killTree(p.pid);
  await sleep(1500);
  return { cold: waited, rss };
}

const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function bench(name, binary, args, cwd) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await runOnce(binary, args, cwd));
  const colds = runs.map((r) => r.cold).filter(Boolean);
  const row = {
    name,
    sizeMB: Number(execSync(`du -sm "${cwd}"`).toString().split('\t')[0]),
    coldMs: colds.length ? median(colds.map((c) => Math.round(c))) : null,
    rssMB: median(runs.map((r) => Math.round(r.rss / 1024))),
  };
  return row;
}

const out = [];
await startServer();

// ---- tinyjs side: wrap + build the same local page ----
const tjs = process.env.TINYJS_BIN || join(process.env.HOME, '.zcode/workspace/default/tinyjsapp/tinyjs');
const work = mkdtempSync(join(tmpdir(), 'tjs-bench-'));
console.error(`[bench] tinyjs wrap + build…`);
execSync(`"${tjs}" wrap http://127.0.0.1:8791 "${work}/site" --force --origins exact --title "Bench Site"`, { stdio: 'ignore' });
execSync(`"${tjs}" build`, { cwd: `${work}/site`, stdio: 'ignore' });
const appDir = execSync(`ls -d "${work}/site/dist/"*.app`).toString().trim().split('\n')[0];
const binName = appDir.split('/').pop().replace(/\.app$/, '');
const bin = `${appDir}/Contents/MacOS/${binName}`;
if (!existsSync(bin)) { console.error('tinyjs build output not found at ' + bin); process.exit(1); }
out.push(await bench('tinyjs wrap', bin, [], appDir));

// ---- electron side: same page through the bundled-Chromium shell ----
const eRoot = '/tmp/bench-electron';
if (existsSync(`${eRoot}/node_modules/electron/dist/Electron.app`)) {
  writeFileSync(`${eRoot}/main.js`, `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => { new BrowserWindow({ width: 1000, height: 700 }).loadURL('http://127.0.0.1:8791'); });`);
  const pkg = JSON.parse(readFileSync(`${eRoot}/package.json`, 'utf8'));
  pkg.main = 'main.js';
  writeFileSync(`${eRoot}/package.json`, JSON.stringify(pkg, null, 2));
  out.push(await bench(
    'electron shell',
    `${eRoot}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
    ['.'], eRoot));
} else {
  console.error('[bench] electron not installed — skipping the comparison row');
}

server.close();
console.log(JSON.stringify(out, null, 2));
