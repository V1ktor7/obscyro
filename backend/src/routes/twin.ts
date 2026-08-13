import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { startSseStream } from "../lib/sse.js";
import { recordAudit } from "../services/audit.js";
import {
  assertEventMatchesWorld,
  createCrisisEvent,
  deleteCrisisEvent,
  getCrisisEvent,
  listCrisisEvents,
  updateCrisisEvent,
} from "../services/crisis-events.js";
import { buildCrisisExport } from "../services/crisis-export.js";
import { proxyToSimService } from "../services/ml-simulation.js";
import {
  deactivateTwinMetric,
  metricsForRollup,
  upsertTwinMetric,
} from "../services/twin-metrics.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  ackAlert,
  createAlertRule,
  deleteAlertRule,
  getTwinNetwork,
  getTwinTreeSnapshot,
  listAlertRules,
  listOpenAlerts,
  rollupUnit,
  seedTwinDemo,
  unitExchanges,
  updateAlertRule,
  type TwinAlertRuleRow,
} from "../services/twin.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const alertRuleBody = z.object({
  unitKind: z.string().nullable().optional(),
  metric: z.string().min(1),
  op: z.enum(["<", ">", ">=", "<=", "=="]),
  threshold: z.number(),
  severity: z.enum(["info", "warn", "critical"]),
  messageTemplate: z.string().min(1),
  recommendationTemplate: z.string().optional(),
});

const twinRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/twin/tree",
    {
      schema: {
        summary: "OrgUnit tree with rollup metrics and alert severity",
        description:
          "With a scenario, the tree is what the network would be under that " +
          "scenario's edits — the same shape reality has, so the two can be " +
          "read side by side.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          scenarioId: z.string().uuid().optional(),
          atOffsetHours: z.coerce.number().int().min(0).optional(),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.query.scenarioId
        ? { scenarioId: req.query.scenarioId, atOffsetHours: req.query.atOffsetHours ?? 0 }
        : undefined;
      return getTwinTreeSnapshot(req.db, env.id, lens);
    },
  );

  app.get(
    "/ontology/:env/twin/network",
    {
      schema: {
        summary: "Network-level twin: places, what is in them, and the flows between",
        description:
          "Sites are instances of types the institution tagged physical — the tree's " +
          "roots only when nothing is tagged. Each carries the metrics of the units " +
          "placed in it, and `contributingUnits` says which ones, so a number can be " +
          "traced. Flows are link instances between two sites; a flow's lane is its " +
          "link type, with no classification step.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return getTwinNetwork(req.db, env.id);
    },
  );

  app.get(
    "/ontology/:env/twin/crisis-export",
    {
      schema: {
        summary: "The twin as the crisis engine reads it",
        description:
          "Units become facilities, whatever is attached to them becomes capacity or " +
          "census according to the type's declared crisis role, and non-structural " +
          "relationships become routes. Nothing is matched on a name. `gaps` lists " +
          "what the ontology could not answer — routes with no throughput, " +
          "populations with no size, types with no role — so a result is never " +
          "read as if the model knew more than it does. With a scenario, this is " +
          "the network that scenario would produce, so an event can be tested " +
          "against a plan rather than only against today.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          scenarioId: z.string().uuid().optional(),
          atOffsetHours: z.coerce.number().int().min(0).optional(),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.query.scenarioId
        ? { scenarioId: req.query.scenarioId, atOffsetHours: req.query.atOffsetHours ?? 0 }
        : undefined;
      return { ...(await buildCrisisExport(req.db, env.id, req.params.env, lens)) };
    },
  );

  /**
   * `effects` is passed through unvalidated on purpose.
   *
   * The shape belongs to the engine, which already checks it with pydantic and
   * refuses effects aimed at facilities, populations or routes the twin does
   * not contain. Restating that here in zod would create a second definition to
   * keep in agreement, and the copy is always the one that falls behind — a
   * fourth effect kind would then be rejected by the API that knows least
   * about it.
   */
  const crisisEventBody = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    horizon: z.number().int().min(1).max(1000).default(60),
    effects: z.array(z.record(z.unknown())).default([]),
    twinScenarioId: z.string().uuid().nullable().default(null),
  });

  const crisisEventOut = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    horizon: z.number(),
    effects: z.array(z.record(z.unknown())),
    twinScenarioId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  app.get(
    "/ontology/:env/crisis-events",
    {
      schema: {
        summary: "Events composed for this organisation",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({ events: z.array(crisisEventOut) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { events: await listCrisisEvents(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/crisis-events",
    {
      schema: {
        summary: "Compose an event",
        description:
          "An event is a list of effects: demand changes somewhere, a resource " +
          "changes somewhere, a connection changes somewhere. Nothing tests whether " +
          "a change is bad — a capacity multiplier above 1 is a wing opening, and a " +
          "negative demand volume is a vaccination programme.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: crisisEventBody,
        response: { 201: crisisEventOut, 400: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const created = await createCrisisEvent(req.db, env.id, userId, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "crisis.event.create",
        resourceType: "crisis_event",
        resourceId: created.id,
        metadata: { name: created.name, effects: created.effects.length },
      });
      return reply.code(201).send(created);
    },
  );

  app.put(
    "/ontology/:env/crisis-events/:id",
    {
      schema: {
        summary: "Replace a composed event",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: crisisEventBody,
        response: { 200: crisisEventOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const updated = await updateCrisisEvent(req.db, env.id, req.params.id, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "crisis.event.update",
        resourceType: "crisis_event",
        resourceId: updated.id,
        metadata: { name: updated.name, effects: updated.effects.length },
      });
      return updated;
    },
  );

  app.delete(
    "/ontology/:env/crisis-events/:id",
    {
      schema: {
        summary: "Delete a composed event",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await deleteCrisisEvent(req.db, env.id, req.params.id);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "crisis.event.delete",
        resourceType: "crisis_event",
        resourceId: req.params.id,
        metadata: {},
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/twin/crisis-compare",
    {
      schema: {
        summary: "Run named policies against a named crisis on the live twin",
        description:
          "The system comes from the ontology; the crisis and the policies are named " +
          "from the engine's catalogue. Returns one row per policy, worst last, so " +
          "'doing nothing' can be read against the alternatives.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          /** A shipped template. Mutually exclusive with `eventId`. */
          scenario: z.string().min(1).optional(),
          /** An event composed here. Mutually exclusive with `scenario`. */
          eventId: z.string().uuid().optional(),
          policies: z.array(z.string().min(1)).min(1),
          seed: z.number().int().optional(),
          /** Sizes the ontology cannot supply. Empty runs a hollow model. */
          populationSizes: z.record(z.number().nonnegative()).default({}),
          routeCapacity: z.number().nonnegative().default(0),
          /**
           * Twin scenario to read the world through. Named `twinScenarioId`
           * rather than `scenarioId` because `scenario` above already means the
           * event, and two different things called scenario in one body is how
           * a caller ends up sending the wrong one.
           */
          twinScenarioId: z.string().uuid().optional(),
          atOffsetHours: z.number().int().min(0).optional(),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope, 503: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.body.twinScenarioId
        ? {
            scenarioId: req.body.twinScenarioId,
            atOffsetHours: req.body.atOffsetHours ?? 0,
          }
        : undefined;
      if ((req.body.scenario === undefined) === (req.body.eventId === undefined)) {
        throw BadRequest(
          "PICK_ONE_EVENT",
          "Send exactly one of `scenario` (a shipped template) or `eventId` (an event " +
            "composed here).",
        );
      }

      // Resolved before the export so a mismatched event fails on its own terms
      // rather than as a wall of unknown ids from the engine.
      let event: Record<string, unknown> | null = null;
      if (req.body.eventId) {
        const row = await getCrisisEvent(req.db, env.id, req.body.eventId);
        assertEventMatchesWorld(row, lens?.scenarioId ?? null);
        event = {
          id: row.id,
          name: row.name,
          description: row.description,
          horizon: row.horizon,
          perturbations: row.effects,
        };
      }

      const system = await buildCrisisExport(req.db, env.id, req.params.env, lens);
      return proxyToSimService("/crisis/compare", {
        system,
        scenario: req.body.scenario ?? null,
        event,
        policies: req.body.policies,
        seed: req.body.seed ?? null,
        population_sizes: req.body.populationSizes,
        route_capacity: req.body.routeCapacity,
      });
    },
  );

  app.get(
    "/ontology/:env/twin/units/:id",
    {
      schema: {
        summary: "Full unit metrics, open alerts, and recommendations",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const metrics = await rollupUnit(req.db, env.id, req.params.id);
      const alerts = await listOpenAlerts(req.db, env.id, req.params.id, {
        limit: config.listMaxLimit,
      });
      const exchanges = await unitExchanges(req.db, env.id, req.params.id);
      return {
        metrics,
        alerts,
        exchanges,
        recommendations: alerts.map((a) => a.recommendation).filter(Boolean),
      };
    },
  );

  app.get(
    "/ontology/:env/twin/alerts",
    {
      schema: {
        summary: "List open twin alerts (paginated)",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          unitId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(config.listMaxLimit).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
        response: { 200: z.object({ alerts: z.array(z.record(z.unknown())) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const alerts = await listOpenAlerts(req.db, env.id, req.query.unitId, {
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return {
        alerts: alerts.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          ackedAt: a.ackedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.get(
    "/ontology/:env/twin/stream",
    {
      schema: {
        summary: "SSE stream of twin tree rollups and alerts (~5s)",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        // With a scenario the stream shows the world under that scenario's
        // edits, recomputed on the same cadence as reality.
        querystring: z.object({
          scenarioId: z.string().uuid().optional(),
          atOffsetHours: z.coerce.number().int().min(0).optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.query.scenarioId
        ? { scenarioId: req.query.scenarioId, atOffsetHours: req.query.atOffsetHours ?? 0 }
        : undefined;

      startSseStream(req, reply, {
        name: "twin",
        intervalMs: config.twinSseIntervalMs,
        produce: () => getTwinTreeSnapshot(req.db, env.id, lens),
      });
    },
  );

  // --- metric definitions ----------------------------------------------------
  //
  // What the twin displays, and what an alert rule can threshold on, is an
  // organization's own list rather than a fixed one. Occupancy is a seeded row
  // like any other: rename the type it counts, change the status it looks for,
  // or redefine it as admitted patients over beds, and the map, the alerts and
  // the scenarios all follow.

  const metricSelector = z.object({
    ofType: z.string().max(200).nullable().optional(),
    where: z
      .array(z.object({ property: z.string().min(1).max(200), equals: z.string().max(500) }))
      .optional(),
    agg: z.enum(["count", "sum", "mean", "min", "max"]),
    property: z.string().max(200).nullable().optional(),
  });

  const metricOut = z.object({
    id: z.string(),
    organizationId: z.string(),
    key: z.string(),
    label: z.string(),
    objectType: z.string(),
    unit: z.enum(["percent", "ratio", "count", "number"]),
    numerator: metricSelector,
    denominator: metricSelector.nullish(),
    active: z.boolean(),
  });

  app.get(
    "/ontology/:env/twin/metrics",
    {
      schema: {
        summary: "Metric definitions this organization displays on the twin",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ metrics: z.array(metricOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { metrics: await metricsForRollup(req.db, env.organizationId) };
    },
  );

  app.put(
    "/ontology/:env/twin/metrics/:key",
    {
      schema: {
        summary: "Define or redefine a twin metric",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), key: z.string().min(1).max(64) }),
        body: z.object({
          label: z.string().min(1).max(200),
          objectType: z.string().min(1).max(200).default("OrgUnit"),
          unit: z.enum(["percent", "ratio", "count", "number"]),
          numerator: metricSelector,
          denominator: metricSelector.nullable().optional(),
        }),
        response: { 200: metricOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const metric = await upsertTwinMetric(req.db, env.organizationId, {
        key: req.params.key,
        label: req.body.label,
        objectType: req.body.objectType,
        unit: req.body.unit,
        numerator: req.body.numerator,
        denominator: req.body.denominator ?? null,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "twin_metric.upsert",
        resourceType: "twin_metric",
        resourceId: metric.id,
        metadata: { key: metric.key, unit: metric.unit },
      });
      return metric;
    },
  );

  app.delete(
    "/ontology/:env/twin/metrics/:key",
    {
      schema: {
        summary: "Retire a twin metric",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), key: z.string().min(1).max(64) }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const gone = await deactivateTwinMetric(req.db, env.organizationId, req.params.key);
      if (!gone) throw NotFound("METRIC_NOT_FOUND", "No active metric by that key.");
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "twin_metric.retire",
        resourceType: "twin_metric",
        resourceId: req.params.key,
        metadata: { key: req.params.key },
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/twin/alert-rules",
    {
      schema: {
        summary: "Create a twin alert rule",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: alertRuleBody,
        response: { 201: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const rule = await createAlertRule(req.db, env.id, userId, env.organizationId, req.body);
      return reply.code(201).send(serializeAlertRule(rule));
    },
  );

  app.get(
    "/ontology/:env/twin/alert-rules",
    {
      schema: {
        summary: "List twin alert rules",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ rules: z.array(z.record(z.unknown())) }) },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const rules = await listAlertRules(req.db, env.id);
      return { rules: rules.map(serializeAlertRule) };
    },
  );

  app.patch(
    "/ontology/:env/twin/alert-rules/:id",
    {
      schema: {
        summary: "Update a twin alert rule",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: alertRuleBody.partial(),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return serializeAlertRule(await updateAlertRule(req.db, env.id, req.params.id, req.body));
    },
  );

  app.delete(
    "/ontology/:env/twin/alert-rules/:id",
    {
      schema: {
        summary: "Delete a twin alert rule",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await deleteAlertRule(req.db, env.id, req.params.id);
      return { ok: true as const };
    },
  );

  app.patch(
    "/ontology/:env/twin/alerts/:id",
    {
      schema: {
        summary: "Acknowledge a twin alert",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({ status: z.literal("ack") }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await ackAlert(req.db, env.id, req.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/twin/seed-demo",
    {
      schema: {
        summary: "Opt-in DEMO ONLY: seed CHUM twin skeleton (demo OrgUnits + instances). The live twin otherwise builds from real ontology data.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({ unitCount: z.number(), instanceCount: z.number() }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return seedTwinDemo(req.db, env.id, userId, env.organizationId);
    },
  );
};

async function requireUserId(req: {
  apiKey?: { id: string } | null;
  db: DbClient;
}): Promise<string> {
  const apiKey = req.apiKey;
  if (!apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

function serializeAlertRule(rule: TwinAlertRuleRow): Record<string, unknown> {
  return {
    id: rule.id,
    environmentId: rule.environmentId,
    unitKind: rule.unitKind,
    metric: rule.metric,
    op: rule.op,
    threshold: rule.threshold,
    severity: rule.severity,
    messageTemplate: rule.messageTemplate,
    recommendationTemplate: rule.recommendationTemplate,
  };
}

export default twinRoutes;
