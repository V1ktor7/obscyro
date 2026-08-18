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
  Trash2,
  UsersRound,
} from "lucide-react";

import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/cn";

import NameField from "../NameField";
import { useStudio } from "../StudioShell";

/** What a project holds, asked for before offering to destroy it. */
interface ProjectContents {
  name: string;
  slug: string;
  objectTypes: number;
  instances: number;
  links: number;
  datasets: number;
  scenarios: number;
  events: number;
}

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
  const { hasKey, selectedEnv, setSelectedEnv, refreshEnvironments } = useStudio();
  const router = useRouter();

  const [data, setData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [naming, setNaming] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    project: HomeProject;
    contents: ProjectContents;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  /**
   * Was a `window.prompt`, which returns null without showing anything wherever
   * the browser suppresses dialogs — so the button looked dead and explained
   * nothing. Same fix as the two scenario buttons.
   */
  async function handleNewProject(name: string) {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await apiFetch("/v1/ontology/environments", {
        method: "POST",
        body: { name: name.trim(), type: "sandbox" },
      });
      setNaming(false);
      await refreshEnvironments();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  /**
   * Ask what the project holds before offering to destroy it.
   *
   * "Are you sure?" is answered yes by reflex. A sentence naming four thousand
   * instances is read. The counts come from the server rather than the card,
   * because the card shows object types and datasets and says nothing about
   * links, scenarios or saved events — which go too.
   */
  async function askDelete(p: HomeProject) {
    setError(null);
    try {
      const c = await apiFetch<ProjectContents>(
        `/v1/ontology/environments/${encodeURIComponent(p.slug)}/contents`,
      );
      setPendingDelete({ project: p, contents: c });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { project } = pendingDelete;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/v1/ontology/environments/${encodeURIComponent(project.slug)}`, {
        method: "DELETE",
      });
      setPendingDelete(null);
      // The shell keeps a selected environment; leaving it pointing at a
      // project that no longer exists makes every downstream page 404 with no
      // hint about why.
      if (selectedEnv === project.slug) setSelectedEnv("");
      await refreshEnvironments();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
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
        {naming ? (
          <span className="ml-auto">
            <NameField
              busy={creating}
              label="Project name"
              placeholder="Project name"
              onCancel={() => setNaming(false)}
              onSubmit={(v) => void handleNewProject(v)}
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            disabled={creating}
            className="ml-auto flex items-center gap-1 text-[11.5px] text-[#215db0] hover:underline disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            New project
          </button>
        )}
      </div>

      {pendingDelete ? (
        <DeleteProjectDialog
          project={pendingDelete.project}
          contents={pendingDelete.contents}
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {data && data.projects.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
          {data.projects.map((p) => {
            const tone = kindTone(p.kind);
            const empty = p.objectTypeCount === 0 && p.datasetCount === 0;
            return (
              // A div, not a button: the card carries a delete control, and a
              // button inside a button is invalid markup that browsers resolve
              // by dropping one of them — usually the one you wanted.
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => open(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(p);
                  }
                }}
                className={cn(
                  "cursor-pointer rounded-xl border bg-white p-3 text-left transition-colors hover:border-[#2d72d2]",
                  empty ? "border-dashed border-[#d3d8de]" : "border-[#d3d8de]",
                )}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <FolderPlus className="h-[15px] w-[15px] text-[#215db0]" />
                  <span className="truncate font-medium">{p.name}</span>
                  {p.liveChannelCount > 0 ? (
                    <Star className="h-3 w-3 fill-[#d97706] text-[#d97706]" />
                  ) : null}
                  <button
                    type="button"
                    onClick={(e) => {
                      // Without this the card's own handler fires too and the
                      // browser navigates into the project you just asked to
                      // delete.
                      e.stopPropagation();
                      void askDelete(p);
                    }}
                    aria-label={`Delete ${p.name}`}
                    title="Delete project"
                    className="ml-auto rounded p-0.5 text-[#8f99a8] hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
              </div>
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
                      <span className="text-[11px] text-[#215db0]">{a.action}</span>
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

/**
 * The confirmation for destroying a project.
 *
 * It names what goes rather than asking "are you sure?", which is answered yes
 * by reflex. And it asks for the project's name to be typed: this is the one
 * action in the product with no undo and no export behind it, and a
 * misplaced click on a card is otherwise all it takes.
 */
export function DeleteProjectDialog({
  project,
  contents,
  busy,
  onCancel,
  onConfirm,
}: {
  project: HomeProject;
  contents: ProjectContents;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const rows: Array<[number, string]> = [
    [contents.objectTypes, "object type"],
    [contents.instances, "instance"],
    [contents.links, "link"],
    [contents.datasets, "dataset"],
    [contents.scenarios, "scenario"],
    [contents.events, "saved event"],
  ];
  const holds = rows.filter(([n]) => n > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${project.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-[#d3d8de] bg-white p-4 shadow-lg"
      >
        <h2 className="text-sm font-medium text-[#1c2127]">Delete “{project.name}”?</h2>

        {holds.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-[#5f6b7c]">
            This project is empty. Nothing is lost.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs leading-relaxed text-[#5f6b7c]">
              This deletes the project and everything filed under it:
            </p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {holds.map(([n, noun]) => (
                <li key={noun} className="text-xs text-[#1c2127]">
                  <strong className="font-medium tabular-nums">{n.toLocaleString()}</strong>{" "}
                  {noun}
                  {n === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-3 text-xs leading-relaxed text-rose-700">
          There is no undo, and nothing is exported first.
        </p>

        <label className="mt-3 block text-[11px] text-[#5f6b7c]">
          Type <strong className="font-medium text-[#1c2127]">{project.name}</strong> to confirm
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter" && typed.trim() === project.name) onConfirm();
            }}
            aria-label="Type the project name to confirm"
            className="mt-1 w-full rounded border border-[#d3d8de] px-2 py-1.5 text-xs focus:border-rose-500 focus:outline-none"
          />
        </label>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs text-[#5f6b7c] hover:text-[#1c2127]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || typed.trim() !== project.name}
            className="rounded bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-700 disabled:bg-[#d3d8de]"
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
