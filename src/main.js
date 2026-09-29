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
let wrapSupport = null; // cached wrap probe: true/false (nulled when binPath is)
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

// Does this tinyjs speak `wrap`? The command is newer than most installs —
// and an unknown command still exits 0 (it prints the general help), so the
// probe reads the output: wrap-capable builds answer with their own usage
// line, `usage: tinyjs wrap <url> …`, which the general help never contains.
async function probeWrap(bin) {
  try {
    const p = tjs.spawn(IS_WIN && bin.endsWith('.cmd')
      ? ['cmd.exe', '/c', bin, 'wrap', '--help'] : [bin, 'wrap', '--help'],
      { stdout: 'pipe', stderr: 'ignore' });
    const out = await readAll(p.stdout);
    await p.wait();
    return /usage: tinyjs wrap/.test(out);
  } catch {
    return false;
  }
}

// Everything the status line needs, in one call: found? which bin? version?
// does wrap work? (wrapSupport is cached alongside binPath.)
async function cliStatus() {
  const bin = await findBin();
  if (!bin) return { found: false };
  let version = '';
  try {
    const p = tjs.spawn(IS_WIN && bin.endsWith('.cmd')
      ? ['cmd.exe', '/c', bin, '--version'] : [bin, '--version'],
      { stdout: 'pipe', stderr: 'ignore' });
    version = (await readAll(p.stdout)).trim().split('\n')[0] ?? '';
    await p.wait();
  } catch { }
  if (wrapSupport === null) wrapSupport = await probeWrap(bin);
  return { found: true, bin, version, wrap: wrapSupport };
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
    app.push('cli', { found: false });
    throw new Error('tinyjs CLI not found — hit “Install tinyjs” (official ' +
      'installer, one click), or set TINYJS_BIN');
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

const exists = (p) => tjs.stat(p).then(() => true, () => false);

// Project copy for Duplicate: everything but build artifacts and deps —
// the identity (name, numbered title, unique bundle id) is patched after.
async function copyProject(src, dest) {
  await tjs.makeDir(dest, { recursive: true });
  const iter = await tjs.readDir(src);
  for await (const e of iter) {
    if (['.build', 'dist', 'node_modules', '.DS_Store'].includes(e.name)) continue;
    const s = src + '/' + e.name, d = dest + '/' + e.name;
    if (e.isDirectory) await copyProject(s, d);
    else await tjs.writeFile(d, await tjs.readFile(s));
  }
}

// UA presets. The stock engine UA lacks the "Version/x Safari/x" token, so
// UA-sniffing sites (Google at least) serve the wrapped app a degraded page
// — 'browser' picks a first-class citizen of the current engine: Safari on
// mac/Linux (WebKit), Edge on Windows (Chromium/WebView2).
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

function resolveUA(preset, custom) {
  if (custom) return String(custom);
  if (preset === 'iphone') return SAFARI_IPHONE;
  if (preset === 'browser') return IS_WIN ? EDGE_WIN : SAFARI_MAC;
  return null; // 'engine' — stock UA, no override
}

// A frameless window with no titlebar of its own can't be moved — so
// "frameless" generates this starter inject: a drag strip along the top edge,
// plus window buttons where the OS supplies none (Windows/Linux; macOS gets
// its native traffic lights). document-start, every window.
// Frameless starter inject: a drag strip along the top edge so the window
// moves, optionally with bare window dots in the native traffic-light
// colors (withDots). The native set is hidden via windowControls in
// tinyjs.json. Delete the file + "inject" key once you have your own bar.
const dragStripSource = (withDots) => `(() => {
  const mac = /Mac/i.test(navigator.platform);
  const WITH_DOTS = ${withDots};
  const mount = () => {
    const style = document.createElement('style');
    style.textContent =
      // overscroll-behavior:none kills macOS rubber-band — without it the
      // whole layer tree (fixed strip included) bounces past the top edge.
      'html,body{overscroll-behavior:none!important}' +
      '.tjs-strip{position:fixed;top:0;left:0;right:0;height:40px;z-index:2147483647;' +
      'display:flex;align-items:center;gap:8px;padding:0 16px;' +
      'justify-content:' + (mac ? 'flex-start' : 'flex-end') + '}' +
      (WITH_DOTS ? '.tjs-dot{width:13px;height:13px;padding:0;border-radius:50%;' +
      'border:1px solid rgba(0,0,0,.15);cursor:pointer}' +
      '.tjs-dot:hover{filter:brightness(1.12)}' : '');
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.className = 'tjs-strip';
    bar.setAttribute('data-tiny-drag', '');
    if (WITH_DOTS) {
      const btns = mac
        ? [['Close', 'close', '#ff5f57'], ['Minimize', 'minimize', '#febc2e'], ['Zoom', 'zoom', '#28c840']]
        : [['Minimize', 'minimize', '#febc2e'], ['Zoom', 'zoom', '#28c840'], ['Close', 'close', '#ff5f57']];
      for (const [label, verb, color] of btns) {
        const b = document.createElement('button');
        b.className = 'tjs-dot';
        b.title = label;
        b.style.background = color;
        b.addEventListener('click', () => window.tiny?.win[verb]());
        bar.appendChild(b);
      }
    }
    document.body.appendChild(bar);
  };
  // document-start: <head> doesn't exist yet in WebKit — wait for it.
  if (document.head && document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();`;

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
function injectSource({ frameless, badge, dots = true }) {
  let src = '';
  if (frameless) src += dragStripSource(dots !== false);
  if (badge) src += badgeWatcherSource(String(badge).trim());
  return src.trim() || null;
}

// Patch a generated project after the CLI wrote its tinyjs.json: chrome
// keys, the composed inject, the edit-flow record (badge/external for form
// restore), and the badge's one gate exception. The CLI already persisted
// menubar/top in cfg.studio.
async function applyFinishing(dir, opts) {
  const root = dir.replace(/[\\/]+$/, '');
  const p = root + '/tinyjs.json';
  const cfg = JSON.parse(dec.decode(await tjs.readFile(p)));
  if (opts.frameless) {
    // windowControls:false everywhere — the drag strip injects its own
    // buttons, so no OS shows a second (or floating) set.
    cfg.chrome = { ...(cfg.chrome ?? {}), frame: false, windowControls: false };
  }
  // Panel mode: no inject at all — no drag strip, no window dots (the panel
  // toggles from the tray and dismisses on outside click). A stale inject
  // from a previous frameless generation is removed.
  const inj = opts.panel ? null : injectSource(opts);
  if (inj) {
    cfg.inject = 'inject.js';
    await tjs.writeFile(root + '/inject.js', enc.encode(inj));
  } else if (cfg.inject) {
    delete cfg.inject;
    await tjs.remove(root + '/inject.js').catch(() => { });
  }
  cfg.studio = {
    ...(cfg.studio ?? {}),
    dots: opts.frameless ? opts.dots !== false : null,
    badge: opts.badge ?? null,
    external: opts.external
      ? String(opts.external).split(',').map((s) => s.trim()).filter(Boolean)
      : null,
  };
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
  // Status line: which CLI the Studio will drive, its version, and whether
  // it has the wrap command.
  async resolve() {
    return cliStatus();
  },

  // One-click setup for the packaged app: runs the OFFICIAL tinyjs installer
  // (tinyjs.app) — the same `curl | sh` the site hands out — with every line
  // streamed into the console. Nothing else is touched: the Studio drives the
  // resulting binary by absolute path (~/.tinyjs/tinyjs on macOS/Linux,
  // %LOCALAPPDATA%\tinyjs\tinyjs.cmd on Windows), so no PATH editing is
  // needed for it to work.
  async setup(params, app) {
    if (child) throw new Error('a command is still running — stop it first');
    const cmd = IS_WIN
      ? ['powershell', '-NoProfile', '-Command', 'irm https://tinyjs.app/install.ps1 | iex']
      : ['sh', '-c', 'curl -fsSL https://tinyjs.app/install | sh'];
    app.push('log', '[setup] tinyjs CLI not found — running the official installer (tinyjs.app)');
    app.push('log', '[setup] $ ' + cmd.join(' '));
    const p = tjs.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
    child = p; // Stop can kill the installer like any other command
    pump(app, p.stdout, 'setup');
    pump(app, p.stderr, 'setup');
    const w = await p.wait();
    const code = typeof w === 'object' && w !== null ? (w.exit_status ?? -1) : w;
    child = null;
    app.push('done', { label: 'tinyjs install', code });
    binPath = null;
    wrapSupport = null;
    const s = await cliStatus();
    app.push('cli', s);
    if (!s.found) {
      app.push('log', '[setup] still not found — the installer output above says what missed (on Linux, usually the WebKitGTK runtime).');
      return { installed: false };
    }
    app.push('log', `[setup] the Studio drives ${s.bin} directly — no PATH setup needed. For a terminal ` +
      '`tinyjs`, re-run the installer in a shell so it can add itself to PATH.');
    if (!s.wrap) {
      app.push('log', '[setup] note: this tinyjs release does not have the wrap command yet — ' +
        'Create / Run / Build are fully usable; Wrap activates as soon as your tinyjs has it ' +
        '(or point TINYJS_BIN at a checkout, see README).');
    }
    return { installed: true, bin: s.bin, version: s.version, wrap: s.wrap };
  },

  // tinyjs new <name> — runs inside the chosen projects folder. An optional
  // display title (what the OS shows) is patched into tinyjs.json after.
  async create({ parent, dir, title, template, frameless, dots }, app) {
    const argv = ['new', dir];
    if (template && template !== 'vanilla') argv.push('--template', template);
    const r = await runStreaming(app, argv, { cwd: parent, label: 'create' });
    if (r.code === 0) {
      const root = parent + '/' + dir;
      if (title && title !== dir) await patchTitle(root, title);
      await applyFinishing(root, { frameless, dots });
      if (pendingIcon) await writeIcon(root, pendingIcon);
    }
    return r;
  },

  // tinyjs wrap <url> <dir> — needs a tinyjs with the wrap command. An
  // optional display title overrides the site's own <title>; an optional
  // badge selector mirrors the site's unread count onto the dock icon; the
  // UA preset ('browser' | 'iphone' | 'engine') counters UA-sniffing.
  async wrap({ parent, url, dir, title, ua, uaPreset, frameless, badge, menubar, alwaysTop, external, panel, dots }, app) {
    const argv = ['wrap', url, dir, '--force']; // the Studio edits in place
    const resolved = resolveUA(uaPreset, ua);
    if (resolved) argv.push('--ua', resolved);
    if (menubar) argv.push('--menubar');
    if (panel) argv.push('--panel');
    if (alwaysTop) argv.push('--top');
    if (external) argv.push('--external', String(external));
    const r = await runStreaming(app, argv, { cwd: parent, label: 'wrap' });
    if (r.code === 0) {
      const root = parent + '/' + dir;
      if (title) await patchTitle(root, title);
      await applyFinishing(root, { frameless, badge, external, panel, dots });
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
  async build({ dir, target }, app) {
    const argv = ['build'];
    // arch/universal/dmg targets are macOS-only — other platforms build
    // natively for themselves and the flags are ignored.
    if (!IS_WIN && !IS_LINUX) {
      if (target === 'arm64') argv.push('--arch', 'arm64');
      else if (target === 'x86_64') argv.push('--arch', 'x86_64');
      else if (target === 'universal') argv.push('--universal');
      else if (target === 'universal-dmg') argv.push('--universal', '--dmg');
      else if (target === 'dmg') argv.push('--dmg');
    }
    return runStreaming(app, argv, { cwd: dir, label: 'build' });
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
  async listProjects(params, app) {
    const parent = params.parent;
    const projects = [];
    const pushProject = async (abs, dir, cfg) => {
      let icon = null;
      try {
        const bytes = new Uint8Array(await tjs.readFile(abs + '/icon.png'));
        if (bytes.length <= 512 * 1024) icon = 'data:image/png;base64,' + toBase64(bytes);
      } catch { }
      // uaPreset reverse-maps the stored UA back to the form's select so
      // a project click restores the exact wrap configuration.
      const ua = cfg.userAgent ?? null;
      projects.push({
        dir,
        abs,
        title: cfg.title ?? cfg.name ?? dir,
        url: cfg.url ?? null,
        icon,
        uaPreset: ua === null ? 'engine'
          : ua === SAFARI_MAC || ua === EDGE_WIN ? 'browser'
          : ua === SAFARI_IPHONE ? 'iphone' : 'browser',
        frameless: cfg.chrome?.frame === false,
        studio: cfg.studio ?? {},
        activation: cfg.activation ?? null,
        external: abs !== parent + '/' + dir,
      });
    };
    try {
      const iter = await tjs.readDir(parent);
      for await (const e of iter) {
        if (!e.isDirectory || e.name.startsWith('.')) continue;
        try {
          const cfg = JSON.parse(dec.decode(await tjs.readFile(parent + '/' + e.name + '/tinyjs.json')));
          await pushProject(parent + '/' + e.name, e.name, cfg);
        } catch { /* a folder without tinyjs.json isn't a project */ }
      }
    } catch { /* folder gone since it was picked */ }
    // Projects opened from anywhere on disk (persisted "Open…" picks).
    const externals = ((await app.store.get('studio.external')) ?? [])
      .filter((d) => !parent || !d.startsWith(parent + '/'));
    for (const abs of externals) {
      try {
        const cfg = JSON.parse(dec.decode(await tjs.readFile(abs + '/tinyjs.json')));
        await pushProject(abs, abs.split(/[\\/]/).pop(), cfg);
      } catch { /* the folder vanished — drop it silently */ }
    }
    projects.sort((a, b) => a.title.localeCompare(b.title));
    return { projects };
  },

  // Duplicate a project next to itself: -2, -3, … first free suffix. The
  // copy gets its own name/title/bundle id, so two wraps of the same site
  // run side by side as separate containers — the multi-account play.
  async duplicate({ dir }) {
    const root = dir.replace(/[\\/]+$/, '');
    const sep = root.includes('/') ? '/' : '\\';
    const parent = root.slice(0, root.lastIndexOf(sep));
    const base = root.slice(root.lastIndexOf(sep) + 1);
    let n = 1, name, target;
    do {
      n++;
      name = base + '-' + n;
      target = parent + sep + name;
    } while (await exists(target));
    await copyProject(root, target);
    const cfgPath = target + sep + 'tinyjs.json';
    const cfg = JSON.parse(dec.decode(await tjs.readFile(cfgPath)));
    cfg.name = name;
    cfg.title = (cfg.title ?? base) + ' ' + n;
    if (cfg.id) cfg.id = cfg.id + n;
    await tjs.writeFile(cfgPath, enc.encode(JSON.stringify(cfg, null, 2) + '\n'));
    return { dir: target, title: cfg.title };
  },

  // Open an EXISTING tinyjs project anywhere on disk: validated, then kept
  // in the store so it lists alongside the folder's projects (no files are
  // moved or copied).
  async addExisting(params, app) {
    const dir = params.dir;
    const root = String(dir ?? '').replace(/[\\/]+$/, '');
    const p = root + '/tinyjs.json';
    let cfg;
    try {
      cfg = JSON.parse(dec.decode(await tjs.readFile(p)));
    } catch {
      throw new Error('not a tinyjs project — no tinyjs.json in that folder');
    }
    const list = ((await app.store.get('studio.external')) ?? [])
      .filter((d) => d !== root && d !== root + '/' && d !== root + '\\');
    list.push(root);
    await app.store.set('studio.external', list);
    return { dir: root, title: cfg.title ?? cfg.name ?? root.split('/').pop() };
  },

  async removeExternal(params, app) {
    const dir = params.dir;
    const list = ((await app.store.get('studio.external')) ?? []).filter((d) => d !== dir);
    await app.store.set('studio.external', list);
    return true;
  },

  // Mini file explorer: recursive listing of a project (artifacts skipped,
  // 3 levels deep) — the sidebar renders it as an expandable tree.
  async listFiles({ dir }) {
    const files = [];
    const skip = ['.build', 'dist', 'node_modules', '.DS_Store'];
    const walk = async (abs, rel, depth) => {
      if (depth > 2) return;
      const iter = await tjs.readDir(abs);
      for await (const e of iter) {
        if (e.name.startsWith('.') || skip.includes(e.name)) continue;
        const r = rel ? rel + '/' + e.name : e.name;
        const p = abs + '/' + e.name;
        if (e.isDirectory) {
          files.push({ rel: r, dir: true, depth, size: 0 });
          await walk(p, r, depth + 1);
        } else {
          let size = 0;
          try { size = (await tjs.stat(p)).size; } catch { }
          files.push({ rel: r, dir: false, depth, size });
        }
      }
    };
    try { await walk(dir.replace(/[\\/]+$/, ''), '', 0); } catch { }
    return { files };
  },

  // Open a file or folder with the OS default app (the "editor" path for
  // generated projects — the Studio stays read-only by design).
  async openPath({ path }) {
    const argv = IS_WIN ? ['explorer.exe', path]
      : IS_LINUX ? ['xdg-open', path]
      : ['open', path];
    tjs.spawn(argv, { stdout: 'ignore', stderr: 'ignore' });
    return true;
  },

  // Read a file for the offcanvas: text for code, inline dataUrl for images.
  async readFile({ path }) {
    const ext = String(path).split('.').pop().toLowerCase();
    const bytes = new Uint8Array(await tjs.readFile(path));
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
      if (bytes.length > 2 * 1048576) throw new Error('image over 2 MB — open it externally');
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon' }[ext] ?? 'image/' + ext;
      return { kind: 'image', dataUrl: `data:${mime};base64,${toBase64(bytes)}` };
    }
    if (bytes.length > 512 * 1024) return { kind: 'toolarge', size: bytes.length };
    return { kind: 'text', text: dec.decode(bytes), size: bytes.length };
  },

  async writeFile({ path, text }) {
    await tjs.writeFile(path, enc.encode(String(text ?? '')));
    return true;
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

export async function init(app) {
  app.push('ready', { version: tjs.version });
  // First status broadcast — the page also calls resolve() itself, this is
  // the belt to those braces.
  try { app.push('cli', await cliStatus()); } catch { }
}
export function onWindowClosed() {
  // dev child dies with us — txiki tears the process group down.
}
