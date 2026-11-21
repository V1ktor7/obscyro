"use client";

import { Activity, BellRing, ChevronRight, LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { TwinAlertSeverity, TwinUnitNode } from "@/lib/platform-api";

import { StatusChip } from "../StatusChip";
import {
  ancestorsOf,
  bandLabel,
  barScale,
  barShare,
  buildRows,
  comparator,
  countUnits,
  formatMeasure,
  hasHierarchy,
  heatLegend,
  heatOf,
  kindsOf,
  matches,
  sections,
  sharedRule,
  treeLines,
  type BarScale,
  type Heat,
  type Measure,
  type RuleLike,
  type SharedRule,
  type UnitFilter,
  type UnitRow,
  type UnitSort,
} from "./units-list";

// ---------------------------------------------------------------------------
// The Units page: counters that filter, a ranked list, the selected unit's
// sheet beside it.
//
// It replaces a column of cards. Four hundred units made a page thirty thousand
// pixels tall, in no order, with names cut after fourteen characters, and a
// detail window that covered everything. Here the units in alert come first,
// a name has the width of the page, the units that report nothing for the
// measure are folded away, and the sheet stays next to the list so that
// clicking from one unit to the next compares them.
//
// This component holds what the person is looking at (filter, search, order,
// view, what is folded) and nothing about where the data comes from.
// ---------------------------------------------------------------------------

export type StreamMode = "stream" | "poll" | "idle";

export interface UnitsBoardProps {
  /** Null until the first reading arrives. */
  nodes: TwinUnitNode[] | null;
  measure: Measure;
  measures: Measure[];
  rules: RuleLike[];
  /** The kind of unit kept, when the person narrowed the list to one. */
  kind: string | null;
  selectedId: string | null;
  /** A unit named by the address: its line is brought on screen once. */
  revealId?: string | null;
  stream: StreamMode;
  onMeasure: (key: string) => void;
  onKind: (kind: string | null) => void;
  onSelect: (id: string) => void;
  onEditMeasures: () => void;
  onEditThresholds: () => void;
  onLiveMetrics: () => void;
  /** Offered only on a project with no unit. */
  onSeed?: () => void;
  seeding?: boolean;
  /** The sheet of the selected unit, as the list reads it, on the list's scale. */
  sheet: (unit: UnitRow | null, scale: BarScale | null) => ReactNode;
}

const FIELD =
  "h-8 min-w-0 max-w-full border-0 border-b border-line-strong bg-surface px-2.5 text-[12.5px] text-ink placeholder:text-ink-ghost";
const QUIET_BUTTON =
  "inline-flex h-8 items-center gap-2 whitespace-nowrap border border-line-strong px-3 text-[12.5px] text-ink hover:bg-surface-hover";
/** The mark of the line being read: the same blue edge as the page the rail is on. */
const HERE = "shadow-[inset_3px_0_0_rgb(var(--s-brand-edge))]";
const ROW_GRID =
  "grid-cols-[10px_minmax(0,1fr)_64px] sm:grid-cols-[10px_minmax(0,1fr)_110px_64px_116px] xl:grid-cols-[10px_minmax(0,1fr)_190px_64px_116px]";

const CHIPS: { filter: UnitFilter; label: string }[] = [
  { filter: "all", label: "All units" },
  { filter: "alert", label: "In alert" },
  { filter: "reporting", label: "Reporting, no alert" },
  { filter: "silent", label: "No value" },
];

const rowDomId = (id: string) => `unit-row-${id}`;

export default function UnitsBoard({
  nodes,
  measure,
  measures,
  rules,
  kind,
  selectedId,
  revealId,
  stream,
  onMeasure,
  onKind,
  onSelect,
  onEditMeasures,
  onEditThresholds,
  onLiveMetrics,
  onSeed,
  seeding,
  sheet,
}: UnitsBoardProps) {
  const [filter, setFilter] = useState<UnitFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<UnitSort>("high");
  const [view, setView] = useState<"list" | "tiles">("list");
  const [silentOpen, setSilentOpen] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const kinds = useMemo(() => kindsOf(nodes ?? []), [nodes]);
  // A kind kept from another project, or from before the twin changed, filters nothing.
  const activeKind = kind && kinds.includes(kind) ? kind : null;

  const allRows = useMemo(() => buildRows(nodes ?? [], measure, rules), [nodes, measure, rules]);
  const rows = useMemo(
    () => (activeKind ? buildRows((nodes ?? []).filter((n) => n.kind === activeKind), measure, rules) : allRows),
    [activeKind, allRows, nodes, measure, rules],
  );

  const counts = useMemo(() => countUnits(rows), [rows]);
  const scale = useMemo(() => barScale(rows), [rows]);
  const shared = useMemo(() => sharedRule(rows), [rows]);
  const tree = useMemo(() => hasHierarchy(rows), [rows]);
  const selected = useMemo(() => allRows.find((r) => r.id === selectedId) ?? null, [allRows, selectedId]);

  // An alert or a signal links here with its unit: unfold what hides its line, once.
  const revealed = useRef<string | null>(null);
  const [toShow, setToShow] = useState<string | null>(null);
  const tries = useRef(0);
  useEffect(() => {
    if (!revealId || revealed.current === revealId) return;
    const row = rows.find((r) => r.id === revealId);
    if (!row) return;
    revealed.current = revealId;
    if (tree) {
      const path = ancestorsOf(rows, revealId);
      setOpen((prev) => {
        const next = new Set(prev);
        for (const id of path) next.add(id);
        return next;
      });
    } else if (row.status === "silent") {
      setSilentOpen(true);
    }
    tries.current = 0;
    setToShow(revealId);
  }, [revealId, rows, tree]);

  // Its line exists only once the unfolding above has been drawn, so the scroll waits for it: after each
  // drawing, until the line is there. It gives up after a few, for a unit the filter or the view leaves out.
  useEffect(() => {
    if (!toShow) return;
    const line = document.getElementById(rowDomId(toShow));
    if (line) line.scrollIntoView?.({ block: "center" });
    tries.current += 1;
    if (line || tries.current >= 8) setToShow(null);
  });

  const pick = (row: UnitRow, foldable: boolean) => {
    if (foldable) {
      setOpen((prev) => {
        const next = new Set(prev);
        // A second click on the unit being read folds it back.
        if (next.has(row.id) && selectedId === row.id) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
    }
    onSelect(row.id);
  };

  const scaleNote = scale
    ? `bar: ${formatMeasure(scale.min, measure)} to ${formatMeasure(scale.max, measure)}${
        shared.kind === "one"
          ? ` · tick at the threshold, ${formatMeasure(shared.rule.threshold, measure)}`
          : shared.kind === "mixed"
            ? " · tick at each unit's threshold"
            : " · no alert threshold on this measure"
      }`
    : "";

  let body: ReactNode;
  if (nodes === null) {
    body = <p className="px-4 py-8 text-ink-muted sm:px-6">Reading the units…</p>;
  } else if (nodes.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-3 px-4 py-8 sm:px-6">
        <p className="max-w-[60ch] text-ink-muted">
          This project has no unit yet. Units come from the ontology: an object type marked as a unit, and the links
          that say what each one contains.
        </p>
        {onSeed ? (
          <button type="button" className={QUIET_BUTTON} onClick={onSeed} disabled={seeding}>
            {seeding ? "Seeding…" : "Seed demo"}
          </button>
        ) : null}
      </div>
    );
  } else if (view === "tiles") {
    body = (
      <Tiles
        rows={rows}
        filter={filter}
        query={query}
        sort={sort}
        shared={shared}
        measure={measure}
        selectedId={selectedId}
        onPick={(row) => onSelect(row.id)}
      />
    );
  } else if (tree && filter === "all") {
    body = (
      <TreeList
        rows={rows}
        query={query}
        sort={sort}
        open={open}
        scale={scale}
        selectedId={selectedId}
        onPick={pick}
      />
    );
  } else {
    body = (
      <FlatList
        rows={rows}
        filter={filter}
        query={query}
        sort={sort}
        scale={scale}
        scaleNote={scaleNote}
        shared={shared}
        measure={measure}
        silentOpen={silentOpen}
        onSilent={() => setSilentOpen((v) => !v)}
        selectedId={selectedId}
        onPick={(row) => pick(row, false)}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas text-[13px] text-ink">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 sm:px-6">
        <label className="flex min-w-0 items-center gap-2 text-xs text-ink-faint">
          Measure
          <select className={FIELD} value={measure.key} onChange={(e) => onMeasure(e.target.value)}>
            {measures.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Filter the units" className="flex flex-wrap gap-1.5">
          {CHIPS.map((chip) => {
            const on = filter === chip.filter;
            const alarm = chip.filter === "alert" && counts.alert > 0;
            return (
              <button
                key={chip.filter}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(chip.filter)}
                className={cn(
                  "inline-flex h-8 items-center whitespace-nowrap border px-3 text-[12.5px]",
                  on
                    ? alarm
                      ? "border-danger bg-danger text-inverse"
                      : "border-ink bg-ink text-inverse"
                    : "border-line-strong text-ink-muted hover:bg-surface-hover",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <b
                    className={cn(
                      "text-[15px] font-semibold tabular-nums",
                      on ? "text-inverse" : alarm ? "text-danger" : "text-ink",
                    )}
                  >
                    {counts[chip.filter]}
                  </b>
                  {chip.label}
                </span>
              </button>
            );
          })}
        </div>
        <StatusChip
          className="ml-auto"
          tone={stream === "stream" ? "ok" : stream === "poll" ? "warn" : "neutral"}
          dot={stream === "stream" ? "bg-ok" : stream === "poll" ? "bg-warn" : "bg-ink-ghost"}
          title={
            stream === "stream"
              ? "The list follows the twin as it changes."
              : stream === "poll"
                ? "The live stream is not available: the list is read again every five seconds."
                : undefined
          }
        >
          {stream === "stream" ? "Live stream" : stream === "poll" ? "Polling" : "Connecting"}
        </StatusChip>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 sm:px-6">
        <label className="sr-only" htmlFor="units-find">
          Find a unit
        </label>
        <input
          id="units-find"
          type="search"
          autoComplete="off"
          placeholder="Find a unit by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cn(FIELD, "w-full sm:w-60")}
        />
        <label className="flex items-center gap-2 text-xs text-ink-faint">
          Sort
          <select className={FIELD} value={sort} onChange={(e) => setSort(e.target.value as UnitSort)}>
            <option value="high">Highest first</option>
            <option value="low">Lowest first</option>
            <option value="name">Name, A to Z</option>
          </select>
        </label>
        {kinds.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-ink-faint">
            Kind
            <select className={FIELD} value={activeKind ?? ""} onChange={(e) => onKind(e.target.value || null)}>
              <option value="">All kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div role="group" aria-label="View" className="inline-flex border border-line-strong">
          <ViewButton on={view === "list"} onClick={() => setView("list")}>
            <List className="h-3.5 w-3.5" aria-hidden="true" />
            List
          </ViewButton>
          <ViewButton on={view === "tiles"} onClick={() => setView("tiles")} divided>
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Tiles
          </ViewButton>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <button type="button" className={QUIET_BUTTON} onClick={onEditMeasures} title="Define what the twin measures">
            <SlidersHorizontal className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
            Measures
          </button>
          <button
            type="button"
            className={QUIET_BUTTON}
            onClick={onEditThresholds}
            title="Set the thresholds that raise an alert"
          >
            <BellRing className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
            Alert thresholds
          </button>
          <button type="button" className={QUIET_BUTTON} onClick={onLiveMetrics} title="Counts and scores, as they stream">
            <Activity className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
            Live metrics
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1">
        <section aria-label="Units" className="min-h-0 min-w-0 overflow-y-auto">
          {body}
        </section>
        <aside
          aria-label="Selected unit"
          className="max-h-[46vh] min-h-0 overflow-y-auto border-t border-line bg-surface lg:max-h-none lg:border-l lg:border-t-0"
        >
          {sheet(selected, scale)}
        </aside>
      </div>
    </div>
  );
}

function ViewButton({
  on,
  divided,
  onClick,
  children,
}: {
  on: boolean;
  divided?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 px-3 text-[12.5px]",
        divided && "border-l border-line-strong",
        on ? "bg-canvas-raised font-semibold text-ink" : "text-ink-muted hover:bg-surface-hover",
      )}
    >
      {children}
    </button>
  );
}

// --- The list ---------------------------------------------------------------

function SectionHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h3 className="sticky top-0 z-[1] m-0 flex min-h-8 items-center gap-2.5 border-b border-line bg-canvas px-4 py-1 text-[11px] font-normal uppercase tracking-[0.06em] text-ink-faint sm:pl-6">
      <span>{children}</span>
      {aside ? <span className="ml-auto normal-case tracking-normal">{aside}</span> : null}
    </h3>
  );
}

const Count = ({ n }: { n: number }) => <b className="font-semibold tabular-nums text-ink">{n}</b>;

const DOT: Record<UnitRow["band"], string> = {
  over: "bg-danger",
  near: "bg-warn",
  calm: "bg-ok",
  // Reports, and nobody set a threshold: neither good nor bad.
  unbanded: "bg-ink-muted",
  absent: "bg-ink-ghost",
};

const FILL: Record<UnitRow["band"], string> = {
  over: "bg-danger",
  near: "bg-warn",
  calm: "bg-ink-faint",
  unbanded: "bg-ink-faint",
  absent: "",
};

/** A value against the list's scale, with a tick where the unit's alert would fire. */
export function Bar({ row, scale, className }: { row: UnitRow; scale: BarScale | null; className?: string }) {
  return (
    <span className={cn("relative block h-1.5 bg-line-strong", className)} aria-hidden="true">
      {row.value !== null && scale ? (
        <>
          <span className={cn("block h-full", FILL[row.band])} style={{ width: `${barShare(row.value, scale)}%` }} />
          {row.rule ? (
            <span
              className="absolute -bottom-[3px] -top-[3px] w-px bg-ink"
              style={{ left: `${barShare(row.rule.threshold, scale)}%` }}
            />
          ) : null}
        </>
      ) : null}
    </span>
  );
}

const FLAG: Record<TwinAlertSeverity, string> = {
  critical: "bg-danger-soft text-danger-ink",
  warn: "bg-warn-soft text-warn-ink",
  info: "bg-canvas-raised text-ink-muted",
};

function Flag({ row, below }: { row: UnitRow; below: boolean }) {
  if (row.alerts > 0) {
    return (
      <span
        className={cn(
          "inline-flex h-5 items-center justify-self-start whitespace-nowrap rounded-full px-2 text-[11px] font-semibold",
          FLAG[row.severity ?? "critical"],
        )}
      >
        {row.alerts} {row.severity ?? "open"}
      </span>
    );
  }
  // A folded branch says what it is hiding.
  if (below && row.alertsBelow > 0) {
    return (
      <span
        className="inline-flex h-5 items-center justify-self-start whitespace-nowrap rounded-full bg-canvas-raised px-2 text-[11px] font-semibold text-danger-ink"
        title={`${row.alertsBelow} of the units under it have an open alert`}
      >
        {row.alertsBelow} in alert below
      </span>
    );
  }
  return <span />;
}

function Row({
  row,
  scale,
  selected,
  depth = 0,
  foldable = false,
  open = false,
  onPick,
}: {
  row: UnitRow;
  scale: BarScale | null;
  selected: boolean;
  depth?: number;
  /** In the hierarchy, a unit with units under it folds and unfolds on a click. */
  foldable?: boolean;
  open?: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        id={rowDomId(row.id)}
        aria-current={selected ? "true" : undefined}
        aria-expanded={foldable ? open : undefined}
        onClick={onPick}
        className={cn(
          "grid min-h-9 w-full items-center gap-3 border-b border-line-faint px-4 py-1.5 text-left sm:pl-6",
          ROW_GRID,
          selected ? cn("bg-surface", HERE) : "hover:bg-surface",
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", DOT[row.band])} aria-hidden="true" />
        <span className="flex min-w-0 items-baseline gap-2" style={depth ? { paddingLeft: depth * 26 } : undefined}>
          {foldable ? (
            <ChevronRight
              className={cn("h-3.5 w-3.5 shrink-0 self-center text-ink-faint transition-transform motion-reduce:transition-none", open && "rotate-90")}
              aria-hidden="true"
            />
          ) : null}
          {/* Never cut: a name wraps onto a second line before it loses its end. */}
          <span className="min-w-0 break-words text-[12.5px] leading-snug text-ink">{row.name}</span>
          <span className="shrink-0 text-[11px] text-ink-faint">
            {row.kind}
            {row.children > 0 ? ` · ${row.children} under it` : ""}
          </span>
        </span>
        <Bar row={row} scale={scale} className="hidden sm:block" />
        <span
          className={cn(
            "whitespace-nowrap text-right tabular-nums",
            row.value === null ? "text-[12px] text-ink-ghost" : "text-[13px] font-semibold text-ink",
          )}
        >
          {row.text}
        </span>
        <span className="hidden sm:block">
          <Flag row={row} below={foldable && !open} />
        </span>
      </button>
    </li>
  );
}

const EMPTY_FILTER: Record<UnitFilter, string> = {
  all: "No unit to show.",
  alert: "No unit has an open alert.",
  reporting: "No unit reports this measure without an alert.",
  silent: "Every unit has a value for this measure, or an open alert.",
};

function FlatList({
  rows,
  filter,
  query,
  sort,
  scale,
  scaleNote,
  shared,
  measure,
  silentOpen,
  onSilent,
  selectedId,
  onPick,
}: {
  rows: UnitRow[];
  filter: UnitFilter;
  query: string;
  sort: UnitSort;
  scale: BarScale | null;
  scaleNote: string;
  shared: SharedRule;
  measure: Measure;
  silentOpen: boolean;
  onSilent: () => void;
  selectedId: string | null;
  onPick: (row: UnitRow) => void;
}) {
  const groups = useMemo(() => sections(rows, { filter, query, sort }), [rows, filter, query, sort]);
  const searching = query.trim() !== "";

  if (groups.alert.length + groups.reporting.length + groups.silent.length === 0) {
    return (
      <p className="px-4 py-8 text-ink-muted sm:px-6">
        {searching ? `No unit matches “${query.trim()}”.` : EMPTY_FILTER[filter]}
      </p>
    );
  }

  // Every unit in alert is over the threshold of the measure shown: say so. An
  // alert raised by another measure leaves the line without that claim.
  const pastWords =
    shared.kind === "one" && groups.alert.length > 0 && groups.alert.every((r) => r.band === "over")
      ? bandLabel("over", shared.rule).toLowerCase()
      : null;
  const note = <span className="hidden sm:inline">{scaleNote}</span>;
  // A search that finds one of them opens the group: a match must not stay folded away.
  const showSilent = silentOpen || filter === "silent" || searching;
  const list = (items: UnitRow[]) => (
    <ul className="m-0 list-none p-0">
      {items.map((row) => (
        <Row key={row.id} row={row} scale={scale} selected={row.id === selectedId} onPick={() => onPick(row)} />
      ))}
    </ul>
  );

  return (
    <>
      {groups.alert.length > 0 ? (
        <>
          <SectionHead aside={note}>
            <Count n={groups.alert.length} /> in alert
            {pastWords ? ` · ${pastWords}` : ""}
          </SectionHead>
          {list(groups.alert)}
        </>
      ) : null}
      {groups.reporting.length > 0 ? (
        <>
          <SectionHead aside={groups.alert.length === 0 ? note : undefined}>
            <Count n={groups.reporting.length} /> reporting, no alert
          </SectionHead>
          {list(groups.reporting)}
        </>
      ) : null}
      {groups.silent.length > 0 ? (
        <>
          <SectionHead
            aside={
              filter === "silent" ? undefined : (
                <button
                  type="button"
                  aria-expanded={showSilent}
                  onClick={onSilent}
                  disabled={searching}
                  className="h-6 border border-line-strong px-2 text-[12px] text-ink hover:bg-surface-hover disabled:opacity-50"
                >
                  {showSilent ? "Hide" : "Show"}
                </button>
              )
            }
          >
            <Count n={groups.silent.length} /> with no value for this measure
          </SectionHead>
          {showSilent ? (
            <>
              <p className="m-0 max-w-[70ch] px-4 py-3 text-xs text-ink-faint sm:px-6">
                These units report nothing for “{measure.label}”. That is not a zero: they may report another measure.
                Change the measure above to see them ranked.
              </p>
              {list(groups.silent)}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function TreeList({
  rows,
  query,
  sort,
  open,
  scale,
  selectedId,
  onPick,
}: {
  rows: UnitRow[];
  query: string;
  sort: UnitSort;
  open: ReadonlySet<string>;
  scale: BarScale | null;
  selectedId: string | null;
  onPick: (row: UnitRow, foldable: boolean) => void;
}) {
  const lines = useMemo(() => treeLines(rows, { query, sort, open }), [rows, query, sort, open]);
  const top = rows.filter((r) => r.parentId === null).length;

  if (lines.length === 0) {
    return (
      <p className="px-4 py-8 text-ink-muted sm:px-6">
        {query.trim() ? `No unit matches “${query.trim()}”.` : EMPTY_FILTER.all}
      </p>
    );
  }

  return (
    <>
      <SectionHead aside={<span className="hidden sm:inline">a unit&apos;s value counts everything under it</span>}>
        <Count n={top} /> at the top · <Count n={rows.length - top} /> under them
      </SectionHead>
      <ul className="m-0 list-none p-0">
        {lines.map(({ row, depth, open: isOpen }) => (
          <Row
            key={row.id}
            row={row}
            scale={scale}
            depth={depth}
            foldable={row.children > 0}
            open={isOpen}
            selected={row.id === selectedId}
            onPick={() => onPick(row, row.children > 0)}
          />
        ))}
      </ul>
      <p className="m-0 max-w-[70ch] px-4 py-3 text-xs text-ink-faint sm:px-6">
        A click on a unit unfolds what is under it; a second click folds it back. The counters above list the units
        without the hierarchy.
      </p>
    </>
  );
}

// --- The tiles --------------------------------------------------------------

const HEAT: Record<Heat, string> = {
  over3: "bg-danger text-inverse",
  over2: "bg-danger/60 text-ink",
  over1: "bg-danger/30 text-danger-ink",
  near: "bg-warn-soft text-warn-ink",
  calm: "bg-surface text-ink-muted",
  plain: "bg-surface text-ink-muted",
};

function Tiles({
  rows,
  filter,
  query,
  sort,
  shared,
  measure,
  selectedId,
  onPick,
}: {
  rows: UnitRow[];
  filter: UnitFilter;
  query: string;
  sort: UnitSort;
  shared: SharedRule;
  measure: Measure;
  selectedId: string | null;
  onPick: (row: UnitRow) => void;
}) {
  const kept = useMemo(
    () => rows.filter((r) => (filter === "all" || r.status === filter) && matches(r, query)),
    [rows, filter, query],
  );
  const drawn = useMemo(() => kept.filter((r) => r.value !== null).sort(comparator(sort)), [kept, sort]);
  const legend = useMemo(() => heatLegend(shared, measure), [shared, measure]);
  const left = kept.length - drawn.length;

  if (drawn.length === 0) {
    return (
      <p className="max-w-[70ch] px-4 py-8 text-ink-muted sm:px-6">
        {left > 0
          ? `A tile shows a value, and ${left === 1 ? "the unit" : `the ${left} units`} here ${left === 1 ? "has" : "have"} none for this measure. The list shows them.`
          : query.trim()
            ? `No unit matches “${query.trim()}”.`
            : EMPTY_FILTER[filter]}
      </p>
    );
  }

  return (
    <>
      <SectionHead aside={<span className="hidden sm:inline">select a tile to read its unit</span>}>
        <Count n={drawn.length} /> {drawn.length === 1 ? "unit" : "units"} with a value · one tile each
      </SectionHead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-[3px] px-4 pb-1.5 pt-3.5 sm:pl-6">
        {drawn.map((row) => (
          <button
            key={row.id}
            type="button"
            title={`${row.name} · ${row.text}`}
            aria-label={`${row.name}, ${row.text}`}
            aria-current={row.id === selectedId ? "true" : undefined}
            onClick={() => onPick(row)}
            className={cn(
              "h-11 overflow-hidden px-0.5 text-[12.5px] font-semibold tabular-nums",
              HEAT[heatOf(row)],
              row.id === selectedId
                ? "outline outline-2 -outline-offset-2 outline-ink"
                : "hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-ink-muted",
            )}
          >
            {row.text}
          </button>
        ))}
      </div>
      {legend.length > 0 ? (
        <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 px-4 pb-1 pt-2 text-xs text-ink-faint sm:pl-6">
          {legend.map((step) => (
            <span key={step.heat} className="inline-flex items-center gap-1.5">
              <i className={cn("h-3 w-3 border border-line-strong", HEAT[step.heat])} aria-hidden="true" />
              {step.label}
            </span>
          ))}
        </div>
      ) : null}
      <p className="m-0 max-w-[70ch] px-4 pb-3.5 pt-2 text-xs text-ink-faint sm:px-6">
        {legend.length === 0 ? "No alert threshold is set on this measure, so the tiles carry no colour. " : ""}
        {left > 0
          ? `${left} ${left === 1 ? "unit" : "units"} with no value for this measure ${left === 1 ? "is" : "are"} not drawn.`
          : "Every unit kept by the filter is drawn."}
      </p>
    </>
  );
}
