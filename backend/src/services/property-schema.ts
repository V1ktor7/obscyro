/**
 * What a declared property means once something tries to change it.
 *
 * The ontology already says that a property exists and whether it holds a
 * number or a string. That is enough to store it and not enough to perturb it.
 * An effect that multiplies a value by 0.5 has to know whether the value is
 * re-derived from a baseline every step or accumulates across steps, and the
 * two answers differ by orders of magnitude while both complete without
 * complaint: 0.5 applied to a running value sixty times is 8.7e-19, and the
 * report reads "the network collapsed under a 50% shock".
 *
 * The engine used to answer that question on the institution's behalf, by
 * shipping a catalogue of quantities it had invented — a length of stay, a
 * mortality rate, an arrival rate per thousand people. Those are one hospital's
 * concepts. A transit authority has no length of stay, and shipping it one is
 * shipping a model of somebody else's institution and calling it a platform.
 *
 * So the answer moves here, onto the property, declared once by the person who
 * knows what the number means. Three of the four behaviours are statements
 * about arithmetic and nothing else; the fourth is the absence of arithmetic.
 * Nothing in this file knows what a bed is.
 */

/**
 * How a value composes when something acts on it.
 *
 *   level  a standing quantity. Rebuilt from an unperturbed baseline every
 *          step, then every active effect applies to *that*, so effects do not
 *          compound over time. How many of something there is.
 *   rate   a per-step quantity that produces something. Also rebuilt from
 *          baseline; the difference from `level` is what the engine does with
 *          it, not how effects land on it.
 *   stock  a running total the engine owns. Nothing re-derives it and nothing
 *          decays it — a queue, a backlog, a debt. `multiply` is meaningless
 *          here: there is no prior value at this address to halve.
 *   state  not a quantity. Only `set` applies. A status, a kind, a label.
 *
 * This is the only closed set in the property schema, and it is four words
 * about arithmetic. Everything else about a property — its name, its unit, its
 * range, whether it exists at all — belongs to whoever declared it.
 */
export const PROPERTY_BEHAVIOURS = ["level", "rate", "stock", "state"] as const;

export type PropertyBehaviour = (typeof PROPERTY_BEHAVIOURS)[number];

export const PROPERTY_TYPES = ["string", "number", "boolean", "object", "array"] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** An institution's numeric range for a property. Both ends optional. */
export interface PropertyBounds {
  min: number | null;
  max: number | null;
}

export interface PropertyDef {
  key: string;
  type: PropertyType;
  label?: string;
  /**
   * Whether an ingested object missing this property is rejected. Read by the
   * channel runner; see `channel-runner.ts`.
   */
  required?: boolean;
  /**
   * Free text, in the institution's own words — "beds", "hours", "$", "L/min".
   * Never interpreted, only rendered beside the field so an author perturbing
   * the number can see what they are perturbing. A closed list of units would
   * be the shipped-model mistake in miniature.
   */
  unit?: string;
  /** The range the institution says the value lives in, not one we assume. */
  bounds?: PropertyBounds | null;
  behaviour?: PropertyBehaviour;
}

/**
 * The behaviour to use, or null when nobody has said.
 *
 * A non-numeric property can only be set, so `state` is a fact about its type
 * rather than a declaration anyone needs to make, and deriving it costs nothing
 * and cannot be wrong. A number is genuinely ambiguous — 40 beds, 40 arrivals a
 * day and 40 people waiting are the same JSON — so guessing one of the three
 * would be exactly the mistake this file exists to undo. An undeclared number
 * reports null, and whatever wants to perturb it has to say so out loud instead
 * of picking a default that happens to be right one time in three.
 */
export function behaviourOf(def: PropertyDef): PropertyBehaviour | null {
  if (def.behaviour) return def.behaviour;
  return def.type === "number" ? null : "state";
}

/**
 * Whether an effect on this property can do arithmetic, or only replace.
 *
 * A number declared `state` is a label that happens to be stored as a number —
 * a triage level, a ward code. Refusing that would be the schema telling an
 * institution how to model, so it is allowed, and it means what it says: `set`
 * only.
 */
export function isQuantity(def: PropertyDef): boolean {
  const b = behaviourOf(def);
  return b === "level" || b === "rate" || b === "stock";
}

/**
 * What is wrong with this declaration, or null.
 *
 * Every rule here refuses a combination that would render a field the author
 * would then fill in and believe. A unit beside a status labels something that
 * is never measured; a minimum above a maximum admits no value at all. None of
 * them refuse an *undeclared* property: existing types have no behaviour and
 * requiring one would make this migration a breaking change for data nobody has
 * looked at yet. Undeclared is a legitimate state and the composer says so.
 */
export function propertyProblem(def: PropertyDef): string | null {
  const numeric = def.type === "number";
  const key = def.key || "this property";

  if (!numeric && def.unit !== undefined && def.unit.trim() !== "") {
    return `A unit measures a quantity, and "${key}" holds ${def.type}. Remove the unit, or change the type to number.`;
  }

  if (!numeric && def.bounds && (def.bounds.min !== null || def.bounds.max !== null)) {
    return `Bounds describe a numeric range, and "${key}" holds ${def.type}.`;
  }

  if (def.bounds && def.bounds.min !== null && def.bounds.max !== null) {
    if (def.bounds.min > def.bounds.max) {
      return `"${key}" has a minimum (${def.bounds.min}) above its maximum (${def.bounds.max}), which no value can satisfy.`;
    }
  }

  const b = def.behaviour;
  if (b && b !== "state" && !numeric) {
    return `"${b}" means the value gets multiplied or added to, and "${key}" holds ${def.type}. A non-numeric property can only be set, which is "state".`;
  }

  return null;
}

/**
 * Every problem in a schema, keyed by the row that carries it.
 *
 * Duplicate keys are checked here rather than in `propertyProblem` because they
 * are a property of the set, not of one row: two properties called `status`
 * means one silently shadows the other everywhere the schema is read as a map,
 * and the loser is decided by array order.
 */
export function schemaProblems(schema: PropertyDef[]): Map<number, string> {
  const problems = new Map<number, string>();
  const seen = new Map<string, number>();

  schema.forEach((def, i) => {
    const problem = propertyProblem(def);
    if (problem) problems.set(i, problem);

    const key = def.key.trim();
    if (!key) return;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, i);
    } else if (!problems.has(i)) {
      problems.set(i, `"${key}" is declared twice. One would shadow the other.`);
    }
  });

  return problems;
}
