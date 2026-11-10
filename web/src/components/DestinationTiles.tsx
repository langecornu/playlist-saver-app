import type { Destination, ProviderStatus } from "../api";
import { Brand, Icon, LABELS } from "../icons";
import { tilde } from "../ui";

interface Props {
  providers: ProviderStatus[];
  value: Destination;
  localDir: string;
  onChange: (d: Destination) => void;
  /** Called when a not-yet-connected service is clicked */
  onConnect: (key: Exclude<Destination, "local">) => void;
}

export function DestinationTiles({ providers, value, localDir, onChange, onConnect }: Props) {
  const tiles: { key: Destination; sub: string; ok: boolean }[] = [
    { key: "local", sub: tilde(localDir), ok: true },
    ...(["dropbox", "gdrive"] as const).map((key) => {
      const p = providers.find((x) => x.key === key);
      return {
        key,
        ok: !!p?.connected,
        sub: p?.connected ? p.account?.email || p.account?.name || "Connected" : p?.expired ? "Reconnect needed" : "Not connected",
      };
    }),
  ];

  return (
    <div className="dest-tiles" role="radiogroup" aria-label="Where to save">
      {tiles.map((t) => {
        const selected = value === t.key;
        return (
          <button
            type="button"
            key={t.key}
            role="radio"
            aria-checked={selected}
            className={`tile ${selected ? "on" : ""} ${t.ok ? "" : "off"}`}
            onClick={() => (t.ok ? onChange(t.key) : onConnect(t.key as Exclude<Destination, "local">))}
          >
            <span className="tile-mark">
              <Brand kind={t.key} size={22} />
            </span>
            <span className="tile-text">
              <strong>{LABELS[t.key]}</strong>
              <small>{t.sub}</small>
            </span>
            {selected && (
              <span className="tile-check">
                <Icon name="check" />
              </span>
            )}
            {!t.ok && <span className="tile-cta">Connect</span>}
          </button>
        );
      })}
    </div>
  );
}
