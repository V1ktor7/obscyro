import type { DbClient } from "../lib/db.js";

import { NotFound } from "../lib/errors.js";

export type OrganizationRole = "owner" | "member";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdAt: Date;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function uniqueOrgSlug(base: string, userId: string): string {
  const stem = slugify(base) || "org";
  return `${stem}-${userId.slice(0, 8)}`;
}

/** All organizations the user belongs to (v1: typically one). */
export async function resolveOrganizationsForUser(
  db: DbClient,
  userId: string,
): Promise<OrganizationRow[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    slug: string;
    role: OrganizationRole;
    created_at: Date;
  }>(
    `SELECT o.id, o.name, o.slug, om.role, o.created_at
       FROM app.organizations o
       JOIN app.organization_members om ON om.organization_id = o.id
      WHERE om.user_id = $1
      ORDER BY o.name ASC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    role: r.role,
    createdAt: r.created_at,
  }));
}

/**
 * v1: returns the user's first org by name. Multi-org selection is deferred.
 */
export async function resolvePrimaryOrganization(
  db: DbClient,
  userId: string,
): Promise<OrganizationRow> {
  const orgs = await resolveOrganizationsForUser(db, userId);
  if (orgs.length === 0) {
    throw NotFound("ORG_NOT_FOUND", "No organization found for this user.");
  }
  return orgs[0]!;
}

/** Auto-provision an org on first API use when migration backfill did not run. */
export async function ensureUserOrganization(
  db: DbClient,
  userId: string,
): Promise<OrganizationRow> {
  const existing = await resolveOrganizationsForUser(db, userId);
  if (existing.length > 0) return existing[0]!;

  const { rows: userRows } = await db.query<{
    name: string;
    company: string | null;
    email: string;
  }>("SELECT name, company, email FROM app.users WHERE id = $1", [userId]);
  const user = userRows[0];
  if (!user) {
    throw NotFound("USER_NOT_FOUND", "User not found.");
  }

  const orgName =
    user.company?.trim() || user.name || user.email.split("@")[0] || "Organization";
  const orgSlug = uniqueOrgSlug(orgName, userId);

  const { rows: orgRows } = await db.query<{
    id: string;
    name: string;
    slug: string;
    created_at: Date;
  }>(
    `INSERT INTO app.organizations (name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, slug, created_at`,
    [orgName, orgSlug],
  );
  const org = orgRows[0]!;

  await db.query(
    `INSERT INTO app.organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [org.id, userId],
  );

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: "owner",
    createdAt: org.created_at,
  };
}
