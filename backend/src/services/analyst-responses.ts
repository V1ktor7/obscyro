import { z } from "zod";

import { ToolError, fold, obj, pick, type AnalystContext, type AnalystTool } from "./analyst-tools.js";
import { QUEUE, ROUTE_CAPACITY } from "./scenario-run.js";
import { twinContext, type ResponseRule, type Stamp, type TwinContext } from "./scenario-stamps.js";
import type { SimExport } from "./twin-export.js";

/**
 * Recorded responses, as the analyst can use them.
 *
 * The product had two ways of asking "what if" that did not know each other.
 * The Events page and the replay of the units page run a *response*: rules the
 * engine evaluates at every step (transfer patients when a site is full, add
 * capacity when it runs short, scale a catchment's demand). The Scenarios page
 * runs *stamps*: things that simply happen on a day. The analyst only knew the
 * second, and said a transfer of patients could not be tested while the other
 * engine did exactly that.
 *
 * Here the two meet. A response becomes a stamp of the scenario (`response`,
 * `scenario-stamps.ts`), so the run that tests capacity and measures tests it
 * too, on the server and on the page alike. Three sources:
 *
 * - the organisation's library (`app.sim_policy`, written on the Events page);
 * - the responses the engine writes itself from the network;
 * - a transfer between two sites, written here from what the analyst names.
 *
 * Nothing in this file prices anything. A cost exists only where a rule
 * declares one, and the figure shown is what the engine counted in the run.
 */

/** A response of the organisation's library, as much of it as a run needs. */
export interface StoredResponse {
  id: string;
  name: string;
  description: string;
  rules: ResponseRule[];
}

/**
 * The responses the engine writes itself (`simulation-service/app/events/templates.py`).
 * `engine` is the name the simulation service knows each by.
 */
const BUILT_IN = [
  {
    ref: "transfer-when-full",
    engine: "load-balance",
    name: "Transfer when full",
    does: (watched: string) =>
      `One rule for every transfer route of the twin: when the source is nearly full on ${watched} or patients wait there, and the destination has a free unit of ${watched}, waiting patients are sent down the route, sickest first. Each transfer has a declared cost.`,
  },
  {
    ref: "surge-then-transfer",
    engine: "surge-and-balance",
    name: "Surge what is short, then transfer",
    does: (watched: string) =>
      `The transfers of "Transfer when full" (watching ${watched}), and for every resource of every site: when it is nearly all in use, more of it is added some steps later, at a declared cost each time.`,
  },
] as const;

export interface ListedResponse {
  /** What a tool reads and writes: `response-a`, or a built-in's own name. Never a UUID. */
  ref: string;
  name: string;
  source: "stored" | "built-in";
  /** The stored response's id, or the engine's name for a built-in: what the stamp keeps. */
  stampRef: string;
  rules: ResponseRule[];
  description: string;
}

function letters(i: number): string {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(97 + (n % 26)) + s;
  return s;
}

/**
 * The activity the engine's own responses watch: the first space activity by
 * name (`_busiest_activity`). Said to the analyst, because it is not
 * necessarily the activity the run reads.
 */
export function watchedByBuiltIns(ex: SimExport): string | null {
  const space = new Set<string>();
  for (const f of ex.facilities) for (const r of Object.values(f.resources)) if (r.category === "space") for (const a of r.enables) space.add(a);
  return [...space].sort()[0] ?? null;
}

/**
 * Every recorded response a test may name, each under a short name of letters.
 *
 * A stored response's id is a UUID: thirty-six characters for a model to copy
 * without a slip, full of digits the checker of figures would look for in a
 * step. The library is listed by name so the same response keeps its ref for
 * the length of an exchange.
 */
export function listedResponses(stored: readonly StoredResponse[], ex: SimExport): ListedResponse[] {
  const watched = watchedByBuiltIns(ex) ?? "no activity (the twin declares no space)";
  const library = [...stored]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((r, i) => ({ ref: `response-${letters(i)}`, name: r.name, source: "stored" as const, stampRef: r.id, rules: r.rules, description: r.description }));
  return [...library, ...BUILT_IN.map((b) => ({ ref: b.ref, name: b.name, source: "built-in" as const, stampRef: b.engine, rules: [], description: b.does(watched) }))];
}

/** The response a tool input names: by its ref, or by its exact name. */
export function responseNamed(all: readonly ListedResponse[], asked: string): ListedResponse {
  const q = fold(asked);
  const hit = all.find((r) => r.ref === asked.trim().toLowerCase()) ?? all.find((r) => fold(r.name) === q);
  if (!hit) {
    throw new ToolError(
      `No recorded response is called "${asked}". ` +
        (all.length ? `The ones that can be tested are: ${all.map((r) => `${r.ref} (${r.name})`).join("; ")}.` : "None is recorded.") +
        " Call list_responses to read what each does.",
    );
  }
  return hit;
}

type RuleAction = { kind?: string; source?: string; target?: string; amount?: number; factor?: number; population?: string; friction?: { delay?: number; cost?: number; effectiveness?: number } };
const actionOf = (r: ResponseRule): RuleAction => (r.action ?? {}) as RuleAction;

/** Whether any rule of a response says what it costs. A response that says nothing of cost is not free: it is unpriced. */
export function declaresCost(rules: readonly ResponseRule[]): boolean {
  return rules.some((r) => Number(actionOf(r).friction?.cost ?? 0) > 0);
}

const few = <T>(xs: T[], n = 4): T[] => [...new Set(xs)].slice(0, n);

/** What a response's rules do, by kind of action, in the engine's own terms and no more. */
export function whatRulesDo(rules: readonly ResponseRule[], ctx: Pick<TwinContext, "facilities" | "populations">): Record<string, unknown>[] {
  const site = (id: string | undefined) => ctx.facilities.find((f) => f.id === id)?.name ?? id ?? "?";
  const out: Record<string, unknown>[] = [];
  const of = (kind: string) => rules.filter((r) => actionOf(r).kind === kind).map(actionOf);
  const transfers = of("transfer");
  if (transfers.length) {
    out.push({
      does: "sends waiting patients from one site to another, along a transfer route",
      rules: transfers.length,
      routes: few(transfers.map((a) => `${site(a.source)} to ${site(a.target)}`), 6),
      ...(transfers.length > 6 ? { and_more_routes: transfers.length - 6 } : {}),
      patients_per_step_at_most: few(transfers.map((a) => a.amount ?? 0)),
    });
  }
  const surges = of("surge_resource");
  if (surges.length) {
    out.push({ does: "adds units of a resource at a site when its condition holds", rules: surges.length, sites: new Set(surges.map((a) => a.target)).size, units_each_time: few(surges.map((a) => a.amount ?? 0)) });
  }
  const moves = of("reallocate");
  if (moves.length) out.push({ does: "moves units of a resource from one site to another", rules: moves.length });
  const demand = of("modify_demand");
  if (demand.length) {
    out.push({ does: "scales the demand a catchment produces", rules: demand.length, catchments: new Set(demand.map((a) => a.population)).size, demand_multiplied_by: few(demand.map((a) => a.factor ?? 1)) });
  }
  const other = rules.length - transfers.length - surges.length - moves.length - demand.length;
  if (other > 0) out.push({ does: "something this summary has no words for", rules: other });
  return out;
}

/**
 * One transfer, as a rule of the engine: when somebody waits at the source
 * for what the run reads, and the destination has a free unit of it, send up
 * to `perDay` of them down the route.
 *
 * The condition on the destination is not a nicety. A rule that reads only
 * the source sends its sickest into a ward with no free bed, where they queue
 * behind that ward's own patients. No protocol sends to a full hospital, and
 * the engine's own transfer rule guards against it the same way.
 *
 * It declares no cost: nobody gave one, and inventing a price would put a
 * figure on screen that no tool returned.
 */
export function transferRule(t: { id: string; source: string; target: string; activity: string; acuity: string | null; perDay: number; fromDay: number }): ResponseRule {
  return {
    id: t.id,
    trigger: { when: "from_tick", start: t.fromDay, end: null },
    condition: {
      all_of: [
        { compare: { left: { fn: "backlog", facility: t.source, ...(t.acuity ? { acuity: t.acuity } : {}) }, op: ">", right: QUEUE } },
        { compare: { left: { fn: "available", facility: t.target, activity: t.activity }, op: ">", right: 0 } },
      ],
    },
    action: {
      kind: "transfer",
      source: t.source,
      target: t.target,
      ...(t.acuity ? { acuity: t.acuity } : {}),
      amount: t.perDay,
      friction: { delay: 0, cost: 0, effectiveness: 1 },
    },
    priority: 10,
  };
}

/** The transfer routes of a twin whose two ends are on the map. */
export function transferRoutes(ex: SimExport, ctx: Pick<TwinContext, "facilities">): { source: string; target: string }[] {
  const placed = new Set(ctx.facilities.map((f) => f.id));
  return ex.edges.filter((e) => e.kind === "transfer" && placed.has(e.source) && placed.has(e.target)).map((e) => ({ source: e.source, target: e.target }));
}

/** A response stamp, as a tool describes it to the model. */
export function describeResponse(s: Stamp & { kind: "response" }, ctx: Pick<TwinContext, "facilities" | "populations">): Record<string, unknown> {
  return {
    what: "recorded response",
    name: s.name,
    from: s.source === "built-in" ? "the engine" : s.source === "stored" ? "the organisation's library" : "written for this option",
    ...(s.source === "built-in" ? { applies: "whole run" } : { from_day: s.start, its_rules: whatRulesDo(s.rules, ctx) }),
  };
}

export const listResponses: AnalystTool = {
  name: "list_responses",
  description:
    "The recorded responses an option can contain, and the transfer routes of the twin. A recorded response is a set of rules the engine evaluates at every step of a run, where capacity and measures are things placed on a day: transferring waiting patients between sites, adding units when a site runs short, scaling a catchment's demand. " +
    "Returns the responses of the organisation's library and the ones the engine writes itself, each with a ref, what its rules do and whether they declare a cost. " +
    "With routes_from, also returns where patients waiting at that site can be sent: a 'transfer' change of test_option needs such a route. Read this before testing a response or a transfer.",
  input_schema: obj({ routes_from: { type: "string", description: "A site's id or name: list the sites its waiting patients can be transferred to." } }, []),
  parse: z.object({ routes_from: z.string().min(1).max(300).optional() }),
  async run(ctx: AnalystContext, input: { routes_from?: string }) {
    const ex = await ctx.world(ctx.scenario ? "scenario" : "reality");
    const twin = twinContext(ex);
    const all = listedResponses((await ctx.responses?.()) ?? [], ex);
    const routes = transferRoutes(ex, twin);
    const activity = ctx.bench?.activity ?? null;
    const out: Record<string, unknown> = {
      recorded_responses: all.map((r) =>
        r.source === "built-in"
          ? { ref: r.ref, name: r.name, from: "the engine", what_it_does: r.description, declares_a_cost: true, can_start_on_a_day: false }
          : {
              ref: r.ref,
              name: r.name,
              from: "the organisation's library",
              ...(r.description ? { description: r.description } : {}),
              what_its_rules_do: whatRulesDo(r.rules, twin),
              declares_a_cost: declaresCost(r.rules),
              can_start_on_a_day: true,
            },
      ),
      transfer_routes_in_the_twin: routes.length,
      how_to_read:
        "A run follows one recorded response at a time. A response that declares no cost is not free: nobody priced it, and no cost is counted for it. " +
        `The twin holds no flow for its routes, so a run lets each carry at most ${ROUTE_CAPACITY} patients a day. ` +
        "What a response does in a run is only known by testing it: its rules fire when their conditions hold, or never.",
    };
    if (input.routes_from !== undefined) {
      const from = pick(twin.facilities, input.routes_from, "site");
      const to = routes.filter((r) => r.source === from.id).map((r) => twin.facilities.find((f) => f.id === r.target)!);
      out.routes_from = {
        site: from.name,
        site_id: from.id,
        ...(activity ? { [`units_of_${activity}`]: from.capacity[activity] ?? 0 } : {}),
        can_send_to: to
          .map((f) => ({ site: f.name, site_id: f.id, ...(activity ? { [`units_of_${activity}`]: f.capacity[activity] ?? 0 } : {}) }))
          .sort((a, b) => a.site.localeCompare(b.site)),
        ...(to.length === 0 ? { note: "The twin holds no transfer route out of this site, so a transfer from it cannot be tested." } : {}),
      };
    }
    return out;
  },
};
