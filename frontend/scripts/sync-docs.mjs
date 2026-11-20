/**
 * Publishes the repository's documentation on the site.
 *
 * The product is documented once, in `docs/` at the root of the repository:
 * that is where a change to the code brings its documentation along, in the
 * same commit. The site shows the same pages under /docs/product. This script
 * makes the site's copies from the sources; nobody edits the copies.
 *
 *   node scripts/sync-docs.mjs      (or `npm run docs:sync`)
 *
 * It also runs before every build (`prebuild`). The copies are committed all
 * the same, so that a build which cannot see the folder above its own still
 * has them, and `lib/docs/product-docs.test.ts` fails when a copy is older
 * than its source.
 *
 * What a copy changes, and nothing else:
 * - the title leaves the text and goes to the front matter, with a one-line
 *   description taken from the first paragraph;
 * - a link to another published page points to that page on the site;
 * - a link to anything else in the repository points to it on GitHub;
 * - an anchor is rewritten the way the site writes its own (GitHub keeps
 *   accents in an anchor, the site does not).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `docs/` at the root of the repository. */
export const SOURCE_DIR = path.resolve(HERE, "..", "..", "docs");
/** Where the site reads the copies. */
export const OUT_DIR = path.resolve(HERE, "..", "content", "docs", "product");

const GITHUB = "https://github.com/V1ktor7/obscyro/blob/main";

/** The pages the site publishes, in the order it lists them. */
export const PRODUCT_DOCS = ["decision-loop", "scenarios-page", "analyst", "algorithms", "changelog"];

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

/** A heading's anchor as GitHub writes it: accents kept, punctuation dropped, one hyphen per space. */
export function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const withoutFences = (markdown) => markdown.replace(/```[\s\S]*?```/g, "");

/** Every heading of a page, as text. */
export function headingsOf(markdown) {
  return Array.from(withoutFences(markdown).matchAll(/^#{1,6}\s+(.+?)\s*$/gm), (m) => m[1]);
}

/** GitHub anchor to site anchor, for one page. */
function anchorMap(markdown) {
  const map = new Map();
  for (const text of headingsOf(markdown)) map.set(githubSlug(text), siteSlug(text));
  return map;
}

function siteAnchor(anchor, map) {
  let decoded = anchor;
  try {
    decoded = decodeURIComponent(anchor);
  } catch {
    /* not percent-encoded */
  }
  return map.get(decoded) ?? siteSlug(decoded);
}

const plain = (markdown) =>
  markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The first paragraph of a page, as one plain line: its first sentence when the paragraph is long. */
export function descriptionOf(body) {
  const first = withoutFences(body)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !/^(#|\||>|-|\d+\.|```)/.test(block));
  if (!first) return "";
  const text = plain(first);
  if (text.length <= 200) return text;
  const sentence = /^(.{40,200}?[.!?])\s/.exec(text);
  return sentence ? sentence[1] : `${text.slice(0, 197).trimEnd()}…`;
}

/**
 * One page of the repository's documentation, as the site reads it.
 *
 * `sources` holds every published page by name, so that a link from one to a
 * section of another can be given the right anchor.
 */
export function renderProductDoc(name, sources) {
  const source = sources[name].replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const at = lines.findIndex((line) => /^#\s+/.test(line));
  const title = at >= 0 ? lines[at].replace(/^#\s+/, "").trim() : name;
  const body = (at >= 0 ? [...lines.slice(0, at), ...lines.slice(at + 1)] : lines).join("\n").replace(/^\n+/, "");

  const anchors = Object.fromEntries(Object.entries(sources).map(([n, text]) => [n, anchorMap(text)]));

  // Outside code only: a link inside a fence is an example, not a link.
  const rewritten = body
    .split(/(```[\s\S]*?```)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
            if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
            const [file, anchor] = target.split("#");
            if (!file) return `](#${siteAnchor(anchor ?? "", anchors[name])})`;
            const page = file.replace(/^\.\//, "").replace(/\.md$/, "");
            if (PRODUCT_DOCS.includes(page) && sources[page] !== undefined) {
              return `](/docs/product/${page}${anchor ? `#${siteAnchor(anchor, anchors[page])}` : ""})`;
            }
            const resolved = path.posix.normalize(path.posix.join("docs", file));
            return `](${GITHUB}/${resolved}${anchor ? `#${anchor}` : ""})`;
          }),
    )
    .join("");

  const quote = (value) => JSON.stringify(value);
  return [
    "---",
    `# Copy of docs/${name}.md, made by scripts/sync-docs.mjs. Edit the source, then run \`npm run docs:sync\`.`,
    `title: ${quote(title)}`,
    `description: ${quote(descriptionOf(body))}`,
    `source: ${quote(`docs/${name}.md`)}`,
    "---",
    "",
    rewritten.replace(/\s+$/, ""),
    "",
  ].join("\n");
}

/** The sources that exist, by name. Empty when the build cannot see the repository's `docs/`. */
export function readSources(dir = SOURCE_DIR) {
  const sources = {};
  for (const name of PRODUCT_DOCS) {
    const file = path.join(dir, `${name}.md`);
    if (existsSync(file)) sources[name] = readFileSync(file, "utf8");
  }
  return sources;
}

export function main() {
  const sources = readSources();
  const names = Object.keys(sources);
  if (names.length === 0) {
    console.log("docs: the repository's docs/ is not visible from here; keeping the committed copies.");
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;
  for (const name of names) {
    const file = path.join(OUT_DIR, `${name}.md`);
    const next = renderProductDoc(name, sources);
    const before = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
    if (before !== next) {
      writeFileSync(file, next);
      written++;
    }
  }
  console.log(`docs: ${names.length} page${names.length === 1 ? "" : "s"} read from docs/, ${written} cop${written === 1 ? "y" : "ies"} updated.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
