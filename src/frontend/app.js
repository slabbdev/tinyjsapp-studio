// TinyJS Studio frontend — thin UI over the backend's api calls. All the
// heavy lifting (spawning, streaming) lives in the backend; this file only
// collects inputs, renders the log, and keeps buttons honest.

const $ = (id) => document.getElementById(id);

const isMac = tiny.system.isMacOS();
document.body.classList.toggle('mac', isMac);

const state = {
  parent: null,   // where new projects are created
  project: null,  // the project run/build/reveal act on
  source: 'wrap', // what the inspector generates: 'wrap' (a URL) | 'create' (a template)
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
  $('btnGenerate').disabled = b;
  $('btnStop').disabled = !b;
};

// The CLI is resolved lazily by the backend on first use — no status line.
// If it's missing, create/wrap surface a readable error in the console.

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
      const sel = state.parent + '/' + p.dir;
      if (state.project === sel && state.expanded === p.dir) state.expanded = null;
      else state.expanded = p.dir;
      setProject(sel);
      if (p.url) fillWrapForm(p);
      loadProjects();
    });
    list.appendChild(item);

    // expanded project: its file tree under the card — click opens with the
    // OS default app (the Studio stays read-only by design).
    if (state.expanded === p.dir) {
      const { files } = await tiny.api.call('listFiles', {
        dir: state.parent + '/' + p.dir,
      });
      for (const f of files) {
        const row = document.createElement('button');
        row.className = 'file-item';
        row.style.paddingLeft = (14 + f.depth * 14) + 'px';
        row.innerHTML = `${f.dir
          ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M1.8 3.2h4.4l1.6 1.8h6.4v7.8H1.8z"/></svg>'
          : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.5 1.8h5.4l3.3 3.3v9.1h-8.7z"/></svg>'
        }<span class="fn"></span>${f.dir ? '' : `<span class="fs">${fmtSize(f.size)}</span>`}`;
        row.querySelector('.fn').textContent = f.rel.split('/').pop();
        row.addEventListener('click', () => {
          const ext = f.rel.split('.').pop().toLowerCase();
          const path = `${state.parent}/${p.dir}/${f.rel}`;
          if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'js', 'ts', 'html', 'css', 'json', 'md', 'txt'].includes(ext)) {
            openFileCanvas(path);
          } else {
            tiny.api.call('openPath', { path });
          }
        });
        list.appendChild(row);
      }
    }
  }
  renderPreview();
}

const fmtSize = (n) => n < 1024 ? n + ' B'
  : n < 1048576 ? (n / 1024).toFixed(1) + ' KB'
  : (n / 1048576).toFixed(1) + ' MB';

// Clicking a wrapped project restores its configuration in the form, so a
// change is just: tweak + Wrap site (the wrap overwrites in place).
function fillWrapForm(p) {
  state.source = 'wrap';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'wrap'));
  $('wrapUrl').value = p.url;
  $('wrapName').value = p.dir;
  $('wrapTitle').value = p.title ?? '';
  $('wrapUA').value = p.uaPreset ?? 'browser';
  $('wrapFrameless').checked = p.frameless;
  $('wrapMenubar').checked = p.studio?.menubar ?? p.activation === 'accessory';
  $('wrapTray').hidden = !$('wrapMenubar').checked;
  $('wrapTray').value = p.studio?.panel ? 'panel' : 'window';
  $('wrapDots').value = p.studio?.dots === false ? 'none' : 'dots';
  $('dotsField').hidden = !p.frameless || (p.studio?.panel ?? false);
  $('wrapAlwaysTop').checked = p.studio?.top ?? false;
  // the icon preview mirrors the selected project's own icon
  $('iconPrev').innerHTML = p.icon ? `<img src="${p.icon}" alt="">` : 'auto';
  renderPreview();
}
// note: badge/external live in the project (tinyjs.json studio{}) but stay
// out of the UI for now — the CLI flags remain the power path.

// "Wrap site" reads as "Update site" when the folder matches a project.
function syncWrapButton() {
  const dir = $('wrapName').value.trim();
  const known = (state.projects ?? []).some((p) => p.dir === dir);
  const noun = state.source === 'wrap' ? 'site' : 'project';
  $('btnGenerate').textContent = known ? 'Update ' + noun
    : state.source === 'wrap' ? 'Wrap site' : 'Create project';
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
    state.source = tab.dataset.tab;
    syncSubChoices();
    syncWrapButton();
    renderPreview();
  });
});

// --- generate: one flow, two sources (a URL to wrap, a template to scaffold)

const dirFromUrl = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
      .replace(/[^a-zA-Z0-9.-]/g, '').replace(/\./g, '-');
  } catch { return ''; }
};

function collectConfig(dirOverride) {
  const wrap = state.source === 'wrap';
  const url = $('wrapUrl').value.trim();
  const dir = $('wrapName').value.trim()
    || (wrap ? dirFromUrl(url) : 'my-app');
  const frameless = $('wrapFrameless').checked;
  const menubar = wrap && $('wrapMenubar').checked;
  return {
    source: state.source,
    parent: state.parent,
    url: wrap ? url : undefined,
    template: wrap ? undefined : $('template').value,
    dir: dirOverride ?? dir,
    title: $('wrapTitle').value.trim() || undefined,
    uaPreset: wrap ? $('wrapUA').value : undefined,
    frameless,
    dots: frameless && $('wrapDots').value !== 'none',
    menubar,
    panel: menubar && $('wrapTray').value === 'panel',
    alwaysTop: wrap ? $('wrapAlwaysTop').checked : undefined,
  };
}

$('btnGenerate').addEventListener('click', async () => {
  if (state.running) return;
  const cfg = collectConfig();
  if (!state.parent) return log('pick a projects folder first', 'err');
  if (cfg.source === 'wrap') {
    if (!/^https?:\/\//.test(cfg.url)) return log('need a http(s) URL', 'err');
    if (!cfg.dir) return log('cannot derive a folder name from that URL', 'err');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(cfg.dir)) {
    return log('folder name: letters, digits, - and _ only', 'err');
  }
  busy(true);
  log(`— ${cfg.source === 'wrap' ? 'tinyjs wrap ' + cfg.url : 'tinyjs new ' + cfg.dir} —`);
  try {
    const { code } = await tiny.api.call(cfg.source, cfg);
    if (code === 0) {
      setProject(state.parent + '/' + cfg.dir);
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
// Sub-choices unfold with their parents, and the source decides which
// sections show: window modes and UA are wrap-only.
function syncSubChoices() {
  const wrap = state.source === 'wrap';
  const menubar = wrap && $('wrapMenubar').checked;
  const panel = menubar && $('wrapTray').value === 'panel';
  const frameless = $('wrapFrameless').checked;
  $('urlField').hidden = !wrap;
  $('tplField').hidden = wrap;
  document.querySelectorAll('.wrap-only').forEach((el) => { el.hidden = !wrap; });
  $('wrapTray').hidden = !menubar;
  $('dotsField').hidden = !frameless || panel;
  if (panel) $('wrapFrameless').checked = true;
}
$('wrapMenubar').addEventListener('change', syncSubChoices);
$('wrapTray').addEventListener('change', () => {
  syncSubChoices();
  if ($('wrapTray').value === 'panel') $('wrapFrameless').checked = true;
});
$('wrapFrameless').addEventListener('change', syncSubChoices);
$('wrapTray').addEventListener('change', () => {
  if ($('wrapTray').value === 'panel') $('wrapFrameless').checked = true;
});

// + New: clear the form for the active source, deselect — fresh start.
$('btnNew').addEventListener('click', () => {
  $('wrapUrl').value = '';
  $('wrapName').value = '';
  $('wrapName').placeholder = 'auto';
  $('wrapTitle').value = '';
  $('wrapUA').value = 'browser';
  $('wrapFrameless').checked = true;
  $('wrapDots').value = 'dots';
  $('wrapMenubar').checked = false;
  $('wrapTray').value = 'window';
  $('wrapAlwaysTop').checked = false;
  $('iconPrev').textContent = 'auto';
  state.project = null;
  $('project').hidden = true;
  syncSubChoices();
  syncWrapButton();
  renderPreview();
  log('— fresh ' + (state.source === 'wrap' ? 'wrap' : 'app') + ' — fill the form and go', 'ok');
});

$('btnRun').addEventListener('click', async () => {
  if (state.running) return;
  if (!state.project) { log('select a project or fill the form first', 'err'); return; }
  busy(true);
  try {
    const p = (state.projects ?? []).find((x) => state.parent + '/' + x.dir === state.project);
    if (p && p.url && $('wrapUrl').value.trim()) {
      log('— applying config —');
      const r = await tiny.api.call('wrap', collectConfig(p.dir));
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

function mockWindow({ title, frameless, dots = true, p, host, badge, floating }) {
  // frameless + no buttons = the REAL app has no bar at all: the invisible
  // drag strip sits over the site, which owns every visible pixel.
  const bar = !frameless
    ? `<div class="mk-bar">${mockDots()}<span class="mk-btitle">${esc(title)}</span></div>`
    : dots
      ? `<div class="mk-bar slim">${mockDots()}<span class="mk-btitle">${esc(title)}</span></div>`
      : '';
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
  const wrap = state.source === 'wrap';
  let mk, chips = [];
  if (!wrap) {
    const name = $('wrapTitle').value.trim() || $('wrapName').value.trim() || 'My App';
    const tpl = $('template').value;
    const fr = $('wrapFrameless').checked;
    chips = [fr ? 'frameless' : 'titlebar',
      fr && $('wrapDots').value !== 'none' ? 'window dots' : 'no buttons',
      tpl.startsWith('vanilla') ? 'zero dependencies' : 'Vite + npm'];
    mk = mockWindow({
      title: name, frameless: fr, dots: fr && $('wrapDots').value !== 'none',
      p: null, host: 'scaffolded from the ' + tpl + ' template',
    });
  } else {
    const host = (() => { try { return new URL($('wrapUrl').value.trim()).hostname; } catch { return ''; } })();
    const p = (state.projects ?? []).find((x) => x.dir === $('wrapName').value.trim());
    const menubar = $('wrapMenubar').checked;
    const panel = menubar && $('wrapTray').value === 'panel';
    const frameless = $('wrapFrameless').checked || panel;
    const dots = $('wrapDots').value !== 'none';
    const ua = $('wrapUA').value;
    const uaSel = $('wrapUA').selectedOptions[0]?.textContent.split('—')[0].trim();
    if (frameless) chips.push(frameless && !dots ? 'frameless · no buttons' : 'frameless');
    if (menubar) chips.push(panel ? 'menu bar · panel' : 'menu bar · window');
    if ($('wrapAlwaysTop').checked) chips.push('always on top');
    chips.push('UA: ' + uaSel);
    const title = $('wrapTitle').value.trim() || host || 'TinyJS App';
    if (ua === 'iphone') mk = mockPhone(p, host);
    else if (panel) mk = mockPanel(p, host);
    else mk = mockWindow({
      title, frameless, dots: frameless && dots, p, host,
      floating: $('wrapAlwaysTop').checked,
    });
  }
  stage.innerHTML = mk + `<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>`;
}

['wrapUrl', 'wrapName', 'wrapTitle', 'wrapUA', 'wrapDots',
  'wrapFrameless', 'wrapMenubar', 'wrapTray', 'wrapAlwaysTop', 'template',
].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', renderPreview);
  el.addEventListener('change', renderPreview);
});

// Custom right-click menu: no WebKit defaults, just the two credits.
tiny.menu.setContext([
  { id: 'github', label: 'Show on GitHub' },
  { separator: true },
  { id: 'made', label: 'Made with ❤️ and tinyjs', enabled: false },
]);
tiny.menu.onContext((id) => {
  if (id === 'github') tiny.app.shell.open('https://github.com/slabbdev/tinyjsapp-studio');
});

// --- file offcanvas: preview images, edit code ------------------------------

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'];
const TEXT_EXT = ['js', 'ts', 'html', 'css', 'json', 'md', 'txt'];
let ocState = { path: null, dirty: false, ext: null };

function hlCode(code, ext) {
  const KW = 'const|let|var|function|return|if|else|for|while|import|from|export|await|async|class|new|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|of|in|delete|void|this|super|extends|default|true|false|null';
  let re;
  if (ext === 'html' || ext === 'svg') {
    re = /(<!--[\s\S]*?-->)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(<\/?[a-zA-Z][^\s>]*|\/?>)|(\b\d+\b)/g;
  } else if (ext === 'css') {
    re = /(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([.#]?[a-zA-Z-]+(?=\s*:))|(\b\d+(?:\.\d+)?(?:px|em|rem|%|s|ms|vh|vw)?\b)/g;
  } else {
    re = new RegExp('(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)'
      + '|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)'
      + '|\\b(' + (ext === 'json' ? 'true|false|null' : KW) + ')\\b'
      + '|\\b(\\d+(?:\\.\\d+)?)\\b', 'g');
  }
  let out = '', last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] !== undefined ? 'c' : m[2] !== undefined ? 's' : m[3] !== undefined ? 'k' : 'n';
    out += `<span class="tk-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  out += esc(code.slice(last));
  return out;
}

async function openFileCanvas(path) {
  const r = await tiny.api.call('readFile', { path }).catch((e) => ({ error: String(e.message ?? e) }));
  ocState = { path, dirty: false, ext: path.split('.').pop().toLowerCase() };
  $('ocName').textContent = path.split('/').pop();
  $('ocName').classList.remove('dirty');
  const body = $('ocBody');
  if (r.error) { body.innerHTML = `<p class="hint" style="padding:16px">${esc(r.error)}</p>`; $('ocSave').hidden = true; }
  else if (r.kind === 'image') {
    body.innerHTML = `<div class="oc-img"><img src="${r.dataUrl}" alt=""></div>`;
    $('ocSave').hidden = true;
  } else if (r.kind === 'toolarge') {
    body.innerHTML = `<p class="hint" style="padding:16px">${Math.round(r.size / 1024)} KB — too big to edit here, opening externally instead.</p>`;
    $('ocSave').hidden = true;
    tiny.api.call('openPath', { path });
  } else {
    $('ocSave').hidden = false;
    body.innerHTML = '<div class="ed-wrap"><pre class="ed-hl"><code id="ocHl"></code></pre><textarea id="ocTa" spellcheck="false"></textarea></div>';
    const ta = $('ocTa');
    ta.value = r.text;
    const paint = () => { $('ocHl').innerHTML = hlCode(ta.value, ocState.ext) + '\n'; };
    ta.addEventListener('input', () => { ocState.dirty = true; $('ocName').classList.add('dirty'); paint(); });
    ta.addEventListener('scroll', () => {
      const pre = $('ocHl').parentElement;
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart, epos = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(epos);
        ta.selectionStart = ta.selectionEnd = s + 2;
        ta.dispatchEvent(new Event('input'));
      }
    });
    paint();
  }
  requestAnimationFrame(() => $('fileCanvas').classList.add('open'));
}

function closeFileCanvas() {
  $('fileCanvas').classList.remove('open');
  ocState = { path: null, dirty: false, ext: null };
}

async function saveFileCanvas() {
  const ta = $('ocTa');
  if (!ta) return;
  await tiny.api.call('writeFile', { path: ocState.path, text: ta.value });
  ocState.dirty = false;
  $('ocName').classList.remove('dirty');
  log('saved ' + ocState.path.split('/').pop(), 'ok');
}

$('ocSave').addEventListener('click', saveFileCanvas);
$('ocClose').addEventListener('click', async () => {
  if (ocState.dirty && !confirm('Discard unsaved changes?')) return;
  closeFileCanvas();
});
document.addEventListener('keydown', (e) => {
  if (!$('fileCanvas').classList.contains('open')) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveFileCanvas(); }
  if (e.key === 'Escape' && !ocState.dirty) closeFileCanvas();
});

log('TinyJS App Studio ready.', 'ok');
renderPreview();
