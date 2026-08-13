/**
 * Composing an event, and saying in plain words what it will do.
 *
 * Pure on purpose: the composer's whole risk is producing something that reads
 * as a catastrophe and applies to nothing, so the sentence a user checks before
 * saving has to be derived from the same object the engine receives — not
 * written alongside it by hand, where the two drift apart and the sentence is
 * the one people believe.
 */

import type {
  CapacityEffect,
  ConnectivityEffect,
  CrisisEffect,
  DemandEffect,
  EffectKind,
  ProfileShape,
  TemporalProfile,
} from "@/lib/platform-api";

export interface NamedThing {
  id: string;
  name: string;
}

export function defaultProfile(horizon: number): TemporalProfile {
  return { start: 0, end: horizon, shape: "step", peak: 1 };
}

/** A fresh effect of the given kind, valid but deliberately inert. */
export function blankEffect(kind: EffectKind, horizon: number, seq: number): CrisisEffect {
  const profile = defaultProfile(horizon);
  const id = `${kind}-${seq}`;
  if (kind === "demand") {
    return {
      id,
      kind: "demand",
      targets: [],
      // The three acuities the care model builds. An empty mix produces no
      // patients at all, which is a silent no-op, so it starts populated.
      acuity_mix: { critical: 0.2, urgent: 0.3, routine: 0.5 },
      volume: 0,
      profile,
    };
  }
  if (kind === "capacity") {
    return { id, kind: "capacity", facilities: [], category: null, multiplier: 1, profile };
  }
  return { id, kind: "connectivity", edges: [], multiplier: 0, profile };
}

const SHAPE_WORDS: Record<ProfileShape, string> = {
  step: "holds steady",
  ramp: "builds up",
  pulse: "hits once",
  gaussian: "peaks and fades",
};

function window(p: TemporalProfile): string {
  if (p.shape === "pulse") return `at step ${p.start}`;
  if (p.end === null) return `from step ${p.start} onwards`;
  return `from step ${p.start} to ${p.end}`;
}

function list(ids: string[], known: NamedThing[], noun: string): string {
  if (ids.length === 0) return `no ${noun} yet`;
  const names = ids.map((id) => known.find((k) => k.id === id)?.name ?? id.slice(0, 8));
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * Percentage change from a multiplier, phrased as the direction it goes.
 *
 * "40% multiplier" is the field; "drops by 60%" is what happens. Reading the
 * first as the second is the easiest mistake this form allows, and it silently
 * inverts the severity of the event.
 */
function multiplierWords(m: number): string {
  if (m === 1) return "is unchanged";
  if (m === 0) return "is wiped out";
  const pct = Math.round(Math.abs(1 - m) * 100);
  return m < 1 ? `drops by ${pct}%` : `grows by ${pct}%`;
}

export function describeEffect(
  effect: CrisisEffect,
  facilities: NamedThing[],
  populations: NamedThing[],
): string {
  const when = window(effect.profile);
  const how = SHAPE_WORDS[effect.profile.shape];

  if (effect.kind === "demand") {
    const e = effect as DemandEffect;
    const who = list(e.targets, populations, "population");
    if (e.volume === 0) return `Nothing: the volume is zero, so ${who} sees no change.`;
    const verb = e.volume > 0 ? "extra" : "fewer";
    return (
      `${Math.abs(e.volume)} ${verb} patients per step arrive from ${who}, ${when}, ` +
      `and the wave ${how}.`
    );
  }

  if (effect.kind === "capacity") {
    const e = effect as CapacityEffect;
    const where = list(e.facilities, facilities, "facility");
    const what = e.resources?.length
      ? e.resources.join(", ")
      : e.category
        ? `${e.category} capacity`
        : "every resource";
    if (e.absolute !== null && e.absolute !== undefined) {
      return `${what} at ${where} is set to ${e.absolute}, ${when}.`;
    }
    const m = e.multiplier ?? 1;
    if (m === 1) return `Nothing: the multiplier is 1, so ${what} at ${where} is untouched.`;
    return `${what} at ${where} ${multiplierWords(m)}, ${when}, and the change ${how}.`;
  }

  const e = effect as ConnectivityEffect;
  const routes =
    e.edges.length === 0
      ? "no route yet"
      : e.edges
          .map(([s, t]) => {
            const a = facilities.find((f) => f.id === s)?.name ?? s.slice(0, 8);
            const b = facilities.find((f) => f.id === t)?.name ?? t.slice(0, 8);
            return `${a} → ${b}`;
          })
          .join(", ");
  if (e.multiplier === 0) return `${routes} is cut, ${when}.`;
  return `${routes} ${multiplierWords(e.multiplier)} in throughput, ${when}.`;
}

/**
 * Reasons this event would run and change nothing.
 *
 * The engine refuses these too, but only once the run is attempted and in terms
 * of ids. Catching them while the form is open is the difference between a
 * correction and a puzzle.
 */
export function inertReasons(
  effect: CrisisEffect,
  horizon: number,
): string[] {
  const out: string[] = [];
  const p = effect.profile;
  if (p.start >= horizon) {
    out.push(`starts at step ${p.start}, after the run ends at ${horizon}`);
  }
  if (p.end !== null && p.end < p.start) {
    out.push(`ends at step ${p.end}, before it starts at ${p.start}`);
  }
  if (p.peak <= 0) out.push("has a peak of zero, so it never bites");

  if (effect.kind === "demand") {
    const e = effect as DemandEffect;
    if (e.targets.length === 0) out.push("targets no population");
    if (e.volume === 0) out.push("moves a volume of zero");
    if (Object.keys(e.acuity_mix).length === 0) out.push("names no acuity, so it sends nobody");
  } else if (effect.kind === "capacity") {
    const e = effect as CapacityEffect;
    if (e.facilities.length === 0) out.push("names no facility");
    const abs = e.absolute;
    if ((abs === null || abs === undefined) && (e.multiplier ?? 1) === 1) {
      out.push("multiplies capacity by 1, which changes nothing");
    }
  } else {
    const e = effect as ConnectivityEffect;
    if (e.edges.length === 0) out.push("names no route");
  }
  return out;
}

/** Whether the whole event is worth running. */
export function eventProblems(
  effects: CrisisEffect[],
  horizon: number,
): string[] {
  if (effects.length === 0) {
    return ["This event has no effects, so it is indistinguishable from a normal day."];
  }
  const out: string[] = [];
  const ids = new Set<string>();
  for (const e of effects) {
    if (ids.has(e.id)) {
      out.push(
        `Two effects are both called "${e.id}". Effect ids appear in the trace as the ` +
          `reason something happened, so they have to be distinct.`,
      );
    }
    ids.add(e.id);
    for (const r of inertReasons(e, horizon)) out.push(`"${e.id}" ${r}.`);
  }
  return out;
}
