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
  cli: null,        // last CLI status from the backend: {found, bin, version, wrap}
  setupRunning: false,
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

// --- CLI status line + one-click setup --------------------------------------
// The backend broadcasts 'cli' whenever the resolution changes (boot, after
// setup, after a failed command); the page also resolves once on load.

const isWin = /Win/.test(navigator.platform);

function renderCli(s) {
  if (!s) return;
  const was = state.cli;
  state.cli = s;
  const el = $('cliStatus');
  el.classList.remove('ok', 'bad');
  if (!s.found) {
    el.textContent = 'tinyjs: not found';
    el.classList.add('bad');
  } else {
    el.textContent = 'tinyjs ' + (s.version || '?') +
      (s.wrap ? '' : ' · wrap not in this release yet');
    if (s.wrap) el.classList.add('ok');
  }
  // Found-ness flips rebuild the stage (setup card ⇄ preview).
  if (!was || !!was.found !== !!s.found) renderPreview();
}

tiny.api.on('cli', renderCli);
tiny.api.call('resolve').then(renderCli).catch(() => { });

$('stage').addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btnSetup') await runSetup();
});

async function runSetup() {
  if (state.setupRunning) return;
  state.setupRunning = true;
  busy(true);
  $('cliStatus').textContent = 'installing tinyjs…';
  log('— installing tinyjs — the official installer (tinyjs.app), streamed below —');
  try {
    const r = await tiny.api.call('setup', {});
    if (r && r.installed === false) {
      log('installer didn’t complete — see the [setup] lines above.', 'err');
    } else if (r && r.installed) {
      log('tinyjs ready — ' + r.version + ' (' + r.bin + ')' + (r.wrap ? '' : ' · wrap pending upstream'), 'ok');
    }
  } catch (e) {
    log(String(e.message ?? e), 'err');
  }
  state.setupRunning = false;
  busy(false);
}

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

// Open an existing tinyjs project from anywhere on disk.
$('btnOpenExisting').addEventListener('click', async () => {
  const dir = await tiny.dialog.pickFolder();
  if (!dir) return;
  try {
    const r = await tiny.api.call('addExisting', { dir });
    log('opened ' + r.title + ' — ' + r.dir, 'ok');
    loadProjects();
  } catch (e) {
    log(String(e.message ?? e), 'err');
  }
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
      const sel = p.abs;
      if (state.project === sel && state.expanded === p.abs) state.expanded = null;
      else state.expanded = p.abs;
      setProject(sel);
      if (p.url) fillWrapForm(p);
      loadProjects();
    });
    if (p.external) {
      const x = document.createElement('span');
      x.className = 'unpin';
      x.textContent = '×';
      x.dataset.tip = 'Remove from the list (files stay)';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        await tiny.api.call('removeExternal', { dir: p.abs });
        if (state.project === p.abs) { state.project = null; $('project').hidden = true; }
        loadProjects();
      });
      item.appendChild(x);
    }
    list.appendChild(item);

    // expanded project: its file tree under the card — click opens with the
    // OS default app (the Studio stays read-only by design).
    if (state.expanded === p.abs) {
      const { files } = await tiny.api.call('listFiles', { dir: p.abs });
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
          const path = `${p.abs}/${f.rel}`;
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
  const gm = p.studio?.gateMode ?? 'wrapper';
  const gmRadio = document.querySelector(`input[name="gatePreset"][value="${gm}"]`);
  if (gmRadio) gmRadio.checked = true;
  $('wrapSubdomains').checked = p.studio?.subdomains ?? false;
  $('wrapMedia').checked = p.studio?.media ?? false;
  $('wrapBadge').value = p.studio?.badge ?? '';
  $('wrapExternal').value = (p.studio?.external ?? []).join(', ');
  syncGateUI();
  // the icon preview mirrors the selected project's own icon
  $('iconPrev').innerHTML = p.icon ? `<img src="${p.icon}" alt="">` : 'auto';
  renderPreview();
}
// badge & external restore from the sidecar record — the CLI flags remain
// the power path, the form fields are the everyday path.

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

// --- the api gate: picker, custom chips, Gate tab ---------------------------
// Verbs verbatim from the runtime's API_PRESETS.wrapper (mirrored in
// src/main.js — keep the two lists identical). The UI never invents powers:
// every chip maps to a wire-method pattern tinyjs actually enforces.
const WRAPPER_PRESET = ['notify', 'dialog.*', 'win.*', 'menu.*', 'tray.*', 'store.*',
  'clip.write', 'shell.open', 'theme.get', 'system.locale', 'system.capabilities',
  'system.requirements', 'system.info', 'app.info', 'app.badge', 'app.attention',
  'app.progress', 'sound.play', 'nowplaying.*', 'power.prevent', 'power.allow'];
const GATE_EXTRA = [
  { verb: 'media.*', why: 'camera & mic — on macOS this keyhole replaces the per-site consent prompt; a site using tiny.proxyURL also needs "media.proxy"' },
  { verb: 'clip.read', why: 'read the clipboard — anything the user copied, in any app' },
  { verb: 'fs.*', why: 'the filesystem — files, everywhere the user can' },
  { verb: 'debug.get', why: 'secrets & automation — clipboard, wifi, frontmost app, other windows' },
  { verb: 'spotlight.index', why: 'search the user\'s home directory' },
];
state.gateSel = new Set(WRAPPER_PRESET);   // custom mode: wrapper-posture chips
state.gateExtra = new Set();               // custom mode: deliberate grants
const gateMode = () =>
  document.querySelector('input[name="gatePreset"]:checked')?.value ?? 'wrapper';

function customGate() {
  return {
    disable: ['*'],
    enable: [
      ...WRAPPER_PRESET.filter((v) => state.gateSel.has(v)),
      ...GATE_EXTRA.map((x) => x.verb).filter((v) => state.gateExtra.has(v)),
    ],
  };
}

function gateChip(verb, on, why) {
  return `<button type="button" class="gv${on ? ' on' : ''}" data-verb="${esc(verb)}"${why ? ` data-tip="${esc(why)}"` : ''}>${esc(verb)}</button>`;
}

function renderGateCustom() {
  $('gateIn').innerHTML = WRAPPER_PRESET.map((v) => gateChip(v, state.gateSel.has(v))).join('');
  $('gateOut').innerHTML = GATE_EXTRA.map((x) => gateChip(x.verb, state.gateExtra.has(x.verb), x.why)).join('');
  $('gateJson').textContent = JSON.stringify(customGate(), null, 2);
}

function syncGateUI() {
  const mode = gateMode();
  const wrap = state.source === 'wrap';
  $('gateCustom').hidden = !wrap || mode !== 'custom';
  $('wrapMedia').hidden = !wrap || mode !== 'wrapper';
  if (mode === 'custom') renderGateCustom();
}

$('gatePicker').addEventListener('change', () => { syncGateUI(); renderPreview(); });
$('gateCustom').addEventListener('click', (e) => {
  const b = e.target.closest('.gv');
  if (!b) return;
  const set = e.target.closest('#gateIn') ? state.gateSel : state.gateExtra;
  if (set.has(b.dataset.verb)) set.delete(b.dataset.verb); else set.add(b.dataset.verb);
  renderGateCustom();
});

// The one-line trust summary for whatever posture is active — the sentence a
// user can screenshot before wrapping.
const WRAPPER_TRUST = 'window controls & menus · notifications & dock · its own storage · native dialogs & outbound links — and nothing else: no filesystem, no clipboard read, no secrets, no camera or mic';
const TRUST_LABELS = [
  ['win.*', 'window controls'], ['menu.*', 'app menus'], ['tray.*', 'tray icon'],
  ['notify', 'notifications'], ['sound.play', 'sound'], ['app.badge', 'dock badge'],
  ['app.progress', 'dock progress'], ['app.attention', 'attention ping'],
  ['app.info', 'app info'], ['nowplaying.*', 'media state'], ['store.*', 'its own storage'],
  ['dialog.*', 'native dialogs'], ['shell.open', 'outbound links'], ['clip.write', 'clipboard write'],
  ['theme.get', 'theme'], ['system.', 'system info'], ['power.', 'power requests'],
  ['media.*', 'CAMERA & MIC'], ['clip.read', 'CLIPBOARD READ'], ['fs.*', 'FILESYSTEM'],
  ['debug.get', 'SECRETS & AUTOMATION'], ['spotlight.index', 'HOME SEARCH'],
];
function trustFor(view) {
  if (view.mode === 'absent') return 'Every page holds the full backend — filesystem included. Fix below.';
  if (view.mode === 'none') return 'Pages get nothing beyond the bootstrap read-back (client.hello).';
  if (view.mode === 'preset' && view.preset === 'wrapper') return WRAPPER_TRUST;
  if (view.mode === 'all') return 'Every method, every page — the one config that must not ship.';
  const on = new Set(view.enable ?? []);
  const labels = TRUST_LABELS.filter(([p]) => on.has(p)).map(([, l]) => l);
  const rest = [...on].filter((v) => !TRUST_LABELS.some(([p]) => p === v));
  const list = [...labels, ...rest].join(' · ') || 'nothing';
  return 'Pages may call: ' + list + (view.origins ? ' — origins matching no keyhole get nothing.' : '.');
}

// --- the Gate tab: inspect (and edit) a project's api gate ------------------

let gateSeq = 0;
async function renderGate() {
  const seq = ++gateSeq;
  const body = $('gateBody');
  if (!state.project) {
    body.innerHTML = '<p class="hint" style="margin-top:0">Select a project to inspect its api gate — what its pages may call, and what they can\'t.</p>';
    return;
  }
  body.innerHTML = '<p class="hint">reading the gate…</p>';
  let g;
  try { g = await tiny.api.call('gate', { dir: state.project }); }
  catch (e) { body.innerHTML = `<p class="hint">${esc(String(e.message ?? e))}</p>`; return; }
  if (seq !== gateSeq) return; // a newer render took over
  state.gateData = g;
  state.gateEditKeys = new Set();
  state.gateSets = new Map();
  renderGateView();
}

// Resolve what an api entry lets through — the runtime's semantics restated.
function resolveOn(entry) {
  if (entry == null) return new Set();
  if (entry === 'wrapper') return new Set(WRAPPER_PRESET);
  if (typeof entry === 'string') return new Set();
  if (Array.isArray(entry)) return new Set(entry);
  return new Set(entry.enable ?? []);
}

function gateEntryChips(key, entry) {
  if (!state.gateSets.has(key)) state.gateSets.set(key, resolveOn(entry));
  const on = state.gateSets.get(key);
  const known = new Set([...WRAPPER_PRESET, ...GATE_EXTRA.map((x) => x.verb)]);
  const chips = [
    ...WRAPPER_PRESET.map((v) => gateChip(v, on.has(v))),
    ...GATE_EXTRA.map((x) => gateChip(x.verb, on.has(x.verb), x.why)),
    ...[...on].filter((v) => !known.has(v)).map((v) => gateChip(v, true)),
  ];
  return chips.join('');
}

function renderGateView() {
  const g = state.gateData;
  const body = $('gateBody');
  const banners = g.warnings.map((w) => `<div class="gate-banner ${w.level}">${esc(w.text)}</div>`).join('');
  const fix = (g.view.mode === 'absent' || g.view.mode === 'all' || (g.view.mode === 'preset' && g.view.preset !== 'wrapper' && g.view.preset !== 'none'))
    ? '<button id="btnGateFix" class="primary wide">Apply the wrapper preset</button>' : '';
  const entries = [];
  const topEntry = g.view.mode === 'preset' || g.view.mode === 'none' || g.view.mode === 'all' || g.view.mode === 'absent'
    ? (g.view.mode === 'preset' ? g.view.preset : g.view.mode === 'none' ? 'none' : null)
    : (g.view.mode === 'lists' ? g.api : g.view.mode === 'object' ? { preset: g.view.preset, disable: g.view.disable, enable: g.view.enable } : null);
  if (topEntry && !(g.view.mode === 'object' && !g.view.preset && !g.view.disable?.length && !g.view.enable?.length)) {
    entries.push(`<div class="gate-entry"><div class="ge-head"><span class="ge-name">top-level gate</span><span class="ge-mode">${esc(typeof topEntry === 'string' ? `preset: ${topEntry}` : 'lists')}</span></div><div class="gate-row" data-key="top">${gateEntryChips('top', topEntry)}</div></div>`);
  }
  if (g.view.mode === 'object' && g.view.origins) {
    for (const [origin, entry] of Object.entries(g.view.origins)) {
      entries.push(`<div class="gate-entry"><div class="ge-head"><span class="ge-name">${esc(origin)}</span><span class="ge-mode">${esc(typeof entry === 'string' ? `preset: ${entry}` : 'keyhole')}</span></div><div class="gate-row" data-key="${esc(origin)}">${gateEntryChips(origin, entry)}</div></div>`);
    }
  }
  body.innerHTML = `${banners}
    <div class="trust">${esc(trustFor(g.view))}</div>${fix}${entries.join('')}
    <button id="btnGateSave" class="primary wide" hidden>Save gate</button>
    <p class="hint">Chips are wire-method patterns the runtime enforces —
    enable wins over disable. Iframes are stricter: they only call the
    bridge when an <code>api.origins</code> key names their origin — presets
    and top-level lists give subframes nothing (tinyjs 0.50.1). Saving
    writes the real <code>api</code> key in tinyjs.json; nothing is
    abstracted away.</p>`;
}

$('gateBody').addEventListener('click', async (e) => {
  const chip = e.target.closest('.gv');
  if (chip) {
    const row = chip.closest('.gate-row');
    const key = row?.dataset.key;
    if (!key) return;
    const set = state.gateSets.get(key);
    if (!set) return;
    if (set.has(chip.dataset.verb)) set.delete(chip.dataset.verb); else set.add(chip.dataset.verb);
    state.gateEditKeys.add(key);
    chip.classList.toggle('on');
    $('btnGateSave').hidden = false;
    return;
  }
  if (e.target.id === 'btnGateFix') {
    let origin = null;
    try { origin = state.gateData.url ? new URL(state.gateData.url).origin : null; } catch { /* keep null */ }
    const api = origin ? { origins: { [origin]: 'wrapper' } } : 'wrapper';
    try {
      const r = await tiny.api.call('gatePatch', { dir: state.project, api });
      log('gate fixed — the wrapper preset is in force' + (r.warnings?.length ? ' (see the Gate tab)' : ''), 'ok');
      renderGate();
    } catch (err) { log(String(err.message ?? err), 'err'); }
    return;
  }
  if (e.target.id === 'btnGateSave') {
    const v = state.gateData.view;
    let api;
    const topTouched = state.gateEditKeys.has('top');
    if (v.mode === 'object' && v.origins) {
      api = { origins: {} };
      for (const [o, entry] of Object.entries(state.gateData.api.origins)) {
        api.origins[o] = state.gateEditKeys.has(o)
          ? { disable: ['*'], enable: [...(state.gateSets.get(o) ?? new Set())] }
          : entry;
      }
      if (topTouched) Object.assign(api, { disable: ['*'], enable: [...(state.gateSets.get('top') ?? new Set())] });
      else {
        const a = state.gateData.api;
        if (a.preset != null) api.preset = a.preset;
        if (a.disable) api.disable = a.disable;
        if (a.enable) api.enable = a.enable;
      }
    } else if (v.mode === 'lists' || topTouched) {
      api = { disable: ['*'], enable: [...(state.gateSets.get('top') ?? new Set())] };
    } else {
      api = state.gateData.api; // an untouched preset string stays a string
    }
    try {
      const r = await tiny.api.call('gatePatch', { dir: state.project, api });
      log('gate saved — ' + (r.warnings.some((w) => w.level === 'bad') ? 'warnings below, check the Gate tab' : 'the runtime enforces it as written'), r.warnings.some((w) => w.level === 'bad') ? 'err' : 'ok');
      renderGate();
    } catch (err) { log(String(err.message ?? err), 'err'); }
  }
});

// --- tabs ------------------------------------------------------------------

const mainPane = document.querySelector('.inspector-scroll .pane:not(#gatePane)');

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isGate = tab.dataset.tab === 'gate';
    $('gatePane').hidden = !isGate;
    mainPane.hidden = isGate;
    if (isGate) { renderGate(); return; }
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
  const mode = wrap ? gateMode() : undefined;
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
    // the gate: 'wrapper' is the CLI's own default (send nothing), 'none'
    // and the custom object are patched in after the wrap, media rides the
    // per-origin keyhole. In custom mode the chips already include media.*.
    gateMode: mode,
    gate: mode === 'none' ? 'none' : mode === 'custom' ? customGate() : undefined,
    subdomains: wrap ? $('wrapSubdomains').checked : undefined,
    media: wrap && mode === 'wrapper' ? $('wrapMedia').checked : undefined,
    badge: wrap ? ($('wrapBadge').value.trim() || undefined) : undefined,
    external: wrap ? ($('wrapExternal').value.trim() || undefined) : undefined,
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
  syncGateUI();
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
  document.querySelector('input[name="gatePreset"][value="wrapper"]').checked = true;
  state.gateSel = new Set(WRAPPER_PRESET);
  state.gateExtra = new Set();
  $('wrapSubdomains').checked = false;
  $('wrapMedia').checked = false;
  $('wrapBadge').value = '';
  $('wrapExternal').value = '';
  $('iconPrev').textContent = 'auto';
  state.project = null;
  $('project').hidden = true;
  syncSubChoices();
  syncWrapButton();
  renderPreview();
  log('— fresh ' + (state.source === 'wrap' ? 'wrap' : 'app') + ' — fill the form and go', 'ok');
});

// the build-target select only makes sense on macOS (arch/universal/dmg)
$('buildTarget').hidden = !isMac;

$('btnBuild').addEventListener('click', async () => {
  if (state.running) return;
  if (!state.project) { log('select a project first', 'err'); return; }
  busy(true);
  const target = isMac ? $('buildTarget').value : 'platform';
  log(`— tinyjs build${target !== 'platform' ? ' (' + target + ')' : ''} —`);
  try { await tiny.api.call('build', { dir: state.project, target }); }
  catch (e) { log(String(e.message ?? e), 'err'); busy(false); }
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

$('btnResetData').addEventListener('click', async () => {
  if (!state.project) return;
  if (!confirm('Wipe this app\'s cookies and site data?\n\nThe next run starts signed-out, with fresh storage.')) return;
  try {
    const r = await tiny.api.call('resetData', { dir: state.project });
    log(r.removed ? `site data wiped (${r.removed} location${r.removed > 1 ? 's' : ''}) — fresh login next run` :
      'no stored site data found for this app', r.removed ? 'ok' : undefined);
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
  // No CLI yet: the stage becomes the setup card — one big button is all a
  // fresh install of the packaged app should ever ask for.
  if (state.cli && !state.cli.found) {
    const target = isWin ? '%LOCALAPPDATA%\\tinyjs' : '~/.tinyjs';
    stage.innerHTML = `<div class="setup-card">
      <h2>One thing left — the tinyjs runtime</h2>
      <p>Everything the Studio does runs on the <code>tinyjs</code> CLI, and it isn't on this machine yet.</p>
      <button id="btnSetup" class="primary big"${state.setupRunning ? ' disabled' : ''}>${state.setupRunning ? 'installing…' : 'Install tinyjs — one click'}</button>
      <p class="hint">Runs the official tinyjs.app installer into <code>${target}</code>, streamed live in the
      console below. The Studio drives it by absolute path — no PATH setup, nothing else touched.</p>
    </div>`;
    return;
  }
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
    const gm = gateMode();
    chips.push('gate: ' + gm
      + ($('wrapSubdomains').checked ? ' + subdomains' : '')
      + (gm === 'wrapper' && $('wrapMedia').checked ? ' + media' : ''));
    const title = $('wrapTitle').value.trim() || host || 'TinyJS App';
    const hasBadge = !!$('wrapBadge').value.trim();
    if (hasBadge) chips.push('badge selector');
    if (ua === 'iphone') mk = mockPhone(p, host, hasBadge);
    else if (panel) mk = mockPanel(p, host, hasBadge);
    else mk = mockWindow({
      title, frameless, dots: frameless && dots, p, host, badge: hasBadge,
      floating: $('wrapAlwaysTop').checked,
    });
  }
  stage.innerHTML = mk + `<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>`;
}

['wrapUrl', 'wrapName', 'wrapTitle', 'wrapUA', 'wrapDots',
  'wrapFrameless', 'wrapMenubar', 'wrapTray', 'wrapAlwaysTop', 'template',
  'wrapSubdomains', 'wrapMedia', 'wrapBadge', 'wrapExternal',
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
let ocView = null;

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
    body.innerHTML = '<div class="ed-wrap" id="ocEd"></div>';
    ocView = window.TinyCM.create($('ocEd'), {
      doc: r.text,
      ext: ocState.ext,
      onChange: () => { ocState.dirty = true; $('ocName').classList.add('dirty'); },
      onSave: () => saveFileCanvas(),
      onEscape: () => { if (!ocState.dirty) closeFileCanvas(); },
    });
  }
  requestAnimationFrame(() => {
    $('fileCanvas').classList.add('open');
    if (ocView) window.TinyCM.focus(ocView);
  });
}

function closeFileCanvas() {
  $('fileCanvas').classList.remove('open');
  if (ocView) { window.TinyCM.destroy(ocView); ocView = null; }
  ocState = { path: null, dirty: false, ext: null };
}

async function saveFileCanvas() {
  if (!ocView) return;
  await tiny.api.call('writeFile', { path: ocState.path, text: window.TinyCM.get(ocView) });
  ocState.dirty = false;
  $('ocName').classList.remove('dirty');
  log('saved ' + ocState.path.split('/').pop(), 'ok');
}

$('ocSave').addEventListener('click', saveFileCanvas);
$('ocClose').addEventListener('click', async () => {
  if (ocState.dirty && !confirm('Discard unsaved changes?')) return;
  closeFileCanvas();
});

log('TinyJS App Studio ready.', 'ok');
renderPreview();
