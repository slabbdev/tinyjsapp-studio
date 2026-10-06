# Security policy

TinyJS App Studio is a GUI for the [tinyjs](https://tinyjs.app) runtime. Two
surfaces, two flows — please read the scope before reporting.

## Scope

**This repo (the Studio)** — the desktop app itself and everything it
generates or writes:

- `src/main.js` — the backend: CLI resolution, one-click installer, streaming,
  the per-project sidecar (`.tinyjs-studio.json`), and the finishing pass that
  patches generated `tinyjs.json` files (chrome keys, inject, the badge gate
  exception).
- `src/frontend/` — the Studio UI and the CodeMirror vendor bundle.
- Generated artifacts: the `inject.js` drag strip, the config edits the Studio
  applies on top of `tinyjs wrap`.

**Not this repo (the tinyjs runtime)** — the security properties a wrapped
site actually faces: the per-origin capability gate, the RPC transport and its
session-token handshake, `win.open` confinement, subframe token gating,
storage isolation, the self-updater. Those live in
[tarwin/tinyjsapp](https://github.com/tarwin/tinyjsapp) and are documented in
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) with links to the issues and
releases that shipped them. The Studio inherits them; it does not implement
them.

## How to report

- **Studio vulnerabilities** — use
  [GitHub private vulnerability reporting](https://github.com/slabbdev/tinyjsapp-studio/security/advisories/new).
  Do not open a public issue.
- **tinyjs runtime vulnerabilities** (anything a wrapped or hosted page could
  abuse, bridge, launchers, updater, build chain) — report through the
  [tinyjsapp security advisory flow](https://github.com/tarwin/tinyjsapp/security/advisories/new)
  so they reach the runtime maintainer directly. If you'd rather route it
  through us, open a private Studio advisory and we will forward it — but the
  fix and the disclosure happen upstream.

We aim to acknowledge reports within a few days and to coordinate disclosure
with the reporter. No bounty program — credit in the release notes and the
threat model instead.

## Please don't

- Don't open public GitHub issues for suspected vulnerabilities, here or
  upstream.
- Don't test against third-party wrapped apps or anyone else's machine — the
  [adversarial suite](test/adversarial/) runs against a local hostile page on
  your own machine only.
- Don't report as a Studio bug what is the runtime's documented posture (for
  example, "a wrapped site can open native dialogs" — that is the `wrapper`
  preset, by design: see the threat model).

## Supported versions

The Studio tracks the latest tinyjs release; security properties are those of
the runtime you drive it with (`tinyjs --version`). Security-relevant runtime
releases are called out in the
[changelog](https://tinyjs.app/changelog) — v0.47.0/0.47.1 (hardening batch 2:
proxy confinement, URL-scheme policy, malformed-message drops, bundled-installer
updates) and v0.48.0 (printToPDF zone restrictions) are the most recent.
