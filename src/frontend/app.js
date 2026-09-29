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
  state.projects = projects;
  $('projCount').textContent = projects.length ? String(projects.length) : '';
  syncWrapButton();
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
      if (p.url) fillWrapForm(p);
      loadProjects();
    });
    list.appendChild(item);
  }
  renderPreview();
}

// Clicking a wrapped project restores its configuration in the form, so a
// change is just: tweak + Wrap site (the wrap overwrites in place).
function fillWrapForm(p) {
  document.querySelector('.tab[data-tab="wrap"]').click();
  $('wrapUrl').value = p.url;
  $('wrapName').value = p.dir;
  $('wrapTitle').value = p.title ?? '';
  $('wrapUA').value = p.uaPreset ?? 'browser';
  $('wrapBadge').value = p.studio?.badge ?? '';
  $('wrapExternal').value = (p.studio?.external ?? []).join(', ');
  $('wrapFrameless').checked = p.frameless;
  $('wrapMenubar').checked = p.studio?.menubar ?? p.activation === 'accessory';
  $('wrapTray').hidden = !$('wrapMenubar').checked;
  $('wrapTray').value = p.studio?.panel ? 'panel' : 'window';
  $('wrapAlwaysTop').checked = p.studio?.top ?? false;
  renderPreview();
}

// "Wrap site" reads as "Update site" when the folder matches a project.
function syncWrapButton() {
  const dir = $('wrapName').value.trim();
  const known = (state.projects ?? []).some((p) => p.dir === dir);
  $('btnWrap').textContent = known ? 'Update site' : 'Wrap site';
}
$('wrapName').addEventListener('input', syncWrapButton);
$('wrapUrl').addEventListener('input', () => {
  const guess = dirFromUrl($('wrapUrl').value.trim());
  if (guess && !$('wrapName').value) $('wrapName').placeholder = guess;
  syncWrapButton();
});
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
    renderPreview();
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
    const { code } = await tiny.api.call('wrap', wrapParams(dir));
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

// The wrap form is the editor: for a wrapped project, Run APPLIES the form
// first (overwrite in place) and only then launches — so a checkbox flip is
// one click, never "update, then run".
function wrapParams(dir) {
  const menubar = $('wrapMenubar').checked;
  return {
    parent: state.parent,
    url: $('wrapUrl').value.trim(),
    dir,
    title: $('wrapTitle').value.trim() || undefined,
    uaPreset: $('wrapUA').value,
    badge: $('wrapBadge').value.trim() || undefined,
    external: $('wrapExternal').value.trim() || undefined,
    frameless: $('wrapFrameless').checked,
    menubar,
    panel: menubar && $('wrapTray').value === 'panel',
    alwaysTop: $('wrapAlwaysTop').checked,
  };
}

// Menu-bar mode unfolds the tray-click choice; a dropdown panel implies
// frameless (a panel with a titlebar is nonsense).
$('wrapMenubar').addEventListener('change', () => {
  $('wrapTray').hidden = !$('wrapMenubar').checked;
});
$('wrapTray').addEventListener('change', () => {
  if ($('wrapTray').value === 'panel') $('wrapFrameless').checked = true;
});

$('btnRun').addEventListener('click', async () => {
  if (state.running) return;
  busy(true);
  try {
    const p = (state.projects ?? []).find((x) => state.parent + '/' + x.dir === state.project);
    if (p && p.url && $('wrapUrl').value.trim()) {
      log('— applying config —');
      const r = await tiny.api.call('wrap', wrapParams(p.dir));
      if (r.code !== 0) { busy(false); return; }
      loadProjects();
    }
    log('— tinyjs dev —');
    await tiny.api.call('run', { dir: state.project });
  } catch (e) {
    log(String(e.message ?? e), 'err');
    busy(false);
  }
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

$('btnDuplicate').addEventListener('click', async () => {
  try {
    const r = await tiny.api.call('duplicate', { dir: state.project });
    log('duplicated → ' + r.dir, 'ok');
    setProject(r.dir);
    loadProjects();
  } catch (e) {
    log(String(e.message ?? e), 'err');
  }
});

// --- window buttons (Windows/Linux; macOS keeps its traffic lights) -------

$('btnMin').addEventListener('click', () => tiny.win.minimize());
$('btnMax').addEventListener('click', () => tiny.win.zoom());
$('btnClose').addEventListener('click', () => tiny.win.close());

// --- live preview: a fake app window mirroring the active config -----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mockIcon(p, size) {
  const cls = 'mk-icon' + (p?.icon ? '' : ' ph');
  const inner = p?.icon
    ? `<img class="${cls}" style="width:${size}px;height:${size}px" src="${p.icon}" alt="">`
    : `<span class="${cls}" style="width:${size}px;height:${size}px">${esc((p?.title ?? '?')[0].toUpperCase())}</span>`;
  return inner;
}

function mockSite(p, host, badge) {
  return `<div class="mk-content">
    <div class="mk-fav">${mockIcon(p, 34)}${badge ? '<span class="mk-badge">3</span>' : ''}</div>
    <div class="mk-host">${esc(host || 'your site renders here')}</div>
    <div class="mk-skel"></div><div class="mk-skel w70"></div><div class="mk-skel w50"></div>
  </div>`;
}

function mockDots() {
  return '<span class="mk-dots"><i class="d r"></i><i class="d y"></i><i class="d g"></i></span>';
}

function mockWindow({ title, frameless, p, host, badge, floating }) {
  const bar = frameless
    ? `<div class="mk-bar slim">${mockDots()}<span class="mk-btitle">${esc(title)}</span></div>`
    : `<div class="mk-bar">${mockDots()}<span class="mk-btitle">${esc(title)}</span></div>`;
  return `<div class="mk-win${floating ? ' floating' : ''}">${bar}${mockSite(p, host, badge)}</div>`;
}

function mockPanel(p, host, badge) {
  return `<div class="mk-menubar"><span class="mk-clock">9:41</span><span class="mk-tray lit">${mockIcon(p, 15)}</span></div>
  <div class="mk-panel-wrap"><div class="mk-arrow"></div><div class="mk-panel">${mockSite(p, host, badge)}</div></div>`;
}

function mockPhone(p, host, badge) {
  return `<div class="mk-phone"><div class="mk-notch"></div>${mockSite(p, host, badge)}</div>`;
}

function renderPreview() {
  const stage = $('stage');
  if (!stage) return;
  const tab = document.querySelector('.tab.active')?.dataset.tab ?? 'wrap';
  let mk, chips = [];
  if (tab === 'create') {
    const name = $('appTitle').value.trim() || $('appName').value.trim() || 'My App';
    const tpl = $('template').value;
    chips = [$('createFrameless').checked ? 'frameless' : 'titlebar',
      tpl.startsWith('vanilla') ? 'zero dependencies' : 'Vite + npm'];
    mk = mockWindow({
      title: name, frameless: $('createFrameless').checked,
      p: null, host: 'scaffolded from the ' + tpl + ' template', badge: false,
    });
  } else {
    const host = (() => { try { return new URL($('wrapUrl').value.trim()).hostname; } catch { return ''; } })();
    const p = (state.projects ?? []).find((x) => x.dir === $('wrapName').value.trim());
    const menubar = $('wrapMenubar').checked;
    const panel = menubar && $('wrapTray').value === 'panel';
    const frameless = $('wrapFrameless').checked || panel;
    const uaSel = $('wrapUA').selectedOptions[0]?.textContent.split('—')[0].trim();
    if (frameless) chips.push('frameless');
    if (menubar) chips.push(panel ? 'menu bar · panel' : 'menu bar · window');
    if ($('wrapAlwaysTop').checked) chips.push('always on top');
    chips.push('UA: ' + uaSel);
    if ($('wrapBadge').value.trim()) chips.push('unread badge');
    const ext = $('wrapExternal').value.trim();
    if (ext) chips.push('↗ ' + ext.split(',').filter(Boolean).length + ' external');
    const title = $('wrapTitle').value.trim() || host || 'TinyJS App';
    if (ua === 'iphone') mk = mockPhone(p, host, !!$('wrapBadge').value.trim());
    else if (panel) mk = mockPanel(p, host, !!$('wrapBadge').value.trim());
    else mk = mockWindow({
      title, frameless, p, host,
      badge: !!$('wrapBadge').value.trim(),
      floating: $('wrapAlwaysTop').checked,
    });
  }
  stage.innerHTML = mk + `<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>`;
}

['wrapUrl', 'wrapName', 'wrapTitle', 'wrapUA', 'wrapExternal', 'wrapBadge',
  'wrapFrameless', 'wrapMenubar', 'wrapTray', 'wrapAlwaysTop',
  'appName', 'appTitle', 'template', 'createFrameless',
].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', renderPreview);
  el.addEventListener('change', renderPreview);
});

log('TinyJS App Studio ready.', 'ok');
renderPreview();
