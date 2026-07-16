import { clampLimit, clampOffset, config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
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
  );
  const locatedInLinkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    LOCATED_IN_LINK,
    patientTypeId,
    orgUnitTypeId,
    "many_to_many",
  );
  const locatedInBedLinkTypeId = await getOrCreateLinkType(
    db,
    environmentId,
    LOCATED_IN_BED_LINK,
    bedTypeId,
    orgUnitTypeId,
    "many_to_many",
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
): Promise<{ nodes: TwinUnitNode[]; edges: TwinTreeEdge[]; roots: string[] }> {
  const instances = await listInstancesForEnv(db, environmentId, {
    type: ORG_UNIT_TYPE,
    limit: config.rollupInstanceCap,
  });
  const links = await listLinksForEnv(db, environmentId);
  const unitIds = new Set(instances.map((i) => i.id));

  const edges: TwinTreeEdge[] = [];
  const parentByChild = new Map<string, string>();
  for (const link of links) {
    if (link.linkTypeName !== CONTAINS_LINK) continue;
    if (!unitIds.has(link.fromInstanceId) || !unitIds.has(link.toInstanceId)) continue;
    edges.push({ fromId: link.fromInstanceId, toId: link.toInstanceId });
    // First contains-parent wins; the tree is a forest, multiple parents are
    // ignored deterministically by insertion order.
    if (!parentByChild.has(link.toInstanceId)) {
      parentByChild.set(link.toInstanceId, link.fromInstanceId);
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
    occupancyPct: null,
    numericMeans: {},
    freshnessSeconds: null,
    linkedInstanceCount: 0,
  };
}

function mergeChildMetrics(parent: UnitMetrics, child: UnitMetrics): void {
  for (const [type, count] of Object.entries(child.instanceCountByType)) {
    parent.instanceCountByType[type] = (parent.instanceCountByType[type] ?? 0) + count;
  }
  parent.linkedInstanceCount += child.linkedInstanceCount;

  if (child.freshnessSeconds != null) {
    parent.freshnessSeconds =
      parent.freshnessSeconds == null
        ? child.freshnessSeconds
        : Math.min(parent.freshnessSeconds, child.freshnessSeconds);
  }

  for (const [key, val] of Object.entries(child.numericMeans)) {
    if (parent.numericMeans[key] == null) {
      parent.numericMeans[key] = val;
    } else {
      parent.numericMeans[key] = (parent.numericMeans[key]! + val) / 2;
    }
  }

  if (child.occupancyPct != null) {
    if (parent.occupancyPct == null) {
      parent.occupancyPct = child.occupancyPct;
    } else {
      parent.occupancyPct = (parent.occupancyPct + child.occupancyPct) / 2;
    }
  }
}

export async function rollupAllUnits(
  db: DbClient,
  environmentId: string,
): Promise<Map<string, UnitMetrics>> {
  const { nodes, edges } = await getUnitTree(db, environmentId);
  const unitIds = new Set(nodes.map((n) => n.id));
  const descendants = buildDescendantMap(unitIds, edges);

  const allInstances = await listInstancesForEnv(db, environmentId, {
    limit: config.rollupInstanceCap,
  });
  const links = await listLinksForEnv(db, environmentId);
  const now = Date.now();

  const instanceById = new Map(allInstances.map((i) => [i.id, i]));

  const locatedInByUnit = new Map<string, typeof allInstances>();
  for (const link of links) {
    if (!LOCATED_IN_LINK_NAMES.includes(link.linkTypeName as (typeof LOCATED_IN_LINK_NAMES)[number])) continue;
    const unitId = link.toInstanceId;
    if (!unitIds.has(unitId)) continue;
    const inst = instanceById.get(link.fromInstanceId);
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

    let bedTotal = 0;
    let bedOccupied = 0;
    let newest: Date | null = null;
    const numericAcc = new Map<string, { sum: number; count: number }>();

    for (const inst of linked) {
      m.instanceCountByType[inst.typeName] =
        (m.instanceCountByType[inst.typeName] ?? 0) + 1;

      if (inst.typeName === "Bed") {
        bedTotal++;
        const status = String(inst.properties.status ?? "").toLowerCase();
        if (status === "occupied") bedOccupied++;
      }

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

    if (bedTotal > 0) m.occupancyPct = (bedOccupied / bedTotal) * 100;
    if (newest) m.freshnessSeconds = Math.round((now - newest.getTime()) / 1000);
    for (const [key, acc] of numericAcc) {
      m.numericMeans[key] = acc.sum / acc.count;
    }

    metricsByUnit.set(unitId, m);
  }

  const parentByChild = new Map<string, string>();
  for (const e of edges) {
    if (!parentByChild.has(e.toId)) parentByChild.set(e.toId, e.fromId);
  }
  for (const unitId of unitIds) {
    const parentId = parentByChild.get(unitId);
    if (!parentId) continue;
    const parent = metricsByUnit.get(parentId);
    const child = metricsByUnit.get(unitId);
    if (parent && child) mergeChildMetrics(parent, child);
  }

  return metricsByUnit;
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

function fillTemplate(tpl: string, value: number, threshold: number): string {
  return tpl
    .replace(/\{\{value\}\}/g, String(Math.round(value * 100) / 100))
    .replace(/\{\{threshold\}\}/g, String(threshold));
}

export async function listAlertRules(
  db: DbClient,
  environmentId: string,
): Promise<TwinAlertRuleRow[]> {
  const { rows } = await db.query<{
    id: string;
    environment_id: string;
    unit_kind: string | null;
    metric: string;
    op: TwinAlertOp;
    threshold: string;
    severity: TwinAlertSeverity;
    message_template: string;
    recommendation_template: string;
  }>(
    `SELECT id, environment_id, unit_kind, metric, op, threshold::text,
            severity, message_template, recommendation_template
       FROM app.twin_alert_rule
      WHERE environment_id = $1
      ORDER BY created_at ASC`,
    [environmentId],
  );
  return rows.map((r) => ({
    id: r.id,
    environmentId: r.environment_id,
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

      const message = fillTemplate(rule.messageTemplate, val, rule.threshold);
      const recommendation = fillTemplate(rule.recommendationTemplate, val, rule.threshold);

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
           (environment_id, unit_instance_id, rule_id, severity, metric, value, message, recommendation, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
         ON CONFLICT (environment_id, unit_instance_id, rule_id) WHERE status = 'open'
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
  let sql = `SELECT id, environment_id, unit_instance_id, rule_id, severity, metric,
                    value::text, message, recommendation, status, created_at, acked_at
               FROM app.twin_alert
              WHERE environment_id = $1 AND status = 'open'`;
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
    environment_id: string;
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
    environmentId: r.environment_id,
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
      WHERE id = $1 AND environment_id = $2`,
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
       (environment_id, unit_kind, metric, op, threshold, severity,
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
      WHERE id = $1 AND environment_id = $2
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
    `DELETE FROM app.twin_alert_rule WHERE id = $1 AND environment_id = $2`,
    [ruleId, environmentId],
  );
  if (!rowCount) throw NotFound("RULE_NOT_FOUND", "Alert rule not found.");
}

export async function getTwinTreeSnapshot(db: DbClient, environmentId: string) {
  const tree = await getUnitTree(db, environmentId);
  const metricsByUnit = await rollupAllUnits(db, environmentId);
  const unitKinds = new Map(tree.nodes.map((n) => [n.id, n.kind]));
  await evaluateAlerts(db, environmentId, metricsByUnit, unitKinds);
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

/** Classify an inter-site link type into a flow lane for the network map. */
function flowKind(linkType: string): "patient" | "supply" | "data" | "other" {
  const n = linkType.toLowerCase();
  if (/transfer|refer|patient|admit/.test(n)) return "patient";
  if (/suppl|ship|deliver|stock|resource|order/.test(n)) return "supply";
  if (/feed|data|hl7|fhir|report|sync/.test(n)) return "data";
  return "other";
}

/**
 * Network-level twin: root units as geolocated sites (latitude/longitude read
 * from instance properties; null when unset) plus typed flows — ontology link
 * instances connecting two root sites.
 */
export async function getTwinNetwork(db: DbClient, environmentId: string) {
  const snapshot = await getTwinTreeSnapshot(db, environmentId);
  const rootSet = new Set(snapshot.roots);
  const rootIds = snapshot.roots;

  const coords = new Map<string, { latitude: number | null; longitude: number | null }>();
  if (rootIds.length > 0) {
    const { rows } = await db.query<{ id: string; properties: Record<string, unknown> }>(
      `SELECT id, properties FROM app.ontology_object_instances WHERE id = ANY($1::uuid[])`,
      [rootIds],
    );
    for (const r of rows) {
      const p = r.properties ?? {};
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

  let flows: {
    id: string;
    linkType: string;
    kind: "patient" | "supply" | "data" | "other";
    fromId: string;
    toId: string;
  }[] = [];
  if (rootIds.length > 1) {
    const { rows } = await db.query<{
      id: string;
      link_type: string;
      from_instance_id: string;
      to_instance_id: string;
    }>(
      `SELECT li.id, lt.name AS link_type, li.from_instance_id, li.to_instance_id
         FROM app.ontology_link_instances li
         JOIN app.ontology_link_types lt ON lt.id = li.link_type_id
        WHERE lt.environment_id = $1
          AND li.from_instance_id = ANY($2::uuid[])
          AND li.to_instance_id = ANY($2::uuid[])
          AND li.from_instance_id <> li.to_instance_id`,
      [environmentId, rootIds],
    );
    flows = rows.map((r) => ({
      id: r.id,
      linkType: r.link_type,
      kind: flowKind(r.link_type),
      fromId: r.from_instance_id,
      toId: r.to_instance_id,
    }));
  }

  return {
    computedAt: snapshot.computedAt,
    sites: snapshot.nodes
      .filter((n) => rootSet.has(n.id))
      .map((n) => ({
        ...n,
        latitude: coords.get(n.id)?.latitude ?? null,
        longitude: coords.get(n.id)?.longitude ?? null,
      })),
    flows,
  };
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
  const h2Lab = await mkUnit("HSL Lab", "lab", "HSL-LAB");
  const h2Ward = await mkUnit("HSL Ward 2B", "ward", "HSL-W2B");

  const containsLinks: Array<[string, string]> = [
    [root, h1],
    [root, h2],
    [h1, h1Lab],
    [h1, h1Ward],
    [h2, h2Lab],
    [h2, h2Ward],
  ];
  for (const [from, to] of containsLinks) {
    await insertLinkInstance(db, schema.containsLinkTypeId, from, to, {
      source: "twin-demo",
    });
  }

  let instanceCount = 7;
  for (const wardId of [h1Ward, h2Ward]) {
    const patientId = await insertObjectInstance(
      db,
      schema.patientTypeId,
      { identifier: `P-${wardId.slice(0, 4)}`, label: "Demo patient" },
      { source: "twin-demo" },
    );
    await insertLinkInstance(db, schema.locatedInLinkTypeId, patientId, wardId, {
      source: "twin-demo",
    });
    instanceCount++;

    const bedId = await insertObjectInstance(
      db,
      schema.bedTypeId,
      { label: "Bed 1", status: "occupied" },
      { source: "twin-demo" },
    );
    await insertLinkInstance(db, schema.locatedInBedLinkTypeId, bedId, wardId, {
      source: "twin-demo",
    });
    instanceCount++;
  }

  return { unitCount: 7, instanceCount };
}
