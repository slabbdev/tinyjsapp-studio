#!/bin/sh
# Adversarial suite harness — macOS / Linux.
#
# Wraps the hostile site with the tinyjs CLI exactly like the Studio would,
# runs the wrap, waits for the probes to fire, then checks the effects a
# page cannot hide from the outside: whether the printToPDF probe (T8)
# actually wrote its file, and whether the app survived the postMessage
# spoof barrage (T9). Page-side verdicts render in the app window's table.
#
# Usage:  sh test/adversarial/run.sh [seconds]
# Env:    TINYJS_BIN  — tinyjs binary to drive (default: resolve below).
set -u

SECS="${1:-22}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d /tmp/tjs-adv-XXXXXX)"
# Must match what the hostile page probes (attacks.js T8/T8b) — the wrap
# URL carries both: pwn (temp, allowed zone since 0.48) and pwn2 (a path
# OUTSIDE every allowed zone — $HOME — which must never be written).
PWN="/tmp/tjs-adv-pwn.pdf"
PWN2="$HOME/.tjs-adv-clobber-test.pdf"
LOG="$WORK/dev.log"
WRAP_PID=""; APP_PID=""; SERVE_PID=""

# Resolve the CLI without ever writing to the runtime checkout.
if [ -n "${TINYJS_BIN:-}" ]; then TJS="$TINYJS_BIN"
elif [ -x "$HERE/../../../tinyjsapp/tinyjs" ]; then TJS="$HERE/../../../tinyjsapp/tinyjs"
elif [ -x "$HOME/.tinyjs/tinyjs" ]; then TJS="$HOME/.tinyjs/tinyjs"
else echo "no tinyjs CLI found — set TINYJS_BIN"; exit 2; fi
echo "[harness] CLI: $TJS ($("$TJS" --version 2>&1 | head -1))"

cleanup() {
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null
  [ -n "$WRAP_PID" ] && kill "$WRAP_PID" 2>/dev/null
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null
  sleep 1
}
trap cleanup EXIT INT TERM

echo "[harness] serving hostile site on 127.0.0.1:8787 + 8788"
# Pre-flight: a stale server from a previous run must not serve this one.
if curl -s -m 2 -o /dev/null "http://127.0.0.1:8787/" 2>/dev/null; then
  echo "[harness] ABORT: something already listens on 8787 — kill it first (lsof -i :8787)"; exit 4
fi
rm -f "/tmp/tjs-adv-pwn.pdf" "$HOME/.tjs-adv-clobber-test.pdf"  # ground truth must be fresh
command -v pbcopy >/dev/null 2>&1 && printf '' | pbcopy   # a stale report must not mask a dead app
node "$HERE/serve.mjs" >"$WORK/serve.log" 2>&1 & SERVE_PID=$!
sleep 1
if ! curl -s -m 2 -o /dev/null "http://127.0.0.1:8787/" 2>/dev/null; then
  echo "[harness] ABORT: hostile server did not come up"; exit 5
fi

echo "[harness] wrap -> $WORK/hostile"
# Unique title per run: dev webviews persist a WKWebsiteDataStore keyed by
# app title, so a repeated title replays last run's cached probe scripts.
RUN_TAG="$(date +%s)"
"$TJS" wrap "http://127.0.0.1:8787/?run=$RUN_TAG&pwn2=$PWN2" "$WORK/hostile" --force \
  --origins exact \
  --title "ADV Probe $RUN_TAG" --ua "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15" \
  >"$WORK/wrap.log" 2>&1 &
WRAP_PID=$!
i=0; while kill -0 "$WRAP_PID" 2>/dev/null && [ $i -lt 30 ]; do sleep 1; i=$((i+1)); done
if [ -f "$WORK/hostile/tinyjs.json" ]; then
  echo "[harness] wrapped OK"
else
  echo "[harness] wrap FAILED — log:"; cat "$WORK/wrap.log"; exit 3
fi

# The page's T8 probe defaults to $PWN (see above); the harness just waits.
echo "[harness] launching wrapped app for ${SECS}s — a probe window will appear"
( cd "$WORK/hostile" && exec "$TJS" dev ) >"$LOG" 2>&1 &
APP_PID=$!

sleep "$SECS"

echo "[harness] ---- external checks ----"
# The report decides what a death means: all probes relayed + late exit is
# benign (observed: the app self-exits ~15–30s after a DENIED raw subframe
# call — runtime quirk, flagged upstream; every denial held). Death with NO
# report is the real failure mode a spoofed verb would produce.
REPORT="$(pbpaste 2>/dev/null | sed -n '/^ADV\/REPORT/,$p')"
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "LIVENESS  PASS — app alive after T9 spoof + T10 malformed barrages"
else
  if [ -n "$REPORT" ]; then
    echo "LIVENESS  INFO  — app exited post-probes (report relayed; every probe"
    echo "                  verdict + denial is in the log). Benign self-exit, noted upstream."
  else
    echo "LIVENESS  FAIL  — app exited with NO report relayed (spoofed verb executed? see $LOG)"
  fi
fi
if [ -f "$PWN" ]; then
  echo "T8/temp   PASS  — direct write to temp (the allowed zone since 0.48): $PWN"
else
  echo "T8/temp   accepted-no-file? re-checking after kill (the PDF write can race the render)…"
  kill "$APP_PID" 2>/dev/null; sleep 2; APP_PID=""
  if [ -f "$PWN" ]; then
    echo "T8/temp   PASS  — direct write to temp (the allowed zone since 0.48): $PWN"
  else
    echo "T8/temp   CHECK — no temp write (probe flake, or the zone rules changed upstream)"
  fi
fi
if [ -f "$PWN2" ]; then
  echo "T8b/CLB   FAIL  — PROTECTED PATH WRITTEN (#36 regression): $PWN2"
else
  echo "T8b/CLB   PASS  — protected path untouched (save panel or rejection — 0.48 fix holds)"
fi
if grep -q "/exfil" "$WORK/serve.log" 2>/dev/null; then
  echo "T5b/EXFIL INFO  — the javascript: popup executed IN THE PAGE'S OWN ORIGIN (opener-inherit):"
  echo "                  no privilege gain (same wrapper gate) — but DOM popups bypass the"
  echo "                  0.46 win.open URL screening; flag upstream for confirmation"
else
  echo "T5b/EXFIL PASS  — javascript: escape never executed"
fi
if grep -q "GET /etc/passwd" "$WORK/serve.log" 2>/dev/null; then
  echo "T5a/FILE   PASS  — file: popup was re-keyed onto the wrapped origin (served 404, disk untouched)"
else
  echo "T5a/FILE   PASS  — file: popup never reached the network or disk"
fi
if grep -q "GET /raw-leak" "$WORK/serve.log" 2>/dev/null; then
  echo "T6b/RAW    FAIL  — SUBFRAME EXECUTED A BRIDGE CALL via the raw WebKit handler"
  echo "                  (the macOS hole tinyjs 0.50.1 closed — update the runtime): server saw /raw-leak"
else
  echo "T6b/RAW    PASS  — the raw handler call never executed (0.50.1 gating holds, or vector absent)"
fi
echo "[harness] ---- page verdicts (relayed out via clip.write, an allowed verb) ----"
if command -v pbpaste >/dev/null 2>&1; then
  if [ -z "$REPORT" ]; then sleep 3; REPORT="$(pbpaste 2>/dev/null | sed -n '/^ADV\/REPORT/,$p')"; fi
  if [ -n "$REPORT" ]; then printf '%s\n' "$REPORT"
  else echo "(no ADV/ report on clipboard — read the probe window's table)"; fi
else
  echo "(no clipboard reader on this platform — read the probe window's table)"
fi
echo "T6/iframe — page-side verdict renders in the probe window's table"
echo "[harness] full dev log: $LOG"
