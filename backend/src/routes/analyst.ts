import Anthropic from "@anthropic-ai/sdk";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { streamLines } from "../lib/ndjson.js";
import { ANALYST_MODEL, anthropicModel, ask, type AnalystEvent, type AnalystResult } from "../services/analyst.js";
import { ToolError, runDigestSchema, type AnalystContext, type WorldName } from "../services/analyst-tools.js";
import { Ledger } from "../services/analyst-verify.js";
import { listDatasets, previewRows, type DatasetRow } from "../services/datasets.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment, type EnvironmentRow } from "../services/ontology.js";
import { getOverlayScenario, listOverrides } from "../services/scenario-overrides.js";
import { buildTwinExport, type SimExport } from "../services/twin-export.js";

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
  };
}

async function record(
  db: DbClient,
  row: { projectId: string; scenarioId: string | null; userId: string; question: string; looking: string; result: AnalystResult | null; failure: string | null },
): Promise<void> {
  const r = row.result;
  await db.query(
    `INSERT INTO app.analyst_exchange
            (project_id, scenario_id, asked_by, question, looking, status, answer, steps, struck, verified, message, model, usage)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13::jsonb)`,
    [
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
function failureMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "The analyst's API key was refused. An administrator has to check ANTHROPIC_API_KEY on the server.";
  }
  if (err instanceof Anthropic.RateLimitError) return "The analyst is being asked too much at once. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "The analyst's model could not be reached. Try again.";
  if (err instanceof Anthropic.APIError) return `The analyst's model returned an error (${err.status ?? "no status"}). Try again.`;
  return "The analyst stopped on an error of ours before answering. Nothing was made up in its place.";
}

const analystRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // One client for the process: it holds the connection pool and the retries.
  const client = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

  app.get(
    "/ontology/:env/analyst",
    {
      schema: {
        summary: "Whether the analyst can be asked",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ configured: z.boolean(), model: z.string() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      await resolveEnvironment(req.db, userId, req.params.env);
      return { configured: client !== null, model: ANALYST_MODEL };
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
          "held them, and the usage. A `failed` line replaces `done` when the model could not be reached.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          question: z.string().trim().min(3).max(2000),
          scenarioId: z.string().uuid().nullable().default(null),
          /** What the person is looking at; `scenario` needs a scenarioId. */
          looking: z.enum(["reality", "scenario"]).default("reality"),
          /** The run on screen, as the page summarised it. */
          run: runDigestSchema.nullable().default(null),
        }),
        // No response schema: the 200 is a stream of lines, not one document.
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      if (!client) {
        throw new AppError(
          "ANALYST_NOT_CONFIGURED",
          "The analyst is not switched on for this server: it needs a Claude API key (ANTHROPIC_API_KEY).",
          503,
        );
      }

      let scenario: AnalystContext["scenario"] = null;
      if (req.body.scenarioId) {
        const s = await getOverlayScenario(req.db, req.body.scenarioId);
        if (s.projectId !== env.id) throw NotFound("SCENARIO_NOT_FOUND", "That scenario is not in this environment.");
        scenario = { id: s.id, name: s.name, description: s.description, overrides: await listOverrides(req.db, s.id) };
      }
      const looking = scenario ? req.body.looking : "reality";
      const ctx = contextFor(req.db, env, scenario, req.body.run);

      return streamLines<AnalystEvent | { type: "failed"; message: string }>(reply, async (write, gone) => {
        let result: AnalystResult | null = null;
        let failure: string | null = null;
        try {
          result = await ask(anthropicModel(client), ctx, { question: req.body.question, looking }, write, undefined, gone);
        } catch (err) {
          req.log.error({ err }, "analyst failed");
          failure = failureMessage(err);
          write({ type: "failed", message: failure });
        }
        // Written before the stream closes but after the answer is on its way:
        // the record must not slow the person down, and failing to write it
        // must not look like no answer.
        await record(req.db, {
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
};

export default analystRoutes;
