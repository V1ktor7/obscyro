import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { ANALYST_MODELS, analystOffBecause, config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { streamLines } from "../lib/ndjson.js";
import { ANALYST_MODEL, anthropicModel, ask, converse, type AskFocus, type LoopEvent, type LoopResult } from "../services/analyst.js";
import { eventSearch, eventsClosing } from "../services/analyst-events.js";
import { OPTION_TOOLS, benchFor, optionsClosing } from "../services/analyst-options.js";
import type { StoredResponse } from "../services/analyst-responses.js";
import { ToolError, runDigestSchema, type AnalystContext, type WorldName } from "../services/analyst-tools.js";
import { serverRun, simServiceEngine } from "../services/scenario-run.js";
import { Ledger } from "../services/analyst-verify.js";
import { listDatasets, previewRows, type DatasetRow } from "../services/datasets.js";
import { listHealthEvents, type HealthEvent } from "../services/health-events.js";
import { listSimPolicies } from "../services/sim-policies.js";
import { readLive, signalsById, type LiveReading } from "../services/live-reading.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment, type EnvironmentRow } from "../services/ontology.js";
import { getOverlayScenario, listOverrides } from "../services/scenario-overrides.js";
import { buildTwinExport, type SimExport } from "../services/twin-export.js";
import { getWebSources } from "../services/web-sources.js";

// ---------------------------------------------------------------------------
// The analyst: a question about the twin, answered from what tools read, with
// the whole reading returned beside the answer.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

async function requireUserId(req: { apiKey?: { id: string } | null; db: DbClient }): Promise<string> {
  const apiKey = req.apiKey;
  if (!apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

/**
 * What the tools read from, for one question.
 *
 * Everything is fetched at most once and only if a tool asks: a question about
 * a dataset never builds the twin, and one about the twin builds it once
 * however many tools look at it.
 */
function contextFor(
  db: DbClient,
  env: EnvironmentRow,
  scenario: AnalystContext["scenario"],
  run: AnalystContext["run"],
): AnalystContext {
  const worlds = new Map<WorldName, Promise<SimExport>>();
  let datasets: Promise<DatasetRow[]> | null = null;
  let events: Promise<HealthEvent[]> | null = null;
  let live: Promise<LiveReading> | null = null;
  let responses: Promise<StoredResponse[]> | null = null;
  const rows = new Map<string, Promise<Record<string, unknown>[]>>();
  return {
    environment: env.slug,
    scenario,
    run,
    known: new Ledger(),
    world(name) {
      if (name === "scenario" && !scenario) {
        return Promise.reject(new ToolError("No scenario is open, so there is no 'scenario' world. Read 'reality'."));
      }
      let p = worlds.get(name);
      if (!p) {
        p = buildTwinExport(db, env.id, env.slug, name === "scenario" ? { scenarioId: scenario!.id, atOffsetHours: 0 } : undefined);
        worlds.set(name, p);
      }
      return p;
    },
    datasets() {
      datasets ??= listDatasets(db, env.id);
      return datasets;
    },
    rows(datasetId) {
      let p = rows.get(datasetId);
      if (!p) {
        p = previewRows(db, datasetId, config.rollupInstanceCap);
        rows.set(datasetId, p);
      }
      return p;
    },
    events() {
      events ??= listHealthEvents(db, env.id);
      return events;
    },
    live() {
      live ??= readLive(db, env);
      return live;
    },
    responses() {
      // The library of the Events page, as much of each response as a run needs.
      responses ??= listSimPolicies(db, env.id).then((rows) => rows.map((r) => ({ id: r.id, name: r.name, description: r.description, rules: r.rules })));
      return responses;
    },
  };
}

/** An exchange of any kind, as the journal keeps it. */
type Exchange = LoopResult<unknown, unknown>;

/**
 * One line of the journal. The id is chosen before the exchange starts, so the
 * person's screen can name the exchange (to record a decision from it) without
 * waiting for the insert.
 */
async function record(
  db: DbClient,
  row: {
    id: string;
    kind: "ask" | "options" | "events";
    projectId: string;
    scenarioId: string | null;
    userId: string;
    question: string;
    looking: string;
    result: Exchange | null;
    failure: string | null;
  },
): Promise<void> {
  const r = row.result;
  await db.query(
    `INSERT INTO app.analyst_exchange
            (id, kind, project_id, scenario_id, asked_by, question, looking, status, answer, steps, struck, verified, message, model, usage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15::jsonb)`,
    [
      row.id,
      row.kind,
      row.projectId,
      row.scenarioId,
      row.userId,
      row.question,
      row.looking,
      r ? r.status : "failed",
      JSON.stringify(r?.answer ?? null),
      JSON.stringify(r?.steps ?? []),
      JSON.stringify(r?.struck ?? []),
      r?.verified ?? false,
      r?.message ?? row.failure,
      r?.model ?? ANALYST_MODEL,
      JSON.stringify(r?.usage ?? {}),
    ],
  );
}

/** What went wrong with the model, in words a planner can act on. */
export function failureMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "The analyst's API key was refused. An administrator has to check ANTHROPIC_API_KEY on the server.";
  }
  // An account with no credit left is answered as a bad request (400), or as a
  // billing error (402). Either way "try again" is the one thing that cannot
  // help, and the generic message below used to say exactly that.
  if (err instanceof Anthropic.APIError && (err.status === 402 || /credit balance/i.test(err.message))) {
    return "The analyst's Claude account has no credit left, so it cannot answer. An administrator has to add credit in the Claude Console; trying again will not help until then.";
  }
  if (err instanceof Anthropic.RateLimitError) return "The analyst is being asked too much at once. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "The analyst's model could not be reached. Try again.";
  if (err instanceof Anthropic.APIError) return `The analyst's model returned an error (${err.status ?? "no status"}). Try again.`;
  // An option is only an option once the engine ran it: without the engine there is nothing to show.
  if (err instanceof AppError && err.code === "SIM_UNAVAILABLE") {
    return "The simulation service could not be reached, so no option could be tested. Nothing was made up in its place. Try again in a moment.";
  }
  if (err instanceof AppError && err.code === "SIM_TIMEOUT") {
    return "The engine took too long to run an option and was cut off, so the test is not shown. Try a shorter run.";
  }
  return "The analyst stopped on an error of ours before answering. Nothing was made up in its place.";
}

/** The journal's id travels with the last line, so a decision can name the exchange it rests on. */
type Line<E> = E | { type: "failed"; message: string };
const withExchange =
  <E extends { type: string }>(write: (line: Line<E>) => void, exchangeId: string) =>
  (e: E) =>
    write(e.type === "done" ? { ...e, exchangeId } : e);

const analystRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // Why the analyst cannot be asked on this server, if it cannot: no key, or a model it cannot run on.
  const off = analystOffBecause(config);
  // One client for the process: it holds the connection pool and the retries.
  const client = off === null ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
  if (off?.reason === "unknown_model") fastify.log.warn({ asked: config.analystModel.refused }, off.says);
  const notConfigured = () => new AppError("ANALYST_NOT_CONFIGURED", off?.says ?? "The analyst is not switched on for this server.", 503);

  app.get(
    "/ontology/:env/analyst",
    {
      schema: {
        summary: "Whether the analyst can be asked, and on which model",
        description:
          "`configured` says whether a question can be asked on this server. `model` is the Claude model every " +
          "exchange is asked of: the one the `ANALYST_MODEL` variable of the API service names, among `models`, " +
          "and the first of them when the variable is unset. When the analyst is off, `reason` names the setting " +
          "at fault and `why` says it in words an administrator can act on: `no_key` (`ANTHROPIC_API_KEY` is " +
          "missing), or `unknown_model` (`ANALYST_MODEL` is set to a value that is not one of `models`). In that " +
          "second case the analyst does not fall back on another model: it stays off.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            configured: z.boolean(),
            model: z.string(),
            models: z.array(z.string()),
            reason: z.enum(["no_key", "unknown_model"]).nullable(),
            why: z.string().nullable(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      await resolveEnvironment(req.db, userId, req.params.env);
      return { configured: client !== null, model: ANALYST_MODEL, models: [...ANALYST_MODELS], reason: off?.reason ?? null, why: off?.says ?? null };
    },
  );

  app.post(
    "/ontology/:env/analyst/ask",
    {
      schema: {
        summary: "Ask the analyst a question about the twin, a scenario or the run on screen",
        description:
          "Answers from what read-only tools return about the twin, and streams the reading as it happens: one JSON " +
          "object per line. `status` lines say what is being done, `step` lines carry each tool call with its input " +
          "and result, and the last line is `done` with the answer, the figures that were struck because no step " +
          "held them, and the usage. A `failed` line replaces `done` when the model could not be reached. " +
          "`focus` says what the person has in front of them when they ask from another page than Scenarios: the " +
          "page, a unit, a signal, by id. The server looks the names up itself; an id it does not find in this " +
          "project is left out, and the question is still answered.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          question: z.string().trim().min(3).max(2000),
          scenarioId: z.string().uuid().nullable().default(null),
          /** What the person is looking at; `scenario` needs a scenarioId. */
          looking: z.enum(["reality", "scenario"]).default("reality"),
          /** The run on screen, as the page summarised it. */
          run: runDigestSchema.nullable().default(null),
          /** What the person has in front of them, by id: names are looked up here, never taken from the caller. */
          focus: z
            .object({
              page: z
                .string()
                .regex(/^[a-z][a-z-]{0,30}$/)
                .optional(),
              unitId: z.string().uuid().optional(),
              signalId: z.string().uuid().optional(),
            })
            .nullable()
            .default(null),
        }),
        // No response schema: the 200 is a stream of lines, not one document.
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      if (!client) throw notConfigured();

      let scenario: AnalystContext["scenario"] = null;
      if (req.body.scenarioId) {
        const s = await getOverlayScenario(req.db, req.body.scenarioId);
        if (s.projectId !== env.id) throw NotFound("SCENARIO_NOT_FOUND", "That scenario is not in this environment.");
        scenario = { id: s.id, name: s.name, description: s.description, overrides: await listOverrides(req.db, s.id) };
      }
      const looking = scenario ? req.body.looking : "reality";
      const ctx = contextFor(req.db, env, scenario, req.body.run);
      const exchangeId = randomUUID();

      let focus: AskFocus | null = null;
      if (req.body.focus) {
        const { page, unitId, signalId } = req.body.focus;
        const signal = signalId ? ((await signalsById(req.db, env.id, [signalId]))[0] ?? null) : null;
        // The same reading the tools will use: looked up once, kept for the question.
        const unit = unitId ? ((await ctx.live()).units.find((u) => u.id === unitId) ?? null) : null;
        focus = {
          page: page ?? null,
          unit: unit ? { id: unit.id, name: unit.name } : null,
          signal: signal
            ? { id: signal.id, title: signal.title, kind: signal.type, stage: signal.stage, step: `${signal.stageNo} of ${signal.stages}`, unitId: signal.unitId }
            : null,
        };
      }

      return streamLines<Line<LoopEvent<unknown, unknown>>>(reply, async (write, gone) => {
        let result: Exchange | null = null;
        let failure: string | null = null;
        try {
          result = await ask(anthropicModel(client), ctx, { question: req.body.question, looking, focus }, withExchange(write, exchangeId), undefined, gone);
        } catch (err) {
          req.log.error({ err }, "analyst failed");
          failure = failureMessage(err);
          write({ type: "failed", message: failure });
        }
        // Written before the stream closes but after the answer is on its way:
        // the record must not slow the person down, and failing to write it
        // must not look like no answer.
        await record(req.db, {
          id: exchangeId,
          kind: "ask",
          projectId: env.id,
          scenarioId: scenario?.id ?? null,
          userId,
          question: req.body.question,
          looking,
          result,
          failure,
        }).catch((err) => req.log.error({ err }, "analyst exchange not recorded"));
      });
    },
  );

  app.post(
    "/ontology/:env/analyst/options",
    {
      schema: {
        summary: "State an objective; get up to three options, each tested by the engine",
        description:
          "The person states what should change on the open scenario (\"nobody waits at this site\", \"the fewest " +
          "patient-days waiting with at most 100 beds added\"). The analyst reads the twin and the scenario, proposes " +
          "up to three options and runs each one through the simulation engine on the server, the way the Scenarios " +
          "page runs a scenario (`test_option`). Streams like `/analyst/ask`: `status` and `step` lines as the work " +
          "happens, then `done` with the proposal — the scenario as it is beside each tested option (peak occupancy, " +
          "sites with a queue, patient-days waiting, first day of queue), what each rests on with its level of " +
          "evidence (measured, published, assumption), a one-sentence mechanism, what the test does not say, and the " +
          "trade-offs left to the person — and `exchangeId`, which names this exchange when a decision is recorded " +
          "from it. An option adds stamps, and may replace or remove a choice the scenario already holds (a measure " +
          "or capacity, never a starting condition or an event): each option carries `changes`, what it adds, " +
          "replaces and removes in the program's own words, and `retires`, the stamps of the scenario it takes out, " +
          "by id. That is what the page deletes when the person applies the option; `stamps` is what it writes. " +
          "An option may also contain a recorded response (one of the organisation's library, or one the engine " +
          "writes itself) or transfers of waiting patients between two sites the twin links by a route: rules the " +
          "engine evaluates at every step, written as a `response` stamp and tested by the same run. Each option " +
          "then carries `cost`: what the engine counted (the cost each rule declares, each time it fired), whether " +
          "that is the whole cost of the option, and a sentence saying so; capacity and measures carry no price. " +
          "The figures of the comparison come from the runs, never from the model's text, and the model's " +
          "text is checked against the steps like any answer. Nothing is written: the scenario is unchanged until " +
          "the person adds an option themselves. A run is the result of a model under stated conditions, not a forecast.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          objective: z.string().trim().min(3).max(2000),
          /** Options are tested on a scenario: there is nothing to add them to otherwise. */
          scenarioId: z.string().uuid(),
          /** The days the page runs over, and the activity it reads: a test must answer what Run would show. */
          horizon: z.number().int().min(1).max(365),
          activity: z.string().trim().min(1).max(120),
          /** The run on screen, as the page summarised it. */
          run: runDigestSchema.nullable().default(null),
        }),
        // No response schema: the 200 is a stream of lines, not one document.
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      if (!client) throw notConfigured();
      if (!config.simServiceUrl) {
        throw BadRequest("SIM_UNAVAILABLE", "Options are tested by the simulation service, and this server is not connected to one (SIM_SERVICE_URL).");
      }
      const s = await getOverlayScenario(req.db, req.body.scenarioId);
      if (s.projectId !== env.id) throw NotFound("SCENARIO_NOT_FOUND", "That scenario is not in this environment.");
      const scenario = { id: s.id, name: s.name, description: s.description, overrides: await listOverrides(req.db, s.id) };
      const ctx = contextFor(req.db, env, scenario, req.body.run);
      ctx.bench = benchFor({
        engine: simServiceEngine,
        scenario,
        horizon: req.body.horizon,
        activity: req.body.activity,
        world: (name) => ctx.world(name),
      });
      const exchangeId = randomUUID();
      const input = { objective: req.body.objective };

      return streamLines<Line<LoopEvent<unknown, unknown>>>(reply, async (write, gone) => {
        let result: Exchange | null = null;
        let failure: string | null = null;
        try {
          result = await converse(anthropicModel(client), ctx, optionsClosing(ctx, input), withExchange(write, exchangeId), OPTION_TOOLS, gone);
        } catch (err) {
          req.log.error({ err }, "analyst options failed");
          failure = failureMessage(err);
          write({ type: "failed", message: failure });
        }
        await record(req.db, {
          id: exchangeId,
          kind: "options",
          projectId: env.id,
          scenarioId: scenario.id,
          userId,
          question: req.body.objective,
          looking: "scenario",
          result,
          failure,
        }).catch((err) => req.log.error({ err }, "analyst exchange not recorded"));
      });
    },
  );

  app.post(
    "/ontology/:env/analyst/run",
    {
      schema: {
        summary: "Run a scenario on the server and get the summary the Scenarios page sends the analyst",
        description:
          "Runs the scenario as it stands through the simulation engine, the way pressing Run on the Scenarios page " +
          "does (the events alone, then with the planner's choices), and returns the summary of that run in the form " +
          "`/analyst/ask` and `/analyst/options` accept as `run`. It is what lets a question about \"the run on " +
          "screen\" be asked with no screen: the reference questions are replayed by a script " +
          "(`npm run eval:analyst`), not by a person in a browser. Streams one JSON object per line, because two " +
          "passes of the engine take about a minute on a large twin: `status` lines while it works, then `done` with " +
          "`run`, or `failed` with a message. `horizon` and `activity` are the page's own settings: the days the run " +
          "covers and the activity it reads. Nothing is written, no language model is called, and the analyst does " +
          "not need to be switched on. A run is the result of a model under the scenario's stated conditions, not a forecast.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          scenarioId: z.string().uuid(),
          horizon: z.number().int().min(1).max(365),
          activity: z.string().trim().min(1).max(120),
        }),
        // No response schema: the 200 is a stream of lines, not one document.
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      if (!config.simServiceUrl) {
        throw BadRequest("SIM_UNAVAILABLE", "A scenario is run by the simulation service, and this server is not connected to one (SIM_SERVICE_URL).");
      }
      const s = await getOverlayScenario(req.db, req.body.scenarioId);
      if (s.projectId !== env.id) throw NotFound("SCENARIO_NOT_FOUND", "That scenario is not in this environment.");
      const overrides = await listOverrides(req.db, s.id);
      const { horizon, activity } = req.body;

      type RunLine = { type: "status"; message: string } | { type: "done"; run: unknown } | { type: "failed"; message: string };
      return streamLines<RunLine>(reply, async (write) => {
        try {
          write({ type: "status", message: "Reading the twin" });
          // As the page does: the map and its context from the twin as it
          // stands, the engine's input from the twin read through the scenario.
          const [reality, system] = await Promise.all([
            buildTwinExport(req.db, env.id, env.slug),
            buildTwinExport(req.db, env.id, env.slug, { scenarioId: s.id, atOffsetHours: 0 }),
          ]);
          write({ type: "status", message: "Running the scenario in the engine" });
          const run = await serverRun(simServiceEngine, { reality, system, scenario: { id: s.id, name: s.name }, horizon, activity }, overrides);
          write({ type: "done", run });
        } catch (err) {
          req.log.error({ err }, "server run failed");
          // What the engine or the twin refused is something to read; anything else is ours.
          const said = err instanceof AppError && ["ACTIVITY_NOT_PROVIDED", "SIM_REFUSED"].includes(err.code) ? err.message : null;
          write({
            type: "failed",
            message:
              said ??
              (err instanceof AppError && err.code === "SIM_UNAVAILABLE"
                ? "The simulation service could not be reached, so the scenario was not run. Try again in a moment."
                : err instanceof AppError && err.code === "SIM_TIMEOUT"
                  ? "The engine took too long to run the scenario and was cut off. Try a shorter run."
                  : "The run stopped on an error of ours. Nothing was made up in its place."),
          });
        }
      });
    },
  );

  app.post(
    "/ontology/:env/analyst/events",
    {
      schema: {
        summary: "Search official web sources for events around the network; get candidates to accept or reject",
        description:
          "The person names a place, a period and a kind of event (\"What measures were in force in Montréal between " +
          "2021-12-01 and 2022-02-28?\"). The analyst searches the web through the Claude API's web search tool, " +
          "restricted to the project's allowed sources (`/web-sources`) and to a fixed number of searches, and " +
          "proposes candidate events. Streams like `/analyst/ask`: a `step` line for each search (its query and the " +
          "pages returned) and for each passage a page was cited to, then `done` with the candidates — title, dates, " +
          "place, the door by which the event reaches a health network (demand, capacity, access, care), the link, " +
          "and a quotation of fewer than fifteen words — and `exchangeId`, which names this search when a candidate " +
          "is accepted. The link and the passage come from the API's citations; the quotation is checked to be in a " +
          "passage word for word; a date is kept only when a passage states it, and is left blank otherwise for the " +
          "person to enter. In this exchange the model has no tool that reads the twin, a scenario or a dataset: " +
          "nothing of the organisation's can go into a search. Nothing is written to the calendar: a candidate " +
          "becomes an event only through `POST /health-events`.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          request: z.string().trim().min(3).max(2000),
          /** The scenario open when the search was made, kept in the journal; the search itself never reads it. */
          scenarioId: z.string().uuid().nullable().default(null),
        }),
        // No response schema: the 200 is a stream of lines, not one document.
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      if (!client) throw notConfigured();
      const { domains } = await getWebSources(req.db, env.id);
      if (domains.length === 0) {
        throw BadRequest("NO_WEB_SOURCES", "This project allows no web source, so there is nowhere to search. Add at least one under Sources.");
      }
      let scenarioId: string | null = null;
      if (req.body.scenarioId) {
        const s = await getOverlayScenario(req.db, req.body.scenarioId);
        if (s.projectId !== env.id) throw NotFound("SCENARIO_NOT_FOUND", "That scenario is not in this environment.");
        scenarioId = s.id;
      }
      // A context with nothing open and no tool to read it with: the search
      // cannot be handed the twin, the scenario or a dataset.
      const ctx = contextFor(req.db, env, null, null);
      const exchangeId = randomUUID();
      const closing = eventsClosing({ request: req.body.request, domains, today: new Date().toISOString().slice(0, 10) });

      return streamLines<Line<LoopEvent<unknown, unknown>>>(reply, async (write, gone) => {
        let result: Exchange | null = null;
        let failure: string | null = null;
        try {
          result = await converse(anthropicModel(client), ctx, closing, withExchange(write, exchangeId), [], gone, eventSearch(domains));
        } catch (err) {
          req.log.error({ err }, "analyst events failed");
          failure = failureMessage(err);
          write({ type: "failed", message: failure });
        }
        await record(req.db, {
          id: exchangeId,
          kind: "events",
          projectId: env.id,
          scenarioId,
          userId,
          question: req.body.request,
          looking: "web",
          result,
          failure,
        }).catch((err) => req.log.error({ err }, "analyst exchange not recorded"));
      });
    },
  );
};

export default analystRoutes;
