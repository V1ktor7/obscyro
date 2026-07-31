import { BadRequest } from "../lib/errors.js";

// ---------------------------------------------------------------------------
// The read lens.
//
// Every read of the ontology answers a question about *some* state of the
// world. Today that is always "now, as it really is". Two other lenses are
// coming, and they are the same shape of change:
//
//   asOf       — the world as it was at a past instant
//   scenarioId — the world as it would be under a set of proposed edits
//
// Both mean "resolve through a lens" and both need a parameter on every read
// path. The parameter is threaded now, while it costs one pass over the call
// sites; the resolution behind it lands later as a function body rather than
// another refactor of the same thirty files.
//
// Passing an unimplemented option fails loudly. Accepting it and quietly
// returning live data would be the worst outcome available: a scenario
// comparison that silently compares reality to itself.
// ---------------------------------------------------------------------------

export interface ReadLens {
  /**
   * Absolute instant to read at. Requires property history on instances,
   * which does not exist yet — properties are overwritten in place.
   */
  asOf?: string;
  /** Scenario whose overrides to merge over the base. */
  scenarioId?: string;
  /** Position within a scenario's own timeline, in hours from its start. */
  atOffsetHours?: number;
}

export type LensSupport = "live" | "asOf" | "scenario";

/**
 * Reject a lens this build cannot honour. Called at the top of every read so
 * the failure surfaces at the caller rather than as quietly wrong numbers.
 */
export function assertLensSupported(lens: ReadLens | undefined, supports: LensSupport[] = ["live"]): void {
  if (!lens) return;
  if (lens.asOf !== undefined && !supports.includes("asOf")) {
    throw BadRequest(
      "LENS_ASOF_UNSUPPORTED",
      "Reading the ontology at a past instant is not implemented yet. Link validity is being " +
        "recorded from now on; instance property history is not.",
    );
  }
  if (lens.scenarioId !== undefined && !supports.includes("scenario")) {
    throw BadRequest(
      "LENS_SCENARIO_UNSUPPORTED",
      "Reading the ontology through a scenario is not implemented yet.",
    );
  }
  if (lens.atOffsetHours !== undefined && lens.scenarioId === undefined) {
    throw BadRequest(
      "LENS_OFFSET_WITHOUT_SCENARIO",
      "atOffsetHours positions a read inside a scenario's timeline, so it needs a scenarioId.",
    );
  }
}

/** True when the lens asks for anything other than live reality. */
export function isLive(lens: ReadLens | undefined): boolean {
  return !lens || (lens.asOf === undefined && lens.scenarioId === undefined);
}

/**
 * The predicate selecting link rows visible through this lens.
 *
 * Live: only open links — a closed one was true once, not now. At a past
 * instant it becomes "opened at or before T, and not yet closed at T", which
 * is why both bounds are indexed.
 *
 * `alias` is the table alias in the calling query.
 */
export function linkVisibilitySql(lens: ReadLens | undefined, alias = "li"): string {
  if (isLive(lens)) return `${alias}.valid_to IS NULL`;
  // Not reachable until asOf is supported; kept here so the shape of the
  // eventual predicate lives next to the live one rather than being invented
  // separately later.
  return `${alias}.valid_from <= $asOf AND (${alias}.valid_to IS NULL OR ${alias}.valid_to > $asOf)`;
}
