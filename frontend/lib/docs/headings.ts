export interface DocHeading {
  depth: 2 | 3;
  text: string;
  id: string;
}

const HEADING_RE = /^(#{2,3})\s+(.+?)\s*$/gm;
const FENCE_RE = /```[\s\S]*?```/g;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function extractHeadings(markdown: string): DocHeading[] {
  // Strip fenced code so we don't pick up `## something` inside snippets.
  const stripped = markdown.replace(FENCE_RE, "");
  const out: DocHeading[] = [];
  const matches = Array.from(stripped.matchAll(HEADING_RE));
  for (const match of matches) {
    const depth = match[1].length as 2 | 3;
    const text = match[2].trim();
    out.push({ depth, text, id: slugify(text) });
  }
  return out;
}
