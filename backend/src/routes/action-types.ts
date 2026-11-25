import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import {
  DEFAULT_ACTION_TYPES,
  actionTypeDraft,
  keyFrom,
  listActionTypes,
  missingFor,
  removeActionType,
  saveActionType,
  type ActionType,
  type TwinOffer,
} from "../services/action-types.js";
import { twinOffer } from "../services/analyst-actions.js";
import { switchTool, toolCatalogue, toolsOff } from "../services/analyst-settings.js";
import { listFunctionTypes } from "../services/function-types.js";
import { recordAudit } from "../services/audit.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment, type EnvironmentRow } from "../services/ontology.js";
import { listSimPolicies } from "../services/sim-policies.js";
import { buildTwinExport } from "../services/twin-export.js";

// ---------------------------------------------------------------------------
// Action types, and the analyst's tools: what a project lets the analyst
// propose and use, set from the Studio.
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

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const typeOut = z.record(z.unknown());

/** What the twin offers an action type to point at, or why it could not be read. */
async function offerFor(db: DbClient, env: EnvironmentRow): Promise<{ offer: TwinOffer | null; problem: string | null }> {
  try {
    const [system, stored] = await Promise.all([
      buildTwinExport(db, env.id, env.slug, undefined),
      listSimPolicies(db, env.id).then((rows) => rows.map((r) => ({ id: r.id, name: r.name, description: r.description, rules: r.rules }))),
    ]);
    return { offer: twinOffer(system, stored), problem: null };
  } catch {
    return { offer: null, problem: "The twin could not be read, so what an action type can point at is not listed and no type is checked against it." };
  }
}

const withMissing = (types: readonly ActionType[], offer: TwinOffer | null) => types.map((t) => ({ ...t, missing: offer ? missingFor(t, offer) : null }));

const actionTypeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/action-types",
    {
      schema: {
        summary: "The project's action types: what the analyst may propose, and within what bounds",
        description:
          "An action type says what an option of the analyst may contain in this project: what it changes (`effect`: " +
          "`capacity`, `measure`, `transfer` or `response`, the four things a scenario's run can be made to change), " +
          "its `bounds` (for capacity: the activity, a range of units, the sites, the mode of the price list; for a " +
          "measure: the contact layers with the range of their factor, the days, the catchments; for a transfer: the " +
          "patients a day and the two ends; for a response: the recorded responses it may be), `leadDays` (the days " +
          "before it can apply, counted from the decision, day 0 of a run), `approver` (who can approve it, in " +
          "words) and whether it is `active`. Every project has four built-in types (`builtIn`), one per effect, " +
          "unbounded and active: what the analyst could propose before action types existed. `declared` is true for " +
          "a type the project wrote, its own or a built-in it changed; a project where none is declared behaves " +
          "exactly as before, and the analyst is told nothing new. `missing` says why a type cannot be tested on " +
          "this twin (an activity no site provides, a layer the twin does not declare, no transfer route, a mode the " +
          "price list does not hold), or is null when it can. `offer` is what the twin declares that a type can " +
          "point at: activities, contact layers, sites with the activities each provides, catchments, transfer " +
          "routes, recorded responses, and the modes the price list holds for each activity. It is null, with " +
          "`offerProblem`, when the twin could not be read. An action type gives no right to write: an option under " +
          "one is still tested by the engine and applied by a person. Reads only.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ types: z.array(typeOut), offer: z.record(z.unknown()).nullable(), offerProblem: z.string().nullable() }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const [types, { offer, problem }] = await Promise.all([listActionTypes(req.db, env.id), offerFor(req.db, env)]);
      return { types: withMissing(types, offer), offer: offer as unknown as Record<string, unknown> | null, offerProblem: problem };
    },
  );

  app.post(
    "/ontology/:env/action-types",
    {
      schema: {
        summary: "Add an action type of the project's own",
        description:
          "Writes a new action type. Its key, the name the analyst gives it in a test, is made from `name` (lower-case " +
          "letters, digits and hyphens) and never collides with an existing one. The body is the type: `name`, " +
          "`description`, `effect`, `bounds` (see `GET /action-types`; a bound left out is no bound), `leadDays`, " +
          "`approver`, `active`. Bounds out of order (a lowest above a highest) or beyond what a run can do (more " +
          "patients a day than a route carries in a run) are refused with what to correct. The type is offered to " +
          "the analyst from the next objective. Kept in the audit log.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        body: actionTypeDraft,
        response: { 201: typeOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const taken = new Set((await listActionTypes(req.db, env.id)).map((t) => t.key));
      const saved = await saveActionType(req.db, env.id, userId, keyFrom(req.body.name, taken), req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "action_type.create",
        resourceType: "action_type",
        resourceId: saved.key,
        metadata: { name: saved.name, effect: saved.effect, bounds: saved.bounds, active: saved.active },
      });
      return reply.code(201).send(saved as unknown as Record<string, unknown>);
    },
  );

  app.put(
    "/ontology/:env/action-types/:key",
    {
      schema: {
        summary: "Change an action type, or a built-in one for this project",
        description:
          "Replaces the action type under `key` with the body. Under the key of a built-in type (`capacity`, " +
          "`measure`, `transfer`, `response`), it writes what this project changes of it: its bounds, its name, who " +
          "approves it, or `active: false` to stop that kind of change from being proposed at all. A built-in type " +
          "keeps what it changes: its `effect` cannot become another. Kept in the audit log.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1), key }),
        body: actionTypeDraft,
        response: { 200: typeOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const known = (await listActionTypes(req.db, env.id)).some((t) => t.key === req.params.key);
      if (!known) throw NotFound("ACTION_TYPE_NOT_FOUND", "That action type is not in this project. Add it first.");
      const saved = await saveActionType(req.db, env.id, userId, req.params.key, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "action_type.update",
        resourceType: "action_type",
        resourceId: saved.key,
        metadata: { name: saved.name, effect: saved.effect, bounds: saved.bounds, active: saved.active },
      });
      return saved as unknown as Record<string, unknown>;
    },
  );

  app.delete(
    "/ontology/:env/action-types/:key",
    {
      schema: {
        summary: "Remove an action type, or reset a built-in one",
        description:
          "For a type of the project's own, removes it: the analyst can no longer propose under it. For a built-in " +
          "type, removes what this project changed of it, and the type is again as every project starts with it, " +
          "unbounded and active. Nothing already tested, decided or added to a scenario changes. Kept in the audit log.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1), key }),
        response: { 204: z.null(), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await removeActionType(req.db, env.id, req.params.key);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: DEFAULT_ACTION_TYPES.some((d) => d.key === req.params.key) ? "action_type.reset" : "action_type.delete",
        resourceType: "action_type",
        resourceId: req.params.key,
        metadata: {},
      });
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/ontology/:env/analyst/tools",
    {
      schema: {
        summary: "The tools the analyst has, and which ones this project switched off",
        description:
          "One line per tool: its `name`, what it `reads` in a sentence, the `group` it is listed under, what it " +
          "`does` (`reads`, `computes`, `runs` the engine, `searches` the web), its `origin` (`code`, or `project` " +
          "for one declared from the Studio), its `inputs` (each with its name, its kind, whether it is required and " +
          "what it is for), `where` it is offered (`ask`, `options`, " +
          "`events`, `investigate`), whether it is `on` in this project, and whether it is `switchable`. The tools " +
          "are code: a project cannot write one. It can switch one off, and the analyst is then not offered it. " +
          "`calculate`, `test_option` and `list_actions` cannot be switched off, and `why` says why. With the web " +
          "search off, the event finder and the investigation of a series refuse to start and say so. Reads only.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            tools: z.array(
              z.object({
                name: z.string(),
                reads: z.string(),
                group: z.string(),
                does: z.string(),
                origin: z.enum(["code", "project"]),
                inputs: z.array(z.object({ name: z.string(), kind: z.string(), required: z.boolean(), says: z.string() })),
                where: z.array(z.string()),
                switchable: z.boolean(),
                why: z.string().nullable(),
                on: z.boolean(),
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
      const [off, { types }] = await Promise.all([toolsOff(req.db, env.id), listFunctionTypes(req.db, env.id)]);
      return { tools: toolCatalogue(off, types) };
    },
  );

  app.put(
    "/ontology/:env/analyst/tools/:name",
    {
      schema: {
        summary: "Switch one of the analyst's tools on or off for this project",
        description:
          "`on: false` takes the tool away from the analyst in this project, from the next exchange; `on: true` gives " +
          "it back. A tool an exchange cannot do without is refused, with the reason. Kept in the audit log.",
        tags: ["analyst"],
        params: z.object({ env: z.string().min(1), name: z.string().min(1).max(80) }),
        body: z.object({ on: z.boolean() }),
        response: { 200: z.object({ name: z.string(), on: z.boolean() }), 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await switchTool(req.db, env.id, userId, req.params.name, req.body.on);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: req.body.on ? "analyst_tool.switch_on" : "analyst_tool.switch_off",
        resourceType: "analyst_tool",
        resourceId: req.params.name,
        metadata: {},
      });
      return { name: req.params.name, on: req.body.on };
    },
  );
};

export default actionTypeRoutes;
