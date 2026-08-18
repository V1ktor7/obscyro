/**
 * What a property declaration means, said in the editor rather than after the
 * save.
 *
 * The rules here mirror `backend/src/services/property-schema.ts`, which is the
 * authority: a save that gets past this file and not past that one is refused
 * and the server's message is shown. The duplication buys the thing that makes
 * this an editor rather than a form — you find out that a unit beside a status
 * is meaningless while you are typing it, not three screens later.
 *
 * Nothing here knows what a bed is. `behaviour` is four words about arithmetic,
 * and it is the only closed list in a property declaration.
 */

export const PROPERTY_TYPES = ["string", "number", "boolean", "object", "array"] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * What the engine should do with a value — the last place a preset could hide.
 *
 * `behaviour` says how a number composes; it does not say the number is a
 * length of stay. So the engine still shipped `care.stay_ticks`,
 * `care.mortality_per_unmet` and `care.consumes`, with a hospital's defaults
 * baked in, handed to every institution that opened the product.
 *
 * A type whose instances bind these becomes the care model. Binding nothing is
 * fine and is the default.
 */
export const MECHANICS = [
  "serves_severity",
  "occupies_for",
  "dies_without",
  "consumes_activity",
  "consumes_amount",
] as const;

export type Mechanic = (typeof MECHANICS)[number];

/** Which kind of value each mechanic needs: text it matches on, or a quantity. */
export const MECHANIC_KIND: Record<Mechanic, "select" | "quantity"> = {
  serves_severity: "select",
  occupies_for: "quantity",
  dies_without: "quantity",
  consumes_activity: "select",
  consumes_amount: "quantity",
};

/**
 * Said as what the engine will do with the number, not as what it is called.
 *
 * "Length of stay" is a definition and assumes a hospital. "Holds what it
 * consumes for this many steps before releasing it" is the mechanic, and a
 * transit authority can read it and decide whether anything of theirs behaves
 * that way.
 */
export const MECHANIC_LABEL: Record<Mechanic, string> = {
  serves_severity: "Names the band this row describes",
  occupies_for: "How many steps one unit of demand holds what it consumes",
  dies_without: "Losses per unserved unit, per step",
  consumes_activity: "Names what it draws on",
  consumes_amount: "How much of that it draws, per unit per step",
};

export const PROPERTY_BEHAVIOURS = ["level", "rate", "stock", "state"] as const;

export type PropertyBehaviour = (typeof PROPERTY_BEHAVIOURS)[number];

export interface PropertyBounds {
  min: number | null;
  max: number | null;
}

export interface PropertyDefinition {
  key: string;
  type: PropertyType;
  label?: string;
  required?: boolean;
  unit?: string;
  bounds?: PropertyBounds | null;
  behaviour?: PropertyBehaviour;
  mechanic?: Mechanic;
}

/**
 * What each behaviour changes, said as a consequence rather than a definition.
 *
 * "A level is a standing quantity" tells you nothing you could get wrong.
 * "Two effects halving it land as one halving, not a quarter" tells you which
 * one you meant.
 */
export const BEHAVIOUR_HINT: Record<PropertyBehaviour | "", string> = {
  "": "Undeclared. The value is stored and read like any other, but no effect can be composed on it, because nothing says whether it rebuilds each step or accumulates.",
  level:
    "How many of something there is. Rebuilt from the ontology every step, then effects apply to that — so two effects halving it land as one halving, not a quarter, and a closed wing reopens when the effect ends.",
  rate: "How fast something is produced, per step. An effect on it changes the flow, not the amount already there.",
  stock:
    "A running total nothing rebuilds — a queue, a backlog. Effects add to it or take from it; halving it does nothing, because there is no prior value at this address to halve.",
  state:
    "Not a quantity. An effect replaces the value outright — healthy becomes sick — and no arithmetic applies to it.",
};

export const BEHAVIOUR_LABEL: Record<PropertyBehaviour, string> = {
  level: "Level — a standing amount",
  rate: "Rate — an amount per step",
  stock: "Stock — a running total",
  state: "State — a label, not a number",
};

/** See the backend module: only a number is genuinely ambiguous. */
export function behaviourOf(def: PropertyDefinition): PropertyBehaviour | null {
  if (def.behaviour) return def.behaviour;
  return def.type === "number" ? null : "state";
}

/**
 * Which behaviours a type can honestly carry.
 *
 * A string cannot be multiplied, so offering `level` on one would be a menu
 * entry whose only outcome is a refused save. A number gets all four: a triage
 * level is a category stored as a number, and refusing that would be the editor
 * telling an institution how to model its own data.
 */
export function behavioursFor(type: PropertyType): readonly PropertyBehaviour[] {
  return type === "number" ? PROPERTY_BEHAVIOURS : (["state"] as const);
}

export function isQuantity(def: PropertyDefinition): boolean {
  const b = behaviourOf(def);
  return b === "level" || b === "rate" || b === "stock";
}

export function propertyProblem(def: PropertyDefinition): string | null {
  const numeric = def.type === "number";
  const key = def.key || "this property";

  if (!numeric && def.unit !== undefined && def.unit.trim() !== "") {
    return `A unit measures a quantity, and "${key}" holds ${def.type}. Remove the unit, or change the type to number.`;
  }
  if (!numeric && def.bounds && (def.bounds.min !== null || def.bounds.max !== null)) {
    return `Bounds describe a numeric range, and "${key}" holds ${def.type}.`;
  }
  if (
    def.bounds &&
    def.bounds.min !== null &&
    def.bounds.max !== null &&
    def.bounds.min > def.bounds.max
  ) {
    return `"${key}" has a minimum (${def.bounds.min}) above its maximum (${def.bounds.max}), which no value can satisfy.`;
  }
  if (def.behaviour && def.behaviour !== "state" && !numeric) {
    return `"${def.behaviour}" means the value gets multiplied or added to, and "${key}" holds ${def.type}. A non-numeric property can only be set, which is "state".`;
  }
  if (def.mechanic) {
    const kind = MECHANIC_KIND[def.mechanic];
    if (kind === "quantity" && !numeric) {
      return `"${def.mechanic}" feeds the engine a quantity, and "${key}" holds ${def.type}.`;
    }
    if (kind === "select" && numeric) {
      // A care model keyed by "3" runs and matches nothing.
      return `"${def.mechanic}" names something the engine matches on, so it has to be text. "${key}" holds a number.`;
    }
    if (kind === "quantity" && behaviourOf(def) === "state") {
      return `"${key}" is declared a state, so the engine cannot use it as a quantity. Give it a behaviour of level, rate or stock.`;
    }
  }
  return null;
}

/** Problems that belong to the set rather than to one row. */
export function schemaProblems(schema: PropertyDefinition[]): Map<number, string> {
  const problems = new Map<number, string>();
  const seen = new Map<string, number>();
  const bound = new Map<Mechanic, string>();

  schema.forEach((def, i) => {
    const problem = propertyProblem(def);
    if (problem) problems.set(i, problem);

    const key = def.key.trim();
    if (!key) return;
    if (!seen.has(key)) {
      seen.set(key, i);
    } else if (!problems.has(i)) {
      problems.set(i, `"${key}" is declared twice. One would shadow the other.`);
    }

    // The same shadowing a rank lower: the engine reads one value per mechanic,
    // and which one is decided by array order rather than by anybody.
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
 * The one-line summary on a collapsed row.
 *
 * Exists so a schema can be read at a glance for the thing that actually
 * matters now — which properties an event could act on — without expanding
 * every row. A property with nothing declared says so, because "" would read as
 * "fine" and it is the state that stops an effect from existing.
 */
export function describeProperty(def: PropertyDefinition): string {
  const parts: string[] = [];
  const behaviour = behaviourOf(def);

  if (behaviour === null) {
    parts.push("no behaviour");
  } else if (def.type === "number") {
    // On a string, `state` is derived rather than chosen, so printing it adds a
    // word to every row and tells nobody anything.
    parts.push(behaviour);
  }

  if (def.unit && def.unit.trim()) parts.push(def.unit.trim());

  const { min = null, max = null } = def.bounds ?? {};
  if (min !== null && max !== null) parts.push(`${min}–${max}`);
  else if (min !== null) parts.push(`≥ ${min}`);
  else if (max !== null) parts.push(`≤ ${max}`);

  if (def.required) parts.push("required");
  // Last, and deliberately spelled out: a bound property is one the engine
  // reads directly, which is a bigger fact about it than its unit.
  if (def.mechanic) parts.push(`→ ${def.mechanic}`);

  return parts.join(" · ");
}

/** Strip what the type no longer supports, so a change of mind cannot leave a
 * contradiction behind that only surfaces as a refused save. */
export function retypeProperty(def: PropertyDefinition, type: PropertyType): PropertyDefinition {
  if (type === def.type) return def;
  if (type === "number") return { ...def, type };
  const next: PropertyDefinition = { ...def, type };
  delete next.unit;
  delete next.bounds;
  // `state` survives — it is the only behaviour the new type can carry, and
  // dropping it would silently undeclare a property that was declared.
  if (next.behaviour !== "state") delete next.behaviour;
  // A quantity mechanic cannot survive the move to text. Left behind, it would
  // only surface as a refused save with the field that caused it now hidden.
  if (next.mechanic && MECHANIC_KIND[next.mechanic] === "quantity") delete next.mechanic;
  return next;
}
