/**
 * Keeps the site's product pages in step with the repository's documentation.
 *
 * The product is documented in French, in `docs/` at the root of the
 * repository: that is where a change to the code brings its documentation
 * along, in the same commit. The site publishes the same pages in English,
 * under /docs/product (`content/docs/product/*.md`). A translation is written
 * by hand, so nothing can generate it; what a program can do is notice when
 * the French page has changed since its English one was written.
 *
 * Each English page therefore records, in its front matter, a fingerprint of
 * the French page it was translated from (`translatedFrom`). When the French
 * page changes, the fingerprint no longer matches, and
 * `lib/docs/product-docs.test.ts` fails until the English page is brought up
 * to date and stamped again.
 *
 *   npm run docs:check    says which English pages are behind their source
 *   npm run docs:stamp    records that every English page is up to date
 *
 * Stamp only after the English page says what the French one now says: the
 * stamp is a statement by whoever runs it, not something this script verifies.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `docs/` at the root of the repository: the French pages. */
export const SOURCE_DIR = path.resolve(HERE, "..", "..", "docs");
/** Where the site reads the English pages. */
export const OUT_DIR = path.resolve(HERE, "..", "content", "docs", "product");

/** The pages the site publishes, in the order it lists them. */
export const PRODUCT_DOCS = ["decision-loop", "scenarios-page", "units-page", "analyst", "algorithms", "changelog"];

/** What a page says, reduced to sixteen characters. Line endings do not count: git may rewrite them. */
export function fingerprint(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
}

/** A heading's anchor as the site writes it. Must stay the same as `slugify` in lib/docs/headings.ts. */
export function siteSlug(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

const withoutFences = (markdown) => markdown.replace(/```[\s\S]*?```/g, "");

/** Every heading of a page, as text. */
export function headingsOf(markdown) {
  return Array.from(withoutFences(markdown).matchAll(/^#{1,6}\s+(.+?)\s*$/gm), (m) => m[1]);
}

/** How many Mermaid diagrams a page draws. */
export function diagramsIn(markdown) {
  return (markdown.match(/^```mermaid\s*$/gm) ?? []).length;
}

/** The French pages that exist, by name. Empty when this folder cannot see the repository's `docs/`. */
export function readSources(dir = SOURCE_DIR) {
  const sources = {};
  for (const name of PRODUCT_DOCS) {
    const file = path.join(dir, `${name}.md`);
    if (existsSync(file)) sources[name] = readFileSync(file, "utf8");
  }
  return sources;
}

/** The fingerprint an English page says it was translated from, or null when it says none. */
export function stampOf(page) {
  const m = /^translatedFrom:\s*"?([0-9a-f]+)"?\s*$/m.exec(page);
  return m ? m[1] : null;
}

/** The English pages that are behind their French source, by name. */
export function stale(sources = readSources()) {
  return Object.keys(sources).filter((name) => {
    const file = path.join(OUT_DIR, `${name}.md`);
    return !existsSync(file) || stampOf(readFileSync(file, "utf8")) !== fingerprint(sources[name]);
  });
}

function stamp() {
  const sources = readSources();
  let written = 0;
  for (const [name, source] of Object.entries(sources)) {
    const file = path.join(OUT_DIR, `${name}.md`);
    if (!existsSync(file)) {
      console.log(`docs: ${name}.md has no English page yet (content/docs/product/${name}.md).`);
      continue;
    }
    const page = readFileSync(file, "utf8");
    const line = `translatedFrom: "${fingerprint(source)}"`;
    if (!/^translatedFrom:.*$/m.test(page)) {
      console.log(`docs: ${name}.md has no translatedFrom line in its front matter; add one, then stamp again.`);
      continue;
    }
    const next = page.replace(/^translatedFrom:.*$/m, line);
    if (next !== page) {
      writeFileSync(file, next);
      written++;
    }
  }
  console.log(`docs: ${Object.keys(sources).length} French pages read, ${written} English page${written === 1 ? "" : "s"} stamped.`);
}

function check() {
  const behind = stale();
  if (behind.length === 0) {
    console.log("docs: every English page is in step with its French source.");
    return;
  }
  for (const name of behind) {
    console.log(`docs: docs/${name}.md changed since frontend/content/docs/product/${name}.md was written.`);
  }
  console.log("docs: bring those English pages up to date, then run `npm run docs:stamp`.");
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) check();
  else stamp();
}
