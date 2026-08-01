import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  addOverride,
  createOverlayScenario,
  deleteOverride,
  getOverlayScenario,
  listOverlayScenarios,
  listOverrides,
  resolveOverrides,
  scenarioChain,
  validateOverrides,
} from "../services/scenario-overrides.js";

// ---------------------------------------------------------------------------
// Scenario overlays: the edits a scenario proposes, and what they resolve to.
//
// Separate from the existing /scenarios routes, which drive the copy-based
// simulation. Both run until reads can resolve overrides.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const overrideOut = z.object({
  id: z.string(),
  scenarioId: z.string(),
  seq: z.number(),
  targetType: z.enum(["instance", "link", "param"]),
  targetId: z.string().nullable(),
  targetLocalKey: z.string().nullable(),
  op: z.enum(["create", "set_property", "delete", "link", "unlink", "set_param"]),
  payload: z.record(z.unknown()),
  effectiveOffsetHours: z.number(),
  durationHours: z.number().nullable(),
  note: z.string().nullable(),
});

const scenarioOut = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  parentScenarioId: z.string().nullable(),
  baseAsOf: z.string().nullable(),
  status: z.enum(["draft", "ready", "submitted", "archived"]),
  createdAt: z.string(),
});

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

const scenarioOverrideRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/overlay-scenarios",
    {
      schema: {
        summary: "Overlay scenarios in a project",
        tags: ["scenarios"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            scenarios: z.array(scenarioOut.extend({ overrideCount: z.number() })),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { scenarios: await listOverlayScenarios(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/overlay-scenarios",
    {
      schema: {
        summary: "Create an overlay scenario (optionally branching from another)",
        tags: ["scenarios"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          parentScenarioId: z.string().uuid().optional(),
          baseAsOf: z.string().datetime().optional(),
        }),
        response: { 201: scenarioOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const org = await req.db.query<{ organization_id: string }>(
        `SELECT organization_id FROM app.project WHERE id = $1`,
        [env.id],
      );
      const s = await createOverlayScenario(req.db, {
        projectId: env.id,
        organizationId: org.rows[0]!.organization_id,
        name: req.body.name,
        description: req.body.description ?? null,
        parentScenarioId: req.body.parentScenarioId ?? null,
        baseAsOf: req.body.baseAsOf ?? null,
        ownerUserId: userId,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "scenario.create",
        resourceType: "scenario",
        resourceId: s.id,
        metadata: { name: s.name, parent: s.parentScenarioId },
      });
      return reply.code(201).send(s);
    },
  );

  app.get(
    "/overlay-scenarios/:id",
    {
      schema: {
        summary: "Read a scenario with its inheritance chain",
        tags: ["scenarios"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ scenario: scenarioOut, chain: z.array(scenarioOut) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      return {
        scenario: await getOverlayScenario(req.db, req.params.id),
        chain: await scenarioChain(req.db, req.params.id),
      };
    },
  );

  app.get(
    "/overlay-scenarios/:id/overrides",
    {
      schema: {
        summary: "The scenario's own edits, with any problems in them",
        tags: ["scenarios"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            overrides: z.array(overrideOut),
            issues: z.array(z.object({ overrideId: z.string().nullable(), message: z.string() })),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const overrides = await listOverrides(req.db, req.params.id);
      return { overrides, issues: validateOverrides(overrides) };
    },
  );

  app.post(
    "/overlay-scenarios/:id/overrides",
    {
      schema: {
        summary: "Add an edit to a scenario",
        tags: ["scenarios"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          targetType: z.enum(["instance", "link", "param"]),
          targetId: z.string().uuid().nullable().optional(),
          targetLocalKey: z.string().min(1).nullable().optional(),
          op: z.enum(["create", "set_property", "delete", "link", "unlink", "set_param"]),
          payload: z.record(z.unknown()).default({}),
          effectiveOffsetHours: z.number().int().min(0).default(0),
          durationHours: z.number().int().min(1).nullable().optional(),
          note: z.string().max(500).nullable().optional(),
        }),
        response: { 201: overrideOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const s = await getOverlayScenario(req.db, req.params.id);
      const o = await addOverride(req.db, req.params.id, {
        targetType: req.body.targetType,
        targetId: req.body.targetId ?? null,
        targetLocalKey: req.body.targetLocalKey ?? null,
        op: req.body.op,
        payload: req.body.payload,
        effectiveOffsetHours: req.body.effectiveOffsetHours,
        durationHours: req.body.durationHours ?? null,
        note: req.body.note ?? null,
      });
      await recordAudit(req.db, {
        projectId: s.projectId,
        actorUserId: userId,
        action: "scenario.override.add",
        resourceType: "scenario",
        resourceId: s.id,
        metadata: { op: o.op, offset: o.effectiveOffsetHours },
      });
      return reply.code(201).send(o);
    },
  );

  app.delete(
    "/overlay-scenarios/:id/overrides/:overrideId",
    {
      schema: {
        summary: "Remove an edit",
        tags: ["scenarios"],
        params: z.object({ id: z.string().uuid(), overrideId: z.string().uuid() }),
        response: { 200: z.object({ deleted: z.boolean() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      await requireUserId(req);
      await deleteOverride(req.db, req.params.overrideId);
      return { deleted: true };
    },
  );

  // What the scenario actually amounts to at a point in its timeline —
  // inherited edits included, expired ones dropped. This is what reads will
  // consume once resolution lands, and being able to see it now is how you
  // check a scenario says what you think it says.
  app.get(
    "/overlay-scenarios/:id/resolve",
    {
      schema: {
        summary: "The edits in effect at a point in the scenario's timeline",
        tags: ["scenarios"],
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          atOffsetHours: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            atOffsetHours: z.number(),
            chain: z.array(z.string()),
            overrides: z.array(overrideOut),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const chain = await scenarioChain(req.db, req.params.id);
      return {
        atOffsetHours: req.query.atOffsetHours,
        chain: chain.map((s) => s.name),
        overrides: await resolveOverrides(req.db, req.params.id, req.query.atOffsetHours),
      };
    },
  );
};

export default scenarioOverrideRoutes;
