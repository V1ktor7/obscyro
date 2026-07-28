import type { DbClient } from "../lib/db.js";

// ---------------------------------------------------------------------------
// Audit logging (spec Part 7.1/7.2).
//
// Every privileged read, write, export, and permission change emits an event.
// The table is append-only at the database level, so an actor with full access
// still cannot erase evidence of what they did.
//
// PHI RULE: metadata carries identifiers, names of resources, and counts —
// never patient content. Callers must not pass free text from a payload.
// ---------------------------------------------------------------------------

export type AuditOutcome = "success" | "denied" | "error";

export interface AuditEvent {
  organizationId?: string | null;
  environmentId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  /** Dot-form verb, e.g. ontology.type.create, admin.role.grant. */
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome?: AuditOutcome;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Write one audit event. Never throws — a failure to audit must not break the
 * user's operation, but it is logged loudly by the caller's logger if needed.
 */
export async function recordAudit(db: DbClient, event: AuditEvent): Promise<void> {
  await db
    .query(
      `INSERT INTO app.audit_log
              (organization_id, project_id, actor_user_id, actor_email,
               action, resource_type, resource_id, outcome, metadata, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      [
        event.organizationId ?? null,
        event.environmentId ?? null,
        event.actorUserId ?? null,
        event.actorEmail ?? null,
        event.action,
        event.resourceType ?? null,
        event.resourceId ?? null,
        event.outcome ?? "success",
        JSON.stringify(event.metadata ?? {}),
        event.ip ?? null,
        event.userAgent ?? null,
      ],
    )
    .catch(() => undefined);
}

export interface AuditQuery {
  organizationId?: string | null;
  actorUserId?: string;
  action?: string;
  outcome?: AuditOutcome;
  since?: string;
  limit: number;
}

export interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

/** Read the audit trail, newest first, with optional facets. */
export async function listAudit(db: DbClient, q: AuditQuery): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.organizationId) {
    params.push(q.organizationId);
    where.push(`organization_id = $${params.length}`);
  }
  if (q.actorUserId) {
    params.push(q.actorUserId);
    where.push(`actor_user_id = $${params.length}`);
  }
  if (q.action) {
    params.push(`${q.action}%`);
    where.push(`action LIKE $${params.length}`);
  }
  if (q.outcome) {
    params.push(q.outcome);
    where.push(`outcome = $${params.length}`);
  }
  if (q.since) {
    params.push(q.since);
    where.push(`created_at >= $${params.length}`);
  }
  params.push(q.limit);

  const { rows } = await db.query<{
    id: string;
    actor_email: string | null;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    outcome: string;
    metadata: Record<string, unknown>;
    ip: string | null;
    created_at: Date;
  }>(
    `SELECT id, actor_email, action, resource_type, resource_id, outcome,
            metadata, ip, created_at
       FROM app.audit_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: String(r.id),
    actorEmail: r.actor_email,
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    outcome: r.outcome,
    metadata: r.metadata ?? {},
    ip: r.ip,
    createdAt: r.created_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Roles (spec Part 2.2)
// ---------------------------------------------------------------------------

export const PLATFORM_ROLES = [
  "owner",
  "administrator",
  "security_administrator",
  "auditor",
  "data_engineer",
  "ontology_editor",
  "ontology_viewer",
  "model_developer",
  "model_approver",
  "data_steward",
  "app_builder",
  "app_user",
  "analyst",
  "guest",
  "member",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Roles that must not be held by the same identity without a documented
 * exception: a Security Administrator grants access, an Auditor reviews it.
 * One person holding both can grant themselves data and review their own trail.
 */
export const SEPARATION_OF_DUTIES: Array<[PlatformRole, PlatformRole]> = [
  ["security_administrator", "auditor"],
];

export function conflictingRoles(roles: string[]): Array<[string, string]> {
  const held = new Set(roles);
  return SEPARATION_OF_DUTIES.filter(([a, b]) => held.has(a) && held.has(b));
}
