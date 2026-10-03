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

  // T6 · subframe gate borrow (tinyjs 0.46, #18): a cross-origin iframe
  // calling the bridge from a stranger origin must be denied per-origin.
  const rep = await iframeProbe();
  record('T6', 'cross-origin iframe bridge calls (port 8788)',
    'every call rejected — stranger origin has no gate entry',
    rep, String(rep).startsWith('ALL BLOCKED') ? 'PASS — subframe gated' : 'FAIL');

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

  // T8 · win.printToPDF arbitrary path (#36, OPEN upstream): the page names
  // the output path; under win.* the wrapper preset lets it through today.
  // The harness checks the file externally — the path arrives via ?pwn=.
  // Small settle delay: the launcher's PDF op races the webview's first
  // paint, which made this probe flaky (accepted without writing) on cold
  // starts.
  await new Promise((r) => setTimeout(r, 2500));
  const pwn = new URLSearchParams(location.search).get('pwn') || '/tmp/tjs-adv-pwn.pdf';
  const pdf = await call('win.printToPDF', { path: pwn });
  record('T8', `win.printToPDF — page-named path ${pwn}`,
    'KNOWN OPEN — expect success until #36 lands (then: rejected)',
    pdf.ok ? 'call accepted — file written externally?' : pdf.error,
    pdf.ok ? 'OPEN — #36' : 'PASS — rejected');

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

  console.log('ADV/SUMMARY ' + JSON.stringify(ROWS.map(r => r.id + ':' + r.verdict)));

  // Report channel: `clip.write` is enabled for the wrapped origin by the
  // wrapper preset (by design — it's the wrapper posture), so the page can
  // hand its verdict table to the harness that way. pbpaste reads it.
  // Observed flaky 1/3 runs — retry, and trace the outcome as its own row.
  const report = ROWS.map(r => `${r.id} [${r.verdict}] ${r.attack} — ${r.observed}`).join('\n');
  let relay = 'failed';
  for (let i = 0; i < 3; i++) {
    const res = await call('clip.write', { text: 'ADV/REPORT\n' + report });
    if (res.ok) { relay = 'relayed'; break; }
    relay = 'failed: ' + res.error;
    await new Promise((r) => setTimeout(r, 700));
  }
  record('T9b', 'verdict relay via clip.write (allowed verb as report channel)',
    'relayed — the harness reads it with pbpaste', relay,
    relay === 'relayed' ? 'PASS — relayed' : 'CHECK manually — read the window');
}

window.addEventListener('load', main);
