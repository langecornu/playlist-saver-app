#!/usr/bin/env bash
# Starts Playlist Saver if it isn't already running, then opens it in your browser.
#   scripts/launch.sh         start (if needed) and open
#   scripts/launch.sh stop    stop the app and its server
set -u

# Desktop launchers start programs with a minimal PATH, so node or python3 installed with
# Homebrew, nvm or pyenv may be invisible. Retry once inside a login shell to pick up the PATH.
if { ! command -v node >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; } && [ -z "${PLAYLIST_SAVER_LOGIN_SHELL:-}" ]; then
  export PLAYLIST_SAVER_LOGIN_SHELL=1
  exec "${SHELL:-/bin/bash}" -lic 'exec "$0" "$@"' "$0" "$@"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PLAYLIST_SAVER_WEB_PORT:-5173}"
URL="http://localhost:${PORT}"
STATE_DIR="${PLAYLIST_SAVER_HOME:-$HOME/.config/playlist-saver}"
PID_FILE="$STATE_DIR/web.pid"
LOCK="$STATE_DIR/launch.lock"
LOG="$STATE_DIR/launcher.log"
mkdir -p "$STATE_DIR"
# Keep the log from growing forever
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1048576 ]; then tail -n 500 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi

web_up() { curl -fsS -m 2 "$URL/" 2>/dev/null | grep -q "Playlist Saver"; }
api_up() { curl -fsS -m 2 "$URL/api/defaults" >/dev/null 2>&1; }
is_up() { web_up && api_up; }

# Prints the PID of the server this launcher started, but only if that process is still alive
# AND still looks like ours (a stale PID file may point at a recycled PID).
running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid cmd
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)"
  case "$cmd" in *npm* | *vite* | *node*) echo "$pid"; return 0 ;; esac
  return 1
}

open_url() {
  [ -n "${PLAYLIST_SAVER_NO_BROWSER:-}" ] && return 0
  case "$(uname)" in
    Darwin) open "$URL" ;;
    *) xdg-open "$URL" >/dev/null 2>&1 || true ;;
  esac
}

fail() {
  echo "Playlist Saver: $1" >&2
  if [ -z "${PLAYLIST_SAVER_NO_BROWSER:-}" ]; then
    if [ "$(uname)" = "Darwin" ]; then
      local msg=${1//\\/\\\\}
      msg=${msg//\"/\\\"}
      osascript -e "display dialog \"$msg\" buttons {\"OK\"} default button \"OK\" with title \"Playlist Saver\" with icon caution" >/dev/null 2>&1 || true
    elif command -v notify-send >/dev/null 2>&1; then
      notify-send "Playlist Saver" "$1" || true
    fi
  fi
  exit 1
}

if [ "${1:-}" = "stop" ]; then
  if pid="$(running_pid)"; then
    kill "$pid" && echo "Stopped."
  else
    echo "Not running (or not started by this launcher)."
  fi
  rm -f "$PID_FILE"
  exit 0
fi

if web_up; then
  open_url
  exit 0
fi

command -v node >/dev/null 2>&1 || fail "Node.js was not found. Install it (see the README), then try again."
command -v python3 >/dev/null 2>&1 || fail "Python 3 was not found. Install it (see the README), then try again."

if [ ! -d "$ROOT/web/node_modules" ]; then
  echo "Installing front-end packages (first run only)…" >>"$LOG"
  (cd "$ROOT/web" && npm ci --no-audit --no-fund) >>"$LOG" 2>&1 || fail "Could not install the front-end packages. See $LOG"
fi

# Only one launcher may spawn the server. A concurrent double-click sees the lock (or the PID file)
# and just waits for the first one to finish starting it.
pid=""
if ! pid="$(running_pid)"; then
  pid=""
  find "$LOCK" -maxdepth 0 -mmin +2 -exec rmdir {} \; 2>/dev/null  # drop a lock left by a killed launcher
  if mkdir "$LOCK" 2>/dev/null; then
    echo "--- $(date) starting" >>"$LOG"
    (cd "$ROOT/web" && exec nohup npm run dev -- --strictPort --port "$PORT") >>"$LOG" 2>&1 &
    pid=$!
    echo "$pid" >"$PID_FILE"
    rmdir "$LOCK" 2>/dev/null
  fi
fi

for _ in $(seq 1 60); do
  if is_up; then
    open_url
    exit 0
  fi
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    fail "Playlist Saver stopped right after starting. Port $PORT may already be in use by another program. Details: $LOG"
  fi
  sleep 1
done

# The page is up but the API isn't: open it anyway, the app explains what is missing
if web_up; then
  open_url
  exit 0
fi

fail "Playlist Saver did not start within a minute. See $LOG"
