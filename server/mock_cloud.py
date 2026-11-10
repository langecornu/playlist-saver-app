"""A cloud provider that "stores" into a local folder.

Development and test aid only. Start the server with

    PLAYLIST_SAVER_MOCK_CLOUD=/some/folder python3 -m uvicorn main:app --port 8000

and both Dropbox and Google Drive appear connected, backed by sub-folders of that
directory, so you can try the whole flow without registering developer apps.
PLAYLIST_SAVER_MOCK_DELAY (seconds, default 0.3) slows each upload to make progress visible.
"""
import os
import shutil
import time
from pathlib import Path

from cloud import CloudError, Provider
from config import Store


class MockProvider(Provider):
    def __init__(self, store: Store, key: str, label: str, root: Path):
        super().__init__(store)
        self.key = key
        self.label = label
        self.base = root / key
        self.base.mkdir(parents=True, exist_ok=True)
        self.delay = float(os.environ.get("PLAYLIST_SAVER_MOCK_DELAY", "0.3"))
        self.fail_names: set[str] = set()  # tests can make specific uploads fail

    # PLAYLIST_SAVER_MOCK_CONNECTED=0 starts disconnected so the connect flow can be tried too
    _connected = os.environ.get("PLAYLIST_SAVER_MOCK_CONNECTED", "1") != "0"

    @property
    def configured(self) -> bool:  # type: ignore[override]
        return True

    @property
    def connected(self) -> bool:  # type: ignore[override]
        return self._connected

    def status(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "configured": True,
            "connected": self._connected,
            "expired": False,
            "account": {"name": "Demo account", "email": f"demo@{self.key}.example"} if self._connected else None,
            "client_id": "demo",
            "has_secret": False,
            "scope": "full" if self.key == "gdrive" else "",
            "demo": True,
        }

    # "Sign-in" bounces straight back to the callback, as a provider would after consent
    def auth_url(self, redirect_uri: str, state: str, challenge: str) -> str:
        return f"{redirect_uri}?code=demo&state={state}"

    def exchange(self, code: str, verifier: str, redirect_uri: str) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    # Folder ids are paths relative to the provider's root, "" being the root itself
    def _dir(self, dest: dict) -> Path:
        d = (self.base / dest["id"].strip("/")).resolve()
        if self.base.resolve() not in (d, *d.parents):
            raise CloudError("Folder is outside the demo storage")
        return d

    def _display(self, rel: str) -> str:
        rel = rel.strip("/")
        if self.key == "dropbox":
            return "/" + rel
        return "My Drive" + (f"/{rel}" if rel else "")

    def root(self) -> dict[str, str]:
        return {"id": "", "path": self._display("")}

    def fetch_account(self) -> dict[str, str]:
        return {"name": "Demo account", "email": f"demo@{self.key}.example"}

    def folders(self, dest: dict[str, str]) -> list[dict[str, str]]:
        d = self._dir(dest)
        if not d.is_dir():
            return []
        out = []
        for p in sorted(d.iterdir(), key=lambda p: p.name.lower()):
            if p.is_dir():
                rel = f"{dest['id']}/{p.name}".strip("/")
                out.append({"id": rel, "name": p.name, "path": self._display(rel)})
        return out

    def create_folder(self, dest: dict[str, str], name: str) -> dict[str, str]:
        rel = f"{dest['id']}/{name}".strip("/")
        self._dir({"id": rel}).mkdir(parents=True, exist_ok=True)
        return {"id": rel, "name": name, "path": self._display(rel)}

    def ensure_path(self, base: dict[str, str], rel: str, create: bool = True) -> dict[str, str] | None:
        if not rel.strip("/"):
            return base
        full = f"{base['id']}/{rel}".strip("/")
        d = self._dir({"id": full})
        if not d.is_dir():
            if not create:
                return None
            d.mkdir(parents=True, exist_ok=True)
        return {"id": full, "path": self._display(full)}

    def list_names(self, dest: dict[str, str]) -> set[str]:
        d = self._dir(dest)
        return {p.name for p in d.iterdir() if p.is_file()} if d.is_dir() else set()

    def upload(self, dest: dict[str, str], path: Path, name: str) -> str:
        time.sleep(self.delay)
        if name in self.fail_names:
            raise CloudError(f"{self.label}: simulated failure")
        target = self._dir(dest) / name
        if target.exists():
            return "exists"
        shutil.copyfile(path, target)
        return "uploaded"
