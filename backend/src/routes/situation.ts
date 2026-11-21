import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { listDecisionsForSignalType } from "../services/decisions.js";
import { readLive, signalsById } from "../services/live-reading.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import { listPreparedResponses, onCard, scenarioOf, scenariosNow } from "../services/prepared-responses.js";
import { liveTest, retestsOf } from "../services/response-retest.js";
import { stagesForSignal } from "../services/signals.js";
import { decisionOnCard, situationOf, type PreparedForKind } from "../services/situation.js";

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

const situationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/situation",
    {
      schema: {
        summary: "The situation card of a unit, an alert or a signal",
        description:
          "What a person needs when an alert or a signal asks for attention, in one reading and without the language model: " +
          "the unit's live figures as its page shows them, each with its age (or the reason it has none), the alert it was " +
          "opened from, where the signal stands in its workflow, and a question already written for the analyst. Name at " +
          "least one of `unit`, `alert`, `signal`; an alert or a signal brings its unit. The figures are the ones the " +
          "analyst's `unit_now` and `list_alerts` give, from the same reading. When a signal is named, the card also " +
          "carries the responses prepared for its kind, each with the figures of its test and what that test is " +
          "worth now, whether one can be engaged, and the decisions already taken on signals of that kind. Each " +
          "response also says what the engine made of it on the network as it is (`live`): when the signal opened, " +
          "the server tested it again behind, and the card shows that result once it is there, a test still " +
          "running, or why there is none. An engine that cannot be reached leaves the card whole. " +
          "Reality only; nothing is written.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          unit: z.string().uuid().optional(),
          alert: z.string().uuid().optional(),
          signal: z.string().uuid().optional(),
        }),
        response: { 200: z.record(z.unknown()), 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { unit, alert, signal } = req.query;
      if (!unit && !alert && !signal) {
        throw BadRequest("NOTHING_NAMED", "Name a unit, an alert or a signal: ?unit=, ?alert= or ?signal=.");
      }

      const live = await readLive(req.db, env);
      // A signal is looked up in this project only: one of another project is not found, whoever asks.
      const found = signal ? ((await signalsById(req.db, env.id, [signal]))[0] ?? null) : null;
      if (signal && !found) throw NotFound("SIGNAL_NOT_FOUND", "That signal is not in this project.");
      if (unit && !live.units.some((u) => u.id === unit)) throw NotFound("UNIT_NOT_FOUND", "That unit is not in this project.");
      const stages = found ? await stagesForSignal(req.db, found.id) : [];

      let prepared: PreparedForKind | null = null;
      if (found) {
        const [kept, decided] = await Promise.all([
          listPreparedResponses(req.db, env.id, found.typeId),
          listDecisionsForSignalType(req.db, env.id, found.typeId),
        ]);
        const [scenarios, tests] = await Promise.all([scenariosNow(req.db, env.id, kept), retestsOf(req.db, kept.map((r) => r.id))]);
        const at = new Date(live.at);
        prepared = {
          responses: kept.map((r) => onCard(r, scenarioOf(scenarios, r), at, liveTest(tests.get(r.id) ?? [], at))),
          decisions: decided.map((d) => decisionOnCard(d, found.id)),
        };
      }

      return {
        ...situationOf(live, { unitId: unit ?? null, alertId: alert ?? null, signalId: signal ?? null }, found, stages, prepared),
        // Whether the question can be asked at all: the card is whole either way.
        analyst: { configured: Boolean(config.anthropicApiKey) },
      };
    },
  );
};

export default situationRoutes;
