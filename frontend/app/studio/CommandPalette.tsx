"use client";

/**
 * Global command palette (spec Part 3.3). Fuzzy search across navigation
 * destinations and environments, keyboard-operable end to end.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Search } from "lucide-react";

import { cn } from "@/lib/cn";

import { NAV_SECTIONS } from "./platform-nav";

export interface PaletteEntry {
  id: string;
  label: string;
  group: string;
  run: () => void;
}

/** Subsequence match, so "obty" finds "Object types". */
function fuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

export default function CommandPalette({
  open,
  onClose,
  environments,
  onSelectEnv,
  capabilities,
}: {
  open: boolean;
  onClose: () => void;
  environments: { slug: string; name: string }[];
  onSelectEnv: (slug: string) => void;
  capabilities: string[] | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<PaletteEntry[]>(() => {
    const out: PaletteEntry[] = [];
    for (const s of NAV_SECTIONS) {
      if (capabilities && !capabilities.includes(s.capability)) continue;
      for (const g of s.groups) {
        for (const item of g.items) {
          out.push({
            id: `nav:${item.href}`,
            label: `${s.label} · ${item.label}`,
            group: "Go to",
            run: () => router.push(item.href),
          });
        }
      }
    }
    for (const e of environments) {
      out.push({
        id: `env:${e.slug}`,
        label: e.name,
        group: "Switch environment",
        run: () => onSelectEnv(e.slug),
      });
    }
    return out;
  }, [router, environments, onSelectEnv, capabilities]);

  const results = useMemo(
    () => entries.filter((e) => fuzzy(e.label, q.trim())).slice(0, 12),
    [entries, q],
  );

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      // Focus after paint so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  if (!open) return null;

  const choose = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    entry.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[12vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[520px] overflow-hidden rounded-lg border border-[#d3d8de] bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#d3d8de] px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-[#8f99a8]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[cursor]);
              }
            }}
            placeholder="Search or run a command…"
            aria-label="Search or run a command"
            className="flex-1 text-sm text-[#1c2127] placeholder:text-[#8f99a8] focus:outline-none"
          />
          <kbd className="rounded border border-[#d3d8de] px-1.5 text-[10px] text-[#8f99a8]">
            esc
          </kbd>
        </div>

        <div className="max-h-[320px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[#8f99a8]">
              Nothing matches “{q}”.
            </p>
          ) : (
            results.map((entry, i) => {
              const prevGroup = i > 0 ? results[i - 1].group : null;
              return (
                <div key={entry.id}>
                  {entry.group !== prevGroup ? (
                    <p className="px-3 pb-1 pt-2 text-[9.5px] font-medium uppercase tracking-[0.06em] text-[#8f99a8]">
                      {entry.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(entry)}
                    className={cn(
                      "block w-full px-3 py-1.5 text-left text-xs",
                      i === cursor ? "bg-[#e7f2fd] text-[#215db0]" : "text-[#1c2127]",
                    )}
                  >
                    {entry.label}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
