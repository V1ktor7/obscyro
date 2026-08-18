import type { DbClient } from "../lib/db.js";
import type { ReadLens } from "./ontology-lens.js";
import { listInstancesForEnv, listLinksForEnv } from "./ontology.js";
import { behaviourOf, type Mechanic, type PropertyDef } from "./property-schema.js";
import { aggregationEnds, attaches, buildsHierarchy, getUnitTree } from "./twin.js";

/**
 * The twin, in the shape the simulation engine reads.
 *
 * The engine is Python and the ontology is Postgres, so something has to cross.
 * What crosses is a payload, not a database connection: the ontology's rules —
 * what a placement means, which relationship aggregates, what a type is during
 * an event — stay here, where they already live, and the engine stays a pure
 * function of its input. That is also what lets both halves be tested without
 * the other one running.
 *
 * Nothing in this file matches on a type name or a link name. Everything it
 * needs is declared: `sim_role` on the object type (migration 045) and
 * `aggregates`/`transitive` on the link type (migration 044). A hospital that
 * calls its wards *pavillons* and its placement `héberge` exports identically.
 *
 * What it cannot supply is the *care model* — what an admission consumes, and
 * how many people die when it is refused. Those are clinical and political
 * numbers, not facts about a building, so they belong to the scenario. The
 * export says so in `notes` rather than inventing a default that would quietly
 * decide every result computed from it.
 */

export interface SimResource {
  id: string;
  category: string;
  quantity: number;
  capacity: number;
  enables: string[];
}

export interface SimFacility {
  id: string;
  name: string;
  location: [number, number] | null;
  resources: Record<string, SimResource>;
  /** Patients already held, by the type that represents them. */
  census: Record<string, number>;
}

export interface SimEdge {
  source: string;
  target: string;
  kind: "transfer" | "supply" | "information";
  capacity: number;
  via: string;
}

export interface SimPopulation {
  id: string;
  name: string;
  size: number;
  served_by: string[];
}

/** A fact the export could not establish, and what it did instead. */
export interface SimGap {
  code:
    | "TYPE_WITHOUT_ROLE"
    | "NO_CARE_MODEL"
    | "ROUTE_WITHOUT_CAPACITY"
    | "POPULATION_WITHOUT_SIZE"
    | "FACILITY_WITHOUT_RESOURCES"
    | "PROPERTY_WITHOUT_BEHAVIOUR";
  message: string;
  subjects: string[];
}

/**
 * One instance from the ontology, carried whole.
 *
 * The export used to count these and throw them away: forty-eight beds became
 * "48 units of space" and every property went with them. That made a whole
 * class of event inexpressible — a bed cannot become contaminated if the engine
 * has never heard of a bed, only of a number.
 *
 * They are shipped intact instead, and the aggregates below are derived from
 * them rather than the other way round. An effect that writes
 * `status: "available" → "contaminated"` therefore changes capacity as a
 * consequence, with nothing needing to know the two are related.
 */
export interface SimObject {
  id: string;
  type: string;
  /**
   * Null for an instance that carries no simulation role but is still needed —
   * a care protocol, say, which is not space, staff, stuff or systems. Those
   * travel because their properties feed the engine's mechanics and because an
   * event has to be able to perturb them like anything else.
   */
  role: SimRole | null;
  properties: Record<string, unknown>;
  /** The unit this instance is attached to, or null if it hangs off nothing. */
  at: string | null;
}

/**
 * How to read availability off an object's own properties.
 *
 * Shipped with the data rather than hard-coded on both sides: the engine has to
 * re-derive availability every time an effect edits a property, and a rule
 * duplicated in two languages is a rule that will disagree with itself.
 */
export interface SimObjectRules {
  unavailable_keys: string[];
  unavailable_values: string[];
}

/**
 * One property, as the institution declared it.
 *
 * The engine used to carry its own list of perturbable quantities — a length of
 * stay, a mortality rate, an arrival rate — because no property in the twin held
 * a number and it needed numbers. That list is one hospital's concepts, and
 * shipping it to every institution is shipping somebody else's model.
 *
 * These cross instead. `behaviour` is the part the engine cannot do without: it
 * decides whether a value is rebuilt from a baseline each step or accumulates,
 * and the two differ by orders of magnitude while both complete without
 * complaint. Null means nobody has said, which the engine reports rather than
 * guesses.
 */
export interface SimPropertyDef {
  key: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  label: string | null;
  unit: string | null;
  min: number | null;
  max: number | null;
  behaviour: "level" | "rate" | "stock" | "state" | null;
  /**
   * What the engine should do with this value, or null.
   *
   * The last place a preset could hide: `behaviour` says how a number composes,
   * not that it is a length of stay. Without this the engine still had to ship
   * `care.stay_ticks` and its own default of six.
   */
  mechanic: Mechanic | null;
}

export interface SimObjectType {
  name: string;
  role: SimRole | null;
  properties: SimPropertyDef[];
}

export interface SimExport {
  environment: string;
  /** The scenario this was read under, or null for the live twin. */
  scenario_id: string | null;
  generated_at: string;
  facilities: SimFacility[];
  /** Every instance that plays a role, with its properties intact. */
  objects: SimObject[];
  /**
   * What the institution declared its types carry. This is the composer's
   * vocabulary and the engine's composition law, and it replaces both being
   * shipped as constants.
   */
  object_types: SimObjectType[];
  object_rules: SimObjectRules;
  populations: SimPopulation[];
  edges: SimEdge[];
  /** What is missing, named. The engine refuses to run on a blocking gap. */
  gaps: SimGap[];
}

export type SimRole = "space" | "staff" | "stuff" | "systems" | "demand";

/**
 * Property values that mean "this unit of capacity is already spoken for".
 *
 * Deliberately a short list rather than a clever rule. A site that writes
 * `status: "en réfection"` is not served by pattern-matching, and the honest
 * failure is to count it available — a visible over-count someone will
 * challenge — rather than to guess and be quietly wrong in either direction.
 */
const IN_USE_VALUES = new Set([
  "occupied",
  "occupé",
  "occupee",
  "occupée",
  "in_use",
  "busy",
  "unavailable",
]);

const STATUS_KEYS = ["status", "state", "etat", "état"];

function isInUse(properties: Record<string, unknown>): boolean {
  for (const key of STATUS_KEYS) {
    const v = properties[key];
    if (typeof v === "string" && IN_USE_VALUES.has(v.trim().toLowerCase())) return true;
  }
  return false;
}

function coordOf(properties: Record<string, unknown>): [number, number] | null {
  const lat = Number(properties.latitude ?? properties.lat);
  const lon = Number(properties.longitude ?? properties.lon ?? properties.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

/**
 * The activity a resource enables.
 *
 * Derived from the type name only as a *label* — the engine treats it as an
 * opaque token, so a wrong one costs nothing but readability, unlike a wrong
 * `sim_role`, which changes which perturbation reaches it.
 */
function activityOf(typeName: string): string {
  return typeName.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * `lens` decides *which* world is exported.
 *
 * Without it the engine can only ever stress the network as it stands today,
 * which is the smaller half of the question. A scenario holds proposed edits —
 * a new wing, a ward closed for renovation, a merger — so reading through it
 * turns "what does a flood cost us" into "what does a flood cost us *if we
 * build the wing first*". That second question is the one worth funding, and
 * every read below already accepted a lens; nothing was passing one.
 */
export async function buildTwinExport(
  db: DbClient,
  environmentId: string,
  environmentSlug: string,
  lens?: ReadLens,
): Promise<SimExport> {
  const [{ nodes }, instances, links, roleRows] = await Promise.all([
    getUnitTree(db, environmentId, lens),
    listInstancesForEnv(db, environmentId, { limit: 20000, ...lens }),
    listLinksForEnv(db, environmentId, lens),
    db.query<{ name: string; sim_role: SimRole | null; property_schema: PropertyDef[] | null }>(
      `SELECT name, sim_role, property_schema FROM app.ontology_object_types
        WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1)`,
      [environmentId],
    ),
  ]);

  const roleByType = new Map(roleRows.rows.map((r) => [r.name, r.sim_role]));

  /**
   * The declared schema, crossing whole.
   *
   * Every type travels, not only the ones that produced objects. A type with no
   * role yields no instance and therefore no effect can land on it — but the
   * engine saying "this type declares no role" is a better answer than the type
   * being absent, which reads as a typo in the ontology.
   */
  const object_types: SimObjectType[] = roleRows.rows
    .map((r) => ({
      name: r.name,
      role: r.sim_role,
      properties: (r.property_schema ?? []).map((p) => ({
        key: p.key,
        type: p.type,
        label: p.label ?? null,
        unit: p.unit ?? null,
        min: p.bounds?.min ?? null,
        max: p.bounds?.max ?? null,
        behaviour: behaviourOf(p),
        mechanic: p.mechanic ?? null,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const unitIds = new Set(nodes.map((n) => n.id));
  const instanceById = new Map(instances.map((i) => [i.id, i]));
  const gaps: SimGap[] = [];

  // What hangs off a unit becomes capacity or census there. Which of the two,
  // and under which of the four constraints, is read from the type's declared
  // role — the engine never learns the word "bed", it learns "48 units of
  // space that enable `bed`".
  // The objects themselves, kept. Anything a placement attaches to a unit and
  // whose type declares a role travels whole — id, type, properties — instead
  // of being tallied into a counter and discarded.
  const objects: SimObject[] = [];
  const typesWithoutRole = new Set<string>();

  for (const link of links) {
    if (!attaches(link)) continue;
    const { receiver: unitId, giver: instanceId } = aggregationEnds(link);
    if (!unitIds.has(unitId)) continue;
    const inst = instanceById.get(instanceId);
    // A unit placed at a site also travels this branch; it is a placement, not
    // a resource, and is picked up further down.
    if (!inst || unitIds.has(instanceId)) continue;

    const role = roleByType.get(inst.typeName) ?? null;
    if (!role) {
      typesWithoutRole.add(inst.typeName);
      continue;
    }
    objects.push({
      id: inst.id,
      type: inst.typeName,
      role,
      properties: inst.properties ?? {},
      at: unitId,
    });
  }

  /**
   * The aggregates, derived from the objects above.
   *
   * Kept in the payload because the composer and the reading panel want them,
   * but they are a *view*: computed here from the same array that ships beside
   * them, so the two cannot drift. The engine re-derives them the same way
   * after every effect, which is what makes changing a bed's status change the
   * ward's capacity without anything having to know the two are related.
   */
  interface Accum {
    role: SimRole;
    total: number;
    used: number;
  }
  const perUnit = new Map<string, Map<string, Accum>>();
  for (const o of objects) {
    // A roleless instance is never capacity — it is here because its type binds
    // a mechanic. Skipped explicitly rather than relying on it also having no
    // unit, so the two facts stay independent.
    if (!o.at || !o.role) continue;
    const byType = perUnit.get(o.at) ?? new Map<string, Accum>();
    const acc = byType.get(o.type) ?? { role: o.role, total: 0, used: 0 };
    acc.total += 1;
    if (isInUse(o.properties)) acc.used += 1;
    byType.set(o.type, acc);
    perUnit.set(o.at, byType);
  }

  // Where each unit physically sits — a placement whose receiving end is not
  // itself a unit. That is what `sited_at` is, without this file having to
  // know the word.
  const placeOfUnit = new Map<string, string>();
  for (const link of links) {
    if (!attaches(link)) continue;
    const { receiver: placeId, giver: unitId } = aggregationEnds(link);
    if (!unitIds.has(unitId) || unitIds.has(placeId)) continue;
    if (!instanceById.has(placeId)) continue;
    if (!placeOfUnit.has(unitId)) placeOfUnit.set(unitId, placeId);
  }

  const facilities: SimFacility[] = nodes.map((n) => {
    const byType = perUnit.get(n.id) ?? new Map<string, Accum>();
    const resources: Record<string, SimResource> = {};
    const census: Record<string, number> = {};
    for (const [typeName, acc] of byType) {
      const activity = activityOf(typeName);
      if (acc.role === "demand") {
        // People are not capacity. Counting patients as a resource would let a
        // ward look better staffed the fuller it got.
        census[activity] = acc.total;
        continue;
      }
      resources[activity] = {
        id: activity,
        category: acc.role,
        capacity: acc.total,
        // Free units, not total: a bed already holding someone is not capacity
        // the event can use. Starting every run with an empty hospital would
        // flatter every policy at once and rank them wrongly.
        quantity: acc.total - acc.used,
        enables: [activity],
      };
    }
    const place = placeOfUnit.get(n.id);
    const location = place ? coordOf(instanceById.get(place)?.properties ?? {}) : null;
    return { id: n.id, name: n.name, location, resources, census };
  });

  const empty = facilities.filter((f) => Object.keys(f.resources).length === 0);
  if (empty.length > 0) {
    gaps.push({
      code: "FACILITY_WITHOUT_RESOURCES",
      message:
        `${empty.length} unit(s) carry no capacity of any kind. They can be reached ` +
        `by a transfer but can never serve anyone, so a policy routing to them ` +
        `will look like it failed for the wrong reason.`,
      subjects: empty.map((f) => f.name),
    });
  }

  // Routes between units: any relationship the ontology does not treat as
  // structural. `contains` builds the hierarchy and is not a road; a placement
  // is not a road either. What remains — a declared `transfer_to` and anything
  // else built like it — is exactly the network.
  const edges: SimEdge[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (buildsHierarchy(link) || attaches(link)) continue;
    if (!unitIds.has(link.fromInstanceId) || !unitIds.has(link.toInstanceId)) continue;
    const key = `${link.fromInstanceId}>${link.toInstanceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      source: link.fromInstanceId,
      target: link.toInstanceId,
      kind: "transfer",
      // The ontology models no throughput on a relationship. Zero blocks the
      // route rather than granting it infinite width — a policy that evacuates
      // a city in one tick is worse than one that visibly cannot move anybody.
      capacity: 0,
      via: link.linkTypeName,
    });
  }
  if (edges.length > 0) {
    gaps.push({
      code: "ROUTE_WITHOUT_CAPACITY",
      message:
        `${edges.length} route(s) exported with capacity 0: no relationship in the ` +
        `ontology carries a throughput. Every transfer policy will be unable to move ` +
        `anyone until these are set.`,
      subjects: [...new Set(edges.map((e) => e.via))],
    });
  }

  // Populations, one per place, serving the units sited there. Derived from
  // placement — the ontology holds no catchment and no head count.
  const unitsByPlace = new Map<string, string[]>();
  for (const [unitId, placeId] of placeOfUnit) {
    unitsByPlace.set(placeId, [...(unitsByPlace.get(placeId) ?? []), unitId]);
  }
  const populations: SimPopulation[] = [...unitsByPlace].map(([placeId, units]) => {
    const p = instanceById.get(placeId);
    const name = String(p?.properties.name ?? p?.properties.code ?? placeId.slice(0, 8));
    return {
      id: `pop:${placeId}`,
      name,
      // Zero, not a plausible-looking guess. A fabricated catchment would set
      // the scale of every scenario run against this export, and nobody would
      // ever go back and check a number that already looked reasonable.
      size: 0,
      served_by: units,
    };
  });
  if (populations.length > 0) {
    gaps.push({
      code: "POPULATION_WITHOUT_SIZE",
      message:
        `${populations.length} population(s) were derived from placement, each with ` +
        `size 0. The ontology records no catchment, so demand has to be sized in the ` +
        `scenario.`,
      subjects: populations.map((p) => p.name),
    });
  }

  /**
   * Instances whose type binds a mechanic, whether or not anything placed them.
   *
   * A care protocol is not space, staff, stuff or systems, and nothing attaches
   * it to a ward — so the placement walk above, which is how every other object
   * gets here, misses it entirely. It still has to cross: its properties are
   * what the engine reads instead of the length of stay it used to ship, and an
   * event has to be able to perturb it like any other object.
   *
   * Appended after the placement walk and de-duplicated, because a type may
   * legitimately do both — a bed that also declared a mechanic would otherwise
   * arrive twice and be counted twice.
   */
  const bindsMechanic = new Set(
    object_types.filter((t) => t.properties.some((p) => p.mechanic !== null)).map((t) => t.name),
  );
  const alreadyExported = new Set(objects.map((o) => o.id));
  for (const inst of instances) {
    if (!bindsMechanic.has(inst.typeName)) continue;
    if (alreadyExported.has(inst.id)) continue;
    if (unitIds.has(inst.id)) continue;
    objects.push({
      id: inst.id,
      type: inst.typeName,
      role: roleByType.get(inst.typeName) ?? null,
      properties: inst.properties ?? {},
      // Deliberately null even when a placement exists: this instance is not
      // capacity anywhere, and giving it a unit would make `derive_resources`
      // count it as one.
      at: null,
    });
  }

  if (typesWithoutRole.size > 0) {
    gaps.push({
      code: "TYPE_WITHOUT_ROLE",
      message:
        `${typesWithoutRole.size} type(s) are attached to units but declare no simulation ` +
        `role, so nothing they represent enters the simulation. Set a role on the ` +
        `object type to include them.`,
      subjects: [...typesWithoutRole].sort(),
    });
  }

  /**
   * Numeric properties nobody has declared a behaviour for.
   *
   * Named as a gap rather than defaulted, for the same reason the export refuses
   * to invent a catchment size: 40 beds, 40 arrivals a day and 40 people waiting
   * are the same JSON, and a default would be right one time in three and silent
   * the other two. An effect cannot compose on these until somebody says which
   * they are, and the composer needs to be able to explain why.
   */
  const undeclared = object_types.flatMap((t) =>
    t.properties.filter((p) => p.behaviour === null).map((p) => `${t.name}.${p.key}`),
  );
  if (undeclared.length > 0) {
    gaps.push({
      code: "PROPERTY_WITHOUT_BEHAVIOUR",
      message:
        `${undeclared.length} numeric propert${undeclared.length === 1 ? "y" : "ies"} ` +
        `carr${undeclared.length === 1 ? "ies" : "y"} no declared behaviour. Values are ` +
        `stored and read as usual, but no effect can multiply or add to them until the ` +
        `object type says whether they rebuild each step or accumulate.`,
      subjects: undeclared.sort(),
    });
  }

  gaps.push({
    code: "NO_CARE_MODEL",
    message:
      "The ontology says what exists, not what an admission consumes or how many " +
      "people die when it is refused. Those come from the scenario.",
    subjects: [],
  });

  return {
    environment: environmentSlug,
    scenario_id: lens?.scenarioId ?? null,
    generated_at: new Date().toISOString(),
    facilities,
    objects,
    object_types,
    // The rule travels with the data so the engine can re-read availability
    // after an effect edits a property, without either side owning a second
    // copy that could disagree.
    object_rules: {
      unavailable_keys: [...STATUS_KEYS],
      unavailable_values: [...IN_USE_VALUES],
    },
    populations,
    edges,
    gaps,
  };
}
