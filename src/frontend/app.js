// TinyJS Studio frontend — thin UI over the backend's api calls. All the
// heavy lifting (spawning, streaming) lives in the backend; this file only
// collects inputs, renders the log, and keeps buttons honest.

const $ = (id) => document.getElementById(id);

const isMac = tiny.system.isMacOS();
document.body.classList.toggle('mac', isMac);

// Frameless preference for GENERATED projects, persisted. Frameless writes
// chrome + a drag-strip inject into the project (see backend).
function setFrameless(v) {
  $('wrapFrameless').checked = v;
  $('createFrameless').checked = v;
  tiny.store.set('studio.frameless', v);
}
(async () => {
  if ((await tiny.store.get('studio.frameless')) === false) setFrameless(false);
})();
$('wrapFrameless').addEventListener('change', () => setFrameless($('wrapFrameless').checked));
$('createFrameless').addEventListener('change', () => setFrameless($('createFrameless').checked));

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
  span.className = cls ?? (line.startsWith('[err]') ? 'err' : undefined);
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

// --- shared: projects folder (remembered) + project icon -------------------

(async () => {
  const { path } = await tiny.api.call('loadFolder');
  if (!path) return;
  state.parent = path;
  $('folderPath').textContent = path;
  $('folderPath').classList.remove('muted');
  loadProjects();
})();

$('pickFolder').addEventListener('click', async () => {
  const dir = await tiny.dialog.pickFolder();
  if (!dir) return;
  state.parent = dir;
  $('folderPath').textContent = dir;
  $('folderPath').classList.remove('muted');
  tiny.api.call('saveFolder', { path: dir });
  loadProjects();
});

// --- your projects: every tinyjs project in the chosen folder --------------

async function loadProjects() {
  const list = $('projList');
  list.innerHTML = '';
  const { projects } = state.parent
    ? await tiny.api.call('listProjects', { parent: state.parent })
    : { projects: [] };
  $('projCount').textContent = projects.length ? String(projects.length) : '';
  if (!projects.length) {
    const empty = document.createElement('div');
    empty.className = 'side-empty muted';
    empty.textContent = state.parent ? 'no projects here yet' : 'choose a folder first';
    list.appendChild(empty);
    return;
  }
  for (const p of projects) {
    const item = document.createElement('button');
    item.className = 'proj-item' + (state.project === state.parent + '/' + p.dir ? ' active' : '');
    const visual = p.icon
      ? `<img src="${p.icon}" alt="">`
      : `<span class="ph">${(p.title[0] ?? '?').toUpperCase()}</span>`;
    item.innerHTML = `${visual}<span class="txt"><span class="t"></span><span class="s"></span></span>`;
    item.querySelector('.t').textContent = p.title;
    item.querySelector('.s').textContent = p.url
      ? new URL(p.url).hostname : 'local app';
    item.addEventListener('click', () => {
      setProject(state.parent + '/' + p.dir);
      loadProjects();
    });
    list.appendChild(item);
  }
}
$('btnRescan').addEventListener('click', loadProjects);

async function chooseIcon(dir) {
  const file = await tiny.dialog.openFile({ types: ['png', 'ico'] });
  if (!file) return;
  try {
    const { dataUrl } = await tiny.api.call('setIcon', dir ? { path: file, dir } : { path: file });
    $('iconPrev').innerHTML = `<img src="${dataUrl}" alt="">`;
    log(dir ? 'icon written to the project' :
      'icon ready — it will be used by the next project you create or wrap', 'ok');
  } catch (e) {
    log(String(e.message ?? e), 'err');
  }
}
$('btnIconPick').addEventListener('click', () => chooseIcon());
$('btnIconProject').addEventListener('click', () => state.project && chooseIcon(state.project));

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
      parent: state.parent, name,
      title: $('appTitle').value.trim() || undefined,
      template: $('template').value,
      frameless: $('createFrameless').checked,
    });
    if (code === 0) {
      setProject(state.parent + '/' + name);
      loadProjects();
    }
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
    const { code } = await tiny.api.call('wrap', {
      parent: state.parent, url, dir,
      title: $('wrapTitle').value.trim() || undefined,
      uaPreset: $('wrapUA').value,
      badge: $('wrapBadge').value.trim() || undefined,
      frameless: $('wrapFrameless').checked,
    });
    if (code === 0) {
      setProject(state.parent + '/' + dir);
      loadProjects();
    }
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

$('btnMin').addEventListener('click', () => tiny.win.minimize());
$('btnMax').addEventListener('click', () => tiny.win.zoom());
$('btnClose').addEventListener('click', () => tiny.win.close());

log('TinyJS App Studio ready.', 'ok');
