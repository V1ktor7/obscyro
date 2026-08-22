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

/**
 * What the engine does with a value, when an institution asks it to.
 *
 * The last place a preset could hide. `behaviour` tells the engine how to
 * compose a number; it does not tell it that the number is a length of stay. So
 * the engine still shipped `care.stay_ticks`, `care.mortality_per_unmet` and
 * `care.consumes` — a hospital's concepts, with a hospital's default values
 * (six steps, 0.15, one bed and half a nurse), handed to every customer.
 *
 * This is the closed list that lets those go. It is a list of *mechanics the
 * engine can perform*, not of things that exist in a hospital: the engine can
 * hold a unit of demand for N steps, draw N units of an activity, and kill at
 * rate N when it cannot. What those are called, how many there are, and every
 * value they take belong to the institution.
 *
 * A type whose instances carry these becomes the care model. Nothing is
 * required: bind none of them and the engine simply has no care model of its
 * own, which is the honest state rather than a fabricated one.
 *
 * `scales_incidence` is the sixth and belongs to the other side of the run. An
 * epidemic infects a share of a population, so the engine multiplies a declared
 * incidence by a head count — arithmetic it performs, exactly like holding
 * demand for N steps. What that head count is called, and which object carries
 * it, stay with the institution: a health network sizes an RLS, a transit
 * authority sizes a catchment, and neither has to learn the other's word. The
 * export used to ship every population at size 0 with a gap explaining that the
 * ontology could not hold one. It can now.
 */
export const MECHANICS = [
  "serves_severity",
  "occupies_for",
  "dies_without",
  "consumes_activity",
  "consumes_amount",
  "scales_incidence",
] as const;

export type Mechanic = (typeof MECHANICS)[number];

/**
 * Which kind of value each mechanic needs.
 *
 * `select` mechanics name something — a severity band, an activity — and are
 * text. The rest are quantities. Binding a number to `serves_severity` would
 * produce a care model keyed by "3", which runs and matches nothing.
 */
export const MECHANIC_KIND: Record<Mechanic, "select" | "quantity"> = {
  serves_severity: "select",
  occupies_for: "quantity",
  dies_without: "quantity",
  consumes_activity: "select",
  consumes_amount: "quantity",
  scales_incidence: "quantity",
};

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
  /**
   * What the engine should do with this value. Unbound is the default and the
   * common case: a property is data first, and only a handful ever feed a
   * mechanic.
   */
  mechanic?: Mechanic;
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

  if (def.mechanic) {
    const kind = MECHANIC_KIND[def.mechanic];
    if (kind === "quantity" && !numeric) {
      return `"${def.mechanic}" feeds the engine a quantity, and "${key}" holds ${def.type}.`;
    }
    if (kind === "select" && numeric) {
      // A care model keyed by "3" runs and matches nothing — the most
      // believable failure there is.
      return `"${def.mechanic}" names something the engine matches on, so it has to be text. "${key}" holds a number.`;
    }
    if (kind === "quantity" && behaviourOf(def) === "state") {
      return `"${key}" is declared a state, so the engine cannot use it as a quantity. Give it a behaviour of level, rate or stock.`;
    }
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
  const bound = new Map<Mechanic, string>();

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

    // Two properties feeding one mechanic is the same shadowing problem a rank
    // lower: the engine reads one value, and which one is decided by array
    // order rather than by anybody.
    if (def.mechanic) {
      const already = bound.get(def.mechanic);
      if (already === undefined) {
        bound.set(def.mechanic, key);
      } else if (!problems.has(i)) {
        problems.set(
          i,
          `"${already}" is already bound to ${def.mechanic}. The engine reads one value, so the second would be ignored without saying so.`,
        );
      }
    }
  });

  return problems;
}

/**
 * What part an object plays when the engine runs.
 *
 * Lives here rather than beside the exporter because two very different callers
 * need it and neither may import the other: the exporter, to decide which
 * perturbation reaches an instance, and the metric roll-up, to count capacity
 * without knowing that this institution calls it `LitSantePhysique` and the
 * next one calls it `Bed`. A role is declared once on the type; a name is not
 * something the engine is entitled to pattern-match on.
 */
export type SimRole = "space" | "staff" | "stuff" | "systems" | "demand";

export const SIM_ROLES = ["space", "staff", "stuff", "systems", "demand"] as const;

/**
 * Property values that mean "this unit of capacity is already spoken for".
 *
 * Deliberately a short list rather than a clever rule. A site that writes
 * `status: "en réfection"` is not served by pattern-matching, and the honest
 * failure is to count it available — a visible over-count someone will
 * challenge — rather than to guess and be quietly wrong in either direction.
 *
 * One list, read by both the exporter and the metric roll-up, so a bed cannot
 * be occupied for the simulation and free on the map.
 */
export const IN_USE_VALUES = new Set([
  "occupied",
  "occupé",
  "occupee",
  "occupée",
  "occupe",
  "in_use",
  "busy",
  "unavailable",
]);

/** The property names a status may be written under. */
export const STATUS_KEYS = ["status", "state", "etat", "état"] as const;

export function isInUse(properties: Record<string, unknown>): boolean {
  for (const key of STATUS_KEYS) {
    const v = properties[key];
    if (typeof v === "string" && IN_USE_VALUES.has(v.trim().toLowerCase())) return true;
  }
  return false;
}
