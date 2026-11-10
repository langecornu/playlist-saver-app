"""Dropbox and Google Drive providers (OAuth 2 with PKCE) used to store downloaded audio.

Every provider exposes the same small interface:

    folders / create_folder / ensure_path   browse and create destination folders
    list_names                              names already present in a folder
    upload                                  write a file, never replacing an existing one

A destination folder is a dict ``{"id": ..., "path": ...}``. For Dropbox ``id`` is the path,
for Google Drive it is the folder id and ``path`` is a human readable breadcrumb.
"""
import base64
import hashlib
import json
import mimetypes
import os
import secrets
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests

from config import Store

RETRY_STATUS = (429, 500, 502, 503, 504)


class CloudError(Exception):
    """A problem worth showing to the user as-is."""


class NotConnected(CloudError):
    pass


class AuthExpired(NotConnected):
    """The provider rejected our refresh token (revoked or expired): the user must sign in again."""


# --------------------------------------------------------------------------- OAuth sessions
_pending: dict[str, dict[str, Any]] = {}
_PENDING_TTL = 600


def begin_auth(provider: "Provider", return_to: str, redirect_uri: str) -> str:
    """Create a PKCE session and return the URL the browser should visit."""
    now = time.time()
    for s in [s for s, v in _pending.items() if now - v["t"] > _PENDING_TTL]:
        _pending.pop(s, None)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    _pending[state] = {
        "provider": provider.key,
        "verifier": verifier,
        "return_to": return_to,
        "redirect_uri": redirect_uri,
        "t": now,
    }
    return provider.auth_url(redirect_uri, state, challenge)


def finish_auth(state: str) -> dict[str, Any]:
    session = _pending.pop(state, None)
    if not session or time.time() - session["t"] > _PENDING_TTL:
        raise CloudError("This sign-in link expired. Start the connection again.")
    return session


# --------------------------------------------------------------------------- base class
class Provider:
    key = ""
    label = ""
    auth_endpoint = ""
    token_endpoint = ""

    def __init__(self, store: Store):
        self.store = store

    # ---- configuration / status
    def cfg(self) -> dict[str, Any]:
        return self.store.provider(self.key)

    @property
    def configured(self) -> bool:
        return bool(self.cfg().get("client_id"))

    @property
    def connected(self) -> bool:
        c = self.cfg()
        return bool(c.get("tokens")) and not c.get("expired")

    def check(self) -> None:
        """Validate the saved session at startup so a revoked one shows as 'reconnect needed'.

        Refreshes the access token when it has lapsed. Network problems are ignored: being offline
        must never look like being signed out.
        """
        if self.cfg().get("tokens"):
            try:
                self.access_token()
            except CloudError:
                pass

    def status(self) -> dict[str, Any]:
        c = self.cfg()
        return {
            "key": self.key,
            "label": self.label,
            "configured": self.configured,
            "connected": self.connected,
            "expired": bool(c.get("tokens") and c.get("expired")),
            "account": c.get("account"),
            "client_id": c.get("client_id", ""),
            "has_secret": bool(c.get("client_secret")),
            "scope": c.get("scope", ""),
        }

    # ---- OAuth
    def auth_url(self, redirect_uri: str, state: str, challenge: str) -> str:
        raise NotImplementedError

    def _token_call(self, data: dict[str, str]) -> dict[str, Any]:
        c = self.cfg()
        body = {"client_id": c.get("client_id", ""), **data}
        if c.get("client_secret"):
            body["client_secret"] = c["client_secret"]
        try:
            r = requests.post(self.token_endpoint, data=body, timeout=30)
        except requests.RequestException as e:
            raise CloudError(f"Can't reach {self.label}. Check your internet connection.") from e
        if not r.ok:
            if r.status_code in (400, 401) and "invalid_grant" in r.text:
                raise AuthExpired(f"{self.label} no longer accepts this sign-in.")
            raise CloudError(f"{self.label} sign-in failed: {self._message(r)}")
        return r.json()

    def exchange(self, code: str, verifier: str, redirect_uri: str) -> None:
        resp = self._token_call(
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
            }
        )
        self._save_tokens(resp)
        try:
            self.store.update_provider(self.key, {"account": self.fetch_account()})
        except CloudError:
            pass  # connected is what matters; the name is cosmetic

    def _save_tokens(self, resp: dict[str, Any], old: dict[str, Any] | None = None) -> dict[str, Any]:
        tokens = {
            "access_token": resp["access_token"],
            "refresh_token": resp.get("refresh_token") or (old or {}).get("refresh_token"),
            "expires_at": time.time() + int(resp.get("expires_in", 3600)),
        }
        self.store.update_provider(self.key, {"tokens": tokens, "expired": False})
        return tokens

    def access_token(self, force: bool = False) -> str:
        c = self.cfg()
        t = c.get("tokens")
        if not t:
            raise NotConnected(f"{self.label} isn't connected. Connect it in Settings.")
        if c.get("expired"):  # already rejected once: don't keep hitting the provider
            raise NotConnected(f"{self.label} session expired. Reconnect it in Settings.")
        if force or time.time() > t.get("expires_at", 0) - 60:
            if not t.get("refresh_token"):
                raise NotConnected(f"{self.label} session expired. Reconnect it in Settings.")
            try:
                resp = self._token_call({"grant_type": "refresh_token", "refresh_token": t["refresh_token"]})
            except AuthExpired as e:
                self.store.update_provider(self.key, {"expired": True})
                raise NotConnected(f"{self.label} session expired. Reconnect it in Settings.") from e
            t = self._save_tokens(resp, t)  # transient errors propagate untouched: still connected
        return t["access_token"]

    def disconnect(self) -> None:
        tokens = self.cfg().get("tokens") or {}
        try:
            self.revoke(tokens)
        except Exception:
            pass  # revoking is best effort; always forget locally
        self.store.clear_provider_session(self.key)

    def revoke(self, tokens: dict[str, Any]) -> None:
        pass

    # ---- HTTP helpers
    @staticmethod
    def _message(r: requests.Response) -> str:
        try:
            j = r.json()
        except ValueError:
            return r.text[:200] or f"HTTP {r.status_code}"
        if isinstance(j, dict):
            err = j.get("error_description") or j.get("error_summary") or j.get("error")
            if isinstance(err, dict):
                err = err.get("message")
            if err:
                return str(err)
        return f"HTTP {r.status_code}"

    def _authed(self, method: str, url: str, **kw: Any) -> requests.Response:
        """Authorised request that refreshes an expired token once and retries transient errors."""
        extra = kw.pop("headers", {})
        timeout = kw.pop("timeout", 60)
        data = kw.get("data")
        force = refreshed = False
        for attempt in range(3):
            if hasattr(data, "seek"):
                data.seek(0)  # streamed uploads must restart from the top on every attempt
            headers = {**extra, "Authorization": f"Bearer {self.access_token(force=force)}"}
            r = requests.request(method, url, headers=headers, timeout=timeout, **kw)
            force = False
            if r.status_code == 401 and not refreshed:
                refreshed = force = True  # token may have been revoked or expired early
                continue
            if r.status_code in RETRY_STATUS and attempt < 2:
                time.sleep(float(r.headers.get("Retry-After", 2**attempt)))
                continue
            return r
        return r

    def _check(self, r: requests.Response) -> requests.Response:
        if not r.ok:
            raise CloudError(f"{self.label}: {self._message(r)}")
        return r

    # ---- file operations (implemented per provider)
    def root(self) -> dict[str, str]:
        raise NotImplementedError

    def fetch_account(self) -> dict[str, str]:
        raise NotImplementedError

    def folders(self, dest: dict[str, str]) -> list[dict[str, str]]:
        raise NotImplementedError

    def create_folder(self, dest: dict[str, str], name: str) -> dict[str, str]:
        raise NotImplementedError

    def ensure_path(self, base: dict[str, str], rel: str, create: bool = True) -> dict[str, str] | None:
        raise NotImplementedError

    def list_names(self, dest: dict[str, str]) -> set[str]:
        raise NotImplementedError

    def upload(self, dest: dict[str, str], path: Path, name: str) -> str:
        """Write `path` into `dest` as `name`. Returns "uploaded" or "exists"; never overwrites."""
        raise NotImplementedError


# --------------------------------------------------------------------------- Dropbox
def _dbx_path(path: str) -> str:
    p = "/".join(s for s in path.replace("\\", "/").split("/") if s)
    return f"/{p}" if p else ""


class Dropbox(Provider):
    key = "dropbox"
    label = "Dropbox"
    auth_endpoint = "https://www.dropbox.com/oauth2/authorize"
    token_endpoint = "https://api.dropboxapi.com/oauth2/token"
    API = "https://api.dropboxapi.com/2"
    CONTENT = "https://content.dropboxapi.com/2"
    MAX_SIMPLE_UPLOAD = 150 * 1024 * 1024

    def auth_url(self, redirect_uri: str, state: str, challenge: str) -> str:
        return self.auth_endpoint + "?" + urlencode(
            {
                "client_id": self.cfg().get("client_id", ""),
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "token_access_type": "offline",
            }
        )

    def revoke(self, tokens: dict[str, Any]) -> None:
        if tokens.get("access_token"):
            requests.post(
                f"{self.API}/auth/token/revoke",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
                timeout=15,
            )

    def _rpc(self, endpoint: str, body: dict[str, Any] | None = None, allow: tuple[str, ...] = ()) -> requests.Response:
        kw: dict[str, Any] = {}
        if body is not None:
            kw["json"] = body
        r = self._authed("POST", f"{self.API}/{endpoint}", **kw)
        if r.status_code == 409 and any(a in r.text for a in allow):
            return r
        return self._check(r)

    def root(self) -> dict[str, str]:
        return {"id": "", "path": "/"}

    def fetch_account(self) -> dict[str, str]:
        j = self._rpc("users/get_current_account").json()
        return {"name": j.get("name", {}).get("display_name", ""), "email": j.get("email", "")}

    def _entries(self, path: str) -> list[dict[str, Any]]:
        r = self._rpc("files/list_folder", {"path": path, "limit": 2000}, allow=("not_found",))
        if r.status_code == 409:
            return []
        entries = []
        while True:
            j = r.json()
            entries += j["entries"]
            if not j.get("has_more"):
                return entries
            r = self._rpc("files/list_folder/continue", {"cursor": j["cursor"]})

    def folders(self, dest: dict[str, str]) -> list[dict[str, str]]:
        out = [
            {"id": e["path_display"], "name": e["name"], "path": e["path_display"]}
            for e in self._entries(_dbx_path(dest["id"]))
            if e[".tag"] == "folder"
        ]
        return sorted(out, key=lambda f: f["name"].lower())

    def create_folder(self, dest: dict[str, str], name: str) -> dict[str, str]:
        path = _dbx_path(f"{dest['id']}/{name}")
        self._rpc("files/create_folder_v2", {"path": path, "autorename": False}, allow=("conflict",))
        return {"id": path, "name": name, "path": path}

    def ensure_path(self, base: dict[str, str], rel: str, create: bool = True) -> dict[str, str] | None:
        if not rel.strip("/"):
            return base
        path = _dbx_path(f"{base['id']}/{rel}")
        if create:
            self._rpc("files/create_folder_v2", {"path": path, "autorename": False}, allow=("conflict",))
        else:
            r = self._rpc("files/get_metadata", {"path": path}, allow=("not_found",))
            if r.status_code == 409:
                return None
        return {"id": path, "path": path}

    def list_names(self, dest: dict[str, str]) -> set[str]:
        return {e["name"] for e in self._entries(_dbx_path(dest["id"])) if e[".tag"] == "file"}

    def upload(self, dest: dict[str, str], path: Path, name: str) -> str:
        if path.stat().st_size > self.MAX_SIMPLE_UPLOAD:
            raise CloudError(f"{name} is over 150 MB, which this app can't send to Dropbox.")
        # mode=add + autorename=false makes Dropbox itself refuse to replace an existing file
        arg = json.dumps(
            {"path": _dbx_path(f"{dest['id']}/{name}"), "mode": "add", "autorename": False, "mute": True}
        )
        with open(path, "rb") as f:
            r = self._authed(
                "POST",
                f"{self.CONTENT}/files/upload",
                headers={"Dropbox-API-Arg": arg, "Content-Type": "application/octet-stream"},
                data=f,
                timeout=600,
            )
        if r.status_code == 409 and "conflict" in r.text:
            return "exists"
        self._check(r)
        return "uploaded"


# --------------------------------------------------------------------------- Google Drive
FOLDER_MIME = "application/vnd.google-apps.folder"


def _gq(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


class GoogleDrive(Provider):
    key = "gdrive"
    label = "Google Drive"
    auth_endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
    token_endpoint = "https://oauth2.googleapis.com/token"
    API = "https://www.googleapis.com/drive/v3"
    UPLOAD = "https://www.googleapis.com/upload/drive/v3"
    SCOPES = {
        # Only files and folders this app creates: safest, but can't see your existing folders
        "app": "https://www.googleapis.com/auth/drive.file",
        # Whole Drive: lets you pick any existing folder and avoids duplicating files you already have
        "full": "https://www.googleapis.com/auth/drive",
    }

    def auth_url(self, redirect_uri: str, state: str, challenge: str) -> str:
        scope = self.SCOPES.get(self.cfg().get("scope") or "app", self.SCOPES["app"])
        return self.auth_endpoint + "?" + urlencode(
            {
                "client_id": self.cfg().get("client_id", ""),
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "scope": scope,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "access_type": "offline",
                "prompt": "consent",
            }
        )

    def revoke(self, tokens: dict[str, Any]) -> None:
        token = tokens.get("refresh_token") or tokens.get("access_token")
        if token:
            requests.post("https://oauth2.googleapis.com/revoke", data={"token": token}, timeout=15)

    def root(self) -> dict[str, str]:
        return {"id": "root", "path": "My Drive"}

    def fetch_account(self) -> dict[str, str]:
        r = self._check(self._authed("GET", f"{self.API}/about", params={"fields": "user(displayName,emailAddress)"}))
        u = r.json().get("user", {})
        return {"name": u.get("displayName", ""), "email": u.get("emailAddress", "")}

    def _files(self, q: str, fields: str = "files(id,name)") -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        token = None
        while True:
            params = {"q": q, "fields": f"nextPageToken,{fields}", "pageSize": 1000, "spaces": "drive"}
            if token:
                params["pageToken"] = token
            j = self._check(self._authed("GET", f"{self.API}/files", params=params)).json()
            out += j.get("files", [])
            token = j.get("nextPageToken")
            if not token:
                return out

    def folders(self, dest: dict[str, str]) -> list[dict[str, str]]:
        q = f"'{_gq(dest['id'])}' in parents and mimeType='{FOLDER_MIME}' and trashed=false"
        out = [
            {"id": f["id"], "name": f["name"], "path": f"{dest['path']}/{f['name']}"} for f in self._files(q)
        ]
        return sorted(out, key=lambda f: f["name"].lower())

    def create_folder(self, dest: dict[str, str], name: str) -> dict[str, str]:
        r = self._check(
            self._authed(
                "POST",
                f"{self.API}/files",
                params={"fields": "id,name"},
                json={"name": name, "mimeType": FOLDER_MIME, "parents": [dest["id"]]},
            )
        )
        return {"id": r.json()["id"], "name": name, "path": f"{dest['path']}/{name}"}

    def ensure_path(self, base: dict[str, str], rel: str, create: bool = True) -> dict[str, str] | None:
        cur = base
        for part in [p for p in rel.split("/") if p]:
            q = (
                f"'{_gq(cur['id'])}' in parents and mimeType='{FOLDER_MIME}' "
                f"and trashed=false and name='{_gq(part)}'"
            )
            found = self._files(q)
            if found:
                cur = {"id": found[0]["id"], "path": f"{cur['path']}/{part}"}
            elif create:
                made = self.create_folder(cur, part)
                cur = {"id": made["id"], "path": made["path"]}
            else:
                return None
        return cur

    def list_names(self, dest: dict[str, str]) -> set[str]:
        q = f"'{_gq(dest['id'])}' in parents and trashed=false and mimeType!='{FOLDER_MIME}'"
        return {f["name"] for f in self._files(q)}

    def upload(self, dest: dict[str, str], path: Path, name: str) -> str:
        # Drive happily stores duplicates with the same name, so look right before writing
        if self._files(f"'{_gq(dest['id'])}' in parents and trashed=false and name='{_gq(name)}'"):
            return "exists"
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        size = path.stat().st_size
        last: Exception | None = None
        for attempt in range(3):
            try:
                init = self._check(
                    self._authed(
                        "POST",
                        f"{self.UPLOAD}/files?uploadType=resumable",
                        headers={
                            "Content-Type": "application/json; charset=UTF-8",
                            "X-Upload-Content-Type": mime,
                            "X-Upload-Content-Length": str(size),
                        },
                        data=json.dumps({"name": name, "parents": [dest["id"]]}),
                    )
                )
                with open(path, "rb") as f:
                    put = requests.put(
                        init.headers["Location"], data=f, headers={"Content-Length": str(size)}, timeout=600
                    )
                if put.ok:
                    return "uploaded"
                if put.status_code not in RETRY_STATUS:
                    raise CloudError(f"{self.label}: {self._message(put)}")
                last = CloudError(f"{self.label}: {self._message(put)}")
            except requests.RequestException as e:
                last = e
            time.sleep(2**attempt)
        raise CloudError(f"{self.label}: upload failed ({last})")


# --------------------------------------------------------------------------- registry
def make_providers(store: Store) -> dict[str, Provider]:
    if os.environ.get("PLAYLIST_SAVER_MOCK_CLOUD"):
        from mock_cloud import MockProvider  # development aid, see mock_cloud.py

        root = Path(os.environ["PLAYLIST_SAVER_MOCK_CLOUD"])
        return {
            "dropbox": MockProvider(store, "dropbox", "Dropbox", root),
            "gdrive": MockProvider(store, "gdrive", "Google Drive", root),
        }
    return {"dropbox": Dropbox(store), "gdrive": GoogleDrive(store)}
