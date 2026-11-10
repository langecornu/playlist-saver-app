import type { CloudKey, Destination } from "./api";

export type IconName =
  | "link" | "folder" | "download" | "upload" | "check" | "skip" | "alert" | "x" | "wave" | "paste" | "log"
  | "search" | "disc" | "bolt" | "gear" | "plus" | "chevron" | "star" | "star-fill" | "cloud" | "laptop" | "copy"
  | "lock" | "arrow" | "home" | "refresh" | "external" | "sparkle";

const PATHS: Record<IconName, React.ReactNode> = {
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  download: <><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>,
  upload: <><path d="M12 16V5" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  skip: <><path d="M5 5l9 7-9 7z" /><path d="M19 5v14" /></>,
  alert: <><path d="M12 8v5" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>,
  x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  wave: <><path d="M4 10v4" /><path d="M8 6v12" /><path d="M12 3v18" /><path d="M16 7v10" /><path d="M20 10v4" /></>,
  paste: <><rect x="6" y="5" width="12" height="16" rx="2" /><path d="M9 5a3 3 0 0 1 6 0" /></>,
  log: <><path d="M5 6h14" /><path d="M5 12h14" /><path d="M5 18h9" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4-4" /></>,
  disc: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /></>,
  bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6z" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  "star-fill": <path fill="currentColor" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  cloud: <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z" />,
  laptop: <><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M2 20h20" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  home: <path d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-3.5L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.5 3.5L20 15" /><path d="M20 20v-5h-5" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
};

export function Icon({ name, size }: { name: IconName; size?: number | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? "1em"}
      height={size ?? "1em"}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

/** Simplified provider marks, drawn for this app. */
export function Brand({ kind, size = 22 }: { kind: Destination; size?: number }) {
  if (kind === "dropbox") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <g fill="#0061ff">
          <polygon points="6,2 12,5.8 6,9.6 0,5.8" />
          <polygon points="18,2 24,5.8 18,9.6 12,5.8" />
          <polygon points="6,9.6 12,13.4 6,17.2 0,13.4" />
          <polygon points="18,9.6 24,13.4 18,17.2 12,13.4" />
          <polygon points="12,14.6 18,18.4 12,22.2 6,18.4" />
        </g>
      </svg>
    );
  }
  if (kind === "gdrive") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <polygon fill="#00ac47" points="8.2,3 1.5,14.6 5.2,21 11.9,9.4" />
        <polygon fill="#ffba00" points="8.2,3 15.8,3 22.5,14.6 14.9,14.6" />
        <polygon fill="#2684fc" points="5.2,21 18.8,21 22.5,14.6 8.9,14.6" />
      </svg>
    );
  }
  return <Icon name="laptop" size={size} />;
}

export const LABELS: Record<Destination, string> = {
  local: "This Mac",
  dropbox: "Dropbox",
  gdrive: "Google Drive",
};

export const CLOUD_KEYS: CloudKey[] = ["dropbox", "gdrive"];
