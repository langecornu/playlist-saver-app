import { useEffect, useRef, useState } from "react";
import {
  connectProvider,
  disconnectProvider,
  putSettings,
  saveCredentials,
  type CloudKey,
  type Dest,
  type Job,
  type Naming,
  type ProviderStatus,
  type Settings,
  type SettingsPayload,
} from "../api";
import { Brand, Icon, LABELS } from "../icons";
import { BITRATES, FORMATS, Modal, Segmented, Switch, useToast } from "../ui";
import { DestinationTiles } from "./DestinationTiles";
import { AdvancedPanel } from "./AdvancedPanel";
import { FolderPicker } from "./FolderPicker";
import { LibraryPanel } from "./LibraryPanel";
import { PlaylistsPanel } from "./PlaylistsPanel";

export type SettingsTab = "connections" | "defaults" | "playlists" | "library" | "advanced";
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "connections", label: "Connections" },
  { id: "defaults", label: "Defaults" },
  { id: "playlists", label: "Playlists" },
  { id: "library", label: "Library" },
  { id: "advanced", label: "Advanced" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  focus?: CloudKey;
  payload: SettingsPayload;
  onPayload: (p: SettingsPayload) => void;
  onJob: (job: Job) => void;
}

export function SettingsDialog({ open, onClose, tab, onTab, focus, payload, onPayload, onJob }: Props) {
  const { settings, providers } = payload;
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>(undefined);

  async function save(patch: Partial<Settings>): Promise<boolean> {
    try {
      onPayload(await putSettings(patch));
      setSaved(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save", "error");
      return false;
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Settings"
      subtitle="Connect your cloud storage, manage saved playlists and choose what happens by default."
      aside={
        <span className={`saved ${saved ? "show" : ""}`} aria-live="polite">
          <Icon name="check" /> Saved
        </span>
      }
    >
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button type="button" key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "playlists" ? (
        <PlaylistsPanel onJob={onJob} />
      ) : tab === "library" ? (
        <LibraryPanel folder={settings.local_dir} />
      ) : tab === "advanced" ? (
        <AdvancedPanel port={payload.port} providers={providers} saveSetting={save} />
      ) : tab === "connections" ? (
        <div className="provider-list">
          {payload.demo && (
            <div className="notice info">
              <Icon name="sparkle" />
              <span>Demo mode: Dropbox and Google Drive are simulated with a local folder. Nothing leaves this Mac.</span>
            </div>
          )}
          {providers.map((p) => (
            <ProviderCard
              key={p.key}
              p={p}
              autoOpen={focus === p.key}
              redirectUri={payload.redirect_uri}
              dest={settings.cloud_dest[p.key]}
              onPayload={onPayload}
              onDest={(d) => save({ cloud_dest: { ...settings.cloud_dest, [p.key]: d } })}
            />
          ))}
        </div>
      ) : (
        <DefaultsPanel settings={settings} providers={providers} save={save} onTab={onTab} />
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Defaults
function DefaultsPanel({
  settings,
  providers,
  save,
  onTab,
}: {
  settings: Settings;
  providers: ProviderStatus[];
  save: (p: Partial<Settings>) => void;
  onTab: (t: SettingsTab) => void;
}) {
  const [localDir, setLocalDir] = useState(settings.local_dir);
  useEffect(() => setLocalDir(settings.local_dir), [settings.local_dir]);
  const cloud = settings.destination !== "local" ? providers.find((p) => p.key === settings.destination) : undefined;

  return (
    <div className="defaults">
      <section>
        <h3>Default destination</h3>
        <p className="muted">Where new downloads go when the app starts. You can still change it per download.</p>
        <DestinationTiles
          providers={providers}
          value={settings.destination}
          localDir={settings.local_dir}
          onChange={(d) => save({ destination: d })}
          onConnect={() => onTab("connections")}
        />
        {cloud && (
          <Switch
            checked={settings.keep_local}
            onChange={(v) => save({ keep_local: v })}
            label="Also keep a copy on this Mac"
            hint={
              settings.keep_local
                ? `Files are saved here and copied to ${cloud.label}`
                : `Files go straight to ${cloud.label} and aren't stored on this Mac`
            }
          />
        )}
      </section>

      <section>
        <h3>Folder on this Mac</h3>
        <label className="field">
          <span className="field-box">
            <Icon name="folder" />
            <input
              value={localDir}
              onChange={(e) => setLocalDir(e.target.value)}
              onBlur={() => localDir !== settings.local_dir && save({ local_dir: localDir })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              spellCheck={false}
            />
          </span>
        </label>
        <Segmented
          label="Organise files"
          options={[
            { id: "flat" as Naming, label: "Playlist folder", hint: "Playlist name / Artist - Title" },
            { id: "artist_album" as Naming, label: "Artist / Album", hint: "Artist / Album / 01 - Title" },
          ]}
          value={settings.naming}
          onChange={(v) => save({ naming: v })}
        />
        {settings.naming === "flat" && (
          <Switch
            checked={settings.subfolder}
            onChange={(v) => save({ subfolder: v })}
            label="Put each playlist in its own folder"
            hint="Named after the playlist or album"
          />
        )}
      </section>

      <section>
        <h3>Format &amp; quality</h3>
        <div className="row">
          <Segmented label="Format" options={FORMATS} value={settings.format} onChange={(f) => save({ format: f })} />
          <select value={settings.bitrate} onChange={(e) => save({ bitrate: e.target.value })} aria-label="Quality">
            {BITRATES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section>
        <h3>Extras</h3>
        <Switch checked={settings.lrc} onChange={(v) => save({ lrc: v })} label="Save synced lyrics" hint="Adds a .lrc file next to each song when lyrics are found" />
        <Switch checked={settings.m3u} onChange={(v) => save({ m3u: v })} label="Write a playlist file (.m3u8)" hint="Keeps the original track order in players like VLC or iTunes" />
      </section>

      <section>
        <h3>Downloads at once</h3>
        <p className="muted">More than this wait in a queue, which keeps the music services from rate-limiting you.</p>
        <select value={settings.max_concurrent} onChange={(e) => save({ max_concurrent: Number(e.target.value) })} aria-label="Downloads at once">
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} at a time{n === 2 ? " (recommended)" : ""}
            </option>
          ))}
        </select>
      </section>

      <p className="fineprint">
        Defaults are stored on this computer and restored every time the app starts. Existing files are never
        overwritten, locally or in the cloud.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Provider card
const GUIDES: Record<CloudKey, { title: string; steps: (uri: string) => React.ReactNode[] }> = {
  dropbox: {
    title: "Register a Dropbox app (2 minutes)",
    steps: (uri) => [
      <>
        Open <code>dropbox.com/developers/apps</code> and choose <b>Create app</b> → <b>Scoped access</b> →{" "}
        <b>Full Dropbox</b> (or <b>App folder</b> to confine this app to one folder).
      </>,
      <>
        On the <b>Permissions</b> tab, enable <code>account_info.read</code>, <code>files.metadata.read</code>,{" "}
        <code>files.metadata.write</code>, <code>files.content.read</code>, <code>files.content.write</code>, then
        submit.
      </>,
      <>
        On the <b>Settings</b> tab, add this Redirect URI and press <b>Add</b>: <Copy text={uri} />
      </>,
      <>Copy the <b>App key</b> from the same tab and paste it below. No secret is needed.</>,
    ],
  },
  gdrive: {
    title: "Create Google OAuth credentials (5 minutes)",
    steps: (uri) => [
      <>
        In <code>console.cloud.google.com</code> create a project, then enable the <b>Google Drive API</b> under APIs
        &amp; Services.
      </>,
      <>
        Open <b>OAuth consent screen</b>, choose <b>External</b>, fill in the basics and add your own Google account
        under <b>Test users</b>.
      </>,
      <>
        Under <b>Credentials</b> choose <b>Create credentials</b> → <b>OAuth client ID</b> → application type{" "}
        <b>Desktop app</b>. (If you pick <b>Web application</b> instead, add this Redirect URI: <Copy text={uri} />)
      </>,
      <>Paste the <b>Client ID</b> and <b>Client secret</b> below.</>,
    ],
  },
};

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-chip"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    >
      <code>{text}</code>
      <Icon name={done ? "check" : "copy"} />
    </button>
  );
}

function ProviderCard({
  p,
  autoOpen,
  redirectUri,
  dest,
  onPayload,
  onDest,
}: {
  p: ProviderStatus;
  autoOpen: boolean;
  redirectUri: string;
  dest: Dest;
  onPayload: (x: SettingsPayload) => void;
  onDest: (d: Dest) => void;
}) {
  const toast = useToast();
  const ref = useRef<HTMLElement>(null);
  const [clientId, setClientId] = useState(p.client_id);
  const [secret, setSecret] = useState("");
  const [scope, setScope] = useState<"app" | "full">(p.scope === "full" ? "full" : "app");
  const [guide, setGuide] = useState(!p.client_id);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const guideInfo = GUIDES[p.key];

  useEffect(() => {
    if (autoOpen) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [autoOpen]);

  async function connect() {
    setBusy(true);
    try {
      await saveCredentials(p.key, {
        client_id: clientId,
        client_secret: p.key === "gdrive" && secret ? secret : undefined,
        scope: p.key === "gdrive" ? scope : undefined,
      });
      const { auth_url } = await connectProvider(p.key);
      window.location.href = auth_url; // the provider sends us back to /?connected=…
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start the connection", "error");
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    try {
      const { auth_url } = await connectProvider(p.key);
      window.location.href = auth_url;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't start the connection", "error");
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      onPayload(await disconnectProvider(p.key));
      toast(`${p.label} disconnected`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't disconnect", "error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <article ref={ref} className={`provider ${p.connected ? "connected" : ""} ${autoOpen ? "focus" : ""}`}>
      <header>
        <span className="tile-mark big">
          <Brand kind={p.key} size={26} />
        </span>
        <div className="provider-title">
          <h3>{LABELS[p.key]}</h3>
          <p>
            {p.connected
              ? p.account
                ? `${p.account.name || "Connected"}${p.account.email ? ` · ${p.account.email}` : ""}`
                : "Connected"
              : p.expired
                ? "Sign in again to keep using it"
                : "Store downloads straight in your account"}
          </p>
        </div>
        <span className={`badge ${p.connected ? "done" : p.expired ? "failed" : ""}`}>
          {p.connected ? "Connected" : p.expired ? "Session expired" : "Not connected"}
        </span>
      </header>

      {p.connected ? (
        <div className="provider-body">
          <div className="field">
            <span className="field-label">Default folder</span>
            <button type="button" className="field-box button" onClick={() => setPicker(true)}>
              <Icon name="folder" />
              <span className="grow">{dest.path}</span>
              <span className="change">Change</span>
            </button>
          </div>
          {confirming ? (
            <div className="confirm" role="alertdialog" aria-label={`Disconnect ${p.label}`}>
              <p>
                Disconnect {p.label}? Files already stored there stay where they are. You'll need to sign in again to
                send more.
              </p>
              <div className="confirm-actions">
                <button type="button" className="btn danger" onClick={disconnect} disabled={busy}>
                  {busy ? "Disconnecting…" : `Yes, disconnect ${p.label}`}
                </button>
                <button type="button" className="btn ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  Keep connected
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn ghost danger" onClick={() => setConfirming(true)}>
              Disconnect {p.label}
            </button>
          )}
          <FolderPicker
            provider={p}
            open={picker}
            onClose={() => setPicker(false)}
            onPick={(d) => {
              onDest(d);
              setPicker(false);
            }}
          />
        </div>
      ) : p.expired ? (
        <div className="provider-body">
          <div className="notice warn">
            <Icon name="alert" />
            <span>
              {p.label} no longer accepts the saved sign-in (it may have been revoked or expired). Your app credentials
              are still saved, so reconnecting takes one click.
            </span>
          </div>
          <div className="confirm-actions">
            <button type="button" className="btn primary" onClick={reconnect} disabled={busy}>
              <Icon name="refresh" /> {busy ? "Opening…" : `Reconnect ${p.label}`}
            </button>
            <button type="button" className="btn ghost danger" onClick={disconnect} disabled={busy}>
              Forget this connection
            </button>
          </div>
        </div>
      ) : (
        <div className="provider-body">
          <button type="button" className="disclosure" onClick={() => setGuide((g) => !g)} aria-expanded={guide}>
            <Icon name="chevron" /> {guideInfo.title}
          </button>
          {guide && (
            <ol className="guide">
              {guideInfo.steps(redirectUri).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          <div className="creds">
            <label className="field">
              <span className="field-label">{p.key === "dropbox" ? "App key" : "Client ID"}</span>
              <span className="field-box">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} autoComplete="off" />
              </span>
            </label>
            {p.key === "gdrive" && (
              <>
                <label className="field">
                  <span className="field-label">Client secret</span>
                  <span className="field-box">
                    <input
                      type="password"
                      value={secret}
                      placeholder={p.has_secret ? "•••••••• (saved)" : ""}
                      onChange={(e) => setSecret(e.target.value)}
                      autoComplete="off"
                    />
                  </span>
                </label>
                <div className="field">
                  <span className="field-label">Access</span>
                  <Segmented
                    label="Google Drive access"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { id: "app", label: "App files only", hint: "Safest: can only see folders this app creates" },
                      { id: "full", label: "Whole Drive", hint: "Lets you pick any existing folder" },
                    ]}
                  />
                </div>
              </>
            )}
          </div>
          <p className="fineprint lock">
            <Icon name="lock" /> Credentials and tokens stay in a private file on this computer
            (<code>~/.config/playlist-saver</code>) and are never sent anywhere except {p.label}.
          </p>
          <button type="button" className="btn primary" onClick={connect} disabled={busy || !clientId.trim()}>
            <Icon name="link" /> {busy ? "Opening…" : `Connect ${p.label}`}
          </button>
        </div>
      )}
    </article>
  );
}
