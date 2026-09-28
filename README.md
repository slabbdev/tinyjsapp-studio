# TinyJS App Studio

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

![TinyJS App Studio — the Wrap a website tab, with a wrapped project in the
projects strip](screenshot.png)

## What it does

- **Create an app** — runs `tinyjs new` for you: the zero-dependency vanilla
  templates, or a Vite + npm one (react/vue/svelte/solid, TypeScript).
- **Wrap a website** — runs `tinyjs wrap`: a site becomes a real desktop app
  (native window, downloads, popup handling) whose pages get **no** access to
  your machine beyond their own window and dialogs — that gate is tinyjs'
  per-origin API policy, not a Studio promise.
- **Run, build, stop, reveal** — drive `tinyjs dev` / `tinyjs build` on the
  project you just made, with every line of the CLI streamed live into the
  window.

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

## License

[MIT](LICENSE)
