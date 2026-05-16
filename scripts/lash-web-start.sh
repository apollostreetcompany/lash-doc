#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

HOST=${HOST:-127.0.0.1}
PORT=${PORT:-3000}
SESSION=${LASH_WEB_SESSION:-lash-doc-web}
PID_FILE=${PID_FILE:-"$ROOT/.lash-web.pid"}
LOG_FILE=${LOG_FILE:-"$ROOT/.lash-web.log"}
URL="http://$HOST:$PORT"

if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null; then
  if curl -fsS "$URL" >/dev/null 2>&1; then
    printf 'Lash web is already running at %s (tmux session %s)\n' "$URL" "$SESSION"
    exit 0
  fi
  printf 'tmux session %s exists, but %s is not responding. Run make stop first.\n' "$SESSION" "$URL" >&2
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  existing_pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    printf 'Lash web is already running at %s (pid %s)\n' "$URL" "$existing_pid"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if lsof -n -P -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  printf 'Port %s is already in use. Stop that process or set PORT to another value.\n' "$PORT" >&2
  lsof -n -P -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  exit 1
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  (cd "$ROOT" && pnpm run build)
fi

: > "$LOG_FILE"
if command -v tmux >/dev/null 2>&1; then
  tmux new-session -d -s "$SESSION" -c "$ROOT/apps/web" "exec pnpm exec next start -H $HOST -p $PORT >> '$LOG_FILE' 2>&1"
  pid=$(tmux display-message -p -t "$SESSION" '#{pane_pid}')
else
  nohup sh -c 'cd "$1" && exec pnpm exec next start -H "$2" -p "$3"' sh "$ROOT/apps/web" "$HOST" "$PORT" >> "$LOG_FILE" 2>&1 &
  pid=$!
fi
printf '%s\n' "$pid" > "$PID_FILE"

i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    sleep 1
    if ! curl -fsS "$URL" >/dev/null 2>&1; then
      printf 'Lash web became ready, then stopped. Log tail:\n' >&2
      tail -40 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      exit 1
    fi
    printf 'Lash web is running at %s (pid %s, log %s)\n' "$URL" "$pid" "$LOG_FILE"
    if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null; then
      printf 'tmux session: %s\n' "$SESSION"
    fi
    exit 0
  fi
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null; then
    :
  elif ! kill -0 "$pid" 2>/dev/null; then
    printf 'Lash web failed to start. Log tail:\n' >&2
    tail -40 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

printf 'Timed out waiting for Lash web at %s. Log tail:\n' "$URL" >&2
tail -40 "$LOG_FILE" >&2 || true
if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t "$SESSION" 2>/dev/null || true
else
  kill "$pid" 2>/dev/null || true
fi
rm -f "$PID_FILE"
exit 1
