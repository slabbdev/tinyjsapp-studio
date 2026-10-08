# Show HN — draft (à poster de ta main)

## Titre (deux options — la 2 est plus HN)

1. `Show HN: TinyJS App Studio – wrap any website into a ~6 MB desktop app`
2. `Show HN: We published a threat model and attack suite for our site-wrapper`

## Texte d'accompagnement (premier commentaire / "text" du post)

Hi HN! I built a GUI for [tinyjs](https://tinyjs.app), a small runtime by
Tarwin Stroh-Spijer that renders desktop apps with the WebKit/WebView2 your
OS already ships — so a wrapped site is ~6–8 MB instead of the ~300 MB a
bundled-Chromium wrapper costs. Then, in Inception fashion, I built the GUI
*with* tinyjs itself: https://github.com/slabbdev/tinyjsapp-studio

What it does: wrap any site (or scaffold from templates), with a permission
gate you can see and edit — the OS-chrome verbs a wrapped site may call,
per origin, in a GUI instead of config files. A catalog of one-click
recipes, an importer for archived-Nativefier apps, per-app storage
isolation (two wraps of one site = two accounts).

The part I expect this crowd to care about: we published a
[threat model](https://github.com/slabbdev/tinyjsapp-studio/blob/main/docs/THREAT-MODEL.md)
and an [adversarial suite](https://github.com/slabbdev/tinyjsapp-studio/tree/main/test/adversarial)
that attacks our own wraps — a hostile page running probe classes against
the gate, verified live, results in the open. My favorite bug: we found a
wrapped site could write a PDF to any path it named (tinyjs #36), published
it, the runtime fixed it in v0.48.0, and the same suite proved the fix from
the outside. When v0.50.1 gated macOS subframe calls, the suite verified
that too. It now runs on every push as CI.

Credit where it's due: every security property is the tinyjs runtime's —
Tarwin's audit trail (#18, #26, #29, #30) is the work; the Studio surfaces,
configures and proves it from the outside. The whole Studio is ~2,800 lines
of stock tinyjs, so `src/` doubles as a runtime tutorial.

Measured vs an Electron shell, same page and signal: 8 MB vs 337 MB on
disk, 49 MB vs 143 MB RAM (methodology:
[docs/BENCHMARKS.md](https://github.com/slabbdev/tinyjsapp-studio/blob/main/docs/BENCHMARKS.md)).

Honest limits: macOS is first-class, Windows/Linux beta; macOS builds are
ad-hoc signed (notarization in progress); and a wrapped site can still
phish you inside its window — a gate can't fix social engineering.

Ask: what would make you trust a site-wrapper enough to actually wrap your
daily driver?

## Commentaires probables — réponses prêtes

- **"Just use a browser profile / PWA"** → PWA install = pas de gate
  explicite, pas de badge/tray, dépend du site qui l'expose ; un wrap
  fonctionne sur n'importe quel site. (ton : expérience vécue, pas débat)
- **"Tauri does this"** → Tauri est un framework pour devs ; ici pas de
  build Rust, et les capabilities deviennent une GUI. Et on publie nos
  attaques.
- **"6 MB = the browser is already on disk"** → oui, assumé — l'OS patche
  son webview pour toutes les apps ; 300 MB par wrapper c'est un treadmill
  de mises à jour Chromium par app.
- **"Security is tinyjs's, not yours"** → exact, et dit partout — on
  l'expose, on la prouve de l'extérieur, on n'en revendique pas la
  paternité.
- **"3 stars, why should I care"** → c'est un Show HN, justement :)
