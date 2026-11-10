import { useEffect, useState } from "react";
import {
  cleanLink,
  isTrackLink,
  putSettings,
  type CloudKey,
  type Dest,
  type Destination,
  type Interval,
  type Naming,
  type JobRequest,
  type ProviderStatus,
  type Settings,
  type SettingsPayload,
} from "../api";
import { Icon, LABELS } from "../icons";
import { BITRATES, FORMATS, Segmented, Switch, tilde, useToast } from "../ui";
import { DestinationTiles } from "./DestinationTiles";
import { FolderPicker } from "./FolderPicker";

interface Props {
  settings: Settings;
  providers: ProviderStatus[];
  online: boolean;
  onSubmit: (req: JobRequest) => Promise<void>;
  onPayload: (p: SettingsPayload) => void;
  onOpenSettings: (tab: "connections" | "defaults", focus?: CloudKey) => void;
}

const sameDest = (a?: Dest, b?: Dest) => !!a && !!b && a.id === b.id && a.path === b.path;

export function Composer({ settings, providers, online, onSubmit, onPayload, onOpenSettings }: Props) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState<Destination>(settings.destination);
  const [keepLocal, setKeepLocal] = useState(settings.keep_local);
  const [localDir, setLocalDir] = useState(settings.local_dir);
  const [cloudDest, setCloudDest] = useState(settings.cloud_dest);
  const [format, setFormat] = useState(settings.format);
  const [bitrate, setBitrate] = useState(settings.bitrate);
  const [subfolder, setSubfolder] = useState(settings.subfolder);
  const [naming, setNaming] = useState<Naming>(settings.naming);
  const [lrc, setLrc] = useState(settings.lrc);
  const [m3u, setM3u] = useState(settings.m3u);
  const [autoSync, setAutoSync] = useState<Interval>("off");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);

  // Saved defaults are the starting point; edits here only affect the next download
  useEffect(() => {
    setDestination(settings.destination);
    setKeepLocal(settings.keep_local);
    setLocalDir(settings.local_dir);
    setCloudDest(settings.cloud_dest);
    setFormat(settings.format);
    setBitrate(settings.bitrate);
    setSubfolder(settings.subfolder);
    setNaming(settings.naming);
    setLrc(settings.lrc);
    setM3u(settings.m3u);
  }, [settings]);

  const cloud = destination !== "local" ? providers.find((p) => p.key === destination) : undefined;
  const dest = destination !== "local" ? cloudDest[destination] : undefined;

  // If the chosen service got disconnected, fall back to this Mac
  useEffect(() => {
    if (destination !== "local" && !providers.find((p) => p.key === destination)?.connected) setDestination("local");
  }, [providers, destination]);

  const isDefault =
    destination === settings.destination &&
    keepLocal === settings.keep_local &&
    localDir === settings.local_dir &&
    naming === settings.naming &&
    lrc === settings.lrc &&
    m3u === settings.m3u &&
    (destination === "local" || sameDest(dest, settings.cloud_dest[destination]));

  async function makeDefault() {
    try {
      const patch: Partial<Settings> = { destination, keep_local: keepLocal, local_dir: localDir, naming, lrc, m3u };
      if (destination !== "local" && dest) patch.cloud_dest = { ...settings.cloud_dest, [destination]: dest };
      onPayload(await putSettings(patch));
      toast(`${LABELS[destination]} is now your default destination`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the default", "error");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSubmit({
        url: cleanLink(url),
        format,
        bitrate,
        output_dir: localDir,
        threads: 4,
        subfolder,
        destination,
        keep_local: keepLocal,
        cloud_dest: destination !== "local" ? dest : undefined,
        naming,
        lrc,
        m3u,
        auto_sync: isTrackLink(url) ? "off" : autoSync,
      });
      setUrl("");
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Can't reach the API server. It should restart on its own; try again in a few seconds."
          : err instanceof Error
            ? err.message
            : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    try {
      setUrl(cleanLink(await navigator.clipboard.readText()));
    } catch {
      /* clipboard blocked: the user can paste manually */
    }
  }

  const where =
    destination === "local"
      ? tilde(localDir)
      : `${cloud?.label}${dest && dest.path !== "/" ? ` · ${dest.path.replace(/^\//, "")}` : ""}`;
  const nested = naming === "artist_album";
  const summary = `${where}${nested ? " › Artist › Album" : subfolder ? " › Playlist name" : ""}${destination !== "local" && keepLocal ? " + a copy on this Mac" : ""}`;

  return (
    <>
    <form className="composer" onSubmit={submit}>
      <section className="step">
        <h3>
          <span className="num">1</span> Link
        </h3>
        <div className="url-field">
          <span className="lead">
            <Icon name="link" />
          </span>
          <input
            placeholder="Paste a Spotify or YouTube Music link"
            value={url}
            onChange={(e) => setUrl(cleanLink(e.target.value))}
            spellCheck={false}
            autoFocus
            aria-label="Playlist, album or track link"
          />
          <button type="button" className="btn ghost small" onClick={paste}>
            <Icon name="paste" /> Paste
          </button>
        </div>
      </section>

      <section className="step">
        <div className="step-head">
          <h3>
            <span className="num">2</span> Save to
          </h3>
          <button
            type="button"
            className={`default-btn ${isDefault ? "is" : ""}`}
            onClick={makeDefault}
            disabled={isDefault}
            title={isDefault ? "This is your default destination" : "Use this destination every time the app starts"}
          >
            <Icon name={isDefault ? "star-fill" : "star"} /> {isDefault ? "Default" : "Make default"}
          </button>
        </div>
        <DestinationTiles
          providers={providers}
          value={destination}
          localDir={localDir}
          onChange={setDestination}
          onConnect={(key) => onOpenSettings("connections", key)}
        />

        {destination === "local" ? (
          <label className="field">
            <span className="field-label">Folder on this Mac</span>
            <span className="field-box">
              <Icon name="folder" />
              <input value={localDir} onChange={(e) => setLocalDir(e.target.value)} spellCheck={false} />
            </span>
          </label>
        ) : (
          <>
            <div className="field">
              <span className="field-label">{cloud?.label} folder</span>
              <button type="button" className="field-box button" onClick={() => setPicker(true)}>
                <Icon name="folder" />
                <span className="grow">{dest?.path ?? "/"}</span>
                <span className="change">Change</span>
              </button>
            </div>
            <Switch
              checked={keepLocal}
              onChange={setKeepLocal}
              label="Also keep a copy on this Mac"
              hint={
                keepLocal
                  ? `Saved in ${tilde(localDir)} and copied to ${cloud?.label}`
                  : `Sent straight to ${cloud?.label}, nothing stored on this Mac`
              }
            />
          </>
        )}
        <div className="field">
          <span className="field-label">Organise files</span>
          <Segmented
            label="Organise files"
            options={[
              { id: "flat" as Naming, label: "Playlist folder", hint: "Playlist name / Artist - Title" },
              { id: "artist_album" as Naming, label: "Artist / Album", hint: "Artist / Album / 01 - Title" },
            ]}
            value={naming}
            onChange={setNaming}
          />
        </div>
        {!nested && (
          <Switch
            checked={subfolder}
            onChange={setSubfolder}
            label="Put each playlist in its own folder"
            hint="Named after the playlist or album"
          />
        )}
      </section>

      <section className="step">
        <h3>
          <span className="num">3</span> Format &amp; quality
        </h3>
        <div className="row">
          <Segmented label="Format" options={FORMATS} value={format} onChange={setFormat} />
          <select value={bitrate} onChange={(e) => setBitrate(e.target.value)} aria-label="Quality">
            {BITRATES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <Switch
          checked={lrc}
          onChange={setLrc}
          label="Save synced lyrics"
          hint="Adds a .lrc file next to each song when lyrics are found"
        />
        <Switch
          checked={m3u}
          onChange={setM3u}
          label="Write a playlist file (.m3u8)"
          hint="Keeps the original track order in players like VLC or iTunes"
        />
        <p className="fineprint">
          Audio comes from YouTube Music, so real quality tops out around 128–256 kbps. Higher settings re-encode the
          same source.
        </p>
      </section>

      {url && !isTrackLink(url) && (
        <section className="step">
          <div className="field">
            <span className="field-label">Keep in sync</span>
            <Segmented
              label="Keep in sync"
              options={[
                { id: "off" as Interval, label: "Off" },
                { id: "daily" as Interval, label: "Daily" },
                { id: "weekly" as Interval, label: "Weekly" },
              ]}
              value={autoSync}
              onChange={setAutoSync}
            />
            <p className="fineprint">
              {autoSync === "off"
                ? "Download once. You can turn on automatic re-checks later in Settings."
                : "Checks again while the app is running and only adds new tracks."}
            </p>
          </div>
        </section>
      )}

      {error && (
        <p className="error">
          <Icon name="alert" /> {error}
        </p>
      )}

      <button type="submit" className="cta" disabled={!url.trim() || busy || !online}>
        <Icon name="download" /> {busy ? "Starting…" : "Download"}
      </button>
      <p className="summary">
        <Icon name="arrow" /> {summary}
      </p>
    </form>
    {/* Outside the <form>: a dialog's own forms and buttons must never submit the composer */}
    {cloud && (
      <FolderPicker
        provider={cloud}
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(d) => {
          setCloudDest((c) => ({ ...c, [cloud.key]: d }));
          setPicker(false);
        }}
      />
    )}
    </>
  );
}
