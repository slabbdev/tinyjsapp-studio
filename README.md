# TinyJS App Studio

![TinyJS App Studio — native apps have never been this easy](assets/banner-wide.png)

**[🌐 Landing page](https://slabbdev.github.io/tinyjsapp-studio/)** — the screenshot tour, scroll by scroll.

A tiny desktop companion for [tinyjs](https://github.com/tarwin/tinyjsapp) —
create tinyjs apps and turn websites into desktop apps, without opening a
terminal. Built **with** tinyjs itself, which makes it the two things at once:

- **A living demo for developers.** Everything here is stock tinyjs — a native
  window, the bridge pushing streamed subprocess logs to the page, native
  folder pickers driving the UI, a JS backend with full process access in a
  few hundred lines. Read `src/` as the tutorial.
- **A gentle on-ramp for newcomers.** Pick a folder, name your app, click
  *Create*, watch the logs, hit *Run*. No shell required. The *Wrap* tab
  turns any website into a real desktop app the same way.

Built by [@slabbdev](https://github.com/slabbdev). Not an official tinyjs
project — just what its author considers the demo tinyjs deserved. 🙂

## See it

**Wrap any site.** Paste a URL, pick your window modes, watch the preview
mirror every option — then generate a ~6 MB desktop app with its own icon,
per-origin API gate, downloads and popup handling.

![Wrapping a site — the dropdown panel preview](screenshots/02-wrap-panel-preview.png)

**Menu-bar apps, live.** Menu-bar mode puts a tray icon in the system menu
bar — click it and a dropdown panel anchored under the icon opens the site
(tray click can also open a normal window):

![A wrapped GitHub profile in the panel](screenshots/08-dropdown-panel-live.png)

**Real windows, really wrapped.** The generated apps are ordinary desktop
windows — frameless or not, with whatever chrome you configured:

![A wrapped GitHub profile in a frameless window](screenshots/07-wrapped-site-live.png)

## The workspace

**Everything in one place.** Projects sidebar (with a file tree per
project), live preview stage, config inspector — sections Site, Window,
Behavior.

**The file offcanvas.** Click a file in a project's tree: images open as a
preview, code files open in an editor with line numbers, code folding and
syntax highlighting (CodeMirror 6, vendored) — edit and save right there.

![The CodeMirror editor on index.html](screenshots/04-editor-codemirror.png)

![Previewing a generated icon](screenshots/05-image-preview.png)

**iPhone mode.** The iPhone user-agent preset also reshapes the preview
into a phone frame — you see the mobile layout before you wrap:

![iPhone UA — the preview becomes a phone](screenshots/03-iphone-preview.png)

## What it does

- **Create an app** — runs `tinyjs new` for you: the zero-dependency vanilla
  templates, or a Vite + npm one (react/vue/svelte/solid, TypeScript).
- **Wrap a website** — runs `tinyjs wrap`: a site becomes a real desktop app
  (native window, downloads, popup handling) whose pages get **no** access to
  your machine beyond their own window and dialogs — that gate is tinyjs'
  per-origin API policy, not a Studio promise.
- **Open an existing project** — point the Studio at any tinyjs project
  folder anywhere on disk; it joins the sidebar with all its actions, no
  files moved.
- **Run, build, stop, duplicate, reveal** — drive `tinyjs dev` / `tinyjs
  build` on the selected project, with every line of the CLI streamed live
  into the window.

## Requirements

- [tinyjs](https://tinyjs.app) installed (macOS; Windows and Linux in beta).
- The **wrap** command is new: until it lands in a tinyjs release, point the
  Studio at a tinyjsapp checkout that has it. It is found automatically when
  the checkout sits next to this repo (`../tinyjsapp`), or set `TINYJS_BIN`.

The Studio finds the CLI in this order:

1. `TINYJS_BIN` environment variable
2. a `tinyjsapp` source checkout next to this repo
3. the installed CLI (`~/.tinyjs/tinyjs`, `%LOCALAPPDATA%\tinyjs\tinyjs.cmd`, or `PATH`)

The resolved binary and version show in the window's status bar.

## Run it

```sh
git clone https://github.com/slabbdev/tinyjsapp-studio
cd tinyjsapp-studio
tinyjs dev
```

Ship it like any tinyjs app: `tinyjs build` packages the whole Studio in a
few megabytes (a signed `.app` on macOS, binaries on Windows/Linux). No
Electron in sight, because there is no bundled browser: tinyjs renders with
the WebKit (or WebView2) your OS already has.

## Credits

- [tinyjs](https://github.com/tarwin/tinyjsapp) by
  [Tarwin Stroh-Spijer](https://github.com/tarwin) — the tool, the runtime,
  and the `wrap` plumbing this Studio drives. Docs at [tinyjs.app](https://tinyjs.app).
- The wrap command itself is being contributed upstream; this repo consumes
  it, it does not reimplement it.

## Support

If the Studio saves you a click, a coffee is appreciated ☕

<a href="https://buymeacoffee.com/samlabbe"><img src="assets/bmc-qr.png" alt="Buy Me a Coffee — buymeacoffee.com/samlabbe" width="240"></a>

## License

[MIT](LICENSE)
