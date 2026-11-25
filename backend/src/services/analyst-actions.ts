import { z } from "zod";

import { DEFAULT_ACTION_TYPES, missingFor, type ActionType, type TwinOffer } from "./action-types.js";
import { listedResponses, transferRoutes, type StoredResponse } from "./analyst-responses.js";
import { obj, type AnalystContext, type AnalystTool } from "./analyst-tools.js";
import { catalogueOf, fold } from "./price-catalogue.js";
import { ROUTE_CAPACITY } from "./scenario-run.js";
import { twinContext } from "./scenario-stamps.js";
import type { SimExport } from "./twin-export.js";

// ---------------------------------------------------------------------------
// The action types, as the analyst reads them.
//
// `action-types.ts` holds what a project declared and how a change is checked
// against it. This file reads the twin for what an action type can point at,
// and gives the analyst the list: `list_actions`.
//
// The tool is offered only in a project that declared something. In one that
// did not, the four built-in types cover everything the analyst could already
// propose, and reading them would change nothing but the cost of the exchange.
// ---------------------------------------------------------------------------

/** What the twin declares that an action type can point at: read from the twin, never typed by hand. */
export function twinOffer(system: SimExport, stored: readonly StoredResponse[]): TwinOffer {
  const ctx = twinContext(system);
  const modes: TwinOffer["modes"] = {};
  for (const e of catalogueOf(system).entries) {
    // A price row names its activity as a person wrote it; the twin's own name is the one an action type keeps.
    const activity = ctx.activities.find((a) => fold(a) === fold(e.activity));
    if (!activity) continue;
    const held = (modes[activity] ??= []);
    const same = held.find((m) => m.mode === e.mode);
    // A mode priced at several sites is one mode: its shortest delay is the soonest it can be anywhere.
    if (same) same.leadDays = Math.min(same.leadDays, e.leadDays);
    else held.push({ mode: e.mode, leadDays: e.leadDays });
  }
  return {
    activities: ctx.activities,
    layers: ctx.couplings,
    sites: ctx.facilities
      .map((f) => ({ id: f.id, name: f.name, activities: Object.keys(f.capacity).filter((a) => (f.capacity[a] ?? 0) > 0) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    catchments: ctx.populations.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
    routes: transferRoutes(system, ctx),
    responses: listedResponses(stored, system).map((r) => ({ id: r.stampRef, name: r.name })),
    modes,
  };
}

const CHANGES: Record<ActionType["effect"], string> = {
  capacity: "capacity: units of an activity added or closed at a site, from a day until the end of the run",
  measure: "a measure: contact layers scaled in some catchments for some days",
  transfer: "a transfer: waiting patients sent each day from one site to another, along a route the twin holds",
  response: "a recorded response: rules the engine evaluates at every step of the run",
};

const sitesNamed = (offer: TwinOffer, idsAllowed: readonly string[]) =>
  idsAllowed.map((id) => ({ site: offer.sites.find((s) => s.id === id)?.name ?? id, site_id: id }));

/** The bounds of an action type, as the model reads them: every number under a name that says its unit. */
function boundsFor(t: ActionType, offer: TwinOffer): Record<string, unknown> {
  if (t.effect === "capacity") {
    const b = t.bounds;
    return {
      activity: b.activity ?? "any activity the site provides",
      ...(b.minUnits !== null ? { units_at_least: b.minUnits } : {}),
      ...(b.maxUnits !== null ? { units_at_most: b.maxUnits } : {}),
      sites: b.sites === null ? "any site that provides the activity" : sitesNamed(offer, b.sites),
      ...(b.mode !== null ? { opened_in_mode: b.mode } : {}),
    };
  }
  if (t.effect === "measure") {
    const b = t.bounds;
    return {
      layers: b.layers === null ? "any contact layer the twin declares" : b.layers.map((l) => ({ layer: l.layer, factor_at_least: l.minFactor, factor_at_most: l.maxFactor })),
      ...(b.maxDays !== null ? { days_at_most: b.maxDays } : {}),
      catchments:
        b.catchments === null ? "any catchment, or all of them" : b.catchments.map((id) => ({ catchment: offer.catchments.find((c) => c.id === id)?.name ?? id, catchment_id: id })),
    };
  }
  if (t.effect === "transfer") {
    const b = t.bounds;
    return {
      patients_per_day_at_most: b.maxPerDay ?? ROUTE_CAPACITY,
      from: b.from === null ? "any site a route leaves" : sitesNamed(offer, b.from),
      to: b.to === null ? "any site a route reaches" : sitesNamed(offer, b.to),
    };
  }
  const allowed = t.bounds.responses;
  return { responses: allowed === null ? "any recorded response (list_responses)" : allowed.map((id) => offer.responses.find((r) => r.id === id)?.name ?? id) };
}

/** One action type, as `list_actions` gives it. */
export function describeAction(t: ActionType, offer: TwinOffer): Record<string, unknown> {
  const missing = missingFor(t, offer);
  return {
    ref: t.key,
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    changes: CHANGES[t.effect],
    bounds: boundsFor(t, offer),
    ...(t.leadDays !== null ? { days_before_it_can_apply: t.leadDays } : {}),
    ...(t.approver ? { approved_by: t.approver } : {}),
    can_be_tested: missing === null,
    ...(missing ? { missing } : {}),
  };
}

export const listActions: AnalystTool = {
  name: "list_actions",
  description:
    "The action types this project declared: the kinds of change an option may contain here. Each has a ref, what it changes, its bounds (units, sites, layers, days), the days it takes before it can apply, and who can approve it. " +
    "Read it before thinking of options. Propose only what an action type covers, inside its bounds, and give each change of test_option its action type (\"action\": the ref). " +
    "An action type marked can_be_tested false points at something the twin does not hold: do not propose it, and say what it is missing.",
  input_schema: obj({}, []),
  parse: z.object({}),
  async run(ctx: AnalystContext) {
    const types = (await ctx.actions?.()) ?? [...DEFAULT_ACTION_TYPES];
    const ex = await ctx.world(ctx.scenario ? "scenario" : "reality");
    const offer = twinOffer(ex, (await ctx.responses?.()) ?? []);
    const off = types.filter((t) => !t.active).map((t) => t.name);
    return {
      action_types: types.filter((t) => t.active).map((t) => describeAction(t, offer)),
      ...(off.length ? { switched_off_in_this_project: off } : {}),
      how_to_read:
        "These are the only kinds of change an option may contain in this project. A test outside a bound is refused, with the bound. " +
        "An idea none of them covers is not an option: put it in limits and say that no action type of this project covers it. " +
        "An action type switched off is not to be proposed either. Taking out a choice the scenario already holds (kind \"remove\") needs no action type. " +
        "An action type is what may be proposed, not what was decided: every option is still tested by the engine, and applied only by a person.",
    };
  },
};
