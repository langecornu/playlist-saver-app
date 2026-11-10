import { useCallback, useEffect, useState } from "react";
import { createFolder, listFolders, type Dest, type Folder, type ProviderStatus } from "../api";
import { Brand, Icon } from "../icons";
import { Modal } from "../ui";

interface Props {
  provider: ProviderStatus;
  open: boolean;
  onClose: () => void;
  onPick: (dest: Dest) => void;
}

const lastSegment = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** Browse a connected cloud account and choose (or create) the destination folder. */
export function FolderPicker({ provider, open, onClose, onPick }: Props) {
  const [stack, setStack] = useState<Dest[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const load = useCallback(
    async (at?: Dest): Promise<Dest | null> => {
      setLoading(true);
      setError("");
      try {
        const r = await listFolders(provider.key, at);
        setFolders(r.folders);
        return r.current;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load folders");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [provider.key],
  );

  useEffect(() => {
    if (!open) return;
    setStack([]);
    setAdding(false);
    setName("");
    load().then((cur) => cur && setStack([cur]));
  }, [open, load]);

  const current = stack[stack.length - 1];

  async function enter(f: Folder) {
    const cur = await load({ id: f.id, path: f.path });
    if (cur) setStack((s) => [...s, cur]);
  }

  async function jump(i: number) {
    if (i === stack.length - 1) return;
    const cur = await load(stack[i]);
    if (cur) setStack((s) => s.slice(0, i + 1));
  }

  async function create() {
    if (!current || !name.trim()) return;
    try {
      const f = await createFolder(provider.key, current, name.trim());
      setAdding(false);
      setName("");
      await enter(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the folder");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Choose a ${provider.label} folder`}
      subtitle="Downloads are stored inside this folder, in a sub-folder per playlist."
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => setAdding((a) => !a)} disabled={!current}>
            <Icon name="plus" /> New folder
          </button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!current} onClick={() => current && onPick(current)}>
            Use this folder
          </button>
        </>
      }
    >
      <nav className="crumbs" aria-label="Folder path">
        {stack.map((s, i) => (
          <span key={`${s.id}-${i}`} className="crumb-wrap">
            {i > 0 && <Icon name="chevron" />}
            <button type="button" className={`crumb ${i === stack.length - 1 ? "here" : ""}`} onClick={() => jump(i)}>
              {i === 0 ? (
                <>
                  <Brand kind={provider.key} size={14} /> {provider.key === "gdrive" ? "My Drive" : "Dropbox"}
                </>
              ) : (
                lastSegment(s.path)
              )}
            </button>
          </span>
        ))}
      </nav>

      {adding && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input autoFocus placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            Create
          </button>
        </form>
      )}

      {error && (
        <div className="notice bad">
          <Icon name="alert" /> <span>{error}</span>
          <button type="button" className="btn ghost small" onClick={() => load(current)}>
            Retry
          </button>
        </div>
      )}

      <ul className="folder-list" aria-busy={loading}>
        {loading && folders.length === 0 && [0, 1, 2, 3].map((i) => <li key={i} className="skeleton" />)}
        {!loading && !error && folders.length === 0 && (
          <li className="empty">No folders in here yet. Use this one, or create a new folder.</li>
        )}
        {folders.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => enter(f)}>
              <Icon name="folder" />
              <span>{f.name}</span>
              <Icon name="chevron" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
