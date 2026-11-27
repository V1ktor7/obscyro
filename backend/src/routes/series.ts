import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import { declareSeries, gridRequest, listSeries, readGrid, removeSeries, seriesDraft, seriesOffer } from "../services/series.js";

// ---------------------------------------------------------------------------
// Kept series: the history a model can read.
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

const seriesRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/series",
    {
      schema: {
        summary: "The series the project keeps: what a model can be shown of the past",
        description:
          "A series is a value followed over time, for one or several entities. Two kinds are listed. `origin: twin`: " +
          "every measure of the twin that has readings (key `twin:<measure>`), one unit being one entity; nothing is " +
          "declared for them. `origin: dataset`: a series declared on a dataset, whose points are written down at every " +
          "write of that dataset. Each line gives its `step` (the source's own: hour, day or week; `change` for a twin " +
          "measure, written down when it changes), its `entities`, its `points`, how many of them were written down " +
          "with no value (`emptyPoints`: an absence that was seen, not a zero), how many were caught up afterwards from " +
          "a kept copy (`replayed`), the earliest and latest instants the points are about (`firstAt`, `lastAt`), when " +
          "the first one was written down here (`keptSince`), and what the last write could not read (`note`). " +
          "`offer` lists the tables a series can be declared on, with their columns. Reads only.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ series: z.array(record), offer: record }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const [series, offer] = await Promise.all([listSeries(req.db, env), seriesOffer(req.db, env.id)]);
      return { series: series as unknown as Record<string, unknown>[], offer: offer as unknown as Record<string, unknown> };
    },
  );

  app.post(
    "/ontology/:env/series",
    {
      schema: {
        summary: "Keep a dataset as a series",
        description:
          "Declares a series on a table dataset of the project: `timeColumn` (when the value was true), `valueColumn`, " +
          "`entityColumns` (the columns that name what the value is about: a region, a site, a virus; none for a " +
          "single entity), `step` (hour, day or week), `unit`, and `timeZone` for a time column that carries no zone " +
          "(an IANA name such as America/Toronto). Every column has to be one the dataset's schema lists. The key is " +
          "made from `label`. The dataset's latest copy is read into the series at once, its points dated at when that " +
          "copy was taken; from then on every write of the dataset is read. `captured` says how many points were " +
          "written and what could not be read: a time with no zone, a time that cannot be read, rows that share an " +
          "entity and a time and disagree. Refused with what to correct. Kept in the audit log.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1) }),
        body: seriesDraft,
        response: { 201: z.object({ series: record, captured: record.nullable() }), 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const out = await declareSeries(req.db, env.id, userId, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "series.declare",
        resourceType: "series",
        resourceId: out.series.key,
        metadata: { label: out.series.label, datasetId: out.series.datasetId, written: out.captured?.written ?? 0 },
      });
      return reply.code(201).send({ series: out.series as unknown as Record<string, unknown>, captured: (out.captured ?? null) as unknown as Record<string, unknown> | null });
    },
  );

  app.delete(
    "/ontology/:env/series/:key",
    {
      schema: {
        summary: "Stop keeping a dataset as a series",
        description:
          "Removes a series declared on a dataset, with the points written down for it. The copies of the dataset are " +
          "not touched: declaring the series again reads the latest one. A measure of the twin is not removed here. " +
          "Kept in the audit log.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1), key }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await removeSeries(req.db, env.id, req.params.key);
      await recordAudit(req.db, { actorUserId: userId, projectId: env.id, action: "series.remove", resourceType: "series", resourceId: req.params.key, metadata: {} });
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/ontology/:env/series/read",
    {
      schema: {
        summary: "Read a series on a regular grid",
        description:
          "Returns a series from `from` to `to`, one value per `step` (hour or day), for the `entities` named (unit " +
          "identifiers for a twin measure, entity names for a dataset series; all of them when left out). `grid` is " +
          "the start of each step. Each value holds until the next point; over a step, `agg` says what is returned: " +
          "`mean` (the average of what was in force, weighted by how long), `max`, or `last` (what was in force when " +
          "the step ends). A step with nothing in force is null: a gap, never a zero, and nothing is known before an " +
          "entity's first point (`firstAt`). With `asOf`, only what had been written down by that instant is used, and " +
          "the stretch cannot end after it: that is how a past forecast is replayed with what was known then. A value " +
          "its source corrected is read as it was known at `asOf`. One read returns 3,000 steps and 300 entities at " +
          "most, and a longer one is refused with what to narrow. Reads only.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1) }),
        body: gridRequest,
        response: { 200: record, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return (await readGrid(req.db, env, req.body)) as unknown as Record<string, unknown>;
    },
  );
};

export default seriesRoutes;
