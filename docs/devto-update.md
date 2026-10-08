# DEV.to — update pour l'article publié

Deux éditions à faire sur https://dev.to/slabbdev (article du 29/09) :

1. **Remplacer la ligne périmée** (dans « Requirements and honest caveats »)
2. **Coller la section « Shipped since launch »** juste au-dessus de
   « Requirements and honest caveats »

---

## 1. Remplacement de la ligne périmée

**Trouver :**

```
- The `wrap` command is being contributed upstream and isn't in a release yet — until then, point the Studio at a tinyjs checkout that has it. It's found automatically when the checkout sits next to the repo, or set `TINYJS_BIN`.
```

**Remplacer par :**

```
- The `wrap` command shipped upstream in tinyjs v0.44.0 — older installs report *not in this release yet* in the Wrap tab; Create / Run / Build carry on, and the status bar shows whether your tinyjs has wrap.
```

---

## 2. Section à coller (au-dessus de « Requirements and honest caveats »)

```markdown
## Shipped since launch — the security update

The wrap command this Studio drove as a proposal is now part of tinyjs
itself (v0.44.0), and the releases since have been security-hardening
passes. Which brings me to the part I'm proudest of.

**"Is it secure like Tauri?" — we answered with evidence, not adjectives.**
No other site-wrapper publishes a threat model, so [we wrote one](https://github.com/slabbdev/tinyjsapp-studio/blob/main/docs/THREAT-MODEL.md):
every guarantee linked to the tinyjs release that shipped it, and the open
holes listed instead of hidden. Then we attacked our own wraps — a hostile
page wrapped like any app the Studio generates, running [a published suite
of probes](https://github.com/slabbdev/tinyjsapp-studio/tree/main/test/adversarial)
(gate escapes, iframe bridge theft, malformed wire messages, PDF path
writes), with the results in the open:

- The best kind of finding: we published tinyjs issue #36 — a wrapped site
  could write a PDF to any path it named — reproduced live by our suite.
  The fix landed in tinyjs v0.48.0, and the same suite proved *the fix*
  from the outside, two runs, before and after.
- When tinyjs v0.50.1 gated macOS subframe calls (an iframe could
  previously ride the top frame's gate), our suite verified the fix live:
  the forged call stamped with the iframe's own origin, denied.

**The gate became a GUI.** What Tauri asks you to write as capability files
and Electron as a docs checklist, the Studio makes visible: a Permissions
section when you wrap (the `wrapper` posture by default, custom chips over
the real wire methods, the generated config previewed as it will be
written), and a **Gate tab** that shows any project exactly what its pages
may call — per origin, with a one-glance trust summary and warnings for the
sharp edges. You can read it all in user language on [the security
page](https://slabbdev.github.io/tinyjsapp-studio/security.html).

**Also new since launch:**

- **Import Nativefier app…** — Nativefier is archived (since 2023); pick
  your old app, the Studio reads its embedded config and prefills the wrap.
  [Flag-for-flag migration guide](https://github.com/slabbdev/tinyjsapp-studio/blob/main/MIGRATING.md).
- Unread badge selector, open-in-browser domains, and a *Reset data* action
  (wipe an app's cookies/site storage) — all in the form.
- Menu-bar dropdown panels, duplicate-as-container (multi-account), and a
  one-click tinyjs installer for a fresh machine.
- New templates: preact, lit, alpine (plus react/vue/svelte/solid).

Credit where it's due, as always: every security property is a tinyjs
runtime property — [Tarwin's audit trail](https://github.com/tarwin/tinyjsapp/issues?q=is%3Aissue+hardening+OR+security)
(#18, #26, #29, #30, #36) is the work this Studio surfaces and proves from
the outside. The GUI is mine; the guarantees are his.
```

---

## 3. Si tu préfères l'édition minimale

Ne faire que le remplacement n°1, et remplacer le titre de l'article reste
inutile — DEV.to garde le slug de toute façon.
