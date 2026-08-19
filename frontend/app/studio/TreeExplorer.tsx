"use client";

/**
 * A collapsible tree in a side panel — the shape everyone already knows from a
 * file explorer, applied to things that are not files.
 *
 * The difference matters and drives every decision below. A folder has no
 * state: it is a container and nothing more. A node here is an establishment
 * holding 59 installations at 82% occupancy, and if the tree shows only names
 * you will read the map instead and the panel will have been wasted. So a row
 * carries its own numbers, and a collapsed parent carries its subtree's.
 *
 * The second difference is that selecting and filtering are separate gestures.
 * An explorer conflates them because opening a file is the only thing you can
 * do to it. Here you want "tell me about this establishment" and "show me only
 * this establishment" independently — often at the same time, sometimes not.
 * Click inspects; the checkbox scopes.
 *
 * Deliberately generic. Three screens need this — the twin's units, the event
 * workspace's ontology rail, the ontology manager's types — and writing it
 * three times produces three trees that behave differently, one of which is
 * always the wrong one. Callers adapt their data into `TreeItem` and get the
 * same behaviour everywhere.
 */

import { useMemo, useState } from "react";

export interface TreeItem {
  id: string;
  label: string;
  children?: TreeItem[];
  /** Right-aligned figure — a count of what is underneath, usually. */
  count?: number | null;
  /** The reading this node is judged on, already formatted. */
  value?: string | null;
  /** Drives the dot. `null` means nothing is known, which is not "fine". */
  tone?: "ok" | "warn" | "danger" | null;
  /** Shown under the label when there is something worth saying. */
  hint?: string | null;
}

const TONE: Record<"ok" | "warn" | "danger", string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-400",
  danger: "bg-rose-500",
};

/**
 * Lowercase and strip accents, both sides of the comparison.
 *
 * Half these names carry a circumflex — HÔPITAL, HÔTEL-DIEU, CÔTE-DES-NEIGES —
 * and nobody reaches for the accent while filtering a list. A search that only
 * matches when you type `hôpital` is a search that reports nothing found in a
 * network of hospitals.
 */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Every id in a subtree, so checking a parent scopes the whole branch. */
export function subtreeIds(item: TreeItem): string[] {
  const out = [item.id];
  for (const c of item.children ?? []) out.push(...subtreeIds(c));
  return out;
}

/**
 * Ids to keep open so every match is visible.
 *
 * A filtered tree that hides the matches inside collapsed parents is worse than
 * no filter at all: the count says four, the panel shows none.
 */
export function matchingIds(items: TreeItem[], query: string): Set<string> {
  const q = fold(query);
  const keep = new Set<string>();
  if (!q) return keep;
  const walk = (item: TreeItem, ancestors: string[]): boolean => {
    const hit = fold(item.label).includes(q);
    let childHit = false;
    for (const c of item.children ?? []) {
      if (walk(c, [...ancestors, item.id])) childHit = true;
    }
    if (hit || childHit) {
      keep.add(item.id);
      for (const a of ancestors) keep.add(a);
      return true;
    }
    return false;
  };
  for (const i of items) walk(i, []);
  return keep;
}

export interface TreeExplorerProps {
  items: TreeItem[];
  /** The inspected node — one at a time, like a cursor. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /**
   * Which ids the view is scoped to. Undefined means "no scoping offered", and
   * the checkboxes disappear rather than being shown doing nothing.
   */
  scoped?: Set<string>;
  onScope?: (ids: string[], include: boolean) => void;
  emptyLabel?: string;
}

export default function TreeExplorer({
  items,
  selectedId = null,
  onSelect,
  scoped,
  onScope,
  emptyLabel = "Nothing here yet.",
}: TreeExplorerProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const matches = useMemo(() => matchingIds(items, query), [items, query]);
  const filtering = query.trim().length > 0;

  const total = useMemo(() => items.reduce((n, i) => n + subtreeIds(i).length, 0), [items]);

  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col border-r border-line bg-white">
      <div className="shrink-0 border-b border-line px-2 py-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter the tree"
          className="w-full rounded border border-line px-2 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
        />
        <p className="mt-1 text-[10px] text-ink-faint">
          {filtering ? `${matches.size} matching` : `${items.length} roots · ${total} nodes`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {items.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-snug text-ink-faint">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <Row
              key={item.id}
              item={item}
              depth={0}
              open={open}
              setOpen={setOpen}
              selectedId={selectedId}
              onSelect={onSelect}
              scoped={scoped}
              onScope={onScope}
              matches={matches}
              filtering={filtering}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  item,
  depth,
  open,
  setOpen,
  selectedId,
  onSelect,
  scoped,
  onScope,
  matches,
  filtering,
}: {
  item: TreeItem;
  depth: number;
  open: Set<string>;
  setOpen: (s: Set<string>) => void;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  scoped?: Set<string>;
  onScope?: (ids: string[], include: boolean) => void;
  matches: Set<string>;
  filtering: boolean;
}) {
  if (filtering && !matches.has(item.id)) return null;

  const kids = item.children ?? [];
  // While filtering, a parent is open regardless: a match hidden inside a
  // collapsed branch is a match the reader never sees.
  const isOpen = filtering || open.has(item.id);
  const selected = selectedId === item.id;
  const ids = subtreeIds(item);
  const included = scoped ? ids.every((id) => scoped.has(id)) : false;
  const partial = scoped ? !included && ids.some((id) => scoped.has(id)) : false;

  return (
    <>
      <div
        className={`flex items-center gap-1 px-1 py-0.5 ${
          selected ? "bg-brand-soft" : "hover:bg-canvas"
        }`}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              const next = new Set(open);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              setOpen(next);
            }}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${item.label}`}
            className="w-3 shrink-0 text-[9px] text-ink-faint hover:text-ink"
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {scoped && onScope ? (
          <input
            type="checkbox"
            checked={included}
            ref={(el) => {
              if (el) el.indeterminate = partial;
            }}
            onChange={() => onScope(ids, !included)}
            aria-label={`Show only ${item.label}`}
            className="shrink-0"
          />
        ) : null}

        <button
          type="button"
          onClick={() => onSelect?.(item.id)}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
        >
          {item.tone ? (
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[item.tone]}`} />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-line" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{item.label}</span>
          {item.count != null ? (
            <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{item.count}</span>
          ) : null}
          {item.value ? (
            <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-ink-muted">
              {item.value}
            </span>
          ) : null}
        </button>
      </div>

      {item.hint && selected ? (
        <p
          className="pb-1 pr-2 text-[10px] leading-snug text-ink-faint"
          style={{ paddingLeft: 20 + depth * 12 }}
        >
          {item.hint}
        </p>
      ) : null}

      {isOpen
        ? kids.map((c) => (
            <Row
              key={c.id}
              item={c}
              depth={depth + 1}
              open={open}
              setOpen={setOpen}
              selectedId={selectedId}
              onSelect={onSelect}
              scoped={scoped}
              onScope={onScope}
              matches={matches}
              filtering={filtering}
            />
          ))
        : null}
    </>
  );
}
