/**
 * Turns a ```mermaid fence into something the page can draw.
 *
 * The repository's documentation draws its schemas in Mermaid, because GitHub
 * renders them and they read in a diff. Left alone, the site would show such a
 * fence as a block of code. This plugin replaces it with a `<div data-mermaid>`
 * that carries the diagram's source; the docs page hands that element to the
 * component that draws it (`components/docs/Mermaid.tsx`).
 *
 * It runs before the syntax highlighter, which would otherwise take the fence.
 * Written without a tree-walking library: the tree is small and the walk is
 * six lines.
 */

interface MdNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

function walk(node: MdNode): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "code" && child.lang === "mermaid") {
      return {
        type: "mermaidDiagram",
        data: { hName: "div", hProperties: { "data-mermaid": child.value ?? "" } },
      };
    }
    walk(child);
    return child;
  });
}

export function remarkMermaid() {
  return (tree: unknown): void => walk(tree as MdNode);
}
