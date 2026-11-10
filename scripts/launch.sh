#!/usr/bin/env bash
# Starts Playlist Saver if it isn't already running, then opens it in your browser.
#   scripts/launch.sh         start (if needed) and open
#   scripts/launch.sh stop    stop the app and its server
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PLAYLIST_SAVER_WEB_PORT:-5173}"
URL="http://localhost:${PORT}"
STATE_DIR="${PLAYLIST_SAVER_HOME:-$HOME/.config/playlist-saver}"
PID_FILE="$STATE_DIR/web.pid"
LOG="$STATE_DIR/launcher.log"
mkdir -p "$STATE_DIR"

web_up() { curl -fsS -m 2 "$URL/" 2>/dev/null | grep -q "Playlist Saver"; }
api_up() { curl -fsS -m 2 "$URL/api/defaults" >/dev/null 2>&1; }
is_up() { web_up && api_up; }

open_url() {
  [ -n "${PLAYLIST_SAVER_NO_BROWSER:-}" ] && return 0
  case "$(uname)" in
    Darwin) open "$URL" ;;
    *) xdg-open "$URL" >/dev/null 2>&1 || true ;;
  esac
}

fail() {
  echo "Playlist Saver: $1" >&2
  if [ "$(uname)" = "Darwin" ] && [ -z "${PLAYLIST_SAVER_NO_BROWSER:-}" ]; then
    osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with title \"Playlist Saver\" with icon caution" >/dev/null 2>&1 || true
  fi
  exit 1
}

if [ "${1:-}" = "stop" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")" && echo "Stopped."
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
  (cd "$ROOT/web" && npm install --no-audit --no-fund) >>"$LOG" 2>&1 || fail "Could not install the front-end packages. See $LOG"
fi

echo "--- $(date) starting" >>"$LOG"
(cd "$ROOT/web" && exec nohup npm run dev -- --strictPort --port "$PORT") >>"$LOG" 2>&1 &
echo $! >"$PID_FILE"

for _ in $(seq 1 60); do
  if is_up; then
    open_url
    exit 0
  fi
  sleep 1
done

# The page is up but the API isn't: open it anyway, the app explains what is missing
if web_up; then
  open_url
  exit 0
fi

fail "Playlist Saver did not start within a minute. See $LOG"
