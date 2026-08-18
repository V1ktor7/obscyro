/**
 * What the composer is allowed to offer for one object property.
 *
 * Everything here is read from the twin's declared schema. The engine used to
 * publish a catalogue of quantities it had invented — a length of stay, a
 * mortality rate, an arrival rate per thousand — and the form rendered whatever
 * that list said. Those are one hospital's concepts. A school board opening this
 * screen was being handed somebody else's model and asked to fill it in.
 *
 * So the operations, the unit, the range and the kind of input all come from the
 * property the author picked, and this file contains no property names, no
 * units, and no defaults for either.
 */

import type { PropertyBehaviour, SimEffect, SimExport, SimPropertyDef } from "@/lib/platform-api";

export type Op = SimEffect["op"];

/**
 * Which operations compose meaningfully against a value that behaves this way.
 *
 * `null` — nobody declared a behaviour — allows only `set`, and that is the
 * whole point rather than an oversight: `set` reads no prior value, so it is
 * well-defined without knowing whether the number rebuilds or accumulates.
 * Arithmetic is not, and the engine refuses it before the run starts.
 */
export function opsFor(behaviour: PropertyBehaviour | null): Op[] {
  if (behaviour === "state" || behaviour === null) return ["set"];
  // `multiply` is offered on a stock as well as a level. On a stock it composes
  // against the running value, which is a decay — "the backlog sheds half of
  // itself each step" is a real model, not a mistake.
  return ["multiply", "add", "set"];
}

export interface ResolvedProperty {
  key: string;
  /** The declaration, when every selected type agrees on one. */
  def: SimPropertyDef | null;
  behaviour: PropertyBehaviour | null;
  /** Types that carry this key and the behaviour each declares for it. */
  declaredBy: Array<{ type: string; behaviour: PropertyBehaviour | null }>;
  /**
   * Two selected types declare the same key differently, so one effect would
   * compose two ways at once. Named rather than resolved: picking one would
   * silently apply the wrong law to half the objects.
   */
  conflict: string | null;
  /** Declared nowhere among the selected types. */
  undeclared: boolean;
}

/** The object types an effect can land on, given its selection. */
export function typesInScope(snapshot: SimExport, chosen: string[]): string[] {
  const declared = (snapshot.object_types ?? []).map((t) => t.name);
  // Instances decide the scope, not the type list: a declared type with no
  // instances is not something an effect can reach.
  const present = new Set((snapshot.objects ?? []).map((o) => o.type));
  const inPlay = declared.filter((t) => present.has(t));
  return chosen.length === 0 ? inPlay : inPlay.filter((t) => chosen.includes(t));
}

/**
 * Every property the selected types declare, with the types that declare it.
 *
 * This is the composer's picker. It is a *closed* list, unlike the old one,
 * which suggested whatever keys the instances happened to carry — an effect
 * could name a key nothing declared and be inert in the most convincing way
 * available: it selected real objects, ran without error, and changed nothing.
 */
export function declaredProperties(
  snapshot: SimExport,
  chosen: string[],
): ResolvedProperty[] {
  const scope = new Set(typesInScope(snapshot, chosen));
  const keys = new Set<string>();
  for (const t of snapshot.object_types ?? []) {
    if (!scope.has(t.name)) continue;
    for (const p of t.properties) keys.add(p.key);
  }
  return Array.from(keys)
    .sort()
    .map((key) => resolveProperty(snapshot, chosen, key));
}

export function resolveProperty(
  snapshot: SimExport,
  chosen: string[],
  key: string | null | undefined,
): ResolvedProperty {
  const empty: ResolvedProperty = {
    key: key ?? "",
    def: null,
    behaviour: null,
    declaredBy: [],
    conflict: null,
    undeclared: true,
  };
  if (!key) return empty;

  const scope = new Set(typesInScope(snapshot, chosen));
  const declaredBy: Array<{ type: string; behaviour: PropertyBehaviour | null }> = [];
  const defs: SimPropertyDef[] = [];
  for (const t of snapshot.object_types ?? []) {
    if (!scope.has(t.name)) continue;
    const def = t.properties.find((p) => p.key === key);
    if (!def) continue;
    declaredBy.push({ type: t.name, behaviour: def.behaviour });
    defs.push(def);
  }
  if (defs.length === 0) return empty;

  const behaviours = new Set(declaredBy.map((d) => d.behaviour));
  const conflict =
    behaviours.size > 1
      ? `${declaredBy
          .map((d) => `${d.type} declares it ${d.behaviour ?? "undeclared"}`)
          .join(", ")}. One effect cannot compose two ways at once — narrow it to one kind of object.`
      : null;

  return {
    key,
    def: defs[0]!,
    behaviour: conflict ? null : (defs[0]!.behaviour ?? null),
    declaredBy,
    conflict,
    undeclared: false,
  };
}

/** Whether the value field should take text or a number. */
export function valueKind(resolved: ResolvedProperty, op: Op): "text" | "number" {
  if (op !== "set") return "number";
  // A number declared a state is still a number — a triage level, a ward code.
  // Handing it a text field would let someone type a word into a field the
  // engine will read as a figure.
  return resolved.def?.type === "number" ? "number" : "text";
}

/**
 * Why this property cannot be changed the way the effect says.
 *
 * Returned as a sentence for the card, not thrown: the author is mid-edit, and
 * an effect that is briefly contradictory while they change the operation is
 * normal. It becomes a save-blocking problem through `eventProblems`.
 */
export function propertyProblem(resolved: ResolvedProperty, op: Op): string | null {
  if (resolved.conflict) return resolved.conflict;
  if (!resolved.key) return null;
  if (resolved.undeclared) {
    return `No selected object type declares a property called “${resolved.key}”. The effect would select real objects, run without error and change nothing.`;
  }
  if (op === "set") return null;
  if (resolved.behaviour === "state") {
    return `“${resolved.key}” is declared a state, so it can be set but not ${op === "add" ? "added to" : "multiplied"}.`;
  }
  if (resolved.behaviour === null) {
    return `“${resolved.key}” has no declared behaviour, so there is no way to tell whether ${op === "add" ? "adding to" : "multiplying"} it should compose against a value that rebuilds each step or one that accumulates. Declare it on the object type, or set the value outright.`;
  }
  return null;
}

/** The unit to show beside the value field, or a fallback label. */
export function valueLabel(resolved: ResolvedProperty, op: Op): string {
  if (op === "set") return "New value";
  return resolved.def?.unit?.trim() || "Value";
}

/** A short line describing what the picked property is, for under the picker. */
export function describeDeclaration(resolved: ResolvedProperty): string {
  if (resolved.conflict) return resolved.conflict;
  if (!resolved.key) return "";
  if (resolved.undeclared) {
    return "Declared by none of the selected types.";
  }
  const def = resolved.def!;
  const parts: string[] = [def.type];
  if (resolved.behaviour) parts.push(resolved.behaviour);
  else if (def.type === "number") parts.push("no behaviour declared");
  if (def.unit?.trim()) parts.push(def.unit.trim());
  if (def.min !== null && def.max !== null) parts.push(`${def.min}–${def.max}`);
  else if (def.min !== null) parts.push(`≥ ${def.min}`);
  else if (def.max !== null) parts.push(`≤ ${def.max}`);
  const on = resolved.declaredBy.map((d) => d.type).join(", ");
  return `${parts.join(" · ")} — on ${on}.`;
}
