"""Run from the server folder:  python3 -m unittest discover tests -v"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLAYLIST_SAVER_MOCK_DELAY"] = "0"

import cloud  # noqa: E402
from cloud import CloudError, Dropbox, GoogleDrive  # noqa: E402
from config import Store  # noqa: E402
from mock_cloud import MockProvider  # noqa: E402
from sync import CloudSyncer, seed_placeholders  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.store = Store(self.tmp / "config.json")
        self.remote_root = self.tmp / "remote"
        self.prov = MockProvider(self.store, "dropbox", "Dropbox", self.remote_root)
        self.local = self.tmp / "local"
        self.local.mkdir()
        self.events: list[tuple[str, str, str]] = []

    def write(self, rel: str, text: str) -> Path:
        p = self.local / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    def syncer(self, **kw) -> CloudSyncer:
        kw.setdefault("stable_seconds", 0)
        return CloudSyncer(self.prov, self.prov.root(), self.local, lambda *e: self.events.append(e), **kw)

    def remote(self, rel: str) -> Path:
        return self.remote_root / "dropbox" / rel


class NeverOverwrite(Base):
    def test_existing_remote_file_is_left_untouched(self):
        (self.remote("Summer")).mkdir(parents=True)
        self.remote("Summer/A.mp3").write_text("REMOTE ORIGINAL")
        self.write("A.mp3", "local different bytes")
        self.write("B.mp3", "new")
        s = self.syncer(prefix="Summer")
        s.sweep(final=True)
        self.assertEqual(self.remote("Summer/A.mp3").read_text(), "REMOTE ORIGINAL")
        self.assertEqual(self.remote("Summer/B.mp3").read_text(), "new")
        self.assertEqual(sorted(self.events), [("A.mp3", "exists", ""), ("B.mp3", "uploaded", "")])

    def test_second_sync_uploads_nothing(self):
        self.write("A.mp3", "a")
        self.write("B.mp3", "b")
        self.syncer(prefix="P").sweep(final=True)
        self.events.clear()
        self.syncer(prefix="P").sweep(final=True)
        self.assertEqual({e[1] for e in self.events}, {"exists"})
        self.assertEqual(len(self.events), 2)

    def test_name_match_ignores_case(self):
        self.remote("P").mkdir(parents=True)
        self.remote("P/song.mp3").write_text("keep")
        self.write("SONG.mp3", "other")
        self.syncer(prefix="P").sweep(final=True)
        self.assertEqual(self.events[0][1], "exists")
        self.assertFalse(self.remote("P/SONG.mp3").exists() and self.remote("P/song.mp3").read_text() != "keep")

    def test_provider_itself_refuses_to_replace(self):
        dest = self.prov.ensure_path(self.prov.root(), "X")
        self.remote("X/a.mp3").write_text("orig")
        src = self.write("a.mp3", "new")
        self.assertEqual(self.prov.upload(dest, src, "a.mp3"), "exists")
        self.assertEqual(self.remote("X/a.mp3").read_text(), "orig")


class Staging(Base):
    def test_direct_mode_deletes_local_copy_after_upload_or_exists(self):
        self.remote("P").mkdir(parents=True)
        self.remote("P/old.mp3").write_text("x")
        a = self.write("P/new.mp3", "n")
        b = self.write("P/old.mp3", "o")
        self.syncer(delete_after=True).sweep(final=True)
        self.assertFalse(a.exists() or b.exists())
        self.assertTrue(self.remote("P/new.mp3").exists())

    def test_failed_upload_keeps_the_file_and_reports(self):
        self.prov.fail_names = {"bad.mp3"}
        good = self.write("P/good.mp3", "g")
        bad = self.write("P/bad.mp3", "b")
        s = self.syncer(delete_after=True)
        s.sweep(final=True)
        self.assertFalse(good.exists())
        self.assertTrue(bad.exists())
        self.assertEqual(s.failed, [bad])
        failed = [e for e in self.events if e[1] == "failed"]
        self.assertEqual(len(failed), 1)
        self.assertIn("simulated", failed[0][2])

    def test_files_still_changing_are_not_uploaded(self):
        self.write("grow.mp3", "partial")
        s = self.syncer(stable_seconds=60)
        self.assertEqual(s.sweep(final=False), 0)
        self.assertEqual(s.sweep(final=False), 0)
        self.assertEqual(self.events, [])

    def test_stable_files_upload_on_second_pass(self):
        self.write("done.mp3", "complete")
        s = self.syncer(stable_seconds=0)
        self.assertEqual(s.sweep(final=False), 0)  # first sighting
        self.assertEqual(s.sweep(final=False), 1)
        self.assertEqual(self.events, [("done.mp3", "uploaded", "")])

    def test_non_audio_and_empty_files_are_ignored(self):
        self.write("cover.jpg", "img")
        self.write("notes.txt", "t")
        self.write("placeholder.mp3", "")
        s = self.syncer()
        self.assertEqual(s.sweep(final=True), 0)

    def test_since_limits_to_new_files(self):
        old = self.write("old.mp3", "o")
        os.utime(old, (1, 1))
        self.write("new.mp3", "n")
        self.syncer(since=1000, recursive=False).sweep(final=True)
        self.assertEqual([e[0] for e in self.events], ["new.mp3"])


class Seeding(Base):
    def test_only_matching_format_is_seeded_and_ignored_by_syncer(self):
        self.remote("P").mkdir(parents=True)
        self.remote("P/have.mp3").write_text("x")
        self.remote("P/other.flac").write_text("x")
        staging = self.tmp / "staging"
        n = seed_placeholders(self.prov, self.prov.root(), "P", staging, "mp3")
        self.assertEqual(n, 1)
        self.assertEqual((staging / "P" / "have.mp3").stat().st_size, 0)
        self.assertFalse((staging / "P" / "other.flac").exists())
        s = CloudSyncer(self.prov, self.prov.root(), staging, lambda *e: self.events.append(e), delete_after=True)
        self.assertEqual(s.sweep(final=True), 0)

    def test_unknown_remote_folder_seeds_nothing_and_creates_nothing(self):
        staging = self.tmp / "staging"
        self.assertEqual(seed_placeholders(self.prov, self.prov.root(), "Nope", staging, "mp3"), 0)
        self.assertFalse(self.remote("Nope").exists())


class OAuth(Base):
    def setUp(self):
        super().setUp()
        self.store.update_provider("dropbox", {"client_id": "KEY123"})
        self.store.update_provider("gdrive", {"client_id": "gid.apps", "client_secret": "s3cret", "scope": "app"})
        self.dbx = Dropbox(self.store)
        self.drive = GoogleDrive(self.store)

    def test_dropbox_auth_url_uses_pkce_and_state(self):
        url = cloud.begin_auth(self.dbx, "http://localhost:5173/", "http://localhost:8000/api/oauth/callback")
        q = parse_qs(urlparse(url).query)
        self.assertEqual(q["client_id"], ["KEY123"])
        self.assertEqual(q["code_challenge_method"], ["S256"])
        self.assertEqual(q["token_access_type"], ["offline"])
        self.assertNotIn("client_secret", q)
        session = cloud.finish_auth(q["state"][0])
        self.assertEqual(session["provider"], "dropbox")
        self.assertGreaterEqual(len(session["verifier"]), 43)
        with self.assertRaises(CloudError):  # a state can only be used once
            cloud.finish_auth(q["state"][0])

    def test_google_scope_follows_the_access_choice(self):
        q = parse_qs(urlparse(self.drive.auth_url("http://localhost:8000/cb", "st", "ch")).query)
        self.assertTrue(q["scope"][0].endswith("/auth/drive.file"))
        self.store.update_provider("gdrive", {"scope": "full"})
        q = parse_qs(urlparse(self.drive.auth_url("http://localhost:8000/cb", "st", "ch")).query)
        self.assertTrue(q["scope"][0].endswith("/auth/drive"))

    def test_unknown_state_is_rejected(self):
        with self.assertRaises(CloudError):
            cloud.finish_auth("forged")

    def test_exchange_stores_tokens_and_account(self):
        resp = mock.Mock(ok=True)
        resp.json.return_value = {"access_token": "AT", "refresh_token": "RT", "expires_in": 14400}
        with mock.patch("cloud.requests.post", return_value=resp) as post, mock.patch.object(
            Dropbox, "fetch_account", return_value={"name": "Ada", "email": "a@x.io"}
        ):
            self.dbx.exchange("CODE", "VER", "http://localhost:8000/cb")
        sent = post.call_args.kwargs["data"]
        self.assertEqual((sent["code"], sent["code_verifier"]), ("CODE", "VER"))
        cfg = self.store.provider("dropbox")
        self.assertEqual(cfg["tokens"]["refresh_token"], "RT")
        self.assertEqual(cfg["account"]["name"], "Ada")
        self.assertTrue(self.dbx.connected)

    def test_expired_access_token_is_refreshed_and_keeps_refresh_token(self):
        self.store.update_provider("dropbox", {"tokens": {"access_token": "old", "refresh_token": "RT", "expires_at": 0}})
        resp = mock.Mock(ok=True)
        resp.json.return_value = {"access_token": "new", "expires_in": 3600}
        with mock.patch("cloud.requests.post", return_value=resp):
            self.assertEqual(self.dbx.access_token(), "new")
        self.assertEqual(self.store.provider("dropbox")["tokens"]["refresh_token"], "RT")

    def test_disconnect_forgets_session_but_keeps_app_key(self):
        self.store.update_provider("dropbox", {"tokens": {"access_token": "a"}, "account": {"name": "x"}})
        with mock.patch("cloud.requests.post"):
            self.dbx.disconnect()
        cfg = self.store.provider("dropbox")
        self.assertNotIn("tokens", cfg)
        self.assertEqual(cfg["client_id"], "KEY123")

    def test_connection_is_remembered_after_a_restart(self):
        self.store.update_provider(
            "dropbox", {"tokens": {"access_token": "a", "refresh_token": "r", "expires_at": 9e12}, "account": {"name": "Ada"}}
        )
        reopened = Store(self.store.path)  # what the server does on every launch
        dbx = Dropbox(reopened)
        self.assertTrue(dbx.connected)
        self.assertEqual(dbx.status()["account"]["name"], "Ada")
        self.assertEqual(dbx.access_token(), "a")  # still valid: no network call needed

    def test_revoked_refresh_token_is_flagged_for_reconnect_at_startup(self):
        self.store.update_provider("dropbox", {"tokens": {"access_token": "a", "refresh_token": "r", "expires_at": 0}})
        rejected = mock.Mock(ok=False, status_code=400, text='{"error": "invalid_grant"}')
        with mock.patch("cloud.requests.post", return_value=rejected):
            self.dbx.check()
        self.assertFalse(self.dbx.connected)
        st = self.dbx.status()
        self.assertTrue(st["expired"])
        self.assertEqual(st["client_id"], "KEY123")  # app credentials survive, so reconnecting is one click
        with self.assertRaises(cloud.NotConnected):
            self.dbx.access_token()

    def test_being_offline_does_not_look_like_being_signed_out(self):
        import requests

        self.store.update_provider("dropbox", {"tokens": {"access_token": "a", "refresh_token": "r", "expires_at": 0}})
        with mock.patch("cloud.requests.post", side_effect=requests.ConnectionError("down")):
            self.dbx.check()
        self.assertTrue(self.dbx.connected)
        self.assertFalse(self.dbx.status()["expired"])

    def test_reconnecting_clears_the_expired_flag(self):
        self.store.update_provider("dropbox", {"tokens": {"access_token": "a", "refresh_token": "r"}, "expired": True})
        resp = mock.Mock(ok=True)
        resp.json.return_value = {"access_token": "new", "refresh_token": "r2", "expires_in": 100}
        with mock.patch("cloud.requests.post", return_value=resp), mock.patch.object(
            Dropbox, "fetch_account", return_value={"name": "A", "email": ""}
        ):
            self.dbx.exchange("c", "v", "http://localhost:8000/cb")
        self.assertTrue(self.dbx.connected)

    def test_not_connected_gives_a_clear_error(self):
        with self.assertRaises(cloud.NotConnected):
            self.dbx.access_token()


class ProviderWrites(Base):
    def setUp(self):
        super().setUp()
        self.store.update_provider(
            "dropbox", {"client_id": "k", "tokens": {"access_token": "t", "refresh_token": "r", "expires_at": 9e12}}
        )
        self.store.update_provider(
            "gdrive", {"client_id": "k", "tokens": {"access_token": "t", "refresh_token": "r", "expires_at": 9e12}}
        )

    def test_dropbox_upload_uses_add_mode_and_maps_conflict_to_exists(self):
        f = self.write("a.mp3", "data")
        conflict = mock.Mock(status_code=409, ok=False, text='{"error_summary": "path/conflict/file/.."}')
        with mock.patch("cloud.requests.request", return_value=conflict) as req:
            self.assertEqual(Dropbox(self.store).upload({"id": "/Music", "path": "/Music"}, f, "a.mp3"), "exists")
        import json

        arg = json.loads(req.call_args.kwargs["headers"]["Dropbox-API-Arg"])
        self.assertEqual((arg["mode"], arg["autorename"], arg["path"]), ("add", False, "/Music/a.mp3"))

    def test_dropbox_rejects_oversize_files_before_sending(self):
        f = self.write("big.mp3", "x")
        with mock.patch.object(Path, "stat", return_value=mock.Mock(st_size=200 * 1024 * 1024)):
            with self.assertRaises(CloudError):
                Dropbox(self.store).upload({"id": "", "path": "/"}, f, "big.mp3")

    def test_drive_skips_when_a_file_with_that_name_exists(self):
        f = self.write("a.mp3", "data")
        drive = GoogleDrive(self.store)
        with mock.patch.object(GoogleDrive, "_files", return_value=[{"id": "1", "name": "a.mp3"}]), mock.patch(
            "cloud.requests.request"
        ) as req:
            self.assertEqual(drive.upload({"id": "folder", "path": "x"}, f, "a.mp3"), "exists")
        req.assert_not_called()

    def test_drive_query_escapes_quotes(self):
        self.assertEqual(cloud._gq("Don't \\ stop"), "Don\\'t \\\\ stop")


class DisconnectFlow(unittest.TestCase):
    """Endpoint behaviour, driven through the demo provider (no network, no real accounts)."""

    @classmethod
    def setUpClass(cls):
        home = tempfile.mkdtemp()
        os.environ["PLAYLIST_SAVER_HOME"] = home
        os.environ["PLAYLIST_SAVER_MOCK_CLOUD"] = tempfile.mkdtemp()
        import importlib

        import config as config_mod

        importlib.reload(config_mod)
        import main as main_mod

        cls.main = importlib.reload(main_mod)

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("PLAYLIST_SAVER_MOCK_CLOUD", None)
        os.environ.pop("PLAYLIST_SAVER_HOME", None)

    def run_async(self, coro):
        import asyncio

        return asyncio.run(coro)

    def test_disconnect_one_service_leaves_the_other_connected(self):
        m = self.main
        out = self.run_async(m.disconnect("dropbox"))
        status = {p["key"]: p["connected"] for p in out["providers"]}
        self.assertEqual(status, {"dropbox": False, "gdrive": True})
        # reconnect through the same callback path a real provider would use
        url = self.run_async(m.connect("dropbox", m.ConnectRequest(return_to="http://localhost:5173/")))["auth_url"]
        state = parse_qs(urlparse(url).query)["state"][0]
        resp = self.run_async(m.oauth_callback(state=state, code="demo"))
        self.assertIn("connected=dropbox", resp.headers["location"])
        self.assertTrue(m.providers["dropbox"].connected)

    def test_disconnecting_the_default_destination_falls_back_to_this_mac(self):
        m = self.main
        m.store.update_settings({"destination": "gdrive"})
        out = self.run_async(m.disconnect("gdrive"))
        self.assertEqual(out["settings"]["destination"], "local")
        self.run_async(m.connect("gdrive", m.ConnectRequest(return_to="http://localhost:5173/")))

    def test_cannot_start_a_cloud_job_while_disconnected(self):
        m = self.main
        self.run_async(m.disconnect("dropbox"))
        req = m.JobRequest(url="https://open.spotify.com/playlist/abc", destination="dropbox")
        with self.assertRaises(m.HTTPException) as ctx:
            m.resolve_plan(req)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("isn't connected", ctx.exception.detail)

    def test_return_address_must_be_local(self):
        m = self.main
        with self.assertRaises(m.HTTPException):
            m.safe_return_to("https://evil.example/")
        self.assertEqual(m.safe_return_to("http://localhost:5173/x?y=1"), "http://localhost:5173/")


class Config(unittest.TestCase):
    def test_settings_persist_across_restarts_and_file_is_private(self):
        path = Path(tempfile.mkdtemp()) / "c.json"
        s = Store(path)
        s.update_settings({"destination": "dropbox", "cloud_dest": {"dropbox": {"id": "/Music", "path": "/Music"}}})
        s.update_provider("dropbox", {"client_id": "k", "tokens": {"access_token": "secret"}})
        again = Store(path)
        self.assertEqual(again.settings()["destination"], "dropbox")
        self.assertEqual(again.settings()["cloud_dest"]["dropbox"]["path"], "/Music")
        self.assertEqual(again.settings()["cloud_dest"]["gdrive"]["id"], "root")  # untouched default kept
        self.assertEqual(oct(path.stat().st_mode & 0o777), "0o600")

    def test_corrupt_file_falls_back_to_defaults(self):
        path = Path(tempfile.mkdtemp()) / "c.json"
        path.write_text("{not json")
        self.assertEqual(Store(path).settings()["destination"], "local")


if __name__ == "__main__":
    unittest.main()
