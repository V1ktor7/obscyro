import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { extractHeadings, type DocHeading } from "./headings";

const DOCS_ROOT = path.join(process.cwd(), "content", "docs");

/**
 * How a page is written.
 *
 * `mdx` is a page written for the site: it may use the site's components.
 * `md` is plain Markdown, which is what the repository's own documentation is
 * (`content/docs/product`, copied from `docs/` by scripts/sync-docs.mjs). It is
 * compiled as Markdown, so a brace or an angle bracket in a sentence is a
 * character and not the start of an expression.
 */
export type DocFormat = "mdx" | "md";

const FORMATS: DocFormat[] = ["mdx", "md"];

export interface LoadedDoc {
  slug: string[];
  format: DocFormat;
  content: string;
  frontmatter: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  };
  headings: DocHeading[];
}

export async function loadDoc(slug: string[]): Promise<LoadedDoc | null> {
  for (const format of FORMATS) {
    const filePath = path.join(DOCS_ROOT, `${slug.join("/")}.${format}`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const { data, content } = matter(raw);
      return {
        slug,
        format,
        content,
        frontmatter: data as LoadedDoc["frontmatter"],
        headings: extractHeadings(content),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return null;
}

export async function listDocFiles(): Promise<{ slug: string[] }[]> {
  const out: { slug: string[] }[] = [];
  await walk(DOCS_ROOT, [], out);
  return out;
}

async function walk(
  dir: string,
  prefix: string[],
  out: { slug: string[] }[],
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, [...prefix, entry.name], out);
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      const stem = entry.name.replace(/\.mdx?$/, "");
      out.push({ slug: [...prefix, stem] });
    }
  }
}
