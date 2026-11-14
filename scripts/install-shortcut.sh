#!/usr/bin/env bash
# Puts a "Playlist Saver" icon on your Desktop. Double-clicking it starts the app if it
# isn't running and opens it in your browser.
#   scripts/install-shortcut.sh            create the shortcut
#   scripts/install-shortcut.sh --remove   delete it again
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH="$ROOT/scripts/launch.sh"
ASSETS="$ROOT/scripts/assets"
if [ -n "${DESKTOP_DIR:-}" ]; then
  DESKTOP="$DESKTOP_DIR"
elif command -v xdg-user-dir >/dev/null 2>&1; then
  DESKTOP="$(xdg-user-dir DESKTOP)"
else
  DESKTOP="$HOME/Desktop"
fi
chmod +x "$LAUNCH"

case "$(uname)" in
  Darwin)
    APP="$DESKTOP/Playlist Saver.app"
    if [ "${1:-}" = "--remove" ]; then rm -rf "$APP"; echo "Removed $APP"; exit 0; fi
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    cp "$ASSETS/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
    cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Playlist Saver</string>
  <key>CFBundleDisplayName</key><string>Playlist Saver</string>
  <key>CFBundleIdentifier</key><string>local.playlist-saver.launcher</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
    # A login shell, so node and python are found even though Finder starts apps with a bare PATH
    printf '#!/bin/zsh\nexec /bin/zsh -lic '"'"'exec "$0"'"'"' %q\n' "$LAUNCH" >"$APP/Contents/MacOS/launcher"
    chmod +x "$APP/Contents/MacOS/launcher"
    touch "$APP" # nudges Finder to pick up the icon
    echo "Created $APP"
    ;;
  Linux)
    ENTRY="$DESKTOP/playlist-saver.desktop"
    ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
    if [ "${1:-}" = "--remove" ]; then
      rm -f "$ENTRY" "$HOME/.local/share/applications/playlist-saver.desktop" "$ICON_DIR/playlist-saver.png"
      echo "Removed the shortcut"; exit 0
    fi
    mkdir -p "$DESKTOP" "$HOME/.local/share/applications" "$ICON_DIR"
    cp "$ASSETS/icon-512.png" "$ICON_DIR/playlist-saver.png"
    # Desktop Entry spec: only double quotes quote; inside them `\`, `"`, `$` and backtick need a
    # backslash, and a literal % is written %%. launch.sh finds node/python in a login shell itself.
    EXEC_PATH="${LAUNCH//\\/\\\\}"
    EXEC_PATH="${EXEC_PATH//\"/\\\"}"
    EXEC_PATH="${EXEC_PATH//\$/\\\$}"
    EXEC_PATH="${EXEC_PATH//\`/\\\`}"
    EXEC_PATH="${EXEC_PATH//\%/%%}"
    cat >"$ENTRY" <<DESKTOP_FILE
[Desktop Entry]
Type=Application
Name=Playlist Saver
Comment=Start Playlist Saver and open it in your browser
Exec="$EXEC_PATH"
Icon=$ICON_DIR/playlist-saver.png
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
