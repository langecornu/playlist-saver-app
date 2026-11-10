"""Recognise the links spotDL can read and reduce them to a canonical form."""
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

SPOTIFY_RE = re.compile(r"^https://open\.spotify\.com/(?:intl-[a-z-]+/)?(playlist|album|track)/([A-Za-z0-9]+)")
YT_HOSTS = {"music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"}
YT_ID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")


class LinkError(ValueError):
    """The link isn't one we can use; the message is safe to show to the user."""


@dataclass(frozen=True)
class Link:
    url: str  # canonical, tracking parameters removed
    source: str  # spotify | youtube
    is_list: bool  # playlist or album (has a name and several tracks)


def parse_link(raw: str) -> Link:
    raw = raw.strip()
    if m := SPOTIFY_RE.match(raw):
        kind = m.group(1)
        return Link(f"https://open.spotify.com/{kind}/{m.group(2)}", "spotify", kind != "track")

    u = urlparse(raw)
    host = (u.hostname or "").lower()
    if u.scheme in ("http", "https") and (host.startswith("music.amazon.") or host.endswith(".amazon.com")):
        raise LinkError(
            "Amazon Music links aren't supported: Amazon doesn't publish playlist contents in a form these tools can read. "
            "Find the same playlist on Spotify or YouTube Music and paste that link instead."
        )
    if u.scheme in ("http", "https") and host in YT_HOSTS:
        q = parse_qs(u.query)
        vid = (q.get("v") or [""])[0]
        lst = (q.get("list") or [""])[0]
        if host == "youtu.be":
            vid = u.path.strip("/")
        if u.path.rstrip("/") == "/playlist" and YT_ID.match(lst):
            return Link(f"https://music.youtube.com/playlist?list={lst}", "youtube", True)
        if YT_ID.match(vid):
            # Radio/mix lists ("RD…") are endless and personal, so treat those as the single song
            if YT_ID.match(lst) and not lst.startswith(("RD", "UL")) and u.path.rstrip("/") == "/watch":
                return Link(f"https://music.youtube.com/playlist?list={lst}", "youtube", True)
            return Link(f"https://music.youtube.com/watch?v={vid}", "youtube", False)
    raise LinkError("Enter a Spotify or YouTube Music playlist, album or track link")
