/**
 * When a value was true, as opposed to when we wrote it down.
 *
 * These are different times and the gap between them is not small. The MSSS
 * emergency file carries three: the hour the census was taken (18:00), the
 * moment it was published (18:45), and whenever our scheduler happened to fetch
 * it. Freshness measured from the fetch resets to nothing every hour whether or
 * not anything changed — a re-download of an unchanged file made an
 * eighty-minute-old occupancy figure read as four minutes old.
 *
 * So the moment is read from the data, from a property the institution declares
 * as carrying it. Not sniffed: a column that looks like a date is not the same
 * as a column that means "this is when the reading was taken", and the ones
 * that look alike are exactly the ones that would be picked wrong.
 *
 * When nothing is declared, or the value cannot be read, the answer is that we
 * do not know. Not a number.
 */

/** Why there is no age, or where the age came from. */
export type FreshnessBasis =
  /** The source's own published timestamp. */
  | "observed"
  /** No property on this type is declared as carrying the observation time. */
  | "undeclared"
  /** Declared, but nothing linked carries a value this can read. */
  | "unreadable"
  /** A naive stamp with no zone declared for it — an age would be a guess. */
  | "zone-unknown"
  /** Nothing is linked to this unit at all. */
  | "empty";

const NAIVE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const ZONED = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * The offset of a zone at an instant, in milliseconds.
 *
 * Read from `Intl` rather than from a table, so daylight saving is the
 * platform's problem rather than ours. Accurate except inside the one repeated
 * hour of a fall-back, where a wall clock genuinely names two instants and no
 * amount of care picks the right one.
 */
function zoneOffsetMs(at: Date, zone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const f: Record<string, string> = {};
    for (const p of parts) f[p.type] = p.value;
    const asIfUtc = Date.UTC(
      Number(f.year),
      Number(f.month) - 1,
      Number(f.day),
      Number(f.hour),
      Number(f.minute),
      Number(f.second),
    );
    if (!Number.isFinite(asIfUtc)) return null;
    return asIfUtc - at.getTime();
  } catch {
    // An unknown zone name. Better to report that we cannot read the stamp
    // than to fall back to the server's own clock, which is UTC on Railway and
    // would move a Montréal reading by four hours without a word.
    return null;
  }
}

export interface ReadStamp {
  at: Date | null;
  basis: FreshnessBasis;
}

/**
 * Turn a published timestamp into an instant.
 *
 * A stamp that carries its own zone is unambiguous and is used as it stands. A
 * stamp without one — `2026-09-05T18:45`, which is what MSSS writes — names a
 * wall clock and nothing else. Reading it as UTC is what `new Date()` does on a
 * server, and on Railway that would place a 18:45 Montréal reading four hours
 * in the future, turning an hour-old figure into a negative age. So a naive
 * stamp is only readable when the institution has said which clock it is.
 */
export function readStamp(value: unknown, zone?: string | null): ReadStamp {
  if (value === null || value === undefined) return { at: null, basis: "unreadable" };
  const raw = typeof value === "string" ? value.trim() : String(value).trim();
  if (raw === "") return { at: null, basis: "unreadable" };

  if (ZONED.test(raw)) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? { at: null, basis: "unreadable" } : { at: new Date(t), basis: "observed" };
  }

  if (!NAIVE.test(raw)) return { at: null, basis: "unreadable" };
  if (!zone) return { at: null, basis: "zone-unknown" };

  const asUtc = Date.parse(`${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(asUtc)) return { at: null, basis: "unreadable" };
  const off = zoneOffsetMs(new Date(asUtc), zone);
  if (off === null) return { at: null, basis: "zone-unknown" };
  return { at: new Date(asUtc - off), basis: "observed" };
}

export interface FreshnessInput {
  /** The property declared as carrying the observation time, if any. */
  property: { key: string; zone?: string | null } | null;
  /** Every instance rolled up into this unit. */
  instances: readonly { properties: Record<string, unknown> }[];
  /** Now, injected so a test is not a race. */
  now: number;
}

export interface Freshness {
  /** Age of the data in seconds, or null when it is not known. */
  seconds: number | null;
  basis: FreshnessBasis;
}

/**
 * How old the newest reading under this unit is.
 *
 * The newest, because a unit is as fresh as its freshest part is misleading and
 * as stale as its stalest part is unusable — a hospital with one ward reporting
 * hourly and one reporting weekly is, for the purpose of "can I trust this
 * number now", as fresh as the report the number came from. The reading that
 * moves the metric is the recent one.
 *
 * A negative age is reported as it is rather than floored at zero. A source
 * stamping the future is a clock problem somewhere, and a zero would hide it.
 */
export function freshnessOf(input: FreshnessInput): Freshness {
  if (input.instances.length === 0) return { seconds: null, basis: "empty" };
  if (!input.property) return { seconds: null, basis: "undeclared" };

  let newest: Date | null = null;
  let sawZoneProblem = false;
  for (const inst of input.instances) {
    const { at, basis } = readStamp(inst.properties[input.property.key], input.property.zone);
    if (basis === "zone-unknown") sawZoneProblem = true;
    if (at && (!newest || at > newest)) newest = at;
  }

  if (!newest) {
    return { seconds: null, basis: sawZoneProblem ? "zone-unknown" : "unreadable" };
  }
  return { seconds: Math.round((input.now - newest.getTime()) / 1000), basis: "observed" };
}

/** A sentence for the screen, so "—" never has to be interpreted. */
export function explainBasis(basis: FreshnessBasis): string {
  switch (basis) {
    case "observed":
      return "Age of the reading, from the timestamp the source published.";
    case "undeclared":
      return "Unknown — no property on this type is declared as carrying the time of the reading.";
    case "unreadable":
      return "Unknown — the declared timestamp property carries nothing this can read.";
    case "zone-unknown":
      return "Unknown — the timestamp names a wall clock with no zone, and no zone is declared for it.";
    case "empty":
      return "Nothing is linked to this unit.";
  }
}
