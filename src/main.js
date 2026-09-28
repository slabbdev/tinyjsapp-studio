// TinyJS Studio backend — a thin, honest shell around the tinyjs CLI.
//
// Everything the Studio does, it does by spawning the real `tinyjs`
// commands and streaming their output to the window. No hidden logic, no
// reimplementation: if `tinyjs new` would print it, you see it.

const IS_WIN = tjs.env.OS === 'Windows_NT';
const IS_LINUX = tjs.env.OS === 'Linux';
const enc = new TextEncoder();
const dec = new TextDecoder();

let binPath = null; // resolved once, cached
let child = null; // the one long-running command (dev), if any
let pendingIcon = null; // PNG bytes from the picker, applied to the next create/wrap

// How the CLI is found, in order:
//   1. TINYJS_BIN env var
//   2. a tinyjsapp source checkout next to this repo (../tinyjsapp) — the
//      dev setup, and the only way to reach the `wrap` command before it
//      ships in a release
//   3. the installed CLI (~/.tinyjs/tinyjs, %LOCALAPPDATA%\tinyjs) or PATH
async function findBin() {
  if (binPath) return binPath;
  const cands = [];
  if (tjs.env.TINYJS_BIN) cands.push(tjs.env.TINYJS_BIN);
  const cwdParent = tjs.cwd.replace(/[\\/][^\\/]*$/, '');
  const sep = IS_WIN ? '\\' : '/';
  if (IS_WIN) {
    cands.push(cwdParent + '\\tinyjsapp\\tinyjs.cmd');
    const local = tjs.env.LOCALAPPDATA ??
      (tjs.env.USERPROFILE ?? '') + '\\AppData\\Local';
    cands.push(local + '\\tinyjs\\tinyjs.cmd');
  } else {
    cands.push(cwdParent + '/tinyjsapp/tinyjs');
    cands.push((tjs.env.HOME ?? '') + '/.tinyjs/tinyjs');
  }
  for (const c of cands) {
    if (!c) continue;
    try { await tjs.stat(c); binPath = c; return c; } catch { }
  }
  // Nothing on disk — try PATH the way a shell would.
  try {
    const p = tjs.spawn(IS_WIN ? ['cmd.exe', '/c', 'where', 'tinyjs']
      : ['sh', '-c', 'command -v tinyjs'],
      { stdout: 'pipe', stderr: 'ignore' });
    const out = await readAll(p.stdout);
    await p.wait();
    const first = out.trim().split('\n')[0]?.trim();
    if (first) { binPath = first; return first; }
  } catch { }
  return null;
}

async function readAll(stream) {
  const dec = new TextDecoder();
  let out = '';
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

// Line-buffer one child stream into the page's log pane.
function pump(app, stream, tag) {
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        app.push('log', `[${tag}] ${buf.slice(0, i)}`);
        buf = buf.slice(i + 1);
      }
    }
    if (buf.trim()) app.push('log', `[${tag}] ${buf}`);
  })().catch(() => { });
}

async function runStreaming(app, argv, { cwd, label } = {}) {
  if (child) throw new Error('a command is still running — stop it first');
  const bin = await findBin();
  if (!bin) {
    throw new Error('tinyjs CLI not found — install it (tinyjs.app), clone ' +
      'tinyjsapp next to this repo, or set TINYJS_BIN');
  }
  const full = IS_WIN && bin.endsWith('.cmd')
    ? ['cmd.exe', '/c', bin, ...argv]
    : [bin, ...argv];
  const p = tjs.spawn(full, { cwd, stdout: 'pipe', stderr: 'pipe' });
  child = p;
  pump(app, p.stdout, 'out');
  pump(app, p.stderr, 'err');
  // txiki's wait() returns { exit_status, term_signal } — normalize to a
  // number, the page compares it to 0.
  const w = await p.wait();
  const code = typeof w === 'object' && w !== null ? (w.exit_status ?? -1) : w;
  child = null;
  app.push('done', { label: label ?? argv.join(' '), code });
  return { code };
}

// --- icon picker ------------------------------------------------------------
// Only PNG (and ICO, unwrapped to its inner PNG — sips refuses the container)
// so the bytes land as icon.png and every platform's icon pipeline stays
// happy. JPEG/WebP site icons still come through the CLI's own fetch path.

function icoPng(b) {
  const count = b[4] | (b[5] << 8);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + 16 * i;
    const size = b[e + 8] | (b[e + 9] << 8) | (b[e + 10] << 16) | (b[e + 11] << 24);
    const off = b[e + 12] | (b[e + 13] << 8) | (b[e + 14] << 16) | (b[e + 15] << 24);
    const w = b[e] || 256, h = b[e + 1] || 256;
    if (!best || w * h > best.w * best.h) best = { w, h, size, off };
  }
  if (!best) return null;
  const img = b.subarray(best.off, best.off + best.size);
  return img[0] === 0x89 && img[1] === 0x50 ? img : null;
}

function sniffPngOrIco(b) {
  const is = (m) => m.every((byte, i) => b[i] === byte);
  if (is([0x89, 0x50])) return b;
  if (is([0x00, 0x00, 0x01, 0x00])) return icoPng(b);
  return null;
}

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

async function writeIcon(dir, bytes) {
  await tjs.writeFile(dir.replace(/[\\/]+$/, '') + '/icon.png', bytes);
}

// A frameless window with no titlebar of its own can't be moved — so
// "frameless" generates this starter inject: a drag strip along the top edge,
// plus window buttons where the OS supplies none (Windows/Linux; macOS gets
// its native traffic lights). document-start, every window.
const DRAG_STRIP = `// Frameless starter: a drag strip along the top edge so the window moves,
// plus window buttons where the OS supplies none (Windows/Linux). Delete
// this file and the "inject" key in tinyjs.json once you have your own
// titlebar.
(() => {
  const bar = document.createElement('div');
  bar.setAttribute('data-tiny-drag', '');
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:26px;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:flex-end;gap:8px;' +
    'padding:0 10px';
  if (!/Mac/i.test(navigator.platform)) {
    for (const [label, verb] of [['–', 'minimize'], ['×', 'close']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'width:18px;height:18px;border:0;border-radius:50%;' +
        'background:#2a3040;color:#e8eaf0;font:12px/1 sans-serif;cursor:pointer';
      b.addEventListener('click', () => window.tiny?.win[verb]());
      bar.appendChild(b);
    }
  }
  document.documentElement.appendChild(bar);
})();
`;

// Patch a generated project for frameless mode: chrome + the drag-strip
// inject, written after the CLI has produced its tinyjs.json.
async function applyFrameless(dir) {
  const root = dir.replace(/[\\/]+$/, '');
  const p = root + '/tinyjs.json';
  const cfg = JSON.parse(dec.decode(await tjs.readFile(p)));
  cfg.chrome = { ...(cfg.chrome ?? {}), frame: false };
  cfg.inject = 'inject.js';
  await tjs.writeFile(p, enc.encode(JSON.stringify(cfg, null, 2) + '\n'));
  await tjs.writeFile(root + '/inject.js', enc.encode(DRAG_STRIP));
}

// The displayed name (menu bar, dock, titlebar) is tinyjs.json "title".
async function patchTitle(dir, title) {
  const p = dir.replace(/[\\/]+$/, '') + '/tinyjs.json';
  const cfg = JSON.parse(dec.decode(await tjs.readFile(p)));
  cfg.title = String(title).trim().slice(0, 60);
  await tjs.writeFile(p, enc.encode(JSON.stringify(cfg, null, 2) + '\n'));
}

export const api = {
  // Status bar: which CLI the Studio will drive, and its version.
  async resolve() {
    const bin = await findBin();
    if (!bin) return { found: false };
    let version = '';
    try {
      const p = tjs.spawn(IS_WIN && bin.endsWith('.cmd')
        ? ['cmd.exe', '/c', bin, '--version'] : [bin, '--version'],
        { stdout: 'pipe', stderr: 'ignore' });
      version = (await readAll(p.stdout)).trim();
      await p.wait();
    } catch { }
    return { found: true, bin, version };
  },

  // tinyjs new <name> — runs inside the chosen projects folder. An optional
  // display title (what the OS shows) is patched into tinyjs.json after.
  async create({ parent, name, title, template, frameless }, app) {
    const argv = ['new', name];
    if (template && template !== 'vanilla') argv.push('--template', template);
    const r = await runStreaming(app, argv, { cwd: parent, label: 'create' });
    if (r.code === 0) {
      const dir = parent + '/' + name;
      if (title && title !== name) await patchTitle(dir, title);
      if (frameless) await applyFrameless(dir);
      if (pendingIcon) await writeIcon(dir, pendingIcon);
    }
    return r;
  },

  // tinyjs wrap <url> <dir> — needs a tinyjs with the wrap command. An
  // optional display title overrides the site's own <title> afterwards.
  async wrap({ parent, url, dir, title, ua, frameless }, app) {
    const argv = ['wrap', url, dir];
    if (ua) argv.push('--ua', ua);
    const r = await runStreaming(app, argv, { cwd: parent, label: 'wrap' });
    if (r.code === 0) {
      const root = parent + '/' + dir;
      if (title) await patchTitle(root, title);
      if (frameless) await applyFrameless(root);
      if (pendingIcon) {
        // The user's pick beats whatever the site advertises.
        await writeIcon(root, pendingIcon);
      }
    }
    return r;
  },

  // tinyjs dev / build inside the project — dev keeps running until Stop.
  async run({ dir }, app) {
    return runStreaming(app, ['dev'], { cwd: dir, label: 'dev' });
  },
  async build({ dir }, app) {
    return runStreaming(app, ['build'], { cwd: dir, label: 'build' });
  },

  async stop() {
    if (!child) return { stopped: false };
    try { child.kill('SIGTERM'); } catch { }
    return { stopped: true };
  },

  // Icon picker: validate the chosen file, remember it for the next
  // create/wrap (it beats whatever the site advertises), hand back a preview
  // — and with `dir`, write it straight into an existing project.
  async setIcon({ path, dir }) {
    const img = sniffPngOrIco(new Uint8Array(await tjs.readFile(path)));
    if (!img) {
      throw new Error('not a usable icon — pick a PNG, or an .ico (unwrapped automatically)');
    }
    pendingIcon = img;
    if (dir) await writeIcon(dir, img);
    return { dataUrl: 'data:image/png;base64,' + toBase64(img) };
  },

  // The projects folder survives restarts.
  async saveFolder(params, app) {
    await app.store.set('studio.parent', params.path ?? null);
    return true;
  },
  async loadFolder(params, app) {
    return { path: (await app.store.get('studio.parent')) ?? null };
  },

  // Every tinyjs project in the chosen folder: readDir + tinyjs.json parse,
  // icon inlined as a dataURL (the page can't read arbitrary file:// paths).
  async listProjects({ parent }) {
    const projects = [];
    try {
      const iter = await tjs.readDir(parent);
      for await (const e of iter) {
        if (!e.isDirectory || e.name.startsWith('.')) continue;
        try {
          const cfg = JSON.parse(dec.decode(await tjs.readFile(parent + '/' + e.name + '/tinyjs.json')));
          let icon = null;
          try {
            const bytes = new Uint8Array(await tjs.readFile(parent + '/' + e.name + '/icon.png'));
            if (bytes.length <= 512 * 1024) icon = 'data:image/png;base64,' + toBase64(bytes);
          } catch { }
          projects.push({
            dir: e.name,
            title: cfg.title ?? cfg.name ?? e.name,
            url: cfg.url ?? null,
            icon,
          });
        } catch { /* a folder without tinyjs.json isn't a project */ }
      }
    } catch { /* folder gone since it was picked */ }
    projects.sort((a, b) => a.dir.localeCompare(b.dir));
    return { projects };
  },

  // Show the project in Finder / Explorer / the file manager.
  async reveal({ dir }) {
    const argv = IS_WIN ? ['explorer.exe', dir]
      : IS_LINUX ? ['xdg-open', dir]
      : ['open', dir];
    tjs.spawn(argv, { stdout: 'ignore', stderr: 'ignore' });
    return true;
  },
};

export function init(app) {
  app.push('ready', { version: tjs.version });
}
export function onWindowClosed() {
  // dev child dies with us — txiki tears the process group down.
}
