// Writes docs/USER_GUIDE.md from the in-app manual. Run with `npm run guide`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANUAL } from "../src/manual/content.ts";
import { toMarkdown } from "../src/manual/markdown.ts";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/USER_GUIDE.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toMarkdown(MANUAL));
console.log("wrote", out);
