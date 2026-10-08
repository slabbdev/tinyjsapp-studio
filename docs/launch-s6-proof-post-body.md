Every time someone posts a site-wrapper, the same question shows up in the
comments: *"ok but is it secure like Tauri?"*

Until now, the honest answer for this whole product category was silence.
Nativefier died without a threat model. WebCatalog, Unite, Wavebox —
nothing published. Tauri and Electron publish security docs, but they're
frameworks, not wrappers. So I want to answer the question the only way I
think it deserves: not with adjectives, with evidence.

[TinyJS App Studio](https://github.com/slabbdev/tinyjsapp-studio) is a GUI
for the [tinyjs](https://tinyjs.app) runtime — it turns any website into a
real desktop app (~6–8 MB, no bundled Chromium) and scaffolds tinyjs
projects. It's built with tinyjs itself. And as of this month, it ships
with three things no other site-wrapper has: a published threat model, an
adversarial suite that attacks its own wraps, and CI that runs the attacks
on every push.

## First, the honest part

**The security properties are not mine.** They're the tinyjs runtime's, by
maintainer [Tarwin Stroh-Spijer](https://github.com/tarwin). A wrapped page
holds an RPC channel to a backend with full user permissions — that's what
makes a wrapper useful — and what makes it shippable is tinyjs'
[per-origin capability gate](https://tinyjs.app/docs): a deny-by-default
policy, enforced in the backend (where a hostile page can't edit the
check), that decides which bridge methods each origin may call. Around it:
subframe gating so a hostile iframe can't borrow the top frame's gate, a
session-token handshake on the app↔window pipe, per-app storage isolation,
and an updater that verifies signatures and rolls back.

Tarwin also did something rare: an external audit he engaged with in the
open — issues [#18](https://github.com/tarwin/tinyjsapp/issues/18),
[#26](https://github.com/tarwin/tinyjsapp/issues/26),
[#29](https://github.com/tarwin/tinyjsapp/issues/29),
[#30](https://github.com/tarwin/tinyjsapp/issues/30), each fixed with
per-platform verification commits, shipped across v0.45–v0.47.

My contribution is what wraps *that*: the Studio always writes a gate into
generated apps, shows it as a GUI (a Permissions section when you wrap, a
Gate tab that shows any project exactly what its pages may call), and —
the subject of this post — proves it from the outside.

## The suite: a hostile page, wrapped like any other

[test/adversarial](https://github.com/slabbdev/tinyjsapp-studio/tree/main/test/adversarial)
is a deliberately malicious page that the Studio wraps exactly like any app
a user would generate. On load it runs probe classes: bridge calls from a
stranger origin, `win.open` escapes (`file:`, `javascript:`, path walks),
`tiny.store` prototype pollution, a cross-origin iframe trying to reach the
backend, malformed wire messages, and a PDF path-write. The harness checks
what a page can't hide from the outside — files actually written, URLs
actually fetched, whether the app survived.

Current results, verified live against tinyjs v0.50.1:

| Probe | Result |
|---|---|
| `fs.read`, `clip.read`, `debug.get`, `spotlight.index` from the wrapped origin | **denied**, readable rejection reasons |
| `file:///etc/passwd` popup | re-keyed onto the site's origin, disk untouched |
| cross-origin iframe → bridge | not even injected into the subframe |
| same iframe → raw WebKit handler | call stamped with the iframe's own origin, **denied** |
| `__proto__` / `constructor` into `tiny.store` | stored as inert data, `Object.prototype` clean |
| 15 malformed wire payloads | dropped or rejected, nothing executes |
| `win.printToPDF` at a protected path | never written — save panel instead |

## The best part: we published the hole, then proved the fix

Probe T8 found something real: under the default wrapper posture, a wrapped
site could call `win.printToPDF` with **any path it named** — arbitrary
file clobbering. I filed it publicly as tinyjs
[#36](https://github.com/tarwin/tinyjsapp/issues/36), reproduced by the
suite, hole open in the threat model.

The fix landed in tinyjs v0.48.0: writes confined to Downloads, the app's
data folder, and temp; any other path opens a save panel. The suite was
waiting. The same probe split in two — a temp write (allowed zone, by
design) and a protected path (must never produce a file) — and both pass.
That's the loop I want this category to have: **hole published → fix
shipped → fix proven from outside.** Not "trust us."

When v0.50.1 gated macOS subframe calls, the suite verified that live too:
the forged call stamped with the iframe's own origin and denied, the decoy
URL never reaching the decoy server.

## What's still open — on purpose

[#19](https://github.com/tarwin/tinyjsapp/issues/19): Windows artifacts
aren't signed yet. [#40](https://github.com/tarwin/tinyjsapp/issues/40):
the self-update hash comes from the same host as the zip — the signed-
update design (ed25519, key baked into the app) is being worked out in the
open. The Studio's own macOS builds are ad-hoc signed until my
notarization keys are wired into CI. And the honest social-engineering
note: a wrapped site can still phish you *inside its window* — the gate
constrains code, not lies.

## Attack it yourself

Everything is in the repo:
[THREAT-MODEL.md](https://github.com/slabbdev/tinyjsapp-studio/blob/main/docs/THREAT-MODEL.md),
[the suite](https://github.com/slabbdev/tinyjsapp-studio/tree/main/test/adversarial)
(`sh test/adversarial/run.sh` — ~30 s, a probe window blinks),
[SECURITY.md](https://github.com/slabbdev/tinyjsapp-studio/blob/main/SECURITY.md)
for private reports, and a
[CI badge](https://github.com/slabbdev/tinyjsapp-studio/actions/workflows/adversarial.yml)
that goes green only while the attacks keep failing.

Found a hole the suite missed? That's the best possible issue — private
advisory first, public credit after. Found one in the runtime? Tarwin's
advisory flow is the door.

*Studio: https://github.com/slabbdev/tinyjsapp-studio — the GUI is mine;
the guarantees are tinyjs', and the audit trail that earned them is
[Tarwin's](https://github.com/tarwin). If this saved you a click,
[a coffee is appreciated](https://buymeacoffee.com/samlabbe).*
