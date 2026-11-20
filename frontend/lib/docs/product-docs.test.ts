import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import { describe, expect, it } from "vitest";

import {
  OUT_DIR,
  PRODUCT_DOCS,
  diagramsIn,
  fingerprint,
  headingsOf,
  readSources,
  siteSlug,
  stampOf,
} from "../../scripts/product-docs.mjs";
import { slugify } from "./headings";
import { DOC_NAV } from "./nav";
import { remarkMermaid } from "./remark-mermaid";

const sources = readSources() as Record<string, string>;
const visible = Object.keys(sources).length > 0;

const english = (name: string): string => readFileSync(path.join(OUT_DIR, `${name}.md`), "utf8").replace(/\r\n/g, "\n");
const bodyOf = (name: string): string => matter(english(name)).content;

describe("the site's English pages of the repository's documentation", () => {
  // The product is documented in French, in docs/, in the same commit as the code. The site
  // publishes it in English. A page that fails here says something the French one no longer
  // does: bring frontend/content/docs/product/<name>.md up to date, then `npm run docs:stamp`.
  it.runIf(visible)("were each written from the French page as it is today", () => {
    for (const name of Object.keys(sources)) {
      const file = path.join(OUT_DIR, `${name}.md`);
      expect(existsSync(file), `docs/${name}.md has no English page: write frontend/content/docs/product/${name}.md`).toBe(true);
      expect(
        stampOf(english(name)) === fingerprint(sources[name]!),
        `docs/${name}.md changed since frontend/content/docs/product/${name}.md was written: update the English page, then run npm run docs:stamp`,
      ).toBe(true);
    }
  });

  it.runIf(visible)("have every section and every diagram of the page they translate", () => {
    for (const name of Object.keys(sources)) {
      const body = bodyOf(name);
      // The French page opens with its title as a heading; the English one carries it in its front matter.
      expect(headingsOf(body).length, `${name}: sections`).toBe(headingsOf(sources[name]!).length - 1);
      expect(diagramsIn(body), `${name}: diagrams`).toBe(diagramsIn(sources[name]!));
    }
  });

  it.runIf(visible)("are all listed in the navigation, and nothing is listed that is not published", () => {
    const listed = DOC_NAV.flatMap((s) => s.items)
      .filter((i) => i.slug[0] === "product")
      .map((i) => i.slug[1]);
    expect(listed).toEqual(PRODUCT_DOCS);
    expect(Object.keys(sources).sort()).toEqual([...PRODUCT_DOCS].sort());
  });

  it("say what they are and where they come from", () => {
    for (const name of PRODUCT_DOCS) {
      const { data } = matter(english(name));
      expect(typeof data.title === "string" && data.title.length > 0, `${name}: title`).toBe(true);
      expect(typeof data.description === "string" && data.description.length > 0, `${name}: description`).toBe(true);
      expect(data.source, `${name}: source`).toBe(`docs/${name}.md`);
    }
  });

  it("point every link to a section at a heading that exists on the page it names", () => {
    const ids = Object.fromEntries(PRODUCT_DOCS.map((name: string) => [name, headingsOf(bodyOf(name)).map((h: string) => slugify(h))]));
    for (const name of PRODUCT_DOCS) {
      const body = bodyOf(name).replace(/```[\s\S]*?```/g, "");
      for (const [, page, anchor] of Array.from(body.matchAll(/\]\((?:\/docs\/product\/([a-z-]+))?#([^)\s]+)\)/g))) {
        const target = page ?? name;
        expect(ids[target], `${name}.md links to #${anchor} of ${target}.md, which has no such heading`).toContain(anchor);
      }
    }
  });

  it("link to each other on the site, never to a file of the repository by its name", () => {
    for (const name of PRODUCT_DOCS) {
      const body = bodyOf(name).replace(/```[\s\S]*?```/g, "");
      const loose = Array.from(body.matchAll(/\]\(([^)\s]+)\)/g), (m) => m[1]!).filter(
        (target) => !/^(https?:|mailto:|\/|#)/.test(target),
      );
      expect(loose, `${name}.md has relative links, which lead nowhere on the site`).toEqual([]);
    }
  });
});

describe("the fingerprint of a page", () => {
  it("changes with a word and not with a line ending", () => {
    expect(fingerprint("Une phrase.\nDeux.\n")).toBe(fingerprint("Une phrase.\r\nDeux.\r\n"));
    expect(fingerprint("Une phrase.\n")).not.toBe(fingerprint("Une phrase !\n"));
    expect(fingerprint("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is read back from the front matter of the page that recorded it", () => {
    expect(stampOf('---\ntitle: "T"\ntranslatedFrom: "0123456789abcdef"\n---\n\nBody.\n')).toBe("0123456789abcdef");
    expect(stampOf('---\ntitle: "T"\n---\n\nBody.\n')).toBeNull();
  });
});

describe("an anchor", () => {
  it("is written the same way by the page that shows it and by the script that checks it", () => {
    for (const text of ["D7. Freshness of a value", "Où ça casse", "A2. Number verifier", "`test_option` and the rest", "A scenario's run"]) {
      expect(siteSlug(text)).toBe(slugify(text));
    }
    expect(slugify("D7. Fraîcheur d'une valeur")).toBe("d7-fraicheur-dune-valeur");
  });
});

describe("a Mermaid fence in a page", () => {
  it("becomes an element that carries the diagram, and other code is left to the highlighter", () => {
    const tree = {
      type: "root",
      children: [
        { type: "code", lang: "mermaid", value: "flowchart TD\n  A --> B" },
        { type: "code", lang: "ts", value: "const a = 1;" },
        { type: "blockquote", children: [{ type: "code", lang: "mermaid", value: "graph LR\n  X --> Y" }] },
      ],
    };
    remarkMermaid()(tree);
    expect(tree.children[0]).toEqual({
      type: "mermaidDiagram",
      data: { hName: "div", hProperties: { "data-mermaid": "flowchart TD\n  A --> B" } },
    });
    expect(tree.children[1]).toEqual({ type: "code", lang: "ts", value: "const a = 1;" });
    expect((tree.children[2] as { children: { type: string }[] }).children[0]!.type).toBe("mermaidDiagram");
  });
});
