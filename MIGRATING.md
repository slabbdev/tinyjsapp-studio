# Migrating from Nativefier

Nativefier is [archived](https://github.com/nativefier/nativefier) (read-only
since 2023): Electron-based, ~150–400 MB per app, and no more fixes — not for
bugs, not for security. TinyJS App Studio is the living path: ~6 MB apps that
render with the webview your OS already ships, a per-origin permission gate,
active maintenance, and a [published threat model](docs/THREAT-MODEL.md).

## The 30-second path

1. Open TinyJS App Studio.
2. In the sidebar, click **Import Nativefier app…** and pick your generated
   app (the `.app` on macOS, the app folder elsewhere).
3. The Studio reads the app's embedded `nativefier.json` and prefills the
   Wrap form — URL, name, window options, user agent.
4. Review, hit **Wrap site**. Log back into the site once (containers differ,
   by design — see below).

## Flag-by-flag

| Nativefier | Studio / tinyjs |
|---|---|
| `<url>` | **Site URL** — imported |
| `--name` | **Display name / Folder** — imported |
| `--inject <file.css/js>` | Paste the rules into your project's `inject.js` (the Studio generates one for frameless chrome/badge; append yours) |
| `--tray` | **menu bar app** checkbox (tray click → window or dropdown panel) |
| `--counter` / `--badge` | **Unread badge selector** — give the CSS selector of the site's unread count; the app mirrors it to the dock badge |
| `--always-on-top` | **always on top** checkbox |
| `--hide-window-frame` | **frameless** checkbox |
| `--user-agent <ua>` | **User agent → custom…** — imported verbatim (or keep the `browser` anti-sniffing preset, usually the better answer) |
| `--external-urls <regex>` | **Open in browser** — a comma-separated domain list (e.g. `mail.google.com, accounts.google.com`) |
| `--internal-urls <regex>` | The inverse of the above; unlisted domains stay in-app by default |
| `--single-instance` | Default — tinyjs apps are single-instance, with a per-user, ACL-guarded hand-off pipe |
| `--user-data-dir` | Not needed — every tinyjs app gets its own storage container automatically (cookies, localStorage, IndexedDB). Two wraps of one site are two accounts |
| `--fast-quit` | Not built (macOS window close hides). [Open an issue](https://github.com/slabbdev/tinyjsapp-studio/issues) if you miss it |
| `--zoom <factor>` | Not in the form yet; editable as `"zoom"` in the project's `tinyjs.json` |
| `--disable-dev-tools` | Dev tools don't exist in built apps |
| `--basic-auth-*` | Sites handle their own auth inside the app |
| `--proxy-rules` | Not built. [Open an issue](https://github.com/slabbdev/tinyjsapp-studio/issues) |
| `--platform` / `--arch` | **Build target** dropdown — this platform, Apple Silicon, Intel, universal (+DMG) |
| `--overwrite` | **Wrap site** on an existing folder overwrites in place |
| `--flash`, `--widevine` | Gone with the engines they served |

## What actually changes

- **Size**: ~150–400 MB of bundled Chromium → **~6 MB**. The trade: you trust
  your OS webview's updates instead of pinning Electron's.
- **One re-login per app**: Nativefier's `--user-data-dir` (or its shared
  default folder) differs from tinyjs's per-app container, so cookies don't
  carry over. Sign in once per migrated app.
- **Permissions, made explicit**: an Electron app's renderer was one blob of
  trust. A wrapped site here gets the `wrapper` posture — window controls,
  dialogs, notifications, its own storage — and nothing else; the **Gate**
  tab shows and edits exactly what its pages may call.
- **Automation**: everything the Studio does runs the real `tinyjs` CLI
  under the hood — scripts and CI welcome.

## Why we can import, not convert

A Nativefier app is an Electron app whose behavior lives in compiled JS and
injected patches; the honest port is its *intent* — URL, name, window
posture, UA — which is exactly what `nativefier.json` records and what the
importer prefills. The rest (badges, link routing) re-enters through better
mechanisms than the ones it leaves behind.
