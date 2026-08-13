/**
 * Composing an effect, and saying in plain words what it will do.
 *
 * Pure on purpose. The composer's whole risk is producing something that reads
 * as a catastrophe and applies to nothing, so the sentence a user checks before
 * saving is derived from the same object the engine receives — not written
 * alongside it by hand, where the two drift apart and the sentence is the one
 * people believe.
 *
 * Nothing here knows what an effect *kind* is. The engine publishes a catalogue
 * of addressable quantities; these helpers read it. Adding something
 * perturbable server-side needs no change in this file.
 */

import type {
  SelectorDimension,
  SimEffect,
  SimTarget,
  TemporalProfile,
} from "@/lib/platform-api";

export interface NamedThing {
  id: string;
  name: string;
}

/** Everything the twin offers, per selector dimension. */
export type Vocabulary = Partial<Record<SelectorDimension, NamedThing[]>>;

const DIMENSION_NOUN: Record<SelectorDimension, [string, string]> = {
  facility: ["facility", "facilities"],
  category: ["kind", "kinds"],
  activity: ["activity", "activities"],
  acuity: ["severity", "severities"],
  population: ["population", "populations"],
  route: ["route", "routes"],
};

export function defaultProfile(horizon: number): TemporalProfile {
  return { start: 0, end: horizon, shape: "step", peak: 1 };
}

/** A fresh effect on this quantity — valid, and deliberately inert. */
export function blankEffect(target: SimTarget, horizon: number, seq: number): SimEffect {
  const op = target.ops[0] ?? "multiply";
  return {
    id: `${target.path.split(".").pop()}-${seq}`,
    target: target.path,
    select: {},
    op,
    // The identity for the operation, so a new row changes nothing until it is
    // given a number. A blank effect that already halved something would be a
    // silent edit to an event someone was only exploring.
    value: op === "multiply" ? 1 : 0,
    profile: defaultProfile(horizon),
  };
}

const SHAPE_WORDS: Record<TemporalProfile["shape"], string> = {
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

function nameOf(vocab: Vocabulary, dimension: SelectorDimension, id: string): string {
  return (vocab[dimension] ?? []).find((v) => v.id === id)?.name ?? id.slice(0, 8);
}

/** "Emergency and Medicine", "every facility", "3 severities". */
function scope(effect: SimEffect, target: SimTarget, vocab: Vocabulary): string {
  const parts: string[] = [];
  for (const dimension of target.selector) {
    const chosen = effect.select[dimension] ?? [];
    const [one, many] = DIMENSION_NOUN[dimension];
    if (chosen.length === 0) {
      // Only worth saying for the dimensions where "all" is a real decision.
      if (dimension === "facility" || dimension === "population") {
        parts.push(`every ${one}`);
      }
      continue;
    }
    const names = chosen.map((id) => nameOf(vocab, dimension, id));
    parts.push(names.length <= 2 ? names.join(" and ") : `${names.length} ${many}`);
  }
  return parts.length ? parts.join(", ") : "the whole model";
}

/**
 * A multiplier as the direction it moves, not as the number in the field.
 *
 * Reading "0.4" as "drops to 40%" versus "drops by 40%" inverts the severity of
 * the event, and the field alone cannot tell you which was meant.
 */
function multiplierWords(m: number): string {
  if (m === 1) return "is unchanged";
  if (m === 0) return "is wiped out";
  const pct = Math.round(Math.abs(1 - m) * 100);
  return m < 1 ? `drops by ${pct}%` : `grows by ${pct}%`;
}

export function describeEffect(
  effect: SimEffect,
  target: SimTarget | undefined,
  vocab: Vocabulary,
): string {
  if (!target) {
    return `Unknown quantity “${effect.target}”. This event cannot run until it is fixed.`;
  }
  const where = scope(effect, target, vocab);
  const when = window(effect.profile);
  const how = SHAPE_WORDS[effect.profile.shape];
  const unit = target.unit ? ` ${target.unit}` : "";

  if (effect.op === "multiply") {
    if (effect.value === 1) {
      return `Nothing: multiplying by 1 leaves ${target.label.toLowerCase()} untouched.`;
    }
    return `${target.label} for ${where} ${multiplierWords(effect.value)}, ${when}, and the change ${how}.`;
  }
  if (effect.op === "set") {
    return `${target.label} for ${where} is set to ${effect.value}${unit}, ${when}.`;
  }
  if (effect.value === 0) {
    return `Nothing: adding zero leaves ${target.label.toLowerCase()} untouched.`;
  }
  const verb = effect.value > 0 ? "rises by" : "falls by";
  return `${target.label} for ${where} ${verb} ${Math.abs(effect.value)}${unit}, ${when}, and the change ${how}.`;
}

/**
 * Reasons this effect would run and change nothing.
 *
 * The engine refuses these too, but only once a run is attempted and in terms
 * of ids. Catching them while the form is open is the difference between a
 * correction and a puzzle.
 */
export function inertReasons(
  effect: SimEffect,
  target: SimTarget | undefined,
  horizon: number,
): string[] {
  const out: string[] = [];
  if (!target) {
    out.push(`names a quantity the engine does not have (“${effect.target}”)`);
    return out;
  }
  const p = effect.profile;
  if (p.start >= horizon) {
    out.push(`starts at step ${p.start}, after the run ends at ${horizon}`);
  }
  if (p.end !== null && p.end < p.start) {
    out.push(`ends at step ${p.end}, before it starts at ${p.start}`);
  }
  if (p.peak <= 0) out.push("has an intensity of zero, so it never bites");
  if (effect.op === "multiply" && effect.value === 1) {
    out.push("multiplies by 1, which changes nothing");
  }
  if (effect.op === "add" && effect.value === 0) {
    out.push("adds zero, which changes nothing");
  }
  if (!target.ops.includes(effect.op)) {
    out.push(`cannot be changed by ${effect.op} — it accepts ${target.ops.join(", ")}`);
  }
  for (const dimension of Object.keys(effect.select) as SelectorDimension[]) {
    if (!target.selector.includes(dimension)) {
      out.push(`is filtered by ${dimension}, which this quantity does not have`);
    }
  }
  return out;
}

/** Whether the whole event is worth running. */
export function eventProblems(
  effects: SimEffect[],
  targets: SimTarget[],
  horizon: number,
): string[] {
  if (effects.length === 0) {
    return ["This event has no effects, so it is indistinguishable from a normal day."];
  }
  const byPath = new Map(targets.map((t) => [t.path, t]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of effects) {
    if (seen.has(e.id)) {
      out.push(
        `Two effects are both called “${e.id}”. Effect ids appear in the trace as the ` +
          `reason something happened, so they have to be distinct.`,
      );
    }
    seen.add(e.id);
    for (const r of inertReasons(e, byPath.get(e.target), horizon)) {
      out.push(`“${e.id}” ${r}.`);
    }
  }
  return out;
}
