"use client";

/**
 * Administration — organization members with their roles, and the environment
 * inventory. Role changes are audited server-side and surface separation-of-
 * duties conflicts rather than silently allowing them (spec Part 2.2).
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AlertTriangle, Loader2, Settings, Users } from "lucide-react";

import { apiFetch } from "@/lib/auth";

import { useStudio } from "../StudioShell";

interface Member {
  userId: string;
  email: string;
  name: string;
  role: string;
  jobTitle: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES = [
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
];

export default function AdminView() {
  const { hasKey, environments } = useStudio();
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") === "environments" ? "environments" : "members";

  const [members, setMembers] = useState<Member[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<[string, string][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasKey || view !== "members") return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ members: Member[]; organizationName: string | null }>(
        "/v1/admin/members",
      );
      setMembers(res.members);
      setOrgName(res.organizationName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [hasKey, view]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(userId: string, role: string) {
    try {
      const res = await apiFetch<{ dutyConflicts: [string, string][] }>(
        `/v1/admin/members/${userId}`,
        { method: "PATCH", body: { role } },
      );
      setMembers((cur) => cur.map((m) => (m.userId === userId ? { ...m, role } : m)));
      setConflicts(res.dutyConflicts);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!hasKey) {
    return <p className="p-8 text-sm text-[#8f99a8]">Sign in to administer the organization.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-[#d3d8de] bg-white px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e7f2fd] text-[#215db0]">
            {view === "members" ? <Users className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
          </span>
          <h1 className="text-[15px] font-medium">
            {view === "members" ? "Users & roles" : "Environments"}
          </h1>
          {orgName && view === "members" ? (
            <span className="rounded border border-[#d3d8de] px-2 py-0.5 text-[10.5px] text-[#5f6b7c]">
              {orgName}
            </span>
          ) : null}
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#8f99a8]" /> : null}
        </div>
      </header>

      {error ? (
        <p className="mx-5 mt-3 rounded border border-[#f4c0d1] bg-[#fceaef] px-3 py-2 text-xs text-[#a82255]">
          {error}
        </p>
      ) : null}

      {conflicts.length > 0 ? (
        <p className="mx-5 mt-3 flex items-start gap-2 rounded border border-[#f5c4b3] bg-[#fdf0e6] px-3 py-2 text-xs text-[#935610]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Separation of duties: {conflicts.map(([a, b]) => `${a} + ${b}`).join(", ")} are held by
            one identity. Permitted here, but recorded in the audit log — a reviewer should not be
            able to approve their own access grants.
          </span>
        </p>
      ) : null}

      <div className="px-5 py-3">
        {view === "members" ? (
          <div className="overflow-hidden rounded-md border border-[#d3d8de]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f6f7f9] text-[10px] uppercase tracking-wide text-[#8f99a8]">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-3 py-1.5 font-medium">Email</th>
                  <th className="px-3 py-1.5 font-medium">Role</th>
                  <th className="px-3 py-1.5 font-medium">Last login</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="border-t border-[#e5e8eb]">
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-[#1c2127]">{m.name}</span>
                      {m.jobTitle ? (
                        <span className="ml-1.5 text-[11px] text-[#8f99a8]">{m.jobTitle}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-[#5f6b7c]">{m.email}</td>
                    <td className="px-3 py-1.5">
                      <select
                        value={m.role}
                        onChange={(e) => void changeRole(m.userId, e.target.value)}
                        className="rounded border border-[#d3d8de] bg-white px-1.5 py-0.5 text-[11px] focus:border-[#2d72d2] focus:outline-none"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-[#8f99a8]">
                      {m.lastLoginAt
                        ? new Date(m.lastLoginAt).toLocaleDateString("en-CA")
                        : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-1.5">
            {environments.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-md border border-[#d3d8de] bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#1c2127]">{e.name}</p>
                  <p className="truncate font-mono text-[11px] text-[#8f99a8]">{e.slug}</p>
                </div>
                <span className="rounded border border-[#d3d8de] px-2 py-0.5 text-[10.5px] text-[#5f6b7c]">
                  {e.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
