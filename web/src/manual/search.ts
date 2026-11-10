import type { Block, Section } from "./types.ts";

export interface Hit {
  section: Section;
  score: number;
  snippet: string;
}

/** Lower-case and strip accents so "Dépôt" matches "depot". */
export function normalise(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Remove the light markup used in manual text (**bold**, `code`). */
export function plain(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}

export function blockText(b: Block): string {
  switch (b.t) {
    case "p":
    case "tip":
    case "warn":
      return plain(b.text);
    case "code":
      return `${b.label ?? ""} ${b.text}`;
    case "steps":
    case "list":
      return b.items.map(plain).join(" ");
    case "img":
      return `${b.alt} ${b.caption ?? ""}`;
  }
}

export function sectionBody(s: Section): string {
  return s.blocks.map(blockText).join(" ");
}

export function tokenize(query: string): string[] {
  return normalise(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

function count(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

function snippetAround(body: string, tokens: string[]): string {
  const flat = body.replace(/\s+/g, " ");
  const low = normalise(flat);
  const at = tokens.map((t) => low.indexOf(t)).filter((i) => i >= 0);
  if (at.length === 0) return flat.slice(0, 140);
  const first = Math.min(...at);
  const start = Math.max(0, first - 50);
  const end = Math.min(flat.length, first + 110);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/** Every word must appear somewhere in the section; matches in the title and keywords weigh most. */
export function search(sections: Section[], query: string): Hit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const hits: Hit[] = [];
  for (const section of sections) {
    const title = normalise(section.title);
    const keys = normalise((section.keywords ?? []).join(" "));
    const summary = normalise(section.summary);
    const body = sectionBody(section);
    const bodyLow = normalise(body);
    let score = 0;
    let all = true;
    for (const t of tokens) {
      const inTitle = count(title, t);
      const inKeys = count(keys, t);
      const inSummary = count(summary, t);
      const inBody = count(bodyLow, t);
      if (inTitle + inKeys + inSummary + inBody === 0) {
        all = false;
        break;
      }
      score += inTitle * 10 + inKeys * 5 + inSummary * 3 + Math.min(inBody, 5);
    }
    if (all) hits.push({ section, score, snippet: snippetAround(body, tokens) });
  }
  return hits.sort((a, b) => b.score - a.score || a.section.title.localeCompare(b.section.title));
}

/** Splits text so the caller can wrap the parts that match the search words. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [{ text, hit: false }];
  const low = normalise(text);
  // normalise() can change length for some characters; fall back to no highlight if it did
  if (low.length !== text.length) return [{ text, hit: false }];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of tokens) {
    for (let i = low.indexOf(t); i !== -1; i = low.indexOf(t, i + t.length)) {
      for (let k = i; k < i + t.length; k++) marks[k] = true;
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  let cur = "";
  let curHit = marks[0] ?? false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] !== curHit) {
      parts.push({ text: cur, hit: curHit });
      cur = "";
      curHit = marks[i];
    }
    cur += text[i];
  }
  if (cur) parts.push({ text: cur, hit: curHit });
  return parts;
}
