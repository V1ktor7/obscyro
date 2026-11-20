import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  OUT_DIR,
  PRODUCT_DOCS,
  descriptionOf,
  githubSlug,
  headingsOf,
  readSources,
  renderProductDoc,
  siteSlug,
} from "../../scripts/sync-docs.mjs";
import { slugify } from "./headings";
import { DOC_NAV } from "./nav";
import { remarkMermaid } from "./remark-mermaid";

const sources = readSources() as Record<string, string>;
const visible = Object.keys(sources).length > 0;

describe("the site's copies of the repository's documentation", () => {
  // The copies are what the site serves. One that is older than its source is a page that says
  // something the code no longer does: `npm run docs:sync` in frontend/ brings it up to date.
  it.runIf(visible)("are each the same as what their source gives today", () => {
    for (const name of Object.keys(sources)) {
      const file = path.join(OUT_DIR, `${name}.md`);
      expect(existsSync(file), `${name}.md has no copy: run npm run docs:sync`).toBe(true);
      const copy = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      expect(copy === renderProductDoc(name, sources), `content/docs/product/${name}.md is out of date: run npm run docs:sync`).toBe(true);
    }
  });

  it.runIf(visible)("are all listed in the navigation, and nothing is listed that is not published", () => {
    const listed = DOC_NAV.flatMap((s) => s.items)
      .filter((i) => i.slug[0] === "product")
      .map((i) => i.slug[1]);
    expect(listed).toEqual(PRODUCT_DOCS);
    expect(Object.keys(sources).sort()).toEqual([...PRODUCT_DOCS].sort());
  });

  it.runIf(visible)("point every link to a section at a heading that exists on the page it names", () => {
    for (const name of Object.keys(sources)) {
      const copy = renderProductDoc(name, sources);
      const body = copy.replace(/```[\s\S]*?```/g, "");
      for (const [, page, anchor] of Array.from(body.matchAll(/\]\((?:\/docs\/product\/([a-z-]+))?#([^)\s]+)\)/g))) {
        const target = page ?? name;
        const ids = headingsOf(sources[target]!).map((h: string) => slugify(h));
        expect(ids, `${name}.md links to #${anchor} of ${target}.md, which has no such heading`).toContain(anchor);
      }
    }
  });
});

describe("how a page of the repository becomes a page of the site", () => {
  const pages = {
    "decision-loop": "# La boucle\n\nSept étapes.\n\n## Où elle en est\n\nTexte.\n",
    analyst: [
      "# L'analyste",
      "",
      "Il lit le jumeau. Voir [la boucle](decision-loop.md#où-elle-en-est), [les règles](../CLAUDE.md) et [plus bas](#d7-fraîcheur-dune-valeur).",
      "Un [lien externe](https://example.org/a.md) reste tel quel.",
      "",
      "```md",
      "[dans du code](decision-loop.md)",
      "```",
      "",
      "## D7. Fraîcheur d'une valeur",
      "",
      "Texte.",
      "",
    ].join("\n"),
  };

  it("moves the title to the front matter, with the first paragraph as its description", () => {
    const page = renderProductDoc("decision-loop", pages);
    expect(page).toContain('title: "La boucle"');
    expect(page).toContain('description: "Sept étapes."');
    expect(page).toContain('source: "docs/decision-loop.md"');
    expect(page).not.toMatch(/^# La boucle$/m);
    expect(page).toContain("## Où elle en est");
  });

  it("sends a link to another published page to the site, with the anchor the site writes", () => {
    const page = renderProductDoc("analyst", pages);
    expect(page).toContain("[la boucle](/docs/product/decision-loop#ou-elle-en-est)");
    expect(page).toContain("[plus bas](#d7-fraicheur-dune-valeur)");
  });

  it("sends a link to anything else in the repository to GitHub, and leaves the rest alone", () => {
    const page = renderProductDoc("analyst", pages);
    expect(page).toContain("[les règles](https://github.com/V1ktor7/obscyro/blob/main/CLAUDE.md)");
    expect(page).toContain("[lien externe](https://example.org/a.md)");
    // A link inside a fence is an example.
    expect(page).toContain("[dans du code](decision-loop.md)");
  });

  it("writes an anchor the way the page that shows it does", () => {
    for (const text of ["D7. Fraîcheur d'une valeur", "Où ça casse", "A2. Vérificateur de chiffres", "`test_option` et le reste", "Run d'un scénario"]) {
      expect(siteSlug(text)).toBe(slugify(text));
    }
    expect(slugify("D7. Fraîcheur d'une valeur")).toBe("d7-fraicheur-dune-valeur");
    expect(githubSlug("D7. Fraîcheur d'une valeur")).toBe("d7-fraîcheur-dune-valeur");
  });

  it("keeps a description to one line a reader can take in", () => {
    expect(descriptionOf("Court.\n\nSuite.")).toBe("Court.");
    const long = `${"Une première phrase qui dit de quoi parle la page. ".repeat(1)}${"Puis beaucoup de détails qui n'ont pas leur place dans un résumé. ".repeat(6)}`;
    expect(descriptionOf(long)).toBe("Une première phrase qui dit de quoi parle la page.");
    // A table or a list is not a description.
    expect(descriptionOf("| a | b |\n|---|---|\n\nLe vrai début.")).toBe("Le vrai début.");
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
