[tinyjs](https://tinyjs.app) — a small runtime by [Tarwin Stroh-Spijer](https://github.com/tarwin) — builds desktop apps that render with the WebKit (or WebView2) your OS already ships: **~6 MB** per app, no bundled browser, no Electron. Everything it does, it does through a CLI.

So I built the GUI that CLI deserved — **[TinyJS App Studio](https://github.com/slabbdev/tinyjsapp-studio)** — and, in proper Inception fashion, built it *with tinyjs itself*. And it's not just a site-wrapper: it's a workspace for the whole CLI. A projects sidebar with a file tree per project, a live preview stage, a config inspector — create apps from templates, open any existing tinyjs folder on disk, run and build with every log line streamed into the window, edit files in place. Wrapping any website into a real desktop app is just its flashiest trick.

Why does that trick matter? Because the site-wrapper space is crowded but heavy: [Nativefier](https://github.com/nativefier/nativefier) is archived (since 2023), WebCatalog wraps your site in a full Chromium — hundreds of MB per app — Unite charges $15 and only speaks macOS, ToDesktop wants $58/month to ship Electron, and Wavebox is a subscription to use a browser. tinyjs does it in ~6 MB with the browser you already have; the Studio makes it two clicks and a live preview.

## What it does

Four actions, zero terminal:

- **Create an app** — runs `tinyjs new` for you: zero-dependency vanilla templates, or a Vite + npm one (React, Vue, Svelte, Solid — TypeScript).
- **Wrap a website** — paste a URL, pick your window options, hit generate. Out comes a real desktop app: native window, downloads and popup handling, a per-origin API gate, ~6 MB.
- **Open an existing project** — point the Studio at any tinyjs folder on disk; it joins the sidebar, no files moved.
- **Run, build, stop, duplicate, reveal** — drive `tinyjs dev` / `tinyjs build` on the selected project, with every line of the CLI streamed live into the window.

Every wrap option mirrors into the preview live — flip on menu-bar mode and you see the dropdown panel before you generate.

## Menu-bar apps, iPhone frames, and a real editor

**Menu-bar mode** puts a tray icon in the system menu bar; click it and a dropdown panel anchored under the icon opens the site — a Slack-style helper app without the Slack.

![A wrapped site live in the menu-bar dropdown panel](https://raw.githubusercontent.com/slabbdev/tinyjsapp-studio/main/screenshots/08-dropdown-panel-live.png)

**iPhone mode** switches the user-agent preset *and* reshapes the preview into a phone frame — you see the mobile layout before you wrap, not after.

![The preview becomes a phone frame under the iPhone UA preset](https://raw.githubusercontent.com/slabbdev/tinyjsapp-studio/main/screenshots/03-iphone-preview.png)

And the file tree isn't decoration: click a code file and it opens in a vendored **CodeMirror 6** editor — line numbers, folding, syntax highlighting — edit and save right there. Images open as previews, including the icon you just generated for your app.

![Editing index.html in the CodeMirror editor](https://raw.githubusercontent.com/slabbdev/tinyjsapp-studio/main/screenshots/04-editor-codemirror.png)

## The part I'm proud of: it's tinyjs all the way down

This isn't an Electron app wearing a tinyjs t-shirt. The Studio *is* a tinyjs app, and `src/` reads as a tutorial for the runtime. The whole backend — spawning processes, streaming logs, native dialogs — is ~600 lines:

```js
// src/main.js — a thin, honest shell around the tinyjs CLI (abridged)
const p = tjs.spawn([bin, ...argv], { cwd, stdout: 'pipe', stderr: 'pipe' });
pump(app, p.stdout, 'out');   // line-buffer stdout into the page's log pane
pump(app, p.stderr, 'err');
const w = await p.wait();
app.push('done', { label, code });
```

`app.push` is the bridge: backend events stream straight into the page, and the frontend subscribes like it's any event emitter. The other direction is just as short — native folder pickers driving the UI, API calls to the backend:

```js
// src/frontend/app.js
tiny.api.on('log', (line) => log(line));
tiny.api.on('done', ({ label, code }) => busy(false));

const dir = await tiny.dialog.pickFolder();       // native dialog
tiny.api.call('saveFolder', { path: dir });       // backend call
```

Backend: 587 lines. Frontend: 562. The whole app — including CSS — is about 2,000 lines. If you want to learn what tinyjs feels like as a developer, read `src/`; everything it does is stock tinyjs.

And the payoff of all that code: every generate/run loop ends in a real desktop window — here's a wrapped site living in its own frameless window, chrome and all:

![A wrapped site live in a real frameless desktop window](https://raw.githubusercontent.com/slabbdev/tinyjsapp-studio/main/screenshots/07-wrapped-site-live.png)

## Running it

```sh
git clone https://github.com/slabbdev/tinyjsapp-studio
cd tinyjsapp-studio
tinyjs dev
```

Requirements and honest caveats:

- [tinyjs](https://tinyjs.app) is macOS-first right now; Windows and Linux are in beta.
- The `wrap` command shipped upstream in tinyjs v0.44.0 — older installs report *not in this release yet* in the Wrap tab; Create / Run / Build carry on, and the status bar shows whether your tinyjs has wrap.
- On security: a wrapped site gets **no** access to your machine beyond its own window and dialogs. That gate is tinyjs' per-origin API policy — I want credit where it's due, not to claim it.

`tinyjs build` ships the whole Studio as a signed `.app` (macOS) or binaries (Windows/Linux) in a few megabytes.

## What's next

The [roadmap](https://github.com/slabbdev/tinyjsapp-studio/blob/main/ROADMAP.md) is where it gets fun: unread-count badges on the dock icon, a one-click catalog of site recipes (Notion, Figma, YouTube Music…), a reader mode powered by tinyjs' no-CORS backend fetch — something Chromium shells can't do — and a publish button on top of `tinyjs publish`: ToDesktop's paid auto-update pipeline, free.

If a tiny studio that creates, runs, edits — and wraps — desktop apps at ~6 MB a pop sounds better than shipping a Chromium per site, give it a spin — issues and PRs welcome.

- **Studio**: https://github.com/slabbdev/tinyjsapp-studio
- **tinyjs**: https://tinyjs.app — [source](https://github.com/tarwin/tinyjsapp), by [Tarwin Stroh-Spijer](https://github.com/tarwin). Not an official tinyjs project — just what I consider the demo it deserved. 🙂

If the Studio saves you a click, [a coffee is appreciated](https://buymeacoffee.com/samlabbe) ☕