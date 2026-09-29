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
    cands.push(cwdParent + '\\tinyjsapp-cli\\tinyjs.cmd');
    cands.push(cwdParent + '\\tinyjsapp\\tinyjs.cmd');
    const local = tjs.env.LOCALAPPDATA ??
      (tjs.env.USERPROFILE ?? '') + '\\AppData\\Local';
    cands.push(local + '\\tinyjs\\tinyjs.cmd');
  } else {
    // A dedicated worktree checkout (tinyjsapp-cli) wins over the sibling:
    // the interactive checkout's branch changes under the user's feet, the
    // worktree stays pinned to the integration branch (wrap + name fixes).
    cands.push(cwdParent + '/tinyjsapp-cli/tinyjs');
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
// plus window buttons in the native traffic-light colors, left on macOS /
// right elsewhere (the native set is hidden — windowControls in
// tinyjs.json). Delete this file and the "inject" key in tinyjs.json once
// you have your own titlebar.
(() => {
  const mac = /Mac/i.test(navigator.platform);
  const bar = document.createElement('div');
  bar.setAttribute('data-tiny-drag', '');
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:26px;z-index:2147483647;' +
    'display:flex;align-items:center;gap:8px;padding:0 10px;' +
    'justify-content:' + (mac ? 'flex-start' : 'flex-end');
  const btns = mac
    ? [['\\u00d7', 'close', '#ff5f57'], ['\\u2013', 'minimize', '#febc2e'], ['\\u25cf', 'zoom', '#28c840']]
    : [['\\u2013', 'minimize', '#febc2e'], ['\\u25cf', 'zoom', '#28c840'], ['\\u00d7', 'close', '#ff5f57']];
  for (const [label, verb, color] of btns) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'width:16px;height:16px;border:0;border-radius:50%;' +
      'background:' + color + ';border:1px solid rgba(0,0,0,.18);' +
      'font:9px/1 sans-serif;color:rgba(0,0,0,.55);cursor:pointer';
    b.addEventListener('click', () => window.tiny?.win[verb]());
    bar.appendChild(b);
  }
  document.documentElement.appendChild(bar);
})();
`;

// The unread-badge watcher: mirrors a site element's count to the dock /
// taskbar icon via app.badge (an API tinyjs already has). Missing element =
// clear the badge; an element with no digits counts as 1 (dot-style).
const badgeWatcherSource = (sel) => `
// Unread badge: watch ${JSON.stringify(sel)} and mirror its count to the
// dock / taskbar icon.
(() => {
  const SEL = ${JSON.stringify(sel)};
  let last = null;
  const tick = () => {
    const el = document.querySelector(SEL);
    let n = 0;
    if (el) {
      const m = (el.textContent || '').match(/\\d+/);
      n = m ? +m[0] : 1;
    }
    if (n !== last) { last = n; window.tiny?.app.badge(n ? String(n) : ''); }
  };
  addEventListener('load', tick);
  setInterval(tick, 2000);
})();
`;

// Generated inject.js: drag strip (frameless) + badge watcher, composed into
// one document-start script per project.
function injectSource({ frameless, badge }) {
  let src = '';
  if (frameless) src += DRAG_STRIP;
  if (badge) src += badgeWatcherSource(String(badge).trim());
  return src.trim() || null;
}

// Patch a generated project after the CLI wrote its tinyjs.json: chrome
// keys and the composed inject. A badge needs one exception to the wrapper
// preset — app.badge for the wrapped origins, layered as {preset, enable};
// without a badge the gate stays untouched.
async function applyFinishing(dir, opts) {
  const root = dir.replace(/[\\/]+$/, '');
  const p = root + '/tinyjs.json';
  const cfg = JSON.parse(dec.decode(await tjs.readFile(p)));
  if (opts.frameless) {
    // windowControls:false everywhere — the drag strip injects its own
    // buttons, so no OS shows a second (or floating) set.
    cfg.chrome = { ...(cfg.chrome ?? {}), frame: false, windowControls: false };
  }
  const inj = injectSource(opts);
  if (inj) {
    cfg.inject = 'inject.js';
    await tjs.writeFile(root + '/inject.js', enc.encode(inj));
  }
  if (opts.badge && cfg.api?.origins) {
    for (const [origin, gate] of Object.entries(cfg.api.origins)) {
      if (gate === 'wrapper') cfg.api.origins[origin] = { preset: 'wrapper', enable: ['app.badge'] };
    }
  }
  await tjs.writeFile(p, enc.encode(JSON.stringify(cfg, null, 2) + '\n'));
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
      await applyFinishing(dir, { frameless });
      if (pendingIcon) await writeIcon(dir, pendingIcon);
    }
    return r;
  },

  // tinyjs wrap <url> <dir> — needs a tinyjs with the wrap command. An
  // optional display title overrides the site's own <title>; an optional
  // badge selector mirrors the site's unread count onto the dock icon.
  async wrap({ parent, url, dir, title, ua, frameless, badge }, app) {
    const argv = ['wrap', url, dir];
    if (ua) argv.push('--ua', ua);
    const r = await runStreaming(app, argv, { cwd: parent, label: 'wrap' });
    if (r.code === 0) {
      const root = parent + '/' + dir;
      if (title) await patchTitle(root, title);
      await applyFinishing(root, { frameless, badge });
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
