import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { startSseStream } from "../lib/sse.js";
import { recordAudit } from "../services/audit.js";
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
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return getTwinTreeSnapshot(req.db, env.id);
    },
  );

  app.get(
    "/ontology/:env/twin/network",
    {
      schema: {
        summary: "Network-level twin: geolocated root sites + typed inter-site flows",
        description:
          "Root units with metrics, alert rollups, and latitude/longitude read from " +
          "instance properties (null when unset), plus flows — link instances that " +
          "connect two sites, classified as patient / supply / data / other.",
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
      return { metrics, alerts, recommendations: alerts.map((a) => a.recommendation).filter(Boolean) };
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
