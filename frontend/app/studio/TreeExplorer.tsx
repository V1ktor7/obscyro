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

import { Eye, EyeOff } from "lucide-react";

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
   * Ids the view is *not* showing. Undefined means visibility is not on offer
   * and the controls disappear rather than being shown doing nothing.
   *
   * A deny-list, not an allow-list, and the difference is the whole reason this
   * changed: with an allow-list, "hide this one site" is impossible from the
   * default state — there is no list yet to remove it from, so the first click
   * does nothing. Starting from "everything is visible" makes hiding one thing
   * one click, which is what it should have been.
   */
  hidden?: Set<string>;
  onToggleHidden?: (ids: string[], hide: boolean) => void;
  /**
   * Show this subtree and nothing else. The counterpart gesture: hiding fifty
   * establishments one at a time to look at the fifty-first is not a workflow.
   */
  onSolo?: (ids: string[]) => void;
  emptyLabel?: string;
}

export default function TreeExplorer({
  items,
  selectedId = null,
  onSelect,
  hidden,
  onToggleHidden,
  onSolo,
  emptyLabel = "Nothing here yet.",
}: TreeExplorerProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const matches = useMemo(() => matchingIds(items, query), [items, query]);
  const filtering = query.trim().length > 0;

  const total = useMemo(() => items.reduce((n, i) => n + subtreeIds(i).length, 0), [items]);

  return (
    // No width, no border of its own: a component that sizes itself cannot be
    // put inside a panel, which is exactly what was asked of this one.
    <div className="flex min-h-0 flex-1 flex-col">
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
              hidden={hidden}
              onToggleHidden={onToggleHidden}
              onSolo={onSolo}
              matches={matches}
              filtering={filtering}
            />
          ))
        )}
      </div>

      {hidden && hidden.size > 0 && onToggleHidden ? (
        // A hidden thing you have forgotten you hid is a map you will misread.
        <button
          type="button"
          onClick={() => onToggleHidden(Array.from(hidden), false)}
          className="shrink-0 border-t border-line px-3 py-1.5 text-left text-[10px] text-ink-muted hover:text-brand"
        >
          {hidden.size} hidden — show everything
        </button>
      ) : null}
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
  hidden,
  onToggleHidden,
  onSolo,
  matches,
  filtering,
}: {
  item: TreeItem;
  depth: number;
  open: Set<string>;
  setOpen: (s: Set<string>) => void;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  hidden?: Set<string>;
  onToggleHidden?: (ids: string[], hide: boolean) => void;
  onSolo?: (ids: string[]) => void;
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
  // Visible when nothing under it is hidden; partly visible when only some is.
  const allHidden = hidden ? ids.every((id) => hidden.has(id)) : false;
  const someHidden = hidden ? !allHidden && ids.some((id) => hidden.has(id)) : false;

  return (
    <>
      <div
        className={`group flex items-center gap-1 px-1 py-0.5 ${
          selected ? "bg-brand-soft" : "hover:bg-canvas"
        } ${allHidden ? "opacity-45" : ""}`}
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

        {hidden && onToggleHidden ? (
          <button
            type="button"
            onClick={() => onToggleHidden(ids, !allHidden)}
            aria-label={`${allHidden ? "Show" : "Hide"} ${item.label}`}
            title={allHidden ? "Show" : "Hide"}
            className="shrink-0 rounded px-0.5 text-[#8f99a8] hover:text-ink"
          >
            {allHidden ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className={`h-3 w-3 ${someHidden ? "opacity-50" : ""}`} />
            )}
          </button>
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

        {onSolo ? (
          // "Show this and nothing else" — the gesture the eye cannot express.
          // Hiding fifty establishments one at a time to look at the fifty-first
          // is not a workflow. Appears on hover so a 241-row tree is not a wall
          // of buttons.
          <button
            type="button"
            onClick={() => onSolo(ids)}
            aria-label={`Show only ${item.label}`}
            title="Show only this"
            className="shrink-0 rounded px-1 text-[9px] uppercase tracking-wide text-[#8f99a8] opacity-0 hover:text-brand focus:opacity-100 group-hover:opacity-100"
          >
            only
          </button>
        ) : null}
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
              hidden={hidden}
              onToggleHidden={onToggleHidden}
              onSolo={onSolo}
              matches={matches}
              filtering={filtering}
            />
          ))
        : null}
    </>
  );
}
