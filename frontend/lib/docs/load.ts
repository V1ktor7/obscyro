import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { extractHeadings, type DocHeading } from "./headings";

const DOCS_ROOT = path.join(process.cwd(), "content", "docs");

export interface LoadedDoc {
  slug: string[];
  content: string;
  frontmatter: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  };
  headings: DocHeading[];
}

export async function loadDoc(slug: string[]): Promise<LoadedDoc | null> {
  const relativePath = `${slug.join("/")}.mdx`;
  const filePath = path.join(DOCS_ROOT, relativePath);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const { data, content } = matter(raw);
    return {
      slug,
      content,
      frontmatter: data as LoadedDoc["frontmatter"],
      headings: extractHeadings(content),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
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
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      const stem = entry.name.replace(/\.mdx$/, "");
      out.push({ slug: [...prefix, stem] });
    }
  }
}
