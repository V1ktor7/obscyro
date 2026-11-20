import { choiceRefs } from "./scenario-stamps.js";
import { z } from "zod";

import { CalcError, UNIT_CONSTANTS, evaluate } from "./analyst-calc.js";
import { Ledger, numbersIn } from "./analyst-verify.js";
import type { DatasetRow } from "./datasets.js";
import type { HealthEvent } from "./health-events.js";
import { alertsNow, unitNow, type LiveReading, type LiveUnit } from "./live-reading.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import type { SimExport } from "./twin-export.js";

/**
 * What the analyst can read.
 *
 * The analyst does not know the twin. It knows it can ask, and every answer it
 * gives has to rest on something it asked. So the tools below are the whole of
 * its knowledge of this network: the sites and what they hold, the catchments
 * and who serves them, what the open scenario changes, what the last run on
 * screen produced, the series the project imported, and what is open right
 * now: the alerts and a unit's live figures, read where the screens read them.
 *
 * They are plain functions of data already read — no model, no randomness, the
 * same answer to the same question — and they only read. Nothing here can
 * change the twin, a scenario or a dataset.
 *
 * Two worlds. `reality` is the twin as it stands; `scenario` is the same twin
 * read through the open scenario's edits. Every tool that looks at the network
 * says which one it looked at, because "how many beds does this site have" has
 * two right answers once somebody has proposed to add sixty.
 */

export type WorldName = "reality" | "scenario";

/** A refusal the analyst can read and act on: a wrong name, a missing run. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

// ---------------------------------------------------------------------------
// The run on screen, as the page summarised it.
// ---------------------------------------------------------------------------

const count = z.number().finite();
const day = z.number().int().min(0).max(4000);
const series = z.array(z.number().finite().nullable()).max(800);

const siteBreak = z.object({
  firstDay: day.nullable(),
  days: count,
  peakWaiting: count,
  peakDay: day,
  waitingDays: count,
  peakOccupancy: count,
});

const variantDigest = z.object({
  /** Capacity-weighted occupancy across every site, by day, as a share. */
  island: series,
  sitesWithQueue: count,
  sitesWithActivity: count,
  firstQueueDay: day.nullable(),
  waitingDays: count,
  peakWaiting: count,
  peakWaitingDay: day,
  /** Patient-days waiting in catchments no site serves; null when not counted. */
  strandedWaitingDays: count.nullable(),
  /** Arrivals a day, by severity. */
  arrivals: z.record(z.array(z.number().finite()).max(800)),
  notes: z.array(z.string().max(600)).max(20),
});

export const runDigestSchema = z.object({
  ranAt: z.string().max(40),
  /** True when the recipe changed after this run. */
  stale: z.boolean(),
  horizon: z.number().int().min(1).max(800),
  activity: z.string().min(1).max(120),
  events: variantDigest,
  full: variantDigest,
  sites: z
    .array(
      z.object({
        id: z.string().max(80),
        name: z.string().max(300),
        capacity: count,
        events: siteBreak,
        full: siteBreak,
        /** By day, for the sites where somebody waits in either run. */
        daily: z
          .object({
            occupancyEvents: series,
            occupancyFull: series,
            waitingEvents: series,
            waitingFull: series,
          })
          .nullable(),
      }),
    )
    .max(600),
  stranded: z.object({ names: z.array(z.string().max(300)).max(100), residents: count }).nullable(),
});

export type RunDigest = z.infer<typeof runDigestSchema>;

// ---------------------------------------------------------------------------
// What a tool is handed.
// ---------------------------------------------------------------------------

export interface AnalystScenario {
  id: string;
  name: string;
  description: string | null;
  overrides: ScenarioOverride[];
}

export interface AnalystContext {
  environment: string;
  /** The twin read through a world. Rejects with `ToolError` when no scenario is open. */
  world(name: WorldName): Promise<SimExport>;
  scenario: AnalystScenario | null;
  run: RunDigest | null;
  datasets(): Promise<DatasetRow[]>;
  rows(datasetId: string): Promise<Record<string, unknown>[]>;
  /** The project's calendar: events a person accepted from official web sources, earliest first. */
  events(): Promise<HealthEvent[]>;
  /**
   * The twin as the live pages read it: the unit page's roll-up and the alert
   * feed. Reality only, read once per question.
   */
  live(): Promise<LiveReading>;
  /** The question and everything read so far: what `calculate` may build on. */
  known: Ledger;
  /**
   * Where an option can be run through the engine. Absent or null when the
   * question was asked somewhere that tests nothing (the Ask tab): the analyst
   * then reads, and says what would have to be run.
   */
  bench?: OptionBench | null;
}

/** What `test_option` runs on. Built by the route; see `analyst-options.ts`. */
export interface OptionBench {
  horizon: number;
  activity: string;
  /** Options tested so far for this objective, by what they change. */
  tested: string[];
  /** The scenario's twin, its stamps and the engine, read once and kept. */
  open(): Promise<import("./analyst-options.js").OpenBench>;
  /** What `open` read, once it has; null before the first test. */
  opened: import("./analyst-options.js").OpenBench | null;
}

/**
 * A result that holds more than the model needs.
 *
 * `result` is what the model reads and cites, and what the checker looks
 * figures up in. `record` is the same reading kept whole — day by day, with
 * what a person would need to act on it — for the screen and the journal. It
 * is never sent to the model, so it adds nothing a sentence could lean on.
 */
export class Recorded {
  constructor(
    readonly result: unknown,
    readonly record: unknown,
  ) {}
}

export interface AnalystTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  parse: z.ZodTypeAny;
  /** Said on screen while the tool runs, for one that takes more than a moment. */
  busy?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(ctx: AnalystContext, input: any): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Reading the export.
// ---------------------------------------------------------------------------

export const round = (n: number, d = 1): number => {
  const k = 10 ** d;
  return Math.round(n * k) / k;
};

export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface SiteView {
  id: string;
  name: string;
  location: { lat: number; lon: number } | null;
  /** Units per activity: what the site holds, and how many are marked in use. */
  activities: Record<string, { capacity: number; in_use: number; free: number; kind: string }>;
  census: Record<string, number>;
  /** Ids of the catchments that list this site. */
  catchments: string[];
}

function sitesOf(ex: SimExport): SiteView[] {
  const listedBy = new Map<string, string[]>();
  for (const p of ex.populations) {
    for (const id of p.served_by) listedBy.set(id, [...(listedBy.get(id) ?? []), p.id]);
  }
  return ex.facilities.map((f) => {
    const activities: SiteView["activities"] = {};
    for (const r of Object.values(f.resources)) {
      const capacity = Number(r.capacity) || 0;
      const free = Number.isFinite(Number(r.quantity)) ? Number(r.quantity) : capacity;
      for (const a of r.enables) {
        const cur = activities[a] ?? { capacity: 0, in_use: 0, free: 0, kind: r.category };
        cur.capacity += capacity;
        cur.free += free;
        cur.in_use += Math.max(0, capacity - free);
        activities[a] = cur;
      }
    }
    return {
      id: f.id,
      name: f.name,
      location: f.location ? { lat: f.location[0], lon: f.location[1] } : null,
      activities,
      census: f.census,
      catchments: listedBy.get(f.id) ?? [],
    };
  });
}

function activitiesOf(sites: SiteView[]): string[] {
  const all = new Set<string>();
  for (const s of sites) for (const a of Object.keys(s.activities)) all.add(a);
  return [...all].sort();
}

function requireActivity(sites: SiteView[], activity: string): string {
  const all = activitiesOf(sites);
  const hit = all.find((a) => a === activity) ?? all.find((a) => fold(a) === fold(activity));
  if (!hit) {
    throw new ToolError(
      `No site provides "${activity}". The activities in this twin are: ${all.join(", ") || "none"}. Use one of these names exactly.`,
    );
  }
  return hit;
}

/**
 * One thing out of a list, by id or by name.
 *
 * An exact name wins; otherwise every word asked for has to be in the name.
 * Two hits is a question to ask, not a coin to toss.
 */
export function pick<T extends { id: string; name: string }>(items: T[], query: string, what: string): T {
  const q = fold(query);
  const byId = items.find((i) => i.id === query || i.id === `pop:${query}`);
  if (byId) return byId;
  const exact = items.filter((i) => fold(i.name) === q);
  if (exact.length === 1) return exact[0]!;
  const words = q.split(" ").filter(Boolean);
  const partial = items.filter((i) => {
    const n = fold(i.name);
    return words.length > 0 && words.every((w) => n.includes(w));
  });
  const hits = exact.length > 1 ? exact : partial;
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) {
    throw new ToolError(`No ${what} matches "${query}". Look it up first, then use its id or its full name.`);
  }
  throw new ToolError(
    `${hits.length} ${what}s match "${query}": ${hits
      .slice(0, 8)
      .map((h) => `${h.name} (${h.id})`)
      .join("; ")}${hits.length > 8 ? "; …" : ""}. Use an id.`,
  );
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The model the twin declares: what care consumes, and how a condition moves through people. */
const MODEL_MECHANICS = [
  "serves_severity",
  "consumes_activity",
  "consumes_amount",
  "occupies_for",
  "dies_without",
  "leaves_state",
  "enters_state",
  "transition_rate",
  "driven_by_state",
  "couples_along",
  "produces_demand",
] as const;

function declaredModel(ex: SimExport): Record<string, unknown>[] {
  const bound = new Map<string, Map<string, { key: string; unit: string | null }>>();
  for (const t of ex.object_types) {
    const m = new Map<string, { key: string; unit: string | null }>();
    for (const p of t.properties) {
      if (p.mechanic && (MODEL_MECHANICS as readonly string[]).includes(p.mechanic) && !m.has(p.mechanic)) {
        m.set(p.mechanic, { key: p.key, unit: p.unit });
      }
    }
    if (m.size) bound.set(t.name, m);
  }
  const out: Record<string, unknown>[] = [];
  for (const o of ex.objects) {
    const m = bound.get(o.type);
    if (!m) continue;
    const row: Record<string, unknown> = { type: o.type, name: text(o.properties.name) ?? text(o.properties.code) ?? o.id.slice(0, 8) };
    for (const [mechanic, { key, unit }] of m) {
      const v = o.properties[key];
      if (v === undefined || v === null || v === "") continue;
      row[mechanic] = unit && typeof v === "number" ? `${v} ${unit}` : v;
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading the scenario.
// ---------------------------------------------------------------------------

const STAMP_PREFIX = "stamp:";
const REALITY_KEY = "reality";

function recipe(scenario: AnalystScenario, ex: SimExport): Record<string, unknown> {
  const siteName = (id: string) => ex.facilities.find((f) => f.id === id)?.name ?? id;
  const popName = (id: string) => ex.populations.find((p) => p.id === id || p.id === `pop:${id}`)?.name ?? id;
  const conditions: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const choices: Record<string, unknown>[] = [];
  const network: Record<string, unknown>[] = [];
  let compared: Record<string, unknown> | null = null;
  let other = 0;
  // What test_option calls each choice, to replace it or to remove it.
  const refs = choiceRefs(scenario.overrides);

  for (const o of scenario.overrides) {
    const from_day = Math.max(0, Math.round(o.effectiveOffsetHours / 24));
    const days = o.durationHours === null ? null : Math.max(1, Math.round(o.durationHours / 24));
    if (o.targetType === "param" && o.op === "set_param") {
      const key = String(o.payload.key ?? "");
      const v = (o.payload.value ?? {}) as Record<string, unknown>;
      if (key === REALITY_KEY) {
        compared = {
          dataset: v.datasetName ?? v.datasetId,
          dataset_id: v.datasetId,
          date_column: v.when,
          value_column: v.value,
          day_0_is: v.origin,
          compared_with_arrivals_of: v.acuity,
        };
        continue;
      }
      if (!key.startsWith(STAMP_PREFIX)) {
        other += 1;
        continue;
      }
      switch (v.kind) {
        case "occupancy":
          conditions.push({ what: "usual occupancy", activity: v.activity, share_in_use_pct: round(Number(v.share) * 100), applies: "every site, whole run" });
          break;
        case "immunity":
          conditions.push({ what: "prior immunity", share_of_residents_pct: round(Number(v.share) * 100), applies: "every catchment, from day 0" });
          break;
        case "variant":
          conditions.push({ what: "transmissibility", contacts_multiplied_by: v.factor, applies: "every contact layer, whole run" });
          break;
        case "seed":
          events.push({ what: "outbreak", catchment: popName(String(v.population)), people_sick: v.count, on_day: from_day });
          break;
        case "heat":
          events.push({ what: "heat wave", extra_arrivals_per_1000_residents_per_day: v.perThousand, severity: v.acuity, from_day, days });
          break;
        case "measure": {
          const pops = Array.isArray(v.populations) ? (v.populations as string[]).map(popName) : null;
          choices.push({
            ref: refs.get(o.id) ?? null,
            what: "measure",
            label: v.label,
            contact_layers: v.layers,
            where: pops === null ? "every catchment" : pops,
            radius_km: v.radiusKm ?? null,
            from_day,
            days,
          });
          break;
        }
        case "capacity":
          choices.push({
            ref: refs.get(o.id) ?? null,
            what: "capacity",
            site: siteName(String(v.facility)),
            site_id: v.facility,
            activity: v.activity,
            units_added: v.amount,
            from_day,
          });
          break;
        default:
          other += 1;
      }
      continue;
    }
    if (o.targetType === "link" && (o.op === "link" || o.op === "unlink")) {
      network.push({
        what: o.op === "link" ? "site linked to a catchment" : "site unlinked from a catchment",
        site: siteName(String(o.targetId ?? "")),
        site_id: o.targetId,
        catchment: popName(String(o.payload.toId ?? "")),
        relationship: o.payload.linkType ?? null,
        note: o.note,
      });
      continue;
    }
    other += 1;
  }

  return {
    scenario: { id: scenario.id, name: scenario.name, description: scenario.description },
    starting_conditions: conditions,
    events,
    choices,
    network_edits: network,
    compared_with: compared,
    other_edits: other,
    how_to_read:
      "Conditions and events are in both runs. Choices (measures, capacity) are only in the run called 'with your choices'. " +
      "Network edits change which sites a catchment's patients can go to, in both runs. " +
      "A choice's ref is how test_option names it, to replace it or to remove it; conditions and events have none, because an option does not undo what happens.",
  };
}

// ---------------------------------------------------------------------------
// Reading a dataset.
// ---------------------------------------------------------------------------

function isoDay(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1]!;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[\s  ]/g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function pickDataset(ctx: AnalystContext, query: string): Promise<DatasetRow> {
  const all = await ctx.datasets();
  if (all.length === 0) throw new ToolError("This project holds no dataset.");
  return pick(all, query, "dataset");
}

function requireColumn(ds: DatasetRow, name: string): string {
  const hit = ds.columnSchema.find((c) => c.name === name) ?? ds.columnSchema.find((c) => fold(c.name) === fold(name));
  if (!hit) {
    throw new ToolError(`"${ds.name}" has no column "${name}". Its columns: ${ds.columnSchema.map((c) => c.name).join(", ")}.`);
  }
  return hit.name;
}

/** Values a text column takes, when there are few enough to be a category. */
function categories(rows: Record<string, unknown>[], ds: DatasetRow): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of ds.columnSchema) {
    if (c.type !== "string") continue;
    const seen = new Set<string>();
    for (const r of rows) {
      const v = r[c.name];
      if (typeof v !== "string" || v === "" || isoDay(v)) continue;
      seen.add(v);
      if (seen.size > 12) break;
    }
    if (seen.size > 0 && seen.size <= 12) out[c.name] = [...seen].sort();
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tools.
// ---------------------------------------------------------------------------

const world = z.enum(["reality", "scenario"]);
const WORLD_PROP = {
  type: "string",
  enum: ["reality", "scenario"],
  description:
    "Which twin to read: 'reality' is the network as it stands today; 'scenario' is the same network with the open scenario's edits applied. Use the one the person is looking at unless the question compares the two.",
};

export const obj = (properties: Record<string, unknown>, required: string[]): AnalystTool["input_schema"] => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const describeTwin: AnalystTool = {
  name: "describe_twin",
  description:
    "An overview of the digital twin: how many sites, which activities (kinds of capacity) exist and how many units of each, the catchments and their residents, the care and transmission model the twin declares, and what the twin is missing. Call this first when you do not yet know the names used in this twin.",
  input_schema: obj({ world: WORLD_PROP }, ["world"]),
  parse: z.object({ world }),
  async run(ctx, input: { world: WorldName }) {
    const ex = await ctx.world(input.world);
    const sites = sitesOf(ex);
    const activities = activitiesOf(sites).map((a) => {
      const having = sites.filter((s) => (s.activities[a]?.capacity ?? 0) > 0);
      const capacity = having.reduce((n, s) => n + s.activities[a]!.capacity, 0);
      const in_use = having.reduce((n, s) => n + s.activities[a]!.in_use, 0);
      return { activity: a, kind: having[0]?.activities[a]?.kind ?? null, sites: having.length, units: capacity, marked_in_use: in_use };
    });
    const perType = new Map<string, number>();
    for (const o of ex.objects) perType.set(o.type, (perType.get(o.type) ?? 0) + 1);
    const model = declaredModel(ex);
    return {
      world: input.world,
      environment: ex.environment,
      read_at: ex.generated_at,
      sites: {
        total: sites.length,
        with_a_location: sites.filter((s) => s.location).length,
        with_some_capacity: sites.filter((s) => Object.keys(s.activities).length > 0).length,
      },
      activities,
      catchments: {
        count: ex.populations.length,
        residents: ex.populations.reduce((n, p) => n + p.size, 0),
        names: ex.populations.map((p) => p.name),
      },
      declared_model: model.slice(0, 60),
      declared_model_total: model.length,
      object_types: ex.object_types
        .map((t) => ({ type: t.name, role: t.role, instances_in_the_simulation: perType.get(t.name) ?? 0 }))
        .filter((t) => t.role !== null || t.instances_in_the_simulation > 0),
      missing: ex.gaps.map((g) => ({
        code: g.code,
        message: g.message,
        subjects: g.subjects.slice(0, 8),
        subjects_total: g.subjects.length,
      })),
      note:
        "'marked_in_use' counts units whose own status says occupied. Zero can mean empty or that the twin does not record status; the scenario's starting conditions say what a run assumes instead.",
    };
  },
};

const findSites: AnalystTool = {
  name: "find_sites",
  description:
    "List sites (hospitals, clinics and other units), optionally filtered by part of a name, by the activity they provide, or by the catchment that lists them. Largest first. Use it to find a site's id or to see who provides an activity.",
  input_schema: obj(
    {
      world: WORLD_PROP,
      name: { type: "string", description: "Words that must appear in the site's name. Accents and case are ignored." },
      activity: { type: "string", description: "Only sites providing this activity, as named by describe_twin." },
      catchment: { type: "string", description: "Only sites this catchment's patients can go to: a catchment id or name." },
      limit: { type: "integer", description: "How many to return, 60 at most. Default 25." },
    },
    ["world"],
  ),
  parse: z.object({
    world,
    name: z.string().max(200).optional(),
    activity: z.string().max(120).optional(),
    catchment: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(60).optional(),
  }),
  async run(ctx, input: { world: WorldName; name?: string; activity?: string; catchment?: string; limit?: number }) {
    const ex = await ctx.world(input.world);
    let sites = sitesOf(ex);
    const activity = input.activity ? requireActivity(sites, input.activity) : null;
    const catchment = input.catchment ? pick(ex.populations, input.catchment, "catchment") : null;
    if (activity) sites = sites.filter((s) => (s.activities[activity]?.capacity ?? 0) > 0);
    if (catchment) sites = sites.filter((s) => catchment.served_by.includes(s.id));
    if (input.name) {
      const words = fold(input.name).split(" ").filter(Boolean);
      sites = sites.filter((s) => words.every((w) => fold(s.name).includes(w)));
    }
    const size = (s: SiteView) =>
      activity ? s.activities[activity]!.capacity : Object.values(s.activities).reduce((n, a) => n + a.capacity, 0);
    sites.sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name));
    const popName = new Map(ex.populations.map((p) => [p.id, p.name]));
    const shown = sites.slice(0, input.limit ?? 25);
    return {
      world: input.world,
      filter: { name: input.name ?? null, activity, catchment: catchment?.name ?? null },
      matching: sites.length,
      sites: shown.map((s) => ({
        id: s.id,
        name: s.name,
        ...(activity
          ? { units: s.activities[activity]!.capacity, marked_in_use: s.activities[activity]!.in_use }
          : { units_by_activity: Object.fromEntries(Object.entries(s.activities).map(([a, v]) => [a, v.capacity])) }),
        catchments: s.catchments.map((id) => popName.get(id) ?? id),
      })),
      ...(sites.length > shown.length ? { not_shown: sites.length - shown.length } : {}),
    };
  },
};

const getSite: AnalystTool = {
  name: "get_site",
  description:
    "Everything the twin holds about one site: where it is, the units it has for each activity and how many are marked in use, the patients it already holds, the catchments whose patients can go there, and (in the scenario world) what the scenario adds or removes there.",
  input_schema: obj(
    { world: WORLD_PROP, site: { type: "string", description: "The site's id, or its name." } },
    ["world", "site"],
  ),
  parse: z.object({ world, site: z.string().min(1).max(300) }),
  async run(ctx, input: { world: WorldName; site: string }) {
    const ex = await ctx.world(input.world);
    const sites = sitesOf(ex);
    const s = pick(sites, input.site, "site");
    const perType = new Map<string, number>();
    for (const o of ex.objects) if (o.at === s.id) perType.set(o.type, (perType.get(o.type) ?? 0) + 1);
    const planned =
      input.world === "scenario" && ctx.scenario
        ? (recipe(ctx.scenario, ex).choices as Record<string, unknown>[]).filter((c) => c.site_id === s.id)
        : [];
    return {
      world: input.world,
      id: s.id,
      name: s.name,
      location: s.location,
      capacity: Object.entries(s.activities).map(([activity, v]) => ({
        activity,
        kind: v.kind,
        units: v.capacity,
        marked_in_use: v.in_use,
        free: v.free,
      })),
      patients_held: s.census,
      catchments: s.catchments.map((id) => {
        const p = ex.populations.find((x) => x.id === id);
        return { id, name: p?.name ?? id, residents: p?.size ?? 0 };
      }),
      objects_attached: [...perType].map(([type, n]) => ({ type, count: n })).sort((a, b) => b.count - a.count),
      ...(input.world === "scenario" ? { scenario_changes_here: planned } : {}),
    };
  },
};

const compareCatchments: AnalystTool = {
  name: "compare_catchments",
  description:
    "For one activity, every catchment side by side: its residents, the sites its patients can go to, the units those sites hold, and units per 1,000 residents. Least provided first. This is where to look for why one area queues while another has room.",
  input_schema: obj(
    { world: WORLD_PROP, activity: { type: "string", description: "The activity to compare, as named by describe_twin." } },
    ["world", "activity"],
  ),
  parse: z.object({ world, activity: z.string().min(1).max(120) }),
  async run(ctx, input: { world: WorldName; activity: string }) {
    const ex = await ctx.world(input.world);
    const sites = sitesOf(ex);
    const activity = requireActivity(sites, input.activity);
    const byId = new Map(sites.map((s) => [s.id, s]));
    const rows = ex.populations.map((p) => {
      const able = p.served_by
        .map((id) => byId.get(id))
        .filter((s): s is SiteView => Boolean(s && (s.activities[activity]?.capacity ?? 0) > 0));
      const units = able.reduce((n, s) => n + s.activities[activity]!.capacity, 0);
      return {
        id: p.id,
        name: p.name,
        residents: p.size,
        sites_providing_it: able.length,
        largest_sites: [...able]
          .sort((a, b) => b.activities[activity]!.capacity - a.activities[activity]!.capacity)
          .slice(0, 4)
          .map((s) => ({ id: s.id, name: s.name, units: s.activities[activity]!.capacity })),
        units,
        units_per_1000_residents: p.size > 0 ? round((units / p.size) * 1000, 2) : null,
      };
    });
    rows.sort(
      (a, b) =>
        (a.units_per_1000_residents ?? Number.POSITIVE_INFINITY) - (b.units_per_1000_residents ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
    const providing = sites.filter((s) => (s.activities[activity]?.capacity ?? 0) > 0);
    const units = providing.reduce((n, s) => n + s.activities[activity]!.capacity, 0);
    const residents = ex.populations.reduce((n, p) => n + p.size, 0);
    return {
      world: input.world,
      activity,
      catchments: rows,
      whole_network: {
        residents,
        sites_providing_it: providing.length,
        units,
        units_per_1000_residents: residents > 0 ? round((units / residents) * 1000, 2) : null,
      },
      how_patients_are_routed:
        "A catchment's patients go only to the sites that list it, shared out in proportion to each site's units. Nobody is transferred between sites. A site listed by several catchments is counted in each of them above, so the catchment rows can add up to more than the whole network.",
    };
  },
};

const scenarioRecipe: AnalystTool = {
  name: "scenario_recipe",
  description:
    "What the open scenario contains, in order: its starting conditions (usual occupancy, prior immunity, transmissibility), its events (outbreaks, heat), the planner's choices (measures, added capacity), any edit to which sites serve which catchment, and the observed series it is compared with.",
  input_schema: obj({}, []),
  parse: z.object({}),
  async run(ctx) {
    if (!ctx.scenario) throw new ToolError("No scenario is open. Only the 'reality' world can be read.");
    return recipe(ctx.scenario, await ctx.world("scenario"));
  },
};

/**
 * A count of people, as the screen writes it: rounded once, to a whole.
 *
 * It used to be handed over with one decimal. The model then rounded it again
 * for the sentence, and 103.46 became 103.5 and then "about 104" beside a
 * panel reading 103. Rounded here, from the figure itself, there is nothing
 * left to round and the answer says what the screen says.
 */
export const whole = (n: number): number => (n > 0 && n < 1 ? round(n, 2) : Math.round(n));
/** A share as a whole percentage, the way the Result panel writes it. */
export const wholePct = (share: number): number => Math.round(share * 100);

const pctSeries = (xs: (number | null)[], from: number, to: number) =>
  xs.slice(from, to + 1).map((v) => (v === null ? null : wholePct(v)));

/** The highest value of a daily share, as a percentage and its day. */
export function peakOf(xs: (number | null)[]): { occupancy_pct: number; on_day: number } | null {
  let best = { v: -1, t: 0 };
  xs.forEach((v, t) => {
    if (v !== null && v > best.v) best = { v, t };
  });
  return best.v < 0 ? null : { occupancy_pct: wholePct(best.v), on_day: best.t };
}

/**
 * One pass of a run, as a tool hands it to the model.
 *
 * Shared by `read_run` and `test_option`, so the run on screen and a tested
 * option are described in the same words and rounded the same way.
 */
export function summariseVariant(v: RunDigest["events"]) {
  const total = (xs: number[]) => whole(xs.reduce((a, b) => a + b, 0));
  return {
    peak_occupancy_across_all_sites: peakOf(v.island),
    sites_where_somebody_waits: v.sitesWithQueue,
    sites_providing_the_activity: v.sitesWithActivity,
    first_day_somebody_waits: v.firstQueueDay,
    patient_days_waiting: whole(v.waitingDays),
    most_people_waiting_at_once: { people: whole(v.peakWaiting), on_day: v.peakWaitingDay },
    ...(v.strandedWaitingDays !== null
      ? { patient_days_waiting_in_catchments_no_site_serves: whole(v.strandedWaitingDays) }
      : {}),
    arrivals_over_the_run: Object.fromEntries(Object.entries(v.arrivals).map(([k, xs]) => [k, total(xs)])),
    engine_notes: v.notes,
  };
}

/** One site's queue in one pass, as a tool hands it to the model. */
export function summariseBreak(b: RunDigest["sites"][number]["events"]) {
  return b.firstDay === null
    ? { somebody_waits: false, peak_occupancy_pct: wholePct(b.peakOccupancy) }
    : {
        somebody_waits: true,
        from_day: b.firstDay,
        days_with_a_queue: b.days,
        most_waiting_at_once: whole(b.peakWaiting),
        on_day: b.peakDay,
        patient_days_waiting: whole(b.waitingDays),
        peak_occupancy_pct: wholePct(b.peakOccupancy),
      };
}

const readRun: AnalystTool = {
  name: "read_run",
  description:
    "The simulation run currently on the person's screen. The engine ran the scenario twice: 'events_only' (conditions and events, none of the planner's choices) and 'with_choices' (the same plus measures and added capacity). Parts: 'summary' (peak occupancy, how many sites have a queue, patient-days waiting, arrivals), 'sites' (each site where somebody waits, in both runs), 'site' (one site day by day), 'daily' (the whole network day by day). Nothing here is recomputed: these are the engine's own counts.",
  input_schema: obj(
    {
      part: { type: "string", enum: ["summary", "sites", "site", "daily"], description: "Which part of the run to read." },
      site: { type: "string", description: "For part 'site': the site's id or name." },
      from_day: { type: "integer", description: "For 'site' and 'daily': first day to return. Default 0." },
      to_day: { type: "integer", description: "For 'site' and 'daily': last day to return. Default the last day of the run." },
    },
    ["part"],
  ),
  parse: z.object({
    part: z.enum(["summary", "sites", "site", "daily"]),
    site: z.string().max(300).optional(),
    from_day: z.number().int().min(0).optional(),
    to_day: z.number().int().min(0).optional(),
  }),
  async run(ctx, input: { part: "summary" | "sites" | "site" | "daily"; site?: string; from_day?: number; to_day?: number }) {
    const run = ctx.run;
    if (!run) {
      throw new ToolError(
        "There is no run on screen. The person has to press Run on the Scenarios page first; say so rather than estimating what a run would show.",
      );
    }
    const head = {
      ran_at: run.ranAt,
      days: run.horizon,
      activity: run.activity,
      ...(run.stale ? { warning: "The scenario was edited after this run. These figures describe the scenario as it was, not as it is now." } : {}),
    };
    const from = Math.min(input.from_day ?? 0, run.horizon - 1);
    const to = Math.min(input.to_day ?? run.horizon - 1, run.horizon - 1);
    if (to < from) throw new ToolError("to_day is before from_day.");

    if (input.part === "summary") {
      return {
        ...head,
        events_only: summariseVariant(run.events),
        with_choices: summariseVariant(run.full),
        catchments_no_site_serves: run.stranded,
        how_to_read:
          "Occupancy stops at 100 % and says nothing about who was turned away; the queue does. 'Patient-days waiting' adds up the people still waiting at the end of each day, so one person waiting three days counts three. The difference between the two runs is what the planner's choices did.",
      };
    }
    if (input.part === "sites") {
      const rows = run.sites
        .filter((s) => s.events.firstDay !== null || s.full.firstDay !== null)
        .map((s) => ({
          id: s.id,
          name: s.name,
          usual_units: s.capacity,
          events_only: summariseBreak(s.events),
          with_choices: summariseBreak(s.full),
          first: s.events.firstDay ?? s.full.firstDay ?? Number.POSITIVE_INFINITY,
        }))
        // In the order they break, so "which first, which next" is read off
        // the list rather than worked out: sorting eight rows in its head is
        // where the model swapped two neighbours.
        .sort((a, b) => a.first - b.first || a.name.localeCompare(b.name))
        .map(({ first: _first, ...row }, i) => ({ order: i + 1, ...row }));
      return {
        ...head,
        ordered_by: "the first day somebody waits when the planner's choices are left out (events_only.from_day), earliest first",
        sites_where_somebody_waits_in_either_run: rows,
        sites_that_never_queue: run.sites.length - rows.length,
      };
    }
    if (input.part === "site") {
      if (!input.site) throw new ToolError("Part 'site' needs the site's id or name.");
      const s = pick(run.sites, input.site, "site in this run");
      if (!s.daily) {
        return {
          ...head,
          id: s.id,
          name: s.name,
          usual_units: s.capacity,
          somebody_waits: false,
          peak_occupancy_pct: { events_only: wholePct(s.events.peakOccupancy), with_choices: wholePct(s.full.peakOccupancy) },
          note: "Nobody waits at this site in either run, so the page kept no day-by-day series for it.",
        };
      }
      return {
        ...head,
        id: s.id,
        name: s.name,
        usual_units: s.capacity,
        days: { from, to },
        events_only: {
          occupancy_pct_by_day: pctSeries(s.daily.occupancyEvents, from, to),
          people_waiting_by_day: s.daily.waitingEvents.slice(from, to + 1).map((v) => (v === null ? null : whole(v))),
        },
        with_choices: {
          occupancy_pct_by_day: pctSeries(s.daily.occupancyFull, from, to),
          people_waiting_by_day: s.daily.waitingFull.slice(from, to + 1).map((v) => (v === null ? null : whole(v))),
        },
        note: `The first value of each list is day ${from}.`,
      };
    }
    return {
      ...head,
      days: { from, to },
      events_only: {
        occupancy_pct_by_day: pctSeries(run.events.island, from, to),
        arrivals_by_day: Object.fromEntries(Object.entries(run.events.arrivals).map(([k, xs]) => [k, xs.slice(from, to + 1).map((v) => round(v))])),
      },
      with_choices: {
        occupancy_pct_by_day: pctSeries(run.full.island, from, to),
        arrivals_by_day: Object.fromEntries(Object.entries(run.full.arrivals).map(([k, xs]) => [k, xs.slice(from, to + 1).map((v) => round(v))])),
      },
      note: `The first value of each list is day ${from}. Occupancy is across every site providing ${run.activity}, weighted by their units.`,
    };
  },
};

const listDatasets: AnalystTool = {
  name: "list_datasets",
  description:
    "The datasets imported into this project: observed series, reference tables, live feeds. Returns each one's id, name, columns and number of rows. Use it before reading a series.",
  input_schema: obj({}, []),
  parse: z.object({}),
  async run(ctx) {
    const all = await ctx.datasets();
    return {
      datasets: all.slice(0, 80).map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        rows: d.rowCount,
        columns: d.columnSchema.map((c) => `${c.name} (${c.type})`),
        description: d.description,
        last_written: d.lastWrittenAt,
      })),
      ...(all.length > 80 ? { not_shown: all.length - 80 } : {}),
    };
  },
};

const previewDataset: AnalystTool = {
  name: "preview_dataset",
  description:
    "The first rows of one dataset, and the values its category columns take (a region, a kind). Use it to learn what a column holds before reading a series from it.",
  input_schema: obj({ dataset: { type: "string", description: "The dataset's id or name." } }, ["dataset"]),
  parse: z.object({ dataset: z.string().min(1).max(300) }),
  async run(ctx, input: { dataset: string }) {
    const ds = await pickDataset(ctx, input.dataset);
    const rows = await ctx.rows(ds.id);
    return {
      dataset: { id: ds.id, name: ds.name },
      rows: rows.length,
      columns: ds.columnSchema.map((c) => `${c.name} (${c.type})`),
      first_rows: rows.slice(0, 5),
      category_values: categories(rows, ds),
    };
  },
};

const readSeries: AnalystTool = {
  name: "read_series",
  description:
    "One column of a dataset read as a daily series: how many days it reports, its first and last date, its total, mean, lowest and highest day, and the values themselves when the range asked for is 200 days or fewer. If the dataset holds several series in one table (one per region, say), pass `where` to pick one.",
  input_schema: obj(
    {
      dataset: { type: "string", description: "The dataset's id or name." },
      date_column: { type: "string", description: "The column holding the date." },
      value_column: { type: "string", description: "The column holding the number." },
      from: { type: "string", description: "First date to read, YYYY-MM-DD. Optional." },
      to: { type: "string", description: "Last date to read, YYYY-MM-DD. Optional." },
      where_column: { type: "string", description: "A column to filter on. Optional; needs where_equals." },
      where_equals: { type: "string", description: "Keep only the rows where where_column has this value." },
    },
    ["dataset", "date_column", "value_column"],
  ),
  parse: z.object({
    dataset: z.string().min(1).max(300),
    date_column: z.string().min(1).max(120),
    value_column: z.string().min(1).max(120),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    where_column: z.string().max(120).optional(),
    where_equals: z.string().max(300).optional(),
  }),
  async run(
    ctx,
    input: { dataset: string; date_column: string; value_column: string; from?: string; to?: string; where_column?: string; where_equals?: string },
  ) {
    const ds = await pickDataset(ctx, input.dataset);
    const when = requireColumn(ds, input.date_column);
    const value = requireColumn(ds, input.value_column);
    const whereCol = input.where_column ? requireColumn(ds, input.where_column) : null;
    if (whereCol && input.where_equals === undefined) throw new ToolError("where_column needs where_equals.");
    const all = await ctx.rows(ds.id);
    const rows = whereCol ? all.filter((r) => String(r[whereCol] ?? "") === input.where_equals) : all;
    if (whereCol && rows.length === 0) {
      const cats = categories(all, ds)[whereCol];
      throw new ToolError(
        `No row has ${whereCol} = "${input.where_equals}".${cats ? ` It takes these values: ${cats.join("; ")}.` : ""}`,
      );
    }

    const byDay = new Map<string, number>();
    let repeated = 0;
    let undated = 0;
    for (const r of rows) {
      const d = isoDay(r[when]);
      if (!d) {
        undated += 1;
        continue;
      }
      if ((input.from && d < input.from) || (input.to && d > input.to)) continue;
      const n = numberOf(r[value]);
      // A blank is a day the source did not report, not a day with none.
      if (n === null) continue;
      if (byDay.has(d)) repeated += 1;
      byDay.set(d, n);
    }
    if (repeated > 0) {
      const cats = categories(all, ds);
      throw new ToolError(
        `${repeated} date(s) appear more than once in "${ds.name}"${whereCol ? " even after the filter" : ""}, so this table holds several series. ` +
          `Pick one with where_column and where_equals. Category columns: ${
            Object.entries(cats)
              .map(([c, vs]) => `${c} = ${vs.join(" | ")}`)
              .join("; ") || "none found; call preview_dataset"
          }.`,
      );
    }
    const points = [...byDay].sort((a, b) => a[0].localeCompare(b[0]));
    if (points.length === 0) {
      throw new ToolError(
        `No dated value found in ${value} of "${ds.name}" for that range${undated ? ` (${undated} rows had no readable date in ${when})` : ""}.`,
      );
    }
    const values = points.map(([, v]) => v);
    const sum = values.reduce((a, b) => a + b, 0);
    const lo = points.reduce((b, p) => (p[1] < b[1] ? p : b));
    const hi = points.reduce((b, p) => (p[1] > b[1] ? p : b));
    return {
      dataset: { id: ds.id, name: ds.name },
      date_column: when,
      value_column: value,
      filter: whereCol ? { [whereCol]: input.where_equals } : null,
      days_reported: points.length,
      first_date: points[0]![0],
      last_date: points[points.length - 1]![0],
      total: round(sum, 2),
      mean_per_day: round(sum / points.length, 2),
      lowest: { value: lo[1], on: lo[0] },
      highest: { value: hi[1], on: hi[0] },
      ...(points.length <= 200
        ? { values: points.map(([d, v]) => ({ date: d, value: v })) }
        : { values_not_shown: "More than 200 days. Narrow the range with `from` and `to` to read the values themselves." }),
    };
  },
};

// ---------------------------------------------------------------------------
// Reading the calendar of validated events.
// ---------------------------------------------------------------------------

/** The calendar date of the scenario's day 0, when its reality check sets one. */
function dayZeroOf(scenario: AnalystScenario | null): string | null {
  if (!scenario) return null;
  // The last one written wins: a check is replaced, never stacked.
  for (let i = scenario.overrides.length - 1; i >= 0; i--) {
    const o = scenario.overrides[i]!;
    if (o.targetType !== "param" || o.op !== "set_param" || o.payload.key !== REALITY_KEY) continue;
    const origin = (o.payload.value as { origin?: unknown } | undefined)?.origin;
    if (typeof origin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(origin)) return origin;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Now: what is open, and a unit's live figures.
//
// Read from the roll-up and the alert feed the screens show (`live-reading.ts`),
// not from the export: a person looking at a unit page and asking about it has
// to be told the number that page gives.
// ---------------------------------------------------------------------------

async function pickUnit(ctx: AnalystContext, query: string): Promise<{ live: LiveReading; unit: LiveUnit }> {
  const live = await ctx.live();
  if (live.units.length === 0) throw new ToolError("This twin has no unit.");
  return { live, unit: pick(live.units, query, "unit") };
}

const listAlerts: AnalystTool = {
  name: "list_alerts",
  description:
    "What is open right now: the project's open alerts, worst first, each with its unit, the measure and its value, since when it has been open, how old the value is, and the signal it raised with the stage that signal stands at. Also says how many alert rules exist and when the thresholds were last checked. Reality only. Use it for any question about what is open, alerting or needing attention now, in the whole project or at one unit. It has no history.",
  input_schema: obj({ unit: { type: "string", description: "Only this unit's alerts: its name or its id. Leave out for the whole project." } }, []),
  parse: z.object({ unit: z.string().trim().min(1).max(300).optional() }),
  async run(ctx, input: { unit?: string }) {
    if (!input.unit) return alertsNow(await ctx.live());
    const { live, unit } = await pickUnit(ctx, input.unit);
    return alertsNow(live, unit);
  },
};

const unitNowTool: AnalystTool = {
  name: "unit_now",
  description:
    "The live figures of one unit, exactly as the unit page shows them: each measure the organisation defined with its value, what stands under the unit by type, how old the reading is (or that its age is unknown, and why), and the unit's open alerts. Counts everything under the unit, its sub-units included. Reality only. Use it for a question about a unit now; use get_site for what a run counts at a site.",
  input_schema: obj({ unit: { type: "string", description: "The unit's name or its id." } }, ["unit"]),
  parse: z.object({ unit: z.string().trim().min(1).max(300) }),
  async run(ctx, input: { unit: string }) {
    const { live, unit } = await pickUnit(ctx, input.unit);
    return unitNow(live, unit);
  },
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const dateAt = (origin: string, offset: number): string => new Date(Date.parse(`${origin}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "write the date as YYYY-MM-DD");

const listEvents: AnalystTool = {
  name: "list_events",
  description:
    "The calendar of events around the network that a person validated from official web sources: public health measures, closures, weather, outbreaks. Each has its dates, its place, how it reaches the network (demand, capacity, access, care), the source it was published by and a short quoted passage. These are published statements, not facts the twin recorded and not results of a run. Narrow to a period with from_date and to_date, or — when the scenario gives day 0 a calendar date — with from_day and to_day on the run's own axis, which also places every event on the run's days. Use it to say what was happening at a given moment of a run. You cannot search the web yourself: if nothing validated covers the period, say so.",
  input_schema: obj(
    {
      from_date: { type: "string", description: "YYYY-MM-DD. Keep only events still going on or after this date." },
      to_date: { type: "string", description: "YYYY-MM-DD. Keep only events that started on or before this date." },
      from_day: { type: "integer", description: "A day of the run (0 is the first). Needs a calendar date for day 0. Not together with the dates." },
      to_day: { type: "integer", description: "A day of the run. Needs a calendar date for day 0. Not together with the dates." },
    },
    [],
  ),
  parse: z.object({
    from_date: calendarDay.optional(),
    to_date: calendarDay.optional(),
    from_day: z.number().int().min(0).max(4000).optional(),
    to_day: z.number().int().min(0).max(4000).optional(),
  }),
  async run(ctx, input: { from_date?: string; to_date?: string; from_day?: number; to_day?: number }) {
    const origin = dayZeroOf(ctx.scenario);
    const byDay = input.from_day !== undefined || input.to_day !== undefined;
    if (byDay && (input.from_date !== undefined || input.to_date !== undefined)) {
      throw new ToolError("Give a period as dates or as days of the run, not both.");
    }
    if (byDay && !origin) {
      throw new ToolError(
        "Day 0 of this scenario has no calendar date (it is set under Result, Reality check), so a day of the run cannot be turned into a date. Ask by from_date and to_date instead, or say that the run's days cannot be placed on the calendar.",
      );
    }
    const from = byDay ? (input.from_day !== undefined ? dateAt(origin!, input.from_day) : null) : (input.from_date ?? null);
    const to = byDay ? (input.to_day !== undefined ? dateAt(origin!, input.to_day) : null) : (input.to_date ?? null);
    if (from && to && to < from) throw new ToolError("The period ends before it starts.");

    const all = await ctx.events();
    const kept = all.filter((e) => (!from || (e.endsOn ?? e.startsOn) >= from) && (!to || e.startsOn <= to));
    const result = {
      what_these_are:
        "Events a person validated from official web sources. Published statements about what was happening around the network: not facts the twin recorded, not results of a run.",
      day_0_is: origin,
      ...(origin ? {} : { days_of_the_run: "Day 0 of this scenario has no calendar date, so these events cannot be placed on the run's days." }),
      period: { from_date: from, to_date: to },
      events: kept.map((e) => ({
        title: e.title,
        from_date: e.startsOn,
        to_date: e.endsOn,
        // Computed here so that nobody counts days in their head.
        ...(origin ? { from_day: daysBetween(origin, e.startsOn), to_day: daysBetween(origin, e.endsOn ?? e.startsOn) } : {}),
        place: e.place,
        reaches_the_network_by: e.door,
        published_by: hostOf(e.sourceUrl),
        source_title: e.sourceTitle,
        quoted_passage: e.passage,
        validated_on: e.validatedAt.slice(0, 10),
      })),
      events_in_the_calendar: all.length,
      ...(all.length === 0
        ? { note: "No event has been validated in this project yet. A person can search official sources and validate events in the Event finder tab." }
        : {}),
    };
    // The links are for the screen: each event shown under a paragraph carries its own.
    return new Recorded(result, {
      events: kept.map((e) => ({ id: e.id, title: e.title, startsOn: e.startsOn, endsOn: e.endsOn, place: e.place, door: e.door, url: e.sourceUrl, sourceTitle: e.sourceTitle, passage: e.passage })),
    });
  },
};

const calculate: AnalystTool = {
  name: "calculate",
  description:
    "Do arithmetic. Every figure you derive (a difference, a ratio, a percentage, a total, a rate per 1,000) must come from here, never from your head. Write numbers without thousands separators. Operators: + - * / ^ and brackets. Functions: round(x, decimals), abs, sqrt, floor, ceil, min, max, sum, mean. Every number in the expression must be one a tool already returned or one the person wrote in their question; 100, 1000, 7 and 24 are allowed as units.",
  input_schema: obj(
    {
      label: { type: "string", description: "What the result is, in words: 'share of the waiting that the added beds spare, in percent'." },
      expression: { type: "string", description: "The arithmetic, for example: round((7316 - 267) / 7316 * 100, 1)" },
    },
    ["label", "expression"],
  ),
  parse: z.object({ label: z.string().min(1).max(300), expression: z.string().min(1).max(600) }),
  async run(ctx, input: { label: string; expression: string }) {
    let out;
    try {
      out = evaluate(input.expression);
    } catch (err) {
      if (err instanceof CalcError) throw new ToolError(err.message);
      throw err;
    }
    const strangers = out.operands.filter((raw) => {
      if (UNIT_CONSTANTS.has(Number(raw))) return false;
      const token = numbersIn(raw)[0];
      return !token || !ctx.known.has(token);
    });
    if (strangers.length) {
      throw new ToolError(
        `${strangers.map((s) => `"${s}"`).join(", ")} ${strangers.length === 1 ? "is" : "are"} not in anything read so far, and not in the question. ` +
          "Read the figure with a tool first and use it as the tool returned it. If it is an assumption of yours, do not compute with it: state it as an open question instead.",
      );
    }
    return { label: input.label, expression: input.expression, result: out.value };
  },
};

/** Every tool the analyst can call to read. The order is the order it is shown them in. */
export const READ_TOOLS: AnalystTool[] = [
  describeTwin,
  findSites,
  getSite,
  compareCatchments,
  scenarioRecipe,
  readRun,
  listDatasets,
  previewDataset,
  readSeries,
  listEvents,
  listAlerts,
  unitNowTool,
  calculate,
];
