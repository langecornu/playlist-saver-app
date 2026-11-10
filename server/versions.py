"""Reports installed versions of the tools we drive and whether PyPI has newer ones.

The only outbound request is an anonymous GET of https://pypi.org/pypi/<package>/json,
which carries no user data. Results are cached so the UI can poll freely.
"""
import json
import re
import ssl
import subprocess
import sys
import threading
import time
import urllib.request

TTL = 6 * 3600
TOOLS = {
    "spotdl": {"label": "spotDL", "repo": "https://github.com/spotDL/spotify-downloader/releases"},
    "yt-dlp": {"label": "yt-dlp", "repo": "https://github.com/yt-dlp/yt-dlp/releases"},
}
UPGRADE_CMD = "pip3 install --upgrade spotdl yt-dlp"

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "data": None}


def parse(v: str) -> tuple[int, ...]:
    """'2026.10.26' / '4.6.0' -> comparable tuple (non-numeric suffixes ignored)."""
    return tuple(int(x) for x in re.findall(r"\d+", v.split("+")[0].split("-")[0])[:4])


def newer(latest: str | None, installed: str | None) -> bool:
    if not latest or not installed:
        return False
    try:
        return parse(latest) > parse(installed)
    except ValueError:
        return False


def installed_version(package: str, spotdl_cmd: list[str]) -> str | None:
    try:
        if package == "spotdl":
            out = subprocess.run([*spotdl_cmd, "--version"], capture_output=True, text=True, timeout=20).stdout
        else:
            out = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], capture_output=True, text=True, timeout=20).stdout
        m = re.search(r"\d[\d.]*", out)
        return m.group(0) if m else None
    except (OSError, subprocess.SubprocessError):
        return None


def _ssl_context() -> ssl.SSLContext:
    """python.org builds on macOS ship without trusted roots; certifi (installed with spotDL) fixes that."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def latest_version(package: str) -> str | None:
    try:
        req = urllib.request.Request(f"https://pypi.org/pypi/{package}/json", headers={"User-Agent": "playlist-saver"})
        with urllib.request.urlopen(req, timeout=6, context=_ssl_context()) as r:
            return json.load(r)["info"]["version"]
    except Exception:  # offline, rate-limited, bad JSON: just don't offer an update
        return None


def check(spotdl_cmd: list[str], force: bool = False) -> dict:
    with _lock:
        if not force and _cache["data"] and time.time() - _cache["at"] < TTL:
            return _cache["data"]
        tools = []
        for pkg, meta in TOOLS.items():
            inst, last = installed_version(pkg, spotdl_cmd), latest_version(pkg)
            tools.append(
                {
                    "key": pkg,
                    "label": meta["label"],
                    "installed": inst,
                    "latest": last,
                    "update": newer(last, inst),
                    "url": meta["repo"],
                }
            )
        data = {"tools": tools, "command": UPGRADE_CMD, "checked_at": time.time()}
        _cache.update(at=time.time(), data=data)
        return data
