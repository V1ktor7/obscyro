import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { ToolError } from "../services/analyst-tools.js";
import { recordAudit } from "../services/audit.js";
import { CODE_TOOL_NAMES, functionOffer, functionReads } from "../services/function-reads.js";
import {
  functionKeyFrom,
  functionTypeDraft,
  inputParser,
  listFunctionTypes,
  missingForFunction,
  removeFunctionType,
  runFunction,
  saveFunctionType,
  type FunctionOffer,
  type FunctionType,
} from "../services/function-types.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";

// ---------------------------------------------------------------------------
// Function types: reading tools of the analyst that a project declares.
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
const typeOut = z.record(z.unknown());
const withMissing = (types: readonly FunctionType[], offer: FunctionOffer) => types.map((t) => ({ ...t, missing: missingForFunction(t, offer) }));

const functionTypeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/function-types",
    {
      schema: {
        summary: "The project's function types: the reading tools of the analyst it declared",
        description:
          "A function type is a reading tool of the analyst that the project declares, where the analyst's own tools " +
          "are code. It is one of five blocks set by a person: `objects` (the objects of a type, filtered, with the " +
          "properties to return), `aggregate` (a count, sum, mean, minimum or maximum over them, in one value or by " +
          "group: a property, the unit each object is attached to, or the site of that unit), `formula` " +
          "(a calculation of the calculator over named aggregates), `history` (the readings the twin kept of a measure " +
          "at a unit) and `dataset` (columns of a dataset of the project, filtered). Each type has its `key` (the " +
          "tool's name, as the model calls it), its `label` (what a trace shows), its `description` (what the model " +
          "reads to decide to call it), its `inputs` (name, kind, bounds, required or not: an input can feed a filter, " +
          "a group or a period of the block), its `block` and `config`, and whether it is `active`. `missing` says " +
          "why a type cannot run on this project (an object type the ontology does not have, a property the type " +
          "does not declare, a measure the twin does not keep, a dataset or a column that is not there), or is null. " +
          "`unreadable` names the stored types that can no longer be read: they are not offered to the analyst. " +
          "`offer` is what the project holds that a type can point at: object types with their properties, the " +
          "measures kept over time, the datasets with their columns. A declared tool only reads. Reads only.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ types: z.array(typeOut), unreadable: z.array(z.string()), offer: z.record(z.unknown()) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const [{ types, unreadable }, offer] = await Promise.all([listFunctionTypes(req.db, env.id), functionOffer(req.db, env)]);
      return { types: withMissing(types, offer), unreadable, offer: offer as unknown as Record<string, unknown> };
    },
  );

  app.post(
    "/ontology/:env/function-types",
    {
      schema: {
        summary: "Declare a reading tool of the analyst",
        description:
          "Writes a new function type. The tool's name is made from `label` (lower-case letters, digits and " +
          "underscores) and never collides with another function type or with a tool written in the code. The body is " +
          "the type: `label`, `description` (ten characters at least: it is what the model reads), `inputs`, `block`, " +
          "`config` and `active`. Refused with what to correct: a slot fed by an input the function does not declare, " +
          "or of a kind that slot cannot take; a group fed by an input that is not a choice among a list; a sum or a " +
          "mean without the property it is taken over; a formula that cannot be evaluated over the names it has; more " +
          "rows asked for than a tool returns. Whether what it points at exists is said by `GET /function-types` " +
          "(`missing`), not refused here: a type can be declared before its data arrives. The tool is offered to the " +
          "analyst from the next exchange. Kept in the audit log.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        body: functionTypeDraft,
        response: { 201: typeOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const taken = new Set([...CODE_TOOL_NAMES, ...(await listFunctionTypes(req.db, env.id)).types.map((t) => t.key)]);
      const saved = await saveFunctionType(req.db, env.id, userId, functionKeyFrom(req.body.label, taken), req.body, CODE_TOOL_NAMES);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "function_type.create",
        resourceType: "function_type",
        resourceId: saved.key,
        metadata: { label: saved.label, block: saved.block, active: saved.active },
      });
      return reply.code(201).send(saved as unknown as Record<string, unknown>);
    },
  );

  app.put(
    "/ontology/:env/function-types/:key",
    {
      schema: {
        summary: "Change a function type",
        description:
          "Replaces the function type under `key` with the body. The tool keeps its name: answers already journalled " +
          "cite it by that name. `active: false` takes it away from the analyst without removing it. Kept in the audit log.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1), key }),
        body: functionTypeDraft,
        response: { 200: typeOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const known = (await listFunctionTypes(req.db, env.id)).types.some((t) => t.key === req.params.key);
      if (!known) throw NotFound("FUNCTION_TYPE_NOT_FOUND", "That function type is not in this project. Declare it first.");
      const saved = await saveFunctionType(req.db, env.id, userId, req.params.key, req.body, CODE_TOOL_NAMES);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "function_type.update",
        resourceType: "function_type",
        resourceId: saved.key,
        metadata: { label: saved.label, block: saved.block, active: saved.active },
      });
      return saved as unknown as Record<string, unknown>;
    },
  );

  app.delete(
    "/ontology/:env/function-types/:key",
    {
      schema: {
        summary: "Remove a function type",
        description:
          "Removes the declared tool: the analyst is no longer offered it. Answers already journalled keep the steps " +
          "where it was used. Kept in the audit log.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1), key }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await removeFunctionType(req.db, env.id, req.params.key);
      await recordAudit(req.db, { actorUserId: userId, projectId: env.id, action: "function_type.delete", resourceType: "function_type", resourceId: req.params.key, metadata: {} });
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/ontology/:env/function-types/:key/try",
    {
      schema: {
        summary: "Run a declared reading tool once, without the analyst",
        description:
          "Runs the function type on `input`, exactly as the analyst would call it, and returns what it would read. No " +
          "model is called and nothing is journalled. `ok: true` comes with `result`. `ok: false` comes with `refused`, " +
          "the sentence the analyst would have read: an input outside its bounds, a unit that was not found, a measure " +
          "the twin does not keep, a column the dataset does not have, a result too long to be read at once. A type " +
          "that is switched off can be tried: that " +
          "is how it is checked before it is switched on. Reads only.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1), key }),
        body: z.object({ input: z.record(z.unknown()).default({}) }),
        response: { 200: z.object({ ok: z.boolean(), result: z.unknown().optional(), refused: z.string().optional(), ms: z.number() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const type = (await listFunctionTypes(req.db, env.id)).types.find((t) => t.key === req.params.key);
      if (!type) throw NotFound("FUNCTION_TYPE_NOT_FOUND", "That function type is not in this project.");
      const started = Date.now();
      const parsed = inputParser(type.inputs).safeParse(req.body.input);
      if (!parsed.success) {
        return { ok: false, refused: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}.`, ms: Date.now() - started };
      }
      try {
        const result = await runFunction(type, parsed.data as Record<string, string | number | undefined>, functionReads(req.db, env));
        return { ok: true, result, ms: Date.now() - started };
      } catch (err) {
        // A refusal is what the analyst would read. Anything else is a fault of ours.
        if (!(err instanceof ToolError)) throw err;
        return { ok: false, refused: err.message, ms: Date.now() - started };
      }
    },
  );
};

export default functionTypeRoutes;
