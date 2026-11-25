import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { ToolError } from "./analyst-tools.js";
import { ROUTE_CAPACITY } from "./scenario-run.js";

// ---------------------------------------------------------------------------
// Action types: what the analyst may propose, as the project declares it.
//
// What an option can contain used to be a fixed list in the code: capacity, a
// measure, a transfer, a recorded response. An institution that wanted the
// analyst to propose "open overflow beds, ten to sixty, at these three sites,
// and the director of nursing approves it" had nowhere to say so.
//
// An action type says it. It is data of the project:
//
//   what it changes   one of the four things a run can be made to change
//                     (`effect`), and on what: an activity, contact layers,
//                     routes, recorded responses;
//   within what       its bounds: a range of units, the sites, the days;
//   in how long       the days it takes before it can apply, counted from the
//                     decision (day 0 of a run);
//   who approves      in words;
//   whether it is on.
//
// It names nothing the engine cannot run: an effect is one the scenario's run
// already knows how to apply, and everything an action type points at (an
// activity, a layer, a site) is something the twin declares. Nothing is
// recognised by its name.
//
// Every project starts with four built-in types, one per effect, unbounded and
// on. They are what the analyst could propose before action types existed, so
// a project that declares nothing behaves exactly as it did. A project changes
// one by writing a row under its key, and adds its own under new keys.
//
// An action type gives no right to write. An option that falls under one is
// still tested by the engine and still applied by a person's click.
// ---------------------------------------------------------------------------

export const EFFECTS = ["capacity", "measure", "transfer", "response"] as const;
export type Effect = (typeof EFFECTS)[number];

/** Units of an activity added or closed at a site. */
export interface CapacityBounds {
  /** The one activity it changes; null: any activity a site provides. */
  activity: string | null;
  /** Units, signed: negative closes. Null: no bound on that side. */
  minUnits: number | null;
  maxUnits: number | null;
  /** The sites it may be applied at, by id; null: any site that provides the activity. */
  sites: string[] | null;
  /** The mode of the price list it opens units in, with that mode's price and delay; null: any. */
  mode: string | null;
}

/** Contact layers scaled in some catchments for some days. */
export interface MeasureBounds {
  /** The layers it may scale, each with the range its factor must stay in; null: any declared layer, any factor. */
  layers: { layer: string; minFactor: number; maxFactor: number }[] | null;
  maxDays: number | null;
  /** The catchments it may cover, by id; null: any, or all of them. */
  catchments: string[] | null;
}

/** Waiting patients sent from one site to another along a route. */
export interface TransferBounds {
  maxPerDay: number | null;
  /** Sites patients may be sent from, and to, by id; null: any end of a route. */
  from: string[] | null;
  to: string[] | null;
}

/** A recorded response the run follows. */
export interface ResponseBounds {
  /** The responses it may be, by the id a stamp keeps (a library id, or the engine's name for one it writes); null: any. */
  responses: string[] | null;
}

interface Common {
  /** What the analyst names in a test: "capacity", "open-overflow-beds". */
  key: string;
  /** In the institution's words. */
  name: string;
  description: string;
  /** Days before it can apply, counted from the decision (day 0 of a run); null: none declared. */
  leadDays: number | null;
  /** Who can approve it, in words. */
  approver: string;
  active: boolean;
  /** One of the four every project starts with. */
  builtIn: boolean;
  /** Written by the project: its own type, or a built-in it changed. */
  declared: boolean;
}

export type ActionType =
  | (Common & { effect: "capacity"; bounds: CapacityBounds })
  | (Common & { effect: "measure"; bounds: MeasureBounds })
  | (Common & { effect: "transfer"; bounds: TransferBounds })
  | (Common & { effect: "response"; bounds: ResponseBounds });

const builtIn = { leadDays: null, approver: "", active: true, builtIn: true, declared: false } as const;

/** What every project can propose until it says otherwise: what the analyst could propose before action types. */
export const DEFAULT_ACTION_TYPES: readonly ActionType[] = [
  {
    ...builtIn,
    key: "capacity",
    name: "Add or close capacity",
    description: "Units of an activity added at a site from a day until the end of the run. A negative number closes units.",
    effect: "capacity",
    bounds: { activity: null, minUnits: null, maxUnits: null, sites: null, mode: null },
  },
  {
    ...builtIn,
    key: "measure",
    name: "Apply a measure",
    description: "Contact layers the twin declares, scaled in some catchments for some days.",
    effect: "measure",
    bounds: { layers: null, maxDays: null, catchments: null },
  },
  {
    ...builtIn,
    key: "transfer",
    name: "Transfer waiting patients",
    description: "Waiting patients sent each day from one site to another, along a transfer route the twin holds.",
    effect: "transfer",
    bounds: { maxPerDay: null, from: null, to: null },
  },
  {
    ...builtIn,
    key: "response",
    name: "Follow a recorded response",
    description: "Rules the engine evaluates at every step: a response of the organisation's library, or one the engine writes itself.",
    effect: "response",
    bounds: { responses: null },
  },
];

// --- what a person may write --------------------------------------------------

const ids = z.array(z.string().trim().min(1).max(200)).max(200).nullable().default(null);
const whole = z.number().int().min(-100_000).max(100_000).nullable().default(null);

const boundsOf = {
  capacity: z.object({
    activity: z.string().trim().min(1).max(120).nullable().default(null),
    minUnits: whole,
    maxUnits: whole,
    sites: ids,
    mode: z.string().trim().min(1).max(120).nullable().default(null),
  }),
  measure: z.object({
    layers: z
      .array(z.object({ layer: z.string().trim().min(1).max(120), minFactor: z.number().min(0).max(5), maxFactor: z.number().min(0).max(5) }))
      .min(1)
      .max(8)
      .nullable()
      .default(null),
    maxDays: z.number().int().min(1).max(365).nullable().default(null),
    catchments: ids,
  }),
  transfer: z.object({ maxPerDay: z.number().int().min(1).max(ROUTE_CAPACITY).nullable().default(null), from: ids, to: ids }),
  response: z.object({ responses: ids }),
} as const;

/** What the Studio sends to write an action type. The key is in the address, never in the body. */
export const actionTypeDraft = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(""),
  effect: z.enum(EFFECTS),
  bounds: z.record(z.unknown()).default({}),
  leadDays: z.number().int().min(0).max(365).nullable().default(null),
  approver: z.string().trim().max(200).default(""),
  active: z.boolean().default(true),
});
export type ActionTypeDraft = z.infer<typeof actionTypeDraft>;

type Body = Omit<ActionType, "key" | "builtIn" | "declared">;

/** A draft read as an action type, or a refusal that says what to correct. */
export function readDraft(draft: ActionTypeDraft): Body {
  const parsed = boundsOf[draft.effect].safeParse(draft.bounds);
  if (!parsed.success) {
    throw BadRequest("ACTION_TYPE_INVALID", `The bounds cannot be read: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.`);
  }
  const b = parsed.data as Record<string, unknown>;
  if (draft.effect === "capacity") {
    const { minUnits, maxUnits } = b as unknown as CapacityBounds;
    if (minUnits !== null && maxUnits !== null && minUnits > maxUnits) {
      throw BadRequest("ACTION_TYPE_INVALID", `The fewest units (${minUnits}) is above the most (${maxUnits}). Put them in order.`);
    }
  }
  if (draft.effect === "measure") {
    const bad = ((b as unknown as MeasureBounds).layers ?? []).find((l) => l.minFactor > l.maxFactor);
    if (bad) throw BadRequest("ACTION_TYPE_INVALID", `On the layer "${bad.layer}", the lowest factor (${bad.minFactor}) is above the highest (${bad.maxFactor}). Put them in order.`);
  }
  return { name: draft.name, description: draft.description, effect: draft.effect, bounds: b, leadDays: draft.leadDays, approver: draft.approver, active: draft.active } as unknown as Body;
}

/** A key from a name: lower-case letters, digits and hyphens. */
export function keyFrom(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "action";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// --- the project's list -------------------------------------------------------

interface Row {
  key: string;
  name: string;
  description: string;
  effect: Effect;
  bounds: unknown;
  lead_days: number | null;
  approver: string;
  active: boolean;
}

/**
 * The project's action types: the four built-in ones, each as the project
 * changed it when it did, then its own, by name.
 *
 * A row that cannot be read any more (a bound of another shape) falls back to
 * no bound of that kind rather than hiding the type: a type that vanished from
 * the list would stop being proposed with nobody having switched it off.
 */
export function actionTypesOf(rows: readonly Row[]): ActionType[] {
  const read = (r: Row): ActionType => {
    const parsed = boundsOf[r.effect].safeParse(r.bounds ?? {});
    const bounds = parsed.success ? parsed.data : boundsOf[r.effect].parse({});
    return {
      key: r.key,
      name: r.name,
      description: r.description,
      effect: r.effect,
      bounds,
      leadDays: r.lead_days,
      approver: r.approver,
      active: r.active,
      builtIn: DEFAULT_ACTION_TYPES.some((d) => d.key === r.key),
      declared: true,
    } as ActionType;
  };
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const first = DEFAULT_ACTION_TYPES.map((d) => {
    const row = byKey.get(d.key);
    // A built-in keeps its effect whatever a row says: its key is what tests and prompts name.
    return row && row.effect === d.effect ? read(row) : d;
  });
  const own = rows.filter((r) => !DEFAULT_ACTION_TYPES.some((d) => d.key === r.key)).map(read);
  return [...first, ...own.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))];
}

/** True once the project declared anything: only then is the analyst told there is a list to keep to. */
export const isConfigured = (types: readonly ActionType[]): boolean => types.some((t) => t.declared);

export async function listActionTypes(db: DbClient, projectId: string): Promise<ActionType[]> {
  const { rows } = await db.query<Row>(
    `SELECT key, name, description, effect, bounds, lead_days, approver, active
       FROM app.action_type
      WHERE project_id = $1
      ORDER BY created_at`,
    [projectId],
  );
  return actionTypesOf(rows);
}

/** Write an action type under its key: the project's own, or a built-in it changes. */
export async function saveActionType(db: DbClient, projectId: string, userId: string, key: string, draft: ActionTypeDraft): Promise<ActionType> {
  const body = readDraft(draft);
  const builtInType = DEFAULT_ACTION_TYPES.find((d) => d.key === key);
  if (builtInType && builtInType.effect !== body.effect) {
    throw BadRequest("ACTION_TYPE_INVALID", `"${key}" is the built-in type for ${builtInType.effect}: what it changes cannot become ${body.effect}. Add a type of your own for that.`);
  }
  await db.query(
    `INSERT INTO app.action_type (project_id, key, name, description, effect, bounds, lead_days, approver, active, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
     ON CONFLICT (project_id, key) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, effect = EXCLUDED.effect, bounds = EXCLUDED.bounds,
            lead_days = EXCLUDED.lead_days, approver = EXCLUDED.approver, active = EXCLUDED.active,
            updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [projectId, key, body.name, body.description, body.effect, JSON.stringify(body.bounds), body.leadDays, body.approver, body.active, userId],
  );
  return (await listActionTypes(db, projectId)).find((t) => t.key === key)!;
}

/**
 * Take a row out. For the project's own type, the type is gone. For a built-in,
 * what the project changed is gone and the type is as every project starts
 * with it.
 */
export async function removeActionType(db: DbClient, projectId: string, key: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM app.action_type WHERE project_id = $1 AND key = $2`, [projectId, key]);
  if (!rowCount) {
    throw NotFound(
      "ACTION_TYPE_NOT_FOUND",
      DEFAULT_ACTION_TYPES.some((d) => d.key === key) ? "That built-in action type has not been changed in this project: there is nothing to reset." : "That action type is not in this project.",
    );
  }
}

// --- what the twin offers an action type ---------------------------------------

/** What the twin declares that an action type can point at. Read from the twin, never typed. */
export interface TwinOffer {
  activities: string[];
  layers: string[];
  sites: { id: string; name: string; activities: string[] }[];
  catchments: { id: string; name: string }[];
  routes: { source: string; target: string }[];
  responses: { id: string; name: string }[];
  /** The modes the price list holds for each activity, with the days each takes. */
  modes: Record<string, { mode: string; leadDays: number }[]>;
}

const quoted = (names: readonly string[]): string => names.map((n) => `"${n}"`).join(", ");

/**
 * Why an action type cannot be tested on this twin, or null when it can.
 *
 * A type that points at something the twin does not declare would be refused
 * at every test. The screen says so where the type is written, and the analyst
 * is told not to propose it.
 */
export function missingFor(type: ActionType, offer: TwinOffer): string | null {
  const siteNamed = (id: string) => offer.sites.find((s) => s.id === id);
  if (type.effect === "capacity") {
    const b = type.bounds;
    if (offer.activities.length === 0) return "No site of the twin provides an activity, so there is no capacity to change.";
    if (b.activity !== null && !offer.activities.includes(b.activity)) {
      return `No site provides "${b.activity}". The activities of the twin are: ${offer.activities.join(", ")}.`;
    }
    if (b.sites !== null) {
      const there = b.sites.filter((id) => siteNamed(id));
      if (there.length === 0) return "None of its sites is on the map of the twin any more.";
      if (b.activity !== null && !there.some((id) => siteNamed(id)!.activities.includes(b.activity!))) {
        return `None of its sites provides "${b.activity}".`;
      }
    }
    if (b.mode !== null) {
      const held = b.activity !== null ? (offer.modes[b.activity] ?? []) : Object.values(offer.modes).flat();
      if (!held.some((m) => m.mode === b.mode)) {
        return `The twin's price list holds no mode "${b.mode}"${b.activity !== null ? ` for ${b.activity}` : ""}, so nothing could be opened in it.`;
      }
    }
    return null;
  }
  if (type.effect === "measure") {
    if (offer.layers.length === 0) return "The twin declares no contact layer, so no measure can be tested on it.";
    const unknown = (type.bounds.layers ?? []).map((l) => l.layer).filter((l) => !offer.layers.includes(l));
    if (unknown.length) return `The twin declares no contact layer called ${quoted(unknown)}. It declares: ${offer.layers.join(", ")}.`;
    if (type.bounds.catchments !== null && !type.bounds.catchments.some((id) => offer.catchments.some((c) => c.id === id))) {
      return "None of its catchments is in the twin any more.";
    }
    return null;
  }
  if (type.effect === "transfer") {
    if (offer.routes.length === 0) return "The twin holds no transfer route between two sites, so a run cannot send anyone anywhere.";
    const { from, to } = type.bounds;
    const open = offer.routes.filter((r) => (from === null || from.includes(r.source)) && (to === null || to.includes(r.target)));
    return open.length ? null : "The twin holds no transfer route from one of its sites to one of its destinations.";
  }
  const allowed = type.bounds.responses;
  if (allowed !== null && !allowed.some((id) => offer.responses.some((r) => r.id === id))) {
    return "None of the recorded responses it names is in the library any more.";
  }
  return null;
}

// --- one change against its action type ----------------------------------------

/** A refusal the analyst reads: what was asked is outside what the project declared. */
export class OutOfBounds extends ToolError {}

/**
 * The action type a change falls under.
 *
 * Named, it must be an active type that changes that kind of thing. Unnamed,
 * it is the one active type that does, when there is exactly one: that is every
 * change in a project that declared nothing.
 */
export function actionFor(types: readonly ActionType[], effect: Effect, named: string | undefined): ActionType {
  const what = { capacity: "capacity", measure: "a measure", transfer: "a transfer of patients", response: "a recorded response" }[effect];
  const able = types.filter((t) => t.active && t.effect === effect);
  const refs = () => able.map((t) => `${t.key} (${t.name})`).join("; ");
  if (named !== undefined) {
    const hit = types.find((t) => t.key === named.trim().toLowerCase());
    if (!hit) throw new OutOfBounds(`This project has no action type called "${named}". ` + (able.length ? `For ${what}, it has: ${refs()}.` : `It has none for ${what} either.`) + " list_actions reads them.");
    if (!hit.active) throw new OutOfBounds(`The action type "${hit.name}" is switched off in this project, so nothing can be proposed under it. Say in limits that it is switched off.`);
    if (hit.effect !== effect) {
      throw new OutOfBounds(`The action type "${hit.name}" changes ${hit.effect}, and this change is ${what}. ` + (able.length ? `For ${what}, use: ${refs()}.` : `This project has no action type for ${what}.`));
    }
    return hit;
  }
  if (able.length === 0) {
    throw new OutOfBounds(`No action type of this project lets an option contain ${what}. It is not something to propose here: say in limits that no action type covers it.`);
  }
  if (able.length > 1) throw new OutOfBounds(`This project has several action types for ${what}: ${refs()}. Say which one this change falls under ("action": its ref).`);
  return able[0]!;
}

const range = (min: number | null, max: number | null, unit: string): string =>
  min !== null && max !== null ? `from ${min} to ${max} ${unit}` : min !== null ? `${min} ${unit} or more` : `${max} ${unit} or fewer`;

function tooEarly(type: ActionType, fromDay: number): void {
  if (type.leadDays !== null && fromDay < type.leadDays) {
    throw new OutOfBounds(
      `"${type.name}" takes ${type.leadDays} day${type.leadDays === 1 ? "" : "s"} before it can apply. The decision is taken on day 0 of the run, so it cannot start on day ${fromDay}: ask for day ${type.leadDays} or later.`,
    );
  }
}

const named = (list: readonly { id: string; name: string }[], idsAllowed: readonly string[]): string =>
  idsAllowed.map((id) => list.find((x) => x.id === id)?.name ?? id).slice(0, 12).join("; ") + (idsAllowed.length > 12 ? "; …" : "");

type Places = { facilities: readonly { id: string; name: string }[]; populations: readonly { id: string; name: string }[] };

/** Capacity, as its action type allows it. `mode` is what the change asked for; the mode to use comes back. */
export function fitCapacity(
  type: ActionType & { effect: "capacity" },
  change: { facility: string; activity: string; amount: number; start: number; mode: string | undefined },
  ctx: Places,
): string | undefined {
  const b = type.bounds;
  const site = ctx.facilities.find((f) => f.id === change.facility)?.name ?? change.facility;
  if (b.activity !== null && b.activity !== change.activity) {
    throw new OutOfBounds(`"${type.name}" changes ${b.activity} and nothing else: this change is on ${change.activity}.`);
  }
  if ((b.minUnits !== null && change.amount < b.minUnits) || (b.maxUnits !== null && change.amount > b.maxUnits)) {
    throw new OutOfBounds(`"${type.name}" allows ${range(b.minUnits, b.maxUnits, "units")}: ${change.amount} is outside that.`);
  }
  if (b.sites !== null && !b.sites.includes(change.facility)) {
    throw new OutOfBounds(`"${type.name}" is not allowed at ${site}. It is allowed at: ${named(ctx.facilities, b.sites)}.`);
  }
  tooEarly(type, change.start);
  if (b.mode !== null && change.mode !== undefined && change.mode.trim().toLowerCase() !== b.mode.toLowerCase()) {
    throw new OutOfBounds(`"${type.name}" opens units in mode "${b.mode}" only: leave mode out, or give that one.`);
  }
  // Closing units has no mode: the type's own applies only to units it opens.
  return change.amount > 0 ? (b.mode ?? change.mode) : change.mode;
}

export function fitMeasure(
  type: ActionType & { effect: "measure" },
  change: { layers: readonly { layer: string; factor: number }[]; populations: readonly string[] | null; start: number; days: number },
  ctx: Places,
): void {
  const b = type.bounds;
  if (b.layers !== null) {
    for (const l of change.layers) {
      const allowed = b.layers.find((x) => x.layer === l.layer);
      if (!allowed) throw new OutOfBounds(`"${type.name}" does not act on the layer "${l.layer}". It acts on: ${b.layers.map((x) => x.layer).join(", ")}.`);
      if (l.factor < allowed.minFactor || l.factor > allowed.maxFactor) {
        throw new OutOfBounds(`"${type.name}" allows a factor from ${allowed.minFactor} to ${allowed.maxFactor} on "${l.layer}": ${l.factor} is outside that.`);
      }
    }
  }
  if (b.maxDays !== null && change.days > b.maxDays) {
    throw new OutOfBounds(`"${type.name}" lasts ${b.maxDays} day${b.maxDays === 1 ? "" : "s"} at most: ${change.days} is more than that.`);
  }
  if (b.catchments !== null) {
    if (change.populations === null) {
      throw new OutOfBounds(`"${type.name}" does not cover every catchment. Name the catchments, among: ${named(ctx.populations, b.catchments)}.`);
    }
    const outside = change.populations.filter((id) => !b.catchments!.includes(id));
    if (outside.length) throw new OutOfBounds(`"${type.name}" is not allowed in ${named(ctx.populations, outside)}. It is allowed in: ${named(ctx.populations, b.catchments)}.`);
  }
  tooEarly(type, change.start);
}

export function fitTransfer(type: ActionType & { effect: "transfer" }, change: { source: string; target: string; perDay: number; start: number }, ctx: Places): void {
  const b = type.bounds;
  if (b.maxPerDay !== null && change.perDay > b.maxPerDay) {
    throw new OutOfBounds(`"${type.name}" sends ${b.maxPerDay} patient${b.maxPerDay === 1 ? "" : "s"} a day at most: ${change.perDay} is more than that.`);
  }
  if (b.from !== null && !b.from.includes(change.source)) {
    throw new OutOfBounds(`"${type.name}" does not send patients from ${named(ctx.facilities, [change.source])}. It sends them from: ${named(ctx.facilities, b.from)}.`);
  }
  if (b.to !== null && !b.to.includes(change.target)) {
    throw new OutOfBounds(`"${type.name}" does not send patients to ${named(ctx.facilities, [change.target])}. It sends them to: ${named(ctx.facilities, b.to)}.`);
  }
  tooEarly(type, change.start);
}

export function fitResponse(type: ActionType & { effect: "response" }, change: { ref: string; name: string; start: number }, known: readonly { id: string; name: string }[]): void {
  const allowed = type.bounds.responses;
  if (allowed !== null && !allowed.includes(change.ref)) {
    throw new OutOfBounds(`"${type.name}" does not include the response “${change.name}”. It includes: ${named(known, allowed)}.`);
  }
  tooEarly(type, change.start);
}

/** What an option says of the action type a change fell under. Only for a type the project declared. */
export interface ChangeAction {
  key: string;
  name: string;
  approver: string;
}

export const saidOf = (type: ActionType): ChangeAction | null => (type.declared ? { key: type.key, name: type.name, approver: type.approver } : null);
