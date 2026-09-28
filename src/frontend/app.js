// TinyJS Studio frontend — thin UI over the backend's api calls. All the
// heavy lifting (spawning, streaming) lives in the backend; this file only
// collects inputs, renders the log, and keeps buttons honest.

const $ = (id) => document.getElementById(id);

const isMac = tiny.system.isMacOS();
document.body.classList.toggle('mac', isMac);

// Titlebar preference, persisted: 'frameless' (default) or 'native'. The
// tinyjs.json chrome is the pre-paint default; this applies the stored
// choice on load and toggles live afterwards.
let titlebar = (await tiny.store.get('titlebar')) === 'native' ? 'native' : 'frameless';
async function applyTitlebar() {
  const native = titlebar === 'native';
  document.body.classList.toggle('bar', native);
  $('btnTitlebar').textContent = native ? 'Titlebar: shown' : 'Titlebar: hidden';
  await tiny.win.setChrome(native
    ? { frame: true }
    : { frame: false, windowControls: isMac });
}
await applyTitlebar();

const state = {
  parent: null,   // where new projects are created
  project: null,  // the project run/build/reveal act on
  running: false,
};

function log(line, cls) {
  const el = $('log');
  if (el.classList.contains('muted')) {
    el.textContent = '';
    el.classList.remove('muted');
  }
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = line + '\n';
  el.appendChild(span);
  while (el.childNodes.length > 600) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

const busy = (b) => {
  state.running = b;
  $('btnRun').disabled = b;
  $('btnWrap').disabled = b;
  $('btnCreate').disabled = b;
  $('btnStop').disabled = !b;
};

// --- status: which CLI will the Studio drive? ----------------------------

(async () => {
  const r = await tiny.api.call('resolve');
  const el = $('status');
  if (!r.found) {
    el.textContent = 'tinyjs CLI not found — install it (tinyjs.app) or set TINYJS_BIN';
    el.classList.add('bad');
    return;
  }
  el.textContent = `tinyjs ${r.version || '?'} — ${r.bin}`;
  el.classList.add('ok');
})();

tiny.api.on('log', (line) => log(line));
tiny.api.on('done', ({ label, code }) => {
  busy(false);
  log(`— ${label} finished (exit ${code ?? '?'}) —`, code === 0 ? 'ok' : 'err');
});

// --- shared: projects folder ---------------------------------------------

$('pickFolder').addEventListener('click', async () => {
  const dir = await tiny.dialog.pickFolder();
  if (!dir) return;
  state.parent = dir;
  $('folderPath').textContent = dir;
  $('folderPath').classList.remove('muted');
});

// --- tabs ------------------------------------------------------------------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $('tab-create').hidden = tab.dataset.tab !== 'create';
    $('tab-wrap').hidden = tab.dataset.tab !== 'wrap';
  });
});

// --- create ----------------------------------------------------------------

$('btnCreate').addEventListener('click', async () => {
  if (state.running) return;
  const name = $('appName').value.trim();
  if (!state.parent) return log('pick a projects folder first', 'err');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return log('app name: letters, digits, - and _ only', 'err');
  busy(true);
  log(`— tinyjs new ${name} —`);
  try {
    const { code } = await tiny.api.call('create', {
      parent: state.parent, name, template: $('template').value,
    });
    if (code === 0) setProject(state.parent + '/' + name);
  } catch (e) {
    log(String(e.message ?? e), 'err');
    busy(false);
  }
});

// --- wrap --------------------------------------------------------------------

const dirFromUrl = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
      .replace(/[^a-zA-Z0-9.-]/g, '').replace(/\./g, '-');
  } catch { return ''; }
};

$('wrapUrl').addEventListener('input', () => {
  const guess = dirFromUrl($('wrapUrl').value.trim());
  if (guess) $('wrapName').placeholder = guess;
});

$('btnWrap').addEventListener('click', async () => {
  if (state.running) return;
  const url = $('wrapUrl').value.trim();
  if (!state.parent) return log('pick a projects folder first', 'err');
  if (!/^https?:\/\//.test(url)) return log('need a http(s) URL', 'err');
  const dir = $('wrapName').value.trim() || dirFromUrl(url);
  if (!dir) return log('cannot derive a folder name from that URL', 'err');
  busy(true);
  log(`— tinyjs wrap ${url} —`);
  try {
    const { code } = await tiny.api.call('wrap', { parent: state.parent, url, dir });
    if (code === 0) setProject(state.parent + '/' + dir);
  } catch (e) {
    log(String(e.message ?? e), 'err');
    busy(false);
  }
});

// --- project actions ---------------------------------------------------------

function setProject(dir) {
  state.project = dir;
  $('projPath').textContent = dir;
  $('project').hidden = false;
  busy(false);
}

$('btnRun').addEventListener('click', async () => {
  if (state.running) return;
  busy(true);
  log('— tinyjs dev —');
  try { await tiny.api.call('run', { dir: state.project }); }
  catch (e) { log(String(e.message ?? e), 'err'); busy(false); }
});

$('btnStop').addEventListener('click', () => tiny.api.call('stop'));

$('btnBuild').addEventListener('click', async () => {
  if (state.running) return;
  busy(true);
  log('— tinyjs build —');
  try { await tiny.api.call('build', { dir: state.project }); }
  catch (e) { log(String(e.message ?? e), 'err'); busy(false); }
});

$('btnReveal').addEventListener('click', () => tiny.api.call('reveal', { dir: state.project }));

// --- window buttons (Windows/Linux; macOS keeps its traffic lights) -------

$('btnTitlebar').addEventListener('click', async () => {
  titlebar = titlebar === 'native' ? 'frameless' : 'native';
  await tiny.store.set('titlebar', titlebar);
  await applyTitlebar();
});

$('btnMin').addEventListener('click', () => tiny.win.minimize());
$('btnMax').addEventListener('click', () => tiny.win.zoom());
$('btnClose').addEventListener('click', () => tiny.win.close());

log('TinyJS Studio ready.', 'ok');
