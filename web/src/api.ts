export type TrackState = "done" | "skipped" | "failed";
export interface Track {
  title: string;
  state: TrackState;
  detail: string;
  /** Link of a failed track, which is what makes a single-track retry possible */
  url?: string;
  /** Set while (running) or after (failed) a one-track retry */
  retry?: "running" | "failed";
}
export type UploadState = "uploaded" | "exists" | "failed";
export interface Upload {
  name: string;
  state: UploadState;
  detail: string;
}
export type JobStatus = "queued" | "starting" | "running" | "uploading" | "done" | "failed" | "cancelled";
export type Destination = "local" | "dropbox" | "gdrive";
export type CloudKey = Exclude<Destination, "local">;

export interface Dest {
  id: string;
  path: string;
}

export interface Job {
  id: string;
  url: string;
  status: JobStatus;
  name: string;
  folder: string;
  total: number;
  completed: number;
  tracks: Track[];
  log: string[];
  output_dir: string;
  local_path: string;
  destination: Destination;
  destination_label: string;
  keep_local: boolean;
  cloud_path: string;
  cloud_state: "waiting" | "syncing" | "done" | "partial" | null;
  uploads: Upload[];
  upload_counts: Record<UploadState, number>;
  warnings: string[];
  seeded: number;
  queue_position: number;
  trigger: "manual" | "auto";
  source: "spotify" | "youtube";
  naming: Naming;
  lrc: boolean;
  m3u: boolean;
}

export type Naming = "flat" | "artist_album";
export type Interval = "off" | "daily" | "weekly";

export interface JobRequest {
  url: string;
  format: string;
  bitrate: string;
  output_dir: string;
  threads: number;
  subfolder: boolean;
  destination: Destination;
  keep_local: boolean;
  cloud_dest?: Dest;
  naming: Naming;
  lrc: boolean;
  m3u: boolean;
  auto_sync: Interval;
}

export interface Settings {
  local_dir: string;
  subfolder: boolean;
  format: string;
  bitrate: string;
  destination: Destination;
  keep_local: boolean;
  cloud_dest: Record<CloudKey, Dest>;
  naming: Naming;
  lrc: boolean;
  m3u: boolean;
  max_concurrent: number;
  port: number;
}

export interface Account {
  name: string;
  email: string;
}

export interface ProviderStatus {
  key: CloudKey;
  label: string;
  configured: boolean;
  connected: boolean;
  /** Was connected before, but the service no longer accepts the saved sign-in */
  expired: boolean;
  account: Account | null;
  client_id: string;
  has_secret: boolean;
  scope: string;
  demo?: boolean;
}

export interface PortInfo {
  configured: number;
  running: number;
  restart_needed: boolean;
  can_restart: boolean;
  redirect_uri: string;
}

export interface SettingsPayload {
  port: PortInfo;
  settings: Settings;
  providers: ProviderStatus[];
  redirect_uri: string;
  demo: boolean;
}

export interface Folder extends Dest {
  name: string;
}

export interface Defaults {
  output_dir: string;
  spotdl: string;
  spotdl_found: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* not JSON: keep the generic message */
    }
    throw new Error(detail);
  }
  return res.json();
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const getDefaults = () => call<Defaults>("/api/defaults");

/** Asks the Vite dev server to (re)start the API process. */
export async function startApi(): Promise<void> {
  await fetch("/__api/start", { method: "POST" });
}

const YT_HOSTS = ["music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"];

/** Reduces a Spotify or YouTube Music link to its canonical form, dropping ?si=… and other tracking params. */
export function cleanLink(raw: string): string {
  const text = raw.trim();
  const m = text.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)/);
  if (m) return `https://open.spotify.com/${m[1]}/${m[2]}`;
  try {
    const u = new URL(text);
    if (YT_HOSTS.includes(u.hostname)) {
      const list = u.searchParams.get("list") ?? "";
      const v = u.hostname === "youtu.be" ? u.pathname.slice(1) : (u.searchParams.get("v") ?? "");
      if (u.pathname === "/playlist" && list) return `https://music.youtube.com/playlist?list=${list}`;
      if (v) {
        const mix = /^(RD|UL)/.test(list);
        return list && !mix && u.pathname === "/watch"
          ? `https://music.youtube.com/playlist?list=${list}`
          : `https://music.youtube.com/watch?v=${v}`;
      }
    }
  } catch {
    /* not a URL yet: leave what the user typed */
  }
  return raw;
}

/** True for a single song (no playlist to keep in sync). */
export const isTrackLink = (url: string) => /open\.spotify\.com\/track\/|music\.youtube\.com\/watch\?v=/.test(url);

export const listJobs = () => call<Job[]>("/api/jobs");
export const createJob = (req: JobRequest) => call<Job>("/api/jobs", json("POST", req));
export const retryTrack = (id: string, url: string) =>
  call<Job>(`/api/jobs/${id}/retry`, json("POST", { url }));
export const cancelJob = (id: string) => call<Job>(`/api/jobs/${id}/cancel`, { method: "POST" });
export const copyJob = (id: string, provider: CloudKey, cloud_dest?: Dest) =>
  call<Job>(`/api/jobs/${id}/copy`, json("POST", { provider, cloud_dest }));

export const getSettings = () => call<SettingsPayload>("/api/settings");
export const putSettings = (patch: Partial<Settings>) => call<SettingsPayload>("/api/settings", json("PUT", patch));

export const saveCredentials = (key: CloudKey, body: { client_id: string; client_secret?: string; scope?: "app" | "full" }) =>
  call<SettingsPayload>(`/api/providers/${key}/credentials`, json("PUT", body));
export const connectProvider = (key: CloudKey) =>
  call<{ auth_url: string }>(`/api/providers/${key}/connect`, json("POST", { return_to: window.location.origin + "/" }));
export const disconnectProvider = (key: CloudKey) =>
  call<SettingsPayload>(`/api/providers/${key}/disconnect`, { method: "POST" });

export const listFolders = (key: CloudKey, at?: Dest) => {
  const q = at ? `?${new URLSearchParams({ id: at.id, path: at.path })}` : "";
  return call<{ current: Dest; folders: Folder[] }>(`/api/providers/${key}/folders${q}`);
};
export const createFolder = (key: CloudKey, parent: Dest, name: string) =>
  call<Folder>(`/api/providers/${key}/folders`, json("POST", { parent, name }));

export function watchJob(id: string, onUpdate: (j: Job) => void): () => void {
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.onmessage = (e) => {
    const job: Job = JSON.parse(e.data);
    onUpdate(job);
    const finished = ["done", "failed", "cancelled"].includes(job.status);
    const retrying = job.tracks.some((t) => t.retry === "running");
    if (finished && job.cloud_state !== "syncing" && !retrying) es.close();
  };
  es.onerror = () => es.close();
  return () => es.close();
}

// ------------------------------------------------------------------ versions, playlists, history, library
export interface ToolVersion {
  key: string;
  label: string;
  installed: string | null;
  latest: string | null;
  update: boolean;
  url: string;
}
export interface Versions {
  tools: ToolVersion[];
  command: string;
}
export const getVersions = (refresh = false) => call<Versions>(`/api/versions${refresh ? "?refresh=true" : ""}`);

export interface SavedPlaylist {
  id: string;
  url: string;
  name: string;
  source: "spotify" | "youtube";
  interval: Interval;
  last_run: number;
  next_run: number | null;
  last_status?: JobStatus;
  last_finished?: number;
  last_added?: number;
  running: boolean;
  request: { destination?: Destination; output_dir?: string; cloud_dest?: Dest | null };
}
export const listPlaylists = () => call<SavedPlaylist[]>("/api/playlists");
export const setPlaylistInterval = (id: string, interval: Interval) =>
  call<SavedPlaylist>(`/api/playlists/${id}`, json("PATCH", { interval }));
export const deletePlaylist = (id: string) => call<{ ok: boolean }>(`/api/playlists/${id}`, { method: "DELETE" });
export const syncPlaylist = (id: string) => call<Job>(`/api/playlists/${id}/sync`, { method: "POST" });

export interface HistoryEntry {
  id: string;
  url: string;
  name: string;
  at: number;
  status: JobStatus;
  trigger: "manual" | "auto";
  source: string;
  destination: string;
  added: string[];
  added_count: number;
  skipped: number;
  failed: number;
  detail: string;
}
export const getHistory = (limit = 60) => call<HistoryEntry[]>(`/api/history?limit=${limit}`);

export interface DuplicateReport {
  root: string;
  scanned: number;
  truncated: boolean;
  group_count: number;
  wasted: number;
  groups: { title: string; wasted: number; files: { path: string; folder: string; name: string; size: number }[] }[];
}
export const findDuplicates = () => call<DuplicateReport>("/api/library/duplicates");

export const restartApi = () => call<{ restarting: boolean; port: number }>("/api/restart", { method: "POST" });
