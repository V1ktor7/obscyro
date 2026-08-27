import { clampLimit, clampOffset, config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
import type { ReadLens } from "./ontology-lens.js";
import { evaluateMetric, metricsForRollup } from "./twin-metrics.js";
import {
  getOrCreateLinkType,
  getOrCreateObjectType,
  insertLinkInstance,
  insertObjectInstance,
  listInstancesForEnv,
  listLinksForEnv,
  type PropertyDef,
} from "./ontology.js";

export const ORG_UNIT_TYPE = "OrgUnit";
export const CONTAINS_LINK = "contains";
export const LOCATED_IN_LINK = "located_in";
export const LOCATED_IN_BED_LINK = "located_in_bed";

export const LOCATED_IN_LINK_NAMES = [LOCATED_IN_LINK, LOCATED_IN_BED_LINK] as const;

/**
 * What a link means to the engine, read from the link type rather than its name.
 *
 * The names above are what this codebase happens to seed. They are not what the
 * engine matches on: an institution modelling « se trouve dans » or « rattache a »
 * used to get no roll-up at all, silently, because three strings were written
 * into the code. Migration 044 moved the meaning onto the link type, where the
 * institution can attach it to whatever it calls the relation.
 */
export interface LinkBehaviour {
  aggregates: "metrics" | null;
  aggregateToward: "source" | "target" | null;
  transitive: boolean;
}

/**
 * A link that carries a hierarchy: something flows along it, and it chains.
 * `CHUM contains Notre-Dame contains Emergency` — the beds two levels down have
 * to reach the top, or the parent reads zero.
 */
export function buildsHierarchy(l: LinkBehaviour): boolean {
  return l.aggregates === "metrics" && l.transitive;
}

/**
 * A link that attaches one thing to another without chaining. A bed is in a
 * ward; there is no bed inside a bed, so the chain has no second link to make.
 */
export function attaches(l: LinkBehaviour): boolean {
  return l.aggregates === "metrics" && !l.transitive;
}

/**
 * Which end the numbers flow to.
 *
 * `A contains B` and `B part_of A` describe the same tree with the arrow
 * reversed. Without this, a naming convention turns the hierarchy upside down
 * and the top of the org reads as a leaf.
 */
export function aggregationEnds(l: LinkBehaviour & { fromInstanceId: string; toInstanceId: string }): {
  /** The end that receives — parent, or the node an instance attaches to. */
  receiver: string;
  /** The end that gives. */
  giver: string;
} {
  return l.aggregateToward === "source"
    ? { receiver: l.fromInstanceId, giver: l.toInstanceId }
    : { receiver: l.toInstanceId, giver: l.fromInstanceId };
}

export const ORG_UNIT_SCHEMA: PropertyDef[] = [
  { key: "name", type: "string", label: "Name" },
  { key: "kind", type: "string", label: "Kind" },
  { key: "code", type: "string", label: "Code" },
];

export const BED_SCHEMA: PropertyDef[] = [
  { key: "label", type: "string", label: "Label" },
  { key: "status", type: "string", label: "Status" },
];

export type TwinAlertSeverity = "info" | "warn" | "critical";
export type TwinAlertOp = "<" | ">" | ">=" | "<=" | "==";
export type TwinAlertStatus = "open" | "ack";

export interface TwinUnitNode {
  id: string;
  name: string;
  kind: string;
  code: string;
  parentId: string | null;
}

export interface TwinTreeEdge {
  fromId: string;
  toId: string;
}

export interface UnitMetrics {
  unitId: string;
  instanceCountByType: Record<string, number>;
  /** Every metric the organization has defined, by key. */
  values: Record<string, number | null>;
  /** Kept for callers that name it directly; it is `values.occupancy`. */
  occupancyPct: number | null;
  numericMeans: Record<string, number>;
  freshnessSeconds: number | null;
  linkedInstanceCount: number;
}

export interface TwinAlertRuleRow {
  id: string;
  environmentId: string;
  unitKind: string | null;
  metric: string;
  op: TwinAlertOp;
  threshold: number;
  severity: TwinAlertSeverity;
  messageTemplate: string;
  recommendationTemplate: string;
}

export interface TwinAlertRow {
  id: string;
  environmentId: string;
  unitInstanceId: string;
  ruleId: string | null;
  severity: TwinAlertSeverity;
  metric: string;
  value: number;
  message: string;
  recommendation: string;
  status: TwinAlertStatus;
  createdAt: Date;
  ackedAt: Date | null;
  /** True only when this evaluation newly opened the alert (vs. refreshed it). */
  isNew?: boolean;
}

export interface TwinSchemaIds {
  orgUnitTypeId: string;
  patientTypeId: string;
  bedTypeId: string;
  containsLinkTypeId: string;
  locatedInLinkTypeId: string;
  locatedInBedLinkTypeId: string;
}

export async function seedTwinSchema(
  db: DbClient,
  environmentId: string,
): Promise<TwinSchemaIds> {
  const orgUnitTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    ORG_UNIT_TYPE,
    "Organizational unit in the digital twin",
    ORG_UNIT_SCHEMA,
  );
  const patientTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "Patient",
    "Patient located in org units",
    [{ key: "identifier", type: "string" }, { key: "label", type: "string" }],
  );
  const bedTypeId = await getOrCreateObjectType(
    db,
    environmentId,
    "Bed",
    "Bed located in org units",
    BED_SCHEMA,
  );
  const containsLinkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    CONTAINS_LINK,
    orgUnitTypeId,
    orgUnitTypeId,
    "many_to_many",
    // The hierarchy: numbers flow to the containing unit, and it chains, so a
    // bed two levels down still counts at the top.
    { aggregates: "metrics", aggregateToward: "source", transitive: true },
  );
  const locatedInLinkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    LOCATED_IN_LINK,
    patientTypeId,
    orgUnitTypeId,
    "many_to_many",
    // A patient attaches to a unit. Nothing to chain: there is no patient
    // inside a patient.
    { aggregates: "metrics", aggregateToward: "target", transitive: false },
  );
  const locatedInBedLinkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    LOCATED_IN_BED_LINK,
    bedTypeId,
    orgUnitTypeId,
    "many_to_many",
    { aggregates: "metrics", aggregateToward: "target", transitive: false },
  );
  return {
    orgUnitTypeId,
    patientTypeId,
    bedTypeId,
    containsLinkTypeId,
    locatedInLinkTypeId,
    locatedInBedLinkTypeId,
  };
}

export async function getUnitTree(
  db: DbClient,
  environmentId: string,
  lens?: ReadLens,
): Promise<{ nodes: TwinUnitNode[]; edges: TwinTreeEdge[]; roots: string[] }> {
  const instances = await listInstancesForEnv(db, environmentId, {
    type: ORG_UNIT_TYPE,
    limit: config.rollupInstanceCap,
    ...lens,
  });
  const links = await listLinksForEnv(db, environmentId, lens);
  const unitIds = new Set(instances.map((i) => i.id));

  const edges: TwinTreeEdge[] = [];
  const parentByChild = new Map<string, string>();
  for (const link of links) {
    if (!buildsHierarchy(link)) continue;
    if (!unitIds.has(link.fromInstanceId) || !unitIds.has(link.toInstanceId)) continue;
    // The parent is whichever end the type says receives — so `A contains B`
    // and `B part_of A` build the same tree.
    const { receiver: parent, giver: child } = aggregationEnds(link);
    edges.push({ fromId: parent, toId: child });
    // First parent wins; the tree is a forest, multiple parents are ignored
    // deterministically by insertion order.
    if (!parentByChild.has(child)) {
      parentByChild.set(child, parent);
    }
  }

  const childIds = new Set(edges.map((e) => e.toId));
  const nodes: TwinUnitNode[] = instances.map((i) => ({
    id: i.id,
    name: String(i.properties.name ?? i.properties.code ?? i.id.slice(0, 8)),
    kind: String(i.properties.kind ?? "org"),
    code: String(i.properties.code ?? ""),
    parentId: parentByChild.get(i.id) ?? null,
  }));

  const roots = nodes.filter((n) => !childIds.has(n.id)).map((n) => n.id);
  return { nodes, edges, roots };
}

function buildDescendantMap(
  unitIds: Set<string>,
  edges: TwinTreeEdge[],
): Map<string, Set<string>> {
  const children = new Map<string, string[]>();
  for (const id of unitIds) children.set(id, []);
  for (const e of edges) {
    if (!unitIds.has(e.fromId) || !unitIds.has(e.toId)) continue;
    children.get(e.fromId)!.push(e.toId);
  }

  const descendants = new Map<string, Set<string>>();
  function walk(id: string): Set<string> {
    const cached = descendants.get(id);
    if (cached) return cached;
    const set = new Set<string>([id]);
    for (const child of children.get(id) ?? []) {
      for (const d of walk(child)) set.add(d);
    }
    descendants.set(id, set);
    return set;
  }
  for (const id of unitIds) walk(id);
  return descendants;
}

function emptyMetrics(unitId: string): UnitMetrics {
  return {
    unitId,
    instanceCountByType: {},
    values: {},
    occupancyPct: null,
    numericMeans: {},
    freshnessSeconds: null,
    linkedInstanceCount: 0,
  };
}


export async function rollupAllUnits(
  db: DbClient,
  environmentId: string,
  lens?: ReadLens,
): Promise<Map<string, UnitMetrics>> {
  const { nodes, edges } = await getUnitTree(db, environmentId, lens);
  const unitIds = new Set(nodes.map((n) => n.id));
  const descendants = buildDescendantMap(unitIds, edges);

  const allInstances = await listInstancesForEnv(db, environmentId, {
    limit: config.rollupInstanceCap,
    ...lens,
  });
  const links = await listLinksForEnv(db, environmentId, lens);
  const now = Date.now();

  const { rows: orgRows } = await db.query<{ organization_id: string }>(
    `SELECT organization_id FROM app.project WHERE id = $1`,
    [environmentId],
  );
  const metricDefs = orgRows[0]?.organization_id
    ? await metricsForRollup(db, orgRows[0].organization_id)
    : [];

  const instanceById = new Map(allInstances.map((i) => [i.id, i]));

  const locatedInByUnit = new Map<string, typeof allInstances>();
  for (const link of links) {
    if (!attaches(link)) continue;
    // The unit is the receiving end; the instance is the one that gives.
    const { receiver: unitId, giver: instanceId } = aggregationEnds(link);
    if (!unitIds.has(unitId)) continue;
    const inst = instanceById.get(instanceId);
    if (!inst) continue;
    const list = locatedInByUnit.get(unitId) ?? [];
    list.push(inst);
    locatedInByUnit.set(unitId, list);
  }

  const metricsByUnit = new Map<string, UnitMetrics>();

  for (const unitId of unitIds) {
    const desc = descendants.get(unitId) ?? new Set([unitId]);
    const linked: typeof allInstances = [];
    for (const d of desc) {
      linked.push(...(locatedInByUnit.get(d) ?? []));
    }

    const m = emptyMetrics(unitId);
    m.linkedInstanceCount = linked.length;

    let newest: Date | null = null;
    const numericAcc = new Map<string, { sum: number; count: number }>();

    for (const inst of linked) {
      m.instanceCountByType[inst.typeName] =
        (m.instanceCountByType[inst.typeName] ?? 0) + 1;

      if (!newest || inst.updatedAt > newest) newest = inst.updatedAt;

      for (const prop of inst.propertySchema) {
        if (prop.type !== "number") continue;
        const val = inst.properties[prop.key];
        if (typeof val !== "number" || !Number.isFinite(val)) continue;
        const acc = numericAcc.get(prop.key) ?? { sum: 0, count: 0 };
        acc.sum += val;
        acc.count++;
        numericAcc.set(prop.key, acc);
      }
    }

    // Every metric is evaluated over the unit's whole subtree, which is what
    // `linked` already holds — so a hospital's occupancy is its wards' occupied
    // beds over its wards' total beds. No second pass, and nothing to average.
    for (const def of metricDefs) {
      m.values[def.key] = evaluateMetric(def, linked);
    }
    m.occupancyPct = m.values.occupancy ?? null;

    if (newest) m.freshnessSeconds = Math.round((now - newest.getTime()) / 1000);
    for (const [key, acc] of numericAcc) {
      m.numericMeans[key] = acc.sum / acc.count;
    }

    metricsByUnit.set(unitId, m);
  }


  return metricsByUnit;
}

/**
 * Which placed units a site should actually count.
 *
 * The whole point of this function is not to count a ward twice. Notre-Dame the
 * building holds five units: the hospital, its emergency, a ward, a lab and a
 * pharmacy. But the emergency is *inside* the hospital, so the hospital's
 * subtree already contains its 48 beds — adding the emergency separately would
 * report 96.
 *
 * So a unit is counted only when no ancestor of it sits at the same place. Kept
 * pure and apart from the query because this is exactly the arithmetic that was
 * wrong in the roll-up removed in 84601a5, and it deserves to be checkable
 * without a database.
 */
export function topmostPlacements(
  placedAt: ReadonlyMap<string, string>,
  parentOf: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const byPlace = new Map<string, string[]>();
  for (const [unitId, placeId] of placedAt) {
    // The `seen` set is not defensive programming: `contains` is transitive and
    // a mis-ingested cycle would otherwise spin here forever.
    const seen = new Set<string>([unitId]);
    let covered = false;
    let cur = parentOf.get(unitId);
    while (cur && !seen.has(cur)) {
      if (placedAt.get(cur) === placeId) {
        covered = true;
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    if (covered) continue;
    const list = byPlace.get(placeId) ?? [];
    list.push(unitId);
    byPlace.set(placeId, list);
  }
  return byPlace;
}

/** What a place's numbers are made of, so the number can explain itself. */
export interface PlaceRollup {
  metrics: UnitMetrics;
  /**
   * The units counted, and only the topmost ones. A ward placed at a site whose
   * hospital is placed at the same site is already inside that hospital's
   * subtree — listing both would double its beds.
   */
  contributingUnits: { id: string; name: string }[];
}

/**
 * The place axis.
 *
 * The same beds answer two different questions. « How many beds does the CHUM
 * run » follows the organisation, through `contains`. « How many beds are in
 * this building » follows the placement, through whatever the institution
 * declared — `sited_at` here. An institute affiliated with the CHUM but housed
 * elsewhere counts in the first and not the second, and three labs in one
 * building are three rows in the hierarchy and one dot on the map.
 *
 * Metrics are **recomputed** over the union of instances rather than combined
 * from the units' own numbers. Occupancy is occupied over total; averaging two
 * wards' percentages would weight a four-bed room like a forty-bed one. That
 * mistake shipped once already, in the roll-up pass removed in 84601a5.
 *
 * Costs one more read of instances and links than the tree does. Kept separate
 * and obvious rather than threaded through `rollupAllUnits`, because the two
 * axes have to stay independently checkable.
 */
export async function rollupPlaces(
  db: DbClient,
  environmentId: string,
  lens?: ReadLens,
): Promise<Map<string, PlaceRollup>> {
  const { nodes, edges } = await getUnitTree(db, environmentId, lens);
  const unitIds = new Set(nodes.map((n) => n.id));
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const descendants = buildDescendantMap(unitIds, edges);
  const parentOf = new Map(edges.map((e) => [e.toId, e.fromId]));

  const allInstances = await listInstancesForEnv(db, environmentId, {
    limit: config.rollupInstanceCap,
    ...lens,
  });
  const links = await listLinksForEnv(db, environmentId, lens);
  const instanceById = new Map(allInstances.map((i) => [i.id, i]));

  // A place is an instance of a type the institution called physical. Nature is
  // the same notion the map already uses to decide what is a site, so the two
  // cannot disagree.
  const { rows: physicalTypes } = await db.query<{ name: string }>(
    `SELECT name FROM app.ontology_object_types
      WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
        AND nature = 'physical'`,
    [environmentId],
  );
  const physicalTypeNames = new Set(physicalTypes.map((r) => r.name));

  // unit -> place, from any link that attaches and lands on a physical thing.
  const placedAt = new Map<string, string>();
  for (const link of links) {
    if (!attaches(link)) continue;
    const { receiver: placeId, giver: unitId } = aggregationEnds(link);
    if (!unitIds.has(unitId)) continue;
    const place = instanceById.get(placeId);
    if (!place || !physicalTypeNames.has(place.typeName)) continue;
    // First placement wins, deterministically: a unit sits in one building.
    if (!placedAt.has(unitId)) placedAt.set(unitId, placeId);
  }

  const topmostByPlace = topmostPlacements(placedAt, parentOf);

  // Instances hanging off each unit, by the same rule the tree uses.
  const attachedToUnit = new Map<string, typeof allInstances>();
  for (const link of links) {
    if (!attaches(link)) continue;
    const { receiver: unitId, giver: instanceId } = aggregationEnds(link);
    if (!unitIds.has(unitId)) continue;
    const inst = instanceById.get(instanceId);
    if (!inst) continue;
    const list = attachedToUnit.get(unitId) ?? [];
    list.push(inst);
    attachedToUnit.set(unitId, list);
  }

  const { rows: orgRows } = await db.query<{ organization_id: string }>(
    `SELECT organization_id FROM app.project WHERE id = $1`,
    [environmentId],
  );
  const metricDefs = orgRows[0]?.organization_id
    ? await metricsForRollup(db, orgRows[0].organization_id)
    : [];

  const now = Date.now();
  const out = new Map<string, PlaceRollup>();

  for (const [placeId, units] of topmostByPlace) {
    const linked: typeof allInstances = [];
    for (const unitId of units) {
      for (const d of descendants.get(unitId) ?? new Set([unitId])) {
        linked.push(...(attachedToUnit.get(d) ?? []));
      }
    }

    const m = emptyMetrics(placeId);
    m.linkedInstanceCount = linked.length;

    let newest: Date | null = null;
    const numericAcc = new Map<string, { sum: number; count: number }>();
    for (const inst of linked) {
      m.instanceCountByType[inst.typeName] = (m.instanceCountByType[inst.typeName] ?? 0) + 1;
      if (!newest || inst.updatedAt > newest) newest = inst.updatedAt;
      for (const prop of inst.propertySchema) {
        if (prop.type !== "number") continue;
        const val = inst.properties[prop.key];
        if (typeof val !== "number" || !Number.isFinite(val)) continue;
        const acc = numericAcc.get(prop.key) ?? { sum: 0, count: 0 };
        acc.sum += val;
        acc.count++;
        numericAcc.set(prop.key, acc);
      }
    }

    for (const def of metricDefs) m.values[def.key] = evaluateMetric(def, linked);
    m.occupancyPct = m.values.occupancy ?? null;
    if (newest) m.freshnessSeconds = Math.round((now - newest.getTime()) / 1000);
    for (const [key, acc] of numericAcc) m.numericMeans[key] = acc.sum / acc.count;

    out.set(placeId, {
      metrics: m,
      contributingUnits: units.map((id) => ({ id, name: nameById.get(id) ?? id })),
    });
  }

  return out;
}

export interface UnitExchange {
  linkType: string;
  direction: "out" | "in";
  otherUnitId: string;
  otherUnitName: string;
  count: number;
}

/**
 * What a unit exchanges with other units, and by which link.
 *
 * The tree draws `contains` and nothing else, so every other link between two
 * units — a transfer route, a supply line, a data feed — is invisible on it.
 * Overlaying them would turn a hierarchy into a hairball; naming them on the
 * unit you are reading answers the same question without that cost.
 *
 * Counted per (link type, direction, other unit): a route used forty times is
 * one relationship, not forty.
 */
export async function unitExchanges(
  db: DbClient,
  environmentId: string,
  unitId: string,
): Promise<UnitExchange[]> {
  const { nodes } = await getUnitTree(db, environmentId);
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const links = await listLinksForEnv(db, environmentId);

  const seen = new Map<string, UnitExchange>();
  for (const l of links) {
    // The hierarchy is not an exchange between units; it is what makes them one.
    if (buildsHierarchy(l)) continue;
    const isOut = l.fromInstanceId === unitId;
    const isIn = l.toInstanceId === unitId;
    if (!isOut && !isIn) continue;
    const otherId = isOut ? l.toInstanceId : l.fromInstanceId;
    // Only unit-to-unit: a bed pointing at its ward is the hierarchy again,
    // seen from below, and the metrics panel already counts those.
    if (!nameById.has(otherId)) continue;

    const key = `${l.linkTypeName}|${isOut ? "out" : "in"}|${otherId}`;
    const found = seen.get(key);
    if (found) found.count++;
    else {
      seen.set(key, {
        linkType: l.linkTypeName,
        direction: isOut ? "out" : "in",
        otherUnitId: otherId,
        otherUnitName: nameById.get(otherId) ?? "unit",
        count: 1,
      });
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) =>
      a.linkType.localeCompare(b.linkType) || a.otherUnitName.localeCompare(b.otherUnitName),
  );
}

export async function rollupUnit(
  db: DbClient,
  environmentId: string,
  unitId: string,
): Promise<UnitMetrics> {
  const all = await rollupAllUnits(db, environmentId);
  const m = all.get(unitId);
  if (!m) throw NotFound("UNIT_NOT_FOUND", "OrgUnit not found in this environment.");
  return m;
}

function metricValue(metrics: UnitMetrics, metric: string): number | null {
  // A user-defined metric wins: an alert rule that names `occupancy` should
  // follow the definition the institution edited, not a built-in of the same
  // name.
  if (metric in metrics.values) return metrics.values[metric] ?? null;
  if (metric === "occupancyPct") return metrics.occupancyPct;
  if (metric === "linkedInstanceCount") return metrics.linkedInstanceCount;
  if (metric === "freshnessSeconds") return metrics.freshnessSeconds;
  if (metric.startsWith("count:")) {
    const type = metric.slice("count:".length);
    return metrics.instanceCountByType[type] ?? 0;
  }
  if (metric.startsWith("mean:")) {
    const key = metric.slice("mean:".length);
    return metrics.numericMeans[key] ?? null;
  }
  return metrics.numericMeans[metric] ?? null;
}

function compareOp(op: TwinAlertOp, value: number, threshold: number): boolean {
  switch (op) {
    case "<":
      return value < threshold;
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    default:
      return false;
  }
}

export interface TemplateContext {
  unit: string;
  value: number;
  threshold: number;
}

/**
 * Fill an alert message.
 *
 * Both brace styles are accepted on purpose. The engine shipped reading
 * `{{value}}`; the alert-rule panel documents and pre-fills `{value}`. Rules
 * exist in both forms, and a message that renders its own placeholder to a
 * clinician — "Occupation critique à {unit} — {value}%" — is worse than one
 * that never mentioned the unit at all.
 *
 * `{unit}` is new. It was documented before it existed: fillTemplate only ever
 * received the value and the threshold, so the unit's name had nowhere to come
 * from.
 *
 * An unknown key is left as written rather than blanked, so a typo is visible
 * instead of silently producing a gap in a sentence.
 */
export function fillTemplate(tpl: string, ctx: TemplateContext): string {
  const subs: Record<string, string> = {
    unit: ctx.unit,
    value: String(Math.round(ctx.value * 100) / 100),
    threshold: String(ctx.threshold),
  };
  return tpl.replace(/\{\{?(\w+)\}?\}/g, (whole, key: string) => subs[key] ?? whole);
}

export async function listAlertRules(
  db: DbClient,
  environmentId: string,
): Promise<TwinAlertRuleRow[]> {
  const { rows } = await db.query<{
    id: string;
    project_id: string;
    unit_kind: string | null;
    metric: string;
    op: TwinAlertOp;
    threshold: string;
    severity: TwinAlertSeverity;
    message_template: string;
    recommendation_template: string;
  }>(
    `SELECT id, project_id, unit_kind, metric, op, threshold::text,
            severity, message_template, recommendation_template
       FROM app.twin_alert_rule
      WHERE project_id = $1
      ORDER BY created_at ASC`,
    [environmentId],
  );
  return rows.map((r) => ({
    id: r.id,
    environmentId: r.project_id,
    unitKind: r.unit_kind,
    metric: r.metric,
    op: r.op,
    threshold: Number(r.threshold),
    severity: r.severity,
    messageTemplate: r.message_template,
    recommendationTemplate: r.recommendation_template,
  }));
}

export async function evaluateAlerts(
  db: DbClient,
  environmentId: string,
  metricsByUnit: Map<string, UnitMetrics>,
  unitKinds: Map<string, string>,
  unitNames: Map<string, string>,
  rules?: TwinAlertRuleRow[],
): Promise<TwinAlertRow[]> {
  const activeRules = rules ?? (await listAlertRules(db, environmentId));
  const created: TwinAlertRow[] = [];

  for (const [unitId, metrics] of metricsByUnit) {
    const kind = unitKinds.get(unitId) ?? null;
    for (const rule of activeRules) {
      if (rule.unitKind && rule.unitKind !== kind) continue;
      const val = metricValue(metrics, rule.metric);
      if (val == null) continue;
      if (!compareOp(rule.op, val, rule.threshold)) continue;

      const ctx = {
        unit: unitNames.get(unitId) ?? "this unit",
        value: val,
        threshold: rule.threshold,
      };
      const message = fillTemplate(rule.messageTemplate, ctx);
      const recommendation = fillTemplate(rule.recommendationTemplate, ctx);

      // Idempotent: at most one OPEN alert per (env, unit, rule). The 5s SSE/poll
      // loop refreshes the existing row instead of inserting a duplicate every
      // tick. `inserted` (xmax = 0) tells callers which alerts are genuinely new
      // so the UI can toast only those.
      const { rows } = await db.query<{
        id: string;
        created_at: Date;
        inserted: boolean;
      }>(
        `INSERT INTO app.twin_alert
           (project_id, unit_instance_id, rule_id, severity, metric, value, message, recommendation, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
         ON CONFLICT (project_id, unit_instance_id, rule_id) WHERE status = 'open'
         DO UPDATE SET severity = EXCLUDED.severity,
                       metric = EXCLUDED.metric,
                       value = EXCLUDED.value,
                       message = EXCLUDED.message,
                       recommendation = EXCLUDED.recommendation
         RETURNING id, created_at, (xmax = 0) AS inserted`,
        [
          environmentId,
          unitId,
          rule.id,
          rule.severity,
          rule.metric,
          val,
          message,
          recommendation,
        ],
      );
      created.push({
        id: rows[0]!.id,
        environmentId,
        unitInstanceId: unitId,
        ruleId: rule.id,
        severity: rule.severity,
        metric: rule.metric,
        value: val,
        message,
        recommendation,
        status: "open",
        createdAt: rows[0]!.created_at,
        ackedAt: null,
        isNew: rows[0]!.inserted,
      });
    }
  }
  return created;
}

export async function listOpenAlerts(
  db: DbClient,
  environmentId: string,
  unitId?: string,
  page?: { limit?: number; offset?: number },
): Promise<TwinAlertRow[]> {
  const params: unknown[] = [environmentId];
  let sql = `SELECT id, project_id, unit_instance_id, rule_id, severity, metric,
                    value::text, message, recommendation, status, created_at, acked_at
               FROM app.twin_alert
              WHERE project_id = $1 AND status = 'open'`;
  if (unitId) {
    params.push(unitId);
    sql += ` AND unit_instance_id = $${params.length}`;
  }
  const limit = clampLimit(page?.limit);
  const offset = clampOffset(page?.offset);
  params.push(limit);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  params.push(offset);
  sql += ` OFFSET $${params.length}`;

  const { rows } = await db.query<{
    id: string;
    project_id: string;
    unit_instance_id: string;
    rule_id: string | null;
    severity: TwinAlertSeverity;
    metric: string;
    value: string;
    message: string;
    recommendation: string;
    status: TwinAlertStatus;
    created_at: Date;
    acked_at: Date | null;
  }>(sql, params);

  return rows.map((r) => ({
    id: r.id,
    environmentId: r.project_id,
    unitInstanceId: r.unit_instance_id,
    ruleId: r.rule_id,
    severity: r.severity,
    metric: r.metric,
    value: Number(r.value),
    message: r.message,
    recommendation: r.recommendation,
    status: r.status,
    createdAt: r.created_at,
    ackedAt: r.acked_at,
  }));
}

export async function ackAlert(
  db: DbClient,
  environmentId: string,
  alertId: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE app.twin_alert SET status = 'ack', acked_at = NOW()
      WHERE id = $1 AND project_id = $2`,
    [alertId, environmentId],
  );
  if (!rowCount) throw NotFound("ALERT_NOT_FOUND", "Twin alert not found.");
}

export function worstSeverity(
  alerts: TwinAlertRow[],
): TwinAlertSeverity | null {
  const order: TwinAlertSeverity[] = ["critical", "warn", "info"];
  for (const sev of order) {
    if (alerts.some((a) => a.severity === sev)) return sev;
  }
  return null;
}

export async function createAlertRule(
  db: DbClient,
  environmentId: string,
  userId: string,
  organizationId: string,
  body: {
    unitKind?: string | null;
    metric: string;
    op: TwinAlertOp;
    threshold: number;
    severity: TwinAlertSeverity;
    messageTemplate: string;
    recommendationTemplate?: string;
  },
): Promise<TwinAlertRuleRow> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.twin_alert_rule
       (project_id, unit_kind, metric, op, threshold, severity,
        message_template, recommendation_template, owner_user_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      environmentId,
      body.unitKind ?? null,
      body.metric,
      body.op,
      body.threshold,
      body.severity,
      body.messageTemplate,
      body.recommendationTemplate ?? "",
      userId,
      organizationId,
    ],
  );
  const rules = await listAlertRules(db, environmentId);
  return rules.find((r) => r.id === rows[0]!.id)!;
}

export async function updateAlertRule(
  db: DbClient,
  environmentId: string,
  ruleId: string,
  patch: Partial<{
    unitKind: string | null;
    metric: string;
    op: TwinAlertOp;
    threshold: number;
    severity: TwinAlertSeverity;
    messageTemplate: string;
    recommendationTemplate: string;
  }>,
): Promise<TwinAlertRuleRow> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE app.twin_alert_rule
        SET unit_kind = COALESCE($3, unit_kind),
            metric = COALESCE($4, metric),
            op = COALESCE($5, op),
            threshold = COALESCE($6, threshold),
            severity = COALESCE($7, severity),
            message_template = COALESCE($8, message_template),
            recommendation_template = COALESCE($9, recommendation_template)
      WHERE id = $1 AND project_id = $2
      RETURNING id`,
    [
      ruleId,
      environmentId,
      patch.unitKind,
      patch.metric,
      patch.op,
      patch.threshold,
      patch.severity,
      patch.messageTemplate,
      patch.recommendationTemplate,
    ],
  );
  if (!rows[0]) throw NotFound("RULE_NOT_FOUND", "Alert rule not found.");
  const rules = await listAlertRules(db, environmentId);
  return rules.find((r) => r.id === ruleId)!;
}

export async function deleteAlertRule(
  db: DbClient,
  environmentId: string,
  ruleId: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM app.twin_alert_rule WHERE id = $1 AND project_id = $2`,
    [ruleId, environmentId],
  );
  if (!rowCount) throw NotFound("RULE_NOT_FOUND", "Alert rule not found.");
}

export async function getTwinTreeSnapshot(db: DbClient, environmentId: string, lens?: ReadLens) {
  const tree = await getUnitTree(db, environmentId, lens);
  const metricsByUnit = await rollupAllUnits(db, environmentId, lens);
  const unitKinds = new Map(tree.nodes.map((n) => [n.id, n.kind]));
  const unitNames = new Map(tree.nodes.map((n) => [n.id, n.name]));
  await evaluateAlerts(db, environmentId, metricsByUnit, unitKinds, unitNames);
  const openAlerts = await listOpenAlerts(db, environmentId, undefined, {
    limit: config.listMaxLimit,
  });

  const units = tree.nodes.map((node) => {
    const metrics = metricsByUnit.get(node.id);
    const unitAlerts = openAlerts.filter((a) => a.unitInstanceId === node.id);
    return {
      ...node,
      metrics: metrics ?? emptyMetrics(node.id),
      worstAlertSeverity: worstSeverity(unitAlerts),
      openAlertCount: unitAlerts.length,
    };
  });

  return {
    computedAt: new Date().toISOString(),
    nodes: units,
    edges: tree.edges,
    roots: tree.roots,
  };
}

/**
 * Network-level twin. Sites are instances of object types tagged
 * nature='physical' (the principled selection), plus the twin tree's root
 * units as a fallback so environments without nature tags keep working.
 *
 * Flows are ontology link instances connecting two sites. A flow's lane *is*
 * its link type — there is no classification step. There used to be one: a
 * regex sorted link names into patient / supply / data / other, which meant a
 * network modelling "transfert inter-établissement" got a lane only because
 * the word "transfer" happened to be in the pattern, and one modelling
 * "corridor de services" got "other". The map's layers are whatever the
 * institution put in its ontology, and `layers` reports them so the client
 * does not have to infer the list from the flows it happens to have received.
 */
export async function getTwinNetwork(db: DbClient, environmentId: string) {
  const snapshot = await getTwinTreeSnapshot(db, environmentId);
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));

  const physical = await db.query<{
    id: string;
    type_name: string;
    properties: Record<string, unknown>;
  }>(
    `SELECT oi.id, t.name AS type_name, oi.properties
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1) AND t.nature = 'physical'
      ORDER BY oi.created_at ASC
      LIMIT 500`,
    [environmentId],
  );
  const physicalById = new Map(physical.rows.map((r) => [r.id, r]));

  // A fallback, and now actually one.
  //
  // This used to be a union: physical instances *plus* the tree's roots. So an
  // environment that tagged its natures got both, and the same hospital
  // appeared twice — once as a geolocated building with no metrics, once as an
  // org unit with metrics and no coordinates. That is where "22 sites" and
  // "13 sites without coordinates" came from: the second list is organisational
  // units, which have no reason to hold a latitude.
  //
  // Roots are used only when nothing is tagged physical, which is what the
  // fallback was always for.
  const siteIds =
    physicalById.size > 0 ? Array.from(physicalById.keys()) : Array.from(snapshot.roots);

  // Numbers on the place axis: what is *in* this building, however many
  // organisational units that spans.
  const places = await rollupPlaces(db, environmentId);

  const coords = new Map<string, { latitude: number | null; longitude: number | null }>();
  const propsById = new Map<string, Record<string, unknown>>();
  // The object type each site is an instance of. `kind` cannot stand in for it:
  // for a twin-tree node it is the instance's `kind` *property* ("hospital",
  // "ward"), and only the physical fallback puts a type name there. Anything
  // deciding which link types may connect two sites needs the real type.
  const typeById = new Map<string, string>();
  if (siteIds.length > 0) {
    const { rows } = await db.query<{
      id: string;
      properties: Record<string, unknown>;
      type_name: string;
    }>(
      `SELECT oi.id, oi.properties, t.name AS type_name
         FROM app.ontology_object_instances oi
         JOIN app.ontology_object_types t ON t.id = oi.object_type_id
        WHERE oi.id = ANY($1::uuid[])`,
      [siteIds],
    );
    for (const r of rows) {
      const p = r.properties ?? {};
      propsById.set(r.id, p);
      typeById.set(r.id, r.type_name);
      const num = (...keys: string[]): number | null => {
        for (const k of keys) {
          const v = Number(p[k]);
          if (Number.isFinite(v) && v !== 0) return v;
        }
        return null;
      };
      coords.set(r.id, {
        latitude: num("latitude", "lat"),
        longitude: num("longitude", "lng", "lon"),
      });
    }
  }

  const siteName = (id: string): string => {
    const p = propsById.get(id) ?? {};
    for (const key of ["name", "display", "label", "identifier"]) {
      if (typeof p[key] === "string" && (p[key] as string).trim()) return p[key] as string;
    }
    return physicalById.get(id)?.type_name ?? "Site";
  };

  const sites = siteIds.map((id) => {
    const node = nodeById.get(id);
    const phys = physicalById.get(id);
    const place = places.get(id);
    const base = node ?? {
      id,
      name: siteName(id),
      kind: phys?.type_name ?? "site",
      code: "",
      parentId: null,
      // A building's own numbers come from what is placed in it, not from a
      // tree it does not belong to.
      metrics: place?.metrics ?? emptyMetrics(id),
      worstAlertSeverity: null,
      openAlertCount: 0,
    };
    return {
      ...base,
      objectType: typeById.get(id) ?? null,
      latitude: coords.get(id)?.latitude ?? null,
      longitude: coords.get(id)?.longitude ?? null,
      // Where the number came from. A configurable aggregation that cannot show
      // its working is a machine for producing plausible wrong answers, and
      // this map has produced two of those already.
      //
      // A site that is itself a unit contributes itself. Twins that separate
      // the building from the service running in it have a placement link and
      // this is a list of what stands there; twins that do not — an ontology
      // whose installations carry their own coordinates — have no placement to
      // read, and returning nothing left the replay unable to join a run back
      // to the map. Every site drew grey while the counters climbed.
      contributingUnits:
        place?.contributingUnits ??
        (node ? [{ id, name: node.name }] : []),
    };
  });

  let flows: {
    id: string;
    linkType: string;
    fromId: string;
    toId: string;
  }[] = [];
  if (siteIds.length > 1) {
    const { rows } = await db.query<{
      id: string;
      link_type: string;
      from_instance_id: string;
      to_instance_id: string;
    }>(
      `SELECT li.id, lt.name AS link_type, li.from_instance_id, li.to_instance_id
         FROM app.ontology_link_instances li
         JOIN app.ontology_link_types lt ON lt.id = li.link_type_id
        WHERE lt.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
          AND li.from_instance_id = ANY($2::uuid[])
          AND li.to_instance_id = ANY($2::uuid[])
          AND li.from_instance_id <> li.to_instance_id
          AND li.valid_to IS NULL`,
      [environmentId, siteIds],
    );
    flows = rows.map((r) => ({
      id: r.id,
      linkType: r.link_type,
      fromId: r.from_instance_id,
      toId: r.to_instance_id,
    }));
  }

  const counts = new Map<string, number>();
  for (const f of flows) counts.set(f.linkType, (counts.get(f.linkType) ?? 0) + 1);
  const layers = Array.from(counts, ([linkType, count]) => ({ linkType, count })).sort(
    (a, b) => a.linkType.localeCompare(b.linkType),
  );

  return { computedAt: snapshot.computedAt, sites, flows, layers };
}

export async function seedTwinDemo(
  db: DbClient,
  environmentId: string,
  userId: string,
  orgId: string,
): Promise<{ unitCount: number; instanceCount: number }> {
  void userId;
  void orgId;
  const schema = await seedTwinSchema(db, environmentId);

  // Idempotent: clear any previous demo data first, otherwise every click
  // stacks another CHUM tree on top of the last one. Links cascade with the
  // instances they connect.
  await db.query(
    `DELETE FROM app.ontology_object_instances oi
       USING app.ontology_object_types t
      WHERE oi.object_type_id = t.id
        AND t.organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
        AND oi.provenance->>'source' = 'twin-demo'`,
    [environmentId],
  );

  async function mkUnit(name: string, kind: string, code: string): Promise<string> {
    return insertObjectInstance(
      db,
      schema.orgUnitTypeId,
      { name, kind, code },
      { source: "twin-demo" },
    );
  }

  const root = await mkUnit("CHUM", "org", "CHUM");
  const h1 = await mkUnit("Hôpital Notre-Dame", "hospital", "HND");
  const h2 = await mkUnit("Hôpital Saint-Luc", "hospital", "HSL");
  const h1Lab = await mkUnit("HND Lab", "lab", "HND-LAB");
  const h1Ward = await mkUnit("HND Ward 3A", "ward", "HND-W3A");
  const h1Ed = await mkUnit("HND Emergency", "ward", "HND-ED");
  const h2Lab = await mkUnit("HSL Lab", "lab", "HSL-LAB");
  const h2Ward = await mkUnit("HSL Ward 2B", "ward", "HSL-W2B");
  const h2Icu = await mkUnit("HSL ICU", "ward", "HSL-ICU");

  const containsLinks: Array<[string, string]> = [
    [root, h1],
    [root, h2],
    [h1, h1Lab],
    [h1, h1Ward],
    [h1, h1Ed],
    [h2, h2Lab],
    [h2, h2Ward],
    [h2, h2Icu],
  ];
  for (const [from, to] of containsLinks) {
    await insertLinkInstance(db, schema.containsLinkTypeId, from, to, {
      source: "twin-demo",
    });
  }

  let instanceCount = 9;

  // Varied bed occupancy so the canvas shows a real spread (green / amber /
  // red) instead of a uniform 100% wall.
  const wards: Array<{ id: string; code: string; beds: number; occupied: number }> = [
    { id: h1Ward, code: "HND-W3A", beds: 10, occupied: 7 }, // 70% — healthy
    { id: h1Ed, code: "HND-ED", beds: 8, occupied: 8 }, // 100% — critical
    { id: h2Ward, code: "HSL-W2B", beds: 10, occupied: 9 }, // 90% — warn
    { id: h2Icu, code: "HSL-ICU", beds: 6, occupied: 4 }, // 67% — healthy
  ];

  for (const ward of wards) {
    for (let i = 1; i <= ward.beds; i++) {
      const occupied = i <= ward.occupied;
      const bedId = await insertObjectInstance(
        db,
        schema.bedTypeId,
        {
          label: `${ward.code} Bed ${i}`,
          status: occupied ? "occupied" : "free",
        },
        { source: "twin-demo" },
      );
      await insertLinkInstance(db, schema.locatedInBedLinkTypeId, bedId, ward.id, {
        source: "twin-demo",
      });
      instanceCount++;

      // One patient per occupied bed keeps patient counts consistent with
      // occupancy without exploding the seed size.
      if (occupied) {
        const patientId = await insertObjectInstance(
          db,
          schema.patientTypeId,
          {
            identifier: `${ward.code}-P${String(i).padStart(2, "0")}`,
            label: "Demo patient",
          },
          { source: "twin-demo" },
        );
        await insertLinkInstance(db, schema.locatedInLinkTypeId, patientId, ward.id, {
          source: "twin-demo",
        });
        instanceCount++;
      }
    }
  }

  return { unitCount: 9, instanceCount };
}
