import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

// ---------------------------------------------------------------- Modal (native <dialog>)
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  aside?: React.ReactNode;
}

export function Modal({ open, onClose, title, subtitle, wide, children, footer, aside }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {open && (
        <div className="modal-card">
          <header className="modal-head">
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <div className="modal-head-right">
              {aside}
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- Toasts
type ToastKind = "ok" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const host = useRef<HTMLDivElement>(null);

  const push = useCallback((text: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3800);
  }, []);

  // Popovers live in the top layer, so toasts stay visible above open dialogs
  useEffect(() => {
    const el = host.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el?.showPopover) return;
    try {
      if (el.matches(":popover-open")) el.hidePopover?.();
      if (items.length) el.showPopover();
    } catch {
      /* older browsers: toasts simply render in normal flow */
    }
  }, [items]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div ref={host} className="toasts" {...({ popover: "manual" } as object)} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === "ok" ? "check" : t.kind === "error" ? "alert" : "sparkle"} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------- Controls
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`switch ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="knob" />
      <span className="switch-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? "on" : ""}
          title={o.hint}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const FORMATS = [
  { id: "mp3", label: "MP3", hint: "Plays everywhere" },
  { id: "m4a", label: "M4A", hint: "Better quality at the same size" },
  { id: "flac", label: "FLAC", hint: "Lossless container" },
  { id: "opus", label: "Opus", hint: "Smallest files" },
];

export const BITRATES = [
  { id: "auto", label: "Auto (best available)" },
  { id: "128k", label: "128 kbps" },
  { id: "192k", label: "192 kbps" },
  { id: "256k", label: "256 kbps" },
  { id: "320k", label: "320 kbps" },
];

/** "/Users/name/Music" -> "~/Music" */
export const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");

/** "5 minutes ago", "2 days ago" */
export function ago(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** "in 5 h", "in 2 days"; "due now" once passed */
export function until(ts: number, now = Date.now() / 1000): string {
  const s = Math.round(ts - now);
  if (s <= 60) return "due now";
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

export function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
