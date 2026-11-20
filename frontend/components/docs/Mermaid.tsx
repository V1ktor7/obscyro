"use client";

import { useEffect, useId, useState } from "react";

/**
 * A Mermaid diagram from the documentation, drawn in the theme's colours.
 *
 * The library is large, so it is fetched only when a page that has a diagram
 * is opened. Until it has drawn (and if it cannot), the diagram's source is
 * shown instead: it is written to be read, and a reader is never left with an
 * empty box.
 */
export default function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          // The diagrams are the repository's own, but nothing in one needs a script or a link.
          securityLevel: "strict",
          theme: "base",
          fontFamily: "var(--font-sans), 'Helvetica Neue', Arial, sans-serif",
          themeVariables: {
            darkMode: true,
            fontSize: "13px",
            background: "#262626",
            primaryColor: "#393939",
            primaryTextColor: "#f4f4f4",
            primaryBorderColor: "#6f6f6f",
            secondaryColor: "#262626",
            secondaryTextColor: "#f4f4f4",
            secondaryBorderColor: "#525252",
            tertiaryColor: "#1f1f1f",
            tertiaryTextColor: "#f4f4f4",
            tertiaryBorderColor: "#525252",
            lineColor: "#a8a8a8",
            textColor: "#f4f4f4",
            mainBkg: "#393939",
            nodeBorder: "#6f6f6f",
            clusterBkg: "#1f1f1f",
            clusterBorder: "#525252",
            edgeLabelBackground: "#262626",
            titleColor: "#f4f4f4",
            actorBkg: "#393939",
            actorBorder: "#6f6f6f",
            actorTextColor: "#f4f4f4",
            signalColor: "#c6c6c6",
            signalTextColor: "#f4f4f4",
            labelBoxBkgColor: "#393939",
            labelBoxBorderColor: "#6f6f6f",
            labelTextColor: "#f4f4f4",
            noteBkgColor: "#33290a",
            noteBorderColor: "#684e00",
            noteTextColor: "#fddc69",
          },
        });
        const drawn = await mermaid.render(`mermaid-${id}`, chart);
        if (!cancelled) setSvg(drawn.svg);
      } catch {
        // The source stays on screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (svg) {
    return (
      <div
        role="img"
        aria-label="Diagram"
        className="not-prose my-6 overflow-x-auto border border-border-subtle bg-bg-secondary p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        // The SVG is Mermaid's own output, from a diagram written in this repository.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <pre className="not-prose my-6 overflow-x-auto border border-border-subtle bg-bg-secondary p-4 font-mono text-[0.78rem] leading-relaxed text-fg-secondary">
      {chart}
    </pre>
  );
}
