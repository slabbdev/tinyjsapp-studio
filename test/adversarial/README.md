# Adversarial suite — outside-in proof for the wrapper threat model

A deliberately hostile page, wrapped and run exactly like any app the Studio
generates, attacking the gates it lives behind. It is the standing,
outside-the-runtime-CI companion to [docs/THREAT-MODEL.md](../../docs/THREAT-MODEL.md):
every probe maps to a guarantee (or a known open item), and every row links
the tinyjs issue/release behind it.

Scope note: the [runtime audit](https://github.com/tarwin/tinyjsapp/issues?q=audit+OR+hardening)
(#26/#29/#30…) tested tinyjs from the inside. This suite tests **the wraps
the Studio ships** — the wrapper preset, the injected page, cross-origin
subframes, and the effects a page cannot hide from the outside.

## Run it

```sh
sh test/adversarial/run.sh          # ~28s; a probe window appears briefly
# or: TINYJS_BIN=/path/to/tinyjs sh test/adversarial/run.sh 30
```

The harness (`run.sh`) starts a two-port static server (`serve.mjs` — 8787 is
the wrapped origin, 8788 exists so the suite's iframe is genuinely
cross-origin), runs `tinyjs wrap` on the hostile site into a temp dir, runs
`tinyjs dev` for a few seconds, then checks externally. Three evidence
channels, on purpose:

1. **Filesystem** — did the `printToPDF` probe (T8) actually write its
   page-named path? Ground truth for [#36](https://github.com/tarwin/tinyjsapp/issues/36),
   checked again after the app is killed (the write races first paint).
2. **Server log** — which URLs the page/popup actually reached: a
   `GET /etc/passwd` on the wrapped origin proves the `file:` popup was
   re-keyed (no disk access); a `GET /exfil` proves the `javascript:` popup
   executed.
3. **Clipboard** — the page relays its full verdict table out via
   `clip.write`, an allowed verb of the wrapper preset (macOS `pbpaste`;
   ⚠️ it clobbers your clipboard during the run).

Verdicts also render in the probe window's table. Each run wraps under a
**unique app title** — dev webviews persist a per-title WKWebsiteDataStore,
so a repeated title replays last run's cached probe scripts. Artifacts stay
in the harness's `/tmp/tjs-adv-*` dir (`wrap.log`, `dev.log`, `serve.log`).

## Observed results — verified run 2026-10-04 (tinyjs dev, post-0.46 checkout)

| id | attack | result | evidence |
|---|---|---|---|
| T1 | `fs.read` from the wrapped origin | **PASS — blocked**: `"fs.read" is disabled by tinyjs.json "api"` | gate, 0.38+ |
| T2 | `clip.read` | **PASS — blocked** (write is in, read is out) | gate |
| T3 | `debug.get` | **PASS — blocked** | 0.42.1 fix |
| T4 | `spotlight.index` | **PASS — blocked** | gate |
| T5a | `win.open('file:///etc/passwd')` | **PASS — re-keyed**: popup nav rewritten to `http://<origin>/etc/passwd`, 404, disk untouched | serve.log + `dev.log [nav]` |
| T5b | `win.open('javascript:fetch(…/exfil)')` | **INFO — same-origin execution**: the popup runs in the opener's origin (no privilege gain — same wrapper gate). The 0.46 `win.open` screening covers the bridge path, not DOM popups — observation flagged upstream | serve.log `/exfil` hit |
| T5c/d | `../` walk, UNC path | **manual** — handle returned, nothing fetched from a stranger host | serve.log |
| T6 | cross-origin iframe (port 8788) calling the bridge | **PASS — subframe isolated**: stronger than expected — `window.tiny` is not even injected into the stranger-origin subframe | page verdict relayed via clipboard |
| T7 | `tiny.store` `__proto__`/`constructor` pollution | **PASS — inert data**: keys persist as plain data, `Object.prototype` untouched (the 0.45 fix sanitizes rather than rejects) | page read-backs |
| T8 | `win.printToPDF` to a page-named path | **OPEN — [#36](https://github.com/tarwin/tinyjsapp/issues/36)**: file written, 2/2 verified runs (after the settle-delay fix) | harness filesystem check |
| T9 | postMessage spoof barrage incl. fake `win.close` | **PASS — no effect**: app alive through the barrage; the backend is socket-only | harness liveness check |

## Manual click-throughs (need eyes, not a harness)

- **External-link policy**: wrap with `--external trusted.example`, click a
  link to a *listed* domain (must open in the default browser) and an
  *unlisted* one (must stay in-app).
- **Redirect re-keying**: wrap google.fr; let it redirect to
  consent.google.com — the gate must re-key (it does); the frameless drag
  strip's window verbs die (known Studio limitation,
  [ROADMAP](../../ROADMAP.md) Phase 3 #14 — fix proposed upstream: window
  chrome belongs in `API_ALWAYS`).
- **Built-app env scrubbing**: build a wrap, then from the page dump
  `process`-adjacent env via the bridge — `TINYJS_*`/`WEBVIEW2_*` must be
  absent in the built app (they are present under `tinyjs dev`, which is a
  developer context, by design).
- **Media consent**: wrap a getUserMedia page — camera/mic must go through
  the gate and surface a consent path, never auto-grant ([#24](https://github.com/tarwin/tinyjsapp/issues/24) tracks the bundled-app case).

## Reading a result

- `PASS` is the good column. `FAIL — Object.prototype polluted` or an
  executed escape is a finding: file it upstream (private advisory for
  exploitable classes — see [SECURITY.md](../../SECURITY.md)), never a
  public issue.
- `OPEN — #36` is not a regression; it is the documented hole, here so the
  fix is *provably* the fix.
- `INFO` rows are behavioral observations with no privilege gain — worth
  telling upstream, not worth alarming users.
- `CHECK manually` means neither the page nor the harness could observe the
  outcome alone — the manual list above decides it.
