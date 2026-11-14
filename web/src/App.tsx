import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelJob,
  removeJob,
  retryTrack,
  type Track,
  copyJob,
  createJob,
  getDefaults,
  getSettings,
  listJobs,
  startApi,
  watchJob,
  type CloudKey,
  type Defaults,
  type Job,
  type JobRequest,
  type SettingsPayload,
} from "./api";
import { Composer } from "./components/Composer";
import { JobCard } from "./components/JobCard";
import { SettingsDialog, type SettingsTab } from "./components/SettingsDialog";
import { HelpDialog } from "./components/HelpDialog";
import { UpdateBanner } from "./components/UpdateBanner";
import { Brand, Icon, LABELS } from "./icons";
import { ToastProvider, useToast } from "./ui";

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [api, setApi] = useState<"checking" | "online" | "offline">("checking");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSection, setHelpSection] = useState<string | undefined>();
  const [tab, setTab] = useState<SettingsTab>("connections");
  const [focus, setFocus] = useState<CloudKey | undefined>();
  const watchers = useRef(new Map<string, () => void>());
  const loaded = useRef(false);

  const upsert = useCallback(
    (job: Job) => setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev])),
    [],
  );

  const watch = useCallback(
    (id: string) => {
      watchers.current.get(id)?.();
      watchers.current.set(
        id,
        watchJob(id, upsert, () => {
          // The live stream dropped (the helper restarted, say). Ask what became of the job instead of
          // leaving its card on "Downloading" for ever.
          listJobs()
            .then((now) => {
              const found = now.find((j) => j.id === id);
              if (found) {
                upsert(found);
                if (!["done", "failed", "cancelled"].includes(found.status)) setTimeout(() => watch(id), 2000);
              } else {
                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === id && !["done", "failed", "cancelled"].includes(j.status)
                      ? {
                          ...j,
                          status: "failed",
                          finished_at: Date.now() / 1000,
                          warnings: [...j.warnings, "This download was interrupted because the app restarted. Saved tracks are kept. Run the link again to continue where it stopped."],
                        }
                      : j,
                  ),
                );
              }
            })
            .catch(() => setTimeout(() => watch(id), 3000)); // the helper is still coming back
        }),
      );
    },
    [upsert],
  );

  const openSettings = useCallback((t: SettingsTab, f?: CloudKey) => {
    setTab(t);
    setFocus(f);
    setSettingsOpen(true);
  }, []);

  // Back from Dropbox / Google sign-in: ?connected=dropbox or ?connect_error=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ok = q.get("connected");
    const err = q.get("connect_error");
    if (!ok && !err) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (ok) toast(`${LABELS[ok as CloudKey] ?? "Account"} connected`, "ok");
    else {
      toast(err ?? "Connection failed", "error");
      openSettings("connections", (q.get("provider") as CloudKey) ?? undefined);
    }
  }, [toast, openSettings]);

  // Poll the API; if it's down, ask the dev server to start it, and reload state once it's back.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const d = await getDefaults().catch(() => null);
      if (!alive) return;
      if (d) {
        setApi("online");
        setDefaults(d);
        if (!loaded.current) {
          loaded.current = true;
          getSettings().then((p) => alive && setPayload(p));
          // Re-attach to jobs the server is still running (e.g. after a page refresh)
          listJobs().then((existing) => {
            if (!alive) return;
            setJobs([...existing].reverse());
            existing
              .filter((j) => !["done", "failed", "cancelled"].includes(j.status) || j.cloud_state === "syncing" || j.tracks.some((t) => t.retry === "running"))
              .forEach((j) => watch(j.id));
          });
        }
      } else {
        setApi("offline");
        loaded.current = false;
        // Idempotent on the dev server: no-op while a start is in progress, replaces a stuck one
        startApi().catch(() => {});
      }
    };
    tick();
    const timer = setInterval(tick, 3000);
    const w = watchers.current;
    return () => {
      alive = false;
      clearInterval(timer);
      w.forEach((stop) => stop());
    };
  }, [watch]);

  const track = useCallback(
    (job: Job) => {
      upsert(job);
      watch(job.id);
    },
    [upsert, watch],
  );

  async function submit(req: JobRequest) {
    const job = await createJob(req);
    upsert(job);
    watch(job.id);
  }

  async function dismiss(job: Job) {
    try {
      await removeJob(job.id);
    } catch (e) {
      // A card the server no longer knows (after a restart) can simply go; anything else stays and says why.
      if (!(e instanceof Error && /not found/i.test(e.message))) {
        toast(e instanceof Error ? e.message : "Couldn't remove this download", "error");
        return;
      }
    }
    watchers.current.get(job.id)?.();
    watchers.current.delete(job.id);
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
  }

  async function retry(job: Job, track: Track) {
    if (!track.url) return;
    try {
      const started = await retryTrack(job.id, track.url);
      upsert(started);
      watch(started.id);
      watch(job.id); // so the failed row flips to "Downloaded" when the retry finishes
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't retry this track", "error");
    }
  }

  async function copy(job: Job, key: CloudKey) {
    try {
      upsert(await copyJob(job.id, key));
      watch(job.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start the copy", "error");
    }
  }

  const finishedJobs = jobs.filter(
    (j) => ["done", "failed", "cancelled"].includes(j.status) && j.cloud_state !== "syncing" && !j.tracks.some((t) => t.retry === "running"),
  );
  const waiting = jobs.filter((j) => j.status === "queued").length;
  const active = jobs.filter((j) => ["starting", "running", "uploading"].includes(j.status) || (j.status !== "queued" && j.cloud_state === "syncing")).length;

  return (
    <>
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <div className="shell">
        <nav className="topbar">
          <div className="brand">
            <span className="logo">
              <Icon name="wave" />
            </span>
            <span className="brand-name">Playlist Saver</span>
          </div>
          <div className="topbar-right">
            {(active > 0 || waiting > 0) && (
              <span className="pill live">
                <i /> {active} running{waiting > 0 ? ` · ${waiting} queued` : ""}
              </span>
            )}
            {api === "offline" && <span className="pill bad">API offline</span>}
            {payload?.providers.map((p) => (
              <button type="button" key={p.key} className={`pill link ${p.connected ? "on" : ""}`} onClick={() => openSettings("connections", p.key)} title={p.connected ? `${p.label}: ${p.account?.email ?? "connected"}` : `Connect ${p.label}`}>
                <Brand kind={p.key} size={14} />
                <span className="pill-text">{p.label}</span>
                <i className={`dot ${p.connected ? "ok" : ""}`} />
              </button>
            ))}
            <button type="button" className="pill link help-link" onClick={() => { setHelpSection(undefined); setHelpOpen(true); }} title="Open the user manual">
              <Icon name="help" />
              <span className="pill-text">Help</span>
            </button>
            <button type="button" className="icon-btn" onClick={() => openSettings("defaults")} aria-label="Settings" title="Settings">
              <Icon name="gear" />
            </button>
          </div>
        </nav>

        <header className="hero">
          <p className="eyebrow">Spotify &amp; YouTube Music → your storage</p>
          <h1>
            Your playlists, <em>saved anywhere.</em>
          </h1>
          <p className="lede">Paste a playlist, album or song link. Every track is matched, downloaded and tagged with artwork, then stored on this Mac, in Dropbox or in Google Drive. Nothing already there is ever overwritten.</p>
        </header>

        {api === "offline" && (
          <div className="notice warn banner">
            <Icon name="alert" />
            <span>
              The API server isn't running. Trying to start it… If this doesn't clear in a few seconds, run <code>cd server && python3 -m uvicorn main:app --port 8000</code>.
            </span>
            <button type="button" className="btn ghost small" onClick={() => startApi().catch(() => {})}>
              Start server
            </button>
          </div>
        )}

        {api === "online" && defaults?.spotdl_found === false && (
          <div className="notice warn banner">
            <Icon name="alert" />
            <span>
              spotDL wasn't found at <code>{defaults.spotdl}</code>. Install it with <code>pip3 install spotdl</code> (see{" "}
              <a href="https://github.com/spotDL/spotify-downloader" target="_blank" rel="noreferrer noopener">
                the spotDL project
              </a>
              ).
            </span>
          </div>
        )}

        <UpdateBanner online={api === "online" && defaults?.spotdl_found !== false} />

        <main className="layout">
          <aside className="panel">
            {payload ? (
              <Composer
                settings={payload.settings}
                providers={payload.providers}
                online={api === "online"}
                onSubmit={submit}
                onPayload={setPayload}
                onOpenSettings={openSettings}
              />
            ) : (
              <div className="composer skeleton-block" aria-busy="true" />
            )}
          </aside>

          <section className="activity">
            <div className="activity-head">
              <h2>Activity</h2>
              {jobs.length > 0 && <span className="count">{jobs.length}</span>}
              {finishedJobs.length > 1 && (
                <button type="button" className="btn ghost small clear-finished" onClick={() => finishedJobs.forEach((j) => dismiss(j))}>
                  Clear finished
                </button>
              )}
            </div>
            {jobs.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="jobs">
                {jobs.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    providers={(payload?.providers ?? []).filter((p) => p.connected)}
                    onCancel={(job) => cancelJob(job.id).catch(() => {})}
                    onCopy={copy}
                    onRetry={retry}
                    onDismiss={dismiss}
                  />
                ))}
              </div>
            )}
          </section>
        </main>

        <footer className="legal">
          <p>
            <strong>Disclaimer.</strong> Playlist Saver is only a graphical interface. It does not host, store or
            download any content itself: it runs the open-source tools{" "}
            <a href="https://github.com/spotDL/spotify-downloader" target="_blank" rel="noreferrer noopener">
              spotDL
            </a>
            ,{" "}
            <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer noopener">
              yt-dlp
            </a>{" "}
            and{" "}
            <a href="https://ffmpeg.org" target="_blank" rel="noreferrer noopener">
              FFmpeg
            </a>
            , which you install and run on your own computer. Use it only for music you have the right to copy; you
            are responsible for following copyright law and the terms of the services involved.
          </p>
          <p>
            Not affiliated with or endorsed by Spotify, YouTube, Google, Amazon or Dropbox. All names are trademarks
            of their owners.
          </p>
        </footer>
      </div>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} section={helpSection} />

      {payload && (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          tab={tab}
          onTab={setTab}
          focus={focus}
          payload={payload}
          onPayload={setPayload}
          onJob={track}
        />
      )}
    </>
  );
}

function EmptyState() {
  const steps: { icon: "link" | "search" | "cloud"; title: string; text: string }[] = [
    { icon: "link", title: "Paste a link", text: "Playlists, albums or single songs from Spotify or YouTube Music." },
    { icon: "search", title: "We find the audio", text: "Each song is matched by title, artist and length, then tagged with cover art." },
    { icon: "cloud", title: "Stored where you choose", text: "On this Mac, in Dropbox or in Google Drive, skipping anything already there." },
  ];
  return (
    <div className="empty-state">
      <ol>
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="empty-ico">
              <Icon name={s.icon} />
            </span>
            <div>
              <h3>
                <span className="n">0{i + 1}</span> {s.title}
              </h3>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
