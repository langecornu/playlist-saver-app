# Changelog

## 0.1.0

First public release.

- Save Spotify and YouTube Music playlists, albums and songs to this Mac, Dropbox or Google Drive.
- Never overwrites existing files, locally or in the cloud.
- Saved playlists that re-check daily or weekly, with sync history.
- Download queue with a limit on how many run at once.
- Synced lyrics, `.m3u8` playlist files, `Artist/Album` layout and a duplicate finder.
- Update notices for spotDL and yt-dlp.
- Configurable server port.

## Unreleased

- A scheduled playlist check that fails or is cancelled is retried after an hour instead of waiting a full day or week.
- Desktop shortcut (`scripts/install-shortcut.sh`) that starts the app if needed and opens it in the browser, plus `scripts/launch.sh stop`.
- Stopping the dev server with a termination signal now also stops the API it started.
- Continuous integration runs the backend tests and the front-end type-check and build on every pull request.
