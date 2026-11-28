import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { BACKTEST_DAYS, BACKTEST_DAYS_MAX, backtestModel, getModel, importModel, listModels, modelDraft, modelOffer, removeModel, verifyModel } from "../services/forecast-models.js";
import { DISPLAY_MIN_STEPS, DISPLAY_WINDOW_DAYS, TRIAL_AFTER_MINUTES, TRIAL_LATE_MINUTES, TRIAL_RHYTHMS, computeStanding, nextRunAt, runTrial, setTrial, shownForecasts } from "../services/forecast-trial.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Imported forecasting models: plugged in, checked, replayed on the past.
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

const key = z.string().regex(/^[a-z][a-z0-9_]{2,47}$/);
const record = z.record(z.unknown());
const asRecord = (v: unknown) => v as Record<string, unknown>;

const forecastModelRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/forecast-models",
    {
      schema: {
        summary: "The forecasting models imported into the project, and what can be imported",
        description:
          "An imported model is one that was trained somewhere else and is plugged into the project: it is shown the " +
          "history the platform keeps and gives back a forecast. `models` lists them with where each one comes from " +
          "(`source`: `reference`, the built-in rule “the same hour a week before”; `service`, an open model served " +
          "by the model service; `endpoint`, an address that speaks the contract), what it forecasts (`metric`, a " +
          "measure of the twin, for `units` or for every unit that carries it), what it is shown (`step`, " +
          "`historySteps`, `horizonSteps`, `companions`, `holdHours`), its `state` (imported, verified, tried, " +
          "on_trial), its last replay on the past (`backtest`) and its last failure (`lastError`). `offer` says what " +
          "a model can be given: the measures that have readings, the series declared on datasets with their " +
          "entities, what the calendar knows ahead, and whether the model service is configured. Without it, " +
          "everything works with the reference, and `offer.service.says` says so. No key is ever listed: " +
          "`endpointKeyEnv` is the name of an environment variable, not its value. Reads only.",
        tags: ["forecast-models"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ models: z.array(record), offer: record }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const [models, offer] = await Promise.all([listModels(req.db, env.id), modelOffer(req.db, env)]);
      return { models: models.map(asRecord), offer: asRecord(offer) };
    },
  );

  app.post(
    "/ontology/:env/forecast-models",
    {
      schema: {
        summary: "Import a forecasting model",
        description:
          "Plugs a model into the project. `source` says where it comes from: `reference` (nothing else to give), " +
          "`service` (with `serviceModel`, the open model the model service serves) or `endpoint` (with " +
          "`endpointUrl`, an https address that speaks the contract, and optionally `endpointKeyEnv`). A key is " +
          "never sent here: `endpointKeyEnv` is the NAME of an environment variable an administrator set on the API, " +
          "and it has to start with MODEL_KEY_. `metric` is a measure of the twin; `units` narrows it to some units. " +
          "`step` is hour or day, `historySteps` how much history the model is shown, `horizonSteps` how far it " +
          "forecasts, `minHistoryDays` the history a unit needs to be sent at all (14 by default), `holdHours` how " +
          "long a value holds when its source goes quiet. `companions` are series shown beside the target: `past` " +
          "(a measure of the twin at the same unit, `twin:<measure>`, or one `entity` of a declared series) or " +
          "`known` (the calendar, `calendar:hour` or `calendar:weekday`, which needs `timeZone`). Everything named " +
          "has to be something the project keeps. The model starts as `imported`: nothing was sent anywhere yet. " +
          "Refused with what to correct. Kept in the audit log.",
        tags: ["forecast-models"],
        params: z.object({ env: z.string().min(1) }),
        body: modelDraft,
        response: { 201: z.object({ model: record }), 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const model = await importModel(req.db, env, userId, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "forecast_model.import",
        resourceType: "forecast_model",
        resourceId: model.key,
        metadata: { label: model.label, source: model.source, metric: model.metric },
      });
      return reply.code(201).send({ model: asRecord(model) });
    },
  );

  app.delete(
    "/ontology/:env/forecast-models/:key",
    {
      schema: {
        summary: "Remove an imported model",
        description: "Removes the model from the project, with its last replay. The series it was shown are not touched. Kept in the audit log.",
        tags: ["forecast-models"],
        params: z.object({ env: z.string().min(1), key }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await removeModel(req.db, env.id, req.params.key);
      await recordAudit(req.db, { actorUserId: userId, projectId: env.id, action: "forecast_model.remove", resourceType: "forecast_model", resourceId: req.params.key, metadata: {} });
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/ontology/:env/forecast-models/:key/verify",
    {
      schema: {
        summary: "Check a model's contract on a sample",
        description:
          "Sends the model a sample, three units as they stand now, and checks what comes back against the contract " +
          "(version 1). The model receives, for each series, its history on a regular grid with its gaps, its " +
          "companion series, the step and the horizon, under opaque labels: never a unit's name or identifier. It " +
          "must give back, for each series and each step of the horizon, a low, a likely and a high value, and " +
          "nothing else. An answer is refused with its reason: a version it does not speak, a series missing or " +
          "unknown, a number of values that is not the horizon, a range out of order, a value the measure cannot " +
          "take. `verification.sent` says what left this server and to where (`to`, `series`, `history`, `horizon`, " +
          "`companions`, `bytes`); `leftOut` lists the units that were not sent, each with its reason (a history " +
          "shorter than the model asks for); `sample` shows the first steps of one forecast. A model that keeps the " +
          "contract becomes `verified`. For the reference nothing leaves the server. Kept in the audit log.",
        tags: ["forecast-models"],
        params: z.object({ env: z.string().min(1), key }),
        response: { 200: z.object({ model: record, verification: record }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const model = await getModel(req.db, env.id, req.params.key);
      const out = await verifyModel(req.db, env, model);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "forecast_model.verify",
        resourceType: "forecast_model",
        resourceId: model.key,
        metadata: { ok: out.verification.ok, to: out.verification.sent.to, series: out.verification.sent.series, bytes: out.verification.sent.bytes },
      });
      return { model: asRecord(out.model), verification: asRecord(out.verification) };
    },
  );

  app.post(
    "/ontology/:env/forecast-models/:key/backtest",
    {
      schema: {
        summary: "Replay a model on the last days",
        description:
          `Replays the model over the last \`days\` days (${BACKTEST_DAYS} by default, ${BACKTEST_DAYS_MAX} at most): one origin a day, at ` +
          "the hour of the last whole step. At each origin the model is sent only what was known at that instant " +
          "(the “as known at” read of the kept series), and its forecast is held against what was measured since, " +
          "beside two rules over the very same steps. `backtest.overall` gives the mean absolute error of the " +
          "model (`model`), of “the same hour a week before” (`reference`) and of “the last value holds” (`held`), " +
          "in the measure's own unit, the number of steps compared (`n`: only steps where the model, both rules " +
          "and the measure all have a value) and the share of measures that fell inside the model's range " +
          "(`inside`); `byHorizon` gives the same for each step of the horizon, and `origins` for each origin. " +
          "`verdict` says whether the model does strictly better than the better of the two rules. " +
          "Nothing is trained, and nothing is kept as a forecast: this is a trial run on the past. A model that " +
          "cannot be reached or breaks the contract stops the replay there (`stopped`) and is not counted as tried; " +
          "a replay that runs past two minutes stops and says how far it got (`partial`). Kept in the audit log.",
        tags: ["forecast-models"],
        params: z.object({ env: z.string().min(1), key }),
        body: z.object({ days: z.number().int().min(1).max(BACKTEST_DAYS_MAX).optional() }).default({}),
        response: { 200: z.object({ model: record, backtest: record }), 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const model = await getModel(req.db, env.id, req.params.key);
      const out = await backtestModel(req.db, env, model, { days: req.body.days });
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "forecast_model.backtest",
        resourceType: "forecast_model",
        resourceId: model.key,
        metadata: { days: out.backtest.days, origins: out.backtest.origins.length, n: out.backtest.overall.n, partial: out.backtest.partial },
      });
      return { model: asRecord(out.model), backtest: asRecord(out.backtest) };
    },
  );

  app.post(
    "/ontology/:env/forecast-models/:key/trial",
    {
      schema: {
        summary: "Put a model on trial, or take it off",
        description:
          "On trial, a model runs at fixed hours and each of its forecasts is frozen: written once, with when it was " +
          "made and what the model said of itself, and never modified afterwards (the database refuses any update of " +
          "a frozen forecast). What the two rules said at the same instant, “the same hour a week before” and “the " +
          "last value holds”, is frozen beside it. `on: true` puts the model on trial; it has to have been replayed " +
          `on the past first. \`everyHours\` is its rhythm (${TRIAL_RHYTHMS.join(", ")}; 6 by default): origins are counted from midnight UTC, ` +
          `and a run happens ${TRIAL_AFTER_MINUTES} minutes after its origin, once the hour's data has arrived. A forecast is never made ` +
          `late: past ${TRIAL_LATE_MINUTES} minutes after an origin it is not made at all, since it would have seen the start of its own ` +
          "horizon; `run.missed` says so, and `nextRunAt` says when the next one is due. `on: false` takes the model " +
          "off trial: what it forecast stays frozen, and it makes no more. `standing` is what the display rule says " +
          `of the model now: its frozen forecasts of the last ${DISPLAY_WINDOW_DAYS} days held against what the twin measured since, the ` +
          `three errors over the same steps, and \`shown\`, true only when the model is on trial, at least ${DISPLAY_MIN_STEPS} of its steps ` +
          "have been measured and its error is strictly under the better of the two rules. The reference is never " +
          "shown as a forecast. Kept in the audit log.",
        tags: ["forecast-models"],
        params: z.object({ env: z.string().min(1), key }),
        body: z.object({ on: z.boolean(), everyHours: z.number().int().min(1).max(24).optional() }),
        response: { 200: z.object({ model: record, run: record.nullable(), standing: record, nextRunAt: z.string().nullable() }), 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const before = await getModel(req.db, env.id, req.params.key);
      let model = await setTrial(req.db, env, before, req.body.on, req.body.everyHours);
      // On trial at once: the forecast for the origin that is due is made now, when it can still be made honestly.
      const run = req.body.on ? await runTrial(req.db, env, model) : null;
      const standing = await computeStanding(req.db, env, model);
      model = await getModel(req.db, env.id, req.params.key);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: req.body.on ? "forecast_model.trial_on" : "forecast_model.trial_off",
        resourceType: "forecast_model",
        resourceId: model.key,
        metadata: { everyHours: model.trialEveryHours, frozen: run?.frozen ?? 0 },
      });
      return {
        model: asRecord(model),
        run: run ? asRecord(run) : null,
        standing: asRecord(standing),
        nextRunAt: req.body.on ? nextRunAt(new Date(), model.step, model.trialEveryHours).toISOString() : null,
      };
    },
  );

  app.get(
    "/ontology/:env/forecasts",
    {
      schema: {
        summary: "The forecasts a screen may show for a unit",
        description:
          "For the unit `unit`, the latest frozen forecast of each model the display rule lets through, and nothing " +
          "for any other. A forecast is not a measurement: each one says which model made it (`model`), when " +
          "(`issuedAt`), for which instant (`origin` is the start of the first step; `low`, `likely` and `high` have " +
          "one value per step after it) and what its record is (`record.overall`: the model's error beside the two " +
          "rules' over the last days, and `record.why`, the sentence of the rule). A model that is not on trial, has " +
          "too few of its forecasts measured, or does not do strictly better than the better of the two rules gives " +
          "nothing here, and neither does the reference: an empty list means no model has earned its place, not " +
          "that nothing is expected to change. Reads only. Aggregate values about a unit, never about a person.",
        tags: ["forecast-models"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ unit: z.string().uuid() }),
        response: { 200: z.object({ forecasts: z.array(record) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { forecasts: (await shownForecasts(req.db, env, req.query.unit)).map(asRecord) };
    },
  );
};

export default forecastModelRoutes;
