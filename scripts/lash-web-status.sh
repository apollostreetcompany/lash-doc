#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HOST=${HOST:-127.0.0.1}
PORT=${PORT:-3000}
SESSION=${LASH_WEB_SESSION:-lash-doc-web}
PID_FILE=${PID_FILE:-"$ROOT/.lash-web.pid"}
URL="http://$HOST:$PORT"

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null; then
  if curl -fsS "$URL" >/dev/null 2>&1; then
    printf 'Lash web is running at %s (tmux session %s).\n' "$URL" "$SESSION"
    exit 0
  fi
  printf 'tmux session %s exists, but %s is not responding.\n' "$SESSION" "$URL" >&2
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    if curl -fsS "$URL" >/dev/null 2>&1; then
      printf 'Lash web is running at %s (pid %s).\n' "$URL" "$pid"
      exit 0
    fi
    printf 'Lash web process exists (pid %s), but %s is not responding.\n' "$pid" "$URL" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

printf 'Lash web is not running.\n'
exit 1
