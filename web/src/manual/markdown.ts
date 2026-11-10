import type { Block, Section } from "./types.ts";

/** GitHub's heading anchor: lower-case, punctuation dropped, spaces to hyphens. */
export function slug(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
}

function block(b: Block, base: string): string {
  switch (b.t) {
    case "p":
      return b.text;
    case "steps":
      return b.items.map((it, i) => `${i + 1}. ${it}`).join("\n");
    case "list":
      return b.items.map((it) => `- ${it}`).join("\n");
    case "img":
      return `![${b.alt}](${base}${b.src.replace(/^\/manual\//, "")})${b.caption ? `\n\n<sub>${b.caption}</sub>` : ""}`;
    case "tip":
      return `> [!TIP]\n> ${b.text}`;
    case "warn":
      return `> [!IMPORTANT]\n> ${b.text}`;
    case "code":
      return `${b.label ? `**${b.label}**\n\n` : ""}\`\`\`bash\n${b.text}\n\`\`\``;
  }
}

/** The whole manual as one GitHub-readable Markdown page, so the guide is also visible on the repository. */
export function toMarkdown(sections: Section[], imageBase = "../web/public/manual/"): string {
  const groups: { name: string; items: Section[] }[] = [];
  for (const s of sections) {
    const g = groups.find((x) => x.name === s.group);
    if (g) g.items.push(s);
    else groups.push({ name: s.group, items: [s] });
  }
  const out: string[] = [
    "# Playlist Saver user guide",
    "",
    "<!-- Generated from web/src/manual/content.ts by `npm run guide` in web/. Edit that file, not this one. -->",
    "",
    "The same guide is available inside the app: click **Help** at the top right.",
    "",
    "## Contents",
    "",
  ];
  for (const g of groups) {
    out.push(`**${g.name}**`, "");
    for (const s of g.items) out.push(`- [${s.title}](#${slug(s.title)})`);
    out.push("");
  }
  for (const g of groups) {
    out.push("---", "", `## ${g.name}`, "");
    for (const s of g.items) {
      out.push(`### ${s.title}`, "");
      for (const b of s.blocks) out.push(block(b, imageBase), "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
