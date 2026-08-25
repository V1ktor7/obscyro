/**
 * A signal measured over one geography, read against another.
 *
 * Almost nothing worth correlating is published on the health network's own
 * boundaries. A sewershed follows pipes, a weather station follows a mast, an
 * air-quality zone follows a monitor, a transit count follows a line. None of
 * them stop where an RLS stops, and the gap between the two geographies is
 * where the quiet errors live.
 *
 * Two of those errors are worth naming, because both produce a number that
 * looks fine.
 *
 * **Weighting by area.** A sewershed covering 30% of a territory's hectares may
 * carry 70% of its people, and a viral load reflects people rather than land.
 * Area is offered here because sometimes it is all there is, but it is labelled
 * as what it is, and a population weight always wins when one exists.
 *
 * **Summing an intensity.** Two plants each reporting 500 copies per litre do
 * not make 1000. Counts add and concentrations average, they are not the same
 * arithmetic, and the caller has to say which they have — the same reason a
 * property in this ontology has to declare whether it is a level or a stock.
 */

export interface Overlap {
  /** The zone the signal was measured over: a plant, a station, a sector. */
  source: string;
  /** The twin's catchment it feeds. */
  target: string;
  /**
   * How much of the source belongs to the target, 0 to 1.
   *
   * Share of *people* wherever a population source exists. `basis` records
   * which it was, because a reader cannot tell from the number.
   */
  weight: number;
  basis?: "population" | "area" | "declared";
}

/** Counts add. Concentrations, rates and temperatures average. */
export type Quantity = "extensive" | "intensive";

export interface Reallocation {
  /** Target catchment → value, for targets that received anything. */
  byTarget: Map<string, number>;
  /**
   * Zones whose signal reached no declared catchment.
   *
   * Reported rather than dropped: a plant nobody mapped simply vanishes, and a
   * territory then reads as quiet when the truth is that nothing was ever
   * pointed at it.
   */
  unmapped: string[];
  /**
   * Sources whose declared weights do not sum to 1, with what they sum to.
   *
   * Not corrected. Weights over one multiply a signal that was measured once,
   * and weights under one lose part of it — but which of those is a mistake
   * depends on whether the map is meant to be complete, and only the author
   * knows.
   */
  unbalanced: Array<{ source: string; total: number }>;
}

const EPSILON = 1e-6;

export function reallocate(
  bySource: Readonly<Record<string, number | null>>,
  overlaps: readonly Overlap[],
  quantity: Quantity,
): Reallocation {
  const fromSource = new Map<string, Overlap[]>();
  for (const o of overlaps) {
    if (o.weight <= 0) continue;
    fromSource.set(o.source, [...(fromSource.get(o.source) ?? []), o]);
  }

  const unmapped: string[] = [];
  const unbalanced: Array<{ source: string; total: number }> = [];
  // Numerator and denominator kept apart until the end: an intensive quantity
  // is a weighted mean, and a mean cannot be accumulated as it goes without
  // knowing what it will eventually be divided by.
  const sum = new Map<string, number>();
  const weight = new Map<string, number>();

  for (const [source, value] of Object.entries(bySource)) {
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const parts = fromSource.get(source);
    if (!parts || parts.length === 0) {
      unmapped.push(source);
      continue;
    }
    const total = parts.reduce((a, p) => a + p.weight, 0);
    if (Math.abs(total - 1) > EPSILON) unbalanced.push({ source, total });
    for (const p of parts) {
      sum.set(p.target, (sum.get(p.target) ?? 0) + value * p.weight);
      weight.set(p.target, (weight.get(p.target) ?? 0) + p.weight);
    }
  }

  const byTarget = new Map<string, number>();
  for (const [target, s] of Array.from(sum)) {
    if (quantity === "extensive") {
      byTarget.set(target, s);
      continue;
    }
    const w = weight.get(target) ?? 0;
    // A target whose contributing weights cancel to nothing has no mean to
    // report. Left out rather than returned as zero, which reads as "measured,
    // and it was nothing".
    if (w > EPSILON) byTarget.set(target, s / w);
  }

  return { byTarget, unmapped: unmapped.sort(), unbalanced };
}

/**
 * Weights from the population each piece of a zone holds.
 *
 * The correct basis for anything that comes from people — a viral load, a case
 * count, a transit boarding. Given as raw head counts per (source, target)
 * pair, which is what a census or a dissemination-area join produces, and
 * normalised here so the caller does not have to remember to.
 */
export function weightsFromPopulation(
  pieces: ReadonlyArray<{ source: string; target: string; people: number }>,
): Overlap[] {
  const totals = new Map<string, number>();
  for (const p of pieces) {
    if (p.people <= 0) continue;
    totals.set(p.source, (totals.get(p.source) ?? 0) + p.people);
  }
  const out: Overlap[] = [];
  for (const p of pieces) {
    const total = totals.get(p.source) ?? 0;
    if (p.people <= 0 || total <= 0) continue;
    out.push({ source: p.source, target: p.target, weight: p.people / total, basis: "population" });
  }
  return out;
}

/**
 * Weights from overlapping area, when nothing better exists.
 *
 * Kept separate from the population version and stamped `area` rather than
 * silently mixed in, because the difference is not a detail: over a city, land
 * and people are distributed very differently, and a signal that comes from
 * people weighted by hectares is wrong in a direction nobody can guess from
 * looking at it.
 */
export function weightsFromArea(
  pieces: ReadonlyArray<{ source: string; target: string; area: number }>,
): Overlap[] {
  return weightsFromPopulation(
    pieces.map((p) => ({ source: p.source, target: p.target, people: p.area })),
  ).map((o) => ({ ...o, basis: "area" as const }));
}
