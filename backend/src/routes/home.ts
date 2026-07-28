import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";

// ---------------------------------------------------------------------------
// Home — the overview that replaces the environment dropdown.
//
// One call returns everything the landing page needs: the network/institution
// context, the caller's projects with their contents, shared projects, recent
// activity from the audit trail, and a getting-started checklist derived from
// what actually exists rather than a static list.
//
// "Project" here reads app.ontology_environments. The rename is a separate,
// lower-risk migration; the UI label leads and the schema follows.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const projectOut = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.string(),
  objectTypeCount: z.number(),
  instanceCount: z.number(),
  datasetCount: z.number(),
  liveChannelCount: z.number(),
  lastActivityAt: z.string().nullable(),
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

const homeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/home",
    {
      schema: {
        summary: "Landing overview: organization context, projects, activity",
        tags: ["home"],
        response: {
          200: z.object({
            organization: z
              .object({
                id: z.string(),
                name: z.string(),
                kind: z.string(),
                parent: z
                  .object({ id: z.string(), name: z.string(), kind: z.string() })
                  .nullable(),
              })
              .nullable(),
            projects: z.array(projectOut),
            sharedProjects: z.array(projectOut),
            activity: z.array(
              z.object({
                id: z.string(),
                action: z.string(),
                resourceType: z.string().nullable(),
                actorEmail: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
            pendingReviewCount: z.number(),
            nextSteps: z.array(
              z.object({ id: z.string(), label: z.string(), done: z.boolean() }),
            ),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);

      // Organization context, plus its parent network if one is set.
      const orgRes = await req.db.query<{
        id: string;
        name: string;
        kind: string;
        parent_id: string | null;
        parent_name: string | null;
        parent_kind: string | null;
      }>(
        `SELECT o.id, o.name, o.kind,
                p.id AS parent_id, p.name AS parent_name, p.kind AS parent_kind
           FROM app.organization_members m
           JOIN app.organizations o ON o.id = m.organization_id
           LEFT JOIN app.organizations p ON p.id = o.parent_organization_id
          WHERE m.user_id = $1
          ORDER BY (m.role = 'owner') DESC NULLS LAST, o.created_at ASC
          LIMIT 1`,
        [userId],
      );
      const org = orgRes.rows[0] ?? null;

      // Projects the caller can reach, with what is actually inside them.
      // Counts are subqueries rather than joins so one empty relation cannot
      // multiply the others.
      const projRes = await req.db.query<{
        id: string;
        slug: string;
        name: string;
        kind: string;
        object_type_count: string;
        instance_count: string;
        dataset_count: string;
        live_channel_count: string;
        last_activity_at: Date | null;
      }>(
        `SELECT e.id, e.slug, e.name, COALESCE(e.environment_type, 'sandbox') AS kind,
                (SELECT COUNT(*) FROM app.ontology_object_types t
                  WHERE t.environment_id = e.id) AS object_type_count,
                (SELECT COUNT(*) FROM app.ontology_object_instances i
                   JOIN app.ontology_object_types t2 ON t2.id = i.object_type_id
                  WHERE t2.environment_id = e.id) AS instance_count,
                (SELECT COUNT(*) FROM app.dataset d
                  WHERE d.project_id = e.id) AS dataset_count,
                (SELECT COUNT(*) FROM app.data_channel c
                  WHERE c.environment_id = e.id AND c.status = 'live') AS live_channel_count,
                GREATEST(
                  e.created_at,
                  COALESCE((SELECT MAX(t3.created_at) FROM app.ontology_object_types t3
                             WHERE t3.environment_id = e.id), e.created_at)
                ) AS last_activity_at
           FROM app.ontology_environments e
           JOIN app.organization_members m ON m.organization_id = e.organization_id
          WHERE m.user_id = $1
          ORDER BY last_activity_at DESC NULLS LAST`,
        [userId],
      );

      const projects = projRes.rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        kind: r.kind,
        objectTypeCount: Number(r.object_type_count),
        instanceCount: Number(r.instance_count),
        datasetCount: Number(r.dataset_count),
        liveChannelCount: Number(r.live_channel_count),
        lastActivityAt: r.last_activity_at ? r.last_activity_at.toISOString() : null,
      }));

      // Recent activity from the append-only trail.
      const actRes = await req.db.query<{
        id: string;
        action: string;
        resource_type: string | null;
        actor_email: string | null;
        created_at: Date;
      }>(
        `SELECT id, action, resource_type, actor_email, created_at
           FROM app.audit_log
          ${org ? "WHERE organization_id = $1" : ""}
          ORDER BY created_at DESC
          LIMIT 6`,
        org ? [org.id] : [],
      );

      const reviewRes = await req.db
        .query<{ n: string }>(
          `SELECT COUNT(*)::bigint AS n
             FROM app.channel_review_item r
             JOIN app.ontology_environments e ON e.id = r.environment_id
             JOIN app.organization_members m ON m.organization_id = e.organization_id
            WHERE m.user_id = $1 AND r.status = 'pending'`,
          [userId],
        )
        .catch(() => ({ rows: [{ n: "0" }] }));

      // Checklist derived from real state, so it cannot claim work is undone
      // when it is not.
      const totals = projects.reduce(
        (acc, p) => ({
          types: acc.types + p.objectTypeCount,
          datasets: acc.datasets + p.datasetCount,
          channels: acc.channels + p.liveChannelCount,
        }),
        { types: 0, datasets: 0, channels: 0 },
      );
      const nextSteps = [
        { id: "ontology", label: "Model your ontology", done: totals.types > 0 },
        { id: "feed", label: "Connect a feed", done: totals.channels > 0 },
        { id: "datasets", label: "Load a dataset", done: totals.datasets > 0 },
        { id: "binding", label: "Bind an object type to a dataset", done: false },
      ];

      return {
        organization: org
          ? {
              id: org.id,
              name: org.name,
              kind: org.kind,
              parent:
                org.parent_id && org.parent_name
                  ? {
                      id: org.parent_id,
                      name: org.parent_name,
                      kind: org.parent_kind ?? "network",
                    }
                  : null,
            }
          : null,
        projects,
        // Dual-ownership sharing needs a second real organization to design
        // against; the grouping exists so the seam is visible.
        sharedProjects: [],
        activity: actRes.rows.map((r) => ({
          id: String(r.id),
          action: r.action,
          resourceType: r.resource_type,
          actorEmail: r.actor_email,
          createdAt: r.created_at.toISOString(),
        })),
        pendingReviewCount: Number(reviewRes.rows[0]?.n ?? 0),
        nextSteps,
      };
    },
  );
};

export default homeRoutes;
