"""FastAPI server around the spotdl CLI, with optional Dropbox / Google Drive storage.

Run:  python3 -m uvicorn main:app --port 8000   (from this directory)
"""
import asyncio
import importlib.util
import json
import logging
import os
import re
import shutil
import signal
import socket
import sys
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode, urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel

import cloud
from cloud import CloudError, Provider
from config import DEFAULT_LOCAL_DIR, Store
import library
import versions
from links import Link, LinkError, parse_link
from sync import CloudSyncer, seed_placeholders

DEFAULT_DIR = DEFAULT_LOCAL_DIR
API_PORT = os.environ.get("PLAYLIST_SAVER_API_PORT", "8000")
REDIRECT_URI = f"http://localhost:{API_PORT}/api/oauth/callback"
FORMATS = {"mp3", "m4a", "flac", "opus", "ogg", "wav"}
BITRATES = {"auto", "128k", "192k", "256k", "320k"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
NAMINGS = {"flat", "artist_album"}
INTERVALS = {"daily": 86400, "weekly": 7 * 86400}
log = logging.getLogger("playlist-saver")
RETRY_AFTER = 3600  # seconds to wait before re-checking a playlist whose last check failed
ACTIVE = ("queued", "starting", "running", "uploading")


def find_spotdl() -> tuple[list[str], bool]:
    """Locate spotdl even when PATH differs from the user's shell (e.g. launched from an IDE)."""
    if exe := shutil.which("spotdl"):
        return [exe], True
    home = Path.home()
    candidates = [
        Path(sys.executable).parent / "spotdl",
        *sorted(Path("/Library/Frameworks/Python.framework/Versions").glob("*/bin/spotdl")),
        *sorted((home / "Library" / "Python").glob("*/bin/spotdl")),
        home / ".local" / "bin" / "spotdl",
        Path("/opt/homebrew/bin/spotdl"),
        Path("/usr/local/bin/spotdl"),
    ]
    for c in candidates:
        if c.exists():
            return [str(c)], True
    if importlib.util.find_spec("spotdl"):
        return [sys.executable, "-m", "spotdl"], True
    return ["spotdl"], False


SPOTDL, SPOTDL_FOUND = find_spotdl()

FOUND_RE = re.compile(r"Found (\d+) songs? in (.+?)(?: \((\w+)\))?\s*$")
DONE_RE = re.compile(r'Downloaded "(.+?)"')
SKIP_RE = re.compile(r"^(.+): Skipped\s*$")
DONE2_RE = re.compile(r"^(.+): Downloaded\s*$")
COMPLETE_RE = re.compile(r"^(\d+)/(\d+) complete")
FAIL_RE = re.compile(r"(AudioProviderError|LookupError|DownloaderError)[:\s]*(.*)")
# spotdl's end-of-run error list (--print-errors): "<track link> - <ErrorName>: <message>", in the order the failures happened
ERROR_LINE_RE = re.compile(r"^(https?://\S+) - (\w+): (.*)$")
NO_RESULTS_RE = re.compile(r"No results found for song:\s*(.+)$")


def sanitize_folder(name: str) -> str:
    """Mirror of spotdl's own file-name sanitizing, so we can find the folder it creates."""
    out = "".join(c for c in name if c not in "/?\\*|<>")
    out = re.sub(r"\s{2,}", " ", out)
    return out.replace('"', "'").replace(":", "-")


store = Store()
providers: dict[str, Provider] = cloud.make_providers(store)
jobs: dict[str, "Job"] = {}


class LocalOnly:
    """Reject requests that did not come from this machine's own pages (DNS rebinding, cross-site POSTs)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
            host = headers.get("host", "")
            host = host[1 : host.index("]")] if host.startswith("[") and "]" in host else host.split(":")[0]
            origin = headers.get("origin")
            origin_host = urlparse(origin).hostname if origin else None
            if host not in LOCAL_HOSTS or (origin and origin_host not in LOCAL_HOSTS):
                await JSONResponse({"detail": "Forbidden"}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Saved connections are restored from disk; confirm in the background that they still work
    loop = asyncio.get_running_loop()
    for p in providers.values():
        loop.run_in_executor(None, p.check)
    task = asyncio.create_task(scheduler())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(LocalOnly)


# --------------------------------------------------------------------------- models
class Dest(BaseModel):
    id: str
    path: str


class JobRequest(BaseModel):
    """Anything left out falls back to the saved defaults."""

    url: str
    format: str | None = None
    bitrate: str | None = None
    output_dir: str | None = None
    threads: int = 4
    subfolder: bool | None = None
    destination: str | None = None  # local | dropbox | gdrive
    keep_local: bool | None = None
    cloud_dest: Dest | None = None
    naming: str | None = None
    lrc: bool | None = None
    m3u: bool | None = None
    auto_sync: Literal["off", "daily", "weekly"] = "off"  # "off" leaves any saved schedule alone


class SettingsPatch(BaseModel):
    local_dir: str | None = None
    subfolder: bool | None = None
    format: str | None = None
    bitrate: str | None = None
    destination: str | None = None
    keep_local: bool | None = None
    cloud_dest: dict[str, Dest] | None = None
    naming: str | None = None
    lrc: bool | None = None
    m3u: bool | None = None
    max_concurrent: int | None = None
    port: int | None = None


class Credentials(BaseModel):
    client_id: str
    client_secret: str | None = None  # None keeps the saved one, "" clears it
    scope: Literal["app", "full"] | None = None


class ConnectRequest(BaseModel):
    return_to: str


class NewFolder(BaseModel):
    parent: Dest
    name: str


class PlaylistPatch(BaseModel):
    interval: Literal["off", "daily", "weekly"]


class CopyRequest(BaseModel):
    provider: str
    cloud_dest: Dest | None = None


# --------------------------------------------------------------------------- jobs
@dataclass
class Plan:
    url: str
    format: str
    bitrate: str
    threads: int
    subfolder: bool
    local_dir: str
    destination: str  # local | dropbox | gdrive
    keep_local: bool
    cloud_dest: dict[str, str] | None
    naming: str = "flat"
    lrc: bool = False
    m3u: bool = False
    is_list: bool = True  # playlist or album, as opposed to a single track
    source: str = "spotify"
    into_folder: str = ""  # a retry of one track: put it in this existing folder of the original job

    @property
    def nested(self) -> bool:
        """Library layout (Artist/Album/Track): files land in many sub-folders of the output folder."""
        return self.naming != "flat"

    @property
    def to_cloud(self) -> bool:
        return self.destination != "local"

    @property
    def direct(self) -> bool:
        """Stored in the cloud only, no copy kept on this Mac."""
        return self.to_cloud and not self.keep_local

    @property
    def in_folder(self) -> bool:
        # Single tracks have no list name, and the library layout builds its own folders
        return bool(self.into_folder) or (self.subfolder and self.is_list and not self.nested)


class Slots:
    """Limits how many jobs run at once; the rest wait in a first-come queue."""

    def __init__(self):
        self.active = 0
        self.cond = asyncio.Condition()

    @staticmethod
    def limit() -> int:
        try:
            return max(1, min(4, int(store.settings().get("max_concurrent", 2))))
        except (TypeError, ValueError):
            return 2

    async def acquire(self, job: "Job") -> bool:
        async with self.cond:
            await self.cond.wait_for(lambda: job.cancelled or self.active < self.limit())
            if job.cancelled:
                return False
            self.active += 1
            return True

    async def release(self):
        async with self.cond:
            self.active -= 1
            self.cond.notify_all()

    async def poke(self):
        async with self.cond:
            self.cond.notify_all()


slots = Slots()


class Job:
    def __init__(self, plan: Plan, trigger: str = "manual"):
        self.id = uuid.uuid4().hex[:8]
        self.plan = plan
        self.trigger = trigger  # manual | auto
        self.created = time.time()
        self.status = "queued"  # queued | starting | running | uploading | done | failed | cancelled
        self.name = ""
        self.folder = plan.into_folder
        self.retry_of: tuple["Job", dict] | None = None  # (job, failed track) this job is retrying
        self.total = 0
        self.completed = 0
        self.tracks: list[dict] = []  # {title, state: done|skipped|failed, detail}
        self.uploads: list[dict] = []  # {name, state: uploaded|exists|failed, detail}
        self.cloud_state: str | None = "waiting" if plan.to_cloud else None
        self.cloud_path = plan.cloud_dest["path"] if plan.cloud_dest else ""
        self.warnings: list[str] = []
        self.seeded = 0
        self.log: list[str] = []
        self.proc: asyncio.subprocess.Process | None = None
        self.staging: Path | None = None
        self.syncer: CloudSyncer | None = None
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.last_activity = time.time()  # last time spotdl printed anything, to spot a stalled lookup
        self.cancelled = False
        self.spotdl_done = False
        self.version = 0
        self.changed = asyncio.Condition()
        self.loop = asyncio.get_running_loop()

    @property
    def provider(self) -> Provider | None:
        return providers.get(self.plan.destination)

    @property
    def local_root(self) -> Path | None:
        """Where this job's files sit on this Mac (None when stored directly in the cloud)."""
        if self.plan.direct:
            return None
        base = Path(self.plan.local_dir)
        return base / self.folder if self.plan.in_folder and self.folder else base

    def snapshot(self) -> dict:
        p = self.plan
        counts = {"uploaded": 0, "exists": 0, "failed": 0}
        for u in self.uploads:
            counts[u["state"]] += 1
        prov = self.provider
        return {
            "id": self.id,
            "url": p.url,
            "status": self.status,
            "name": self.name,
            "folder": self.folder,
            "total": self.total,
            "completed": self.completed,
            "tracks": self.tracks,
            "log": self.log[-200:],
            "output_dir": p.local_dir,
            "local_path": str(self.local_root) if self.local_root else "",
            "destination": p.destination,
            "destination_label": prov.label if prov else "This Mac",
            "keep_local": p.keep_local,
            "cloud_path": self.cloud_path,
            "cloud_state": self.cloud_state,
            "uploads": self.uploads[-400:],
            "upload_counts": counts,
            "warnings": self.warnings,
            "seeded": self.seeded,
            "queue_position": self.queue_position(),
            "trigger": self.trigger,
            "source": p.source,
            "naming": p.naming,
            "lrc": p.lrc,
            "m3u": p.m3u,
            "created_at": self.created,
            "started_at": None if self.status == "queued" else self.started_at,
            "finished_at": self.finished_at,
            "last_activity": self.last_activity,
        }

    def queue_position(self) -> int:
        if self.status != "queued":
            return 0
        return 1 + sum(1 for j in jobs.values() if j.status == "queued" and j.created < self.created)

    async def touch(self):
        async with self.changed:
            self.version += 1
            self.changed.notify_all()

    def touch_threadsafe(self):
        asyncio.run_coroutine_threadsafe(self.touch(), self.loop)

    def emit_upload(self, name: str, state: str, detail: str):
        # Called from the sync worker thread
        self.uploads.append({"name": name, "state": state, "detail": detail})
        self.touch_threadsafe()

    # ---- spotdl output
    async def handle_line(self, line: str):
        line = line.rstrip()
        if not line:
            return
        self.last_activity = time.time()
        self.log.append(line)
        if m := FOUND_RE.search(line):
            self.total = int(m.group(1))
            self.name = m.group(2)
            if self.plan.in_folder and not self.plan.into_folder:
                self.set_folder(sanitize_folder(self.name))
        elif m := COMPLETE_RE.match(line):
            self.completed = int(m.group(1))
            self.total = int(m.group(2))
        elif (m := DONE_RE.search(line)) or (m := DONE2_RE.match(line)):
            self.tracks.append({"title": m.group(1), "state": "done", "detail": ""})
            self.name_single(m.group(1))
        elif m := SKIP_RE.search(line):
            self.tracks.append({"title": m.group(1), "state": "skipped", "detail": ""})
            self.name_single(m.group(1))
        elif m := ERROR_LINE_RE.match(line):
            self.attach_error_link(m.group(1))
        elif m := FAIL_RE.search(line):
            detail = m.group(2).strip()
            found = NO_RESULTS_RE.search(detail)
            self.tracks.append({"title": found.group(1) if found else "Failed track", "state": "failed", "detail": detail, "url": ""})
        await self.touch()

    def attach_error_link(self, url: str):
        """spotdl lists failures again at the end, with each track's link, in the same order they happened."""
        for t in self.tracks:
            if t["state"] == "failed" and not t.get("url"):
                t["url"] = url
                return

    async def resolve_failed_names(self):
        """The failure message itself rarely names the song, so look the failed links up once the run is over."""
        todo = [t for t in self.tracks if t["state"] == "failed" and t.get("url") and t["title"] == "Failed track"]
        if not todo or self.cancelled:
            return
        tmp = Path(tempfile.mkdtemp(prefix="playlist-saver-names-"))
        try:
            save = tmp / "names.spotdl"
            proc = await asyncio.create_subprocess_exec(
                *SPOTDL, "save", *{t["url"] for t in todo}, "--save-file", str(save),
                env={**os.environ, "NO_COLOR": "1"},
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await asyncio.wait_for(proc.wait(), 90)
            except asyncio.TimeoutError:
                proc.kill()
                return
            names = {}
            for song in json.loads(save.read_text(encoding="utf-8")):
                artists = ", ".join(song.get("artists") or [song.get("artist", "")]).strip(", ")
                names[song.get("url")] = f"{artists} - {song['name']}" if artists else song["name"]
            for t in todo:
                t["title"] = names.get(t["url"], t["title"])
        except (OSError, ValueError, KeyError, TypeError):
            pass  # the track keeps its generic name; retrying it still works
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def name_single(self, title: str):
        """A single song has no playlist name, so the card is named after the song itself."""
        if not self.name and not self.plan.is_list:
            self.name = title

    def set_folder(self, folder: str):
        self.folder = folder
        store.remember_playlist_folder(self.plan.url, folder)
        # Copy mode: from now on we know which local folder holds this playlist
        if self.syncer and not self.plan.direct:
            self.syncer.root = self.local_root
            self.syncer.prefix = folder

    # ---- queue + history around the real work
    async def run(self):
        await self.touch()
        got = await slots.acquire(self)
        try:
            if not got:
                self.status = "cancelled"
                self.finished_at = time.time()
                await self.touch()
                return
            self.started_at = time.time()  # waiting in the queue must not count against the "new files" window
            await self._run()
        finally:
            if got:
                await slots.release()
            if got:
                self.record_history()
            self.finish_retry()

    def retrying(self) -> bool:
        return any(t.get("retry") == "running" for t in self.tracks)

    def finish_retry(self):
        """A one-track retry reports back to the track it was started from."""
        if not self.retry_of:
            return
        orig, track = self.retry_of
        if self.status == "done" and any(t["state"] in ("done", "skipped") for t in self.tracks):
            track["state"] = "done"
            track["detail"] = ""
            track.pop("retry", None)
        else:
            track["retry"] = "failed"
            failed = next((t for t in self.tracks if t["state"] == "failed"), None)
            detail = (failed or {}).get("detail", "")
            track["detail"] = "Cancelled" if self.cancelled else (detail or "Still failing")
        orig.loop.create_task(orig.touch())

    def record_history(self):
        try:
            tracks = self.tracks
            added = [t["title"] for t in tracks if t["state"] == "done"]
            entry = {
                "id": self.id,
                "url": self.plan.url,
                "name": self.name or self.plan.url,
                "at": time.time(),
                "status": self.status,
                "trigger": self.trigger,
                "source": self.plan.source,
                "destination": self.provider.label if self.provider else "This Mac",
                "added": added[:300],
                "added_count": len(added),
                "skipped": sum(1 for t in tracks if t["state"] == "skipped"),
                "failed": sum(1 for t in tracks if t["state"] == "failed"),
                "detail": self.log[-1] if self.status == "failed" and self.log else "",
            }
            store.add_history(entry)
            pid = store.playlist_id(self.plan.url)
            saved = store.get_playlist(pid)
            if saved:
                patch = {"last_status": self.status, "last_finished": entry["at"], "last_added": len(added)}
                if self.name:
                    patch["name"] = self.name
                interval = INTERVALS.get(saved.get("interval", ""))
                if interval and self.status == "failed":
                    # Try again soon instead of waiting a whole day or week. A run the user
                    # cancelled on purpose just waits for the normal interval.
                    patch["last_run"] = entry["at"] - interval + RETRY_AFTER
                store.update_playlist(pid, patch)
        except Exception:  # history is a convenience; never let it break a job, but do report it
            log.exception("Could not record history for job %s", self.id)

    # ---- main run
    async def _run(self):
        self.status = "starting"
        await self.touch()
        p = self.plan
        provider = self.provider
        try:
            if p.direct:
                self.staging = Path(tempfile.mkdtemp(prefix="playlist-saver-"))
                out_root = self.staging
            else:
                out_root = Path(p.local_dir)
                out_root.mkdir(parents=True, exist_ok=True)

            if provider and p.cloud_dest:
                known = p.into_folder or (store.playlist_folder(p.url) if p.in_folder else None)
                if known:
                    self.folder = known
                self.syncer = CloudSyncer(
                    provider,
                    p.cloud_dest,
                    None,
                    self.emit_upload,
                    delete_after=p.direct,
                    recursive=p.direct or p.in_folder or p.nested,
                    since=None if (p.direct or p.in_folder) else self.started_at,
                )
                if p.direct:
                    self.syncer.root = self.staging
                    if known:
                        # Tell spotdl up front which tracks the cloud already has, so it skips them
                        self.seeded = await asyncio.to_thread(
                            seed_placeholders, provider, p.cloud_dest, known, self.staging, p.format
                        )
                else:
                    self.syncer.root = self.local_root if (not p.in_folder or known) else None
                    self.syncer.prefix = self.folder if p.in_folder else ""

            if p.nested:
                template = "{artist}/{album}/{track-number} - {title}.{output-ext}"
            else:
                folder_part = "{list-name}/" if p.in_folder else ""
                if p.into_folder:  # retrying one track: the folder already exists, so name it literally
                    folder_part = p.into_folder.replace("{", "").replace("}", "") + "/"
                template = folder_part + "{artists} - {title}.{output-ext}"
            cmd = [
                *SPOTDL, "download", p.url,
                "--simple-tui",
                "--print-errors",
                "--format", p.format,
                "--bitrate", p.bitrate,
                "--threads", str(p.threads),
                "--overwrite", "skip",  # never replace a file that's already there
                "--output", os.path.join(str(out_root), template),
            ]
            if p.lrc:
                cmd += ["--lyrics", "synced", "genius", "musixmatch", "azlyrics", "--generate-lrc"]
            m3u_dir = out_root / "{list[0]}" if p.in_folder else out_root
            if p.m3u and p.is_list:
                cmd += ["--m3u", str(m3u_dir / "{list[0]}.m3u8")]
            env = {**os.environ, "PYTHONUNBUFFERED": "1", "NO_COLOR": "1", "COLUMNS": "400"}
            sync_task = asyncio.create_task(self.sync_loop()) if self.syncer else None
            code = 1
            try:
                self.proc = await asyncio.create_subprocess_exec(
                    *cmd, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
                )
                self.status = "running"
                if self.syncer:
                    self.cloud_state = "syncing"
                await self.touch()
                assert self.proc.stdout
                buf = b""  # spotdl may redraw with \r; split on both
                while chunk := await self.proc.stdout.read(1024):
                    buf += chunk
                    parts = re.split(rb"[\r\n]+", buf)
                    buf = parts.pop()
                    for part in parts:
                        await self.handle_line(part.decode(errors="replace"))
                if buf:
                    await self.handle_line(buf.decode(errors="replace"))
                code = await self.proc.wait()
                await self.resolve_failed_names()
                if p.m3u and p.is_list:
                    await asyncio.to_thread(self.relativise_m3u, out_root)
            except FileNotFoundError:
                self.log.append(f"spotdl not found ({' '.join(SPOTDL)})")
            finally:
                self.spotdl_done = True
            if sync_task:
                if not self.cancelled:
                    self.status = "uploading"
                    await self.touch()
                await sync_task
            if self.cancelled:
                self.status = "cancelled"
            else:
                self.status = "done" if code == 0 else "failed"
            self.finish_cloud()
        except Exception as e:  # never leave a job spinning forever
            self.status = "failed"
            self.log.append(f"{type(e).__name__}: {e}")
        finally:
            self.cleanup_staging()
            self.finished_at = time.time()
            await self.touch()

    async def sync_loop(self):
        assert self.syncer
        try:
            while not self.spotdl_done and not self.cancelled:
                await asyncio.to_thread(self.syncer.sweep, False)
                await asyncio.sleep(2)
            if not self.cancelled:
                await asyncio.to_thread(self.syncer.sweep, True)
        except Exception as e:
            self.warnings.append(f"Cloud sync stopped: {e}")

    def finish_cloud(self):
        if not self.syncer:
            return
        failed = sum(1 for u in self.uploads if u["state"] == "failed")
        self.cloud_state = "partial" if failed else "done"
        if failed:
            self.warnings.append(f"{failed} file{'s' if failed != 1 else ''} couldn't be sent to {self.provider.label}.")

    def relativise_m3u(self, out_root: Path):
        """spotdl writes absolute paths; make them relative so the playlist works wherever the folder goes."""
        folder = out_root / self.folder if self.plan.in_folder and self.folder else out_root
        for f in folder.glob("*.m3u8"):
            try:
                if f.stat().st_mtime < self.started_at - 1:
                    continue
                lines = []
                for ln in f.read_text(encoding="utf-8", errors="replace").splitlines():
                    if ln and not ln.startswith("#") and os.path.isabs(ln):
                        ln = os.path.relpath(ln, folder)
                    lines.append(ln)
                f.write_text("\n".join(lines) + "\n", encoding="utf-8")
            except OSError:
                continue

    def cleanup_staging(self):
        if not self.staging:
            return
        if self.syncer and self.syncer.failed:
            self.warnings.append(f"Files that couldn't be uploaded were kept in {self.staging}")
            return
        shutil.rmtree(self.staging, ignore_errors=True)
        self.staging = None

    def cancel(self):
        self.cancelled = True
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
        self.loop.create_task(slots.poke())  # wakes this job if it is still waiting in the queue

    # ---- copy an existing local download to a cloud provider
    async def copy_to_cloud(self, provider: Provider, dest: dict[str, str]):
        root = self.local_root
        p = self.plan
        self.uploads = []
        self.warnings = []
        # The files stay on this Mac, so keep_local must be true or the job would look cloud-only
        self.plan = Plan(**{**p.__dict__, "destination": provider.key, "cloud_dest": dest, "keep_local": True})
        self.cloud_path = dest["path"]
        self.cloud_state = "syncing"
        await self.touch()
        try:
            self.syncer = CloudSyncer(
                provider,
                dest,
                root,
                self.emit_upload,
                recursive=p.nested,
                since=None if p.in_folder else self.started_at,
                prefix=self.folder if p.in_folder else "",
            )
            await asyncio.to_thread(self.syncer.sweep, True)
            self.finish_cloud()
        except Exception as e:
            self.cloud_state = "partial"
            self.warnings.append(str(e))
        await self.touch()


def resolve_plan(req: JobRequest, link: Link | None = None) -> Plan:
    s = store.settings()
    fmt = req.format or s["format"]
    bitrate = req.bitrate or s["bitrate"]
    if fmt not in FORMATS or bitrate not in BITRATES:
        raise HTTPException(400, "Unsupported format or quality")
    naming = req.naming or s["naming"]
    if naming not in NAMINGS:
        raise HTTPException(400, "Unsupported file layout")
    if link is None:
        try:
            link = parse_link(req.url)
        except LinkError as e:
            raise HTTPException(400, str(e))
    destination = req.destination or s["destination"]
    if destination != "local" and destination not in providers:
        raise HTTPException(400, "Unknown destination")
    cloud_dest = None
    if destination != "local":
        prov = providers[destination]
        if not prov.connected:
            raise HTTPException(400, f"{prov.label} isn't connected. Connect it in Settings first.")
        d = req.cloud_dest.model_dump() if req.cloud_dest else s["cloud_dest"].get(destination)
        cloud_dest = d or prov.root()
    return Plan(
        url=link.url,
        naming=naming,
        lrc=s["lrc"] if req.lrc is None else req.lrc,
        m3u=s["m3u"] if req.m3u is None else req.m3u,
        is_list=link.is_list,
        source=link.source,
        format=fmt,
        bitrate=bitrate,
        threads=max(1, min(8, req.threads)),
        subfolder=s["subfolder"] if req.subfolder is None else req.subfolder,
        local_dir=os.path.abspath(os.path.expanduser(req.output_dir or s["local_dir"])),
        destination=destination,
        keep_local=s["keep_local"] if req.keep_local is None else req.keep_local,
        cloud_dest=cloud_dest,
    )


def start_job(plan: Plan, trigger: str = "manual") -> Job:
    job = Job(plan, trigger)
    jobs[job.id] = job
    asyncio.create_task(job.run())
    return job


@app.post("/api/jobs")
async def create_job(req: JobRequest):
    try:
        link = parse_link(req.url)  # drops ?si=... and other tracking parameters
    except LinkError as e:
        raise HTTPException(400, str(e))
    req.url = link.url
    plan = resolve_plan(req, link)
    job = start_job(plan)
    if req.auto_sync != "off" and link.is_list:
        store.save_playlist(
            {
                "url": link.url,
                "name": "",
                "interval": req.auto_sync,
                "source": link.source,
                "created": time.time(),
                "last_run": time.time(),
                "request": {
                    "format": plan.format,
                    "bitrate": plan.bitrate,
                    "output_dir": plan.local_dir,
                    "threads": plan.threads,
                    "subfolder": plan.subfolder,
                    "destination": plan.destination,
                    "keep_local": plan.keep_local,
                    "cloud_dest": plan.cloud_dest,
                    "naming": plan.naming,
                    "lrc": plan.lrc,
                    "m3u": plan.m3u,
                },
            }
        )
    return job.snapshot()


@app.get("/api/jobs")
async def list_jobs():
    return [j.snapshot() for j in jobs.values()]


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404)
    job.cancel()
    return job.snapshot()


@app.delete("/api/jobs/{job_id}")
async def remove_job(job_id: str):
    """Forget a finished job (the files are untouched), so the Activity list can be tidied."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404)
    if job.status in ACTIVE or job.cloud_state == "syncing" or job.retrying():
        raise HTTPException(409, "This download is still in progress. Cancel it first.")
    jobs.pop(job_id, None)
    return {"removed": job_id}


class RetryRequest(BaseModel):
    url: str


@app.post("/api/jobs/{job_id}/retry")
async def retry_track(job_id: str, req: RetryRequest):
    """Download one failed track again, into the same place as the rest of its playlist."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404)
    if job.status in ACTIVE:
        raise HTTPException(409, "Wait for this download to finish first.")
    track = next((t for t in job.tracks if t["state"] == "failed" and t.get("url") == req.url), None)
    if not track:
        raise HTTPException(404, "That track isn't in the failed list.")
    if track.get("retry") == "running":
        raise HTTPException(409, "This track is already being retried.")
    plan = replace(job.plan, url=req.url, is_list=False, m3u=False, into_folder=job.folder if job.plan.in_folder else "")
    new = Job(plan)
    new.retry_of = (job, track)
    jobs[new.id] = new
    track["retry"] = "running"
    asyncio.create_task(new.run())
    await job.touch()
    return new.snapshot()


@app.post("/api/jobs/{job_id}/copy")
async def copy_job(job_id: str, req: CopyRequest):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404)
    prov = providers.get(req.provider)
    if not prov or not prov.connected:
        raise HTTPException(400, "That cloud service isn't connected")
    if job.status not in ("done", "failed", "cancelled") or job.cloud_state == "syncing":
        raise HTTPException(409, "Wait for this download to finish first")
    root = job.local_root
    if root is None or not root.is_dir():
        raise HTTPException(409, "This download isn't stored on this Mac, so there's nothing to copy")
    dest = (req.cloud_dest.model_dump() if req.cloud_dest else None) or store.settings()["cloud_dest"].get(prov.key) or prov.root()
    asyncio.create_task(job.copy_to_cloud(prov, dest))
    job.cloud_state = "syncing"
    return job.snapshot()


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404)

    async def stream():
        seen = -1
        while True:
            async with job.changed:
                await job.changed.wait_for(lambda: job.version != seen)
                seen = job.version
            yield f"data: {json.dumps(job.snapshot())}\n\n"
            if job.status in ("done", "failed", "cancelled") and job.cloud_state != "syncing" and not job.retrying():
                return

    return StreamingResponse(stream(), media_type="text/event-stream")


# --------------------------------------------------------------------------- settings
def port_in_use(port: int) -> bool:
    """True if something already listens on this port, on IPv4 or IPv6 (dev servers often use only ::1)."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sk:
                sk.settimeout(0.5)
                if sk.connect_ex((host, port)) == 0:
                    return True
        except OSError:  # that address family isn't available on this machine
            continue
    return False


def settings_payload() -> dict:
    configured = store.settings()["port"]
    return {
        "port": {
            "configured": configured,
            "running": int(API_PORT),
            "restart_needed": configured != int(API_PORT),
            # True when this API was started by the dev launcher, which can bring it back on the new port
            "can_restart": os.environ.get("PLAYLIST_SAVER_MANAGED") == "1",
            "redirect_uri": f"http://localhost:{configured}/api/oauth/callback",
        },
        "settings": store.settings(),
        "providers": [p.status() for p in providers.values()],
        "redirect_uri": REDIRECT_URI,
        "demo": bool(os.environ.get("PLAYLIST_SAVER_MOCK_CLOUD")),
    }


@app.get("/api/settings")
async def get_settings():
    return settings_payload()


@app.put("/api/settings")
async def put_settings(patch: SettingsPatch):
    data = patch.model_dump(exclude_none=True)
    if "format" in data and data["format"] not in FORMATS:
        raise HTTPException(400, "Unsupported format")
    if "bitrate" in data and data["bitrate"] not in BITRATES:
        raise HTTPException(400, "Unsupported quality")
    if "destination" in data and data["destination"] != "local" and data["destination"] not in providers:
        raise HTTPException(400, "Unknown destination")
    if "port" in data:
        port = data["port"]
        if not 1024 <= port <= 65535:
            raise HTTPException(400, "Choose a port between 1024 and 65535")
        if port != int(API_PORT) and port_in_use(port):
            raise HTTPException(400, f"Port {port} is already in use by another program. Try a different one.")
    if "naming" in data and data["naming"] not in NAMINGS:
        raise HTTPException(400, "Unsupported file layout")
    if "max_concurrent" in data and not 1 <= data["max_concurrent"] <= 4:
        raise HTTPException(400, "Run between 1 and 4 downloads at once")
    if "cloud_dest" in data:
        bad = set(data["cloud_dest"]) - set(providers)
        if bad:
            raise HTTPException(400, f"Unknown provider: {', '.join(sorted(bad))}")
    if "local_dir" in data:
        data["local_dir"] = os.path.abspath(os.path.expanduser(data["local_dir"].strip() or DEFAULT_DIR))
    store.update_settings(data)
    await slots.poke()  # a higher limit lets queued jobs start straight away
    return settings_payload()


@app.post("/api/restart")
async def restart_api():
    """Stop this process so the launcher can bring it back, on the configured port."""
    if os.environ.get("PLAYLIST_SAVER_MANAGED") != "1":
        raise HTTPException(400, "This server wasn't started by the app, so restart it yourself with the new --port.")
    if any(j.status in ACTIVE for j in jobs.values()):
        raise HTTPException(409, "Wait for running and queued downloads to finish, or cancel them, before restarting.")
    asyncio.get_running_loop().call_later(0.4, os.kill, os.getpid(), signal.SIGTERM)
    return {"restarting": True, "port": store.settings()["port"]}


def provider_or_404(key: str) -> Provider:
    prov = providers.get(key)
    if not prov:
        raise HTTPException(404, "Unknown provider")
    return prov


@app.put("/api/providers/{key}/credentials")
async def put_credentials(key: str, creds: Credentials):
    prov = provider_or_404(key)
    patch: dict = {"client_id": creds.client_id.strip()}
    if creds.client_secret is not None:
        patch["client_secret"] = creds.client_secret.strip()
    if creds.scope is not None:
        patch["scope"] = creds.scope
    # Changing the app registration invalidates any session made with the old one
    old = prov.cfg()
    if old.get("client_id") and old.get("client_id") != patch["client_id"]:
        store.clear_provider_session(key)
    store.update_provider(key, patch)
    return settings_payload()


def safe_return_to(url: str) -> str:
    u = urlparse(url)
    if u.scheme != "http" or u.hostname not in LOCAL_HOSTS:
        raise HTTPException(400, "Invalid return address")
    return f"{u.scheme}://{u.netloc}/"


@app.post("/api/providers/{key}/connect")
async def connect(key: str, req: ConnectRequest):
    prov = provider_or_404(key)
    if not prov.configured:
        raise HTTPException(400, f"Enter your {prov.label} app credentials first")
    return {"auth_url": cloud.begin_auth(prov, safe_return_to(req.return_to), REDIRECT_URI)}


@app.get("/api/oauth/callback")
async def oauth_callback(state: str = "", code: str = "", error: str = "", error_description: str = ""):
    try:
        session = cloud.finish_auth(state)
    except CloudError as e:
        return JSONResponse({"detail": str(e)}, status_code=400)
    back = session["return_to"]
    prov = providers[session["provider"]]
    if error or not code:
        msg = error_description or error or "Sign-in was cancelled"
        return RedirectResponse(back + "?" + urlencode({"connect_error": msg, "provider": prov.key}))
    try:
        await asyncio.to_thread(prov.exchange, code, session["verifier"], session["redirect_uri"])
    except CloudError as e:
        return RedirectResponse(back + "?" + urlencode({"connect_error": str(e), "provider": prov.key}))
    return RedirectResponse(back + "?" + urlencode({"connected": prov.key}))


@app.post("/api/providers/{key}/disconnect")
async def disconnect(key: str):
    prov = provider_or_404(key)
    await asyncio.to_thread(prov.disconnect)
    if store.settings()["destination"] == key:
        store.update_settings({"destination": "local"})
    return settings_payload()


@app.get("/api/providers/{key}/folders")
async def list_folders(key: str, id: str | None = Query(None), path: str | None = Query(None)):
    prov = provider_or_404(key)
    if not prov.connected:
        raise HTTPException(400, f"{prov.label} isn't connected")
    here = {"id": id, "path": path or "/"} if id is not None else prov.root()
    try:
        folders = await asyncio.to_thread(prov.folders, here)
    except CloudError as e:
        raise HTTPException(502, str(e))
    return {"current": here, "folders": folders}


@app.post("/api/providers/{key}/folders")
async def new_folder(key: str, req: NewFolder):
    prov = provider_or_404(key)
    name = req.name.strip().replace("/", "-")
    if not name:
        raise HTTPException(400, "Give the folder a name")
    try:
        return await asyncio.to_thread(prov.create_folder, req.parent.model_dump(), name)
    except CloudError as e:
        raise HTTPException(502, str(e))


@app.get("/api/defaults")
async def defaults():
    return {
        "output_dir": store.settings()["local_dir"],
        "spotdl": " ".join(SPOTDL),
        "spotdl_found": SPOTDL_FOUND,
    }


# --------------------------------------------------------------------------- tool versions
@app.get("/api/versions")
async def tool_versions(refresh: bool = False):
    return await asyncio.to_thread(versions.check, SPOTDL, refresh)


# --------------------------------------------------------------------------- saved playlists (auto-sync) + history
def playlist_view(pl: dict) -> dict:
    iv = INTERVALS.get(pl.get("interval", ""))
    nxt = (pl.get("last_run", 0) + iv) if iv else None
    running = any(j.plan.url == pl["url"] and j.status in ACTIVE for j in jobs.values())
    return {**pl, "next_run": nxt, "running": running}


def launch_saved(pl: dict, trigger: str) -> Job | None:
    """Start a job for a saved playlist using the options it was saved with."""
    store.update_playlist(pl["id"], {"last_run": time.time()})
    try:
        plan = resolve_plan(JobRequest(url=pl["url"], **pl.get("request", {})))
    except HTTPException as e:
        store.add_history(
            {
                "id": uuid.uuid4().hex[:8], "url": pl["url"], "name": pl.get("name") or pl["url"], "at": time.time(),
                "status": "failed", "trigger": trigger, "source": pl.get("source", ""), "destination": "",
                "added": [], "added_count": 0, "skipped": 0, "failed": 0, "detail": str(e.detail),
            }
        )
        now = time.time()
        patch = {"last_status": "failed", "last_finished": now, "last_added": 0}
        interval = INTERVALS.get(pl.get("interval", ""))
        if interval:
            patch["last_run"] = now - interval + RETRY_AFTER  # retry soon, not after a whole interval
        store.update_playlist(pl["id"], patch)
        return None
    return start_job(plan, trigger)


async def run_due(now: float | None = None) -> int:
    now = now or time.time()
    started = 0
    for pl in store.playlists():
        iv = INTERVALS.get(pl.get("interval", ""))
        if not iv or now - pl.get("last_run", 0) < iv:
            continue
        if any(j.plan.url == pl["url"] and j.status in ACTIVE for j in jobs.values()):
            continue
        if launch_saved(pl, "auto"):
            started += 1
    return started


async def scheduler():
    """Checks once a minute for playlists whose daily/weekly re-check is due. Runs only while the API is running."""
    while True:
        try:
            await run_due()
        except Exception:
            pass
        await asyncio.sleep(60)


@app.get("/api/playlists")
async def list_playlists():
    return sorted((playlist_view(p) for p in store.playlists()), key=lambda p: p.get("created", 0), reverse=True)


@app.patch("/api/playlists/{pid}")
async def patch_playlist(pid: str, patch: PlaylistPatch):
    pl = store.update_playlist(pid, {"interval": patch.interval, "last_run": time.time()})
    if not pl:
        raise HTTPException(404)
    return playlist_view(pl)


@app.delete("/api/playlists/{pid}")
async def delete_playlist(pid: str):
    if not store.delete_playlist(pid):
        raise HTTPException(404)
    return {"ok": True}


@app.post("/api/playlists/{pid}/sync")
async def sync_playlist(pid: str):
    pl = store.get_playlist(pid)
    if not pl:
        raise HTTPException(404)
    if any(j.plan.url == pl["url"] and j.status in ACTIVE for j in jobs.values()):
        raise HTTPException(409, "This playlist is already being synced")
    job = launch_saved(pl, "manual")
    if not job:
        raise HTTPException(400, store.history(pl["url"], 1)[0]["detail"] or "Couldn't start the sync")
    return job.snapshot()


@app.get("/api/history")
async def get_history(url: str | None = None, limit: int = Query(100, ge=1, le=300)):
    return store.history(url, limit)


# --------------------------------------------------------------------------- library tidy-up
@app.get("/api/library/duplicates")
async def duplicates(dir: str | None = None):
    root = Path(os.path.abspath(os.path.expanduser(dir or store.settings()["local_dir"])))
    return await asyncio.to_thread(library.find_duplicates, root)
