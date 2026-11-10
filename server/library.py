"""Finds the same song stored more than once in a local music folder (report only, never deletes)."""
import re
from pathlib import Path

from sync import AUDIO_EXT

MAX_FILES = 50_000
_TAG = re.compile(r"[\(\[](?:official|lyrics?|audio|video|hd|remaster(?:ed)?)[^\)\]]*[\)\]]", re.I)


def normalise(stem: str) -> str:
    """'01 - Artist - Title (Official Audio)' -> 'artist title' so trivial naming differences still match."""
    s = re.sub(r"^\d{1,3}\s*[-.]\s*", "", stem)
    s = _TAG.sub("", s).lower()
    return " ".join(re.findall(r"[^\W_]+", s))


def find_duplicates(root: Path, limit: int = 200) -> dict:
    groups: dict[str, list[Path]] = {}
    scanned = 0
    truncated = False
    if root.is_dir():
        for p in root.rglob("*"):
            if p.suffix.lower() not in AUDIO_EXT or not p.is_file() or p.name.startswith("."):
                continue
            try:
                if p.stat().st_size == 0:  # placeholders aren't real files
                    continue
            except OSError:
                continue
            scanned += 1
            if scanned > MAX_FILES:
                truncated = True
                break
            key = normalise(p.stem)
            if key:
                groups.setdefault(key, []).append(p)
    dupes = []
    for files in groups.values():
        if len(files) < 2:
            continue
        items = []
        for f in sorted(files):
            try:
                st = f.stat()
                items.append(
                    {
                        "path": str(f),
                        "folder": str(f.parent.relative_to(root)) if f.parent != root else ".",
                        "name": f.name,
                        "size": st.st_size,
                    }
                )
            except OSError:
                continue
        if len(items) > 1:
            dupes.append({"title": files[0].stem, "files": items, "wasted": sum(i["size"] for i in items[1:])})
    dupes.sort(key=lambda g: -g["wasted"])
    return {
        "root": str(root),
        "scanned": scanned,
        "truncated": truncated,
        "groups": dupes[:limit],
        "group_count": len(dupes),
        "wasted": sum(g["wasted"] for g in dupes),
    }
