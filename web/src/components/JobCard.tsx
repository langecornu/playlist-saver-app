import { useState } from "react";
import type { CloudKey, Job, ProviderStatus, Track } from "../api";
import { Brand, Icon, type IconName } from "../icons";
import { tilde } from "../ui";

interface Props {
  job: Job;
  providers: ProviderStatus[];
  onCancel: (job: Job) => void;
  onCopy: (job: Job, key: CloudKey) => void;
  onRetry: (job: Job, track: Track) => void;
}

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Downloading",
  uploading: "Uploading",
  done: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

function splitTitle(full: string): [string, string] {
  const i = full.indexOf(" - ");
  return i > 0 ? [full.slice(0, i), full.slice(i + 3)] : ["", full];
}

export function JobCard({ job, providers, onCancel, onCopy, onRetry }: Props) {
  const [tab, setTab] = useState<"tracks" | "cloud" | "log">("tracks");
  const toCloud = job.destination !== "local";
  const queued = job.status === "queued";
  const active = queued || job.status === "starting" || job.status === "running" || job.status === "uploading";
  const finished = !active;
  const syncing = job.cloud_state === "syncing";

  const saved = job.tracks.filter((t) => t.state === "done").length;
  const skipped = job.tracks.filter((t) => t.state === "skipped").length;
  const failedTracks = job.tracks.filter((t) => t.state === "failed").length;
  const dl = Math.max(job.completed, job.tracks.length);
  const dlPct = job.total ? Math.min(100, Math.round((dl / job.total) * 100)) : 0;

  const { uploaded, exists, failed: failedUploads } = job.upload_counts;
  const alreadyThere = exists + job.seeded;
  const upDone = uploaded + alreadyThere + failedUploads;
  const upPct = job.total ? Math.min(100, Math.round((upDone / job.total) * 100)) : 0;
  const overall = toCloud ? Math.round((dlPct + upPct) / 2) : dlPct;
  const failedAll = failedTracks + failedUploads;

  const connected = providers.filter((p) => p.connected);
  const canCopy = finished && !syncing && !!job.local_path && connected.length > 0;
  const retryable = job.cloud_state === "partial";

  const stats: { tone: string; icon: IconName; value: number; label: string }[] = toCloud
    ? [
        { tone: "good", icon: "download", value: saved, label: "Downloaded" },
        { tone: "info", icon: "upload", value: uploaded, label: "Uploaded" },
        { tone: "mute", icon: "skip", value: alreadyThere, label: `Already in ${job.destination_label}` },
        { tone: "bad", icon: "alert", value: failedAll, label: "Failed" },
      ]
    : [
        { tone: "good", icon: "check", value: saved, label: "Saved" },
        { tone: "mute", icon: "skip", value: skipped, label: "Already had" },
        { tone: "bad", icon: "alert", value: failedTracks, label: "Failed" },
        { tone: "info", icon: "bolt", value: active ? Math.max(0, job.total - dl) : 0, label: "Remaining" },
      ];

  const where = toCloud
    ? `${job.destination_label} · ${job.cloud_path === "/" ? "Root" : job.cloud_path}${job.folder ? ` › ${job.folder}` : ""}`
    : tilde(job.local_path || job.output_dir);

  return (
    <article className={`job ${job.status}`}>
      <div className="job-top">
        <div className="art">
          <Icon name="disc" />
        </div>
        <div className="job-title">
          <h2>{job.name || (queued ? "Waiting in the queue…" : "Looking up playlist…")}</h2>
          <p className="where">
            <Brand kind={job.destination} size={14} /> {where}
            {toCloud && job.keep_local && <span className="chip">+ copy on this Mac</span>}
            {job.trigger === "auto" && <span className="chip">Auto-sync</span>}
          </p>
        </div>
        <span className={`badge ${job.status}`}>
          {active && <i />} {STATUS_LABEL[job.status]}
          {queued && job.queue_position > 0 ? ` · #${job.queue_position}` : ""}
        </span>
        {(active || syncing) && (
          <button type="button" className="btn ghost small" onClick={() => onCancel(job)}>
            <Icon name="x" /> Cancel
          </button>
        )}
      </div>

      {queued && (
        <p className="note">
          <Icon name="sparkle" /> {job.queue_position <= 1 ? "Next in line." : `${job.queue_position - 1} waiting ahead of this one.`} Only a few
          downloads run at once so the music services don't rate-limit you. You can change this in Settings.
        </p>
      )}

      <div className="progress">
        <div className="progress-head">
          <strong>{job.total ? `${overall}%` : "—"}</strong>
          <span>{dl} of {job.total || "?"} tracks</span>
        </div>
        <Bar label="Download" pct={dlPct} active={job.status === "running" || job.status === "starting"} warn={failedTracks > 0} unknown={!job.total && active && !queued} />
        {toCloud && (
          <Bar
            label={`Send to ${job.destination_label}`}
            pct={upPct}
            active={syncing && job.status !== "done"}
            warn={failedUploads > 0}
            unknown={false}
          />
        )}
      </div>

      <div className="stats">
        {stats.map((s) => (
          <div key={s.label} className={`stat ${s.tone}`}>
            <span className="stat-ico">
              <Icon name={s.icon} />
            </span>
            <span className="stat-v">{s.value}</span>
            <span className="stat-l">{s.label}</span>
          </div>
        ))}
      </div>

      {job.seeded > 0 && (
        <p className="note">
          <Icon name="sparkle" /> {job.seeded} track{job.seeded !== 1 ? "s were" : " was"} already in {job.destination_label}, so
          they weren't downloaded again.
        </p>
      )}

      {job.warnings.map((w) => (
        <div key={w} className="notice warn">
          <Icon name="alert" /> <span>{w}</span>
        </div>
      ))}
      {failedTracks > 0 && finished && (
        <div className="notice warn">
          <Icon name="alert" />
          <span>
            Some tracks failed to download. Press <b>Retry</b> next to a track to try it again. If many keep failing,
            update spotDL (see the banner above) or run <code>spotdl --download-deno</code>, then download this link
            again. Saved tracks are skipped.
          </span>
        </div>
      )}

      <div className="tabs small" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "tracks"} className={tab === "tracks" ? "on" : ""} onClick={() => setTab("tracks")}>
          Tracks <span className="count">{job.tracks.length}</span>
        </button>
        {toCloud && (
          <button type="button" role="tab" aria-selected={tab === "cloud"} className={tab === "cloud" ? "on" : ""} onClick={() => setTab("cloud")}>
            {job.destination_label} <span className="count">{job.uploads.length}</span>
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "log"} className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>
          Log
        </button>
      </div>

      {tab === "tracks" && (
        <ul className="tracks">
          {job.tracks.length === 0 && <li className="empty">Tracks appear here as they're processed.</li>}
          {[...job.tracks].reverse().map((t, i) => {
            const [artist, title] = splitTitle(t.title);
            return (
              <li key={job.tracks.length - i} className={t.state}>
                <span className="idx">{String(job.tracks.length - i).padStart(2, "0")}</span>
                <span className="meta">
                  <span className="t">{title}</span>
                  {artist && <span className="a">{artist}</span>}
                  {t.state === "failed" && t.detail && <span className="a why" title={t.detail}>{t.detail}</span>}
                </span>
                <span className={`state ${t.state}`}>
                  {t.state === "done" ? "Downloaded" : t.state === "skipped" ? (toCloud && !job.keep_local ? `In ${job.destination_label}` : "Already saved") : "Failed"}
                </span>
                {t.state === "failed" &&
                  (t.url ? (
                    <button
                      type="button"
                      className="btn ghost small retry"
                      disabled={t.retry === "running" || active}
                      onClick={() => onRetry(job, t)}
                      aria-label={`Retry ${t.title}`}
                    >
                      <Icon name="refresh" /> {t.retry === "running" ? "Retrying…" : t.retry === "failed" ? "Retry again" : "Retry"}
                    </button>
                  ) : (
                    <span className="a" title="Retrying a single track becomes possible once the whole download has finished">
                      {active ? "Retry is available when the download finishes" : "Run the link again to retry"}
                    </span>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "cloud" && (
        <ul className="tracks">
          {job.uploads.length === 0 && <li className="empty">Files appear here as they're sent.</li>}
          {[...job.uploads].reverse().map((u, i) => (
            <li key={job.uploads.length - i} className={u.state}>
              <span className="idx">{String(job.uploads.length - i).padStart(2, "0")}</span>
              <span className="meta">
                <span className="t">{u.name.replace(/\.[^.]+$/, "")}</span>
                {u.detail && <span className="a bad">{u.detail}</span>}
              </span>
              <span className={`state ${u.state === "uploaded" ? "done" : u.state === "exists" ? "skipped" : "failed"}`}>
                {u.state === "uploaded" ? "Uploaded" : u.state === "exists" ? "Already there" : "Failed"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === "log" && <pre>{job.log.join("\n") || "No output yet."}</pre>}

      {(canCopy || retryable) && (
        <div className="job-actions">
          {retryable && toCloud && (
            <button type="button" className="btn primary small" onClick={() => onCopy(job, job.destination as CloudKey)}>
              <Icon name="refresh" /> Retry upload to {job.destination_label}
            </button>
          )}
          {canCopy &&
            connected
              .filter((p) => !(toCloud && p.key === job.destination))
              .map((p) => (
                <button type="button" key={p.key} className="btn ghost small" onClick={() => onCopy(job, p.key)}>
                  <Brand kind={p.key} size={14} /> Copy to {p.label}
                </button>
              ))}
          <span className="hint">Existing files are never overwritten.</span>
        </div>
      )}
    </article>
  );
}

function Bar({ label, pct, active, warn, unknown }: { label: string; pct: number; active: boolean; warn: boolean; unknown: boolean }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="track-bar" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`fill ${active ? "shimmer" : ""} ${warn ? "warn" : ""}`}
          style={{ width: `${unknown ? 6 : Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="bar-pct">{pct}%</span>
    </div>
  );
}
