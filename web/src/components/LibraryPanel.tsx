import { useState } from "react";
import { findDuplicates, type DuplicateReport } from "../api";
import { Icon } from "../icons";
import { bytes, tilde, useToast } from "../ui";

export function LibraryPanel({ folder }: { folder: string }) {
  const toast = useToast();
  const [report, setReport] = useState<DuplicateReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function scan() {
    setBusy(true);
    try {
      setReport(await findDuplicates());
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't scan the folder", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="defaults">
      <section>
        <h3>Find duplicate songs</h3>
        <p className="muted">
          Looks through <code>{tilde(folder)}</code> for the same song saved more than once, for example in two playlists. It only
          reports; nothing is deleted or moved.
        </p>
        <div>
          <button type="button" className="btn primary" onClick={scan} disabled={busy}>
            <Icon name="search" /> {busy ? "Scanning…" : report ? "Scan again" : "Scan my library"}
          </button>
        </div>
        {report && (
          <>
            <p className="muted">
              {report.scanned.toLocaleString()} songs checked.{" "}
              {report.group_count === 0 ? (
                <b>No duplicates found.</b>
              ) : (
                <b>
                  {report.group_count} song{report.group_count === 1 ? "" : "s"} stored more than once ({bytes(report.wasted)} could be freed).
                </b>
              )}
              {report.truncated && " Scan stopped early because the folder is very large."}
            </p>
            <ul className="dupes">
              {report.groups.map((g) => (
                <li key={g.files[0].path}>
                  <div className="dupe-head">
                    <strong>{g.title}</strong>
                    <span className="chip">{g.files.length} copies</span>
                  </div>
                  <ul>
                    {g.files.map((f) => (
                      <li key={f.path} title={f.path}>
                        <span className="dupe-path">{f.folder === "." ? "(top folder)" : f.folder}</span>
                        <span className="dupe-size">{bytes(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {report.group_count > report.groups.length && (
              <p className="fineprint">Showing the {report.groups.length} largest groups.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
