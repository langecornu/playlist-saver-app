#!/usr/bin/env bash
# Puts a "Playlist Saver" icon on your Desktop. Double-clicking it starts the app if it
# isn't running and opens it in your browser.
#   scripts/install-shortcut.sh            create the shortcut
#   scripts/install-shortcut.sh --remove   delete it again
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH="$ROOT/scripts/launch.sh"
DESKTOP="${DESKTOP_DIR:-$HOME/Desktop}"
chmod +x "$LAUNCH"

case "$(uname)" in
  Darwin)
    APP="$DESKTOP/Playlist Saver.app"
    if [ "${1:-}" = "--remove" ]; then rm -rf "$APP"; echo "Removed $APP"; exit 0; fi
    mkdir -p "$APP/Contents/MacOS"
    cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Playlist Saver</string>
  <key>CFBundleDisplayName</key><string>Playlist Saver</string>
  <key>CFBundleIdentifier</key><string>local.playlist-saver.launcher</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
    # A login shell, so node and python are found even though Finder starts apps with a bare PATH
    printf '#!/bin/zsh\nexec /bin/zsh -lic '"'"'exec "$0"'"'"' %q\n' "$LAUNCH" >"$APP/Contents/MacOS/launcher"
    chmod +x "$APP/Contents/MacOS/launcher"
    echo "Created $APP"
    ;;
  Linux)
    ENTRY="$DESKTOP/playlist-saver.desktop"
    if [ "${1:-}" = "--remove" ]; then
      rm -f "$ENTRY" "$HOME/.local/share/applications/playlist-saver.desktop"
      echo "Removed the shortcut"; exit 0
    fi
    mkdir -p "$DESKTOP" "$HOME/.local/share/applications"
    cat >"$ENTRY" <<DESKTOP_FILE
[Desktop Entry]
Type=Application
Name=Playlist Saver
Comment=Start Playlist Saver and open it in your browser
Exec=bash -lc 'exec "\$0"' "$LAUNCH"
Terminal=false
Categories=AudioVideo;Audio;
DESKTOP_FILE
    chmod +x "$ENTRY"
    cp "$ENTRY" "$HOME/.local/share/applications/playlist-saver.desktop"
    echo "Created $ENTRY (if your desktop asks, choose 'Allow Launching')"
    ;;
  *)
    echo "Automatic shortcuts are supported on macOS and Linux. On Windows, create a shortcut to run: npm --prefix web run dev" >&2
    exit 1
    ;;
esac
