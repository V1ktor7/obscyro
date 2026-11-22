import { CalcError, evaluate } from "./analyst-calc.js";
import { priceFor, type Amount, type PriceCatalogue, type PriceEntry } from "./price-catalogue.js";

/**
 * What an option's choices cost, line by line.
 *
 * A pure function: the capacity an option opens, the price list the twin
 * declares, and nothing else. Every cent it gives is traceable three ways: to
 * the change of the option that caused it, to the price row it used, and to
 * the arithmetic, written out on the line so a person can redo it.
 *
 * What it counts is the cost of the choices, and only that: opening units, and
 * keeping them open for the days of the run. Not what the network costs to
 * run, not staff the twin does not hold, not what closing units would save.
 *
 * Four rules keep the sums exact and honest:
 *
 *   whole cents     every line is in whole cents, and a total is the sum of
 *                   its lines. No sum is ever a floating-point number.
 *   no price, no    a change the list does not price, or whose formula cannot
 *   figure          be evaluated, has no line. It is listed as unpriced with
 *                   the reason. Never a zero.
 *   a range is      a price declared with a low and a high end gives three
 *   three readings  totals: low, likely, high. Nothing is drawn at random.
 *   demo shows      a price with no source is a demo price, and so is every
 *                   total that contains one.
 *
 * Money and health stay apart. Nothing here converts waiting into dollars, and
 * nothing ranks: the ledger gives a cost, and the comparison is the person's.
 */

/** Capacity an option opens, as the ledger reads it. */
export interface PricedChange {
  /** Its position among the option's stamps, from zero: what a line points back to. */
  stamp: number;
  siteId: string;
  siteName: string;
  activity: string;
  /** Units added. Negative closes units, which the list does not price. */
  units: number;
  /** First day the units are open in the run, and how many days they stay open. */
  start: number;
  days: number;
  /** The mode asked for; null when none was named. */
  mode: string | null;
}

export type LineCategory = "opening" | "running" | "formula";

export interface LedgerLine {
  stamp: number;
  siteId: string;
  site: string;
  activity: string;
  category: LineCategory;
  /** The day it falls on, or the first and last day of the period it covers. */
  fromDay: number;
  toDay: number;
  units: number;
  days: number;
  /** The price row used: which one, in which mode, at what amount or by what formula, and where it comes from. */
  price: {
    id: string;
    type: string;
    mode: string;
    /** True when the row is linked to this site: it came before the network's own price. */
    ofSite: boolean;
    /** The amount the quantity was multiplied by, in cents, with its low and high ends; null for a formula. */
    unit: Amount | null;
    formula: string | null;
    /** What stood for each name of the formula; null for an amount. */
    values: Record<string, number> | null;
    source: string | null;
    demo: boolean;
  };
  /** The line's amount, in whole cents: the likely one, then the low and the high. The three are equal without a range. */
  cents: number;
  lowCents: number;
  highCents: number;
  /** The arithmetic, written out. */
  says: string;
}

export interface Availability {
  stamp: number;
  site: string;
  activity: string;
  mode: string;
  /** Days the mode takes from the decision, taken on day 0 of the run. */
  leadDays: number;
  /** The first day the units are open in the run. */
  fromDay: number;
}

export interface CostLedger {
  lines: LedgerLine[];
  totalCents: number;
  /** The same total read with every price at its low end, and at its high end. */
  lowCents: number;
  highCents: number;
  /** True when at least one price used is a range: the three totals then differ. */
  ranged: boolean;
  byCategory: Record<LineCategory, number>;
  /** True when at least one line rests on a price with no source. */
  demo: boolean;
  /** What the list does not price, each with the reason. */
  unpriced: { stamp: number; why: string }[];
  /** For each priced change: the mode it uses and the day its units are open. */
  availability: Availability[];
}

/** An amount in cents, as a person reads it: "1,500,000 $", "1,250.50 $". */
export function formatCents(cents: number): string {
  const whole = cents % 100 === 0;
  return `${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} $`;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-CA")} ${n === 1 ? one : many}`;

/** The price row's name on a line: "Rate card, rush". */
const rowName = (e: PriceEntry) => `${e.type}, ${e.mode}`;

/** A range, said after the likely amount: " (between 120,000 $ and 180,000 $)". Nothing when there is none. */
const between = (low: number, high: number, cents: number) => (low === cents && high === cents ? "" : ` (between ${formatCents(low)} and ${formatCents(high)})`);

/**
 * The lines of one change under one price row, or why it has none.
 *
 * A formula may name the operation's own quantities (`units`, `days`) and the
 * numbers the price row carries. Its result is in cents, rounded once to the
 * whole cent.
 */
export function linesOf(c: PricedChange, e: PriceEntry): { lines: LedgerLine[] } | { why: string } {
  const base = { stamp: c.stamp, siteId: c.siteId, site: c.siteName, activity: c.activity, units: c.units, days: c.days };
  const price = (unit: Amount | null, values: Record<string, number> | null): LedgerLine["price"] => ({
    id: e.id,
    type: e.type,
    mode: e.mode,
    ofSite: e.sites.includes(c.siteId),
    unit,
    formula: values ? e.formula : null,
    values,
    source: e.source,
    demo: e.source === null,
  });
  const units = count(c.units, "unit", "units");
  if (e.formula) {
    let got;
    try {
      // The operation's quantities are handed last: a row that also has a number called "units" does not shadow them.
      got = evaluate(e.formula, { ...e.values, units: c.units, days: c.days });
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      return { why: `The formula of ${rowName(e)} gives no price: ${err.message} The formula is: ${e.formula}` };
    }
    if (got.value < 0) return { why: `The formula of ${rowName(e)} gives a negative amount (${got.value}), which is not a price. The formula is: ${e.formula}` };
    const cents = Math.round(got.value);
    const named = Object.entries(got.used)
      .map(([k, v]) => `${k} = ${v}`)
      .join(", ");
    return {
      lines: [
        {
          ...base,
          category: "formula",
          fromDay: c.start,
          toDay: c.start + c.days - 1,
          price: price(null, got.used),
          cents,
          lowCents: cents,
          highCents: cents,
          says: `${e.formula}${named ? `, with ${named}` : ""} = ${cents.toLocaleString("en-CA")} cents, ${formatCents(cents)}`,
        },
      ],
    };
  }
  const lines: LedgerLine[] = [];
  if (e.perUnitOpened) {
    const a = e.perUnitOpened;
    const [cents, lowCents, highCents] = [c.units * a.cents, c.units * a.low, c.units * a.high];
    lines.push({
      ...base,
      category: "opening",
      fromDay: c.start,
      toDay: c.start,
      price: price(a, null),
      cents,
      lowCents,
      highCents,
      says: `${units} × ${formatCents(a.cents)} to open = ${formatCents(cents)}${between(lowCents, highCents, cents)}`,
    });
  }
  if (e.perUnitDay) {
    const a = e.perUnitDay;
    const times = c.units * c.days;
    const [cents, lowCents, highCents] = [times * a.cents, times * a.low, times * a.high];
    lines.push({
      ...base,
      category: "running",
      fromDay: c.start,
      toDay: c.start + c.days - 1,
      price: price(a, null),
      cents,
      lowCents,
      highCents,
      says: `${units} × ${count(c.days, "day", "days")} × ${formatCents(a.cents)} a day = ${formatCents(cents)}${between(lowCents, highCents, cents)}`,
    });
  }
  return { lines };
}

/**
 * The ledger of an option: one or two lines per priced change, and what is
 * left unpriced.
 *
 * A change whose mode has to be named and was not is unpriced here, with the
 * reason: whoever builds the option is expected to have settled the mode first
 * (`test_option` refuses the change), and the ledger does not choose one.
 */
export function ledgerOf(changes: readonly PricedChange[], catalogue: PriceCatalogue): CostLedger {
  const lines: LedgerLine[] = [];
  const unpriced: CostLedger["unpriced"] = [];
  const availability: Availability[] = [];
  for (const c of changes) {
    if (c.units <= 0) {
      unpriced.push({ stamp: c.stamp, why: `Closing units at ${c.siteName} is not priced: the price list says what opening and keeping a unit costs, not what closing one saves.` });
      continue;
    }
    const choice = priceFor(catalogue, c.activity, c.mode, c.siteId);
    if (choice.priced === false) {
      unpriced.push({ stamp: c.stamp, why: `The price list holds no price for ${c.activity} at ${c.siteName}.` });
      continue;
    }
    if (choice.priced === null) {
      unpriced.push({ stamp: c.stamp, why: choice.why });
      continue;
    }
    const got = linesOf(c, choice.entry);
    if ("why" in got) {
      unpriced.push({ stamp: c.stamp, why: got.why });
      continue;
    }
    lines.push(...got.lines);
    availability.push({ stamp: c.stamp, site: c.siteName, activity: c.activity, mode: choice.entry.mode, leadDays: choice.entry.leadDays, fromDay: c.start });
  }
  const byCategory: Record<LineCategory, number> = { opening: 0, running: 0, formula: 0 };
  for (const l of lines) byCategory[l.category] += l.cents;
  // A total is the sum of its lines, each already in whole cents.
  const sum = (of: (l: LedgerLine) => number) => lines.reduce((n, l) => n + of(l), 0);
  const [totalCents, lowCents, highCents] = [sum((l) => l.cents), sum((l) => l.lowCents), sum((l) => l.highCents)];
  return {
    lines,
    totalCents,
    lowCents,
    highCents,
    ranged: lowCents !== totalCents || highCents !== totalCents,
    byCategory,
    demo: lines.some((l) => l.price.demo),
    unpriced,
    availability,
  };
}
