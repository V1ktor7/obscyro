import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { listActions } from "./analyst-actions.js";
import { OPTION_TOOLS } from "./analyst-options.js";
import { READ_TOOLS, type AnalystTool } from "./analyst-tools.js";
import { WEB_SEARCH } from "./analyst-web.js";
import { listDatasets, previewRows } from "./datasets.js";
import { listFunctionTypes, toolOf, type FunctionOffer, type FunctionReads, type FunctionType, type ObjectRead, type Stand, type Standing } from "./function-types.js";
import { listInstancesForEnv, listLinksForEnv } from "./ontology.js";
import { aggregationEnds, attaches, getUnitTree, type LinkBehaviour, type TwinUnitNode } from "./twin.js";
import { readReadingsBetween } from "./twin-history.js";
import { listTwinMetrics } from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// What a declared reading tool reads, from the database.
//
// `function-types.ts` knows the blocks and nothing of where their rows come
// from. This file hands them the project's own readers, the same ones the
// rest of the product reads with: the ontology's objects with their ceiling,
// the units of the twin, the measures it keeps, the kept readings, the
// datasets. Each is read at most once for an exchange.
//
// Reality only: a declared tool reads the twin as it stands, never through a
// scenario.
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  organizationId: string;
}

/**
 * Where each object stands, from what was read.
 *
 * The same rules the unit pages and the map follow, so a count by unit or by
 * site cannot disagree with them. An object stands at the unit an attaching
 * link gives it to (the first one, when there are several). A unit stands at
 * the physical thing an attaching link places it at, or at the place of the
 * nearest unit above it. When the ontology calls nothing physical, a site is
 * the top of the unit's tree, as on the map.
 */
export function standingFrom(
  nodes: readonly Pick<TwinUnitNode, "id" | "name" | "parentId">[],
  links: readonly (LinkBehaviour & { fromInstanceId: string; toInstanceId: string })[],
  physical: readonly { id: string; name: string }[],
  partial = false,
): Standing {
  const unitById = new Map(nodes.map((n) => [n.id, n]));
  const placeById = new Map(physical.map((p) => [p.id, p]));
  const attachedTo = new Map<string, string>();
  const placedAt = new Map<string, string>();
  for (const link of links) {
    if (!attaches(link)) continue;
    const { receiver, giver } = aggregationEnds(link);
    if (unitById.has(receiver) && !attachedTo.has(giver)) attachedTo.set(giver, receiver);
    if (unitById.has(giver) && placeById.has(receiver) && !placedAt.has(giver)) placedAt.set(giver, receiver);
  }
  const unitFor = (objectId: string): string | null => (unitById.has(objectId) ? objectId : (attachedTo.get(objectId) ?? null));
  const siteOfUnit = (unitId: string): Stand | null => {
    // The `seen` set stops a mis-ingested cycle of units from spinning here.
    const seen = new Set<string>();
    let cur: string | null = unitId;
    let top = unitId;
    while (cur && !seen.has(cur)) {
      const place = placedAt.get(cur);
      if (place) return { id: place, name: placeById.get(place)!.name };
      seen.add(cur);
      top = cur;
      cur = unitById.get(cur)?.parentId ?? null;
    }
    return placeById.size === 0 ? { id: top, name: unitById.get(top)!.name } : null;
  };
  return {
    unitOf(objectId) {
      const id = unitFor(objectId);
      const u = id ? unitById.get(id) : undefined;
      return u ? { id: u.id, name: u.name, under: u.parentId ? (unitById.get(u.parentId)?.name ?? null) : null } : null;
    },
    siteOf(objectId) {
      const self = placeById.get(objectId);
      if (self) return { id: self.id, name: self.name };
      const unit = unitFor(objectId);
      return unit ? siteOfUnit(unit) : null;
    },
    partial,
  };
}

/** A site's name, as the map writes it. */
function siteName(o: ObjectRead): string {
  for (const key of ["name", "display", "label", "identifier"]) {
    const v = o.properties[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return o.typeName;
}

/** The names a declared tool cannot take: every tool written in the code. */
export const CODE_TOOL_NAMES: ReadonlySet<string> = new Set([...READ_TOOLS, ...OPTION_TOOLS, listActions].map((t) => t.name).concat(WEB_SEARCH, "give_answer", "give_options", "give_events"));

export function functionReads(db: DbClient, env: Project): FunctionReads {
  const cap = config.rollupInstanceCap;
  const objects = new Map<string, Promise<{ rows: ObjectRead[]; capped: boolean }>>();
  const rows = new Map<string, Promise<{ rows: Record<string, unknown>[]; capped: boolean }>>();
  let tree: ReturnType<typeof getUnitTree> | null = null;
  let standing: Promise<Standing> | null = null;
  let metrics: Promise<{ key: string; label: string }[]> | null = null;
  let datasets: ReturnType<FunctionReads["datasets"]> | null = null;
  const unitTree = () => (tree ??= getUnitTree(db, env.id));
  const objectsOf = (type: string) => {
    let p = objects.get(type);
    if (!p) {
      // One more than the ceiling: a read that reaches it says so rather than passing for the whole.
      p = listInstancesForEnv(db, env.id, { type, limit: cap + 1 }).then((all) => ({
        rows: all.slice(0, cap).map((i) => ({ id: i.id, typeName: i.typeName, simRole: i.simRole, properties: i.properties })),
        capped: all.length > cap,
      }));
      objects.set(type, p);
    }
    return p;
  };
  return {
    objects: objectsOf,
    units: () => unitTree().then((t) => t.nodes.map((n) => ({ id: n.id, name: n.name }))),
    standing() {
      standing ??= (async () => {
        // A site is an instance of a type the institution called physical: the notion the map uses.
        const physicalTypes = await db.query<{ name: string }>(
          `SELECT name FROM app.ontology_object_types
            WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1) AND nature = 'physical'
            ORDER BY name`,
          [env.id],
        );
        const [t, links, sites] = await Promise.all([unitTree(), listLinksForEnv(db, env.id), Promise.all(physicalTypes.rows.map((r) => objectsOf(r.name)))]);
        return standingFrom(
          t.nodes,
          links,
          sites.flatMap((s) => s.rows.map((o) => ({ id: o.id, name: siteName(o) }))),
          sites.some((s) => s.capped),
        );
      })();
      return standing;
    },
    metrics() {
      metrics ??= listTwinMetrics(db, env.organizationId).then((all) => all.map((m) => ({ key: m.key, label: m.label })));
      return metrics;
    },
    history: (unitId, metric, from, to) => readReadingsBetween(db, env.id, unitId, metric, from, to),
    datasets() {
      datasets ??= listDatasets(db, env.id).then((all) => all.map((d) => ({ id: d.id, name: d.name, slug: d.slug, columns: d.columnSchema.map((c) => c.name) })));
      return datasets;
    },
    rows(datasetId) {
      let p = rows.get(datasetId);
      if (!p) {
        p = previewRows(db, datasetId, cap + 1).then((all) => ({ rows: all.slice(0, cap), capped: all.length > cap }));
        rows.set(datasetId, p);
      }
      return p;
    },
  };
}

/** What the project holds that a function type can point at: object types with their properties, kept measures, datasets. */
export async function functionOffer(db: DbClient, env: Project): Promise<FunctionOffer> {
  const [types, reads] = [
    db.query<{ name: string; property_schema: { key: string }[] | null }>(
      `SELECT name, property_schema FROM app.ontology_object_types
        WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
        ORDER BY name`,
      [env.id],
    ),
    functionReads(db, env),
  ];
  const [{ rows }, metrics, datasets] = await Promise.all([types, reads.metrics(), reads.datasets()]);
  return { objectTypes: rows.map((r) => ({ name: r.name, properties: (r.property_schema ?? []).map((p) => p.key) })), metrics, datasets };
}

/**
 * The project's active function types, as tools of the analyst.
 *
 * One whose name a tool of the code has since taken is left out: the code's
 * tool is the tested one, and two tools under one name is one the model cannot
 * tell apart.
 */
export async function declaredTools(db: DbClient, env: Project): Promise<{ tools: AnalystTool[]; types: FunctionType[] }> {
  const { types } = await listFunctionTypes(db, env.id);
  const reads = functionReads(db, env);
  return { tools: types.filter((t) => t.active && !CODE_TOOL_NAMES.has(t.key)).map((t) => toolOf(t, reads)), types };
}
