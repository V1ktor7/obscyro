/**
 * An observed time series, read as an event.
 *
 * This is the shortest honest path from a published file to a run. A ministry
 * publishes what happened — ninety-three people were admitted to hospital in
 * Montréal on 6 January 2022 — and the engine already knows how to queue,
 * serve and count arrivals. Between the two sits nothing but a change of
 * vocabulary, and doing that change by hand in a script is what puts a number
 * on screen that nobody can trace back to a row.
 *
 * `demand.volume` is the target and not `demand.incidence`, and the difference
 * matters: incidence is per thousand people and needs a catchment size, which
 * would mean picking a population figure the file does not carry. A flat count
 * of arrivals needs nothing the file does not already say.
 */

export interface RowMapping {
  /** Column holding the date or step. */
  when: string;
  /** Column holding the count of arrivals. */
  count: string;
  /** The severity these arrivals present with, as the care model names it. */
  acuity: string;
  /** The catchment they arrive in, as the export names it. */
  population: string;
  /**
   * The date step 0 corresponds to.
   *
   * Given, not inferred from the earliest row: a file that happens to start
   * three days late would silently shift the whole event, and every comparison
   * drawn against another event would be three days out with nothing to show
   * for it.
   */
  origin?: string;
}

export interface BuiltEvent {
  effects: Array<Record<string, unknown>>;
  horizon: number;
  /** Rows that carried no usable count, named so the total can be trusted. */
  skipped: number;
  /** What the run covers, for the description nobody should have to guess. */
  first: string | null;
  last: string | null;
  total: number;
}

function dayIndex(value: string, origin: string): number | null {
  const a = Date.parse(`${origin}T00:00:00Z`);
  const b = Date.parse(`${String(value).trim()}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function eventFromRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  map: RowMapping,
): BuiltEvent {
  const all = rows.map((r) => ({ when: String(r[map.when] ?? "").trim(), raw: r[map.count] }));
  // A row with no date cannot be placed on a timeline — but it is counted as
  // skipped rather than filtered away here, because a file where a tenth of the
  // dates are blank should say so, not silently describe a shorter wave.
  const dated = all.filter((r) => r.when !== "");
  const origin =
    map.origin ?? dated.map((r) => r.when).sort()[0] ?? new Date().toISOString().slice(0, 10);

  const effects: Array<Record<string, unknown>> = [];
  let skipped = all.length - dated.length;
  let horizon = 0;
  let total = 0;
  const seen = new Set<number>();

  for (const r of dated) {
    const n = Number(String(r.raw ?? "").replace(/\s/g, ""));
    // Blank, "n.d." or a negative: no arrivals to place. Counted rather than
    // dropped in silence, because a file that is half blank and a file that is
    // half zeros produce the same flat curve and mean different things.
    if (!Number.isFinite(n) || n <= 0) {
      skipped++;
      continue;
    }
    const step = dayIndex(r.when, origin);
    if (step === null || step < 0) {
      skipped++;
      continue;
    }
    // Two rows on one date would each add their own arrivals, which is right
    // for two catchments and wrong for a file listing the same day twice. The
    // id carries the date, so a repeat is refused upstream by the distinct-id
    // rule rather than doubling the wave here.
    if (seen.has(step)) {
      skipped++;
      continue;
    }
    seen.add(step);

    horizon = Math.max(horizon, step + 1);
    total += n;
    effects.push({
      id: `obs-${map.acuity}-${r.when}`,
      target: "demand.volume",
      select: { acuity: [map.acuity], population: [map.population] },
      op: "add",
      value: n,
      // A single step: this is what happened that day, not a shape spread
      // across a window. The profile is the engine's way of saying when, and
      // saying it exactly is the whole point of using an observed file.
      profile: { start: step, end: step, shape: "step", peak: 1 },
    });
  }

  const days = dated.map((r) => r.when).sort();
  return {
    effects,
    horizon,
    skipped,
    first: days[0] ?? null,
    last: days[days.length - 1] ?? null,
    total,
  };
}
