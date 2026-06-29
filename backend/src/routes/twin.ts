import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { startSseStream } from "../lib/sse.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  ackAlert,
  createAlertRule,
  deleteAlertRule,
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
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);

      startSseStream(req, reply, {
        name: "twin",
        intervalMs: config.twinSseIntervalMs,
        produce: () => getTwinTreeSnapshot(req.db, env.id),
      });
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
