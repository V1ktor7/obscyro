"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DocHeading } from "@/lib/docs/headings";

/**
 * Collapsible "On this page" used at the top of doc articles below xl breakpoint.
 * Stays compact when closed, expands inline (no popover positioning headaches).
 */
export default function TableOfContentsCompact({
  headings,
}: {
  headings: DocHeading[];
}) {
  const [open, setOpen] = useState(false);

  if (!headings.length) return null;

  return (
    <div className="not-prose mb-8 rounded-lg border border-border-subtle bg-bg-secondary xl:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary transition-colors hover:text-fg-primary sm:text-[0.65rem] sm:tracking-[0.2em]"
      >
        <span>On this page</span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="border-t border-border-subtle px-2 pb-2 pt-2">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary",
                  h.depth === 3 && "pl-6",
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
