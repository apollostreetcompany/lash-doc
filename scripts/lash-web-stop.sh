#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SESSION=${LASH_WEB_SESSION:-lash-doc-web}
PID_FILE=${PID_FILE:-"$ROOT/.lash-web.pid"}

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
  rm -f "$PID_FILE"
  printf 'Stopped Lash web (tmux session %s).\n' "$SESSION"
  exit 0
fi

if [ ! -f "$PID_FILE" ]; then
  printf 'Lash web is not running (no pid file).\n'
  exit 0
fi

pid=$(cat "$PID_FILE" 2>/dev/null || true)
if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  printf 'Lash web is not running (stale pid cleared).\n'
  exit 0
fi

kill "$pid"
i=0
while [ "$i" -lt 20 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    printf 'Stopped Lash web (pid %s).\n' "$pid"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.5
done

printf 'Lash web did not exit after SIGTERM (pid %s). Inspect it manually.\n' "$pid" >&2
exit 1
