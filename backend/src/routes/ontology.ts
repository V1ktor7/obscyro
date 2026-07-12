import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, Conflict, NotFound } from "../lib/errors.js";
import { parseWhere } from "../lib/where-filter.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { ensureUserOrganization, resolveOrganizationsForUser } from "../services/organization.js";
import {
  getOrCreateLinkType,
  getOrCreateObjectType,
  resolveEnvironment,
  seedEntityEnvironmentSchema,
  type EnvironmentType,
} from "../services/ontology.js";

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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

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

  // --- Environment-scoped, multi-domain ontology (migration 010) ------------

  const environmentTypeSchema = z.enum(["reference", "entity", "operations"]);

  const environmentOut = z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    type: environmentTypeSchema,
    organizationId: z.string().uuid(),
    organizationName: z.string(),
    createdAt: z.string(),
  });

  const organizationOut = z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    role: z.enum(["owner", "member"]),
    createdAt: z.string(),
  });

  app.get(
    "/ontology/organizations",
    {
      schema: {
        summary: "List organizations the caller belongs to",
        tags: ["ontology"],
        response: { 200: z.object({ organizations: z.array(organizationOut) }) },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const orgs = await resolveOrganizationsForUser(req.db, userId);
      return {
        organizations: orgs.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          role: o.role,
          createdAt: o.createdAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    "/ontology/environments",
    {
      schema: {
        summary: "List ontology environments for the caller's organizations",
        tags: ["ontology"],
        response: { 200: z.object({ environments: z.array(environmentOut) }) },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        slug: string;
        environment_type: EnvironmentType;
        organization_id: string;
        organization_name: string;
        created_at: Date;
      }>(
        `SELECT e.id, e.name, e.slug, e.environment_type, e.organization_id,
                o.name AS organization_name, e.created_at
           FROM app.ontology_environments e
           JOIN app.organization_members om ON om.organization_id = e.organization_id
           JOIN app.organizations o ON o.id = e.organization_id
          WHERE om.user_id = $1
          ORDER BY o.name ASC, e.name ASC`,
        [userId],
      );
      return {
        environments: rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          type: r.environment_type,
          organizationId: r.organization_id,
          organizationName: r.organization_name,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/ontology/environments",
    {
      schema: {
        summary: "Create an ontology environment",
        tags: ["ontology"],
        body: z.object({
          name: z.string().trim().min(1).max(120),
          slug: z.string().trim().min(1).max(64).optional(),
          type: environmentTypeSchema,
        }),
        response: { 201: environmentOut, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const org = await ensureUserOrganization(req.db, userId);
      const slug = slugify(req.body.slug ?? req.body.name);
      if (!slug) {
        throw BadRequest("INVALID_SLUG", "Could not derive a slug from the name.");
      }
      try {
        const { rows } = await req.db.query<{
          id: string;
          name: string;
          slug: string;
          environment_type: EnvironmentType;
          organization_id: string;
          created_at: Date;
        }>(
          `INSERT INTO app.ontology_environments
             (owner_user_id, organization_id, name, slug, environment_type)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, slug, environment_type, organization_id, created_at`,
          [userId, org.id, req.body.name, slug, req.body.type],
        );
        const r = rows[0]!;
        if (req.body.type === "entity") {
          await seedEntityEnvironmentSchema(req.db, r.id);
        }
        return reply.code(201).send({
          id: r.id,
          name: r.name,
          slug: r.slug,
          type: r.environment_type,
          organizationId: r.organization_id,
          organizationName: org.name,
          createdAt: r.created_at.toISOString(),
        });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "23505") {
          throw Conflict("ENV_EXISTS", `Environment "${slug}" already exists.`);
        }
        throw err;
      }
    },
  );

  const objectTypeOut = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    propertySchema: z.array(propertyDef),
    createdAt: z.string(),
  });

  const linkTypeOut = z.object({
    id: z.string().uuid(),
    name: z.string(),
    fromType: z.string(),
    toType: z.string(),
    cardinality: z.string(),
  });

  app.get(
    "/ontology/:env/types",
    {
      schema: {
        summary: "List object types and link types for an environment",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            types: z.array(objectTypeOut),
            linkTypes: z.array(linkTypeOut),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const types = await req.db.query<{
        id: string;
        name: string;
        description: string | null;
        property_schema: unknown;
        created_at: Date;
      }>(
        `SELECT id, name, description, property_schema, created_at
           FROM app.ontology_object_types
          WHERE environment_id = $1
          ORDER BY name ASC`,
        [env.id],
      );
      const links = await req.db.query<{
        id: string;
        name: string;
        from_type: string;
        to_type: string;
        cardinality: string;
      }>(
        `SELECT lt.id, lt.name, ft.name AS from_type, tt.name AS to_type, lt.cardinality
           FROM app.ontology_link_types lt
           JOIN app.ontology_object_types ft ON ft.id = lt.from_type_id
           JOIN app.ontology_object_types tt ON tt.id = lt.to_type_id
          WHERE lt.environment_id = $1
          ORDER BY lt.name ASC`,
        [env.id],
      );
      return {
        types: types.rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          propertySchema: r.property_schema as z.infer<typeof propertyDef>[],
          createdAt: r.created_at.toISOString(),
        })),
        linkTypes: links.rows.map((r) => ({
          id: r.id,
          name: r.name,
          fromType: r.from_type,
          toType: r.to_type,
          cardinality: r.cardinality,
        })),
      };
    },
  );

  const typeSummaryOut = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    propertyCount: z.number().int(),
    instanceCount: z.number().int(),
    dependents: z.number().int(),
    createdAt: z.string(),
  });

  app.get(
    "/ontology/:env/summary",
    {
      schema: {
        summary: "Aggregate counts for an environment (ontology manager landing page)",
        description:
          "One call returning per-object-type instance/dependent counts plus environment totals: object types, link types, properties, instances, and open data-quality flags.",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            totals: z.object({
              objectTypes: z.number().int(),
              linkTypes: z.number().int(),
              properties: z.number().int(),
              instances: z.number().int(),
              openFlags: z.number().int(),
            }),
            types: z.array(typeSummaryOut),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);

      const types = await req.db.query<{
        id: string;
        name: string;
        description: string | null;
        property_count: number;
        instance_count: string;
        created_at: Date;
      }>(
        `SELECT t.id, t.name, t.description,
                COALESCE(jsonb_array_length(t.property_schema), 0) AS property_count,
                COUNT(oi.id) AS instance_count,
                t.created_at
           FROM app.ontology_object_types t
           LEFT JOIN app.ontology_object_instances oi ON oi.object_type_id = t.id
          WHERE t.environment_id = $1
          GROUP BY t.id
          ORDER BY t.name ASC`,
        [env.id],
      );

      const links = await req.db.query<{ from_type_id: string; to_type_id: string }>(
        `SELECT from_type_id, to_type_id
           FROM app.ontology_link_types
          WHERE environment_id = $1`,
        [env.id],
      );

      const flags = await req.db.query<{ count: string }>(
        `SELECT COUNT(*) AS count
           FROM app.data_quality_flag
          WHERE environment_id = $1 AND status = 'open'`,
        [env.id],
      );

      const dependents = new Map<string, number>();
      for (const l of links.rows) {
        dependents.set(l.from_type_id, (dependents.get(l.from_type_id) ?? 0) + 1);
        if (l.to_type_id !== l.from_type_id) {
          dependents.set(l.to_type_id, (dependents.get(l.to_type_id) ?? 0) + 1);
        }
      }

      const typeSummaries = types.rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        propertyCount: r.property_count,
        instanceCount: Number(r.instance_count),
        dependents: dependents.get(r.id) ?? 0,
        createdAt: r.created_at.toISOString(),
      }));

      return {
        totals: {
          objectTypes: typeSummaries.length,
          linkTypes: links.rows.length,
          properties: typeSummaries.reduce((sum, t) => sum + t.propertyCount, 0),
          instances: typeSummaries.reduce((sum, t) => sum + t.instanceCount, 0),
          openFlags: Number(flags.rows[0]?.count ?? 0),
        },
        types: typeSummaries,
      };
    },
  );

  app.get(
    "/ontology/:env/types/:name",
    {
      schema: {
        summary: "Get a single object type by name",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), name: z.string().min(1) }),
        response: { 200: objectTypeOut, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        description: string | null;
        property_schema: unknown;
        created_at: Date;
      }>(
        `SELECT id, name, description, property_schema, created_at
           FROM app.ontology_object_types
          WHERE environment_id = $1 AND name = $2`,
        [env.id, req.params.name],
      );
      const r = rows[0];
      if (!r) throw NotFound("TYPE_NOT_FOUND", `Object type "${req.params.name}" not found.`);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        propertySchema: r.property_schema as z.infer<typeof propertyDef>[],
        createdAt: r.created_at.toISOString(),
      };
    },
  );

  const instanceOut = z.object({
    id: z.string().uuid(),
    typeId: z.string().uuid(),
    typeName: z.string(),
    properties: z.record(z.unknown()),
    provenance: z.record(z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  app.get(
    "/ontology/:env/objects",
    {
      schema: {
        summary: "Query object instances with a context-envelope filter",
        description:
          "Lists instances in the environment. `where` accepts comma-separated key:value pairs matched against instance properties (e.g. `assertion:affirmed,subject:patient`) — the structured query a plain code store cannot do.",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          type: z.string().min(1).optional(),
          where: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: {
          200: z.object({ objects: z.array(instanceOut) }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const wherePairs = parseWhere(req.query.where);

      const params: unknown[] = [env.id];
      let sql = `SELECT oi.id, oi.object_type_id, t.name AS type_name,
                        oi.properties, oi.provenance, oi.created_at, oi.updated_at
                   FROM app.ontology_object_instances oi
                   JOIN app.ontology_object_types t ON t.id = oi.object_type_id
                  WHERE t.environment_id = $1`;
      if (req.query.type) {
        params.push(req.query.type);
        sql += ` AND t.name = $${params.length}`;
      }
      for (const [key, value] of wherePairs) {
        params.push(key);
        const keyParam = params.length;
        params.push(value);
        const valueParam = params.length;
        sql += ` AND oi.properties ->> $${keyParam} = $${valueParam}`;
      }
      params.push(req.query.limit);
      sql += ` ORDER BY oi.created_at DESC LIMIT $${params.length}`;

      const { rows } = await req.db.query<{
        id: string;
        object_type_id: string;
        type_name: string;
        properties: Record<string, unknown>;
        provenance: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
      }>(sql, params);

      return {
        objects: rows.map((r) => ({
          id: r.id,
          typeId: r.object_type_id,
          typeName: r.type_name,
          properties: r.properties,
          provenance: r.provenance,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
      };
    },
  );

  app.get(
    "/ontology/:env/objects/:id",
    {
      schema: {
        summary: "Get an object instance with its linked instances",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: {
          200: z.object({
            object: instanceOut,
            links: z.array(
              z.object({
                id: z.string().uuid(),
                linkType: z.string(),
                direction: z.enum(["out", "in"]),
                otherId: z.string().uuid(),
                otherType: z.string(),
                otherProperties: z.record(z.unknown()),
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
      const objRes = await req.db.query<{
        id: string;
        object_type_id: string;
        type_name: string;
        properties: Record<string, unknown>;
        provenance: Record<string, unknown>;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT oi.id, oi.object_type_id, t.name AS type_name,
                oi.properties, oi.provenance, oi.created_at, oi.updated_at
           FROM app.ontology_object_instances oi
           JOIN app.ontology_object_types t ON t.id = oi.object_type_id
          WHERE oi.id = $1 AND t.environment_id = $2`,
        [req.params.id, env.id],
      );
      const obj = objRes.rows[0];
      if (!obj) throw NotFound("OBJECT_NOT_FOUND", "Object not found.");

      const linkRes = await req.db.query<{
        id: string;
        link_name: string;
        direction: "out" | "in";
        other_id: string;
        other_type: string;
        other_props: Record<string, unknown>;
      }>(
        `SELECT li.id,
                lt.name AS link_name,
                CASE WHEN li.from_instance_id = $1 THEN 'out' ELSE 'in' END AS direction,
                other.id AS other_id,
                ot.name AS other_type,
                other.properties AS other_props
           FROM app.ontology_link_instances li
           JOIN app.ontology_link_types lt
             ON lt.id = li.link_type_id AND lt.environment_id = $2
           JOIN app.ontology_object_instances other
             ON other.id = CASE WHEN li.from_instance_id = $1
                                THEN li.to_instance_id ELSE li.from_instance_id END
           JOIN app.ontology_object_types ot ON ot.id = other.object_type_id
          WHERE li.from_instance_id = $1 OR li.to_instance_id = $1
          ORDER BY li.created_at DESC`,
        [req.params.id, env.id],
      );

      return {
        object: {
          id: obj.id,
          typeId: obj.object_type_id,
          typeName: obj.type_name,
          properties: obj.properties,
          provenance: obj.provenance,
          createdAt: obj.created_at.toISOString(),
          updatedAt: obj.updated_at.toISOString(),
        },
        links: linkRes.rows.map((r) => ({
          id: r.id,
          linkType: r.link_name,
          direction: r.direction,
          otherId: r.other_id,
          otherType: r.other_type,
          otherProperties: r.other_props,
        })),
      };
    },
  );

  app.post(
    "/ontology/:env/objects",
    {
      schema: {
        summary: "Create an object instance in an environment",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          type: z.string().trim().min(1),
          properties: z.record(z.unknown()).default({}),
          provenance: z.record(z.unknown()).optional(),
        }),
        response: { 201: z.object({ id: z.string().uuid() }), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const typeRes = await req.db.query<{ id: string }>(
        `SELECT id FROM app.ontology_object_types WHERE environment_id = $1 AND name = $2`,
        [env.id, req.body.type],
      );
      const typeId = typeRes.rows[0]?.id;
      if (!typeId) throw NotFound("TYPE_NOT_FOUND", `Object type "${req.body.type}" not found.`);

      const inserted = await req.db.query<{ id: string }>(
        `INSERT INTO app.ontology_object_instances (object_type_id, properties, provenance)
         VALUES ($1, $2::jsonb, $3::jsonb)
         RETURNING id`,
        [
          typeId,
          JSON.stringify(req.body.properties),
          JSON.stringify(req.body.provenance ?? { source: "api" }),
        ],
      );
      return reply.code(201).send({ id: inserted.rows[0]!.id });
    },
  );

  app.post(
    "/ontology/:env/links",
    {
      schema: {
        summary: "Create a link between two object instances",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          linkType: z.string().trim().min(1),
          fromId: z.string().uuid(),
          toId: z.string().uuid(),
          provenance: z.record(z.unknown()).optional(),
        }),
        response: {
          201: z.object({ id: z.string().uuid() }),
          404: errorEnvelope,
          409: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);

      const linkRes = await req.db.query<{ id: string }>(
        `SELECT id FROM app.ontology_link_types WHERE environment_id = $1 AND name = $2`,
        [env.id, req.body.linkType],
      );
      const linkTypeId = linkRes.rows[0]?.id;
      if (!linkTypeId) {
        throw NotFound("LINK_TYPE_NOT_FOUND", `Link type "${req.body.linkType}" not found.`);
      }

      // Both endpoints must be instances within this environment.
      const endpoints = await req.db.query<{ id: string }>(
        `SELECT oi.id
           FROM app.ontology_object_instances oi
           JOIN app.ontology_object_types t ON t.id = oi.object_type_id
          WHERE t.environment_id = $1 AND oi.id = ANY($2::uuid[])`,
        [env.id, [req.body.fromId, req.body.toId]],
      );
      if (endpoints.rowCount !== new Set([req.body.fromId, req.body.toId]).size) {
        throw NotFound("INSTANCE_NOT_FOUND", "from/to instance not found in this environment.");
      }

      try {
        const inserted = await req.db.query<{ id: string }>(
          `INSERT INTO app.ontology_link_instances (link_type_id, from_instance_id, to_instance_id, provenance)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id`,
          [
            linkTypeId,
            req.body.fromId,
            req.body.toId,
            JSON.stringify(req.body.provenance ?? { source: "api" }),
          ],
        );
        return reply.code(201).send({ id: inserted.rows[0]!.id });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "23505") {
          throw Conflict("LINK_EXISTS", "This link already exists.");
        }
        throw err;
      }
    },
  );

  // --- Manager CRUD: object types, link types, instances --------------------

  app.post(
    "/ontology/:env/types",
    {
      schema: {
        summary: "Create an object type in an environment",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().trim().min(1).max(120),
          description: z.string().trim().max(500).optional(),
          propertySchema: z.array(propertyDef).default([]),
        }),
        response: { 201: objectTypeOut, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);

      const existing = await req.db.query(
        `SELECT 1 FROM app.ontology_object_types WHERE environment_id = $1 AND name = $2`,
        [env.id, req.body.name],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw Conflict("TYPE_EXISTS", `Object type "${req.body.name}" already exists.`);
      }

      const typeId = await getOrCreateObjectType(
        req.db,
        env.id,
        req.body.name,
        req.body.description ?? null,
        req.body.propertySchema,
      );
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        description: string | null;
        property_schema: unknown;
        created_at: Date;
      }>(
        `SELECT id, name, description, property_schema, created_at
           FROM app.ontology_object_types WHERE id = $1`,
        [typeId],
      );
      const r = rows[0]!;
      return reply.code(201).send({
        id: r.id,
        name: r.name,
        description: r.description,
        propertySchema: r.property_schema as z.infer<typeof propertyDef>[],
        createdAt: r.created_at.toISOString(),
      });
    },
  );

  app.patch(
    "/ontology/:env/types/:name",
    {
      schema: {
        summary: "Update an object type's description and property schema",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), name: z.string().min(1) }),
        body: z.object({
          description: z.string().trim().max(500).nullable().optional(),
          propertySchema: z.array(propertyDef).optional(),
        }),
        response: { 200: objectTypeOut, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const { rows } = await req.db.query<{
        id: string;
        name: string;
        description: string | null;
        property_schema: unknown;
        created_at: Date;
      }>(
        `UPDATE app.ontology_object_types
            SET description = COALESCE($3, description),
                property_schema = COALESCE($4::jsonb, property_schema)
          WHERE environment_id = $1 AND name = $2
          RETURNING id, name, description, property_schema, created_at`,
        [
          env.id,
          req.params.name,
          req.body.description ?? null,
          req.body.propertySchema ? JSON.stringify(req.body.propertySchema) : null,
        ],
      );
      const r = rows[0];
      if (!r) throw NotFound("TYPE_NOT_FOUND", `Object type "${req.params.name}" not found.`);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        propertySchema: r.property_schema as z.infer<typeof propertyDef>[],
        createdAt: r.created_at.toISOString(),
      };
    },
  );

  app.delete(
    "/ontology/:env/types/:name",
    {
      schema: {
        summary: "Delete an object type (cascades its instances)",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), name: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await req.db.query(
        `DELETE FROM app.ontology_object_types WHERE environment_id = $1 AND name = $2`,
        [env.id, req.params.name],
      );
      if (result.rowCount === 0) {
        throw NotFound("TYPE_NOT_FOUND", `Object type "${req.params.name}" not found.`);
      }
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/link-types",
    {
      schema: {
        summary: "Create a link type (relationship) between two object types",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          name: z.string().trim().min(1).max(120),
          fromType: z.string().trim().min(1),
          toType: z.string().trim().min(1),
          cardinality: z
            .enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"])
            .default("many_to_many"),
        }),
        response: { 201: linkTypeOut, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);

      const typeRows = await req.db.query<{ id: string; name: string }>(
        `SELECT id, name FROM app.ontology_object_types
          WHERE environment_id = $1 AND name = ANY($2::text[])`,
        [env.id, [req.body.fromType, req.body.toType]],
      );
      const byName = new Map(typeRows.rows.map((t) => [t.name, t.id]));
      const fromId = byName.get(req.body.fromType);
      const toId = byName.get(req.body.toType);
      if (!fromId || !toId) {
        throw NotFound("TYPE_NOT_FOUND", "from/to object type not found in this environment.");
      }

      const existing = await req.db.query(
        `SELECT 1 FROM app.ontology_link_types WHERE environment_id = $1 AND name = $2`,
        [env.id, req.body.name],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw Conflict("LINK_TYPE_EXISTS", `Link type "${req.body.name}" already exists.`);
      }

      const linkTypeId = await getOrCreateLinkType(
        req.db,
        env.id,
        req.body.name,
        fromId,
        toId,
        req.body.cardinality,
      );
      return reply.code(201).send({
        id: linkTypeId,
        name: req.body.name,
        fromType: req.body.fromType,
        toType: req.body.toType,
        cardinality: req.body.cardinality,
      });
    },
  );

  app.delete(
    "/ontology/:env/link-types/:name",
    {
      schema: {
        summary: "Delete a link type (cascades its link instances)",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), name: z.string().min(1) }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await req.db.query(
        `DELETE FROM app.ontology_link_types WHERE environment_id = $1 AND name = $2`,
        [env.id, req.params.name],
      );
      if (result.rowCount === 0) {
        throw NotFound("LINK_TYPE_NOT_FOUND", `Link type "${req.params.name}" not found.`);
      }
      return { ok: true as const };
    },
  );

  app.patch(
    "/ontology/:env/objects/:id",
    {
      schema: {
        summary: "Update an object instance's properties",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({ properties: z.record(z.unknown()) }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await req.db.query(
        `UPDATE app.ontology_object_instances oi
            SET properties = $1::jsonb, updated_at = NOW()
           FROM app.ontology_object_types t
          WHERE oi.object_type_id = t.id
            AND t.environment_id = $2
            AND oi.id = $3`,
        [JSON.stringify(req.body.properties), env.id, req.params.id],
      );
      if (result.rowCount === 0) {
        throw NotFound("OBJECT_NOT_FOUND", "Object not found in this environment.");
      }
      return { ok: true as const };
    },
  );

  app.delete(
    "/ontology/:env/objects/:id",
    {
      schema: {
        summary: "Delete an object instance",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await req.db.query(
        `DELETE FROM app.ontology_object_instances oi
          USING app.ontology_object_types t
          WHERE oi.object_type_id = t.id
            AND t.environment_id = $1
            AND oi.id = $2`,
        [env.id, req.params.id],
      );
      if (result.rowCount === 0) {
        throw NotFound("OBJECT_NOT_FOUND", "Object not found in this environment.");
      }
      return { ok: true as const };
    },
  );

  app.delete(
    "/ontology/:env/links/:id",
    {
      schema: {
        summary: "Delete a link instance between two objects",
        tags: ["ontology"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await req.db.query(
        `DELETE FROM app.ontology_link_instances li
          USING app.ontology_link_types lt
          WHERE li.link_type_id = lt.id
            AND lt.environment_id = $1
            AND li.id = $2`,
        [env.id, req.params.id],
      );
      if (result.rowCount === 0) {
        throw NotFound("LINK_NOT_FOUND", "Link not found in this environment.");
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
