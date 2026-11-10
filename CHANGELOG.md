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

- A scheduled playlist check that fails (including when it can't start because a cloud service is disconnected) is retried after an hour instead of waiting a full day or week. A check you cancel yourself waits for the normal schedule.
- Desktop shortcut (`scripts/install-shortcut.sh`) that starts the app if needed and opens it in the browser, plus `scripts/launch.sh stop`.
- Continuous integration runs the backend tests (Python 3.10 and 3.13), the front-end type-check and build, and ShellCheck on every pull request. Dependabot proposes updates for GitHub Actions, npm and pip.
- The launcher no longer risks stopping an unrelated process, handles simultaneous double-clicks, and fails fast when the port is busy.
