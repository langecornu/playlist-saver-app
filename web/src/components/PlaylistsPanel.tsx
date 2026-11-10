import { useCallback, useEffect, useState } from "react";
import {
  deletePlaylist,
  getHistory,
  listPlaylists,
  setPlaylistInterval,
  syncPlaylist,
  type HistoryEntry,
  type Interval,
  type Job,
  type SavedPlaylist,
} from "../api";
import { Icon } from "../icons";
import { ago, until, useToast } from "../ui";

const SOURCE: Record<string, string> = { spotify: "Spotify", youtube: "YouTube Music" };

function shortUrl(url: string) {
  return url.replace(/^https:\/\/(open\.spotify\.com|music\.youtube\.com)\//, "");
}

export function PlaylistsPanel({ onJob }: { onJob: (job: Job) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<SavedPlaylist[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([listPlaylists(), getHistory()]);
      setItems(p);
      setHistory(h);
    } catch {
      /* the API may be restarting; the next poll will catch up */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function run<T>(fn: () => Promise<T>, fail: string): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : fail, "error");
    }
  }

  async function sync(p: SavedPlaylist) {
    const job = await run(() => syncPlaylist(p.id), "Couldn't start the sync");
    if (job) {
      onJob(job);
      toast("Sync started", "ok");
    }
    void refresh();
  }

  async function interval(p: SavedPlaylist, v: Interval) {
    await run(() => setPlaylistInterval(p.id, v), "Couldn't change the schedule");
    void refresh();
  }

  async function remove(p: SavedPlaylist) {
    await run(() => deletePlaylist(p.id), "Couldn't remove it");
    setConfirming(null);
    void refresh();
  }

  return (
    <div className="defaults">
      <section>
        <h3>Saved playlists</h3>
        <p className="muted">
          Playlists you turned “Keep in sync” on for. Each check only adds new tracks; anything already stored is skipped
          and never overwritten.
        </p>
        <div className="notice info">
          <Icon name="sparkle" />
          <span>Checks run while this app is open. If the computer was off, due playlists are checked when you start it.</span>
        </div>
        {items === null ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty-line">
            Nothing saved yet. Paste a playlist link and choose <b>Daily</b> or <b>Weekly</b> under “Keep in sync”.
          </p>
        ) : (
          <ul className="plist">
            {items.map((p) => (
              <li key={p.id}>
                <div className="plist-main">
                  <strong>{p.name || shortUrl(p.url)}</strong>
                  <span className="plist-sub">
                    {SOURCE[p.source] ?? p.source}
                    {p.last_finished
                      ? ` · last check ${ago(p.last_finished)}${p.last_status === "failed" || p.last_status === "cancelled" ? ` ${p.last_status}` : `: ${p.last_added ?? 0} new`}`
                      : " · not checked yet"}
                    {p.interval !== "off" && p.next_run ? ` · next ${until(p.next_run)}` : ""}
                  </span>
                </div>
                <select value={p.interval} onChange={(e) => interval(p, e.target.value as Interval)} aria-label={`Check schedule for ${p.name || p.url}`}>
                  <option value="off">Paused</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
                <button type="button" className="btn ghost small" disabled={p.running} onClick={() => sync(p)}>
                  <Icon name="refresh" /> {p.running ? "Syncing…" : "Sync now"}
                </button>
                {confirming === p.id ? (
                  <span className="plist-confirm">
                    <button type="button" className="btn danger small" onClick={() => remove(p)}>
                      Remove
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="icon-btn" aria-label={`Stop syncing ${p.name || p.url}`} title="Stop syncing" onClick={() => setConfirming(p.id)}>
                    <Icon name="x" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="fineprint">Removing a playlist only stops the checks. Your downloaded files are not touched.</p>
      </section>

      <section>
        <h3>History</h3>
        <p className="muted">What each download or check added, newest first.</p>
        {history === null ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="empty-line">No downloads yet.</p>
        ) : (
          <ul className="hist">
            {history.map((h) => (
              <li key={h.id + h.at} className={h.status}>
                <details>
                  <summary>
                    <i className={`dot ${h.status === "done" ? "ok" : h.status === "failed" ? "bad" : ""}`} />
                    <span className="hist-name">{h.name.startsWith("http") ? shortUrl(h.name) : h.name}</span>
                    <span className="hist-stat">
                      {h.status === "failed" && !h.added_count
                        ? "Failed"
                        : h.status === "cancelled"
                          ? `Cancelled · ${h.added_count} added`
                          : `${h.added_count} added${h.skipped ? ` · ${h.skipped} already had` : ""}${h.failed ? ` · ${h.failed} failed` : ""}`}
                    </span>
                    <span className="hist-when">
                      {h.trigger === "auto" && <span className="chip">Auto</span>} {ago(h.at)}
                    </span>
                  </summary>
                  <div className="hist-body">
                    <p className="fineprint">
                      {h.destination || "—"} · {SOURCE[h.source] ?? h.source}
                    </p>
                    {h.detail && h.status === "failed" && <p className="fineprint bad">{h.detail}</p>}
                    {h.added.length > 0 ? (
                      <ul>
                        {h.added.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                        {h.added_count > h.added.length && <li className="muted">…and {h.added_count - h.added.length} more</li>}
                      </ul>
                    ) : (
                      <p className="fineprint">Nothing new was added.</p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
