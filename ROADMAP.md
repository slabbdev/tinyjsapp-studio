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
| Publishes a threat model / security audit trail | Tauri, Electron | tinyjs now has the audit trail (#26/#29/#18, v0.45–0.46); Phase S adds the wrapper-level threat model — **no other site-wrapper has one** |

## Phase S — security: the question belongs to tinyjs; the Studio is how we surface, prove, and link it

Users are asking "is it secure like Tauri?" in comments. That question is about
tinyjs, the runtime — and tinyjs just answered it in code, not adjectives:
v0.44.0 shipped `wrap`; v0.45.0 shipped per-app WebView2 profiles (storage
isolation), env-var scrubbing in built apps, txiki.js hash pins, and a
`tiny.store` prototype-pollution fix; v0.46.0 is marked **security** — page
`win.open` confinement (no `file:`/`javascript:`/`../` walks), per-user
single-instance pipes with ACLs, a session-token handshake on the app↔window
pipe, and subframe token gating (a hostile iframe can no longer borrow the top
frame's gate). Behind it sits an audit trail: #26 (supply chain), #29
(Windows hardening), #18 (frame-blind origin attribution) closed with
per-platform `docs(verify)` commits; #30 is open as the next batch;
#19/#33 track Windows artifact signing.

The Studio's role is threefold — and it's what links the two projects, as
always: **surface** the runtime's guarantees as visible UI, **prove** them
from the outside, and **link** Studio ↔ tinyjs in every artifact (security
page → changelog and issues; Studio proposed upstream as the reference GUI).
No one else in the site-wrapper space publishes a threat model at all — being
the first *is* the #1 positioning.

S1. ✅ **Threat model, public** (`docs/THREAT-MODEL.md` + `SECURITY.md`). The
   wrapped site is the adversary. Document each tinyjs mechanism and credit
   it: deny-by-default per-origin capability gate (0.38+); RPC over a private
   Unix socket / named pipe with a session-token handshake (0.46); `win.open`
   confinement (0.46); subframe token gating (0.46); per-app storage
   isolation (per-app WKWebsiteDataStore on macOS, per-app WebView2 profile
   on Windows since 0.45); built apps drop inherited `TINYJS_*`/`WEBVIEW2_*`
   env (0.45); codesigned, notarization-ready builds; self-updater verifying
   sha256 + code signature with rollback. Then say the limits plainly: #30 is
   open (tiny-media proxy auth, navigation-scheme bypass, `curl | sh`
   updater), Windows artifacts aren't signed yet (#19/#33), and the backend
   process has full user access — no OS app sandbox. Honesty is the product.
   Plus `SECURITY.md` with GitHub private vulnerability reporting.
S2. ✅ **Adversarial suite** (verified live 2026-10-04 — see test/adversarial/README.md for the observed matrix) (`test/adversarial/`): each attack class maps to a
   shipped fix, and we prove it holds *from outside the project* — a hostile
   iframe posting a hand-built message to borrow the top frame's gate (#18/
   0.46), `win.open` file:// escapes (#29/0.46), cross-app cookie/localStorage
   sharing on Windows (#29/0.45), bridge calls from a stranger origin,
   `tiny.store` `__proto__` pollution (0.45), env-based injection into built
   apps (0.45), postMessage spoofing of the drag strip, redirect chains that
   re-key the gate. Run it on CI; publish a pass/fail table where each row
   links the tinyjs issue and release that fixed it.
S3. **Fix our own known hole before publishing**: the frameless drag-strip's
   window verbs die on cross-origin redirect (google.fr → consent.google.com)
   — a UX bug with a security reading; window chrome belongs in API_ALWAYS
   (Phase 3 #14). Open upstream items (#30, #19) go in the threat model's
   known-limitations section, not in a footnote.
S4. ✅ **Security page on the landing site** (site/security.html): "What can a wrapped site do?"
   Nothing you didn't allow — the gate, the handshake, the isolation, in user
   language, every claim a link into tinyjs's changelog or issues. Cross-link
   both projects: propose the Studio to Tarwin as the reference GUI for
   tinyjsapp-examples, and contribute the adversarial suite upstream as
   tinyjs integration tests.
S5. ✅ **Permission matrix in the Studio** (wrap form + Gate tab) (wrap form + config inspector):
   every bridge API × origin, visible and editable before generate — the gate
   made a feature, Chrome's site-permissions UX. After generate, a one-glance
   trust summary the user can screenshot ("this app exposes: `app.badge` →
   x.com only; window verbs → wrapper origins; external links → none").
S6. **The proof post** (blog #2): "Is it secure like Tauri? We attacked the
   runtime we build on and published the results." Leads with Tarwin's
   audit trail (#26/#29/#18 → v0.45–0.46), then our outside-in suite results;
   links the threat model, the security page, and the upstream issues. This
   is the artifact that answers the comments for good — and it credits the
   runtime instead of claiming the credit for the wrapper.

## Phase 1 — parity killers (Studio-level only, no upstream work)

1. **Badge** — mechanism ✅ (finishing pass + gate exception), UI pending: "unread selector" field per wrap → generated inject watches it,
   pushes `app.badge(n)` / clears it.
2. ✅ **Window options** row: menu-bar app (`accessory` + tray), always-on-top, panel mode.
3. ✅ **UA presets**: desktop / mobile / iPhone dropdown (writes `userAgent`).
4. **External links** — mechanism ✅, UI pending: optional comma-separated domain list → `onNavigate`
   answers `'external'`; everything else stays in-app.
5. ✅ **Duplicate app**: clone any project card into a new name/id — the
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

## Phase 3 — upstream levers (issues/PRs to tinyjsapp — #20 wrap and #21 shipped in v0.44; the security audit trail is #26/#29/#30)

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
> cross-platform, scriptable — and the only one that publishes its threat
> model and attack results.

## Phase D — the path to #1: distribution, migration, trust

The product plays are above; being #1 also takes being *found* and *chosen*.

D1. ✅ **Nativefier migration** — `MIGRATING.md` (flag-for-flag mapping)
   + the "Import Nativefier app…" button in the Studio (reads the source
   app's embedded nativefier.json, prefills the Wrap form, logs what maps
   and what needs re-entering). The SEO leg of the funnel is D3.
D2. **Ecosystem anchor** — the Studio listed in tarwin/tinyjsapp-examples
   and the tinyjs docs as *the* GUI (with Tarwin's go); tinyjs's README
   links back. Inception story: the GUI built with tinyjs.
D3. **Search & listings** — own the queries "nativefier alternative",
   "webcatalog alternative", "wrap website desktop app": enrich the
   saashub/libhunt/alternativeto pages that already index the DEV.to post,
   ship the benchmarks (Phase 2 #10) as the comparison artifact.
D4. **Signed, notarized Studio releases** — today ad-hoc signed (release.yml):
   Gatekeeper warnings undercut a security-first story. Notarize the
   Studio's own builds; Windows signing follows #33 upstream.
D5. **CI for the proof** — run the adversarial suite on a macOS runner per
   release; the security page shows a green badge with a date.
D6. **Launch waves** — S6 proof post (blog #2), Show HN with the #36
   reproduction as the hook, r/webdev, then ProductHunt once the catalog
   exists (launch #2, not #1).

**The #1 scoreboard**: GitHub stars vs every wrapper's repo · first result
for "nativefier alternative" · listed in every "best site-specific browser"
roundup · security page cited in discussions asking "is it secure like
Tauri?" · wraps shipped by the Studio (opt-in count, like Nativefier's
CATALOG did).
