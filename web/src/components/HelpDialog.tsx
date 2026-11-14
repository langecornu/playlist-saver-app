import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { MANUAL } from "../manual/content";
import { highlightParts, search } from "../manual/search";
import type { Block, Section } from "../manual/types";
import { Modal } from "../ui";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Section to show when the dialog opens */
  section?: string;
}

/** **bold** and `code` inside manual text. */
function Inline({ text, query }: { text: string; query: string }) {
  const parts = text.split(/(\*\*.+?\*\*|`.+?`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**")) return <strong key={i}><Marked text={p.slice(2, -2)} query={query} /></strong>;
        if (p.startsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
        return <Marked key={i} text={p} query={query} />;
      })}
    </>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>))}
    </>
  );
}

function BlockView({ block, query, onZoom }: { block: Block; query: string; onZoom: (src: string, alt: string) => void }) {
  switch (block.t) {
    case "p":
      return <p><Inline text={block.text} query={query} /></p>;
    case "steps":
      return (
        <ol className="help-steps">
          {block.items.map((it, i) => <li key={i}><Inline text={it} query={query} /></li>)}
        </ol>
      );
    case "list":
      return (
        <ul className="help-list">
          {block.items.map((it, i) => <li key={i}><Inline text={it} query={query} /></li>)}
        </ul>
      );
    case "img":
      return (
        <figure className="help-fig">
          <button type="button" className="help-zoom" onClick={() => onZoom(block.src, block.alt)} aria-label={`Enlarge: ${block.alt}`}>
            <img src={block.src} alt={block.alt} loading="lazy" />
          </button>
          {block.caption && <figcaption><Inline text={block.caption} query={query} /></figcaption>}
        </figure>
      );
    case "tip":
      return <div className="help-note tip"><b>Tip</b><span><Inline text={block.text} query={query} /></span></div>;
    case "warn":
      return <div className="help-note warn"><b>Important</b><span><Inline text={block.text} query={query} /></span></div>;
    case "code":
      return (
        <div className="help-code">
          {block.label && <span className="help-code-label">{block.label}</span>}
          <pre>{block.text}</pre>
          <CopyButton text={block.text} />
        </div>
      );
  }
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the text can still be selected by hand */
        }
      }}
    >
      <Icon name={done ? "check" : "copy"} /> {done ? "Copied" : "Copy"}
    </button>
  );
}

export function HelpDialog({ open, onClose, section }: Props) {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(section ?? MANUAL[0].id);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (open && section) setCurrent(section);
  }, [open, section]);

  const hits = useMemo(() => search(MANUAL, query), [query]);
  const index = Math.max(0, MANUAL.findIndex((s) => s.id === current));
  const sec: Section = MANUAL[index];
  const groups = useMemo(() => {
    const out: { name: string; items: Section[] }[] = [];
    for (const s of MANUAL) {
      const g = out.find((x) => x.name === s.group);
      if (g) g.items.push(s);
      else out.push({ name: s.group, items: [s] });
    }
    return out;
  }, []);

  function go(id: string) {
    setCurrent(id);
    setQuery("");
    bodyRef.current?.scrollTo({ top: 0 });
  }

  return (
    <Modal open={open} onClose={() => (zoom ? setZoom(null) : onClose())} huge title="User manual" subtitle="Everything from installing to your first playlist. Search, or pick a section.">
      <div className="help">
        <div className="help-search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the manual, e.g. “Dropbox”, “port”, “duplicates”…"
            aria-label="Search the manual"
            autoFocus
            spellCheck={false}
          />
          {searching && (
            <button type="button" className="icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
              <Icon name="x" />
            </button>
          )}
        </div>

        <div className="help-layout">
          <nav className="help-nav" aria-label="Manual contents">
            {groups.map((g) => (
              <div key={g.name}>
                <h4>{g.name}</h4>
                <ul>
                  {g.items.map((s) => (
                    <li key={s.id}>
                      <button type="button" className={!searching && s.id === sec.id ? "on" : ""} onClick={() => go(s.id)} aria-current={!searching && s.id === sec.id ? "page" : undefined}>
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="help-body" ref={bodyRef}>
            {searching ? (
              <div className="help-results" role="region" aria-live="polite" aria-label="Search results">
                <p className="muted">
                  {hits.length === 0 ? "No section matches that. Try fewer or different words." : `${hits.length} section${hits.length === 1 ? "" : "s"} found`}
                </p>
                <ul>
                  {hits.map((h) => (
                    <li key={h.section.id}>
                      <button type="button" onClick={() => go(h.section.id)}>
                        <span className="help-hit-group">{h.section.group}</span>
                        <strong><Marked text={h.section.title} query={query} /></strong>
                        <span className="help-hit-snippet"><Marked text={h.snippet} query={query} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <article>
                <p className="help-crumb">{sec.group}</p>
                <h3>{sec.title}</h3>
                {sec.blocks.map((b, i) => <BlockView key={i} block={b} query="" onZoom={(src, alt) => setZoom({ src, alt })} />)}
                <div className="help-pager">
                  {index > 0 ? (
                    <button type="button" className="btn ghost small" onClick={() => go(MANUAL[index - 1].id)}>← {MANUAL[index - 1].title}</button>
                  ) : <span />}
                  {index < MANUAL.length - 1 && (
                    <button type="button" className="btn small" onClick={() => go(MANUAL[index + 1].id)}>{MANUAL[index + 1].title} →</button>
                  )}
                </div>
              </article>
            )}
          </div>
        </div>
      </div>

      {zoom && (
        <div className="help-lightbox" role="dialog" aria-label={zoom.alt} onClick={() => setZoom(null)}>
          <img src={zoom.src} alt={zoom.alt} />
          <span>Click anywhere to close</span>
        </div>
      )}
    </Modal>
  );
}
