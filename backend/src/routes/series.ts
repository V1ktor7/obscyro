import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import { declareSeries, gridRequest, listSeries, readGrid, removeSeries, seriesDraft, seriesOffer } from "../services/series.js";
import { catchupOffer, catchupRequest, forgetCatchup, listCatchups, runCatchup } from "../services/series-catchup.js";

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
/** A declared key, or a measure of the twin: `twin:occupancy`. */
const anyKey = z.string().trim().min(1).max(120);
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
          "`offer` lists the tables a series can be declared on, with their columns. `catchups` lists every catch-up " +
          "from kept copies, by series `key`: the dataset whose copies are read, the pipeline they go through for a " +
          "twin measure, how many copies there are and how many were read, what was written, what was left out, and " +
          "whether it is `done`. Reads only.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ series: z.array(record), offer: record, catchups: z.array(record) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const [series, offer, catchups] = await Promise.all([listSeries(req.db, env), seriesOffer(req.db, env.id), listCatchups(req.db, env.id)]);
      return {
        series: series as unknown as Record<string, unknown>[],
        offer: offer as unknown as Record<string, unknown>,
        catchups: catchups as unknown as Record<string, unknown>[],
      };
    },
  );

  app.get(
    "/ontology/:env/series/catchup",
    {
      schema: {
        summary: "What a series could be caught up from",
        description:
          "A series starts the day it started being kept. The copies of a dataset taken before that day hold what it " +
          "would have written down. This says what a catch-up of the series `key` could read. `until` is when the " +
          "series started being kept: only copies taken before it are read. For a dataset series, `paths` holds its " +
          "own dataset with its older `copies`. For a twin measure (`twin:<measure>`), `paths` lists each pipeline " +
          "that writes today every object type the measure reads, with the datasets it reads and their older copies; " +
          "`standIns` lists the project's other tables that have older copies, which can be read in place of one of a " +
          "pipeline's inputs when the source changed file. `columns` are given so the columns a stand-in lacks can be " +
          "shown. `why` says why nothing can be caught up when `paths` is empty: no reading yet, a measure that counts " +
          "every object, a measure made from types written by several pipelines, a draft pipeline, a pipeline that " +
          "calls the extraction service. `begun` lists the catch-ups already begun for this series. Reads only.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ key: anyKey }),
        response: { 200: record, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return (await catchupOffer(req.db, env, req.query.key)) as unknown as Record<string, unknown>;
    },
  );

  app.post(
    "/ontology/:env/series/catchup",
    {
      schema: {
        summary: "Catch a series up from kept copies, one bounded batch",
        description:
          "Reads the next copies of `datasetId` taken before the series `key` started being kept, oldest first, and " +
          "writes down what they hold. A dataset series reads the copies of its own dataset: each one gives points, " +
          "dated at when that copy was taken. A twin measure names the `pipelineId` its copies go through: each copy " +
          "is run through that pipeline as it is today, in memory, and the measure is computed as it is defined " +
          "today, over today's units. Nothing is written in the ontology: no object, no link, no type. When " +
          "`datasetId` is not one of the pipeline's inputs, `inPlaceOf` names the input its copies are read in place " +
          "of; the pipeline's other inputs are read as they were when each copy was taken, and a copy taken before " +
          "one of them had any copy is left out rather than measured with a later one. Only what changes is " +
          "written, and everything written is marked as caught up, with the time the source gave and the time the " +
          "copy was taken. An object the twin holds today keeps the place it has today; one it does not hold is " +
          "placed by the pipeline's link rules, and counted in `rowsUnattached` when none finds a place. A row that " +
          "cannot be read is counted in `rowsLeftOut`, a copy that cannot be replayed in `copiesLeftOut`; nothing is " +
          "guessed. One call reads 25 copies at most and stops earlier past 12 seconds or 400,000 rows. The answer " +
          "says where the catch-up stands (`state.read` of `state.copies`, `state.done`): call again to resume. " +
          "Refused with the reason when nothing can be caught up. The first call is kept in the audit log.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1) }),
        body: catchupRequest,
        response: { 200: record, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const out = await runCatchup(req.db, env, userId, req.body);
      if (out.began) {
        await recordAudit(req.db, {
          actorUserId: userId,
          projectId: env.id,
          action: "series.catchup",
          resourceType: "series",
          resourceId: req.body.key,
          metadata: { datasetId: out.state.datasetId, pipelineId: out.state.pipelineId, inPlaceOf: out.state.inPlaceOf?.datasetId ?? null, copies: out.state.copies },
        });
      }
      return out as unknown as Record<string, unknown>;
    },
  );

  app.delete(
    "/ontology/:env/series/catchup",
    {
      schema: {
        summary: "Forget what was caught up for a series",
        description:
          "Removes the points or readings the catch-ups of the series `key` wrote, and the catch-ups themselves. Only " +
          "what is marked as caught up is removed: a reading the twin took live and a point a sync wrote are never " +
          "touched, and neither are the copies, so the catch-up can be run again. `removed` is how many points or " +
          "readings went. Kept in the audit log.",
        tags: ["series"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({ key: anyKey }),
        response: { 200: z.object({ removed: z.number() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const out = await forgetCatchup(req.db, env, req.query.key);
      await recordAudit(req.db, { actorUserId: userId, projectId: env.id, action: "series.catchup.forget", resourceType: "series", resourceId: req.query.key, metadata: { removed: out.removed } });
      return out;
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
