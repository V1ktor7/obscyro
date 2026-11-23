import { clampLimit, clampOffset, config } from "../lib/config.js";
import { freshnessAcross, type Freshness, type FreshnessBasis } from "./observed-at.js";
import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
import type { ReadLens } from "./ontology-lens.js";
import {
  evaluateMetric,
  metricLooksAt,
  metricReads,
  metricsForRollup,
  qualifiersOf,
  withheldOf,
  type MetricDef,
  type MetricInstance,
  type Withheld,
} from "./twin-metrics.js";
import type { ValuePeriod } from "./property-schema.js";
import {
  getOrCreateLinkType,
  getOrCreateObjectType,
  insertLinkInstance,
  insertObjectInstance,
  listInstancesForEnv,
  listLinksForEnv,
  type EnvInstanceRow,
  type EnvLinkRow,
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
/**
 * 'resolved' is what the background evaluator writes when a condition stops
 * firing. It is deliberately not 'ack': the signal bridge separates "somebody
 * handled it" from "it went away on its own", and only a human produces the
 * first.
 */
export type TwinAlertStatus = "open" | "ack" | "resolved";

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

/**
 * How old a measure's value is, and which stretch of time it describes when
 * that is not the moment of its reading.
 *
 * `period` is set when the property the measure reads declares one: the value
 * is then of that stretch (the day before), and `seconds` is the age of the
 * reading that published it, not of the value. `zone` is the clock the reading
 * is stamped on, which is what "the day before" is counted on.
 */
export interface ValueAge extends Freshness {
  period?: ValuePeriod;
  zone?: string | null;
}

export interface UnitMetrics {
  unitId: string;
  instanceCountByType: Record<string, number>;
  /** Every metric the organization has defined, by key. */
  values: Record<string, number | null>;
  /**
   * What each number is about, when the measure declares it: the pollutant
   * behind an air index, the target of a wastewater assay. Keyed by metric,
   * and absent for the measures that are about exactly one thing.
   */
  qualifiers: Record<string, string[]>;
  /**
   * Why a measure that has something to read here gives no value: several
   * averages that must not be averaged again, or a source that published no
   * figure. Keyed by measure, and absent for a measure with a value or with
   * nothing to read. See `withheldOf`.
   */
  withheld: Record<string, Withheld>;
  /** Kept for callers that name it directly; it is `values.occupancy`. */
  occupancyPct: number | null;
  numericMeans: Record<string, number>;
  /**
   * How old the data is, from the timestamp the source published — not from
   * when we wrote it down. Null when that is not knowable; `freshnessBasis`
   * says which of the several reasons applies.
   */
  freshnessSeconds: number | null;
  freshnessBasis: FreshnessBasis;
  /**
   * How old each measure's value is, counted on what that measure reads.
   *
   * `freshnessSeconds` above answers "is everything under this unit up to
   * date", and takes the oldest of all its sources. That is not the age of any
   * one value: an emergency department that also carries an air quality
   * station had its stretcher occupancy dated by the station, two hours old
   * for a census taken fourteen minutes ago. Keyed by measure, for the
   * measures that have a value here; see `valueAgeOf`.
   */
  valueAges: Record<string, ValueAge>;
  /**
   * How long ago the row was last written here.
   *
   * Kept, and kept under a name that says what it is. It answers "did the sync
   * run", which is a real question — but it is not how old the reading is, and
   * for an hourly file that re-downloads unchanged the two differ by the whole
   * hour.
   */
  fetchedAgeSeconds: number | null;
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
  /**
   * When the value was true, from the timestamp the source published. Refreshed
   * with the value at every evaluation; null when the source does not say.
   */
  observedAt: Date | null;
  /**
   * What that age rests on, counted on what the alert's measure reads. Null
   * for an alert last evaluated before this was kept.
   */
  observedBasis: FreshnessBasis | null;
  /**
   * When the data that crossed the threshold was written here. Set when the
   * alert opens and never touched again, so `createdAt - writtenAt` is how
   * long it took us to notice.
   */
  writtenAt: Date | null;
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

/**
 * Every unit with what stands under it, itself included.
 *
 * Shared with the simulation export, which has to say of a unit holding
 * nothing of its own whether its sub-units hold something: "under" must mean
 * there what it means on the unit page.
 */
export function buildDescendantMap(
  unitIds: Set<string>,
  edges: readonly TwinTreeEdge[],
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

/**
 * Every property the institution declared as carrying the time of a reading.
 *
 * Taken from the schemas of the instances actually rolled up. This used to
 * return the first one and stop, on the grounds that two declarations under one
 * unit was not a case worth a rule. It became one: twenty-three emergency
 * departments receive an hourly stretcher census and an hourly air quality
 * reading, each with its own stamp, and "first" meant first by link insertion
 * order — invisible to a reader and guaranteed by nothing.
 *
 * `freshnessAcross` decides what to do with more than one. Deduplicated,
 * because a hundred instances of one type declare the same property a hundred
 * times.
 */
function observedProperties(
  instances: readonly { propertySchema: readonly { key: string; observedAt?: boolean; observedAtZone?: string }[] }[],
): { key: string; zone?: string | null }[] {
  const out: { key: string; zone?: string | null }[] = [];
  const seen = new Set<string>();
  for (const inst of instances) {
    for (const prop of inst.propertySchema) {
      if (!prop.observedAt) continue;
      const zone = prop.observedAtZone ?? null;
      const id = `${prop.key}|${zone ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ key: prop.key, zone });
    }
  }
  return out;
}

/** An instance as the roll-up holds it when it asks how old a value is. */
export type AgedInstance = MetricInstance & { propertySchema: readonly PropertyDef[] };

/**
 * Which instances a measure's value is made from, for any name a rule can
 * threshold on.
 *
 * Case for case what `metricValue` reads, so the age of a value is counted on
 * the very instances the value came from. A measure the organisation defined
 * looks at the types and roles its definition names. The built-in ones say it
 * in their name: `count:Bed` looks at beds, `mean:waitMinutes` at whatever
 * declares that number. `linkedInstanceCount` and `freshnessSeconds` are about
 * everything under the unit, and so is their age.
 */
export function measureReads(metric: string, defs: readonly MetricDef[]): (inst: AgedInstance) => boolean {
  const def =
    defs.find((d) => d.key === metric) ??
    // `occupancyPct` is `values.occupancy` under an older name.
    (metric === "occupancyPct" ? defs.find((d) => d.key === "occupancy") : undefined);
  if (def) return (inst) => metricLooksAt(def, inst);
  if (metric === "occupancyPct" || metric === "linkedInstanceCount" || metric === "freshnessSeconds") {
    return () => true;
  }
  if (metric.startsWith("count:")) {
    const type = metric.slice("count:".length);
    return (inst) => inst.typeName === type;
  }
  const key = metric.startsWith("mean:") ? metric.slice("mean:".length) : metric;
  return (inst) => inst.propertySchema.some((p) => p.key === key && p.type === "number");
}

/**
 * How old each measure's value is under one unit.
 *
 * The same reading of stamps as the unit's own age (`freshnessAcross`), over
 * fewer instances: only the ones the measure looks at. So a measure fed by one
 * source carries that source's age, and one fed by several still takes the
 * oldest of them and still says when that is only a floor.
 *
 * Only for the measures that have a value here. A unit with no air quality
 * station has no air index, and nothing to date.
 */
function agesOfValues(
  m: UnitMetrics,
  linked: readonly AgedInstance[],
  defs: readonly MetricDef[],
  alsoAged: readonly string[],
  now: number,
): Record<string, ValueAge> {
  const out: Record<string, ValueAge> = {};
  for (const metric of new Set([...defs.map((d) => d.key), ...alsoAged])) {
    if (metricValue(m, metric) == null) continue;
    const sources = linked.filter(measureReads(metric, defs));
    const stamps = observedProperties(sources);
    const age = freshnessAcross(stamps, sources, now);
    const period = periodOfMeasure(defs.find((d) => d.key === metric), sources);
    out[metric] = period ? { ...age, period, zone: stamps[0]?.zone ?? null } : age;
  }
  return out;
}

/**
 * The stretch of time a measure's value describes, when the property it reads
 * declares one.
 *
 * Only for a plain aggregate of one property: a ratio of two has no single
 * property to ask. Every instance the measure reads that declares the property
 * must declare the same period. One that does not makes the answer "none":
 * half of yesterday and half of this hour is neither.
 */
export function periodOfMeasure(def: MetricDef | undefined, sources: readonly AgedInstance[]): ValuePeriod | null {
  const prop = def && !def.denominator ? def.numerator.property : null;
  if (!prop) return null;
  let period: ValuePeriod | null = null;
  for (const inst of sources) {
    const decl = inst.propertySchema.find((p) => p.key === prop);
    if (!decl) continue;
    if (!decl.period) return null;
    if (period !== null && period !== decl.period) return null;
    period = decl.period;
  }
  return period;
}

/**
 * How old the value of one measure is at this unit.
 *
 * The age of what the measure reads, when the roll-up counted it. Otherwise
 * the unit's own age stands in, which is the age of everything under it: the
 * reading made before measures had an age of their own.
 */
export function valueAgeOf(metrics: UnitMetrics, metric: string): Freshness {
  const own = metrics.valueAges[metric] ?? (metric === "occupancyPct" ? metrics.valueAges.occupancy : undefined);
  return own ?? { seconds: metrics.freshnessSeconds, basis: metrics.freshnessBasis };
}

function emptyMetrics(unitId: string): UnitMetrics {
  return {
    unitId,
    instanceCountByType: {},
    values: {},
    qualifiers: {},
    withheld: {},
    occupancyPct: null,
    numericMeans: {},
    freshnessSeconds: null,
    freshnessBasis: "empty",
    valueAges: {},
    fetchedAgeSeconds: null,
    linkedInstanceCount: 0,
  };
}

/** A site's own instance, as the roll-up would see any other instance. */
export interface SiteInstance {
  typeName: string;
  properties: Record<string, unknown>;
  propertySchema: PropertyDef[];
  updatedAt: Date;
}

/**
 * A site that is itself the reading.
 *
 * The place axis answers "what is in this building", and for a hospital that
 * is the right question: its numbers belong to the services standing in it,
 * not to the address. An air quality station is not a building with tenants.
 * Nothing is placed in it, it holds no beds, and the measurement is the
 * station — so the same question returns nothing, and the map paints the
 * sensor grey. Grey means "no reading". The station is holding one.
 *
 * So a site nothing stands on measures itself. The bound is deliberately
 * narrow in two ways:
 *
 *   - Only when nothing is placed here. A site with tenants reports its
 *     tenants; that contract is what the place axis means, and a building does
 *     not get to speak over the services inside it.
 *   - Only when a metric actually reads this type. Asked instead whether a
 *     metric *produced* a value, every one of 1 590 installations would
 *     qualify: a `count` answers 0 over an empty match, which is a true answer
 *     and not evidence that the instance was read at all.
 *
 * Returns null when neither holds, which leaves the site exactly as it was.
 */
export function selfRollup(
  siteId: string,
  inst: SiteInstance,
  defs: readonly MetricDef[],
  now: number,
): UnitMetrics | null {
  const linked = [inst];
  if (!defs.some((d) => metricReads(d, inst))) return null;

  const m = emptyMetrics(siteId);
  for (const def of defs) {
    m.values[def.key] = evaluateMetric(def, linked);
    const held = withheldOf(def, linked);
    if (held) m.withheld[def.key] = held;
    const about = qualifiersOf(def, linked);
    if (about.length > 0) m.qualifiers[def.key] = about;
  }
  m.occupancyPct = m.values.occupancy ?? null;
  m.instanceCountByType = { [inst.typeName]: 1 };
  m.linkedInstanceCount = 1;
  m.fetchedAgeSeconds = Math.round((now - inst.updatedAt.getTime()) / 1000);
  // The same freshness path the roll-up uses, so a sensor's age and a ward's
  // age cannot come to mean different things.
  const fresh = freshnessAcross(observedProperties(linked), linked, now);
  m.freshnessSeconds = fresh.seconds;
  m.freshnessBasis = fresh.basis;
  for (const prop of inst.propertySchema) {
    if (prop.type !== "number") continue;
    const v = Number(inst.properties[prop.key]);
    if (Number.isFinite(v)) m.numericMeans[prop.key] = v;
  }
  m.valueAges = agesOfValues(m, linked, defs, [], now);
  return m;
}


/**
 * The roll-up of every unit, read from the base.
 *
 * `alsoAged` names measures to date besides the ones the organisation
 * defined: the evaluator passes what its rules threshold on, so a rule on a
 * built-in measure (`count:Bed`) gets the age of that measure too.
 */
export async function rollupAllUnits(
  db: DbClient,
  environmentId: string,
  lens?: ReadLens,
  alsoAged: readonly string[] = [],
): Promise<Map<string, UnitMetrics>> {
  const { nodes, edges } = await getUnitTree(db, environmentId, lens);
  const allInstances = await listInstancesForEnv(db, environmentId, {
    limit: config.rollupInstanceCap,
    ...lens,
  });
  const links = await listLinksForEnv(db, environmentId, lens);

  const { rows: orgRows } = await db.query<{ organization_id: string }>(
    `SELECT organization_id FROM app.project WHERE id = $1`,
    [environmentId],
  );
  const metricDefs = orgRows[0]?.organization_id
    ? await metricsForRollup(db, orgRows[0].organization_id)
    : [];

  return rollupFrom(nodes, edges, allInstances, links, metricDefs, Date.now(), alsoAged);
}

/**
 * The roll-up, from what was read.
 *
 * Kept apart from the reads for two reasons. It can be checked without a
 * database. And the figures the unit page shows can be held against the ones
 * the simulation export gives for the same twin (`twin-figures.unit.test.ts`):
 * two readings of one ward that nothing compared were free to disagree.
 */
export function rollupFrom(
  nodes: readonly Pick<TwinUnitNode, "id">[],
  edges: TwinTreeEdge[],
  allInstances: readonly EnvInstanceRow[],
  links: readonly EnvLinkRow[],
  metricDefs: readonly MetricDef[],
  now: number,
  alsoAged: readonly string[] = [],
): Map<string, UnitMetrics> {
  const unitIds = new Set(nodes.map((n) => n.id));
  const descendants = buildDescendantMap(unitIds, edges);

  const instanceById = new Map(allInstances.map((i) => [i.id, i]));

  const locatedInByUnit = new Map<string, EnvInstanceRow[]>();
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
    const linked: EnvInstanceRow[] = [];
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
      const held = withheldOf(def, linked);
      if (held) m.withheld[def.key] = held;
      // What the number is about, read off the same instances that made it.
      const about = qualifiersOf(def, linked);
      if (about.length > 0) m.qualifiers[def.key] = about;
    }
    m.occupancyPct = m.values.occupancy ?? null;

    if (newest) m.fetchedAgeSeconds = Math.round((now - newest.getTime()) / 1000);
    const fresh = freshnessAcross(observedProperties(linked), linked, now);
    m.freshnessSeconds = fresh.seconds;
    m.freshnessBasis = fresh.basis;
    for (const [key, acc] of numericAcc) {
      m.numericMeans[key] = acc.sum / acc.count;
    }
    // Last: a measure is dated only where it has a value, and the built-in
    // ones read the counts and means filled in just above.
    m.valueAges = agesOfValues(m, linked, metricDefs, alsoAged, now);

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

    for (const def of metricDefs) {
      m.values[def.key] = evaluateMetric(def, linked);
      const held = withheldOf(def, linked);
      if (held) m.withheld[def.key] = held;
      const about = qualifiersOf(def, linked);
      if (about.length > 0) m.qualifiers[def.key] = about;
    }
    m.occupancyPct = m.values.occupancy ?? null;
    if (newest) m.fetchedAgeSeconds = Math.round((now - newest.getTime()) / 1000);
    const fresh = freshnessAcross(observedProperties(linked), linked, now);
    m.freshnessSeconds = fresh.seconds;
    m.freshnessBasis = fresh.basis;
    for (const [key, acc] of numericAcc) m.numericMeans[key] = acc.sum / acc.count;
    m.valueAges = agesOfValues(m, linked, metricDefs, [], now);

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
/**
 * What the organisation wrote about each of these object types.
 *
 * A figure on a unit's sheet comes from somewhere, under a licence, with limits:
 * "MSSS, hourly census, CC-BY 4.0, released 45 minutes after its hour, says
 * nothing of the staff on site". That is a fact about the data, written by
 * whoever brought it in, on the type that holds it. The sheet prints it; no
 * screen knows a source by name. Types with nothing written are left out.
 */
export async function describeTypes(
  db: DbClient,
  environmentId: string,
  typeNames: readonly string[],
): Promise<Record<string, string>> {
  if (typeNames.length === 0) return {};
  const { rows } = await db.query<{ name: string; description: string | null }>(
    `SELECT name, description
       FROM app.ontology_object_types
      WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1)
        AND name = ANY($2::text[])`,
    [environmentId, typeNames],
  );
  const out: Record<string, string> = {};
  for (const r of rows) {
    const text = (r.description ?? "").trim();
    if (text) out[r.name] = text;
  }
  return out;
}

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

/**
 * The number a rule thresholds on, or null when this unit has none.
 *
 * Exported because closing an alert needs the same reading that opened it. A
 * caller that re-derived the value its own way could resolve an alert the
 * rule would still raise.
 */
export function metricValue(metrics: UnitMetrics, metric: string): number | null {
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

export function compareOp(op: TwinAlertOp, value: number, threshold: number): boolean {
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

const SEVERITY_RANK: Record<TwinAlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

/**
 * One evaluation: every rule against every unit's metrics.
 *
 * Returns the alerts whose condition fires now: the ones it opened (`isNew`),
 * the open ones it refreshed, and the acknowledged ones that still hold.
 */
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
  const now = Date.now();

  for (const [unitId, metrics] of metricsByUnit) {
    const kind = unitKinds.get(unitId) ?? null;
    // An age the rollup already measured, turned into an instant so it stays
    // true while the alert stays open.
    const writtenAt = metrics.fetchedAgeSeconds == null ? null : new Date(now - metrics.fetchedAgeSeconds * 1000);
    for (const rule of activeRules) {
      if (rule.unitKind && rule.unitKind !== kind) continue;
      const val = metricValue(metrics, rule.metric);
      if (val == null) continue;
      if (!compareOp(rule.op, val, rule.threshold)) continue;

      // The age of this value, not of the unit: counted on what the rule's
      // measure reads. An occupancy alert at a unit that also carries an air
      // quality station is dated by the stretcher census alone.
      const aged = valueAgeOf(metrics, rule.metric);
      const observedAt = aged.seconds == null ? null : new Date(now - aged.seconds * 1000);

      const ctx = {
        unit: unitNames.get(unitId) ?? "this unit",
        value: val,
        threshold: rule.threshold,
      };
      const message = fillTemplate(rule.messageTemplate, ctx);
      const recommendation = fillTemplate(rule.recommendationTemplate, ctx);

      // The alert that already holds this unit and this rule, if there is one:
      // the open one, or one somebody acknowledged. Either way the condition is
      // known, so the row is refreshed and nothing new is opened.
      //
      // An acknowledgement used to hold for five seconds. It moved the alert
      // out of 'open', the unique index only covers 'open', and the next
      // evaluation opened a fresh alert for the same unit and the same rule:
      // a new signal, and a banner announcing as news what somebody had just
      // said they had seen. It now holds for as long as the condition does.
      //
      // Unless it got worse: an acknowledgement covers the severity that was
      // acknowledged. A rule that now fires at a higher one opens a new alert.
      //
      // `observed_at` follows the value: it is the age of what is shown.
      // `observed_basis` follows it too: it says what that age rests on, so an
      // age that is only a floor is never shown as an answer, and an unknown
      // age comes with its reason.
      // `written_at` does not: it is the write the opening followed, and an
      // alert that stays open through ten more syncs was still opened by one.
      const { rows: held } = await db.query<{
        id: string;
        status: TwinAlertStatus;
        created_at: Date;
        written_at: Date | null;
        acked_at: Date | null;
      }>(
        `UPDATE app.twin_alert
            SET severity = $4,
                metric = $5,
                value = $6,
                message = $7,
                recommendation = $8,
                observed_at = $9,
                observed_basis = $10
          WHERE project_id = $1 AND unit_instance_id = $2 AND rule_id = $3
            AND (status = 'open'
                 OR (status = 'ack'
                     AND (CASE severity WHEN 'critical' THEN 2 WHEN 'warn' THEN 1 ELSE 0 END) >= $11))
        RETURNING id, status, created_at, written_at, acked_at`,
        [
          environmentId,
          unitId,
          rule.id,
          rule.severity,
          rule.metric,
          val,
          message,
          recommendation,
          observedAt,
          aged.basis,
          SEVERITY_RANK[rule.severity],
        ],
      );
      // An open alert speaks for the pair when both are on file: alerts
      // acknowledged before acknowledgements held can sit beside a newer one.
      const holder = held.find((h) => h.status === "open") ?? held[0];
      if (holder) {
        created.push({
          id: holder.id,
          environmentId,
          unitInstanceId: unitId,
          ruleId: rule.id,
          severity: rule.severity,
          metric: rule.metric,
          value: val,
          message,
          recommendation,
          status: holder.status,
          createdAt: holder.created_at,
          ackedAt: holder.acked_at,
          observedAt,
          observedBasis: aged.basis,
          writtenAt: holder.written_at,
          isNew: false,
        });
        continue;
      }

      // Nothing holds it: a new alert. The conflict clause is for two
      // evaluations opening it at the same instant (the evaluator and a
      // viewer's read): at most one OPEN alert per (project, unit, rule), and
      // `inserted` (xmax = 0) says which of the two really opened it.
      const { rows } = await db.query<{
        id: string;
        created_at: Date;
        written_at: Date | null;
        inserted: boolean;
      }>(
        `INSERT INTO app.twin_alert
           (project_id, unit_instance_id, rule_id, severity, metric, value, message, recommendation, status,
            observed_at, written_at, observed_basis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11)
         ON CONFLICT (project_id, unit_instance_id, rule_id) WHERE status = 'open'
         DO UPDATE SET severity = EXCLUDED.severity,
                       metric = EXCLUDED.metric,
                       value = EXCLUDED.value,
                       message = EXCLUDED.message,
                       recommendation = EXCLUDED.recommendation,
                       observed_at = EXCLUDED.observed_at,
                       observed_basis = EXCLUDED.observed_basis
         RETURNING id, created_at, written_at, (xmax = 0) AS inserted`,
        [
          environmentId,
          unitId,
          rule.id,
          rule.severity,
          rule.metric,
          val,
          message,
          recommendation,
          observedAt,
          writtenAt,
          aged.basis,
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
        observedAt,
        observedBasis: aged.basis,
        writtenAt: rows[0]!.written_at,
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
                    value::text, message, recommendation, status, created_at, acked_at,
                    observed_at, observed_basis, written_at
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
    observed_at: Date | null;
    observed_basis: FreshnessBasis | null;
    written_at: Date | null;
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
    observedAt: r.observed_at,
    observedBasis: r.observed_basis,
    writtenAt: r.written_at,
  }));
}

/**
 * Acknowledge an alert: "seen", said by a person.
 *
 * The alert leaves the list of open ones and stays on file as acknowledged for
 * as long as its condition holds: `evaluateAlerts` refreshes it instead of
 * opening another, and the evaluator resolves it once the condition clears.
 *
 * Only an open alert changes state. Acknowledging one that already is, or one
 * that has cleared in the meantime, changes nothing: turning a resolved alert
 * back into an acknowledged one would claim its condition still holds.
 */
export async function ackAlert(
  db: DbClient,
  environmentId: string,
  alertId: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE app.twin_alert SET status = 'ack', acked_at = NOW()
      WHERE id = $1 AND project_id = $2 AND status = 'open'`,
    [alertId, environmentId],
  );
  if (rowCount) return;
  const { rows } = await db.query(
    `SELECT 1 FROM app.twin_alert WHERE id = $1 AND project_id = $2`,
    [alertId, environmentId],
  );
  if (rows.length === 0) throw NotFound("ALERT_NOT_FOUND", "Twin alert not found.");
}

/**
 * The alert state of a building, taken from the units standing in it.
 *
 * Alerts are raised on org units. As soon as a twin tags its buildings
 * physical, the map's sites stop being units — `nodeById` misses every one of
 * them — and each site was handed `worstAlertSeverity: null`. The effect was
 * silent and total: the moment a network became a map of real addresses, every
 * ring on it went out, with the alerts still open in the database and still
 * listed in the panel beside it.
 *
 * The worst severity rather than the commonest, for the reason a collapsed
 * parent shows its worst child: a building holding a calm clinic and an
 * overflowing emergency ward is not, on average, fine.
 */
export function alertStateOfPlace(
  units: { id: string }[],
  unitById: Map<string, { worstAlertSeverity: TwinAlertSeverity | null; openAlertCount: number }>,
): { worstAlertSeverity: TwinAlertSeverity | null; openAlertCount: number } {
  const order: TwinAlertSeverity[] = ["critical", "warn", "info"];
  let worst: TwinAlertSeverity | null = null;
  let openAlertCount = 0;
  const seen = new Set<string>();
  for (const u of units) {
    // Two placements onto one building must not count the same ward twice.
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    const node = unitById.get(u.id);
    if (!node) continue;
    openAlertCount += node.openAlertCount;
    const sev = node.worstAlertSeverity;
    if (!sev) continue;
    if (worst === null || order.indexOf(sev) < order.indexOf(worst)) worst = sev;
  }
  return { worstAlertSeverity: worst, openAlertCount };
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

/** Is this read the twin as it stands now: no scenario laid over it, no other instant? */
export function readsReality(lens?: ReadLens): boolean {
  return !lens || (lens.scenarioId === undefined && lens.asOf === undefined);
}

export async function getTwinTreeSnapshot(db: DbClient, environmentId: string, lens?: ReadLens) {
  const tree = await getUnitTree(db, environmentId, lens);
  // Reality only. Under a lens the metrics are those of a scenario or of
  // another instant, and a ward that overflows in a what-if must not raise an
  // alert that reaches every screen as if it were happening. The scheduler
  // evaluates reality on its own, every few seconds, whoever is watching.
  //
  // The rules are read before the roll-up so it dates what they threshold on,
  // as the scheduler's does: an alert must not get one age from the evaluator
  // and another from a viewer's read.
  const rules = readsReality(lens) ? await listAlertRules(db, environmentId) : null;
  const metricsByUnit = await rollupAllUnits(db, environmentId, lens, rules?.map((r) => r.metric));
  const unitKinds = new Map(tree.nodes.map((n) => [n.id, n.kind]));
  const unitNames = new Map(tree.nodes.map((n) => [n.id, n.name]));
  if (rules) await evaluateAlerts(db, environmentId, metricsByUnit, unitKinds, unitNames, rules);
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
/**
 * How many sites the network map will draw.
 *
 * The old ceiling was 500, taken silently. Syncing the MSSS registry produces
 * 1 590 installations, and a map that draws the first third of a province while
 * its legend counts what it drew is the same lie a bar chart of the thirty
 * largest tells when it calls itself "30 categories". One more than the cap is
 * fetched so the overflow can be counted rather than inferred from a full page.
 */
const MAX_SITES = 2_000;

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
      LIMIT ${MAX_SITES + 1}`,
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
  const allSiteIds =
    physicalById.size > 0 ? Array.from(physicalById.keys()) : Array.from(snapshot.roots);
  // Counted, never dropped in silence: a reader has to be able to tell a small
  // network from a truncated one.
  const sitesOmitted = Math.max(0, allSiteIds.length - MAX_SITES);
  const siteIds = allSiteIds.slice(0, MAX_SITES);

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
  // Each site as an instance in its own right, for the sites that are
  // themselves the reading. See `selfRollup`.
  const selfById = new Map<string, SiteInstance>();
  if (siteIds.length > 0) {
    const { rows } = await db.query<{
      id: string;
      properties: Record<string, unknown>;
      type_name: string;
      property_schema: PropertyDef[] | null;
      updated_at: Date;
    }>(
      `SELECT oi.id, oi.properties, t.name AS type_name, t.property_schema, oi.updated_at
         FROM app.ontology_object_instances oi
         JOIN app.ontology_object_types t ON t.id = oi.object_type_id
        WHERE oi.id = ANY($1::uuid[])`,
      [siteIds],
    );
    for (const r of rows) {
      const p = r.properties ?? {};
      propsById.set(r.id, p);
      typeById.set(r.id, r.type_name);
      selfById.set(r.id, {
        typeName: r.type_name,
        properties: p,
        propertySchema: r.property_schema ?? [],
        updatedAt: r.updated_at,
      });
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

  // Metric definitions, for the sites nothing stands on. Read once: they are
  // the same definitions the place roll-up just used, and a second definition
  // of occupancy is how two parts of one map come to disagree.
  const { rows: orgRows } = await db.query<{ organization_id: string }>(
    `SELECT organization_id FROM app.project WHERE id = $1`,
    [environmentId],
  );
  const metricDefs = orgRows[0]?.organization_id
    ? await metricsForRollup(db, orgRows[0].organization_id)
    : [];
  const now = Date.now();

  const sites = siteIds.map((id) => {
    const node = nodeById.get(id);
    const phys = physicalById.get(id);
    const place = places.get(id);
    const self =
      node || place
        ? null
        : (() => {
            const inst = selfById.get(id);
            return inst ? selfRollup(id, inst, metricDefs, now) : null;
          })();
    const base = node ?? {
      id,
      name: siteName(id),
      kind: phys?.type_name ?? "site",
      code: "",
      parentId: null,
      // A building's own numbers come from what is placed in it, not from a
      // tree it does not belong to — unless nothing is placed in it and the
      // site is itself what gets measured, which is what a sensor is.
      metrics: place?.metrics ?? self ?? emptyMetrics(id),
      ...alertStateOfPlace(place?.contributingUnits ?? [], nodeById),
    };
    return {
      ...base,
      objectType: typeById.get(id) ?? null,
      // Where the reading comes from, so the map can draw the difference. A
      // sensor and a hospital drawn as the same dot in the same colour say the
      // reading means the same thing in both, and it does not: one is the air
      // at a street corner, the other is the state of a service.
      selfMeasured: self !== null,
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

  return { computedAt: snapshot.computedAt, sites, flows, layers, sitesOmitted };
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
