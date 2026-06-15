import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, Conflict, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";

const propertyDef = z.object({
  key: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  label: z.string().optional(),
});

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const ontologyRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/types",
    {
      schema: {
        summary: "List ontology object types",
        tags: ["ontology"],
        response: {
          200: z.object({
            types: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                description: z.string().nullable(),
                properties: z.array(propertyDef),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        description: string | null;
        properties: unknown;
        created_at: Date;
      }>(
        `SELECT id, name, description, properties, created_at
           FROM app.object_types
          WHERE user_id = $1
          ORDER BY name ASC`,
        [userId],
      );
      return {
        types: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          properties: r.properties as z.infer<typeof propertyDef>[],
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/types",
    {
      schema: {
        summary: "Create an ontology object type",
        tags: ["ontology"],
        body: z.object({
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(500).optional().nullable(),
          properties: z.array(propertyDef).default([]),
        }),
        response: { 201: z.object({ id: z.string().uuid() }), 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      try {
        const inserted = await req.db.query<{ id: string }>(
          `INSERT INTO app.object_types (user_id, name, description, properties)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id`,
          [
            userId,
            req.body.name,
            req.body.description ?? null,
            JSON.stringify(req.body.properties),
          ],
        );
        return reply.code(201).send({ id: inserted.rows[0]!.id });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "23505") {
          throw Conflict("TYPE_EXISTS", `Object type "${req.body.name}" already exists.`);
        }
        throw err;
      }
    },
  );

  app.get(
    "/ontology/objects",
    {
      schema: {
        summary: "List ontology object instances",
        tags: ["ontology"],
        querystring: z.object({
          typeId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            objects: z.array(
              z.object({
                id: z.string().uuid(),
                typeId: z.string().uuid(),
                typeName: z.string(),
                properties: z.record(z.unknown()),
                sourceEventId: z.string().uuid().nullable(),
                createdAt: z.string(),
                updatedAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const params: unknown[] = [userId];
      let sql = `SELECT o.id, o.type_id, t.name AS type_name, o.properties,
                        o.source_event_id, o.created_at, o.updated_at
                   FROM app.objects o
                   JOIN app.object_types t ON t.id = o.type_id
                  WHERE o.user_id = $1`;
      if (req.query.typeId) {
        params.push(req.query.typeId);
        sql += ` AND o.type_id = $${params.length}`;
      }
      sql += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1}`;
      params.push(req.query.limit);

      const { rows } = await req.db.query<{
        id: string;
        type_id: string;
        type_name: string;
        properties: Record<string, unknown>;
        source_event_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>(sql, params);

      return {
        objects: rows.map((r) => ({
          id: r.id,
          typeId: r.type_id,
          typeName: r.type_name,
          properties: r.properties,
          sourceEventId: r.source_event_id,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/objects",
    {
      schema: {
        summary: "Create an ontology object instance",
        tags: ["ontology"],
        body: z.object({
          typeId: z.string().uuid(),
          properties: z.record(z.unknown()),
          sourceEventId: z.string().uuid().optional().nullable(),
        }),
        response: { 201: z.object({ id: z.string().uuid() }), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const typeCheck = await req.db.query(
        `SELECT id FROM app.object_types WHERE id = $1 AND user_id = $2`,
        [req.body.typeId, userId],
      );
      if (typeCheck.rowCount === 0) {
        throw NotFound("TYPE_NOT_FOUND", "Object type not found.");
      }

      const inserted = await req.db.query<{ id: string }>(
        `INSERT INTO app.objects (type_id, user_id, properties, source_event_id)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING id`,
        [
          req.body.typeId,
          userId,
          JSON.stringify(req.body.properties),
          req.body.sourceEventId ?? null,
        ],
      );
      return reply.code(201).send({ id: inserted.rows[0]!.id });
    },
  );

  app.patch(
    "/ontology/objects/:id",
    {
      schema: {
        summary: "Update ontology object properties",
        tags: ["ontology"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ properties: z.record(z.unknown()) }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const result = await req.db.query(
        `UPDATE app.objects
            SET properties = $1::jsonb, updated_at = NOW()
          WHERE id = $2 AND user_id = $3`,
        [JSON.stringify(req.body.properties), req.params.id, userId],
      );
      if (result.rowCount === 0) {
        throw NotFound("OBJECT_NOT_FOUND", "Object not found.");
      }
      return { ok: true as const };
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

export default ontologyRoutes;
