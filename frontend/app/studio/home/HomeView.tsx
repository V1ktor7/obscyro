"use client";

/**
 * Home — the landing overview that replaces the environment dropdown.
 *
 * Shows the network/institution context, the caller's projects with what is
 * inside them, the shared-project seam, recent activity from the audit trail,
 * and a checklist derived from real state. Clicking a project enters it; the
 * breadcrumb is the way back out.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Network,
  Building2,
  Check,
  ChevronRight,
  Circle,
  Box,
  FolderPlus,
  Loader2,
  Lock,
  Plus,
  Star,
  UsersRound,
} from "lucide-react";

import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/cn";

import { useStudio } from "../StudioShell";

interface HomeProject {
  id: string;
  slug: string;
  name: string;
  kind: string;
  objectTypeCount: number;
  instanceCount: number;
  datasetCount: number;
  liveChannelCount: number;
  lastActivityAt: string | null;
}

interface HomePayload {
  organization: {
    id: string;
    name: string;
    kind: string;
    parent: { id: string; name: string; kind: string } | null;
  } | null;
  projects: HomeProject[];
  sharedProjects: HomeProject[];
  activity: {
    id: string;
    action: string;
    resourceType: string | null;
    actorEmail: string | null;
    createdAt: string;
  }[];
  pendingReviewCount: number;
  nextSteps: { id: string; label: string; done: boolean }[];
}

/** Project kind -> badge tone. Mirrors the environment badge in the shell. */
function kindTone(kind: string): { bg: string; text: string; label: string } {
  if (kind === "operations") {
    return { bg: "bg-[#fdf0e6]", text: "text-[#935610]", label: "PRODUCTION" };
  }
  if (kind === "reference") {
    return { bg: "bg-[#e7f2fd]", text: "text-[#215db0]", label: "REFERENCE" };
  }
  return { bg: "bg-[#e8f4ec]", text: "text-[#1c6e42]", label: "SANDBOX" };
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function HomeView() {
  const { hasKey, setSelectedEnv, refreshEnvironments } = useStudio();
  const router = useRouter();

  const [data, setData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!hasKey) {
      setLoading(false);
      return;
    }
    try {
      setData(await apiFetch<HomePayload>("/v1/home"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [hasKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Entering a project scopes every downstream section to it. */
  function open(project: HomeProject) {
    setSelectedEnv(project.slug);
    router.push("/studio/manager?view=discover");
  }

  async function handleNewProject() {
    const name = window.prompt("Project name");
    if (!name?.trim()) return;
    setCreating(true);
    try {
      await apiFetch("/v1/ontology/environments", {
        method: "POST",
        body: { name: name.trim(), type: "sandbox" },
      });
      await refreshEnvironments();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (!hasKey) {
    return <p className="p-8 text-sm text-[#8f99a8]">Sign in to see your projects.</p>;
  }
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#8f99a8]" />
      </div>
    );
  }

  const org = data?.organization ?? null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
      {error ? (
        <p className="mb-3 rounded border border-[#f4c0d1] bg-[#fceaef] px-3 py-2 text-xs text-[#a82255]">
          {error}
        </p>
      ) : null}

      {/* Context bar: which legal boundary you are inside */}
      {org ? (
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-[#d3d8de] bg-[#f6f7f9] px-3 py-2">
          {org.parent ? (
            <>
              <Network className="h-4 w-4 text-[#5f6b7c]" />
              <span className="font-medium">{org.parent.name}</span>
              <Badge className="border border-[#d3d8de] bg-white text-[#5f6b7c]">
                NETWORK
              </Badge>
              <ChevronRight className="h-3.5 w-3.5 text-[#8f99a8]" />
            </>
          ) : null}
          <Building2 className="h-4 w-4 text-[#215db0]" />
          <span className="font-medium text-[#215db0]">{org.name}</span>
          <Badge className="bg-[#e7f2fd] text-[#215db0]">
            {org.kind === "network" ? "NETWORK" : "INSTITUTION"} · YOUR ORG
          </Badge>
          <span className="ml-auto text-[10.5px] text-[#8f99a8]">
            custodian of everything below
          </span>
        </div>
      ) : null}

      {/* Projects */}
      <div className="mb-2 flex items-baseline gap-2">
        <h1 className="text-[15px] font-medium">Your projects</h1>
        <span className="text-[11px] text-[#8f99a8]">{data?.projects.length ?? 0}</span>
        <button
          type="button"
          onClick={() => void handleNewProject()}
          disabled={creating}
          className="ml-auto flex items-center gap-1 text-[11.5px] text-[#215db0] hover:underline disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          New project
        </button>
      </div>

      {data && data.projects.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
          {data.projects.map((p) => {
            const tone = kindTone(p.kind);
            const empty = p.objectTypeCount === 0 && p.datasetCount === 0;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => open(p)}
                className={cn(
                  "rounded-xl border bg-white p-3 text-left transition-colors hover:border-[#2d72d2]",
                  empty ? "border-dashed border-[#d3d8de]" : "border-[#d3d8de]",
                )}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <FolderPlus className="h-[15px] w-[15px] text-[#215db0]" />
                  <span className="truncate font-medium">{p.name}</span>
                  {p.liveChannelCount > 0 ? (
                    <Star className="ml-auto h-3 w-3 fill-[#d97706] text-[#d97706]" />
                  ) : null}
                </div>
                <Badge className={cn(tone.bg, tone.text)}>{tone.label}</Badge>
                {empty ? (
                  <>
                    <p className="mt-1.5 text-[11px] text-[#8f99a8]">Nothing here yet.</p>
                    <p className="mt-1 text-[11px] text-[#215db0]">Import a dataset →</p>
                  </>
                ) : (
                  <>
                    <p className="mt-1.5 text-[11px] text-[#5f6b7c]">
                      {p.objectTypeCount} object types · {p.instanceCount.toLocaleString()}{" "}
                      instances
                    </p>
                    <p className="text-[11px] text-[#5f6b7c]">
                      {p.datasetCount} dataset{p.datasetCount === 1 ? "" : "s"}
                      {p.liveChannelCount > 0 ? ` · ${p.liveChannelCount} channel live` : ""}
                    </p>
                    <p className="mt-1 text-[10.5px] text-[#8f99a8]">{ago(p.lastActivityAt)}</p>
                  </>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#d3d8de] bg-[#f6f7f9] px-6 py-10 text-center">
          <p className="text-sm font-medium text-[#1c2127]">Create your first project</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#5f6b7c]">
            A project holds your datasets, pipelines, and the object types that model your
            domain. Everything you build lives inside one.
          </p>
        </div>
      )}

      {/* Shared seam */}
      <div className="mb-2 mt-4 flex items-baseline gap-2">
        <h2 className="text-[15px] font-medium">Shared in this network</h2>
        <span className="text-[11px] text-[#8f99a8]">{data?.sharedProjects.length ?? 0}</span>
      </div>
      {data && data.sharedProjects.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
          {data.sharedProjects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => open(p)}
              className="rounded-xl border border-[#b5d4f4] bg-[#e7f2fd] p-3 text-left"
            >
              <div className="flex items-center gap-1.5">
                <UsersRound className="h-[15px] w-[15px] text-[#215db0]" />
                <span className="truncate font-medium text-[#215db0]">{p.name}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-[#d3d8de] bg-white px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 text-xs text-[#5f6b7c]">
            <Lock className="h-3.5 w-3.5 text-[#1c6e42]" />
            No shared projects yet. A shared project is how organizations collaborate —
            shared ontology and aggregates only.
            <span className="text-[#8f99a8]">
              No patient records cross the organization boundary.
            </span>
          </p>
        </div>
      )}

      {/* Activity + checklist */}
      <div className="mt-4 grid gap-3 md:grid-cols-[1.35fr_1fr]">
        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[#8f99a8]">
            Recent activity
          </p>
          <div className="rounded-xl border border-[#d3d8de] bg-white px-3">
            {data && data.activity.length > 0 ? (
              <>
                {data.pendingReviewCount > 0 ? (
                  <div className="flex items-baseline gap-2 border-b border-[#e5e8eb] py-1.5 text-[11.5px]">
                    <span className="flex-1 text-[#935610]">
                      {data.pendingReviewCount} item
                      {data.pendingReviewCount === 1 ? "" : "s"} awaiting review
                    </span>
                  </div>
                ) : null}
                {data.activity.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-baseline gap-2 border-b border-[#e5e8eb] py-1.5 text-[11.5px] last:border-b-0"
                  >
                    <Box className="h-3.5 w-3.5 shrink-0 self-center text-[#215db0]" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-[11px] text-[#215db0]">{a.action}</span>
                      {a.resourceType ? (
                        <span className="text-[#8f99a8]"> · {a.resourceType}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-[#8f99a8]">
                      {ago(a.createdAt)}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className="py-3 text-[11.5px] text-[#8f99a8]">
                Actions appear here as soon as anyone changes something.
              </p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[#8f99a8]">
            Next steps
          </p>
          <div className="rounded-xl border border-[#d3d8de] bg-[#f6f7f9] px-3 py-2">
            {(data?.nextSteps ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 py-0.5 text-[11.5px]">
                {s.done ? (
                  <Check className="h-3.5 w-3.5 text-[#1c6e42]" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[#8f99a8]" />
                )}
                <span className={cn(s.done && "text-[#8f99a8] line-through")}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-px text-[9.5px] font-medium tracking-[0.03em]",
        className,
      )}
    >
      {children}
    </span>
  );
}
