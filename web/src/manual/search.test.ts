import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MANUAL } from "./content.ts";
import { slug, toMarkdown } from "./markdown.ts";
import { highlightParts, normalise, search, tokenize } from "./search.ts";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

test("an empty or one-letter query finds nothing", () => {
  assert.deepEqual(search(MANUAL, ""), []);
  assert.deepEqual(search(MANUAL, "   "), []);
  assert.deepEqual(search(MANUAL, "a"), []);
});

test("searching is case and accent insensitive", () => {
  assert.equal(normalise("Dépôt ÉTÉ"), "depot ete");
  const a = search(MANUAL, "DROPBOX").map((h) => h.section.id);
  const b = search(MANUAL, "Dropbóx").map((h) => h.section.id);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
});

test("a title match ranks first", () => {
  assert.equal(search(MANUAL, "duplicates")[0].section.id, "duplicates");
  assert.equal(search(MANUAL, "dropbox")[0].section.id, "connect-dropbox");
  assert.equal(search(MANUAL, "server port")[0].section.id, "port");
});

test("every word must match (AND)", () => {
  const ids = search(MANUAL, "dropbox redirect").map((h) => h.section.id);
  assert.ok(ids.includes("connect-dropbox"));
  assert.deepEqual(search(MANUAL, "dropbox zzzzqqq"), []);
});

test("keywords find sections whose text lacks the word", () => {
  assert.ok(search(MANUAL, "uninstall").some((h) => h.section.id === "faq"));
  assert.ok(search(MANUAL, "lossless").some((h) => h.section.id === "format-quality"));
});

test("results carry a snippet around the match", () => {
  const hit = search(MANUAL, "overwritten")[0];
  assert.ok(hit.snippet.toLowerCase().includes("overwritten"));
});

test("highlightParts marks each matching word and keeps the text intact", () => {
  const parts = highlightParts("Connect Dropbox in Settings", "dropbox settings");
  assert.equal(parts.map((p) => p.text).join(""), "Connect Dropbox in Settings");
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ["Dropbox", "Settings"]);
  assert.deepEqual(highlightParts("Nothing here", ""), [{ text: "Nothing here", hit: false }]);
});

test("tokenize drops punctuation and single letters", () => {
  assert.deepEqual(tokenize("Wi-Fi, a port!"), ["wi", "fi", "port"]);
});

test("the manual is well formed", () => {
  const ids = MANUAL.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "section ids must be unique");
  for (const s of MANUAL) {
    assert.ok(s.title && s.summary && s.group, `${s.id} needs title, summary and group`);
    assert.ok(s.blocks.length > 0, `${s.id} is empty`);
  }
  // sections of one group stay together so the contents list reads in order
  const groups = MANUAL.map((s) => s.group);
  const seen = new Set<string>();
  groups.forEach((g, i) => {
    if (i > 0 && g !== groups[i - 1]) assert.ok(!seen.has(g), `group "${g}" is split up`);
    seen.add(g);
  });
});

test("the manual runs from install to usage", () => {
  const order = [...new Set(MANUAL.map((s) => s.group))];
  assert.ok(order.indexOf("Install") < order.indexOf("Saving music"));
  assert.ok(order.indexOf("Saving music") < order.indexOf("Cloud storage"));
});

test("every screenshot the manual shows exists", () => {
  for (const s of MANUAL) {
    for (const b of s.blocks) {
      if (b.t !== "img") continue;
      assert.ok(b.alt.length > 0, `${b.src} needs alt text`);
      assert.ok(fs.existsSync(path.join(publicDir, b.src)), `${b.src} is missing (section ${s.id})`);
    }
  }
});

test("docs/USER_GUIDE.md matches the in-app manual (run `npm run guide` to refresh it)", () => {
  const file = path.resolve(publicDir, "../../docs/USER_GUIDE.md");
  assert.ok(fs.existsSync(file), "docs/USER_GUIDE.md is missing");
  assert.equal(fs.readFileSync(file, "utf8"), toMarkdown(MANUAL));
});

test("guide anchors are unique so the contents links work", () => {
  const slugs = MANUAL.map((s) => slug(s.title));
  assert.equal(new Set(slugs).size, slugs.length);
});
