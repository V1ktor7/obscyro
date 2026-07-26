import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { AppError, NotFound } from "../lib/errors.js";
import { resolveUserIdForApiKey } from "../services/login.js";
import {
  PLATFORM_ROLES,
  conflictingRoles,
  listAudit,
  recordAudit,
} from "../services/audit.js";

// ---------------------------------------------------------------------------
// Administration + Governance (spec Part 2.2, Part 7).
//
// Serves the identity the shell needs (who am I, what may I see), the member /
// role management surface, and the audit explorer. Access checks are enforced
// here on the server — the client hiding a nav entry is presentation only.
// ---------------------------------------------------------------------------

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const roleEnum = z.enum(PLATFORM_ROLES);

/** Roles that may administer members and read the audit trail. */
const ADMIN_ROLES = new Set(["owner", "administrator", "security_administrator"]);
const AUDIT_ROLES = new Set(["owner", "administrator", "auditor", "security_administrator"]);

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

interface Identity {
  userId: string;
  email: string;
  name: string;
  locale: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  roles: string[];
}

/** Resolve the caller's identity and org roles in one query. */
async function getIdentity(db: DbClient, userId: string): Promise<Identity> {
  const { rows } = await db.query<{
    email: string;
    name: string;
    locale: string;
    organization_id: string | null;
    org_name: string | null;
    org_slug: string | null;
    role: string | null;
  }>(
    `SELECT u.email, u.name, u.locale,
            o.id AS organization_id, o.name AS org_name, o.slug AS org_slug,
            m.role
       FROM app.users u
       LEFT JOIN app.organization_members m ON m.user_id = u.id
       LEFT JOIN app.organizations o ON o.id = m.organization_id
      WHERE u.id = $1
      ORDER BY (m.role = 'owner') DESC NULLS LAST`,
    [userId],
  );
  const first = rows[0];
  if (!first) throw NotFound("USER_NOT_FOUND", "User not found.");
  return {
    userId,
    email: first.email,
    name: first.name,
    locale: first.locale,
    organizationId: first.organization_id,
    organizationName: first.org_name,
    organizationSlug: first.org_slug,
    roles: rows.map((r) => r.role).filter((r): r is string => Boolean(r)),
  };
}

function assertRole(identity: Identity, allowed: Set<string>, action: string): void {
  if (!identity.roles.some((r) => allowed.has(r))) {
    throw new AppError("FORBIDDEN", `Your role does not permit ${action}.`, 403);
  }
}

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // --- Identity: drives role-filtered navigation in the shell ---------------
  app.get(
    "/me",
    {
      schema: {
        summary: "Current user identity, organization, and effective roles",
        tags: ["admin"],
        response: {
          200: z.object({
            userId: z.string(),
            email: z.string(),
            name: z.string(),
            locale: z.string(),
            organizationId: z.string().nullable(),
            organizationName: z.string().nullable(),
            organizationSlug: z.string().nullable(),
            roles: z.array(z.string()),
            capabilities: z.array(z.string()),
            dutyConflicts: z.array(z.tuple([z.string(), z.string()])),
          }),
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const id = await getIdentity(req.db, userId);
      // Capabilities are what the client uses to show/hide nav sections.
      const caps = new Set<string>();
      const has = (r: string) => id.roles.includes(r);
      if (has("owner") || has("administrator")) {
        for (const c of ["data", "pipelines", "ontology", "models", "twin", "health", "govern", "admin"]) {
          caps.add(c);
        }
      }
      if (has("data_engineer")) {
        caps.add("data");
        caps.add("pipelines");
        caps.add("health");
      }
      if (has("ontology_editor") || has("ontology_viewer")) caps.add("ontology");
      if (has("model_developer") || has("model_approver")) caps.add("models");
      if (has("analyst")) {
        caps.add("ontology");
        caps.add("health");
      }
      if (has("auditor") || has("security_administrator")) caps.add("govern");
      if (has("security_administrator")) caps.add("admin");
      return {
        ...id,
        capabilities: [...caps].sort(),
        dutyConflicts: conflictingRoles(id.roles),
      };
    },
  );

  // --- Members and roles ----------------------------------------------------
  app.get(
    "/admin/members",
    {
      schema: {
        summary: "List organization members with their roles",
        tags: ["admin"],
        response: {
          200: z.object({
            members: z.array(
              z.object({
                userId: z.string(),
                email: z.string(),
                name: z.string(),
                role: z.string(),
                jobTitle: z.string().nullable(),
                lastLoginAt: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
            organizationName: z.string().nullable(),
          }),
          403: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const id = await getIdentity(req.db, userId);
      assertRole(id, ADMIN_ROLES, "listing members");
      const { rows } = await req.db.query<{
        user_id: string;
        email: string;
        name: string;
        role: string;
        job_title: string | null;
        last_login_at: Date | null;
        created_at: Date;
      }>(
        `SELECT u.id AS user_id, u.email, u.name, m.role, u.job_title,
                u.last_login_at, m.created_at
           FROM app.organization_members m
           JOIN app.users u ON u.id = m.user_id
          WHERE m.organization_id = $1
          ORDER BY m.created_at ASC`,
        [id.organizationId],
      );
      await recordAudit(req.db, {
        organizationId: id.organizationId,
        actorUserId: userId,
        actorEmail: id.email,
        action: "admin.members.list",
        resourceType: "organization",
        resourceId: id.organizationId,
        metadata: { count: rows.length },
      });
      return {
        organizationName: id.organizationName,
        members: rows.map((r) => ({
          userId: r.user_id,
          email: r.email,
          name: r.name,
          role: r.role,
          jobTitle: r.job_title,
          lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
  );

  app.patch(
    "/admin/members/:userId",
    {
      schema: {
        summary: "Change a member's role (audited; flags duty conflicts)",
        tags: ["admin"],
        params: z.object({ userId: z.string().uuid() }),
        body: z.object({ role: roleEnum }),
        response: {
          200: z.object({
            userId: z.string(),
            role: z.string(),
            dutyConflicts: z.array(z.tuple([z.string(), z.string()])),
          }),
          403: errorEnvelope,
          404: errorEnvelope,
        },
      },
    },
    async (req) => {
      const actorId = await requireUserId(req);
      const id = await getIdentity(req.db, actorId);
      assertRole(id, ADMIN_ROLES, "changing roles");

      const before = await req.db.query<{ role: string }>(
        `SELECT role FROM app.organization_members
          WHERE organization_id = $1 AND user_id = $2`,
        [id.organizationId, req.params.userId],
      );
      if (!before.rows[0]) throw NotFound("MEMBER_NOT_FOUND", "Member not found.");

      await req.db.query(
        `UPDATE app.organization_members SET role = $3
          WHERE organization_id = $1 AND user_id = $2`,
        [id.organizationId, req.params.userId, req.body.role],
      );

      const after = await req.db.query<{ role: string }>(
        `SELECT role FROM app.organization_members WHERE user_id = $1`,
        [req.params.userId],
      );
      const conflicts = conflictingRoles(after.rows.map((r) => r.role));

      await recordAudit(req.db, {
        organizationId: id.organizationId,
        actorUserId: actorId,
        actorEmail: id.email,
        action: "admin.role.grant",
        resourceType: "user",
        resourceId: req.params.userId,
        metadata: {
          from: before.rows[0].role,
          to: req.body.role,
          dutyConflicts: conflicts,
        },
      });

      return { userId: req.params.userId, role: req.body.role, dutyConflicts: conflicts };
    },
  );

  // --- Governance: audit explorer ------------------------------------------
  app.get(
    "/governance/audit",
    {
      schema: {
        summary: "Read the append-only audit trail",
        tags: ["governance"],
        querystring: z.object({
          action: z.string().optional(),
          outcome: z.enum(["success", "denied", "error"]).optional(),
          since: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        response: {
          200: z.object({
            events: z.array(
              z.object({
                id: z.string(),
                actorEmail: z.string().nullable(),
                action: z.string(),
                resourceType: z.string().nullable(),
                resourceId: z.string().nullable(),
                outcome: z.string(),
                metadata: z.record(z.unknown()),
                ip: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
            appendOnly: z.literal(true),
          }),
          403: errorEnvelope,
        },
      },
    },
    async (req) => {
      const userId = await requireUserId(req);
      const id = await getIdentity(req.db, userId);
      assertRole(id, AUDIT_ROLES, "reading the audit log");
      const events = await listAudit(req.db, {
        organizationId: id.organizationId,
        action: req.query.action,
        outcome: req.query.outcome,
        since: req.query.since,
        limit: req.query.limit,
      });
      return { events, appendOnly: true as const };
    },
  );
};

export default adminRoutes;
