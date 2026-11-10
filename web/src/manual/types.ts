export type Block =
  | { t: "p"; text: string }
  | { t: "steps"; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "img"; src: string; alt: string; caption?: string }
  | { t: "tip"; text: string }
  | { t: "warn"; text: string }
  | { t: "code"; text: string; label?: string };

export interface Section {
  id: string;
  group: string;
  title: string;
  /** One-line description shown in search results */
  summary: string;
  /** Extra words people might type that the text doesn't contain */
  keywords?: string[];
  blocks: Block[];
}
