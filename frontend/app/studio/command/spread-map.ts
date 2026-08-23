/**
 * A spreading run, turned into something a map can paint.
 *
 * Two decisions live here and neither is obvious from the numbers.
 *
 * The first is what the colour is *of*. A run reports how much sits in each
 * declared state and how much crossed into demand this step, and those answer
 * different questions: the stock says how much of the territory is affected
 * right now, the flow says how fast it is getting worse. Both are offered
 * because both are asked, and neither is chosen here.
 *
 * The second is what full colour means. Normalising each step against its own
 * maximum is the version that writes itself and it destroys the thing the map
 * exists to show: every frame comes out equally deep, the wave stops rising,
 * and all that is left is which territory leads. Scaled against the peak of the
 * whole run instead, an early step is pale because it *is* small, and the
 * animation shows growth. It costs one pass over the run before the first frame
 * can be drawn, which is the whole reason the naive version is tempting.
 */

import type { SpreadState } from "@/lib/platform-api";

/** Stock, or flow. Named by the caller because the reader asks for one. */
export type Measure = { kind: "incidence" } | { kind: "state"; name: string };

export interface WaveFrames {
  /** Per tick: population id → its share of the run's peak, 0 to 1. */
  frames: Map<string, number>[];
  /** Raw value per tick and population, for a number beside the colour. */
  values: Map<string, number>[];
  /** What full colour means. Zero when the run never moved. */
  peak: number;
}

function valueOf(s: SpreadState, measure: Measure): number {
  if (measure.kind === "incidence") {
    // Summed across severities: the map shows how much demand appeared, and
    // splitting it by acuity is a question the facility layer already answers.
    let total = 0;
    for (const v of Object.values(s.incidence)) total += v;
    return total;
  }
  return s.states[measure.name] ?? 0;
}

export function waveFrames(states: readonly SpreadState[], measure: Measure): WaveFrames {
  let horizon = 0;
  for (const s of states) horizon = Math.max(horizon, s.tick + 1);

  const values: Map<string, number>[] = Array.from({ length: horizon }, () => new Map());
  let peak = 0;
  for (const s of states) {
    const v = valueOf(s, measure);
    values[s.tick]!.set(s.population, v);
    if (v > peak) peak = v;
  }

  const frames = values.map((tick) => {
    const out = new Map<string, number>();
    // A run where nothing moved is left at zero rather than divided by it. An
    // uncoloured map is the honest picture of a model that produced nothing.
    for (const [pop, v] of Array.from(tick)) out.set(pop, peak > 0 ? v / peak : 0);
    return out;
  });
  return { frames, values, peak };
}

/**
 * The seeds as the engine will read them.
 *
 * What the reader typed, plus the remainder of each seeded catchment in
 * whichever state they said the rest are in. Without that step the obvious
 * gesture — "ten sick people in Villeray" — leaves the other 274 990 in no
 * state at all, and a unit that is nowhere cannot be reached by anything: the
 * run comes back almost empty, which reads as a wave that fizzled rather than
 * one that had nobody to infect.
 *
 * Only catchments that were actually seeded are filled. Filling all twelve
 * would mark every one of them as started and silence the gap that says a wave
 * seeded in one territory never reaches the next.
 */
export function resolveSeeds(
  seeds: Readonly<Record<string, Record<string, number>>>,
  restState: string,
  sizeOf: (populationId: string) => number,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [pop, byState] of Object.entries(seeds)) {
    const typed = { ...byState };
    if (restState) {
      // The rest state's own prior value is replaced, not added to: this runs
      // again on every keystroke, and counting it would shrink the remainder
      // by itself each time.
      const placed = Object.entries(typed)
        .filter(([st]) => st !== restState)
        .reduce((a, [, n]) => a + n, 0);
      const rest = sizeOf(pop) - placed;
      // Never negative. Seeding more units than the catchment holds is the
      // reader's statement about their own world, not an error to rebalance.
      if (rest > 0) typed[restState] = rest;
    }
    out[pop] = typed;
  }
  return out;
}

/**
 * The ontology instance a catchment was built from.
 *
 * `populationsFrom` names a catchment `pop:<instance id>`, and the map keys its
 * shapes by that same instance id. The prefix is the whole join, and it is
 * written down here rather than inlined at the call site so that when the
 * export changes how it names a population there is one place to fix and a test
 * that fails.
 */
export function shapeIdOf(populationId: string): string {
  return populationId.startsWith("pop:") ? populationId.slice(4) : populationId;
}

export interface Painted {
  /** Shape instance id → intensity. Only shapes that exist on the map. */
  byShape: Map<string, number>;
  /**
   * Catchments the run reported that no drawn shape matches.
   *
   * Reported rather than dropped: a twin whose catchments are not the objects
   * carrying the boundaries paints a blank map, and a blank map reads as "the
   * wave never arrived" rather than as "these two things were never joined".
   */
  unmatched: string[];
}

export function paintFor(frame: Map<string, number>, shapeIds: ReadonlySet<string>): Painted {
  const byShape = new Map<string, number>();
  const unmatched: string[] = [];
  for (const [pop, v] of Array.from(frame)) {
    const id = shapeIdOf(pop);
    if (shapeIds.has(id)) byShape.set(id, v);
    else unmatched.push(pop);
  }
  return { byShape, unmatched };
}

/**
 * Where the wave is worst at this step, worst first.
 *
 * The list beside the map, and the reason it is a list: a choropleth is read as
 * a shape and answers "is it everywhere or is it here", while the question that
 * follows — *which* territory — needs names and numbers.
 */
export function leaders(
  frame: Map<string, number>,
  values: Map<string, number>,
  nameOf: (populationId: string) => string,
  limit = 5,
): { id: string; name: string; intensity: number; value: number }[] {
  return Array.from(frame.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, intensity]) => ({
      id,
      name: nameOf(id),
      intensity,
      value: values.get(id) ?? 0,
    }));
}
