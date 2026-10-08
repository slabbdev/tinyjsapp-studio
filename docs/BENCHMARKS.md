# Benchmarks — a tinyjs wrap vs an Electron shell

Measured 2026-10-08 on a MacBook Air (Apple Silicon, macOS 26), script in
[scripts/bench.mjs](../scripts/bench.mjs) — run it yourself:

```sh
node scripts/bench.mjs
```

## Methodology

Both contenders load the **same page from the same local server**, and the
page's JavaScript announces its own readiness (a `fetch('/loaded')`).

- **Disk** — `du -sm` of the shipped bundle: the tinyjs-built `.app` vs the
  Electron runtime an Electron-class app ships (`node_modules/electron`,
  i.e. what Nativefier/WebCatalog-style output embeds).
- **Cold start** — process spawn → the page's JS actually ran (median of 3
  runs). Includes macOS's first-launch overhead for both; treat single-digit
  seconds as noisy, the ratio is the signal.
- **RAM** — sum of the RSS of the whole process tree, sampled 5 s after the
  page is live (median of 3).

## Results

| | TinyJS wrap | Electron shell | ratio |
|---|---|---|---|
| Disk | **8 MB** | 337 MB | **42×** |
| Cold start (page live) | ~5.1 s | ~8.1 s | 1.6× |
| RAM, page live | **49 MB** | 143 MB | **2.9×** |

The honest caveats: the Electron row is the runtime alone (a real
Nativefier/WebCatalog app adds its own code on top); the cold-start numbers
carry macOS launch noise (Gatekeeper scans a fresh temp-dir bundle) — rerun
the script on your machine and trust your numbers. The disk and RAM rows
are structural: one side bundles a Chromium, the other uses the webview
your OS already ships and patches.

## Why this matters

Every Electron-based wrapper ships ~300 MB and a Chromium update treadmill
per app. A tinyjs wrap is ~8 MB and gets its engine updates from the OS.
The gap is the product.
