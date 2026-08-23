import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { AppError, BadRequest, NotFound } from "../lib/errors.js";
import { startSseStream } from "../lib/sse.js";
import { recordAudit } from "../services/audit.js";
import {
  assertEventMatchesWorld,
  createSimEvent,
  deleteSimEvent,
  getSimEvent,
  listSimEvents,
  updateSimEvent,
} from "../services/sim-events.js";
import {
  createSimPolicy,
  deleteSimPolicy,
  getSimPolicy,
  listSimPolicies,
  updateSimPolicy,
} from "../services/sim-policies.js";
import { spreadPayload } from "../services/spread-payload.js";
import { buildTwinExport } from "../services/twin-export.js";
import { proxyToSimService } from "../services/ml-simulation.js";
import {
  deactivateTwinMetric,
  metricsForRollup,
  upsertTwinMetric,
} from "../services/twin-metrics.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  ackAlert,
  createAlertRule,
  deleteAlertRule,
  getTwinNetwork,
  getTwinTreeSnapshot,
  listAlertRules,
  listOpenAlerts,
  rollupUnit,
  seedTwinDemo,
  unitExchanges,
  updateAlertRule,
  type TwinAlertRuleRow,
} from "../services/twin.js";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const alertRuleBody = z.object({
  unitKind: z.string().nullable().optional(),
  metric: z.string().min(1),
  op: z.enum(["<", ">", ">=", "<=", "=="]),
  threshold: z.number(),
  severity: z.enum(["info", "warn", "critical"]),
  messageTemplate: z.string().min(1),
  recommendationTemplate: z.string().optional(),
});

const twinRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/ontology/:env/twin/tree",
    {
      schema: {
        summary: "OrgUnit tree with rollup metrics and alert severity",
        description:
          "With a scenario, the tree is what the network would be under that " +
          "scenario's edits — the same shape reality has, so the two can be " +
          "read side by side.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          scenarioId: z.string().uuid().optional(),
          atOffsetHours: z.coerce.number().int().min(0).optional(),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.query.scenarioId
        ? { scenarioId: req.query.scenarioId, atOffsetHours: req.query.atOffsetHours ?? 0 }
        : undefined;
      return getTwinTreeSnapshot(req.db, env.id, lens);
    },
  );

  app.get(
    "/ontology/:env/twin/network",
    {
      schema: {
        summary: "Network-level twin: places, what is in them, and the flows between",
        description:
          "Sites are instances of types the institution tagged physical — the tree's " +
          "roots only when nothing is tagged. Each carries the metrics of the units " +
          "placed in it, and `contributingUnits` says which ones, so a number can be " +
          "traced. Flows are link instances between two sites; a flow's lane is its " +
          "link type, with no classification step.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return getTwinNetwork(req.db, env.id);
    },
  );

  app.get(
    "/ontology/:env/twin/sim-export",
    {
      schema: {
        summary: "The twin as the simulation engine reads it",
        description:
          "Units become facilities, whatever is attached to them becomes capacity or " +
          "census according to the type's declared simulation role, and non-structural " +
          "relationships become routes. Nothing is matched on a name. `gaps` lists " +
          "what the ontology could not answer — routes with no throughput, " +
          "populations with no size, types with no role — so a result is never " +
          "read as if the model knew more than it does. With a scenario, this is " +
          "the network that scenario would produce, so an event can be tested " +
          "against a plan rather than only against today.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          scenarioId: z.string().uuid().optional(),
          atOffsetHours: z.coerce.number().int().min(0).optional(),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.query.scenarioId
        ? { scenarioId: req.query.scenarioId, atOffsetHours: req.query.atOffsetHours ?? 0 }
        : undefined;
      return { ...(await buildTwinExport(req.db, env.id, req.params.env, lens)) };
    },
  );

  /**
   * `effects` is passed through unvalidated on purpose.
   *
   * The shape belongs to the engine, which already checks it with pydantic and
   * refuses effects aimed at facilities, populations or routes the twin does
   * not contain. Restating that here in zod would create a second definition to
   * keep in agreement, and the copy is always the one that falls behind — a
   * fourth effect kind would then be rejected by the API that knows least
   * about it.
   */
  const simEventBody = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    horizon: z.number().int().min(1).max(1000).default(60),
    effects: z.array(z.record(z.unknown())).default([]),
    twinScenarioId: z.string().uuid().nullable().default(null),
  });

  const simEventOut = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    horizon: z.number(),
    effects: z.array(z.record(z.unknown())),
    twinScenarioId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  app.get(
    "/ontology/:env/sim-catalogue",
    {
      schema: {
        summary: "What can be run, and what can be perturbed",
        description:
          "Proxied straight from the engine. `targets` is the list of addressable " +
          "quantities — capacity, route throughput, length of stay, mortality, what " +
          "a patient consumes, arrivals — each with the operations it accepts and " +
          "the dimensions it can be narrowed by. The composer builds its form from " +
          "this, so adding something perturbable in the engine makes it appear in " +
          "the UI with no front-end change.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope, 503: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      await resolveEnvironment(req.db, userId, req.params.env);
      const base = config.simServiceUrl;
      if (!base) {
        throw new AppError(
          "SIM_UNAVAILABLE",
          "Simulation service is not configured. Set `SIM_SERVICE_URL`.",
          503,
        );
      }
      const res = await fetch(`${base.replace(/\/$/, "")}/events/catalogue`, {
        signal: AbortSignal.timeout(config.simServiceTimeoutMs),
      }).catch(() => null);
      if (!res || !res.ok) {
        throw new AppError("SIM_UNAVAILABLE", "Simulation service is unreachable.", 503);
      }
      return (await res.json()) as Record<string, unknown>;
    },
  );

  app.get(
    "/ontology/:env/sim-events",
    {
      schema: {
        summary: "Events composed for this organisation",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({ events: z.array(simEventOut) }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { events: await listSimEvents(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/sim-events",
    {
      schema: {
        summary: "Compose an event",
        description:
          "An event is a list of effects: demand changes somewhere, a resource " +
          "changes somewhere, a connection changes somewhere. Nothing tests whether " +
          "a change is bad — a capacity multiplier above 1 is a wing opening, and a " +
          "negative demand volume is a vaccination programme.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: simEventBody,
        response: { 201: simEventOut, 400: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const created = await createSimEvent(req.db, env.id, userId, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "sim.event.create",
        resourceType: "sim_event",
        resourceId: created.id,
        metadata: { name: created.name, effects: created.effects.length },
      });
      return reply.code(201).send(created);
    },
  );

  app.put(
    "/ontology/:env/sim-events/:id",
    {
      schema: {
        summary: "Replace a composed event",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: simEventBody,
        response: { 200: simEventOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const updated = await updateSimEvent(req.db, env.id, req.params.id, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "sim.event.update",
        resourceType: "sim_event",
        resourceId: updated.id,
        metadata: { name: updated.name, effects: updated.effects.length },
      });
      return updated;
    },
  );

  app.delete(
    "/ontology/:env/sim-events/:id",
    {
      schema: {
        summary: "Delete a composed event",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await deleteSimEvent(req.db, env.id, req.params.id);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "sim.event.delete",
        resourceType: "sim_event",
        resourceId: req.params.id,
        metadata: {},
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/twin/simulate",
    {
      schema: {
        summary: "Run responses against an event on the live twin",
        description:
          "The system comes from the ontology; the event is either a shipped template " +
          "from the engine's catalogue. Returns one row per policy, worst last, so " +
          "'doing nothing' can be read against the alternatives.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          /** A shipped template. Mutually exclusive with `eventId`. */
          template: z.string().min(1).optional(),
          /** An event composed here. Mutually exclusive with `scenario`. */
          eventId: z.string().uuid().optional(),
          /** Shipped responses, by name. */
          policies: z.array(z.string().min(1)).default([]),
          /**
           * Responses written here, sent whole.
           *
           * Passed through rather than validated field by field: the engine's
           * own model already checks the shape, and mirroring a typed condition
           * tree in zod would give two definitions of a response that drift
           * apart. What this route owes the caller is a clear failure, which the
           * engine's 422 already is.
           */
          customPolicies: z.array(z.record(z.unknown())).default([]),
          /** Responses stored here, by id. Resolved before the export. */
          policyIds: z.array(z.string().uuid()).default([]),
          seed: z.number().int().optional(),
          /** Sizes the ontology cannot supply. Empty runs a hollow model. */
          populationSizes: z.record(z.number().nonnegative()).default({}),
          routeCapacity: z.number().nonnegative().default(0),
          /**
           * What to call the patients already in the beds when the run starts.
           *
           * Left out, an occupied bed simply starts unavailable and stays that
           * way for the whole horizon — Sainte-Justine read full for 91 steps
           * because sixteen stretchers were occupied when the feed was read, not
           * because anything happened. Naming an acuity admits them as patients
           * instead, so they occupy a bed, leave, and free it. The second is
           * more realistic and needs an assumption about who they are, which is
           * the caller's to make.
           */
          censusAcuity: z.string().min(1).max(120).optional(),
          /**
           * Twin scenario to read the world through. Named `twinScenarioId`
           * rather than `scenarioId` because `scenario` above already means the
           * event, and two different things called scenario in one body is how
           * a caller ends up sending the wrong one.
           */
          twinScenarioId: z.string().uuid().optional(),
          atOffsetHours: z.number().int().min(0).optional(),
          /**
           * Which tables of the run to hand back alongside the ranking.
           *
           * Empty by default: a trajectory is far larger than the summary, and
           * a caller who only wants to know which response won should not pay
           * to move every step of it across the wire.
           */
          collect: z.array(z.enum(["steps", "facilities", "decisions"])).default([]),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope, 503: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.body.twinScenarioId
        ? {
            scenarioId: req.body.twinScenarioId,
            atOffsetHours: req.body.atOffsetHours ?? 0,
          }
        : undefined;
      if ((req.body.template === undefined) === (req.body.eventId === undefined)) {
        throw BadRequest(
          "PICK_ONE_EVENT",
          "Send exactly one of `template` (a shipped one) or `eventId` (an event " +
            "composed here).",
        );
      }

      // Resolved before the export so a mismatched event fails on its own terms
      // rather than as a wall of unknown ids from the engine.
      let event: Record<string, unknown> | null = null;
      if (req.body.eventId) {
        const row = await getSimEvent(req.db, env.id, req.body.eventId);
        assertEventMatchesWorld(row, lens?.scenarioId ?? null);
        event = {
          id: row.id,
          name: row.name,
          description: row.description,
          horizon: row.horizon,
          // `effects`, which is what the engine's model calls them. Sent as
          // `perturbations` it was dropped in silence: pydantic ignores an
          // unknown field, so every event composed here arrived carrying
          // nothing, every policy tied at zero, and the run reported a clean
          // result for a question it had never been asked.
          effects: row.effects,
        };
      }

      // Resolved before the export so a missing response fails on its own
      // terms rather than after a minute of building the world.
      const stored = await Promise.all(
        req.body.policyIds.map(async (id) => {
          const row = await getSimPolicy(req.db, env.id, id);
          return { id: row.id, name: row.name, rules: row.rules };
        }),
      );

      const system = await buildTwinExport(req.db, env.id, req.params.env, lens);
      return proxyToSimService("/events/compare", {
        system,
        template: req.body.template ?? null,
        event,
        policies: req.body.policies,
        custom_policies: [...stored, ...req.body.customPolicies],
        seed: req.body.seed ?? null,
        population_sizes: req.body.populationSizes,
        route_capacity: req.body.routeCapacity,
        census_acuity: req.body.censusAcuity ?? null,
        collect: req.body.collect,
      });
    },
  );

  app.post(
    "/ontology/:env/twin/spread",
    {
      schema: {
        summary: "Run the spreading process the twin declared",
        description:
          "Reads the transitions declared as ontology instances and integrates them " +
          "forward, one catchment at a time. Returns the run written as an event, so " +
          "what comes back is composable with everything else: it can be saved, " +
          "replayed, branched, and ranked against responses by `/twin/simulate`. " +
          "Nothing is seeded on the caller's behalf — a wave starts where the author " +
          "says it started.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          /**
           * Units in each state, per catchment: `{ "pop:<uuid>": { "malade": 5 } }`.
           *
           * Keyed by the export's population ids rather than by object ids,
           * because that is what comes back in `states` and what the map draws
           * — one vocabulary across the round trip, so nobody has to map
           * between two of them at the point they are reading a result.
           */
          seeds: z.record(z.record(z.number().finite().nonnegative())).default({}),
          horizon: z.number().int().min(1).max(1000).default(91),
          /**
           * Named couplings, scaled over windows.
           *
           * This is what a structural measure *is* here: closing a school is a
           * factor of zero on the layer the school is, and the counterfactual is
           * built rather than inferred. Fitted against the observed curve the
           * same question had no answer at all — the closure fell on the same
           * day as the holidays.
           */
          changes: z
            .array(
              z.object({
                layer: z.string().min(1).max(120),
                factor: z.number().finite().min(0),
                fromStep: z.number().int().min(0).default(0),
                /** Null runs to the end. A window that closes puts it back. */
                toStep: z.number().int().min(0).nullable().default(null),
              }),
            )
            .default([]),
          /**
           * Keep the run as a composed event under this name.
           *
           * The seam, taken: the effects the model produced are `demand.incidence`
           * like any other, so saved once they arrive in the replay, the branch
           * and the ranking with no further translation. Left out, the run is
           * returned and not kept, which is what exploring looks like.
           */
          saveAs: z.string().trim().min(1).max(120).optional(),
          /**
           * Read the declaration back without integrating it.
           *
           * What a seeding form asks before it can be filled in: which states
           * exist, which couplings a measure can name, and what the catchments
           * are called. Cheap — the export still has to be built, but nothing
           * is integrated.
           */
          probe: z.boolean().default(false),
          twinScenarioId: z.string().uuid().optional(),
          atOffsetHours: z.number().int().min(0).optional(),
        }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope, 503: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.body.twinScenarioId
        ? { scenarioId: req.body.twinScenarioId, atOffsetHours: req.body.atOffsetHours ?? 0 }
        : undefined;
      const system = await buildTwinExport(req.db, env.id, req.params.env, lens);
      const out = await proxyToSimService<{
        event: { effects: unknown[]; horizon?: number };
        states: unknown[];
        vocabulary: Record<string, string[]>;
        gaps: unknown[];
      }>("/events/spread", spreadPayload(system, req.body));

      let saved: { id: string; name: string } | null = null;
      // A probe produced no effects, so there is nothing to keep. Saving it
      // would create an event that runs and changes nothing.
      if (req.body.saveAs && !req.body.probe) {
        const row = await createSimEvent(req.db, env.id, userId, {
          name: req.body.saveAs,
          description:
            `Produced by the declared spreading model over ${req.body.horizon} steps` +
            (req.body.changes.length
              ? `, with ${req.body.changes.length} measure(s) on its couplings.`
              : "."),
          horizon: req.body.horizon,
          // Passed through whole. The engine wrote them as `demand.incidence`
          // precisely so nothing here has to understand them, and a route that
          // reshaped them would be a second opinion about a format it does not
          // own.
          effects: out.event.effects as Array<Record<string, unknown>>,
          twinScenarioId: req.body.twinScenarioId ?? null,
        });
        saved = { id: row.id, name: row.name };
        await recordAudit(req.db, {
          actorUserId: userId,
          projectId: env.id,
          action: "sim.event.create",
          resourceType: "sim_event",
          resourceId: row.id,
          metadata: { name: row.name, effects: out.event.effects.length, from: "spread" },
        });
      }

      return { ...out, saved };
    },
  );

  app.get(
    "/ontology/:env/twin/units/:id",
    {
      schema: {
        summary: "Full unit metrics, open alerts, and recommendations",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const metrics = await rollupUnit(req.db, env.id, req.params.id);
      const alerts = await listOpenAlerts(req.db, env.id, req.params.id, {
        limit: config.listMaxLimit,
      });
      const exchanges = await unitExchanges(req.db, env.id, req.params.id);
      return {
        metrics,
        alerts,
        exchanges,
        recommendations: alerts.map((a) => a.recommendation).filter(Boolean),
      };
    },
  );

  app.get(
    "/ontology/:env/twin/alerts",
    {
      schema: {
        summary: "List open twin alerts (paginated)",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          unitId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(config.listMaxLimit).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
        response: { 200: z.object({ alerts: z.array(z.record(z.unknown())) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const alerts = await listOpenAlerts(req.db, env.id, req.query.unitId, {
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return {
        alerts: alerts.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          ackedAt: a.ackedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.get(
    "/ontology/:env/twin/stream",
    {
      schema: {
        summary: "SSE stream of twin tree rollups and alerts (~5s)",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        // With a scenario the stream shows the world under that scenario's
        // edits, recomputed on the same cadence as reality.
        querystring: z.object({
          scenarioId: z.string().uuid().optional(),
          atOffsetHours: z.coerce.number().int().min(0).optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const lens = req.query.scenarioId
        ? { scenarioId: req.query.scenarioId, atOffsetHours: req.query.atOffsetHours ?? 0 }
        : undefined;

      startSseStream(req, reply, {
        name: "twin",
        intervalMs: config.twinSseIntervalMs,
        produce: () => getTwinTreeSnapshot(req.db, env.id, lens),
      });
    },
  );

  // --- metric definitions ----------------------------------------------------
  //
  // What the twin displays, and what an alert rule can threshold on, is an
  // organization's own list rather than a fixed one. Occupancy is a seeded row
  // like any other: rename the type it counts, change the status it looks for,
  // or redefine it as admitted patients over beds, and the map, the alerts and
  // the scenarios all follow.

  const metricSelector = z.object({
    ofType: z.string().max(200).nullable().optional(),
    // Select by declared role instead of by name, which is how a metric counts
    // capacity across an ontology whose types it has never seen.
    ofRole: z.enum(["space", "staff", "stuff", "systems", "demand"]).nullable().optional(),
    inUse: z.boolean().optional(),
    where: z
      .array(z.object({ property: z.string().min(1).max(200), equals: z.string().max(500) }))
      .optional(),
    agg: z.enum(["count", "sum", "mean", "min", "max"]),
    property: z.string().max(200).nullable().optional(),
  });

  const simPolicyBody = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4000).default(""),
    // Passed through: the engine's own model checks the shape, and mirroring a
    // typed condition tree in zod would give two definitions of a response that
    // drift apart.
    rules: z.array(z.record(z.unknown())).default([]),
  });

  const simPolicyOut = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    rules: z.array(z.record(z.unknown())),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  app.get(
    "/ontology/:env/sim-policies",
    {
      schema: {
        summary: "Responses written by this organisation",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ policies: z.array(simPolicyOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { policies: await listSimPolicies(req.db, env.id) };
    },
  );

  app.post(
    "/ontology/:env/sim-policies",
    {
      schema: {
        summary: "Write a response",
        description:
          "A response is a list of rules: when this reading crosses that line, do " +
          "this, after this delay, at this cost. Nothing here decides whether a rule " +
          "is wise — transferring patients and closing schools are the same object " +
          "with different actions.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: simPolicyBody,
        response: { 201: simPolicyOut, 400: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const created = await createSimPolicy(req.db, env.id, userId, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "sim.policy.create",
        resourceType: "sim_policy",
        resourceId: created.id,
        metadata: { name: created.name, rules: created.rules.length },
      });
      return reply.code(201).send(created);
    },
  );

  app.put(
    "/ontology/:env/sim-policies/:id",
    {
      schema: {
        summary: "Replace a written response",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: simPolicyBody,
        response: { 200: simPolicyOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const updated = await updateSimPolicy(req.db, env.id, req.params.id, req.body);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "sim.policy.update",
        resourceType: "sim_policy",
        resourceId: updated.id,
        metadata: { name: updated.name, rules: updated.rules.length },
      });
      return updated;
    },
  );

  app.delete(
    "/ontology/:env/sim-policies/:id",
    {
      schema: {
        summary: "Delete a written response",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await deleteSimPolicy(req.db, env.id, req.params.id);
      await recordAudit(req.db, {
        actorUserId: userId,
        projectId: env.id,
        action: "sim.policy.delete",
        resourceType: "sim_policy",
        resourceId: req.params.id,
        metadata: {},
      });
      return { ok: true as const };
    },
  );

  const metricOut = z.object({
    id: z.string(),
    organizationId: z.string(),
    key: z.string(),
    label: z.string(),
    objectType: z.string(),
    unit: z.enum(["percent", "ratio", "count", "number"]),
    numerator: metricSelector,
    denominator: metricSelector.nullish(),
    active: z.boolean(),
  });

  app.get(
    "/ontology/:env/twin/metrics",
    {
      schema: {
        summary: "Metric definitions this organization displays on the twin",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ metrics: z.array(metricOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { metrics: await metricsForRollup(req.db, env.organizationId) };
    },
  );

  app.put(
    "/ontology/:env/twin/metrics/:key",
    {
      schema: {
        summary: "Define or redefine a twin metric",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), key: z.string().min(1).max(64) }),
        body: z.object({
          label: z.string().min(1).max(200),
          objectType: z.string().min(1).max(200).default("OrgUnit"),
          unit: z.enum(["percent", "ratio", "count", "number"]),
          numerator: metricSelector,
          denominator: metricSelector.nullable().optional(),
        }),
        response: { 200: metricOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const metric = await upsertTwinMetric(req.db, env.organizationId, {
        key: req.params.key,
        label: req.body.label,
        objectType: req.body.objectType,
        unit: req.body.unit,
        numerator: req.body.numerator,
        denominator: req.body.denominator ?? null,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "twin_metric.upsert",
        resourceType: "twin_metric",
        resourceId: metric.id,
        metadata: { key: metric.key, unit: metric.unit },
      });
      return metric;
    },
  );

  app.delete(
    "/ontology/:env/twin/metrics/:key",
    {
      schema: {
        summary: "Retire a twin metric",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), key: z.string().min(1).max(64) }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const gone = await deactivateTwinMetric(req.db, env.organizationId, req.params.key);
      if (!gone) throw NotFound("METRIC_NOT_FOUND", "No active metric by that key.");
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "twin_metric.retire",
        resourceType: "twin_metric",
        resourceId: req.params.key,
        metadata: { key: req.params.key },
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/twin/alert-rules",
    {
      schema: {
        summary: "Create a twin alert rule",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        body: alertRuleBody,
        response: { 201: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const rule = await createAlertRule(req.db, env.id, userId, env.organizationId, req.body);
      return reply.code(201).send(serializeAlertRule(rule));
    },
  );

  app.get(
    "/ontology/:env/twin/alert-rules",
    {
      schema: {
        summary: "List twin alert rules",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ rules: z.array(z.record(z.unknown())) }) },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const rules = await listAlertRules(req.db, env.id);
      return { rules: rules.map(serializeAlertRule) };
    },
  );

  app.patch(
    "/ontology/:env/twin/alert-rules/:id",
    {
      schema: {
        summary: "Update a twin alert rule",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: alertRuleBody.partial(),
        response: { 200: z.record(z.unknown()), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return serializeAlertRule(await updateAlertRule(req.db, env.id, req.params.id, req.body));
    },
  );

  app.delete(
    "/ontology/:env/twin/alert-rules/:id",
    {
      schema: {
        summary: "Delete a twin alert rule",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await deleteAlertRule(req.db, env.id, req.params.id);
      return { ok: true as const };
    },
  );

  app.patch(
    "/ontology/:env/twin/alerts/:id",
    {
      schema: {
        summary: "Acknowledge a twin alert",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1), id: z.string().uuid() }),
        body: z.object({ status: z.literal("ack") }),
        response: { 200: z.object({ ok: z.literal(true) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      await ackAlert(req.db, env.id, req.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    "/ontology/:env/twin/seed-demo",
    {
      schema: {
        summary: "Opt-in DEMO ONLY: seed CHUM twin skeleton (demo OrgUnits + instances). The live twin otherwise builds from real ontology data.",
        tags: ["twin"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({ unitCount: z.number(), instanceCount: z.number() }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return seedTwinDemo(req.db, env.id, userId, env.organizationId);
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

function serializeAlertRule(rule: TwinAlertRuleRow): Record<string, unknown> {
  return {
    id: rule.id,
    environmentId: rule.environmentId,
    unitKind: rule.unitKind,
    metric: rule.metric,
    op: rule.op,
    threshold: rule.threshold,
    severity: rule.severity,
    messageTemplate: rule.messageTemplate,
    recommendationTemplate: rule.recommendationTemplate,
  };
}

export default twinRoutes;
