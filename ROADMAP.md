# Roadmap — making TinyJS App Studio the reference

The site-wrapper space is crowded but heavy: Nativefier (dead, archived 2023),
WebCatalog, Unite/Coherence (paid, macOS-only), Wavebox/Ferdium (a whole
browser), ToDesktop ($58/mo to ship Electron), and free PWA installs. Every
one of them either ships a Chromium per app (~200–400 MB) or charges money for
the privilege. tinyjs ships **~6 MB** and uses the browser the OS already has.

This file maps what competitors do well onto what tinyjs can do today, and the
order in which we take it.

## What the competition is good at

| Feature | Who has it | tinyjs today |
| --- | --- | --- |
| Unread badge (dock/taskbar) | Nativefier, WebCatalog | `app.badge` exists — needs a per-site CSS selector + inject |
| Tray / menu-bar mode | Nativefier, WebCatalog, Ferdium | `"activation": "accessory"` + tray exist — needs a checkbox |
| Inject CSS/JS per site | Nativefier `--inject`, Unite userscripts | `"inject"` exists — needs a Studio editor |
| UA spoof / mobile mode | Nativefier, Unite | `userAgent` exists — needs presets in the UI |
| Open external links in browser | Nativefier | `onNavigate` policy exists (`'external'`) — needs a domain list |
| Always on top / fullscreen | Nativefier | `setAlwaysOnTop` / `setFullscreen` exist |
| Multi-account isolation | WebCatalog workspaces, Wavebox | **already works** — each app is its own container (per-app-id storage); needs a "Duplicate app" action |
| Claim `mailto:`/custom schemes | WebCatalog | `urlScheme` exists |
| Auto-updates | ToDesktop (their whole pitch, ~$58/mo) | `tinyjs publish` exists, free |
| Ad blocker | Unite | **needs upstream**: content-rule lists in the launchers |
| Site notifications as native toasts | WebCatalog | **needs upstream**: notify bridge |
| True workspaces (multi-account in one window) | Wavebox, WebCatalog | **needs upstream**: per-window data stores |
| Curated catalog of ready-made apps | WebCatalog, Ferdium recipes, Nativefier CATALOG.md | Studio-level: recipes are just JSON |
| Reader mode / backend superpowers | nobody | tinyjs backend (`tiny.fetch` no-CORS, SQLite) — unique |

## Phase 1 — parity killers (Studio-level only, no upstream work)

1. **Badge**: "unread selector" field per wrap → generated inject watches it,
   pushes `app.badge(n)` / clears it.
2. **Window options** row: menu-bar app (`accessory` + tray), always-on-top.
3. **UA presets**: desktop / mobile / iPhone dropdown (writes `userAgent`).
4. **External links**: optional comma-separated domain list → `onNavigate`
   answers `'external'`; everything else stays in-app.
5. **Duplicate app**: clone any project card into a new name/id — the
   multi-account story ("wrap the same site twice, sign in twice"), two clicks.
6. **Reset site data** action per project: dev webviews persist a
   WKWebsiteDataStore keyed by app title (~/Library/WebKit/<title>), so stale
   cookies survive re-wraps — a Google wrap kept serving its basic-HTML
   fallback through a cookie preference even after the UA fix. One button to
   wipe it; pairs with "sign out" for wrapped accounts.

## Phase 2 — the differentiators

6. **Catalog**: curated recipes (`catalog/*.json`: url, title, icon, badge
   selector, css, UA) → a Catalog tab with one-click generation. Seed ~20
   (Notion, Figma, YouTube Music, Gmail, Linear…). Community-contributed via
   PRs — Nativefier's CATALOG.md proved the demand; nobody made it one click.
7. **Per-site CSS/JS manager**: list + editor per project, wired to `inject`.
8. **Reader mode** toggle per wrap: backend fetch + extraction — the demo
   that a wrapper with a real backend can do things Chromium shells cannot.
9. **Publish button**: `tinyjs publish` + auto-update manifest from the
   Studio — ToDesktop's paid pipeline, free.
10. **Benchmarks** in the README: measured size/RAM/startup vs a WebCatalog
    app and a PWA install. The number is the marketing.

## Phase 3 — upstream levers (issues/PRs to tinyjsapp, like #20/#21)

11. **Content blocker** (WKContentRuleList / WebView2 rule lists) → real
    adblock toggle. Issue first; biggest single feature Unite has that we lack.
12. **Per-window data stores** → true multi-account inside one app
    (Wavebox-style workspaces).
13. **Site notifications → native toasts** bridge.
14. **Window-chrome verbs must survive redirects**: the frameless drag-strip's
    `win.close/minimize/zoom` are subject to the per-origin gate — when a
    wrapped site redirects to a stranger origin (google.fr →
    consent.google.com), the app's own window controls die. Window chrome is
    app machinery, not site capability: those verbs belong in API_ALWAYS
    (next to `client.hello`). Measured live on a google.fr wrap.

## The pitch, one line

> WebCatalog ships you a Chromium per app. Unite charges $15 and stays on one
> Mac. Wavebox is a subscription to use a browser. TinyJS App Studio turns any
> site into a 6 MB, permission-gated, auto-updating desktop app — free,
> cross-platform, scriptable.
