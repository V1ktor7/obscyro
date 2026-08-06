import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { recordAudit } from "../services/audit.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import { resolveEnvironment } from "../services/ontology.js";
import {
  createSignalType,
  createWorkflow,
  dismissSignal,
  getSignal,
  listSignalEvents,
  listSignalTypes,
  listSignals,
  listWorkflows,
  moveSignal,
  raiseSignal,
  renameSignalDomain,
  setSignalTypeAlertMetric,
  stagesForSignal,
} from "../services/signals.js";

// ---------------------------------------------------------------------------
// Signals — the command post's API.
//
// The engine knows how to advance, approve, close and dismiss. It knows nothing
// about wards or stockouts, and neither do these routes: the domains, the
// workflows and their stages arrive as configuration and go back out as data.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const severity = z.enum(["info", "warn", "critical"]);

const stageOut = z.object({
  id: z.string(),
  workflowId: z.string(),
  seq: z.number(),
  key: z.string(),
  name: z.string(),
  requiresApproval: z.boolean(),
  isTerminal: z.boolean(),
});

const workflowOut = z.object({
  id: z.string(),
  organizationId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  stages: z.array(stageOut),
});

const signalTypeOut = z.object({
  id: z.string(),
  organizationId: z.string(),
  key: z.string(),
  name: z.string(),
  domain: z.string(),
  workflowId: z.string(),
  defaultSeverity: severity,
  description: z.string().nullable(),
  active: z.boolean(),
  alertMetric: z.string().nullable(),
});

const signalOut = z.object({
  id: z.string(),
  projectId: z.string(),
  signalTypeId: z.string(),
  stageId: z.string(),
  subjectKind: z.string(),
  subjectId: z.string().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  severity,
  properties: z.record(z.unknown()),
  scenarioId: z.string().nullable(),
  originKind: z.string(),
  dedupeKey: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedReason: z.string().nullable(),
  detectedAt: z.string(),
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

/**
 * A starter set of workflows and signal types.
 *
 * Defaults, not definitions: they are ordinary rows the organization edits or
 * deletes. An empty command post has no way in — the first signal type cannot
 * be created without a workflow, and neither can be crafted from the board.
 */
const STARTER = [
  {
    workflow: {
      key: "triage",
      name: "Triage",
      stages: [
        { key: "detected", name: "Détecté" },
        { key: "assessed", name: "Évalué" },
        { key: "options", name: "Options" },
        { key: "running", name: "En cours" },
        { key: "resolved", name: "Résolu", isTerminal: true },
      ],
    },
    types: [
      // `occupancy` is the seeded metric definition's key. It used to read
      // `occupancyPct`, the name of the hard-coded field that preceded the
      // metric table — which meant an alert on the metric found no signal type
      // and reached nobody, silently.
      { key: "occupancy", name: "Occupation élevée", domain: "Flux patient", severity: "critical", alertMetric: "occupancy" },
      { key: "discharge_delay", name: "Congé retardé", domain: "Flux patient", severity: "info" },
      { key: "diversion", name: "Détournement d'ambulance", domain: "Accès & demande", severity: "critical" },
    ],
  },
  {
    workflow: {
      key: "ipac",
      name: "Prévention et contrôle des infections",
      stages: [
        { key: "suspected", name: "Suspecté" },
        { key: "investigated", name: "Investigué" },
        { key: "measures", name: "Mesures", requiresApproval: true },
        { key: "watch", name: "Surveillance" },
        { key: "lifted", name: "Levé", isTerminal: true },
      ],
    },
    types: [
      { key: "cluster", name: "Grappe suspectée", domain: "Clinique / éclosion", severity: "warn" },
      { key: "confirmed_case", name: "Cas confirmé", domain: "Clinique / éclosion", severity: "critical" },
    ],
  },
  {
    workflow: {
      key: "technical",
      name: "Technique",
      stages: [
        { key: "detected", name: "Détecté" },
        { key: "diagnosed", name: "Diagnostiqué" },
        { key: "fixed", name: "Corrigé" },
        { key: "verified", name: "Vérifié", isTerminal: true },
      ],
    },
    types: [
      { key: "feed_stalled", name: "Flux arrêté", domain: "Données & systèmes", severity: "critical", alertMetric: "freshnessSeconds" },
      { key: "data_quality", name: "Qualité dégradée", domain: "Données & systèmes", severity: "warn" },
      { key: "equipment_down", name: "Équipement hors service", domain: "Équipement", severity: "warn" },
    ],
  },
  {
    workflow: {
      key: "logistics",
      name: "Logistique",
      stages: [
        { key: "detected", name: "Détecté" },
        { key: "confirmed", name: "Confirmé" },
        { key: "substitution", name: "Substitution", requiresApproval: true },
        { key: "ordered", name: "Commandé" },
        { key: "received", name: "Reçu", isTerminal: true },
      ],
    },
    types: [
      { key: "stockout", name: "Rupture de stock", domain: "Approvisionnement", severity: "critical" },
      { key: "cold_chain", name: "Chaîne de froid rompue", domain: "Approvisionnement", severity: "warn" },
    ],
  },
  {
    workflow: {
      key: "workforce",
      name: "Effectifs",
      stages: [
        { key: "detected", name: "Détecté" },
        { key: "coverable", name: "Couvert ?" },
        { key: "replacement", name: "Remplacement", requiresApproval: true },
        { key: "filled", name: "Comblé", isTerminal: true },
      ],
    },
    types: [
      { key: "understaffed", name: "Effectif sous seuil", domain: "Personnel", severity: "critical" },
      { key: "uncovered_shift", name: "Quart non comblé", domain: "Personnel", severity: "warn" },
    ],
  },
] as const;

const signalRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- configuration ---------------------------------------------------------

  app.get(
    "/ontology/:env/workflows",
    {
      schema: {
        summary: "Workflows defined by this organization",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ workflows: z.array(workflowOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { workflows: await listWorkflows(req.db, env.organizationId) };
    },
  );

  app.post(
    "/ontology/:env/workflows",
    {
      schema: {
        summary: "Define a workflow and its stages",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          key: z.string().min(1).max(64),
          name: z.string().min(1),
          description: z.string().optional(),
          stages: z
            .array(
              z.object({
                key: z.string().min(1).max(64),
                name: z.string().min(1),
                requiresApproval: z.boolean().optional(),
                isTerminal: z.boolean().optional(),
              }),
            )
            .min(2),
        }),
        response: { 201: workflowOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const wf = await createWorkflow(req.db, {
        organizationId: env.organizationId,
        key: req.body.key,
        name: req.body.name,
        description: req.body.description ?? null,
        stages: req.body.stages,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "workflow.create",
        resourceType: "workflow",
        resourceId: wf.id,
        metadata: { key: wf.key, stages: wf.stages.length },
      });
      return reply.code(201).send(wf);
    },
  );

  app.get(
    "/ontology/:env/signal-types",
    {
      schema: {
        summary: "Signal types defined by this organization",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1) }),
        response: { 200: z.object({ signalTypes: z.array(signalTypeOut) }), 404: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      return { signalTypes: await listSignalTypes(req.db, env.organizationId) };
    },
  );

  app.post(
    "/ontology/:env/signal-types",
    {
      schema: {
        summary: "Define a signal type",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          key: z.string().min(1).max(64),
          name: z.string().min(1),
          // Free text on purpose: a closed list would assume every kind of
          // thing that can go wrong in a health network is known in advance.
          domain: z.string().min(1).max(120),
          workflowId: z.string().uuid(),
          defaultSeverity: severity.optional(),
          description: z.string().optional(),
          // Wiring a twin-alert metric here is what makes signals appear on
          // their own. Left null, this type is only ever raised by hand.
          alertMetric: z.string().max(120).nullable().optional(),
        }),
        response: { 201: signalTypeOut, 400: errorEnvelope, 404: errorEnvelope },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const t = await createSignalType(req.db, {
        organizationId: env.organizationId,
        key: req.body.key,
        name: req.body.name,
        domain: req.body.domain,
        workflowId: req.body.workflowId,
        defaultSeverity: req.body.defaultSeverity,
        description: req.body.description ?? null,
        alertMetric: req.body.alertMetric ?? null,
      });
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "signal_type.create",
        resourceType: "signal_type",
        resourceId: t.id,
        metadata: { key: t.key, domain: t.domain },
      });
      return reply.code(201).send(t);
    },
  );

  app.patch(
    "/ontology/:env/signal-types/:key/alert-metric",
    {
      schema: {
        summary: "Point a signal type at a twin metric, or unhook it",
        description:
          "This is the join the alert bridge makes. A threshold defined on a " +
          "metric no signal type claims raises an alert that reaches nobody — " +
          "silently. Null unhooks the type, leaving it raised only by hand.",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1), key: z.string().min(1).max(64) }),
        body: z.object({ alertMetric: z.string().max(120).nullable() }),
        response: { 200: signalTypeOut, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const t = await setSignalTypeAlertMetric(
        req.db,
        env.organizationId,
        req.params.key,
        req.body.alertMetric,
      );
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "signal_type.set_alert_metric",
        resourceType: "signal_type",
        resourceId: t.id,
        metadata: { key: t.key, alertMetric: t.alertMetric },
      });
      return t;
    },
  );

  app.patch(
    "/ontology/:env/signal-domains/:domain",
    {
      schema: {
        summary: "Rename a domain across the signal types that carry it",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1), domain: z.string().min(1) }),
        body: z.object({ name: z.string().min(1).max(120) }),
        response: {
          200: z.object({ domain: z.string(), signalTypes: z.number() }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const moved = await renameSignalDomain(
        req.db,
        env.organizationId,
        req.params.domain,
        req.body.name,
      );
      if (moved === 0) {
        throw NotFound("DOMAIN_NOT_FOUND", "No signal type uses that domain.");
      }
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "signal_domain.rename",
        resourceType: "organization",
        resourceId: env.organizationId,
        metadata: { from: req.params.domain, to: req.body.name, signalTypes: moved },
      });
      return { domain: req.body.name, signalTypes: moved };
    },
  );

  app.post(
    "/ontology/:env/signal-config/seed",
    {
      schema: {
        summary: "Install a starter set of workflows and signal types (editable afterwards)",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1) }),
        response: {
          200: z.object({
            workflows: z.number(),
            signalTypes: z.number(),
            note: z.string(),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      let types = 0;
      for (const block of STARTER) {
        const wf = await createWorkflow(req.db, {
          organizationId: env.organizationId,
          key: block.workflow.key,
          name: block.workflow.name,
          stages: block.workflow.stages.map((s) => ({
            key: s.key,
            name: s.name,
            requiresApproval: "requiresApproval" in s ? s.requiresApproval : false,
            isTerminal: "isTerminal" in s ? s.isTerminal : false,
          })),
        });
        for (const t of block.types) {
          await createSignalType(req.db, {
            organizationId: env.organizationId,
            key: t.key,
            name: t.name,
            domain: t.domain,
            workflowId: wf.id,
            defaultSeverity: t.severity,
            alertMetric: "alertMetric" in t ? t.alertMetric : null,
          });
          types++;
        }
      }
      await recordAudit(req.db, {
        projectId: env.id,
        actorUserId: userId,
        action: "signal_config.seed",
        resourceType: "organization",
        resourceId: env.organizationId,
        metadata: { workflows: STARTER.length, signalTypes: types },
      });
      return {
        workflows: STARTER.length,
        signalTypes: types,
        note: "Starter set — ordinary rows. Rename, re-stage or delete them; nothing in the engine depends on these names.",
      };
    },
  );

  // --- the board -------------------------------------------------------------

  // One call rather than four. The board needs the configuration and the open
  // signals together, and fetching them separately would render a tableau whose
  // columns arrive after its cards.
  app.get(
    "/ontology/:env/command-board",
    {
      schema: {
        summary: "Everything the command post needs: config plus open signals",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1) }),
        querystring: z.object({
          includeClosed: z.coerce.boolean().default(false),
          scenarioId: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            domains: z.array(z.object({ domain: z.string(), open: z.number(), critical: z.number() })),
            workflows: z.array(workflowOut),
            signalTypes: z.array(signalTypeOut),
            signals: z.array(
              signalOut.extend({
                domain: z.string(),
                signalTypeName: z.string(),
                stageKey: z.string(),
                workflowId: z.string(),
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

      const [workflows, signalTypes, raw] = await Promise.all([
        listWorkflows(req.db, env.organizationId),
        listSignalTypes(req.db, env.organizationId),
        listSignals(req.db, env.id, {
          includeClosed: req.query.includeClosed,
          scenarioId: req.query.scenarioId ?? null,
        }),
      ]);

      const typeById = new Map(signalTypes.map((t) => [t.id, t]));
      const stageById = new Map(workflows.flatMap((w) => w.stages).map((s) => [s.id, s]));

      const signals = raw
        // A signal whose type or stage was deleted cannot be placed on a board.
        // Dropping it here beats rendering a card in no column.
        .filter((s) => typeById.has(s.signalTypeId) && stageById.has(s.stageId))
        .map((s) => {
          const t = typeById.get(s.signalTypeId)!;
          return {
            ...s,
            domain: t.domain,
            signalTypeName: t.name,
            stageKey: stageById.get(s.stageId)!.key,
            workflowId: t.workflowId,
          };
        });

      const byDomain = new Map<string, { open: number; critical: number }>();
      for (const t of signalTypes) {
        if (!byDomain.has(t.domain)) byDomain.set(t.domain, { open: 0, critical: 0 });
      }
      for (const s of signals) {
        if (s.closedAt) continue;
        const d = byDomain.get(s.domain) ?? { open: 0, critical: 0 };
        d.open++;
        if (s.severity === "critical") d.critical++;
        byDomain.set(s.domain, d);
      }

      return {
        domains: Array.from(byDomain, ([domain, v]) => ({ domain, ...v })).sort((a, b) =>
          b.critical - a.critical || b.open - a.open || a.domain.localeCompare(b.domain),
        ),
        workflows,
        signalTypes,
        signals,
      };
    },
  );

  // --- signals ---------------------------------------------------------------

  app.post(
    "/ontology/:env/signals",
    {
      schema: {
        summary: "Raise a signal",
        tags: ["signals"],
        params: z.object({ env: z.string().min(1) }),
        body: z.object({
          signalTypeId: z.string().uuid(),
          title: z.string().min(1),
          detail: z.string().optional(),
          severity: severity.optional(),
          subjectKind: z
            .enum(["none", "object_instance", "dataset", "source", "sync", "pipeline", "object_type", "model"])
            .optional(),
          subjectId: z.string().uuid().nullable().optional(),
          properties: z.record(z.unknown()).optional(),
          scenarioId: z.string().uuid().nullable().optional(),
          dedupeKey: z.string().max(200).nullable().optional(),
        }),
        response: {
          201: z.object({ signal: signalOut, created: z.boolean() }),
          400: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req, reply) => {
      const userId = await requireUserId(req);
      const env = await resolveEnvironment(req.db, userId, req.params.env);
      const result = await raiseSignal(req.db, {
        projectId: env.id,
        signalTypeId: req.body.signalTypeId,
        title: req.body.title,
        detail: req.body.detail ?? null,
        severity: req.body.severity,
        subjectKind: req.body.subjectKind,
        subjectId: req.body.subjectId ?? null,
        properties: req.body.properties,
        scenarioId: req.body.scenarioId ?? null,
        originKind: "manual",
        dedupeKey: req.body.dedupeKey ?? null,
        actorUserId: userId,
      });
      if (result.created) {
        await recordAudit(req.db, {
          projectId: env.id,
          actorUserId: userId,
          action: "signal.raise",
          resourceType: "signal",
          resourceId: result.signal.id,
          metadata: { title: result.signal.title, severity: result.signal.severity },
        });
      }
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/signals/:id",
    {
      schema: {
        summary: "One signal, its workflow and its trail",
        tags: ["signals"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            signal: signalOut,
            stages: z.array(stageOut),
            events: z.array(
              z.object({
                id: z.string(),
                signalId: z.string(),
                seq: z.number(),
                kind: z.string(),
                fromStageId: z.string().nullable(),
                toStageId: z.string().nullable(),
                actorUserId: z.string().nullable(),
                note: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      await requireUserId(req);
      const [signal, stages, events] = await Promise.all([
        getSignal(req.db, req.params.id),
        stagesForSignal(req.db, req.params.id),
        listSignalEvents(req.db, req.params.id),
      ]);
      return { signal, stages, events };
    },
  );

  app.post(
    "/signals/:id/move",
    {
      schema: {
        summary: "Move a signal one stage forward or back",
        tags: ["signals"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          direction: z.enum(["forward", "back"]),
          note: z.string().max(500).optional(),
          reason: z.string().max(500).optional(),
        }),
        response: { 200: signalOut, 400: errorEnvelope, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const signal = await moveSignal(req.db, req.params.id, req.body.direction, {
        actorUserId: userId,
        note: req.body.note ?? null,
        reason: req.body.reason ?? null,
      });
      await recordAudit(req.db, {
        projectId: signal.projectId,
        actorUserId: userId,
        action: `signal.${req.body.direction}`,
        resourceType: "signal",
        resourceId: signal.id,
        metadata: { stageId: signal.stageId, closed: Boolean(signal.closedAt) },
      });
      return signal;
    },
  );

  app.post(
    "/signals/:id/dismiss",
    {
      schema: {
        summary: "Close a signal as a false positive",
        tags: ["signals"],
        params: z.object({ id: z.string().uuid() }),
        // The reason is required by the engine, so it is required here rather
        // than defaulted — a dismissal with no reason teaches nothing about the
        // rule that produced it.
        body: z.object({ reason: z.string().min(1).max(500) }),
        response: { 200: signalOut, 400: errorEnvelope, 404: errorEnvelope, 409: errorEnvelope },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const signal = await dismissSignal(req.db, req.params.id, {
        actorUserId: userId,
        reason: req.body.reason,
      });
      await recordAudit(req.db, {
        projectId: signal.projectId,
        actorUserId: userId,
        action: "signal.dismiss",
        resourceType: "signal",
        resourceId: signal.id,
        metadata: { reason: req.body.reason },
      });
      return signal;
    },
  );
};

export default signalRoutes;
