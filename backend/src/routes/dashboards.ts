import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { listDatasets } from "../services/datasets.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  addCard,
  createDashboard,
  deleteCard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  moveCard,
  offersForDataset,
  readDashboard,
  renameDashboard,
} from "../services/dashboards.js";

// ---------------------------------------------------------------------------
// Dashboards — a composition of cards over data that already exists.
//
// Nothing here computes anything a dataset does not already say. A card names
// a source and a way of drawing it, and the values are read when the page is
// opened, so a sync that lands at 4pm shows on the board at 4pm without anyone
// editing a card.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const dashboardOut = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  cardCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const cardConfig = z.object({
  x: z.string().nullable().optional(),
  y: z.string().nullable().optional(),
  agg: z.enum(["sum", "avg", "max", "min", "count"]).optional(),
  limit: z.number().int().positive().optional(),
});

const cardOut = z.object({
  id: z.string(),
  dashboardId: z.string(),
  position: z.number(),
  title: z.string(),
  kind: z.enum(["line", "bar", "number", "table"]),
  sourceKind: z.enum(["dataset", "twin", "ontology"]),
  sourceId: z.string(),
  config: cardConfig,
});

const cardWithData = cardOut.extend({
  sourceName: z.string(),
  data: z.object({
    points: z.array(z.object({ label: z.string(), value: z.number() })),
    rows: z.array(z.record(z.unknown())),
    columns: z.array(z.string()),
    rowsRead: z.number(),
    rowsSkipped: z.number(),
    error: z.string().nullable(),
  }),
});

const offersOut = z.object({
  datasetId: z.string(),
  name: z.string(),
  rowCount: z.number(),
  columns: z.array(
    z.object({
      name: z.string(),
      role: z.enum(["time", "quantity", "category", "identifier", "unusable"]),
      filled: z.number(),
      distinct: z.number(),
      reason: z.string(),
    }),
  ),
  offers: z.array(
    z.object({
      kind: z.enum(["line", "bar", "number", "table"]),
      label: z.string(),
      x: z.string().nullable(),
      y: z.string().nullable(),
      why: z.string(),
    }),
  ),
  blocked: z.string().nullable(),
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

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // -------------------------------------------------------------------------
  // What can be drawn

  app.get(
    "/ontology/:env/chartable",
    {
      schema: {
        summary: "Which datasets can be charted, and how",
        description:
          "Reads the values of every dataset in the environment and reports the chart types each one can honestly carry. This is what the card picker shows before a card exists.",
        tags: ["dashboards"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ datasets: z.array(offersOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const datasets = await listDatasets(req.db, env.id);
      const out = [];
      for (const ds of datasets) {
        // One dataset that cannot be read must not empty the whole picker.
        try {
          out.push(await offersForDataset(req.db, ds.id));
        } catch {
          continue;
        }
      }
      return { datasets: out };
    },
  );

  // -------------------------------------------------------------------------
  // Dashboards

  app.get(
    "/ontology/:env/dashboards",
    {
      schema: {
        summary: "List dashboards",
        tags: ["dashboards"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ dashboards: z.array(dashboardOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { dashboards: await listDashboards(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/dashboards",
    {
      schema: {
        summary: "Create a dashboard",
        tags: ["dashboards"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().min(1),
          description: z.string().optional(),
        }),
        response: {
          201: dashboardOut,
          400: errorEnvelope,
          404: errorEnvelope,
          409: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const d = await createDashboard(
        req.db,
        env.id,
        req.body.name,
        req.body.description ?? "",
        userId,
      );
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "dashboard.create",
        resourceType: "dashboard",
        resourceId: d.id,
        metadata: { name: d.name },
      });
      return reply.code(201).send(d);
    },
  );

  app.get(
    "/dashboards/:id",
    {
      schema: {
        summary: "Read a dashboard and its cards, values included",
        description:
          "The values are read now, not stored. A card that names a dataset shows what that dataset holds at this moment.",
        tags: ["dashboards"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ dashboard: dashboardOut, cards: z.array(cardWithData) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const dashboard = await getDashboard(req.db, req.params.id);
      return { dashboard, cards: await readDashboard(req.db, req.params.id) };
    },
  );

  app.patch(
    "/dashboards/:id",
    {
      schema: {
        summary: "Rename a dashboard",
        tags: ["dashboards"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ name: z.string().min(1), description: z.string().optional() }),
        response: { 200: dashboardOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      await requireUserId(req);
      return renameDashboard(req.db, req.params.id, req.body.name, req.body.description ?? "");
    },
  );

  app.delete(
    "/dashboards/:id",
    {
      schema: {
        summary: "Delete a dashboard",
        tags: ["dashboards"],
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const d = await getDashboard(req.db, req.params.id);
      await deleteDashboard(req.db, req.params.id);
      await recordAudit(req.db, {
        projectId: d.projectId,
        actorUserId: userId,
        action: "dashboard.delete",
        resourceType: "dashboard",
        resourceId: d.id,
        metadata: { name: d.name },
      });
      return reply.code(204).send(null);
    },
  );

  // -------------------------------------------------------------------------
  // Cards

  app.post(
    "/dashboards/:id/cards",
    {
      schema: {
        summary: "Add a card",
        tags: ["dashboards"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          title: z.string().min(1),
          kind: z.string().min(1),
          sourceKind: z.string().min(1),
          sourceId: z.string().min(1),
          config: cardConfig.default({}),
        }),
        response: { 201: cardOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      await requireUserId(req);
      await getDashboard(req.db, req.params.id); // 404 before the card is built
      const card = await addCard(req.db, req.params.id, req.body);
      return reply.code(201).send(card);
    },
  );

  app.patch(
    "/dashboards/:id/cards/:cardId",
    {
      schema: {
        summary: "Move a card",
        tags: ["dashboards"],
        params: z.object({ id: z.string().uuid(), cardId: z.string().uuid() }),
        body: z.object({ position: z.number().int() }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      await requireUserId(req);
      await moveCard(req.db, req.params.cardId, req.body.position);
      return reply.code(204).send(null);
    },
  );

  app.delete(
    "/dashboards/:id/cards/:cardId",
    {
      schema: {
        summary: "Remove a card",
        tags: ["dashboards"],
        params: z.object({ id: z.string().uuid(), cardId: z.string().uuid() }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      await requireUserId(req);
      await deleteCard(req.db, req.params.cardId);
      return reply.code(204).send(null);
    },
  );
};

export default dashboardRoutes;
