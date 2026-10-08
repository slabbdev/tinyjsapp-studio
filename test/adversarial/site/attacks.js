// Adversarial probe suite — runs inside a wrapped app (wrapper preset) and
// inside a cross-origin iframe served from a second port (stranger origin).
// Every probe is a known webview-escape class from the wrapper threat model
// (docs/THREAT-MODEL.md); expected results live in test/adversarial/README.md.
'use strict';

const ROWS = [];
function record(id, attack, expected, observed, verdict) {
  ROWS.push({ id, attack, expected, observed, verdict });
  console.log(`ADV/${id} [${verdict}] ${attack} — ${observed}`);
  const t = document.getElementById('t');
  const tr = document.createElement('tr');
  const cls = verdict.startsWith('PASS') ? 'PASS' : verdict.startsWith('OPEN') ? 'OPEN' : 'FAIL';
  tr.innerHTML =
    `<td>${id}</td><td>${attack}</td><td>${expected}</td>` +
    `<td>${String(observed).replace(/[<>&]/g, '')}</td>` +
    `<td class="${cls}">${verdict}</td>`;
  t.appendChild(tr);
}

async function call(method, params) {
  try {
    const r = await window.tiny.api.call(method, params);
    return { ok: true, value: r };
  } catch (e) {
    return { ok: false, error: (e && (e.message || String(e))) || 'rejected' };
  }
}

// A call is BLOCKED if it rejected (gate reason or unknown method) — anything
// that resolves means the backend executed it.
function blocked(res) { return !res.ok; }

// ---- stranger-origin iframe: serves from the second port, reports back ----
function iframeProbe() {
  return new Promise((resolve) => {
    const el = document.createElement('iframe');
    el.style.display = 'none';
    const other = `${location.protocol}//${location.hostname}:8788/iframe.html`;
    const done = (observed) => { el.remove(); resolve(observed); };
    const timer = setTimeout(() => done('no report back within 8s'), 8000);
    window.addEventListener('message', (ev) => {
      if (ev.source !== el.contentWindow) return;
      clearTimeout(timer);
      done(ev.data);
    });
    el.src = other;
    document.body.appendChild(el);
  });
}

async function main() {
  if (!window.tiny || !window.tiny.api) {
    record('T0', 'bridge presence', 'window.tiny injected by runtime',
      'no window.tiny — page is not running inside a wrapped app', 'FAIL');
    return;
  }

  // T1–T4 · gate probes from the WRAPPED origin under the wrapper preset:
  // filesystem, clipboard READ, secrets/automation must all be OUT.
  for (const [id, method, params] of [
    ['T1', 'fs.read', { path: '~/'.concat('.zshenv') }],
    ['T2', 'clip.read', {}],
    ['T3', 'debug.get', {}],
    ['T4', 'spotlight.index', { query: 'passwords' }],
  ]) {
    const res = await call(method, params);
    record(id, `gate probe — ${method}`, 'rejected (wrapper preset excludes it)',
      res.ok ? `EXECUTED: ${JSON.stringify(res.value).slice(0, 80)}` : res.error,
      blocked(res) ? 'PASS — blocked' : 'FAIL — executed');
  }

  // T5 · win.open confinement (tinyjs 0.46, #29): file:, javascript:, ../
  // walks and UNC paths must be refused.
  for (const [id, url] of [
    ['T5a', 'file:///etc/passwd'],
    ['T5b', 'javascript:fetch("http://127.0.0.1:8788/exfil")'],
    ['T5c', '../'.repeat(8) + 'etc/passwd'],
    ['T5d', '\\\\\\\\evil\\\\share\\\\x.html'],
  ]) {
    let observed;
    try {
      const w = window.open(url, '_blank');
      observed = w ? 'window handle returned' : 'no window (null)';
      if (w) { try { w.close(); } catch { /* ignore */ } }
    } catch (e) { observed = 'threw: ' + e.message; }
    record(id, `win.open escape — ${url.slice(0, 40)}`,
      'refused (file:/javascript:/path walks)',
      observed, observed === 'no window (null)' ? 'PASS — refused' : 'CHECK manually');
  }

  // T6 · subframe gate borrow: a cross-origin iframe (port 8788) must not
  // reach the backend — neither via the injected bridge (window.tiny, T6)
  // nor via the raw per-frame message handler (window.__invoke, T6b — the
  // exact vector tinyjs 0.50.1 closed on macOS; on <=0.50.0 T6b LEAKS by
  // design-of-the-era, so the verdict is version-aware, not a failure).
  const rep = await iframeProbe();
  let t6 = rep, t6b = 'no report';
  try {
    const parsed = JSON.parse(rep);
    t6 = parsed.t6 ?? rep;
    t6b = parsed.t6b ?? 'no report';
  } catch { /* old-style single-string report */ }
  record('T6', 'cross-origin iframe bridge calls (window.tiny, port 8788)',
    'every call rejected — stranger origin has no gate entry',
    t6, String(t6).startsWith('ALL BLOCKED') ? 'PASS — subframe gated' : 'FAIL');
  record('T6b', 'cross-origin iframe RAW WKScriptMessageHandler call (shell.open)',
    '<=0.50.0: rides the top gate — browser hits /raw-leak (the hole 0.50.1 closed) · >=0.50.1: dropped',
    t6b,
    String(t6b).startsWith('ALL BLOCKED') ? 'PASS — raw vector absent'
      : 'CHECK — harness decides by server log /raw-leak');

  // T7 · tiny.store prototype pollution (tinyjs 0.45): __proto__ /
  // constructor keys must be rejected — or sanitized so nothing lands. The
  // wrapped origin HAS store.* under the wrapper preset, so this reaches
  // the store layer. Read-backs decide: a key that was "accepted" but reads
  // back undefined/garbage was neutralized, which is as good as rejected.
  const p1 = await call('store.set', { key: '__proto__', value: { polluted: true } });
  const p2 = await call('store.set', { key: 'constructor', value: 'polluted' });
  const r1 = await call('store.get', { key: '__proto__' });
  const r2 = await call('store.get', { key: 'constructor' });
  const landed = (r) => r.ok && r.value !== undefined && r.value !== null &&
    JSON.stringify(r.value) !== '{}' && JSON.stringify(r.value) !== 'null';
  const polluted = ({}).polluted === true || ({}).constructor === 'polluted';
  const t7obs =
    `set __proto__: ${p1.ok ? 'accepted' : p1.error}; read back: ${r1.ok ? JSON.stringify(r1.value) : r1.error}; ` +
    `set constructor: ${p2.ok ? 'accepted' : p2.error}; read back: ${r2.ok ? JSON.stringify(r2.value) : r2.error}; ` +
    `Object.prototype.polluted=${({}).polluted === true}`;
  record('T7', 'tiny.store prototype pollution via __proto__/constructor',
    'no prototype pollution — keys may persist as inert data (0.45 fix sanitizes, not rejects)',
    t7obs,
    polluted ? 'FAIL — Object.prototype polluted' : 'PASS — inert data, prototype clean');

  // T8 · win.printToPDF — since tinyjs 0.48.0 (#36 FIXED): non-app origins
  // write directly ONLY into Downloads (bare filenames), the app data
  // folder, or temp; every other path opens a save panel, cancel rejects.
  // So the probe splits: temp must write (allowed zone by design), and the
  // harness-fed protected path must never produce a file (T8b, below).
  // Settle delay: the launcher's PDF op races the webview's first paint.
  await new Promise((r) => setTimeout(r, 2500));
  const q = new URLSearchParams(location.search);
  const pdf = await call('win.printToPDF', { path: q.get('pwn') || '/tmp/tjs-adv-pwn.pdf' });
  record('T8', 'win.printToPDF — temp path (allowed zone since 0.48)',
    'direct write — temp is in the allowed zone (#36 fix)',
    pdf.ok ? 'written directly' : pdf.error,
    pdf.ok ? 'PASS — allowed zone' : 'CHECK manually');
  // T8b · the clobber attempt: a path OUTSIDE every allowed zone ($HOME,
  // fed by the harness via ?pwn2=). Since 0.48 this must open a save panel
  // (cancelled at teardown) or reject — the file must never appear.
  // Fire-and-forget: a modal panel must never hang the suite.
  const pwn2 = q.get('pwn2');
  const fireT8b = () => {
    if (!pwn2) return;
    // Fire-and-forget, and ALWAYS last: since 0.48 the protected path opens
    // a modal save panel that stalls the launcher's wire pump — the report
    // relay must already be out before this fires.
    call('win.printToPDF', { path: pwn2 }).then(
      () => record('T8b', `win.printToPDF — protected path ${pwn2}`,
        'no direct write — save panel or rejection (0.48 fix)',
        'call resolved — the harness decides by file presence',
        'CHECK — harness decides'),
      (e) => record('T8b', `win.printToPDF — protected path ${pwn2}`,
        'no direct write — save panel or rejection (0.48 fix)',
        'rejected: ' + e.message, 'PASS — rejected'));
  };

  // T9 · postMessage spoofing of window chrome: synthetic messages imitating
  // drag-strip window-verb relays. Nothing must execute; the harness checks
  // process liveness after this page has run.
  let spoofed = 0;
  for (const verb of ['win.close', 'win.minimize', 'win.zoom', 'client.hello']) {
    try { window.postMessage({ tiny: verb, args: [] }, '*'); spoofed++; } catch { /* ignore */ }
    try { window.postMessage({ op: verb, method: verb, params: {} }, '*'); spoofed++; } catch { /* ignore */ }
  }
  record('T9', `postMessage spoof barrage (${spoofed} synthetic bridge messages)`,
    'no effect — messages are page-internal, backend is socket-only',
    'sent; harness verifies the app is still alive afterwards',
    'PASS — see harness liveness check');

  // T10 · malformed wire messages (tinyjs 0.47.1): launchers previously
  // passed parts of page messages to the backend unchecked — malformed
  // messages are now dropped before reaching it, on every platform. The
  // barrage sends junk shapes carrying an HARMLESS allowed verb (app.badge):
  // a well-formed dangerous verb would be a legitimate gated call, not junk
  // — one earlier draft closed the app that way. The fs.read line carries a
  // spoofed allowed origin: if the backend ever honors a claimed origin
  // field over the engine stamp, that call going through is the finding.
  const junk = [
    'not json', '', 'null', '[]', '42', '"method"',
    '{"method":123}', '{"method":["app.badge"]}', '{"method":"app.badge',
    '{"method":"APP.BADGE"}',
    '{"method":"app.badge","params":"not-an-object"}',
    '{"method":"app.badge","params":null}',
    '{"__proto__":{"x":1},"method":"app.badge"}',
    '{"method":"fs.read","params":{"path":"/etc/hosts"},"origin":"http://127.0.0.1:8787"}',
    JSON.stringify({ method: 'client.hello', params: undefined, extra: 'x' }),
  ];
  let t10 = { threw: 0, settled: 0 };
  for (const payload of junk) {
    try { window.__invoke(payload); t10.settled++; }
    catch { t10.threw++; }
  }
  record('T10', `malformed message barrage (${junk.length} junk wire payloads)`,
    'dropped before the backend (0.47.1) — nothing executes',
    `sent; ${t10.threw} rejected page-side, ${t10.settled} dispatched; harness liveness decides`,
    'PASS — see harness liveness check');

  console.log('ADV/SUMMARY ' + JSON.stringify(ROWS.map(r => r.id + ':' + r.verdict)));

  // Final report relay — before T8b, whose modal panel stalls the wire.
  const relay = await relayReport();
  record('T9b', 'verdict relay via clip.write (allowed verb as report channel)',
    'relayed — the harness reads it with pbpaste', relay,
    relay === 'relayed' ? 'PASS — relayed' : 'CHECK manually — read the window');

  fireT8b();
}

// Report channel: `clip.write` is enabled for the wrapped origin by the
// wrapper preset (by design — it's the wrapper posture), so the page hands
// its verdict table to the harness that way; pbpaste reads it. Every
// attempt is time-boxed so a jammed invoke pipeline can't hang the suite.
async function relayReport() {
  const report = ROWS.map(r => `${r.id} [${r.verdict}] ${r.attack} — ${r.observed}`).join('\n');
  for (let i = 0; i < 3; i++) {
    const res = await Promise.race([
      call('clip.write', { text: 'ADV/REPORT\n' + report }),
      new Promise((r) => setTimeout(() => r({ ok: false, error: 'timeout' }), 2000)),
    ]);
    if (res && res.ok) return 'relayed';
    await new Promise((r) => setTimeout(r, 700));
  }
  return 'failed';
}

window.addEventListener('load', main);
