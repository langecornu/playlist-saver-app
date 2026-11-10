"""Pushes finished audio files from a local folder to a cloud provider, never overwriting."""
import os
import time
from pathlib import Path
from typing import Callable

from cloud import CloudError, Provider

AUDIO_EXT = {".mp3", ".m4a", ".flac", ".opus", ".ogg", ".wav"}
# Files that travel with the songs (synced lyrics, playlist order)
SIDECAR_EXT = {".lrc", ".m3u8"}
UPLOAD_EXT = AUDIO_EXT | SIDECAR_EXT

Emit = Callable[[str, str, str], None]  # (file name, state, detail)


class CloudSyncer:
    """Scans `root` for finished audio files and stores each one in `base` on the provider.

    A file is only written when its name is not already present in the destination folder.
    Sub-folders under `root` map to sub-folders under `base` (the playlist folder).
    """

    STABLE_SECONDS = 4.0

    def __init__(
        self,
        provider: Provider,
        base: dict[str, str],
        root: Path | None,
        emit: Emit,
        *,
        recursive: bool = True,
        since: float | None = None,
        delete_after: bool = False,
        stable_seconds: float = STABLE_SECONDS,
        prefix: str = "",
    ):
        self.provider = provider
        self.base = base
        self.root = root
        self.prefix = prefix  # folder under `base` that `root` itself maps to
        self.emit = emit
        self.recursive = recursive
        self.since = since  # ignore files last modified before this time
        self.delete_after = delete_after  # staging mode: the local file is only a cache
        self.stable_seconds = stable_seconds
        self.failed: list[Path] = []
        self._seen: dict[Path, tuple[int, int, float]] = {}
        self._done: set[Path] = set()
        self._dest: dict[str, dict[str, str]] = {}
        self._names: dict[str, set[str]] = {}

    # ---- discovery
    def candidates(self) -> list[Path]:
        root = self.root
        if root is None or not root.is_dir():
            return []
        found = []
        for p in root.rglob("*") if self.recursive else root.glob("*"):
            if p in self._done or p.suffix.lower() not in UPLOAD_EXT or not p.is_file():
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            if st.st_size == 0:  # zero-byte placeholders mean "already stored remotely"
                continue
            if self.since is not None and st.st_mtime < self.since:
                continue
            found.append(p)
        return sorted(found)

    def _ready(self, p: Path) -> bool:
        """A file is ready once its size and mtime stopped changing (conversion and tagging finished)."""
        try:
            st = p.stat()
        except OSError:
            return False
        sig = (st.st_size, st.st_mtime_ns)
        prev = self._seen.get(p)
        now = time.monotonic()
        if prev is None or prev[:2] != sig:
            self._seen[p] = (*sig, now)
            return False
        return now - prev[2] >= self.stable_seconds

    # ---- syncing
    def sweep(self, final: bool = False) -> int:
        """Store every ready file. With final=True the producer has exited, so all files are complete."""
        n = 0
        for p in self.candidates():
            if final or self._ready(p):
                self._sync_one(p)
                n += 1
        return n

    def _folder(self, rel: str) -> tuple[dict[str, str], set[str]]:
        if rel not in self._dest:
            dest = self.provider.ensure_path(self.base, rel, create=True)
            assert dest is not None
            self._dest[rel] = dest
            self._names[rel] = {n.lower() for n in self.provider.list_names(dest)}
        return self._dest[rel], self._names[rel]

    def _sync_one(self, p: Path) -> None:
        assert self.root is not None
        sub = p.parent.relative_to(self.root).as_posix()
        rel = "/".join(part for part in (self.prefix, "" if sub == "." else sub) if part)
        name = p.name
        self._done.add(p)
        try:
            dest, names = self._folder(rel)
            if name.lower() in names:
                state = "exists"
            else:
                state = self.provider.upload(dest, p, name)
                names.add(name.lower())
            if self.delete_after:
                p.unlink(missing_ok=True)
            self.emit(name, state, "")
        except CloudError as e:
            self.failed.append(p)
            self.emit(name, "failed", str(e))
        except Exception as e:  # network drop, disk error: report, keep the file, carry on
            self.failed.append(p)
            self.emit(name, "failed", f"{type(e).__name__}: {e}")


def seed_placeholders(provider: Provider, base: dict[str, str], rel: str, staging: Path, ext: str) -> int:
    """Pre-create empty files named after tracks the cloud folder already has.

    spotDL skips any track whose output file exists, so this stops a re-sync from
    downloading songs that are already stored. Returns how many were seeded.
    """
    dest = provider.ensure_path(base, rel, create=False)
    if dest is None:
        return 0
    folder = staging / rel if rel else staging
    folder.mkdir(parents=True, exist_ok=True)
    count = 0
    for name in provider.list_names(dest):
        if not name.lower().endswith(f".{ext}") or os.sep in name or "/" in name or name.startswith("."):
            continue
        (folder / name).touch()
        count += 1
    return count
