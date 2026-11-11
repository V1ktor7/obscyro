import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { addReference } from "../services/datasets.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import { LAYER_AGGREGATES, LAYER_ROLES } from "../services/property-schema.js";
import { matchColumns, readLayers, writeLayer } from "../services/twin-layers.js";

// ---------------------------------------------------------------------------
// Map layers: add a file to the twin, read it back on the hexes.
//
// The Scenarios map asks three things of the server, in order: which column of
// a file names which of the twin's places (match), make that column a layer
// (write), and what layers there are (read). See services/twin-layers.ts.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

async function requireUserId(req: { apiKey?: { id: string } | null; db: DbClient }): Promise<string> {
  const apiKey = req.apiKey;
  if (!apiKey) throw new AppError("INVALID_API_KEY", "API key required.", 401);
  const userId = await resolveUserIdForApiKey(req.db, apiKey.id);
  if (!userId) throw NotFound("USER_NOT_FOUND", "User not found for API key.");
  return userId;
}

const layerDecl = z.object({
  role: z.enum(LAYER_ROLES),
  aggregate: z.enum(LAYER_AGGREGATES),
  source: z
    .object({
      file: z.string().max(240).optional(),
      column: z.string().max(240).optional(),
      filter: z.string().max(500).optional(),
      datasetId: z.string().uuid().nullable().optional(),
      rows: z.number().int().min(0).optional(),
      loadedAt: z.string().max(40).optional(),
    })
    .optional(),
});

const layerOut = z.object({
  type: z.string(),
  key: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  layer: layerDecl,
  points: z.array(z.tuple([z.number(), z.number(), z.number()])),
  catchments: z.array(z.tuple([z.string(), z.number()])),
  unplaced: z.number().int(),
});

// Fastify's default body limit is 1 MiB; 50,000 rows of a key and a number is
// about 2 MB, and the distinct values of twelve columns can be more.
const LAYER_BODY_LIMIT = 16 * 1024 * 1024;

const twinLayerRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/twin/layers",
    {
      schema: {
        summary: "Every property declared as a map layer, with where each value sits",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ layers: z.array(layerOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { layers: await readLayers(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/twin/layers/match",
    {
      bodyLimit: LAYER_BODY_LIMIT,
      schema: {
        summary: "Find which column of a file names which of the twin's places",
        description:
          "Counts, for each column sent, how many of its distinct values a property of a located " +
          "type (a site with coordinates, or a catchment with a head count) actually holds. " +
          "Best first. Only distinct values are sent, never whole rows.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          columns: z
            .array(z.object({ name: z.string().min(1).max(240), values: z.array(z.string().max(400)).max(20_000) }))
            .min(1)
            .max(20),
        }),
        response: {
          200: z.object({
            placeable: z.number().int(),
            candidates: z.array(
              z.object({
                column: z.string(),
                target: z.enum(["site", "catchment"]),
                type: z.string(),
                property: z.string(),
                matched: z.number().int(),
                distinct: z.number().int(),
                instances: z.number().int(),
                unmatched: z.array(z.string()),
                unmatchedTruncated: z.boolean(),
                examples: z.array(z.string()),
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
      return matchColumns(req.db, env.id, req.body.columns);
    },
  );

  app.post(
    "/ontology/:env/twin/layers",
    {
      bodyLimit: LAYER_BODY_LIMIT,
      schema: {
        summary: "Make a column of a file a map layer on the twin",
        description:
          "In one transaction: declares a numeric property carrying `layer` on the matched type, " +
          "writes each row's value onto the instance it names (combined as declared when several " +
          "rows name the same one), and clears the values of a previous load the file no longer " +
          "has. With `points`, creates a new located type instead, one instance per row.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          label: z.string().trim().min(1).max(80),
          unit: z.string().trim().max(24).optional(),
          layer: layerDecl,
          target: z.discriminatedUnion("mode", [
            z.object({ mode: z.literal("match"), type: z.string().min(1), property: z.string().min(1) }),
            z.object({ mode: z.literal("points"), typeName: z.string().trim().min(1).max(120) }),
          ]),
          rows: z
            .array(
              z.object({
                match: z.string().max(400).nullable().optional(),
                lat: z.number().nullable().optional(),
                lon: z.number().nullable().optional(),
                name: z.string().max(240).nullable().optional(),
                value: z.number().finite(),
              }),
            )
            .min(1)
            .max(50_000),
        }),
        response: {
          201: z.object({
            key: z.string(),
            type: z.string(),
            written: z.number().int(),
            unmatched: z.array(z.string()),
            cleared: z.number().int(),
            replaced: z.boolean(),
          }),
          400: errorEnvelope,
          404: errorEnvelope,
          409: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await writeLayer(req.db, env.id, req.body);
      const datasetId = req.body.layer.source?.datasetId;
      if (datasetId) {
        // The file feeds the type. Recorded now, so lineage shows where a
        // layer's numbers came from without anyone drawing it.
        const t = await req.db.query<{ id: string }>(
          `SELECT id FROM app.ontology_object_types
            WHERE organization_id = (SELECT organization_id FROM app.project WHERE id = $1) AND name = $2`,
          [env.id, result.type],
        );
        if (t.rows[0]) {
          await addReference(req.db, { fromType: "dataset", fromId: datasetId, toType: "object_type", toId: t.rows[0].id, kind: "writes" });
        }
      }
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "twin.layer.write",
        resourceType: "project",
        resourceId: env.id,
        metadata: { key: result.key, type: result.type, written: result.written, unmatched: result.unmatched.length },
      });
      return reply.code(201).send(result);
    },
  );
};

export default twinLayerRoutes;
