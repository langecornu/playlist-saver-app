"""Links, versions, duplicates, queue, saved playlists and history.  Run: python3 -m unittest discover tests"""
import asyncio
import importlib
import os
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["PLAYLIST_SAVER_MOCK_DELAY"] = "0"

import library  # noqa: E402
import versions  # noqa: E402
from config import Store  # noqa: E402
from links import LinkError, parse_link  # noqa: E402


class Links(unittest.TestCase):
    def test_spotify_links_lose_tracking_and_locale(self):
        l = parse_link("https://open.spotify.com/intl-fr/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc")
        self.assertEqual((l.url, l.source, l.is_list), ("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "spotify", True))
        self.assertFalse(parse_link("https://open.spotify.com/track/abc123?si=x").is_list)

    def test_youtube_music_playlist_album_and_song(self):
        p = parse_link("https://music.youtube.com/playlist?list=PLabc123XYZ&si=track")
        self.assertEqual((p.url, p.is_list, p.source), ("https://music.youtube.com/playlist?list=PLabc123XYZ", True, "youtube"))
        a = parse_link("https://www.youtube.com/playlist?list=OLAK5uy_abcdef")
        self.assertEqual(a.url, "https://music.youtube.com/playlist?list=OLAK5uy_abcdef")
        s = parse_link("https://music.youtube.com/watch?v=CZBGAe5BkoM&feature=share")
        self.assertEqual((s.url, s.is_list), ("https://music.youtube.com/watch?v=CZBGAe5BkoM", False))
        self.assertEqual(parse_link("https://youtu.be/CZBGAe5BkoM?t=3").url, "https://music.youtube.com/watch?v=CZBGAe5BkoM")

    def test_watch_link_inside_a_playlist_vs_an_endless_mix(self):
        self.assertTrue(parse_link("https://www.youtube.com/watch?v=CZBGAe5BkoM&list=PLabc123XYZ").is_list)
        self.assertFalse(parse_link("https://www.youtube.com/watch?v=CZBGAe5BkoM&list=RDCZBGAe5BkoM").is_list)

    def test_amazon_music_gets_a_helpful_message(self):
        with self.assertRaises(LinkError) as ctx:
            parse_link("https://music.amazon.com/playlists/B0ABCDEF")
        self.assertIn("Amazon Music", str(ctx.exception))

    def test_other_links_are_rejected(self):
        for bad in ("", "hello", "https://example.com/playlist/1", "https://evil.test/?u=https://open.spotify.com/track/a", "javascript:alert(1)"):
            with self.assertRaises(LinkError, msg=bad):
                parse_link(bad)


class Versions(unittest.TestCase):
    def test_comparison(self):
        self.assertTrue(versions.newer("4.7.0", "4.6.0"))
        self.assertTrue(versions.newer("2026.11.1", "2026.10.26"))
        self.assertFalse(versions.newer("4.6.0", "4.6.0"))
        self.assertFalse(versions.newer("4.5.9", "4.6.0"))
        self.assertFalse(versions.newer(None, "4.6.0"))
        self.assertFalse(versions.newer("garbage", "4.6.0"))

    def test_offline_never_raises(self):
        from unittest import mock

        with mock.patch("urllib.request.urlopen", side_effect=OSError("offline")):
            self.assertIsNone(versions.latest_version("spotdl"))


class Duplicates(unittest.TestCase):
    def test_finds_same_song_in_two_playlists_and_ignores_placeholders(self):
        root = Path(tempfile.mkdtemp())
        for rel, size in [("A/Artist - Song.mp3", 5), ("B/Artist - Song.mp3", 5), ("B/01 - Artist - Song (Official Audio).flac", 9), ("B/Other.mp3", 5), ("C/Artist - Song.mp3", 0)]:
            f = root / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(b"x" * size)
        out = library.find_duplicates(root)
        self.assertEqual(out["group_count"], 1)
        self.assertEqual(len(out["groups"][0]["files"]), 3)
        self.assertEqual(out["scanned"], 4)  # the zero-byte placeholder is not counted
        self.assertTrue(all(Path(f["path"]).exists() for f in out["groups"][0]["files"]))

    def test_missing_folder_is_empty_not_an_error(self):
        self.assertEqual(library.find_duplicates(Path("/nonexistent/xyz"))["group_count"], 0)


class StoreFeatures(unittest.TestCase):
    def test_saved_playlists_and_history_persist(self):
        path = Path(tempfile.mkdtemp()) / "c.json"
        s = Store(path)
        pl = s.save_playlist({"url": "https://open.spotify.com/playlist/a", "interval": "daily", "last_run": 5})
        s.update_playlist(pl["id"], {"name": "Mix"})
        s.save_playlist({"url": "https://open.spotify.com/playlist/a", "interval": "weekly"})  # keeps earlier fields
        for i in range(Store.HISTORY_LIMIT + 5):
            s.add_history({"url": "u1" if i % 2 else "u2", "n": i})
        s2 = Store(path)
        got = s2.get_playlist(pl["id"])
        self.assertEqual((got["name"], got["interval"], got["last_run"]), ("Mix", "weekly", 5))
        self.assertEqual(len(s2.history(limit=1000)), Store.HISTORY_LIMIT)
        self.assertEqual(s2.history("u1", 2)[0]["n"], Store.HISTORY_LIMIT + 3)  # newest first
        self.assertTrue(s2.delete_playlist(pl["id"]))
        self.assertFalse(s2.delete_playlist(pl["id"]))


FAKE_SPOTDL = textwrap.dedent(
    """
    import sys, time
    print("Found 2 songs in Fake List (Playlist)", flush=True)
    time.sleep(float(sys.argv[-1]) if sys.argv[-1].replace('.', '').isdigit() else 0.8)
    print("A - One: Downloaded", flush=True)
    print("B - Two: Skipped", flush=True)
    print("2/2 complete", flush=True)
    """
)


class Engine(unittest.TestCase):
    """Queue, history and scheduler, using a stand-in for spotdl so nothing is downloaded."""

    @classmethod
    def setUpClass(cls):
        os.environ["PLAYLIST_SAVER_HOME"] = tempfile.mkdtemp()
        os.environ["PLAYLIST_SAVER_MOCK_CLOUD"] = tempfile.mkdtemp()
        import config as config_mod

        importlib.reload(config_mod)
        import main as main_mod

        cls.main = importlib.reload(main_mod)
        cls.script = Path(tempfile.mkdtemp()) / "fake_spotdl.py"
        cls.script.write_text(FAKE_SPOTDL)

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("PLAYLIST_SAVER_MOCK_CLOUD", None)
        os.environ.pop("PLAYLIST_SAVER_HOME", None)

    def setUp(self):
        self.m = self.main
        self.m.SPOTDL = [sys.executable, str(self.script)]
        self.m.jobs.clear()
        for pl in self.m.store.playlists():  # tests share one store; start each from a clean slate
            self.m.store.delete_playlist(pl["id"])
        self.m.slots = self.m.Slots()  # an asyncio.Condition belongs to one event loop; each test makes its own
        self.out = tempfile.mkdtemp()

    def req(self, **kw):
        base = dict(url="https://open.spotify.com/playlist/abc", output_dir=self.out, destination="local")
        return self.m.JobRequest(**{**base, **kw})

    async def wait_until(self, cond, timeout=15):
        for _ in range(int(timeout / 0.05)):
            if cond():
                return
            await asyncio.sleep(0.05)
        self.fail("timed out")

    def test_only_the_allowed_number_of_jobs_run_at_once(self):
        m = self.m

        async def go():
            m.store.update_settings({"max_concurrent": 1})
            jobs = [m.start_job(m.resolve_plan(self.req(url=f"https://open.spotify.com/playlist/p{i}"))) for i in range(3)]
            await self.wait_until(lambda: any(j.status in ("running", "starting") for j in jobs))
            states = [j.status for j in jobs]
            self.assertEqual(states.count("queued"), 2, states)
            self.assertEqual([j.snapshot()["queue_position"] for j in jobs if j.status == "queued"], [1, 2])
            await self.wait_until(lambda: all(j.status == "done" for j in jobs))
            self.assertEqual(m.slots.active, 0)

        asyncio.run(go())

    def test_raising_the_limit_lets_waiting_jobs_start(self):
        m = self.m

        async def go():
            m.store.update_settings({"max_concurrent": 1})
            a, b = (m.start_job(m.resolve_plan(self.req(url=f"https://open.spotify.com/playlist/q{i}"))) for i in range(2))
            await self.wait_until(lambda: a.status in ("running", "starting"))
            self.assertEqual(b.status, "queued")
            m.store.update_settings({"max_concurrent": 2})
            await m.slots.poke()
            await self.wait_until(lambda: b.status in ("starting", "running", "done"))
            await self.wait_until(lambda: a.status == b.status == "done")

        asyncio.run(go())

    def test_cancelling_a_queued_job_never_runs_it(self):
        m = self.m

        async def go():
            m.store.update_settings({"max_concurrent": 1})
            a, b = (m.start_job(m.resolve_plan(self.req(url=f"https://open.spotify.com/playlist/c{i}"))) for i in range(2))
            await self.wait_until(lambda: a.status in ("running", "starting"))
            before = len(m.store.history(limit=300))
            b.cancel()
            await self.wait_until(lambda: b.status == "cancelled")
            await self.wait_until(lambda: a.status == "done")
            self.assertIsNone(b.proc)
            self.assertEqual(len(m.store.history(limit=300)), before + 1)  # only `a` was recorded

        asyncio.run(go())

    def test_history_records_what_was_added(self):
        m = self.m

        async def go():
            m.store.update_settings({"max_concurrent": 2})
            url = "https://open.spotify.com/playlist/hist"
            j = m.start_job(m.resolve_plan(self.req(url=url)))
            await self.wait_until(lambda: j.status == "done")
            await asyncio.sleep(0.1)
            h = m.store.history(url, 1)[0]
            self.assertEqual((h["status"], h["added"], h["added_count"], h["skipped"], h["name"]), ("done", ["A - One"], 1, 1, "Fake List"))

        asyncio.run(go())

    def test_scheduler_runs_only_due_playlists_and_updates_them(self):
        m = self.m

        async def go():
            m.store.update_settings({"max_concurrent": 4})
            now = 1_000_000.0
            due = m.store.save_playlist({"url": "https://open.spotify.com/playlist/due", "interval": "daily", "last_run": now - 90000, "request": {"output_dir": self.out}})
            fresh = m.store.save_playlist({"url": "https://open.spotify.com/playlist/fresh", "interval": "daily", "last_run": now - 100, "request": {"output_dir": self.out}})
            off = m.store.save_playlist({"url": "https://open.spotify.com/playlist/off", "interval": "off", "last_run": 0, "request": {"output_dir": self.out}})
            weekly = m.store.save_playlist({"url": "https://open.spotify.com/playlist/week", "interval": "weekly", "last_run": now - 90000, "request": {"output_dir": self.out}})
            self.assertEqual(await m.run_due(now), 1)
            self.assertEqual({j.plan.url for j in m.jobs.values()}, {"https://open.spotify.com/playlist/due"})
            self.assertEqual(await m.run_due(now), 0)  # already running: not started twice
            job = next(iter(m.jobs.values()))
            self.assertEqual(job.trigger, "auto")
            await self.wait_until(lambda: job.status == "done")
            await asyncio.sleep(0.1)
            got = m.store.get_playlist(due["id"])
            self.assertEqual((got["name"], got["last_status"], got["last_added"]), ("Fake List", "done", 1))
            self.assertGreater(got["last_run"], now)
            for p in (fresh, off, weekly):
                self.assertEqual(m.store.get_playlist(p["id"])["last_run"], {fresh["id"]: now - 100, off["id"]: 0, weekly["id"]: now - 90000}[p["id"]])

        asyncio.run(go())

    def test_failed_checks_are_retried_in_an_hour_but_cancelled_ones_are_not(self):
        m = self.m

        async def go():
            for status in ("failed", "cancelled", "done"):
                url = f"https://open.spotify.com/playlist/retry{status}"
                pl = m.store.save_playlist({"url": url, "interval": "daily", "last_run": 0, "request": {}})
                job = m.Job(m.resolve_plan(self.req(url=url)), "auto")
                job.status = status
                job.record_history()
                got = m.store.get_playlist(pl["id"])
                if status == "failed":
                    self.assertAlmostEqual(m.playlist_view(got)["next_run"] - time.time(), m.RETRY_AFTER, delta=5)
                else:
                    self.assertEqual(got["last_run"], 0)  # untouched: the normal schedule applies

        asyncio.run(go())

    def test_auto_sync_with_disconnected_service_is_recorded_not_crashed(self):
        m = self.m

        async def go():
            asyncio.get_running_loop()
            asyncio.run_coroutine_threadsafe  # noqa: B018
            await m.disconnect("dropbox")
            pl = m.store.save_playlist({"url": "https://open.spotify.com/playlist/gone", "interval": "daily", "last_run": 0, "request": {"destination": "dropbox"}})
            self.assertIsNone(m.launch_saved(pl, "auto"))
            h = m.store.history(pl["url"], 1)[0]
            self.assertEqual(h["status"], "failed")
            self.assertIn("isn't connected", h["detail"])
            nxt = m.playlist_view(m.store.get_playlist(pl["id"]))["next_run"]
            self.assertAlmostEqual(nxt - time.time(), m.RETRY_AFTER, delta=5)  # retried soon, not tomorrow

        asyncio.run(go())

    def test_create_job_saves_schedule_only_for_playlists(self):
        m = self.m

        async def go():
            await m.create_job(self.req(url="https://open.spotify.com/playlist/sv?si=1", auto_sync="weekly"))
            await m.create_job(self.req(url="https://open.spotify.com/track/solo", auto_sync="weekly"))
            urls = {p["url"] for p in m.store.playlists()}
            self.assertIn("https://open.spotify.com/playlist/sv", urls)
            self.assertNotIn("https://open.spotify.com/track/solo", urls)
            for j in m.jobs.values():
                await self.wait_until(lambda j=j: j.status == "done")

        asyncio.run(go())

    def test_plan_options(self):
        m = self.m
        flat = m.resolve_plan(self.req())
        self.assertTrue(flat.in_folder and not flat.nested)
        lib = m.resolve_plan(self.req(naming="artist_album", lrc=True, m3u=True))
        self.assertTrue(lib.nested and not lib.in_folder and lib.lrc and lib.m3u)
        yt = m.resolve_plan(self.req(url="https://music.youtube.com/watch?v=CZBGAe5BkoM"))
        self.assertFalse(yt.is_list)
        self.assertEqual(yt.source, "youtube")
        with self.assertRaises(m.HTTPException):
            m.resolve_plan(self.req(naming="../../etc"))
        with self.assertRaises(m.HTTPException):
            m.resolve_plan(self.req(url="https://music.amazon.com/playlists/x"))

    def test_single_song_cards_are_named_after_the_song(self):
        m = self.m

        async def go():
            plan = m.resolve_plan(m.JobRequest(url="https://music.youtube.com/watch?v=CZBGAe5BkoM", destination="local"))
            job = m.Job(plan)
            await job.handle_line('Downloaded "FOVOS - Lollipop": https://music.youtube.com/watch?v=CZBGAe5BkoM')
            self.assertEqual(job.name, "FOVOS - Lollipop")
            lst = m.Job(m.resolve_plan(m.JobRequest(url="https://open.spotify.com/playlist/abc", destination="local")))
            await lst.handle_line("A - B: Skipped")
            self.assertEqual(lst.name, "")  # playlists keep waiting for their own name

        asyncio.run(go())

    def test_m3u_entries_become_relative(self):
        m = self.m

        async def go():
            root = Path(tempfile.mkdtemp())
            folder = root / "Fake List"
            folder.mkdir()
            (folder / "Fake List.m3u8").write_text(f"#EXTM3U\n{folder}/A - One.mp3\n{folder}/B - Two.mp3\n")
            job = m.Job(m.resolve_plan(self.req(m3u=True)))
            job.folder = "Fake List"
            job.relativise_m3u(root)
            lines = (folder / "Fake List.m3u8").read_text().splitlines()
            self.assertEqual(lines, ["#EXTM3U", "A - One.mp3", "B - Two.mp3"])

        asyncio.run(go())

    def test_sidecars_are_uploaded_and_never_overwrite(self):
        from mock_cloud import MockProvider
        from sync import CloudSyncer

        tmp = Path(tempfile.mkdtemp())
        store = Store(tmp / "c.json")
        prov = MockProvider(store, "dropbox", "Dropbox", tmp / "remote")
        local = tmp / "local"
        local.mkdir()
        (local / "A.mp3").write_text("a")
        (local / "A.lrc").write_text("[00:01.00]hi")
        (local / "List.m3u8").write_text("#EXTM3U\nA.mp3\n")
        (local / "notes.txt").write_text("ignore me")
        CloudSyncer(prov, prov.root(), local, lambda *e: None, stable_seconds=0, prefix="List").sweep(final=True)
        got = sorted(p.name for p in (tmp / "remote" / "dropbox" / "List").iterdir())
        self.assertEqual(got, ["A.lrc", "A.mp3", "List.m3u8"])


if __name__ == "__main__":
    unittest.main()


class PortSetting(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["PLAYLIST_SAVER_HOME"] = tempfile.mkdtemp()
        os.environ["PLAYLIST_SAVER_MOCK_CLOUD"] = tempfile.mkdtemp()
        os.environ.pop("PLAYLIST_SAVER_MANAGED", None)
        import config as config_mod

        importlib.reload(config_mod)
        import main as main_mod

        cls.m = importlib.reload(main_mod)

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("PLAYLIST_SAVER_MOCK_CLOUD", None)
        os.environ.pop("PLAYLIST_SAVER_HOME", None)

    def put(self, **kw):
        return asyncio.run(self.m.put_settings(self.m.SettingsPatch(**kw)))

    def test_default_and_saving_a_free_port(self):
        import socket

        self.assertEqual(self.put()["port"]["configured"], 8000)
        with socket.socket() as sk:
            sk.bind(("127.0.0.1", 0))
            free = sk.getsockname()[1]
        out = self.put(port=free)
        self.assertEqual((out["port"]["configured"], out["port"]["restart_needed"]), (free, True))
        self.assertEqual(out["settings"]["port"], free)
        self.assertIn(f":{free}/api/oauth/callback", out["port"]["redirect_uri"])
        self.assertFalse(out["port"]["can_restart"])

    def test_rejects_bad_and_busy_ports(self):
        import socket

        for bad in (0, 80, 1023, 65536, -5):
            with self.assertRaises(self.m.HTTPException, msg=bad):
                self.put(port=bad)
        for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
            try:
                srv = socket.socket(family)
                srv.bind((host, 0))
            except OSError:
                continue
            srv.listen()
            try:
                with self.assertRaises(self.m.HTTPException) as ctx:
                    self.put(port=srv.getsockname()[1])
                self.assertIn("already in use", ctx.exception.detail)
            finally:
                srv.close()

    def test_restart_refused_when_not_managed_or_busy(self):
        with self.assertRaises(self.m.HTTPException) as ctx:
            asyncio.run(self.m.restart_api())
        self.assertEqual(ctx.exception.status_code, 400)



class UpgradeCommand(unittest.TestCase):
    def test_upgrades_the_python_the_server_runs_on(self):
        import shlex
        import sys

        import versions

        parts = shlex.split(versions.upgrade_command())
        self.assertEqual(parts[0], sys.executable)
        self.assertEqual(parts[1:], ["-m", "pip", "install", "--upgrade", "spotdl", "yt-dlp"])


FAKE_FAILING_SPOTDL = textwrap.dedent(
    """
    import json, sys
    a = sys.argv[1:]
    if a and a[0] == "save":
        urls = [x for x in a[1:] if x.startswith("http")]
        out = a[a.index("--save-file") + 1]
        json.dump([{"name": "Midnight Train", "artists": ["Nora Vale"], "url": u} for u in urls], open(out, "w"))
        sys.exit(0)
    print("Found 2 songs in Fake List (Playlist)", flush=True)
    print("A - One: Downloaded", flush=True)
    print("AudioProviderError: YT-DLP download error - https://music.youtube.com/watch?v=x", flush=True)
    print("2/2 complete", flush=True)
    print("https://open.spotify.com/track/AAA111 - AudioProviderError: YT-DLP download error - https://music.youtube.com/watch?v=x", flush=True)
    """
)

FAKE_RETRY_SPOTDL = textwrap.dedent(
    """
    import os, sys
    a = sys.argv[1:]
    out = a[a.index("--output") + 1]
    path = out.replace("{artists}", "Nora Vale").replace("{title}", "Midnight Train").replace("{output-ext}", "mp3")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(b"x")
    print('Downloaded "Nora Vale - Midnight Train": https://music.youtube.com/watch?v=x', flush=True)
    """
)


FAKE_STILL_FAILING_SPOTDL = textwrap.dedent(
    """
    print("AudioProviderError: YT-DLP download error - https://music.youtube.com/watch?v=x", flush=True)
    print("https://open.spotify.com/track/AAA111 - AudioProviderError: YT-DLP download error - https://music.youtube.com/watch?v=x", flush=True)
    """
)


class FailedTracks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["PLAYLIST_SAVER_HOME"] = tempfile.mkdtemp()
        os.environ["PLAYLIST_SAVER_MOCK_CLOUD"] = tempfile.mkdtemp()
        import config as config_mod

        importlib.reload(config_mod)
        import main as main_mod

        cls.m = importlib.reload(main_mod)
        d = Path(tempfile.mkdtemp())
        cls.failing, cls.retry, cls.still = d / "failing.py", d / "retry.py", d / "still.py"
        cls.still.write_text(FAKE_STILL_FAILING_SPOTDL)
        cls.failing.write_text(FAKE_FAILING_SPOTDL)
        cls.retry.write_text(FAKE_RETRY_SPOTDL)

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("PLAYLIST_SAVER_MOCK_CLOUD", None)
        os.environ.pop("PLAYLIST_SAVER_HOME", None)

    def setUp(self):
        self.m.jobs.clear()
        self.m.slots = self.m.Slots()
        self.out = tempfile.mkdtemp()

    async def wait_until(self, cond, timeout=15):
        for _ in range(int(timeout / 0.05)):
            if cond():
                return
            await asyncio.sleep(0.05)
        self.fail("timed out")

    def plan(self, **kw):
        return self.m.resolve_plan(
            self.m.JobRequest(url="https://open.spotify.com/playlist/abc", output_dir=self.out, destination="local", **kw)
        )

    def test_a_failed_track_gets_its_link_and_its_name(self):
        m = self.m
        m.SPOTDL = [sys.executable, str(self.failing)]

        async def go():
            job = m.Job(self.plan())
            m.jobs[job.id] = job
            asyncio.create_task(job.run())
            await self.wait_until(lambda: job.status in ("done", "failed"))
            failed = [t for t in job.tracks if t["state"] == "failed"]
            self.assertEqual(len(failed), 1)  # the end-of-run list must not count it a second time
            self.assertEqual(failed[0]["url"], "https://open.spotify.com/track/AAA111")
            self.assertEqual(failed[0]["title"], "Nora Vale - Midnight Train")

        asyncio.run(go())

    def test_no_results_message_already_names_the_song(self):
        m = self.m

        async def go():
            job = m.Job(self.plan())
            await job.handle_line("LookupError: No results found for song: Kei Arai - Slow Summer")
            self.assertEqual(job.tracks[0]["title"], "Kei Arai - Slow Summer")

        asyncio.run(go())

    def test_retry_saves_one_track_into_the_playlists_folder(self):
        m = self.m
        m.SPOTDL = [sys.executable, str(self.failing)]

        async def go():
            job = m.Job(self.plan())
            m.jobs[job.id] = job
            asyncio.create_task(job.run())
            await self.wait_until(lambda: job.status in ("done", "failed"))
            m.SPOTDL = [sys.executable, str(self.retry)]
            track = next(t for t in job.tracks if t["state"] == "failed")
            snap = await m.retry_track(job.id, m.RetryRequest(url=track["url"]))
            self.assertEqual(track["retry"], "running")
            await self.wait_until(lambda: track["state"] == "done")
            self.assertNotIn("retry", track)
            self.assertTrue((Path(self.out) / "Fake List" / "Nora Vale - Midnight Train.mp3").exists())
            self.assertFalse(m.jobs[snap["id"]].plan.is_list)

        asyncio.run(go())

    def test_retry_refuses_unknown_tracks_and_unfinished_jobs(self):
        m = self.m

        async def go():
            job = m.Job(self.plan())
            m.jobs[job.id] = job
            with self.assertRaises(m.HTTPException) as busy:  # still queued
                await m.retry_track(job.id, m.RetryRequest(url="https://open.spotify.com/track/ZZZ"))
            self.assertEqual(busy.exception.status_code, 409)
            job.status = "done"
            with self.assertRaises(m.HTTPException) as missing:
                await m.retry_track(job.id, m.RetryRequest(url="https://open.spotify.com/track/ZZZ"))
            self.assertEqual(missing.exception.status_code, 404)

        asyncio.run(go())

    def test_a_failing_retry_stays_retryable(self):
        m = self.m
        m.SPOTDL = [sys.executable, str(self.failing)]

        async def go():
            job = m.Job(self.plan())
            m.jobs[job.id] = job
            asyncio.create_task(job.run())
            await self.wait_until(lambda: job.status in ("done", "failed"))
            track = next(t for t in job.tracks if t["state"] == "failed")
            m.SPOTDL = [sys.executable, str(self.still)]
            await m.retry_track(job.id, m.RetryRequest(url=track["url"]))  # the stand-in fails again
            await self.wait_until(lambda: track.get("retry") == "failed")
            self.assertEqual(track["state"], "failed")
            await m.retry_track(job.id, m.RetryRequest(url=track["url"]))  # and can be tried once more
            await self.wait_until(lambda: track.get("retry") == "failed")

        asyncio.run(go())


class JobTimingAndRemoval(FailedTracks):
    """Reuses the stand-in spotdl helpers of FailedTracks."""

    def test_snapshots_carry_start_finish_and_last_activity(self):
        m = self.m
        m.SPOTDL = [sys.executable, str(self.failing)]

        async def go():
            job = m.Job(self.plan())
            self.assertIsNone(job.snapshot()["started_at"])  # still queued
            m.jobs[job.id] = job
            asyncio.create_task(job.run())
            await self.wait_until(lambda: job.status in ("done", "failed"))
            snap = job.snapshot()
            self.assertIsNotNone(snap["started_at"])
            self.assertGreaterEqual(snap["finished_at"], snap["started_at"])
            self.assertGreaterEqual(snap["last_activity"], snap["started_at"])

        asyncio.run(go())

    def test_a_finished_job_can_be_removed_but_a_running_one_cannot(self):
        m = self.m

        async def go():
            job = m.Job(self.plan())
            m.jobs[job.id] = job
            with self.assertRaises(m.HTTPException) as busy:  # queued counts as in progress
                await m.remove_job(job.id)
            self.assertEqual(busy.exception.status_code, 409)
            job.status = "done"
            self.assertEqual(await m.remove_job(job.id), {"removed": job.id})
            self.assertNotIn(job.id, m.jobs)
            with self.assertRaises(m.HTTPException) as gone:
                await m.remove_job(job.id)
            self.assertEqual(gone.exception.status_code, 404)

        asyncio.run(go())

    def test_a_job_with_a_retry_in_flight_cannot_be_removed(self):
        m = self.m

        async def go():
            job = m.Job(self.plan())
            job.status = "done"
            job.tracks.append({"title": "x", "state": "failed", "detail": "", "url": "u", "retry": "running"})
            m.jobs[job.id] = job
            with self.assertRaises(m.HTTPException):
                await m.remove_job(job.id)

        asyncio.run(go())
