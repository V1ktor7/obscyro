import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import {
  deleteInstanceGeometry,
  listGeometries,
  nearest,
  overlaps,
  setInstanceGeometry,
  spatialAvailable,
  uncovered,
} from "../services/geo.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Shapes, and the questions only a spatial index can answer.
//
// A polygon fits in a JSONB property already. What does not fit is "which of
// these catchment areas overlap", "what is nearest to here", "who is covered by
// nobody" — those are queries, and they need PostGIS.
//
// Every route reports honestly when the extension is missing rather than
// failing: the migration that installs it is conditional, because the API runs
// migrations before it boots and a host without PostGIS would otherwise take
// the whole product down.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/** Loose on purpose: PostGIS validates the shape, and it does it better. */
const geoJson = z.object({
  type: z.string().min(1),
  coordinates: z.unknown(),
});

const shapeOut = z.object({
  instanceId: z.string(),
  instanceName: z.string(),
  objectType: z.string(),
  kind: z.string(),
  geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
  areaM2: z.number(),
  /** Whatever the institution declared on the instance. Never a fixed set. */
  properties: z.record(z.unknown()),
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

const geoRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/geo/capability",
    {
      schema: {
        summary: "Whether this database can store and query shapes",
        description:
          "PostGIS is installed by a conditional migration, so a deployment can " +
          "legitimately be without it. The UI asks here before offering to draw.",
        tags: ["geo"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({ available: z.boolean(), reason: z.string().nullable() }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      await resolveEnvironment(req.db, userId, req.params.env);
      const available = await spatialAvailable(req.db);
      return {
        available,
        reason: available
          ? null
          : "PostGIS is not installed on this database. Shapes can be stored as ordinary properties, but they cannot be intersected or measured.",
      };
    },
  );

  app.get(
    "/ontology/:env/geo/shapes",
    {
      schema: {
        summary: "Shapes attached to this organization's instances",
        tags: ["geo"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ shapes: z.array(shapeOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { shapes: await listGeometries(req.db, env.id) };
    },
  );

  app.put(
    "/ontology/:env/geo/shapes/:instanceId",
    {
      schema: {
        summary: "Attach a shape to an instance, replacing any it had",
        tags: ["geo"],
        params: z.object({ env: z.string().min(1), instanceId: z.string().uuid() }),
        body: z.object({
          // Free text, like a signal's domain: "catchment", "exclusion zone",
          // "corridor" is not a list anyone can close in advance.
          kind: z.string().min(1).max(64).default("perimeter"),
          geometry: geoJson,
        }),
        response: { 200: shapeOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const shape = await setInstanceGeometry(
        req.db,
        env.id,
        req.params.instanceId,
        req.body.kind,
        req.body.geometry,
      );
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "geo.set_shape",
        resourceType: "object_instance",
        resourceId: req.params.instanceId,
        metadata: { kind: shape.kind, areaM2: Math.round(shape.areaM2) },
      });
      return shape;
    },
  );

  app.delete(
    "/ontology/:env/geo/shapes/:instanceId",
    {
      schema: {
        summary: "Remove an instance's shape",
        tags: ["geo"],
        params: z.object({ env: z.string().min(1), instanceId: z.string().uuid() }),
        response: { 200: z.object({ deleted: z.boolean() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const deleted = await deleteInstanceGeometry(req.db, req.params.instanceId);
      if (deleted) {
        await recordAudit(req.db, {
          projectId: env.id,
          actorUserId: userId,
          action: "geo.delete_shape",
          resourceType: "object_instance",
          resourceId: req.params.instanceId,
          metadata: {},
        });
      }
      return { deleted };
    },
  );

  app.get(
    "/ontology/:env/geo/overlaps",
    {
      schema: {
        summary: "Which shapes overlap which, and by how much",
        description:
          "Each pair once. Shapes that only share an edge are left out — PostGIS " +
          "reports those as an intersection of zero area, and a report full of " +
          "them hides the real overlaps.",
        tags: ["geo"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ kind: z.string().max(64).optional() }),
        response: {
          200: z.object({
            overlaps: z.array(
              z.object({
                aId: z.string(),
                aName: z.string(),
                bId: z.string(),
                bName: z.string(),
                sharedM2: z.number(),
                sharedOfSmaller: z.number(),
              }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { overlaps: await overlaps(req.db, env.id, req.query.kind) };
    },
  );

  app.get(
    "/ontology/:env/geo/nearest",
    {
      schema: {
        summary: "Shapes nearest a point, in metres",
        tags: ["geo"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          lng: z.coerce.number().min(-180).max(180),
          lat: z.coerce.number().min(-90).max(90),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        }),
        response: {
          200: z.object({
            nearest: z.array(
              z.object({
                instanceId: z.string(),
                name: z.string(),
                objectType: z.string(),
                metres: z.number(),
              }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return {
        nearest: await nearest(req.db, env.id, req.query.lng, req.query.lat, req.query.limit),
      };
    },
  );

  app.get(
    "/ontology/:env/geo/uncovered",
    {
      schema: {
        summary: "Located instances that fall inside no shape",
        description:
          "The coverage question. A site in nobody's catchment is either unserved " +
          "or unmodelled, and both are worth seeing.",
        tags: ["geo"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ kind: z.string().max(64).optional() }),
        response: {
          200: z.object({
            uncovered: z.array(
              z.object({
                instanceId: z.string(),
                name: z.string(),
                objectType: z.string(),
              }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { uncovered: await uncovered(req.db, env.id, req.query.kind) };
    },
  );
};

export default geoRoutes;
