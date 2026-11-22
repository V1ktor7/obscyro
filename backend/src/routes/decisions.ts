import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { getDataset, previewRows } from "../services/datasets.js";
import {
  decisionFromExchange,
  exchangeForDecision,
  followUp,
  getDecision,
  insertDecision,
  listDecisions,
  realityOf,
  type Decision,
} from "../services/decisions.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import { getOverlayScenario, listOverrides } from "../services/scenario-overrides.js";

// ---------------------------------------------------------------------------
// Decisions: a tested option a person retained, with the figures they expect
// of it, and later those figures beside what was observed.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

/**
 * A decision, as it is returned. Its figures are whatever the journalled test
 * held, so the shape is the service's type rather than a second description of it.
 */
const decisionOut = z.custom<Decision>((v) => typeof v === "object" && v !== null);

async function requireUserId(req: { apiKey?: { id: string } | null; db: DbClient }): Promise<string> {
  const apiKey = req.apiKey;
  if (!apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

const decisionRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/ontology/:env/decisions",
    {
      schema: {
        summary: "Record a decision: a tested option a person retained",
        description:
          "Records that the person asking chose one of the options the analyst had the engine test. The body names " +
          "the journalled exchange (`exchangeId`, sent with the `done` line of `/analyst/options`) and the step that " +
          "tested the option. Every figure of the record — the objective, the option's stamps, the choices of the " +
          "scenario it replaced or removed (`expected.changes`, `expected.retires`), the run's figures with " +
          "and without the option, the arrivals day by day, the steps they come from — is copied by the server from " +
          "that exchange: the caller sends none, and an option that was not tested is refused. A decision is never " +
          "edited; revising one records another.",
        tags: ["decisions"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          exchangeId: z.string().uuid(),
          /** The `test_option` step that tested the retained option, e.g. "s4". */
          step: z.string().regex(/^s\d{1,3}$/),
          note: z.string().trim().max(1000).nullable().default(null),
        }),
        response: { 201: decisionOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const exchange = await exchangeForDecision(req.db, env.id, req.body.exchangeId);
      const draft = decisionFromExchange(exchange, req.body.step);
      // The name is kept on the decision: it has to read on its own if the scenario goes.
      const scenarioName = exchange.scenarioId
        ? await getOverlayScenario(req.db, exchange.scenarioId)
            .then((s) => s.name)
            .catch(() => "a scenario since deleted")
        : "no scenario";
      const decision = await insertDecision(req.db, {
        projectId: env.id,
        scenarioId: exchange.scenarioId,
        scenarioName,
        exchangeId: req.body.exchangeId,
        userId,
        note: req.body.note || null,
        draft,
      });
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "decision.record",
        resourceType: "decision",
        resourceId: decision.id,
        metadata: { scenarioId: decision.scenarioId, option: decision.optionLabel },
      });
      return reply.code(201).send(decision);
    },
  );

  app.get(
    "/ontology/:env/decisions",
    {
      schema: {
        summary: "The decisions recorded in this environment, most recent first",
        description:
          "Each decision carries the objective, the option retained, who recorded it and when, the figures expected " +
          "of it (the tested run, with and without the option) and the analyst's steps those figures come from. " +
          "`scenarioId` keeps only the decisions taken on one scenario.",
        tags: ["decisions"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ scenarioId: z.string().uuid().optional() }),
        response: { 200: z.object({ decisions: z.array(decisionOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { decisions: await listDecisions(req.db, env.id, req.query.scenarioId ?? null) };
    },
  );

  app.get(
    "/ontology/:env/decisions/:id/follow-up",
    {
      schema: {
        summary: "A decision's expected arrivals beside what was observed",
        description:
          "When the decision's scenario is compared with an observed series (its `reality` setting), returns the " +
          "arrivals the tested run expected each day beside the observed ones, on the run's own axis, with the gap: " +
          "peak offset, mean absolute error, and the totals over the days both report. `linked: false` with a reason " +
          "when no series is set or the scenario is gone. Arrivals only: the readings the twin keeps of its own measures " +
          "are not the engine's queue or occupancy, so the expected queue has nothing observed to stand beside. " +
          "Reports the gap and concludes nothing.",
        tags: ["decisions"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const decision = await getDecision(req.db, env.id, req.params.id);
      if (!decision.scenarioId) return { linked: false, reason: "This decision was not taken on a scenario." };
      const scenario = await getOverlayScenario(req.db, decision.scenarioId).catch(() => null);
      if (!scenario || scenario.projectId !== env.id) {
        return { linked: false, reason: "The scenario this decision was taken on no longer exists, so no observed series is set beside it." };
      }
      const reality = realityOf(await listOverrides(req.db, scenario.id));
      if (!reality) {
        return { linked: false, reason: "No observed series is set beside this scenario. Set one under Result, Reality check, then come back." };
      }
      const ds = await getDataset(req.db, reality.datasetId).catch(() => null);
      if (!ds || ds.projectId !== env.id) {
        return { linked: false, reason: "The observed series this scenario names is no longer among the project's datasets." };
      }
      const rows = await previewRows(req.db, ds.id, config.rollupInstanceCap);
      return followUp(decision.expected, { ...reality, datasetName: ds.name }, rows);
    },
  );
};

export default decisionRoutes;
