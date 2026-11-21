import type { TwinAlertOp, TwinAlertSeverity, TwinMetricUnit, TwinUnitNode } from "@/lib/platform-api";

import { bandFor, ruleForMetric, type BandRule, type MetricBand } from "../command/site-metric";
import { formatMetricValue, twinMetricNumber } from "../twin-ui";

// ---------------------------------------------------------------------------
// The Units page, as a list.
//
// The page used to draw every unit as a card in one column, in the order the
// twin returned them: four hundred cards, thirty thousand pixels, and the unit
// over its threshold somewhere in the middle. Everything here answers one
// question — which unit should be read first — and none of it draws anything:
// the screen asks these functions what to show.
//
// Three things are never mixed. A unit with an open alert, a unit that reports
// a value and has no alert, and a unit that reports nothing for the measure
// chosen. The third is not a zero and is never ranked as one.
// ---------------------------------------------------------------------------

/** What the page is ranking the units on. */
export interface Measure {
  key: string;
  label: string;
  unit?: TwinMetricUnit;
}

/** The part of an alert rule the list needs. */
export interface RuleLike {
  metric: string;
  op: TwinAlertOp;
  threshold: number;
  unitKind?: string | null;
}

export type UnitStatus = "alert" | "reporting" | "silent";
export type UnitFilter = "all" | UnitStatus;
export type UnitSort = "high" | "low" | "name";

export interface UnitRow {
  id: string;
  name: string;
  kind: string;
  code: string;
  /** Its parent, when that parent is in the list too. */
  parentId: string | null;
  /** The measure's number for this unit, with everything under it; null when it carries none. */
  value: number | null;
  /** That number as a reader would write it. */
  text: string;
  /** The rule that watches this measure on a unit of this kind, when there is one. */
  rule: BandRule | null;
  band: MetricBand;
  /** Open alerts on this unit itself, whatever measure raised them. */
  alerts: number;
  severity: TwinAlertSeverity | null;
  status: UnitStatus;
  /** Units directly under it. */
  children: number;
  /** Units anywhere under it that have an open alert: a folded branch must not hide one. */
  alertsBelow: number;
}

export const NO_VALUE = "no value";

/** A number of this measure, written with its unit. Used for values and for thresholds alike. */
export function formatMeasure(value: number | null, measure: Measure): string {
  if (value === null) return NO_VALUE;
  if (measure.unit) return formatMetricValue(value, measure.unit);
  if (measure.key === "occupancyPct") return `${Math.round(value)}%`;
  if (measure.key === "freshnessSeconds") {
    if (value < 60) return `${Math.round(value)}s`;
    if (value < 3600) return `${Math.round(value / 60)}m`;
    return `${Math.round(value / 3600)}h`;
  }
  if (measure.key === "linkedInstanceCount" || measure.key.startsWith("count:")) return String(Math.round(value));
  return value.toFixed(1);
}

/**
 * The rule that watches a measure on a unit of one kind.
 *
 * A rule can be written for one kind of unit only. The list follows the rule
 * the alert engine would apply to that unit, so a row is red exactly when its
 * alert would fire.
 */
export function ruleForUnit(rules: RuleLike[], metric: string, kind: string): BandRule | null {
  return ruleForMetric(
    rules.filter((r) => !r.unitKind || r.unitKind === kind),
    metric,
  );
}

export function buildRows(nodes: TwinUnitNode[], measure: Measure, rules: RuleLike[]): UnitRow[] {
  const ids = new Set(nodes.map((n) => n.id));
  const childrenOf = new Map<string, TwinUnitNode[]>();
  for (const n of nodes) {
    if (!n.parentId || !ids.has(n.parentId) || n.parentId === n.id) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }

  // Counted once per unit, with a guard: a twin whose links loop must not hang the page.
  const below = new Map<string, number>();
  const alertsBelow = (id: string, seen: Set<string>): number => {
    const known = below.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    let total = 0;
    for (const child of childrenOf.get(id) ?? []) {
      total += (child.openAlertCount > 0 ? 1 : 0) + alertsBelow(child.id, seen);
    }
    below.set(id, total);
    return total;
  };

  return nodes.map((n) => {
    const value = twinMetricNumber(n.metrics, measure.key);
    const rule = ruleForUnit(rules, measure.key, n.kind);
    const alerts = n.openAlertCount ?? 0;
    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      code: n.code ?? "",
      parentId: n.parentId && ids.has(n.parentId) && n.parentId !== n.id ? n.parentId : null,
      value,
      text: formatMeasure(value, measure),
      rule,
      band: bandFor(value, rule),
      alerts,
      severity: n.worstAlertSeverity ?? null,
      status: alerts > 0 ? "alert" : value !== null ? "reporting" : "silent",
      children: childrenOf.get(n.id)?.length ?? 0,
      alertsBelow: alertsBelow(n.id, new Set()),
    };
  });
}

/** The counters above the list. The three states add up to `all`: every unit is in exactly one. */
export function countUnits(rows: UnitRow[]): Record<UnitFilter, number> {
  const counts: Record<UnitFilter, number> = { all: rows.length, alert: 0, reporting: 0, silent: 0 };
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

/** Lower case, accents dropped: "hopital" has to find "HÔPITAL". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matches(row: UnitRow, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return fold(row.name).includes(q) || fold(row.code).includes(q);
}

const byName = (a: UnitRow, b: UnitRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** A unit with no value goes last in both directions: it is not the lowest, it is unknown. */
export function comparator(sort: UnitSort): (a: UnitRow, b: UnitRow) => number {
  if (sort === "name") return byName;
  const direction = sort === "high" ? -1 : 1;
  return (a, b) => {
    if (a.value === null || b.value === null) {
      if (a.value === null && b.value === null) return byName(a, b);
      return a.value === null ? 1 : -1;
    }
    return a.value === b.value ? byName(a, b) : direction * (a.value - b.value);
  };
}

export interface Sections {
  alert: UnitRow[];
  reporting: UnitRow[];
  silent: UnitRow[];
}

/** The list, in its three groups. A group the filter leaves out comes back empty. */
export function sections(rows: UnitRow[], view: { filter: UnitFilter; query: string; sort: UnitSort }): Sections {
  const keep = (status: UnitStatus) =>
    view.filter === "all" || view.filter === status
      ? rows.filter((r) => r.status === status && matches(r, view.query))
      : [];
  const order = comparator(view.sort);
  return {
    alert: keep("alert").sort(order),
    reporting: keep("reporting").sort(order),
    // Nothing to rank them on.
    silent: keep("silent").sort(byName),
  };
}

export function hasHierarchy(rows: UnitRow[]): boolean {
  return rows.some((r) => r.parentId !== null);
}

export interface TreeLine {
  row: UnitRow;
  depth: number;
  open: boolean;
}

/**
 * The hierarchy as lines, folded.
 *
 * Siblings are ranked like the flat list. A search opens the branches that
 * lead to a match and hides the rest, so a site is found without knowing which
 * establishment holds it.
 */
export function treeLines(
  rows: UnitRow[],
  view: { query: string; sort: UnitSort; open: ReadonlySet<string> },
): TreeLine[] {
  const order = comparator(view.sort);
  const childrenOf = new Map<string | null, UnitRow[]>();
  for (const r of rows) {
    const list = childrenOf.get(r.parentId);
    if (list) list.push(r);
    else childrenOf.set(r.parentId, [r]);
  }

  const searching = view.query.trim() !== "";
  const kept = new Set<string>();
  if (searching) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      if (!matches(r, view.query)) continue;
      // The match, and the path that leads to it.
      for (let cur: UnitRow | undefined = r, guard = 0; cur && guard < 64; guard += 1) {
        if (kept.has(cur.id)) break;
        kept.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
  }

  const lines: TreeLine[] = [];
  const walk = (parent: string | null, depth: number) => {
    if (depth > 64) return;
    const level = [...(childrenOf.get(parent) ?? [])].sort(order);
    for (const row of level) {
      if (searching && !kept.has(row.id)) continue;
      const children = childrenOf.get(row.id) ?? [];
      const open = searching ? children.some((c) => kept.has(c.id)) : view.open.has(row.id) && children.length > 0;
      lines.push({ row, depth, open });
      if (open) walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines;
}

/** The units a linked unit sits under, nearest last: the branches to open so its line is on screen. */
export function ancestorsOf(rows: UnitRow[], id: string): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: string[] = [];
  let cur = byId.get(id);
  for (let guard = 0; cur?.parentId && guard < 64; guard += 1) {
    path.unshift(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return path;
}

// --- The bar ----------------------------------------------------------------

export interface BarScale {
  min: number;
  max: number;
}

/** Rounded up to two figures, so the end of the bar is a number one can say: 239 becomes 240. */
function niceCeil(n: number): number {
  if (n <= 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Number((Math.ceil(n / step - 1e-9) * step).toPrecision(12));
}

/**
 * One scale for every bar of the list.
 *
 * Shared, and taken over all the units whatever the filter or the search: two
 * bars compare only on the same scale, and a bar must not grow because a
 * search hid the unit above it. The thresholds are inside it, so their tick is
 * always on the track.
 */
export function barScale(rows: UnitRow[]): BarScale | null {
  const valued = rows.filter((r) => r.value !== null);
  if (valued.length === 0) return null;
  const points = valued.flatMap((r) => (r.rule ? [r.value as number, r.rule.threshold] : [r.value as number]));
  const min = Math.min(0, ...points);
  const top = niceCeil(Math.max(...points));
  // Every value at zero: a track still needs a length.
  return { min, max: top > min ? top : min + 1 };
}

/** Where a number sits on the scale, as a share of the track from 0 to 100. */
export function barShare(value: number, scale: BarScale): number {
  const share = ((value - scale.min) / (scale.max - scale.min)) * 100;
  return Math.max(0, Math.min(100, share));
}

export type SharedRule = { kind: "none" } | { kind: "one"; rule: BandRule } | { kind: "mixed" };

/** Whether the units that report are all watched by the same threshold, by several, or by none. */
export function sharedRule(rows: UnitRow[]): SharedRule {
  const valued = rows.filter((r) => r.value !== null);
  const watched = valued.filter((r) => r.rule !== null);
  if (watched.length === 0) return { kind: "none" };
  const first = watched[0]!.rule as BandRule;
  const same = watched.every((r) => r.rule!.op === first.op && r.rule!.threshold === first.threshold);
  return same && watched.length === valued.length ? { kind: "one", rule: first } : { kind: "mixed" };
}

// --- Words ------------------------------------------------------------------

const OP_WORDS: Record<TwinAlertOp, string> = {
  ">": "over",
  ">=": "at or over",
  "<": "under",
  "<=": "at or under",
  "==": "equal to",
};

/** A rule in words: "alert when over 100%". */
export function ruleInWords(rule: BandRule, measure: Measure): string {
  return `alert when ${OP_WORDS[rule.op]} ${formatMeasure(rule.threshold, measure)}`;
}

/** Where a unit stands against its threshold. The direction follows the rule: low can be the bad side. */
export function bandLabel(band: MetricBand, rule: BandRule | null): string {
  if (band === "absent") return "No value for this measure";
  if (band === "unbanded" || !rule) return "No alert threshold";
  if (band === "near") return "Close to the threshold";
  if (rule.op === "==") return band === "over" ? "At the alert value" : "Not at the alert value";
  const highIsBad = rule.op === ">" || rule.op === ">=";
  if (band !== "over") return highIsBad ? "Under the threshold" : "Over the threshold";
  // A rule that fires at the threshold itself: 100% is "at", not "over".
  const inclusive = rule.op === ">=" || rule.op === "<=";
  if (inclusive) return `At or ${highIsBad ? "over" : "under"} the threshold`;
  return highIsBad ? "Over the threshold" : "Under the threshold";
}

// --- The tiles --------------------------------------------------------------

/** How strongly a tile is painted. Three steps past the threshold, by how far past. */
export type Heat = "plain" | "calm" | "near" | "over1" | "over2" | "over3";

/** Past the threshold by more than this share of it: the next step up. */
export const HEAT_STEPS = [0.2, 0.6] as const;

export function heatOf(row: UnitRow): Heat {
  if (row.value === null || row.band === "absent" || row.band === "unbanded" || !row.rule) return "plain";
  if (row.band === "calm") return "calm";
  if (row.band === "near") return "near";
  const size = Math.abs(row.rule.threshold);
  // No distance to speak of from a threshold of zero, or from an exact value.
  if (row.rule.op === "==" || size === 0) return "over2";
  const past = Math.abs(row.value - row.rule.threshold) / size;
  return past > HEAT_STEPS[1] ? "over3" : past > HEAT_STEPS[0] ? "over2" : "over1";
}

export interface HeatStep {
  heat: Heat;
  label: string;
}

/**
 * What each tile colour means, read from the darkest down: a tile takes the
 * first line it fits. With one threshold for every unit the lines carry its
 * numbers; with several they can only say how far past each unit's own.
 */
export function heatLegend(shared: SharedRule, measure: Measure): HeatStep[] {
  if (shared.kind === "none") return [];
  if (shared.kind === "mixed" || shared.rule.op === "==" || shared.rule.threshold === 0) {
    return [
      { heat: "over3", label: "far past its threshold" },
      { heat: "over2", label: "past its threshold" },
      { heat: "over1", label: "just past its threshold" },
      { heat: "near", label: "close to its threshold" },
      { heat: "calm", label: "clear of it" },
    ];
  }
  const { op, threshold } = shared.rule;
  const highIsBad = op === ">" || op === ">=";
  const side = highIsBad ? "over" : "under";
  const at = (share: number) => formatMeasure(threshold + (highIsBad ? 1 : -1) * Math.abs(threshold) * share, measure);
  return [
    { heat: "over3", label: `${side} ${at(HEAT_STEPS[1])}` },
    { heat: "over2", label: `${side} ${at(HEAT_STEPS[0])}` },
    { heat: "over1", label: `${OP_WORDS[op]} the threshold, ${formatMeasure(threshold, measure)}` },
    { heat: "near", label: "close to the threshold" },
    { heat: "calm", label: "clear of it" },
  ];
}

/** The kinds of unit present, most numerous first. */
export function kindsOf(nodes: { kind: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind]) => kind);
}
