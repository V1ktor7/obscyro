import type { DbClient } from "../lib/db.js";
import { listInstancesForEnv, listLinksForEnv } from "./ontology.js";
import { aggregationEnds, attaches, buildsHierarchy, getUnitTree } from "./twin.js";

/**
 * The twin, in the shape the crisis engine reads.
 *
 * The engine is Python and the ontology is Postgres, so something has to cross.
 * What crosses is a payload, not a database connection: the ontology's rules —
 * what a placement means, which relationship aggregates, what a type is during
 * a crisis — stay here, where they already live, and the engine stays a pure
 * function of its input. That is also what lets both halves be tested without
 * the other one running.
 *
 * Nothing in this file matches on a type name or a link name. Everything it
 * needs is declared: `crisis_role` on the object type (migration 045) and
 * `aggregates`/`transitive` on the link type (migration 044). A hospital that
 * calls its wards *pavillons* and its placement `héberge` exports identically.
 *
 * What it cannot supply is the *care model* — what an admission consumes, and
 * how many people die when it is refused. Those are clinical and political
 * numbers, not facts about a building, so they belong to the scenario. The
 * export says so in `notes` rather than inventing a default that would quietly
 * decide every result computed from it.
 */

export interface CrisisResource {
  id: string;
  category: string;
  quantity: number;
  capacity: number;
  enables: string[];
}

export interface CrisisFacility {
  id: string;
  name: string;
  location: [number, number] | null;
  resources: Record<string, CrisisResource>;
  /** Patients already held, by the type that represents them. */
  census: Record<string, number>;
}

export interface CrisisEdge {
  source: string;
  target: string;
  kind: "transfer" | "supply" | "information";
  capacity: number;
  via: string;
}

export interface CrisisPopulation {
  id: string;
  name: string;
  size: number;
  served_by: string[];
}

/** A fact the export could not establish, and what it did instead. */
export interface CrisisGap {
  code:
    | "TYPE_WITHOUT_ROLE"
    | "NO_CARE_MODEL"
    | "ROUTE_WITHOUT_CAPACITY"
    | "POPULATION_WITHOUT_SIZE"
    | "FACILITY_WITHOUT_RESOURCES";
  message: string;
  subjects: string[];
}

export interface CrisisExport {
  environment: string;
  generated_at: string;
  facilities: CrisisFacility[];
  populations: CrisisPopulation[];
  edges: CrisisEdge[];
  /** What is missing, named. The engine refuses to run on a blocking gap. */
  gaps: CrisisGap[];
}

export type CrisisRole = "space" | "staff" | "stuff" | "systems" | "demand";

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
 * `crisis_role`, which changes which perturbation reaches it.
 */
function activityOf(typeName: string): string {
  return typeName.trim().toLowerCase().replace(/\s+/g, "_");
}

export async function buildCrisisExport(
  db: DbClient,
  environmentId: string,
  environmentSlug: string,
): Promise<CrisisExport> {
  const [{ nodes }, instances, links, roleRows] = await Promise.all([
    getUnitTree(db, environmentId),
    listInstancesForEnv(db, environmentId, { limit: 20000 }),
    listLinksForEnv(db, environmentId),
    db.query<{ name: string; crisis_role: CrisisRole | null }>(
      `SELECT name, crisis_role FROM app.ontology_object_types
        WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1)`,
      [environmentId],
    ),
  ]);

  const roleByType = new Map(roleRows.rows.map((r) => [r.name, r.crisis_role]));
  const unitIds = new Set(nodes.map((n) => n.id));
  const instanceById = new Map(instances.map((i) => [i.id, i]));
  const gaps: CrisisGap[] = [];

  // What hangs off a unit becomes capacity or census there. Which of the two,
  // and under which of the four constraints, is read from the type's declared
  // role — the engine never learns the word "bed", it learns "48 units of
  // space that enable `bed`".
  interface Accum {
    role: CrisisRole;
    total: number;
    used: number;
  }
  const perUnit = new Map<string, Map<string, Accum>>();
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
    const byType = perUnit.get(unitId) ?? new Map<string, Accum>();
    const acc = byType.get(inst.typeName) ?? { role, total: 0, used: 0 };
    acc.total += 1;
    if (isInUse(inst.properties)) acc.used += 1;
    byType.set(inst.typeName, acc);
    perUnit.set(unitId, byType);
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

  const facilities: CrisisFacility[] = nodes.map((n) => {
    const byType = perUnit.get(n.id) ?? new Map<string, Accum>();
    const resources: Record<string, CrisisResource> = {};
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
        // the crisis can use. Starting every run with an empty hospital would
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
  const edges: CrisisEdge[] = [];
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
  const populations: CrisisPopulation[] = [...unitsByPlace].map(([placeId, units]) => {
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

  if (typesWithoutRole.size > 0) {
    gaps.push({
      code: "TYPE_WITHOUT_ROLE",
      message:
        `${typesWithoutRole.size} type(s) are attached to units but declare no crisis ` +
        `role, so nothing they represent enters the simulation. Set a role on the ` +
        `object type to include them.`,
      subjects: [...typesWithoutRole].sort(),
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
    generated_at: new Date().toISOString(),
    facilities,
    populations,
    edges,
    gaps,
  };
}
