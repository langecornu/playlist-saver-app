"""Persistent settings and provider credentials.

Stored as JSON in ~/.config/playlist-saver/config.json (override the folder with
PLAYLIST_SAVER_HOME). The file holds OAuth tokens, so it is created with 0600
permissions and is only ever read by this server, never sent to the browser.
"""
import copy
import hashlib
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(os.environ.get("PLAYLIST_SAVER_HOME") or Path.home() / ".config" / "playlist-saver")
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_LOCAL_DIR = str(Path.home() / "Music" / "spotify-dl")

DEFAULT_SETTINGS: dict[str, Any] = {
    "local_dir": DEFAULT_LOCAL_DIR,
    "subfolder": True,
    "format": "mp3",
    "bitrate": "auto",
    # Where new downloads go: "local", "dropbox" or "gdrive"
    "destination": "local",
    # For a cloud destination: keep a copy on this Mac too (copy) or store directly (no local copy)
    "keep_local": False,
    # File layout: "flat" = <playlist>/Artist - Title, "artist_album" = Artist/Album/01 - Title
    "naming": "flat",
    "lrc": False,  # also save synced lyrics (.lrc) next to each song
    "m3u": False,  # also write a .m3u8 playlist file that keeps the original order
    "port": 8000,  # port the API server listens on (takes effect after a restart)
    "max_concurrent": 2,  # jobs that may run at the same time; the rest wait in the queue
    # Default folder inside each cloud provider ({"id", "path"})
    "cloud_dest": {
        "dropbox": {"id": "", "path": "/"},
        "gdrive": {"id": "root", "path": "My Drive"},
    },
}


def _merge(base: dict, patch: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


class Store:
    def __init__(self, path: Path = CONFIG_FILE):
        self.path = path
        self._lock = threading.RLock()
        self._data: dict[str, Any] = {
            "settings": {},
            "providers": {},
            "playlist_folders": {},
            "playlists": {},
            "history": [],
        }
        self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(self.path.read_text())
            if isinstance(raw, dict):
                self._data.update(raw)
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".config-")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(self._data, f, indent=2)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)  # atomic: a crash never leaves a half-written file
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise

    # ---- settings -------------------------------------------------------
    def settings(self) -> dict[str, Any]:
        with self._lock:
            return _merge(DEFAULT_SETTINGS, self._data.get("settings", {}))

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._data["settings"] = _merge(self._data.get("settings", {}), patch)
            self._save()
            return self.settings()

    # ---- providers ------------------------------------------------------
    def provider(self, key: str) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._data["providers"].get(key, {}))

    def update_provider(self, key: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            cur = self._data["providers"].get(key, {})
            cur.update(patch)
            self._data["providers"][key] = cur
            self._save()
            return copy.deepcopy(cur)

    def clear_provider_session(self, key: str) -> None:
        """Forget tokens and account but keep the app credentials the user typed in."""
        with self._lock:
            cur = self._data["providers"].get(key, {})
            for k in ("tokens", "account", "expired"):
                cur.pop(k, None)
            self._data["providers"][key] = cur
            self._save()

    # ---- playlist name memory (lets re-syncs skip already-stored tracks up front) ----
    def playlist_folder(self, url: str) -> str | None:
        with self._lock:
            return self._data.get("playlist_folders", {}).get(url)

    def remember_playlist_folder(self, url: str, folder: str) -> None:
        with self._lock:
            self._data.setdefault("playlist_folders", {})[url] = folder
            self._save()

    # ---- saved playlists (auto-sync) -------------------------------------
    @staticmethod
    def playlist_id(url: str) -> str:
        return hashlib.sha1(url.encode()).hexdigest()[:10]

    def playlists(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(list(self._data.get("playlists", {}).values()))

    def get_playlist(self, pid: str) -> dict[str, Any] | None:
        with self._lock:
            return copy.deepcopy(self._data.get("playlists", {}).get(pid))

    def save_playlist(self, entry: dict[str, Any]) -> dict[str, Any]:
        """Create or replace the saved playlist for entry['url'], keeping its run history fields."""
        with self._lock:
            pid = self.playlist_id(entry["url"])
            old = self._data.setdefault("playlists", {}).get(pid, {})
            merged = {**old, **entry, "id": pid}
            self._data["playlists"][pid] = merged
            self._save()
            return copy.deepcopy(merged)

    def update_playlist(self, pid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            cur = self._data.get("playlists", {}).get(pid)
            if cur is None:
                return None
            cur.update(patch)
            self._save()
            return copy.deepcopy(cur)

    def delete_playlist(self, pid: str) -> bool:
        with self._lock:
            gone = self._data.get("playlists", {}).pop(pid, None) is not None
            if gone:
                self._save()
            return gone

    # ---- sync history ------------------------------------------------------
    HISTORY_LIMIT = 300

    def add_history(self, entry: dict[str, Any]) -> None:
        with self._lock:
            hist = self._data.setdefault("history", [])
            hist.append(entry)
            del hist[: max(0, len(hist) - self.HISTORY_LIMIT)]
            self._save()

    def history(self, url: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            items = [h for h in self._data.get("history", []) if url is None or h.get("url") == url]
            return copy.deepcopy(items[-limit:][::-1])
