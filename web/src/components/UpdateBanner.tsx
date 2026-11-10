import { useEffect, useState } from "react";
import { getVersions, type ToolVersion, type Versions } from "../api";
import { Icon } from "../icons";
import { useToast } from "../ui";

const KEY = "playlist-saver.dismissed-updates";

function dismissedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Tells the user when spotDL or yt-dlp has a newer release, with the command and release-notes link. */
export function UpdateBanner({ online }: { online: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Versions | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(dismissedSet);

  useEffect(() => {
    if (!online) return;
    let alive = true;
    getVersions()
      .then((v) => alive && setData(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [online]);

  const stale = (data?.tools ?? []).filter((t) => t.update && !dismissed.has(`${t.key}@${t.latest}`));
  if (!data || stale.length === 0) return null;

  function dismiss() {
    const next = new Set(dismissed);
    stale.forEach((t: ToolVersion) => next.add(`${t.key}@${t.latest}`));
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* private mode: it will simply reappear next time */
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(data!.command);
      toast("Command copied. Paste it in Terminal, then restart the app.", "ok");
    } catch {
      toast("Select the command and copy it manually", "info");
    }
  }

  return (
    <div className="notice info banner version-banner" role="status">
      <Icon name="refresh" />
      <span>
        <b>Update available:</b>{" "}
        {stale.map((t, i) => (
          <span key={t.key}>
            {i > 0 && ", "}
            <a href={t.url} target="_blank" rel="noreferrer noopener">
              {t.label} {t.latest}
            </a>{" "}
            (you have {t.installed ?? "unknown"})
          </span>
        ))}
        . Outdated versions are the usual cause of tracks failing to download. To update, run <code>{data.command}</code> in
        Terminal and restart the app.
      </span>
      <button type="button" className="btn ghost small" onClick={copy}>
        <Icon name="copy" /> Copy command
      </button>
      <button type="button" className="btn ghost small" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
