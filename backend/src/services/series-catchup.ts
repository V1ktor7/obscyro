import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { buildMapProperties, type MappingRule } from "./channel-runner.js";
import { identityKeyOf } from "./identity.js";
import { listInstancesForEnv, listLinksForEnv, type EnvInstanceRow, type EnvLinkRow, type PropertyDef } from "./ontology.js";
import { MAX_ROWS, execute, listPipelines, validate, type LinkRule, type Pipeline, type Row } from "./pipeline.js";
import { SERIES_COLUMNS, captureInto, seriesOf, type SeriesDbRow, type SeriesDef } from "./series-capture.js";
import { getUnitTree, rollupFrom, type TwinTreeEdge } from "./twin.js";
import { SAME_READING_SECONDS, readingsNow, type Reading } from "./twin-history.js";
import { listTwinMetrics, type MetricDef, type MetricSelector } from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// Catching a series up from the copies that were kept.
//
// A series starts the day it started being kept: a measure's first reading, a
// dataset series' declaration. But every sync had already been keeping a whole
// copy of its file. Those copies hold what the series would have written down,
// had it existed.
//
// A catch-up reads them, oldest first, and writes down what comes out:
//
//   a dataset series   the points of each copy, dated at when the copy was
//                      taken (`captureInto`, the same reading as a live write);
//   a twin measure     each copy goes through the pipeline as it is today, in
//                      memory, and the measure is computed as it is defined
//                      today. Nothing is written in the ontology: no object,
//                      no link, no type.
//
// Four things are deliberate:
//
//   marked           what a catch-up writes is marked `replayed`. The twin
//                    did not show those readings at the time.
//   two times        a caught-up reading carries the time its source gave and
//                    the time the copy was taken, not the time of the catch-up.
//   nothing guessed  a row that cannot be turned into an object, or that names
//                    a place the twin does not hold, is left out and counted.
//   bounded          a few copies per call. Where it stopped is written down,
//                    so it can be stopped and resumed.
//
// Today's definitions, not those of the time: the pipeline, the measure and
// the place of each object are what they are now. The screen says so.
// ---------------------------------------------------------------------------

/** The prefix of a twin measure's key. Kept here too, so this file does not import `series.ts`. */
const TWIN_PREFIX = "twin:";

/**
 * The most copies one call reads. Time and rows are what bound a call; this is
 * only a ceiling. It was 25 at first: an hourly file of 120 rows replays in a
 * few hundredths of a second, so a screen asked for a batch every second or
 * so, and the API's own rate limit stopped it, and the rest of the Studio with it.
 */
export const BATCH_COPIES = 500;
/** A call stops taking new copies once it has run this long. It always reads at least one. */
export const BATCH_MS = 12_000;
/** A call stops taking new copies once it has read this many rows. It always reads at least one. */
export const BATCH_ROWS = 400_000;

/** Node kinds that call a service or queue work: a pipeline holding one is not replayed. */
const NOT_REPLAYED = new Set(["extract_snomed", "validate_confidence"]);

const refused = (message: string) => BadRequest("CATCHUP_REFUSED", message);

interface Project {
  id: string;
  organizationId: string;
}

// --- which objects a measure is made from ----------------------------------------------

export interface TypeInfo {
  id: string;
  name: string;
  simRole: EnvInstanceRow["simRole"];
  schema: PropertyDef[];
  /** What the type says identifies one of its instances; empty when it says nothing. */
  identity: string[];
}

/**
 * The object types a measure's value is made from, by name. Null when one of
 * its selectors names neither a type nor a role: it counts everything under a
 * unit, and no single file can rebuild that.
 */
export function typesLookedAt(def: Pick<MetricDef, "numerator" | "denominator">, types: readonly Pick<TypeInfo, "name" | "simRole">[]): string[] | null {
  const out = new Set<string>();
  const selectors: MetricSelector[] = [def.numerator, ...(def.denominator ? [def.denominator] : [])];
  for (const sel of selectors) {
    if (sel.ofType) {
      out.add(sel.ofType);
    } else if (sel.ofRole) {
      for (const t of types) {
        if (t.simRole === sel.ofRole) out.add(t.name);
      }
    } else {
      return null;
    }
  }
  return [...out].sort();
}

const outputNodes = (p: Pick<Pipeline, "nodes">) => p.nodes.filter((n) => n.kind === "object_output" && String(n.config.objectTypeName ?? "") !== "");
const inputDatasets = (p: Pick<Pipeline, "nodes">): string[] => [...new Set(p.nodes.filter((n) => n.kind === "dataset_input").map((n) => String(n.config.datasetId ?? "")).filter(Boolean))];

/**
 * Why a pipeline cannot carry the copies of a measure, or null when it can.
 *
 * It has to be the pipeline that writes the measure's objects today, all of
 * them: a measure made from two types written by two pipelines would be
 * rebuilt half from the past and half from now.
 */
export function whyNotThrough(pipeline: Pick<Pipeline, "name" | "status" | "nodes">, looked: readonly string[]): string | null {
  if (pipeline.status === "draft") return `“${pipeline.name}” is a draft: it does not write the twin today.`;
  const written = new Set(outputNodes(pipeline).map((n) => String(n.config.objectTypeName)));
  const missing = looked.filter((t) => !written.has(t));
  if (missing.length === looked.length) return `“${pipeline.name}” does not write ${looked.join(" or ")}.`;
  if (missing.length > 0) return `“${pipeline.name}” does not write ${missing.join(" or ")}, which this measure also reads: its past cannot be rebuilt from one file.`;
  if (pipeline.nodes.some((n) => NOT_REPLAYED.has(n.kind))) return `“${pipeline.name}” calls the extraction service: its copies are not replayed.`;
  if (inputDatasets(pipeline).length === 0) return `“${pipeline.name}” reads no dataset.`;
  return null;
}

// --- today's twin, as a replay needs it -------------------------------------------------

export interface ResolvedRule {
  fromColumn: string;
  direction: "out" | "in";
  targetTypeName: string;
  /** What the link type declares it does. Null when no link type has that name: the rule attaches nothing. */
  link: Pick<EnvLinkRow, "linkTypeName" | "aggregates" | "aggregateToward" | "transitive"> | null;
  /** Today's instances of the target type, by the property the rule matches on. The oldest wins, as in a run. */
  targets: ReadonlyMap<string, string>;
}

export interface OutputSpec {
  nodeId: string;
  typeId: string;
  typeName: string;
  simRole: EnvInstanceRow["simRole"];
  schema: PropertyDef[];
  /** The type's own identity when it declares one, else the output's. */
  identity: string[];
  /** True when the identity is the type's own: a row without it is refused, as a run refuses it. */
  declared: boolean;
  rules: MappingRule[];
  /** Today's instances of the type, by identity. */
  today: ReadonlyMap<string, string>;
  links: ResolvedRule[];
}

export interface TwinStructure {
  nodes: { id: string }[];
  edges: TwinTreeEdge[];
  /** Today's links, by the instance at either end. */
  linksOf: ReadonlyMap<string, EnvLinkRow[]>;
  outputs: OutputSpec[];
  def: MetricDef;
}

/**
 * What identifies an object, as a run would match it.
 *
 * A type that declares its identity is matched the way the database matches
 * it: trimmed, lower case. One that does not is matched on the output's own
 * keys, as written. Null when a key is missing.
 */
export function identityOf(properties: Record<string, unknown>, spec: Pick<OutputSpec, "identity" | "declared">): string | null {
  if (spec.identity.length === 0) return null;
  if (spec.declared) return identityKeyOf(properties, spec.identity);
  const parts: string[] = [];
  for (const k of spec.identity) {
    const v = properties[k];
    if (v === undefined || v === null || v === "") return null;
    parts.push(String(v));
  }
  return JSON.stringify(parts);
}

/** Today's twin, read once for a batch: its units, its links, and what each output of the pipeline writes into. Reads only. */
export async function readStructure(db: DbClient, project: Project, pipeline: Pipeline, def: MetricDef, looked: readonly string[]): Promise<TwinStructure> {
  const [tree, links, types, linkTypes] = await Promise.all([
    getUnitTree(db, project.id),
    listLinksForEnv(db, project.id),
    readTypes(db, project.organizationId),
    db.query<{ name: string; aggregates: "metrics" | null; aggregate_toward: "source" | "target" | null; transitive: boolean }>(
      `SELECT name, aggregates, aggregate_toward, transitive FROM app.ontology_link_types WHERE organization_id = $1`,
      [project.organizationId],
    ),
  ]);
  const linksOf = new Map<string, EnvLinkRow[]>();
  for (const l of links) {
    for (const end of [l.fromInstanceId, l.toInstanceId]) {
      const list = linksOf.get(end) ?? [];
      list.push(l);
      linksOf.set(end, list);
    }
  }
  const typeOf = new Map(types.map((t) => [t.name, t]));
  const linkTypeOf = new Map(linkTypes.rows.map((l) => [l.name, l]));

  // Instances are read by type, once each: an output's own type and the types its rules point at.
  const instancesOf = new Map<string, EnvInstanceRow[]>();
  const instances = async (typeName: string): Promise<EnvInstanceRow[]> => {
    const held = instancesOf.get(typeName);
    if (held) return held;
    const read = await listInstancesForEnv(db, project.id, { type: typeName, limit: config.rollupInstanceCap });
    instancesOf.set(typeName, read);
    return read;
  };

  const outputs: OutputSpec[] = [];
  for (const node of outputNodes(pipeline)) {
    const typeName = String(node.config.objectTypeName);
    if (!looked.includes(typeName)) continue;
    const type = typeOf.get(typeName);
    if (!type) throw refused(`The pipeline writes “${typeName}”, and the ontology has no such type any more.`);
    const declared = type.identity.length > 0;
    const spec: OutputSpec = {
      nodeId: node.id,
      typeId: type.id,
      typeName,
      simRole: type.simRole,
      schema: type.schema,
      identity: declared ? type.identity : ((node.config.identityProperties ?? []) as string[]),
      declared,
      rules: ((node.config.columnMapping ?? []) as MappingRule[]).filter((r) => r.from && r.to),
      today: new Map(),
      links: [],
    };
    const today = new Map<string, string>();
    // Newest first: writing over as we go leaves the oldest, which is the one a run matches.
    for (const inst of await instances(typeName)) {
      const key = identityOf(inst.properties, spec);
      if (key !== null) today.set(key, inst.id);
    }
    spec.today = today;
    for (const rule of ((node.config.linkRules ?? []) as LinkRule[]).filter((r) => r?.linkType && r.targetType && r.fromColumn && r.targetProperty)) {
      const targets = new Map<string, string>();
      for (const inst of await instances(rule.targetType)) {
        const v = inst.properties[rule.targetProperty];
        if (v === undefined || v === null) continue;
        targets.set(typeof v === "string" ? v : String(v), inst.id);
      }
      const lt = linkTypeOf.get(rule.linkType);
      spec.links.push({
        fromColumn: rule.fromColumn,
        direction: rule.direction ?? "out",
        targetTypeName: rule.targetType,
        link: lt ? { linkTypeName: lt.name, aggregates: lt.aggregates, aggregateToward: lt.aggregate_toward, transitive: lt.transitive } : null,
        targets,
      });
    }
    outputs.push(spec);
  }
  return { nodes: tree.nodes.map((n) => ({ id: n.id })), edges: tree.edges, linksOf, outputs, def };
}

async function readTypes(db: DbClient, organizationId: string): Promise<TypeInfo[]> {
  const { rows } = await db.query<{ id: string; name: string; sim_role: EnvInstanceRow["simRole"]; property_schema: PropertyDef[] | null; identity_properties: string[] | null }>(
    `SELECT id, name, sim_role, property_schema, identity_properties FROM app.ontology_object_types WHERE organization_id = $1`,
    [organizationId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, simRole: r.sim_role ?? null, schema: r.property_schema ?? [], identity: r.identity_properties ?? [] }));
}

// --- one copy, replayed in memory -------------------------------------------------------

export interface Replayed {
  instances: EnvInstanceRow[];
  links: EnvLinkRow[];
  /** Rows an output could not turn into an object: a value that could not be read, a required property missing, no identity. */
  unmapped: number;
  /** Objects the twin does not hold today, that no rule could place under something it holds. */
  unattached: number;
}

/**
 * The objects one copy would have written, and where they stand, without writing any.
 *
 * An object the twin holds today (same identity) keeps the place it has today:
 * every link it has, whoever made it. One it does not hold is placed by the
 * output's own link rules, read against today's twin; when none of them finds
 * a place, it is counted and left out. Two rows with one identity are one
 * object, the later row written over the earlier, as a run does.
 *
 * An object carries only what the copy said. A property the old file did not
 * have is absent, never today's value.
 */
export function replayObjects(structure: Pick<TwinStructure, "linksOf" | "outputs">, rowsByNode: ReadonlyMap<string, readonly Row[]>, takenAt: Date): Replayed {
  const out: Replayed = { instances: [], links: [], unmapped: 0, unattached: 0 };
  let made = 0;
  // A link between two objects of the copy is listed under both: it is one link.
  const linked = new Set<string>();
  for (const spec of structure.outputs) {
    const held = new Map<string, { properties: Record<string, unknown>; rows: Row[] }>();
    for (const row of rowsByNode.get(spec.nodeId) ?? []) {
      const { properties, issues, missingRequired } = buildMapProperties(row, spec.rules, spec.schema);
      if (issues.length > 0 || missingRequired.length > 0) {
        out.unmapped += 1;
        continue;
      }
      let key = identityOf(properties, spec);
      if (key === null) {
        if (spec.declared) {
          out.unmapped += 1;
          continue;
        }
        // No identity anywhere: a run inserts a new object for every such row.
        key = `\u0000${made++}`;
      }
      const prior = held.get(key);
      if (prior) {
        prior.properties = { ...prior.properties, ...properties };
        prior.rows.push(row);
      } else held.set(key, { properties, rows: [row] });
    }
    for (const [key, obj] of held) {
      const known = spec.today.get(key);
      const id = known ?? `replayed:${spec.typeName}:${key}`;
      out.instances.push({
        id,
        typeId: spec.typeId,
        typeName: spec.typeName,
        properties: obj.properties,
        provenance: {},
        propertySchema: spec.schema,
        simRole: spec.simRole,
        createdAt: takenAt,
        updatedAt: takenAt,
      });
      if (known) {
        for (const link of structure.linksOf.get(known) ?? []) {
          if (linked.has(link.id)) continue;
          linked.add(link.id);
          out.links.push(link);
        }
        continue;
      }
      let placed = 0;
      for (const rule of spec.links) {
        if (!rule.link) continue;
        const seen = new Set<string>();
        for (const row of obj.rows) {
          const raw = row[rule.fromColumn];
          if (raw === null || raw === undefined || String(raw).trim() === "") continue;
          const target = rule.targets.get(String(raw).trim());
          if (!target || seen.has(target)) continue;
          seen.add(target);
          const outward = rule.direction === "out";
          out.links.push({
            id: `replayed:${id}:${rule.link.linkTypeName}:${target}`,
            ...rule.link,
            fromInstanceId: outward ? id : target,
            toInstanceId: outward ? target : id,
            fromTypeName: outward ? spec.typeName : rule.targetTypeName,
            toTypeName: outward ? rule.targetTypeName : spec.typeName,
          });
          placed += 1;
        }
      }
      if (placed === 0) out.unattached += 1;
    }
  }
  return out;
}

/**
 * What the measure read, unit by unit, when this copy was taken.
 *
 * The roll-up is the twin's own (`rollupFrom`), over today's units, with the
 * copy's objects in place of today's and the clock set at when the copy was
 * taken: the time a reading was true is then the one its source gave. Every
 * unit is listed, with or without a value. Whether a line is worth writing is
 * decided against what was kept before (`recordReplayed`).
 */
export function replayReadings(structure: TwinStructure, rowsByNode: ReadonlyMap<string, readonly Row[]>, takenAt: Date): { readings: Reading[]; unmapped: number; unattached: number } {
  const replayed = replayObjects(structure, rowsByNode, takenAt);
  const metrics = rollupFrom(structure.nodes, structure.edges, replayed.instances, replayed.links, [structure.def], takenAt.getTime());
  const readings = readingsNow(metrics, takenAt).filter((r) => r.metric === structure.def.key);
  return { readings, unmapped: replayed.unmapped, unattached: replayed.unattached };
}

/**
 * Write down what a copy changed, as readings caught up. Returns how many were written.
 *
 * The same three rules as a live reading (D11), held against the last reading
 * written down at or before the time the copy was taken, and not against the
 * latest one: a catch-up fills the past, it does not answer to the present.
 * A unit that has no value and never had one starts nothing.
 */
export async function recordReplayed(db: DbClient, projectId: string, readings: readonly Reading[], takenAt: Date): Promise<number> {
  if (readings.length === 0) return 0;
  const { rows } = await db.query<{ n: number }>(
    `WITH written AS (
       INSERT INTO app.twin_reading (project_id, unit_instance_id, metric, value, observed_at, observed_basis, recorded_at, replayed)
       SELECT $1, x.unit_id, x.metric, x.value, x.observed_at, x.observed_basis, $8, true
         FROM unnest($2::uuid[], $3::text[], $4::double precision[], $5::timestamptz[], $6::text[])
              AS x(unit_id, metric, value, observed_at, observed_basis)
         LEFT JOIN LATERAL (
               SELECT true AS kept, r.value, r.observed_at
                 FROM app.twin_reading r
                WHERE r.unit_instance_id = x.unit_id AND r.metric = x.metric AND r.project_id = $1 AND r.recorded_at <= $8
                ORDER BY r.recorded_at DESC
                LIMIT 1) last ON true
        WHERE (last.kept IS NULL AND x.value IS NOT NULL)
           OR (last.kept AND last.value IS DISTINCT FROM x.value)
           OR (last.kept AND x.value IS NOT NULL
               AND ((last.observed_at IS NULL) <> (x.observed_at IS NULL)
                    OR abs(extract(epoch FROM (x.observed_at - last.observed_at))) > $7))
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM written`,
    [
      projectId,
      readings.map((r) => r.unitId),
      readings.map((r) => r.metric),
      readings.map((r) => r.value),
      readings.map((r) => (r.observedAt ? r.observedAt.toISOString() : null)),
      readings.map((r) => r.observedBasis),
      SAME_READING_SECONDS,
      takenAt.toISOString(),
    ],
  );
  return rows[0]?.n ?? 0;
}

// --- the copies ---------------------------------------------------------------------------

interface Copy {
  id: string;
  version: number;
  created_at: Date;
  row_count: number;
}

async function nextCopies(db: DbClient, datasetId: string, through: number | null, until: Date, limit: number): Promise<Copy[]> {
  const { rows } = await db.query<Copy>(
    `SELECT id, version, created_at, row_count
       FROM app.dataset_version
      WHERE dataset_id = $1 AND version > $2 AND created_at < $3
      ORDER BY version ASC
      LIMIT $4`,
    [datasetId, through ?? 0, until.toISOString(), limit],
  );
  return rows;
}

async function rowsOfCopy(db: DbClient, versionId: string, limit?: number): Promise<Row[]> {
  const { rows } = await db.query<{ data: Row }>(
    `SELECT data FROM app.dataset_row WHERE version_id = $1 ORDER BY id ASC${limit ? ` LIMIT ${Math.floor(limit)}` : ""}`,
    [versionId],
  );
  return rows.map((r) => r.data);
}

/**
 * The copy of a dataset as it was at an instant: the last one taken by then.
 * Null when none had been taken yet. A later copy never stands in: read with
 * it, an old copy would be measured against figures that did not exist yet.
 */
async function copyAsOf(db: DbClient, datasetId: string, at: Date): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM app.dataset_version WHERE dataset_id = $1 AND created_at <= $2 ORDER BY version DESC LIMIT 1`,
    [datasetId, at.toISOString()],
  );
  return rows[0]?.id ?? null;
}

// --- where a catch-up stands ---------------------------------------------------------------

export interface CatchupState {
  key: string;
  datasetId: string;
  datasetName: string;
  /** The pipeline the copies go through; null for a dataset series. */
  pipelineId: string | null;
  pipelineName: string | null;
  /** The pipeline input these copies are read in place of, when they are another dataset's. */
  inPlaceOf: { datasetId: string; datasetName: string } | null;
  /** Copies taken before this instant are the ones read: when the series started being kept. */
  until: string;
  /** When the oldest of them was taken. */
  firstCopyAt: string | null;
  copies: number;
  read: number;
  /** Points or readings written down. */
  written: number;
  /** Copies that could not be replayed at all. */
  copiesLeftOut: number;
  /** Rows that made no object or no point. */
  rowsLeftOut: number;
  /** Objects that could not be placed under anything the twin holds. */
  rowsUnattached: number;
  /** The last thing that went wrong, in a sentence. */
  note: string | null;
  done: boolean;
  startedAt: string;
  updatedAt: string;
}

interface CatchupRow {
  id: string;
  series_key: string;
  dataset_id: string;
  dataset_name: string;
  pipeline_id: string | null;
  pipeline_name: string | null;
  in_place_of: string | null;
  in_place_of_name: string | null;
  until_at: Date;
  through_version: number | null;
  versions_total: number;
  points_written: number;
  copies_left_out: number;
  rows_left_out: number;
  rows_unattached: number;
  last_note: string | null;
  started_at: Date;
  updated_at: Date;
  remaining: number;
  first_copy_at: Date | null;
}

const CATCHUP_SELECT = `
  SELECT c.id, c.series_key, c.dataset_id, d.name AS dataset_name, c.pipeline_id, p.name AS pipeline_name,
         c.in_place_of, r.name AS in_place_of_name, c.until_at, c.through_version, c.versions_total,
         c.points_written, c.copies_left_out, c.rows_left_out, c.rows_unattached, c.last_note, c.started_at, c.updated_at,
         (SELECT count(*)::int FROM app.dataset_version v
           WHERE v.dataset_id = c.dataset_id AND v.version > COALESCE(c.through_version, 0) AND v.created_at < c.until_at) AS remaining,
         (SELECT min(v.created_at) FROM app.dataset_version v
           WHERE v.dataset_id = c.dataset_id AND v.created_at < c.until_at) AS first_copy_at
    FROM app.series_catchup c
    JOIN app.dataset d ON d.id = c.dataset_id
    LEFT JOIN app.pipeline p ON p.id = c.pipeline_id
    LEFT JOIN app.dataset r ON r.id = c.in_place_of`;

function stateOf(r: CatchupRow): CatchupState {
  return {
    key: r.series_key,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    pipelineId: r.pipeline_id,
    pipelineName: r.pipeline_name,
    inPlaceOf: r.in_place_of ? { datasetId: r.in_place_of, datasetName: r.in_place_of_name ?? "A dataset that is no longer there" } : null,
    until: r.until_at.toISOString(),
    firstCopyAt: r.first_copy_at ? r.first_copy_at.toISOString() : null,
    copies: r.versions_total,
    read: Math.max(0, r.versions_total - r.remaining),
    written: r.points_written,
    copiesLeftOut: r.copies_left_out,
    rowsLeftOut: r.rows_left_out,
    rowsUnattached: r.rows_unattached,
    note: r.last_note,
    done: r.remaining === 0,
    startedAt: r.started_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Every catch-up of the project, the oldest first: what was caught up, and where each one stands. */
export async function listCatchups(db: DbClient, projectId: string, key?: string): Promise<CatchupState[]> {
  try {
    const { rows } = await db.query<CatchupRow>(
      `${CATCHUP_SELECT} WHERE c.project_id = $1${key ? " AND c.series_key = $2" : ""} ORDER BY c.started_at ASC`,
      key ? [projectId, key] : [projectId],
    );
    return rows.map(stateOf);
  } catch (err) {
    // A database that has not been migrated yet has no such table: nothing was caught up.
    if ((err as { code?: string }).code === "42P01") return [];
    throw err;
  }
}

// --- what can be caught up -------------------------------------------------------------------

export interface CopiesOf {
  datasetId: string;
  datasetName: string;
  /** Copies taken before the series started being kept. */
  copies: number;
  firstAt: string | null;
  lastAt: string | null;
  columns: string[];
}

export interface CatchupPath {
  /** Null for a dataset series: its copies are read as they are. */
  pipelineId: string | null;
  pipelineName: string | null;
  /** The datasets the pipeline reads, each with its older copies. For a dataset series, its own dataset. */
  inputs: CopiesOf[];
}

export interface CatchupOffer {
  key: string;
  origin: "twin" | "dataset";
  /** Copies taken before this instant are the ones a catch-up reads. Null when the series has nothing kept yet. */
  until: string | null;
  paths: CatchupPath[];
  /** For a twin measure: the project's other tables that have older copies, which can be read in place of a pipeline's input. */
  standIns: CopiesOf[];
  /** Why nothing can be caught up, when `paths` is empty. */
  why: string | null;
  begun: CatchupState[];
}

interface Table {
  id: string;
  name: string;
  columns: string[];
}

async function tablesOf(db: DbClient, projectId: string): Promise<Table[]> {
  const { rows } = await db.query<{ id: string; name: string; column_schema: { name: string }[] | null }>(
    `SELECT id, name, column_schema FROM app.dataset WHERE project_id = $1 AND kind = 'table' ORDER BY name`,
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, columns: (r.column_schema ?? []).map((c) => c.name) }));
}

async function olderCopies(db: DbClient, projectId: string, until: Date): Promise<Map<string, { n: number; first: Date; last: Date }>> {
  const { rows } = await db.query<{ dataset_id: string; n: number; first: Date; last: Date }>(
    `SELECT v.dataset_id, count(*)::int AS n, min(v.created_at) AS first, max(v.created_at) AS last
       FROM app.dataset_version v
       JOIN app.dataset d ON d.id = v.dataset_id
      WHERE d.project_id = $1 AND v.created_at < $2
      GROUP BY v.dataset_id`,
    [projectId, until.toISOString()],
  );
  return new Map(rows.map((r) => [r.dataset_id, r]));
}

const copiesOf = (t: Table, older: ReadonlyMap<string, { n: number; first: Date; last: Date }>): CopiesOf => {
  const o = older.get(t.id);
  return { datasetId: t.id, datasetName: t.name, copies: o?.n ?? 0, firstAt: o ? o.first.toISOString() : null, lastAt: o ? o.last.toISOString() : null, columns: t.columns };
};

/** When a twin measure started being kept: its first reading that was not caught up. Null when it has none. */
async function twinKeptSince(db: DbClient, projectId: string, metric: string): Promise<Date | null> {
  const { rows } = await db.query<{ first: Date | null }>(
    `SELECT min(recorded_at) AS first FROM app.twin_reading WHERE project_id = $1 AND metric = $2 AND NOT replayed`,
    [projectId, metric],
  );
  return rows[0]?.first ?? null;
}

async function declaredSeries(db: DbClient, projectId: string, key: string): Promise<{ def: SeriesDef; since: Date }> {
  const { rows } = await db.query<SeriesDbRow & { since: Date }>(
    `SELECT ${SERIES_COLUMNS.split(", ").map((c) => `s.${c}`).join(", ")},
            COALESCE((SELECT min(p.seen_at) FROM app.series_point p WHERE p.series_id = s.id AND NOT p.replayed), s.created_at) AS since
       FROM app.kept_series s
      WHERE s.project_id = $1 AND s.key = $2`,
    [projectId, key],
  );
  if (!rows[0]) throw NotFound("SERIES_NOT_FOUND", "That series is not kept in this project.");
  return { def: seriesOf(rows[0]), since: rows[0].since };
}

interface TwinPlan {
  def: MetricDef;
  looked: string[];
  until: Date | null;
  pipelines: Pipeline[];
  /** Why each pipeline that writes one of the measure's types cannot be used. */
  reasons: string[];
}

async function twinPlan(db: DbClient, project: Project, metric: string): Promise<TwinPlan | { why: string }> {
  const [defs, types, pipelines, until] = await Promise.all([
    listTwinMetrics(db, project.organizationId),
    readTypes(db, project.organizationId),
    listPipelines(db, project.id),
    twinKeptSince(db, project.id, metric),
  ]);
  const def = defs.find((d) => d.key === metric);
  if (!def) throw NotFound("SERIES_NOT_FOUND", `The organisation defines no measure called “${metric}”.`);
  const looked = typesLookedAt(def, types);
  if (looked === null) return { why: "This measure counts every object under a unit, whatever its type: its past cannot be rebuilt from one file." };
  if (looked.length === 0) return { why: "This measure reads no object type the ontology holds." };
  const usable: Pipeline[] = [];
  const reasons: string[] = [];
  for (const p of pipelines) {
    const writes = outputNodes(p).some((n) => looked.includes(String(n.config.objectTypeName)));
    if (!writes) continue;
    const why = whyNotThrough(p, looked);
    if (why) reasons.push(why);
    else usable.push(p);
  }
  return { def, looked, until, pipelines: usable, reasons };
}

/** What a catch-up of this series could read, and what was already begun. Reads only. */
export async function catchupOffer(db: DbClient, project: Project, key: string): Promise<CatchupOffer> {
  const begun = await listCatchups(db, project.id, key);
  if (!key.startsWith(TWIN_PREFIX)) {
    const { def, since } = await declaredSeries(db, project.id, key);
    const [tables, older] = await Promise.all([tablesOf(db, project.id), olderCopies(db, project.id, since)]);
    const table = tables.find((t) => t.id === def.datasetId);
    const own = table ? copiesOf(table, older) : null;
    return {
      key,
      origin: "dataset",
      until: since.toISOString(),
      paths: own && own.copies > 0 ? [{ pipelineId: null, pipelineName: null, inputs: [own] }] : [],
      standIns: [],
      why: own && own.copies > 0 ? null : "No copy of this dataset was taken before the series started being kept: there is nothing older to read.",
      begun,
    };
  }

  const plan = await twinPlan(db, project, key.slice(TWIN_PREFIX.length));
  if ("why" in plan) return { key, origin: "twin", until: null, paths: [], standIns: [], why: plan.why, begun };
  if (!plan.until) {
    return { key, origin: "twin", until: null, paths: [], standIns: [], why: "The twin has kept no reading of this measure yet: there is nothing to go back from.", begun };
  }
  if (plan.pipelines.length === 0) {
    const why = plan.reasons.length > 0 ? plan.reasons.join(" ") : `No pipeline of this project writes ${plan.looked.join(" or ")}: there is nothing to pass the copies through.`;
    return { key, origin: "twin", until: plan.until.toISOString(), paths: [], standIns: [], why, begun };
  }
  const [tables, older] = await Promise.all([tablesOf(db, project.id), olderCopies(db, project.id, plan.until)]);
  const tableOf = new Map(tables.map((t) => [t.id, t]));
  const paths: CatchupPath[] = plan.pipelines.map((p) => ({
    pipelineId: p.id,
    pipelineName: p.name,
    inputs: inputDatasets(p)
      .map((id) => tableOf.get(id))
      .filter((t): t is Table => t !== undefined)
      .map((t) => copiesOf(t, older)),
  }));
  const standIns = tables.filter((t) => (older.get(t.id)?.n ?? 0) > 0).map((t) => copiesOf(t, older));
  const any = paths.some((p) => p.inputs.some((i) => i.copies > 0)) || standIns.length > 0;
  return {
    key,
    origin: "twin",
    until: plan.until.toISOString(),
    paths,
    standIns,
    why: any ? null : "No copy of any dataset of this project was taken before this measure's first reading: there is nothing older to read.",
    begun,
  };
}

// --- one batch ---------------------------------------------------------------------------------

export const catchupRequest = z.object({
  /** `twin:<measure>`, or the key of a declared series. */
  key: z.string().trim().min(1).max(120),
  /** The dataset whose copies are read. */
  datasetId: z.string().uuid(),
  /** For a twin measure: the pipeline the copies go through. */
  pipelineId: z.string().uuid().nullable().default(null),
  /** For a twin measure: the pipeline input these copies are read in place of, when `datasetId` is not one of its inputs. */
  inPlaceOf: z.string().uuid().nullable().default(null),
});
export type CatchupRequest = z.infer<typeof catchupRequest>;

export interface BatchResult {
  state: CatchupState;
  /** True when this call began the catch-up. */
  began: boolean;
  /** Copies read by this call, and what it wrote. */
  read: number;
  written: number;
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

async function findRow(db: DbClient, projectId: string, key: string, datasetId: string): Promise<CatchupRow | null> {
  const { rows } = await db.query<CatchupRow>(`${CATCHUP_SELECT} WHERE c.project_id = $1 AND c.series_key = $2 AND c.dataset_id = $3`, [projectId, key, datasetId]);
  return rows[0] ?? null;
}

/**
 * One bounded batch of a catch-up: the next few copies, oldest first.
 *
 * The first call begins it, and fixes what it reads: copies taken before the
 * series started being kept. Later calls resume where the last one stopped.
 * A copy that cannot be replayed is counted and stepped over, never retried
 * for ever: the catch-up always ends.
 */
export async function runCatchup(db: DbClient, project: Project, userId: string | null, req: CatchupRequest, now: () => number = Date.now): Promise<BatchResult> {
  const twin = req.key.startsWith(TWIN_PREFIX);
  let row = await findRow(db, project.id, req.key, req.datasetId);
  let began = false;

  let series: SeriesDef | null = null;
  let seriesSince: Date | null = null;
  let plan: TwinPlan | null = null;
  if (twin) {
    const found = await twinPlan(db, project, req.key.slice(TWIN_PREFIX.length));
    if ("why" in found) throw refused(found.why);
    plan = found;
  } else {
    const declared = await declaredSeries(db, project.id, req.key);
    series = declared.def;
    seriesSince = declared.since;
    if (series.datasetId !== req.datasetId) throw refused("A dataset series is caught up from the copies of its own dataset.");
  }

  if (!row) {
    let until: Date;
    let pipelineId: string | null = null;
    let inPlaceOf: string | null = null;
    if (twin) {
      if (!plan!.until) throw refused("The twin has kept no reading of this measure yet: there is nothing to go back from.");
      until = plan!.until;
      const pipeline = plan!.pipelines.find((p) => p.id === req.pipelineId);
      if (!pipeline) throw refused(plan!.reasons[0] ?? "Name the pipeline the copies go through: one that writes this measure's objects today.");
      const inputs = inputDatasets(pipeline);
      if (inputs.includes(req.datasetId)) {
        if (req.inPlaceOf) throw refused("That dataset is one the pipeline reads itself: it stands in place of nothing.");
      } else {
        if (!req.inPlaceOf || !inputs.includes(req.inPlaceOf)) {
          throw refused(`“${pipeline.name}” does not read that dataset. Say which of its inputs these copies are read in place of.`);
        }
        inPlaceOf = req.inPlaceOf;
      }
      pipelineId = pipeline.id;
    } else {
      until = seriesSince!;
    }
    const tables = await tablesOf(db, project.id);
    const table = tables.find((t) => t.id === req.datasetId);
    if (!table) throw NotFound("DATASET_NOT_FOUND", "That dataset is not a table of this project.");
    const older = (await olderCopies(db, project.id, until)).get(table.id)?.n ?? 0;
    if (older === 0) throw refused(`No copy of “${table.name}” was taken before ${dayOf(until)}: there is nothing older to read.`);
    await db.query(
      `INSERT INTO app.series_catchup (project_id, series_key, dataset_id, pipeline_id, in_place_of, until_at, versions_total, started_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, series_key, dataset_id) DO NOTHING`,
      [project.id, req.key, req.datasetId, pipelineId, inPlaceOf, until.toISOString(), older, userId],
    );
    row = await findRow(db, project.id, req.key, req.datasetId);
    if (!row) throw refused("The catch-up could not be begun.");
    began = true;
  } else if (twin && ((req.pipelineId && req.pipelineId !== row.pipeline_id) || (req.inPlaceOf && req.inPlaceOf !== row.in_place_of))) {
    throw refused("A catch-up of this measure from that dataset was begun another way. Resume it as it was begun, or forget it and start again.");
  }

  if (row.remaining === 0) return { state: stateOf(row), began, read: 0, written: 0 };

  const copies = await nextCopies(db, row.dataset_id, row.through_version, row.until_at, BATCH_COPIES);
  const started = now();
  const tally = { read: 0, written: 0, copiesLeftOut: 0, rowsLeftOut: 0, rowsUnattached: 0, rows: 0, through: row.through_version ?? 0, note: null as string | null };

  let structure: TwinStructure | null = null;
  let pipeline: Pipeline | null = null;
  const replaced = row.in_place_of ?? row.dataset_id;
  const otherRows = new Map<string, Row[]>();
  /** The pipeline's other inputs, by dataset, with their names. */
  let others: { id: string; name: string }[] = [];
  if (twin) {
    pipeline = plan!.pipelines.find((p) => p.id === row!.pipeline_id) ?? null;
    if (!pipeline) throw refused(plan!.reasons[0] ?? "The pipeline this catch-up went through no longer writes this measure's objects. Forget what was caught up and start again.");
    // A run refuses a pipeline that does not hold together; a replay of it would measure whatever was left.
    const problems = validate(pipeline);
    if (problems.length > 0) throw refused(`“${pipeline.name}” has problems a run would refuse: ${problems.map((i) => i.message).join(" ")}`);
    structure = await readStructure(db, project, pipeline, plan!.def, plan!.looked);
    const nameOf = new Map((await tablesOf(db, project.id)).map((t) => [t.id, t.name]));
    others = inputDatasets(pipeline)
      .filter((id) => id !== replaced)
      .map((id) => ({ id, name: nameOf.get(id) ?? "a dataset that is no longer there" }));
  }

  for (const copy of copies) {
    if (tally.read > 0 && (now() - started > BATCH_MS || tally.rows + copy.row_count > BATCH_ROWS)) break;
    tally.rows += copy.row_count;
    if (!twin) {
      const captured = await captureInto(db, series!, await rowsOfCopy(db, copy.id), copy.created_at, copy.id, true);
      tally.written += captured.written;
      tally.rowsLeftOut += captured.leftOut;
    } else {
      // The pipeline's other inputs, as they were when this copy was taken.
      const then = new Map<string, string>();
      let missing: string | null = null;
      for (const other of others) {
        const versionId = await copyAsOf(db, other.id, copy.created_at);
        if (!versionId) {
          missing = other.name;
          break;
        }
        then.set(other.id, versionId);
      }
      if (missing !== null) {
        tally.copiesLeftOut += 1;
        tally.note = `“${missing}” had no copy yet when the copy of ${dayOf(copy.created_at)} was taken: the pipeline's other input cannot be read as it was then. That copy was left out, rather than measured with a later one.`;
        tally.read += 1;
        tally.through = copy.version;
        continue;
      }
      const rowsByNode = new Map<string, Row[]>();
      const result = await execute(db, pipeline!, {
        preview: true,
        limit: MAX_ROWS,
        readInput: async (datasetId, limit) => {
          // One more than the ceiling, so that a copy too long for a run is seen as cut and not taken for whole.
          if (datasetId === replaced) return rowsOfCopy(db, copy.id, limit + 1);
          const versionId = then.get(datasetId);
          if (!versionId) return [];
          let rows = otherRows.get(versionId);
          if (!rows) {
            rows = await rowsOfCopy(db, versionId, limit + 1);
            otherRows.set(versionId, rows);
          }
          return rows;
        },
        onObjectRows: (node, rows) => rowsByNode.set(node.id, rows),
      });
      const cut = Object.values(result.nodeStats).some((s) => (s.truncated ?? 0) > 0);
      if (result.status !== "succeeded") {
        tally.copiesLeftOut += 1;
        tally.note = `The pipeline could not run on the copy of ${dayOf(copy.created_at)}: ${result.error ?? "it failed"}. That copy was left out.`;
      } else if (cut) {
        tally.copiesLeftOut += 1;
        tally.note = `The copy of ${dayOf(copy.created_at)} holds more rows than a run reads (${MAX_ROWS.toLocaleString("en-CA")}). It was left out rather than measured on a part of it.`;
      } else {
        const replay = replayReadings(structure!, rowsByNode, copy.created_at);
        tally.written += await recordReplayed(db, project.id, replay.readings, copy.created_at);
        tally.rowsLeftOut += replay.unmapped;
        tally.rowsUnattached += replay.unattached;
      }
    }
    tally.read += 1;
    tally.through = copy.version;
  }

  await db.query(
    `UPDATE app.series_catchup
        SET through_version = GREATEST(COALESCE(through_version, 0), $2),
            points_written = points_written + $3,
            copies_left_out = copies_left_out + $4,
            rows_left_out = rows_left_out + $5,
            rows_unattached = rows_unattached + $6,
            last_note = COALESCE($7, last_note),
            updated_at = NOW()
      WHERE id = $1`,
    [row.id, tally.through, tally.written, tally.copiesLeftOut, tally.rowsLeftOut, tally.rowsUnattached, tally.note],
  );
  const after = await findRow(db, project.id, req.key, req.datasetId);
  if (!after) throw refused("The catch-up was forgotten while it ran.");
  if (after.remaining === 0) await db.query(`UPDATE app.series_catchup SET finished_at = COALESCE(finished_at, NOW()) WHERE id = $1`, [after.id]);
  return { state: stateOf(after), began, read: tally.read, written: tally.written };
}

// --- forgetting what was caught up ---------------------------------------------------------------

/**
 * Remove what the catch-ups of a series wrote, and the catch-ups themselves.
 *
 * Only what is marked as caught up: a reading the twin took live, a point a
 * sync wrote, are never touched. The copies are not touched either, so the
 * catch-up can be run again.
 */
export async function forgetCatchup(db: DbClient, project: Project, key: string): Promise<{ removed: number }> {
  let removed = 0;
  if (key.startsWith(TWIN_PREFIX)) {
    const r = await db.query(`DELETE FROM app.twin_reading WHERE project_id = $1 AND metric = $2 AND replayed`, [project.id, key.slice(TWIN_PREFIX.length)]);
    removed = r.rowCount ?? 0;
  } else {
    const { def } = await declaredSeries(db, project.id, key);
    const r = await db.query(`DELETE FROM app.series_point WHERE series_id = $1 AND replayed`, [def.id]);
    removed = r.rowCount ?? 0;
  }
  await db.query(`DELETE FROM app.series_catchup WHERE project_id = $1 AND series_key = $2`, [project.id, key]);
  return { removed };
}
