import type { Section } from "./types.ts";

const img = (name: string, alt: string, caption?: string) => ({ t: "img" as const, src: `/manual/${name}.png`, alt, caption });

export const MANUAL: Section[] = [
  // ───────────────────────────── Getting started
  {
    id: "welcome",
    group: "Getting started",
    title: "Welcome",
    summary: "What Playlist Saver does and how this manual is organised.",
    keywords: ["intro", "about", "overview", "what is"],
    blocks: [
      { t: "p", text: "**Playlist Saver** turns a Spotify or YouTube Music link into a folder of music files (MP3, M4A, FLAC or Opus) on your computer, in Dropbox or in Google Drive. Every song is tagged with its title, artist, album and cover art." },
      img("home", "The Playlist Saver home screen", "The home screen. Paste a link on the left; progress shows on the right."),
      { t: "p", text: "You use it in your web browser, but it runs **only on your own computer**. Nothing is uploaded to a Playlist Saver website, because there isn't one." },
      { t: "list", items: [
        "**Install** covers the one-time setup. It takes about 15 minutes.",
        "**Saving music** shows how to save your first playlist.",
        "**Cloud storage** explains how to save to Dropbox or Google Drive.",
        "**Automatic updates** keeps playlists fresh without you doing anything.",
        "**Help** has fixes for the most common problems.",
      ] },
      { t: "tip", text: "Use the search box at the top of this window to jump straight to an answer, for example “port”, “Dropbox” or “duplicates”." },
    ],
  },
  {
    id: "how-it-works",
    group: "Getting started",
    title: "How it works",
    summary: "The three tools behind the app and what happens when you press Download.",
    keywords: ["spotdl", "yt-dlp", "ffmpeg", "youtube", "quality", "drm"],
    blocks: [
      { t: "p", text: "Playlist Saver is a friendly screen on top of three free, open-source tools that you install once: **spotDL**, **yt-dlp** and **FFmpeg**. The app does not contain or download any music by itself." },
      { t: "steps", items: [
        "You paste a link. The app reads the list of songs from Spotify or YouTube Music.",
        "For each song, spotDL finds the best matching audio on YouTube Music.",
        "yt-dlp fetches the audio and FFmpeg converts it to your chosen format and adds the title, artist, album and cover art.",
        "The file is saved where you chose. Songs you already have are skipped.",
      ] },
      { t: "warn", text: "The audio comes from YouTube Music, so real quality tops out around 128–256 kbps. Choosing 320 kbps or FLAC only stores the same sound in a bigger file." },
      { t: "warn", text: "Use Playlist Saver only for music you have the right to copy. You are responsible for following copyright law and the terms of the services involved. Playlist Saver is not affiliated with Spotify, YouTube, Google, Amazon or Dropbox." },
    ],
  },
  {
    id: "supported-links",
    group: "Getting started",
    title: "Which links work",
    summary: "Spotify, YouTube Music and YouTube links that are supported, and what is not.",
    keywords: ["amazon", "spotify", "youtube", "album", "track", "song", "private", "share", "si="],
    blocks: [
      { t: "list", items: [
        "**Spotify**: playlists, albums and single tracks. The playlist must be **public** unless you have set up your own Spotify developer keys.",
        "**YouTube Music and YouTube**: playlists, albums and single songs. Endless “mix” playlists are treated as just the one song.",
        "**Amazon Music** is not supported, because Amazon does not publish playlist contents in a form these tools can read. Find the same playlist on Spotify or YouTube Music instead.",
      ] },
      { t: "tip", text: "Links copied with Spotify’s Share button end in extra tracking such as `?si=…`. The app removes that for you, so paste the link exactly as copied." },
    ],
  },

  // ───────────────────────────── Install
  {
    id: "requirements",
    group: "Install",
    title: "Before you start",
    summary: "What you need on your computer, and how long it takes.",
    keywords: ["requirements", "python", "node", "system", "prerequisites", "windows", "mac", "linux"],
    blocks: [
      { t: "p", text: "Installing takes about **15 minutes** and you only do it once. You need an internet connection and permission to install software on your computer." },
      { t: "list", items: [
        "**Python 3.10 or newer**: runs spotDL and the app’s helper.",
        "**Node.js 18 or newer**: runs the app’s screen in your browser.",
        "**FFmpeg**: converts audio and adds the song details.",
        "**spotDL**: finds and fetches the songs. Installed in a later step.",
        "**Deno** (recommended): some YouTube downloads need it. spotDL can fetch it for you.",
      ] },
      { t: "p", text: "The steps below assume a Mac, which is what the app was tested on. Linux works the same way with your package manager. On Windows, install the same tools from their websites." },
      { t: "tip", text: "On a Mac you type commands into the **Terminal** app. Open it with Command + Space, type “Terminal” and press Return. Copy each command from this manual with its Copy button, paste it with Command + V and press Return." },
    ],
  },
  {
    id: "install-tools",
    group: "Install",
    title: "Step 1: Install Python, Node and FFmpeg",
    summary: "One command on a Mac with Homebrew; equivalents for Linux and Windows.",
    keywords: ["homebrew", "brew", "apt", "winget", "ffmpeg", "python", "node"],
    blocks: [
      { t: "p", text: "On a Mac, the easiest way is **Homebrew**, a free installer for developer tools. If you don’t have it, follow the one-line instructions at brew.sh first. Then run:" },
      { t: "code", label: "Mac", text: "brew install python node ffmpeg" },
      { t: "p", text: "On Ubuntu or Debian Linux:" },
      { t: "code", label: "Linux", text: "sudo apt update\nsudo apt install python3 python3-pip python3-venv nodejs npm ffmpeg" },
      { t: "p", text: "On Windows, install Python and Node.js from their websites, and FFmpeg with `winget install ffmpeg`. Make sure all three are on your PATH (the installers have a tick-box for this)." },
      { t: "p", text: "Check that everything is in place. Each command should print a version number:" },
      { t: "code", text: "python3 --version\nnode --version\nffmpeg -version" },
    ],
  },
  {
    id: "install-app",
    group: "Install",
    title: "Step 2: Get the app and spotDL",
    summary: "Download the project, install spotDL and the app’s packages.",
    keywords: ["git", "clone", "pip", "npm", "spotdl", "venv", "deno", "download", "github"],
    blocks: [
      { t: "steps", items: [
        "Download the app. If you have Git, run the first command below. Otherwise open the project page on GitHub, press the green **Code** button and choose **Download ZIP**, then unzip it.",
        "Move into the folder and install spotDL and the helper’s packages.",
        "Install the screen’s packages.",
        "Let spotDL fetch Deno. This avoids “AudioProviderError” failures later.",
      ] },
      { t: "code", label: "1. Download", text: "git clone https://github.com/langecornu2027/playlist-saver-app.git\ncd playlist-saver-app" },
      { t: "code", label: "2. Python packages", text: "python3 -m venv .venv\nsource .venv/bin/activate\npip install -r server/requirements.txt" },
      { t: "code", label: "3. Screen packages", text: "cd web\nnpm install\ncd .." },
      { t: "code", label: "4. Deno", text: "spotdl --download-deno" },
      { t: "code", label: "Check", text: "spotdl --version" },
      { t: "tip", text: "If you see `spotdl: command not found`, pip put it in a folder your Terminal doesn’t search yet. Running `python3 -m spotdl --version` works either way, and the app also looks in the usual places by itself." },
    ],
  },
  {
    id: "start-app",
    group: "Install",
    title: "Step 3: Start the app",
    summary: "Run one command and open the page in your browser.",
    keywords: ["run", "start", "npm run dev", "localhost", "5173", "open", "launch"],
    blocks: [
      { t: "code", text: "cd web\nnpm run dev" },
      { t: "p", text: "This starts the screen **and** the helper behind it. When it says it is ready, open **http://localhost:5173** in your web browser." },
      img("home", "Playlist Saver open in the browser"),
      { t: "p", text: "Keep the Terminal window open while you use the app. Press **Control + C** in it to stop the app." },
      { t: "tip", text: "The next section shows how to put an icon on your Desktop, so you never need to type this again." },
    ],
  },
  {
    id: "desktop-shortcut",
    group: "Install",
    title: "Desktop shortcut",
    summary: "Create a Desktop icon that starts the app and opens it in your browser.",
    keywords: ["icon", "shortcut", "desktop", "double click", "launcher", "app", "stop", "remove", "log"],
    blocks: [
      { t: "p", text: "A shortcut means you can start Playlist Saver with a double-click, like any other app. Run this once from the app’s folder:" },
      { t: "code", text: "scripts/install-shortcut.sh" },
      { t: "p", text: "A **Playlist Saver** icon appears on your Desktop. Double-click it: if the app isn’t running it starts it, waits until it is ready, then opens it in your browser. If it is already running, it just opens the page." },
      { t: "list", items: [
        "The first start installs the screen’s packages for you, so it takes a little longer.",
        "On a Mac the icon is created on your computer, so there is no “unidentified developer” warning.",
        "On Linux your desktop may ask you to choose **Allow Launching** the first time.",
        "Windows isn’t automated: make a shortcut that runs `npm --prefix web run dev` and open http://localhost:5173.",
      ] },
      { t: "p", text: "To stop the app, or remove the icon:" },
      { t: "code", text: "scripts/launch.sh stop\nscripts/install-shortcut.sh --remove" },
      { t: "warn", text: "The shortcut points at the app’s folder. If you move the folder, run the installer again. If the app won’t start, the reason is written to `~/.config/playlist-saver/launcher.log`." },
    ],
  },

  // ───────────────────────────── Saving music
  {
    id: "first-playlist",
    group: "Saving music",
    title: "Save your first playlist",
    summary: "Paste a link, press Download and watch the songs arrive.",
    keywords: ["download", "paste", "link", "start", "first", "tutorial", "quick start"],
    blocks: [
      { t: "steps", items: [
        "In Spotify or YouTube Music, open the playlist and choose **Share → Copy link**.",
        "In Playlist Saver, click the **Link** box and paste, or press the **Paste** button.",
        "Leave **This Mac** selected under **Save to** for now.",
        "Press the big green **Download** button.",
      ] },
      img("composer-empty", "The empty form with the Link box highlighted", "Step 1 is the Link box. Nothing else is needed to get started."),
      img("composer", "The form with a playlist link pasted", "Once a link is pasted, the choices appear: where to save, format and how often to re-check."),
      { t: "p", text: "Your songs appear in a **folder named after the playlist**, inside your music folder. Playlist Saver never overwrites anything: running the same link again only adds missing songs." },
      { t: "tip", text: "Under the Download button the app shows exactly where files will go, for example `~/Music/Playlist Saver › Playlist name`." },
    ],
  },
  {
    id: "progress",
    group: "Saving music",
    title: "Watching progress",
    summary: "Understand the Activity panel: saved, already had, failed and remaining.",
    keywords: ["activity", "progress", "log", "tracks", "failed", "skipped", "cancel", "queue", "status"],
    blocks: [
      { t: "p", text: "Each download gets a card in the **Activity** list on the right, with a live progress bar." },
      img("job-running", "A download in progress", "While running, you see the progress bar and each song as it finishes."),
      { t: "list", items: [
        "**Saved**: new songs added now.",
        "**Already had**: songs that were already in the folder, so they were skipped.",
        "**Failed**: songs that couldn’t be fetched. Press Download on the same link again to retry just those.",
        "**Remaining**: songs still to come.",
      ] },
      img("job-done", "A finished download", "A finished download. Use the **Tracks** tab for each song and **Log** for technical details."),
      { t: "p", text: "You can cancel a running download at any time. If several are waiting, a queued one can be cancelled before it starts." },
      { t: "tip", text: "Closing the browser tab does not stop a download. The work happens on your computer, so reopen the page to see where it got to." },
    ],
  },
  {
    id: "where-to-save",
    group: "Saving music",
    title: "Choose where to save",
    summary: "Pick This Mac, Dropbox or Google Drive, and the folder to use.",
    keywords: ["folder", "destination", "mac", "location", "directory", "default", "make default", "organise"],
    blocks: [
      { t: "p", text: "Under **Save to** pick one of three tiles: **This Mac**, **Dropbox** or **Google Drive**. The cloud tiles only work after you connect them (see “Cloud storage”)." },
      { t: "list", items: [
        "**Folder on this Mac**: the main music folder. Click it to browse or create a folder. The default is `~/Music/spotify-dl`.",
        "**Put each playlist in its own folder**: on by default, so every playlist gets a folder named after it. Single songs always go straight into the main folder.",
        "**Make default**: remembers your choice for next time. You can also change defaults later in Settings → Defaults.",
      ] },
      img("settings-defaults", "The Defaults tab in Settings", "Settings → Defaults holds everything you want remembered."),
      { t: "warn", text: "If you downloaded a playlist before turning on playlist folders, it will download again into its new folder. Move the old files into that folder first to avoid it." },
    ],
  },
  {
    id: "format-quality",
    group: "Saving music",
    title: "Format and quality",
    summary: "MP3, M4A, FLAC or Opus, and what the quality setting really does.",
    keywords: ["mp3", "m4a", "flac", "opus", "bitrate", "kbps", "320", "lossless", "audio"],
    blocks: [
      { t: "list", items: [
        "**MP3**: plays everywhere. The safe choice.",
        "**M4A**: Apple’s format; slightly better quality than MP3 at the same size.",
        "**FLAC**: a lossless container. Files are much bigger, but because the source is YouTube Music, they do not sound better.",
        "**Opus**: very efficient and good for phones and cars that support it.",
      ] },
      { t: "p", text: "**Auto (best available)** is the right quality setting for nearly everyone. Higher numbers such as 320 kbps only re-encode the same source into a bigger file." },
      { t: "tip", text: "Not sure? Choose MP3 with Auto. It works on every device." },
    ],
  },
  {
    id: "extras",
    group: "Saving music",
    title: "Lyrics, playlist files and layout",
    summary: "Synced lyrics (.lrc), .m3u8 playlist files and the Artist / Album layout.",
    keywords: ["lyrics", "lrc", "m3u", "m3u8", "vlc", "itunes", "artist", "album", "organise", "layout", "naming", "library"],
    blocks: [
      { t: "list", items: [
        "**Organise files → Playlist folder** saves `Playlist/Artist - Title`. **Artist / Album** saves `Artist/Album/01 - Title`, like a music-library layout.",
        "**Save synced lyrics** adds a `.lrc` file next to each song when lyrics are found, so supported players show lyrics in time with the music.",
        "**Write a playlist file (.m3u8)** keeps the original track order for players such as VLC. It uses relative paths, so it keeps working if you move the folder.",
      ] },
      { t: "p", text: "If a playlist file already exists in a cloud folder it is left as it is (nothing is overwritten), so delete it there first if you want a fresh one." },
      { t: "tip", text: "Turn any of these on permanently in Settings → Defaults." },
    ],
  },

  // ───────────────────────────── Cloud storage
  {
    id: "cloud-overview",
    group: "Cloud storage",
    title: "Saving to Dropbox or Google Drive",
    summary: "Direct, copy and after-the-fact modes, and the never-overwrite promise.",
    keywords: ["cloud", "dropbox", "google drive", "gdrive", "upload", "copy", "keep a copy", "overwrite", "direct"],
    blocks: [
      { t: "p", text: "Pick **Dropbox** or **Google Drive** under **Save to**. There are three ways to use them:" },
      { t: "list", items: [
        "**Direct**: leave “Also keep a copy on this Mac” off. Files go through a temporary folder, are uploaded, then removed from your computer.",
        "**Copy**: turn “Also keep a copy on this Mac” on. You keep the files locally and in the cloud.",
        "**After the fact**: on a finished download, press “Copy to Dropbox / Google Drive” to send what you already have.",
      ] },
      { t: "p", text: "**Nothing is ever overwritten.** Before saving, the app looks at what is already in the cloud folder and skips songs with the same name. Re-running a link only fetches what is missing. If an upload fails, the file is kept on your computer so you can retry." },
      { t: "p", text: "You must connect each service once. The next two sections show how." },
    ],
  },
  {
    id: "connect-dropbox",
    group: "Cloud storage",
    title: "Connect Dropbox",
    summary: "Create a free Dropbox app and paste its key into Settings → Connections.",
    keywords: ["dropbox", "app key", "redirect", "oauth", "connect", "permissions", "scoped", "token"],
    blocks: [
      { t: "p", text: "Dropbox needs you to register a small personal “app” (this is free and takes about 2 minutes). It is what lets Playlist Saver use only your own account." },
      img("settings-dropbox-guide", "The Dropbox setup steps in Settings → Connections", "Open **Settings → Connections** and expand “Register a Dropbox app”. The steps are listed right there."),
      { t: "steps", items: [
        "Open dropbox.com/developers/apps and click **Create app**.",
        "Choose **Scoped access**, then **App folder** (safest, confines the app to one folder) or **Full Dropbox**. Give it any name.",
        "On the **Permissions** tab tick `account_info.read`, `files.metadata.read`, `files.metadata.write`, `files.content.read` and `files.content.write`, then click **Submit**.",
        "On the **Settings** tab, find **Redirect URIs**, paste the address shown in the app (`http://localhost:8000/api/oauth/callback`) and press **Add**. The app has a copy button for it.",
        "Copy the **App key** from the same tab, paste it into the **App key** box in Playlist Saver, and press **Connect Dropbox**. No secret is needed.",
        "Dropbox asks you to allow access. Click **Allow**. The page then shows “Connected”.",
      ] },
      { t: "tip", text: "If you changed the server port, the redirect address uses your port instead of 8000. See “Change the server port”." },
    ],
  },
  {
    id: "connect-google",
    group: "Cloud storage",
    title: "Connect Google Drive",
    summary: "Create Google OAuth credentials and choose App files only or Whole Drive.",
    keywords: ["google", "drive", "client id", "client secret", "consent", "oauth", "api", "test user", "access"],
    blocks: [
      { t: "p", text: "Google also needs a personal “OAuth client” (free, about 5 minutes). It looks long but you only do it once." },
      img("settings-google-guide", "The Google Drive setup steps in Settings → Connections", "The same steps are shown in **Settings → Connections** under “Create Google OAuth credentials”."),
      { t: "steps", items: [
        "Open console.cloud.google.com, create a project, then enable the **Google Drive API** under “APIs & Services”.",
        "Open **OAuth consent screen**, choose **External**, fill in the basics and add your own Google address under **Test users**.",
        "Under **Credentials** choose **Create credentials → OAuth client ID** and the type **Desktop app**. If you choose “Web application”, add the redirect address shown in the app.",
        "Paste the **Client ID** and **Client secret** into Playlist Saver.",
        "Choose the access level (below) and press **Connect Google Drive**, then allow access in the Google window.",
      ] },
      { t: "list", items: [
        "**App files only**: the app can see only files and folders it created. This is the safest choice.",
        "**Whole Drive**: lets you choose any existing folder and spot songs already there.",
      ] },
      { t: "p", text: "Your credentials stay in a private file on your computer (`~/.config/playlist-saver/config.json`) and are never sent anywhere except to Google." },
    ],
  },
  {
    id: "manage-connections",
    group: "Cloud storage",
    title: "Reconnect or disconnect",
    summary: "What to do when a connection shows Reconnect, and how to remove one.",
    keywords: ["disconnect", "reconnect", "revoked", "token", "sign out", "remove", "account"],
    blocks: [
      { t: "p", text: "Connections are remembered, and the app refreshes them automatically. At start-up it checks each one. If you revoked access from Dropbox or Google, the app shows **Reconnect** instead of failing quietly. A network outage never signs you out." },
      { t: "p", text: "To remove a connection and its stored tokens, open **Settings → Connections** and press **Disconnect**. The app asks you to confirm. Your files in the cloud are not touched." },
    ],
  },

  // ───────────────────────────── Automatic updates
  {
    id: "keep-in-sync",
    group: "Automatic updates",
    title: "Keep a playlist in sync",
    summary: "Re-check a playlist daily or weekly and download only new songs.",
    keywords: ["sync", "schedule", "daily", "weekly", "auto", "automatic", "saved playlists", "new tracks", "re-check"],
    blocks: [
      { t: "p", text: "Under **Keep in sync** choose **Daily** or **Weekly** before pressing Download. The app then re-checks the playlist on schedule and adds only songs it does not already have." },
      img("settings-playlists", "Saved playlists and history in Settings → Playlists", "Settings → Playlists lists everything you keep in sync, and below it the History."),
      { t: "list", items: [
        "Change the schedule with the drop-down, or press **Sync now** to check right away.",
        "Press the **✕** to stop syncing. This never touches your files.",
        "The line under each name shows the last check, how many songs were new and when the next one is due.",
      ] },
      { t: "warn", text: "Checks only run **while the app is running**. If your computer was off, due playlists are checked the next time you start the app. If a check fails (for example, no internet), it is tried again about an hour later." },
      { t: "tip", text: "The Keep in sync choice only appears for playlists and albums, not single songs." },
    ],
  },
  {
    id: "history-queue",
    group: "Automatic updates",
    title: "History and the download queue",
    summary: "See what each run added, and why only two downloads run at once.",
    keywords: ["history", "queue", "concurrent", "downloads at once", "rate limit", "waiting", "limit"],
    blocks: [
      { t: "p", text: "**History** (in Settings → Playlists, under your saved playlists) lists every download and check, how many songs it added and when." },
      { t: "p", text: "Only a few downloads run at the same time (two by default). The rest wait in a queue and start by themselves. This stops Spotify and YouTube from slowing you down when several playlists are due together." },
      { t: "steps", items: [
        "Open **Settings → Defaults**.",
        "Change **Downloads at once** to a number from 1 to 4.",
      ] },
      { t: "tip", text: "If you often see slow lookups or failures, lower it to 1." },
    ],
  },

  // ───────────────────────────── Maintenance
  {
    id: "duplicates",
    group: "Keeping things tidy",
    title: "Find duplicate songs",
    summary: "Scan your music folder for songs saved more than once.",
    keywords: ["duplicate", "duplicates", "same song", "scan", "library", "clean", "copies", "disk space"],
    blocks: [
      { t: "p", text: "The same song often appears in several playlists, so it can end up stored more than once. The duplicate finder shows where." },
      { t: "steps", items: [
        "Open **Settings → Library**.",
        "Press **Scan my library**.",
        "Review the list. Each song shows its copies, the folder of each and the size.",
      ] },
      img("settings-library", "Duplicate songs found in the library", "Each group lists the folders that hold a copy."),
      { t: "warn", text: "The scan only **reports**. Nothing is ever deleted or moved. Remove copies yourself in Finder if you want the space back." },
    ],
  },
  {
    id: "updates",
    group: "Keeping things tidy",
    title: "Update spotDL and yt-dlp",
    summary: "What the update banner means and the command to run.",
    keywords: ["update", "upgrade", "version", "banner", "pip", "outdated", "new version", "yt-dlp"],
    blocks: [
      { t: "p", text: "YouTube changes often, so an old spotDL or yt-dlp is the most common reason songs fail. The app checks for newer versions (an anonymous request that sends none of your data) and shows a banner when one exists." },
      img("update-banner", "The update banner", "The banner names the new version and gives the command to run."),
      { t: "steps", items: [
        "Press **Copy command** on the banner.",
        "Paste it into Terminal and press Return. If you used a virtual environment, activate it first with `source .venv/bin/activate`.",
        "Restart Playlist Saver.",
      ] },
      { t: "code", text: "pip3 install --upgrade spotdl yt-dlp" },
      { t: "p", text: "Press **Dismiss** to hide the banner for that version. It comes back when an even newer one is released." },
    ],
  },
  {
    id: "port",
    group: "Keeping things tidy",
    title: "Change the server port",
    summary: "Use another port if 8000 is taken by another program.",
    keywords: ["port", "8000", "advanced", "address already in use", "restart", "server", "redirect"],
    blocks: [
      { t: "p", text: "The helper behind the screen uses **port 8000** by default. Only change this if another program already uses it." },
      img("settings-advanced", "The Advanced tab in Settings", "Settings → Advanced is where the port is set."),
      { t: "steps", items: [
        "Open **Settings → Advanced**.",
        "Enter a number between 1024 and 65535 and save. The app checks that it is free.",
        "Press **Restart now** to bring the helper back on the new port. It waits for running downloads to finish.",
      ] },
      { t: "warn", text: "Dropbox and Google sign-in addresses contain the port. After changing it, add the new address (`http://localhost:<port>/api/oauth/callback`) as a Redirect URI in your Dropbox or Google app before reconnecting. Existing connections keep working." },
    ],
  },

  // ───────────────────────────── Help
  {
    id: "troubleshooting",
    group: "Help",
    title: "Troubleshooting",
    summary: "Fixes for the most common problems, from missing spotDL to failed tracks.",
    keywords: ["error", "problem", "fix", "not working", "offline", "audioprovidererror", "ffmpeg", "command not found", "private", "slow", "wrong song", "address already in use"],
    blocks: [
      { t: "list", items: [
        "**“spotDL missing” banner**: the helper can’t find spotDL. Run `pip3 install -r server/requirements.txt` with the same Python you use for the app.",
        "**“API offline” banner won’t clear**: use the **Start server** button in the banner. If it keeps failing, run `python3 -m uvicorn main:app --port 8000` inside the `server` folder and read the error. Usually a package is missing, or another program uses the port.",
        "**“address already in use”**: another program has the port. Stop it, or choose another port (“Change the server port”).",
        "**Some songs fail with AudioProviderError**: run `spotdl --download-deno`, then download the same link again. Saved songs are skipped.",
        "**“ffmpeg was not found”**: run `brew install ffmpeg` or `spotdl --download-ffmpeg`.",
        "**Lookup is slow or stalls**: Spotify limits how fast it answers. Wait a minute, and avoid running many downloads at once.",
        "**A private playlist won’t load**: spotDL can only read public playlists unless you use your own Spotify developer keys. Make the playlist public.",
        "**The wrong song was saved**: matches come from a YouTube search, so a live or cover version can slip in. Delete the file and download the single track by its own link.",
        "**The shortcut does nothing**: read `~/.config/playlist-saver/launcher.log`.",
      ] },
      { t: "tip", text: "The **Log** tab on a download card shows exactly what happened, which helps when asking for support." },
    ],
  },
  {
    id: "faq",
    group: "Help",
    title: "Questions and privacy",
    summary: "Common questions: is it safe, where is my data, can I use it offline.",
    keywords: ["faq", "privacy", "safe", "data", "offline", "legal", "disclaimer", "cost", "free", "uninstall", "security", "other websites"],
    blocks: [
      { t: "list", items: [
        "**Is it free?** Yes. The app and the tools it uses are open source.",
        "**Where does my data go?** Nowhere. Settings and tokens are in `~/.config/playlist-saver` on your computer. The app only contacts Spotify, YouTube, your cloud service and PyPI (for the update check).",
        "**Can websites control it?** No. The helper accepts requests only from your own computer.",
        "**Does it work offline?** You need the internet to find and fetch songs. Saved music plays offline, of course.",
        "**How do I uninstall it?** Remove the Desktop icon with `scripts/install-shortcut.sh --remove`, then delete the app’s folder. Your music is not affected.",
      ] },
      img("disclaimer", "The disclaimer shown at the bottom of the app"),
      { t: "warn", text: "Playlist Saver is only a graphical interface. It does not host, store or download any content itself. It runs spotDL, yt-dlp and FFmpeg on your own computer. Use it only for music you have the right to copy." },
    ],
  },
];
