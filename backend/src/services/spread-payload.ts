/**
 * What this API sends the engine when it asks for a spreading run.
 *
 * Four lines of renaming, given a file of its own because renaming is where
 * this seam has failed every time. `perturbations` for `effects` cost a session
 * of runs that all tied at zero; `scenario` for `event` blanked the page. Both
 * were silent: pydantic drops a field it does not know, and JSON has no opinion
 * about a key nobody reads.
 *
 * So the payload is built here rather than inline in the route, and the test
 * beside it reads the engine's own source to check these names are still the
 * ones it declares. A rename on either side then fails a test rather than a
 * run.
 */

export interface SpreadChange {
  layer: string;
  factor: number;
  fromStep: number;
  toStep: number | null;
  /** Catchments whose residents the measure covers. Absent means all of them. */
  populations?: string[];
}

export interface SpreadPayload {
  system: unknown;
  seeds: Record<string, Record<string, number>>;
  horizon: number;
  changes: {
    layer: string;
    factor: number;
    from_step: number;
    to_step: number | null;
    populations?: string[];
  }[];
  probe: boolean;
}

export function spreadPayload(
  system: unknown,
  input: {
    seeds: Record<string, Record<string, number>>;
    horizon: number;
    changes: readonly SpreadChange[];
    probe?: boolean;
  },
): SpreadPayload {
  return {
    system,
    seeds: input.seeds,
    horizon: input.horizon,
    // The engine speaks snake case and this API speaks camel. Translated once,
    // at the boundary that already knows about both, rather than by asking one
    // side to hold the other's convention.
    changes: input.changes.map((c) => ({
      layer: c.layer,
      factor: c.factor,
      from_step: c.fromStep,
      to_step: c.toStep,
      // Only when scoped. Sent as an empty list it would scope the measure to
      // no catchment at all, and a measure that covers nobody looks like a
      // measure that did nothing.
      ...(c.populations && c.populations.length > 0 ? { populations: c.populations } : {}),
    })),
    probe: input.probe ?? false,
  };
}
