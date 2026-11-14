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

- The Desktop shortcut now has the app logo as its icon (macOS `AppIcon.icns`, Linux hicolor PNG), and the logo is the browser tab icon.
- Each download card shows a running timer, and how long it took once finished. Finished cards have an ✕ to remove them (and Activity has Clear finished), so old ones no longer pile up.
- A download that goes quiet for 90 seconds now says so and why (usually Spotify or YouTube rate-limiting), instead of looking frozen. If the connection to the helper drops, the card is updated or marked interrupted instead of staying on Downloading.
- A track that fails to download is now listed by name with the reason and a **Retry** button that fetches just that track into the playlist's own folder (or cloud folder). The row turns to Downloaded when the retry succeeds.
- Beginner-friendly install guide: explains Terminal and Homebrew, with screenshots and a fix for every common error. The same guide is published as `docs/USER_GUIDE.md` and linked from the README, so it is readable on GitHub with all screenshots.
- The app now uses the project's `.venv` Python automatically, so it works from the Desktop shortcut and on Homebrew Python without activating anything. The update banner's command upgrades the Python the app actually runs on.
- Built-in user manual: a **Help** link in the top bar opens a searchable, sectioned guide with screenshots, from installing to everyday use. Search matches accents and several words at once and highlights results.
- A scheduled playlist check that fails (including when it can't start because a cloud service is disconnected) is retried after an hour instead of waiting a full day or week. A check you cancel yourself waits for the normal schedule.
- Desktop shortcut (`scripts/install-shortcut.sh`) that starts the app if needed and opens it in the browser, plus `scripts/launch.sh stop`.
- Continuous integration runs the backend tests (Python 3.10 and 3.13), the front-end type-check and build, and ShellCheck on every pull request. Dependabot proposes updates for GitHub Actions, npm and pip.
- The launcher no longer risks stopping an unrelated process, handles simultaneous double-clicks, and fails fast when the port is busy.
