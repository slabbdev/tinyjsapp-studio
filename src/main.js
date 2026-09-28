// TinyJS Studio backend — a thin, honest shell around the tinyjs CLI.
//
// Everything the Studio does, it does by spawning the real `tinyjs`
// commands and streaming their output to the window. No hidden logic, no
// reimplementation: if `tinyjs new` would print it, you see it.

const IS_WIN = tjs.env.OS === 'Windows_NT';
const IS_LINUX = tjs.env.OS === 'Linux';

let binPath = null; // resolved once, cached
let child = null; // the one long-running command (dev), if any

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

  // tinyjs new <name> — runs inside the chosen projects folder.
  async create({ parent, name, template }, app) {
    const argv = ['new', name];
    if (template && template !== 'vanilla') argv.push('--template', template);
    return runStreaming(app, argv, { cwd: parent, label: 'create' });
  },

  // tinyjs wrap <url> <dir> — needs a tinyjs with the wrap command.
  async wrap({ parent, url, dir, ua }, app) {
    const argv = ['wrap', url, dir];
    if (ua) argv.push('--ua', ua);
    return runStreaming(app, argv, { cwd: parent, label: 'wrap' });
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
