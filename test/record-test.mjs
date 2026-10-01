// Headless check of the Studio record migration (scratch — not committed).
import { readStudioRecord, applyFinishing } from '../src/main.js';

let failures = 0;
const ok = (cond, name) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) failures++; };
const readJson = async (p) => JSON.parse(dec.decode(await tjs.readFile(p)));
const readText = async (p) => dec.decode(await tjs.readFile(p));
const write = (p, obj) => tjs.writeFile(p, enc.encode(JSON.stringify(obj, null, 2) + '\n'));
const rm = (p) => tjs.remove(p, { recursive: true }).catch(() => { });
const { enc, dec } = { enc: new TextEncoder(), dec: new TextDecoder() };
const base = '/tmp/studio-record-test';
const exists = async (p) => { try { await tjs.stat(p); return true; } catch { return false; } };

await rm(base);
await tjs.makeDir(base + '/legacy/src', { recursive: true });
await tjs.makeDir(base + '/sidecar', { recursive: true });
await tjs.makeDir(base + '/empty/src', { recursive: true });
await tjs.makeDir(base + '/finishing/src', { recursive: true });
await write(base + '/sidecar/tinyjs.json', { name: 'sidecar' });

// A) legacy project: record inside tinyjs.json → migrate to the sidecar
const legacyCfg = { name: 'legacy', title: 'Legacy', studio: { dots: true, badge: '3', external: ['a.com'] } };
await write(base + '/legacy/tinyjs.json', legacyCfg);
const gotA = await readStudioRecord(base + '/legacy', legacyCfg);
const migrated = await readJson(base + '/legacy/tinyjs.json');
ok(gotA.dots === true && gotA.badge === '3' && gotA.external[0] === 'a.com', 'A: legacy record returned');
ok(!('studio' in migrated), 'A: studio key removed from tinyjs.json');
ok((await readJson(base + '/legacy/.tinyjs-studio.json')).badge === '3', 'A: sidecar written');

// B) sidecar already there: it wins, manifest untouched
const before = await readText(base + '/sidecar/tinyjs.json');
await write(base + '/sidecar/.tinyjs-studio.json', { dots: false, badge: null, external: null, kept: 1 });
const gotB = await readStudioRecord(base + '/sidecar', { name: 'sidecar' });
ok(gotB.kept === 1 && gotB.dots === false, 'B: sidecar record returned');
ok(await readText(base + '/sidecar/tinyjs.json') === before, 'B: manifest untouched');

// C) nothing recorded: empty object, no sidecar created
const gotC = await readStudioRecord(base + '/empty', { name: 'empty' });
ok(JSON.stringify(gotC) === '{}', 'C: empty record');
ok(!(await exists(base + '/empty/.tinyjs-studio.json')), 'C: no sidecar created');

// D) applyFinishing with a badge: sidecar written, legacy key dropped,
// badge gate patched, inject.js REGENERATED (the badge watcher rides it)
await write(base + '/finishing/tinyjs.json', {
  name: 'finishing', title: 'F',
  inject: 'inject.js',
  studio: { dots: true },
  api: { origins: { 'https://x.example': 'wrapper' } },
});
await tjs.writeFile(base + '/finishing/inject.js', enc.encode('// stale'));
await applyFinishing(base + '/finishing', { frameless: false, panel: false, dots: true, badge: '3', external: 'a.com, b.com', menubar: true, top: true });
const finCfg = await readJson(base + '/finishing/tinyjs.json');
const finSide = await readJson(base + '/finishing/.tinyjs-studio.json');
ok(!('studio' in finCfg), 'D: studio key dropped from manifest');
ok(finCfg.inject === 'inject.js' && (await readText(base + '/finishing/inject.js')).includes('badge'), 'D: inject regenerated for the badge');
ok(finCfg.api.origins['https://x.example'].preset === 'wrapper'
   && finCfg.api.origins['https://x.example'].enable[0] === 'app.badge', 'D: badge gate exception written');
ok(finSide.dots === null && finSide.badge === '3'
   && finSide.external[0] === 'a.com' && finSide.external[1] === 'b.com', 'D: sidecar record written (dots null: not frameless)');
ok(finSide.menubar === true && finSide.top === true && finSide.panel === false, 'D: menubar/top/panel recorded for form restore');

// E) panel mode: no inject at all — the stale one is REMOVED
await applyFinishing(base + '/finishing', { frameless: false, panel: true, dots: true, badge: null });
const finCfg2 = await readJson(base + '/finishing/tinyjs.json');
ok(!('inject' in finCfg2) && !(await exists(base + '/finishing/inject.js')), 'E: panel removes the inject');

// F) second badge-less round-trip: dots/badge/external are RECOMPUTED
// (same overwrite semantics the manifest key always had)
await applyFinishing(base + '/finishing', { frameless: true, panel: false, dots: false });
const finSide2 = await readJson(base + '/finishing/.tinyjs-studio.json');
ok(finSide2.dots === false && finSide2.badge === null && finSide2.external === null, 'F: record recomputed, no stale fields');
ok(finSide2.menubar === false && finSide2.top === false && finSide2.panel === false, 'F: form flags recomputed too');

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
if (failures) throw new Error('failures');
