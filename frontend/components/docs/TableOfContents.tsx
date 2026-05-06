"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { DocHeading } from "@/lib/docs/headings";

export default function TableOfContents({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (!headings.length) return null;

  return (
    <nav className="thin-scrollbar h-full overflow-y-auto py-8 pl-4">
      <p className="mb-3 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-fg-secondary">
        On this page
      </p>
      <ul className="space-y-1.5 border-l border-border-subtle">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                "block border-l-2 px-3 py-1 text-[13px] transition-colors",
                h.depth === 3 && "pl-6",
                activeId === h.id
                  ? "border-fg-primary text-fg-primary"
                  : "border-transparent text-fg-secondary hover:text-fg-primary",
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
