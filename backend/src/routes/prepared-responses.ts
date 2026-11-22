import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { decisionFromExchange, exchangeForDecision, insertDecision } from "../services/decisions.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  getPreparedResponse,
  insertPreparedResponse,
  listPreparedResponses,
  onCard,
  retirePreparedResponse,
  scenarioMark,
  scenarioOf,
  scenariosNow,
} from "../services/prepared-responses.js";
import { expectedOnEngage, liveTest, retestsOf } from "../services/response-retest.js";
import { getOverlayScenario, listOverrides } from "../services/scenario-overrides.js";
import { getSignal, listSignalTypes, moveSignal, recordOptionTaken, stageAhead } from "../services/signals.js";

// ---------------------------------------------------------------------------
// Prepared responses: kept in calm time from a tested option, engaged in one
// click when a signal of their kind is raised.
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

const preparedRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/ontology/:env/prepared-responses",
    {
      schema: {
        summary: "Keep a tested option as a prepared response for a kind of signal",
        description:
          "Keeps one of the options the analyst had the engine test as a response prepared for a kind of signal. The " +
          "body names the journalled exchange and the step that tested the option, as for a decision, and the kind " +
          "of signal. Every figure of the response is copied by the server from that exchange: the caller sends " +
          "none, and an option that was not tested is refused, so an untested response cannot be kept as a tested " +
          "one. The date of the test and a mark of the scenario it ran on are kept with it.",
        tags: ["decisions"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          exchangeId: z.string().uuid(),
          /** The `test_option` step that tested the option, e.g. "s4". */
          step: z.string().regex(/^s\d{1,3}$/),
          signalTypeId: z.string().uuid(),
          /** What the person calls it. The option's own label when left out. */
          label: z.string().trim().min(1).max(200).nullable().default(null),
          /** Who may approve it, in words: a role, not an account. */
          approver: z.string().trim().max(200).nullable().default(null),
        }),
        response: { 201: z.record(z.unknown()), 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const exchange = await exchangeForDecision(req.db, env.id, req.body.exchangeId);
      const draft = decisionFromExchange(exchange, req.body.step);
      // A kind of signal belongs to an organisation: one of another organisation is not found.
      const kind = (await listSignalTypes(req.db, env.organizationId)).find((t) => t.id === req.body.signalTypeId);
      if (!kind) throw NotFound("SIGNAL_TYPE_NOT_FOUND", "That kind of signal is not defined for this project's organisation.");

      const scenario = exchange.scenarioId ? await getOverlayScenario(req.db, exchange.scenarioId).catch(() => null) : null;
      const response = await insertPreparedResponse(req.db, {
        projectId: env.id,
        signalTypeId: kind.id,
        label: req.body.label || draft.optionLabel,
        approver: req.body.approver || null,
        exchangeId: req.body.exchangeId,
        scenarioId: scenario?.id ?? null,
        scenarioName: scenario?.name ?? "a scenario since deleted",
        // The scenario as it stands when the response is kept: a later edit shows as a different mark.
        scenarioMark: scenario ? scenarioMark(await listOverrides(req.db, scenario.id)) : null,
        testedAt: exchange.askedAt,
        userId,
        draft,
      });
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "prepared_response.keep",
        resourceType: "prepared_response",
        resourceId: response.id,
        metadata: { signalType: kind.key, label: response.label },
      });
      const now = await scenariosNow(req.db, env.id, [response]);
      const at = new Date();
      // Just kept: no signal has opened on it yet, so nothing has tested it again.
      return reply.code(201).send({ ...onCard(response, scenarioOf(now, response), at, liveTest([], at)), signalTypeId: kind.id, signalType: kind.name });
    },
  );

  app.get(
    "/ontology/:env/prepared-responses",
    {
      schema: {
        summary: "The responses prepared in this project, in the order they were kept",
        description:
          "Each response says what it changes, the figures of its test with and without it, what that run rests on " +
          "by level of evidence, what the test does not say, and what the test is worth now: its date, and whether " +
          "the scenario it ran on still exists and still holds the same choices. `live` is the test made again on " +
          "the network as it is when a signal of its kind last opened: its figures, a test still running, or why " +
          "there is none. `signalTypeId` keeps one kind of signal. They are never ranked.",
        tags: ["decisions"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ signalTypeId: z.string().uuid().optional() }),
        response: { 200: z.object({ responses: z.array(z.record(z.unknown())) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const kept = await listPreparedResponses(req.db, env.id, req.query.signalTypeId ?? null);
      const [now, tests] = await Promise.all([scenariosNow(req.db, env.id, kept), retestsOf(req.db, kept.map((r) => r.id))]);
      const at = new Date();
      return {
        responses: kept.map((r) => ({
          ...onCard(r, scenarioOf(now, r), at, liveTest(tests.get(r.id) ?? [], at)),
          signalTypeId: r.signalTypeId,
          signalType: r.signalType,
        })),
      };
    },
  );

  app.delete(
    "/ontology/:env/prepared-responses/:id",
    {
      schema: {
        summary: "Retire a prepared response",
        description: "It is no longer offered on a situation card. It is retired, not erased: decisions that engaged it still read.",
        tags: ["decisions"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ retired: z.boolean() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await retirePreparedResponse(req.db, env.id, req.params.id);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "prepared_response.retire",
        resourceType: "prepared_response",
        resourceId: req.params.id,
        metadata: {},
      });
      return { retired: true };
    },
  );

  app.post(
    "/ontology/:env/signals/:id/engage",
    {
      schema: {
        summary: "Engage a prepared response on a signal",
        description:
          "One click, three records. A decision is recorded, tied to the signal, with the figures expected of the " +
          "response (those of its test; when the response was tested again on the network as it is, those figures " +
          "are recorded beside them as `expected.retested`, with their date). The signal's trail says which response was taken, by whom, and how " +
          "long after the signal was raised (`secondsSinceRaised`). And the " +
          "signal moves to its next stage; when that stage requires an approval, the person engaging is the one " +
          "named as approving. Refused before anything is written when the signal is closed or at its last stage, " +
          "or when the response was prepared for another kind of signal. Nothing is triggered in any other system: " +
          "this records and follows.",
        tags: ["decisions"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({
          responseId: z.string().uuid(),
          note: z.string().trim().max(1000).nullable().default(null),
        }),
        response: { 201: z.record(z.unknown()), 400: errorEnvelope, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const found = await getSignal(req.db, req.params.id);
      if (found.projectId !== env.id) throw NotFound("SIGNAL_NOT_FOUND", "That signal is not in this project.");
      const response = await getPreparedResponse(req.db, env.id, req.body.responseId);
      if (response.signalTypeId !== found.signalTypeId) {
        throw BadRequest("RESPONSE_FOR_ANOTHER_KIND", `“${response.label}” was prepared for “${response.signalType}”, not for this kind of signal.`);
      }
      // Every refusal comes before the first line: the trail cannot be unwritten.
      const { signal, next } = await stageAhead(req.db, found.id);
      // What the card showed beside the kept test, if the engine had tested the response again.
      const at = new Date();
      const live = liveTest((await retestsOf(req.db, [response.id])).get(response.id) ?? [], at);
      const expected = expectedOnEngage(response.expected, live);

      const decision = await insertDecision(req.db, {
        projectId: env.id,
        scenarioId: response.scenarioId,
        scenarioName: response.scenarioName,
        exchangeId: response.exchangeId,
        userId,
        note: req.body.note || null,
        draft: {
          objective: response.objective,
          optionStep: response.optionStep,
          optionLabel: response.label,
          optionStamps: response.optionStamps,
          expected,
          sourceSteps: response.sourceSteps,
        },
        signalId: signal.id,
        preparedResponseId: response.id,
      });
      await recordOptionTaken(req.db, signal.id, {
        actorUserId: userId,
        fromStageId: signal.stageId,
        note: `Engaged the prepared response “${response.label}”.`,
        payload: {
          decisionId: decision.id,
          preparedResponseId: response.id,
          // How long after the signal was raised the decision came: kept on the trail, which nothing rewrites.
          secondsSinceRaised: Math.max(0, Math.round((Date.parse(decision.decidedAt) - Date.parse(signal.detectedAt)) / 1000)),
        },
      });
      const moved = await moveSignal(req.db, signal.id, "forward", { actorUserId: userId, note: req.body.note || null });
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "signal.engage",
        resourceType: "signal",
        resourceId: signal.id,
        metadata: { decisionId: decision.id, preparedResponseId: response.id, stageId: moved.stageId },
      });
      return reply.code(201).send({
        decision,
        signal: moved,
        stage: { name: next.name, needsApproval: next.requiresApproval, closes: next.isTerminal },
        // The person who engaged, by name: when the stage needed an approval, this is who gave it.
        by: decision.decidedBy,
      });
    },
  );
};

export default preparedRoutes;
