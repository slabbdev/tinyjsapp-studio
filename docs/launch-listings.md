# Listings — textes prêts à coller (AlternativeTo, Saashub, LibHunt, etc.)

## AlternativeTo — TinyJS App Studio (proposer comme alternative à Nativefier)

**Nom :** TinyJS App Studio

**Full description (EN) :**

```
TinyJS App Studio turns any website or JavaScript project into a real desktop app in a couple of clicks — no terminal, no Electron, no bundled Chromium. It's a GUI for the tinyjs runtime: apps render with the WebKit (or WebView2) browser your OS already ships, so a wrapped site costs ~6–8 MB on disk instead of hundreds.

Wrapped apps are real native windows with their own icon, tray/menu-bar mode (dropdown panel included), dock badge, downloads and popup handling, and per-app storage isolation — two wraps of one site are two separate accounts. A permission gate decides exactly what each site may call (windows, dialogs, notifications — never the filesystem, clipboard reads, or secrets), visible and editable in the app, with a published threat model and an attack suite that runs in CI.

Also does: one-click recipes for popular sites (Notion, Figma, Gmail, WhatsApp, ChatGPT…), an importer for archived-Nativefier apps, project templates (vanilla, React, Vue, Svelte, Solid, Preact, Lit, Alpine), a built-in code editor, live preview, and free auto-updates via `tinyjs publish`.

Free and open source (MIT), macOS / Windows / Linux.
```

**Commentaire "why as alternative" :**

```
Nativefier is archived since 2023 and ships a full Chromium per app (~300 MB). TinyJS App Studio is actively maintained, ~6–8 MB per app (it uses the OS webview), adds a visible permission gate + published threat model, a one-click catalog, and an importer that reads your old Nativefier apps and prefills the wrap.
```

**Tags à cocher :** Website to Desktop App, Site-Specific Browser, Open Source, Free

---

## Saashub / LibHunt — description courte

```
A tiny desktop studio for the tinyjs runtime: create apps from templates or wrap any website into a real ~6 MB desktop app — permission-gated, storage-isolated, with a published threat model and an attack suite that runs in CI. Includes a one-click catalog and a Nativefier importer.
```

**Tagline (LibHunt) :**

```
Wrap any site into a ~6 MB desktop app — with published attack results
```

---

## Compte-rendu de comparaison (pour Deskifier/Pake queries — à poster en blog ou gist)

**Titre :** Choosing a Nativefier replacement in 2026: what each option actually ships

**Angles factuels (chiffres mesurés, pas d'invective) :**

| Critère | TinyJS App Studio | Pake / Deskify (Tauri) | Deskifier | WebCatalog |
|---|---|---|---|---|
| Moteur | webview de l'OS | webview de l'OS | Electron (bundlé) | Chromium (bundlé) |
| Poids disque par app | ~8 MB (mesuré) | ~5–10 MB | ~300 MB | ~300 MB |
| GUI sans terminal | ✅ complète | ❌ CLI | ✅ | ✅ |
| Gate de permissions visible/éditable | ✅ GUI + trust summary | config manuelle | ? | ❌ |
| Threat model publié + suite d'attaque en CI | ✅ le seul | ❌ | ❌ | ❌ |
| Import Nativefier | ✅ | ❌ | ✅ (pitch) | ❌ |
| Catalogue de recettes | ✅ 20, contribuable | ❌ | ❌ | ✅ (payant) |
| Prix | gratuit, MIT | gratuit | freemium | freemium/abonnement |

**Règle de ton :** les cases « ? » restent des questions, jamais des
accusations ; chaque chiffre pointe docs/BENCHMARKS.md ou le repo concerné.
