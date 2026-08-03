"use client";

/**
 * Governance — the audit explorer over the append-only trail, plus the
 * channel review queue. Both answer "who did what, and what is waiting on a
 * human decision" (spec Part 7).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Loader2, Lock, ShieldCheck } from "lucide-react";

import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/cn";

import { useStudio } from "../StudioShell";

interface AuditEvent {
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

interface ReviewItem {
  id: string;
  channelName: string;
  span: string;
  code: string | null;
  display: string | null;
  decision: string;
  objectType: string;
  createdAt: string;
}

const OUTCOME_TONE: Record<string, string> = {
  success: "bg-[#e8f4ec] text-[#1c6e42]",
  denied: "bg-[#fdf0e6] text-[#935610]",
  error: "bg-[#fceaef] text-[#a82255]",
};

export default function GovernView() {
  const { hasKey, selectedEnv } = useStudio();
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") === "review" ? "review" : "audit";

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasKey) return;
    setLoading(true);
    setError(null);
    try {
      if (view === "audit") {
        const qs = filter.trim() ? `?action=${encodeURIComponent(filter.trim())}&limit=200` : "?limit=200";
        const res = await apiFetch<{ events: AuditEvent[] }>(`/v1/governance/audit${qs}`);
        setEvents(res.events);
      } else if (selectedEnv) {
        const res = await apiFetch<{ items: ReviewItem[]; pendingCount: number }>(
          `/v1/ontology/${encodeURIComponent(selectedEnv)}/review-items?status=pending&limit=100`,
        );
        setItems(res.items);
        setPendingCount(res.pendingCount);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [hasKey, view, filter, selectedEnv]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, decision: "confirmed" | "rejected") {
    if (!selectedEnv) return;
    try {
      await apiFetch(
        `/v1/ontology/${encodeURIComponent(selectedEnv)}/review-items/${id}/resolve`,
        { method: "POST", body: { status: decision } },
      );
      setItems((cur) => cur.filter((i) => i.id !== id));
      setPendingCount((c) => Math.max(0, c - 1));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      const head = e.action.split(".")[0];
      m.set(head, (m.get(head) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [events]);

  if (!hasKey) {
    return <p className="p-8 text-sm text-[#8f99a8]">Sign in to view governance.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-[#d3d8de] bg-white px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e7f2fd] text-[#215db0]">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <h1 className="text-[15px] font-medium">
            {view === "audit" ? "Audit log" : "Review queue"}
          </h1>
          {view === "audit" ? (
            <span className="inline-flex items-center gap-1 rounded border border-[#d3d8de] px-2 py-0.5 text-[10.5px] text-[#5f6b7c]">
              <Lock className="h-3 w-3" />
              append-only
            </span>
          ) : (
            <span className="rounded border border-[#d3d8de] px-2 py-0.5 text-[10.5px] text-[#5f6b7c]">
              {pendingCount} pending
            </span>
          )}
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#8f99a8]" /> : null}
        </div>
        <p className="mt-1 text-[11px] text-[#8f99a8]">
          {view === "audit"
            ? "Every privileged action. Rows cannot be edited or deleted, including by an owner."
            : "Extractions the pipeline would not save on its own. Confirm to persist, reject to close."}
        </p>
      </header>

      {error ? (
        <p className="mx-5 mt-3 rounded border border-[#f4c0d1] bg-[#fceaef] px-3 py-2 text-xs text-[#a82255]">
          {error}
        </p>
      ) : null}

      {view === "audit" ? (
        <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
          <div className="mb-2.5 flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by action prefix, e.g. admin."
              className="w-64 rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs focus:border-[#2d72d2] focus:outline-none"
            />
            {grouped.map(([head, n]) => (
              <button
                key={head}
                type="button"
                onClick={() => setFilter(head)}
                className="rounded border border-[#d3d8de] px-2 py-1 text-[10.5px] text-[#5f6b7c] hover:border-[#2d72d2] hover:text-[#215db0]"
              >
                {head} · {n}
              </button>
            ))}
          </div>

          {events.length === 0 && !loading ? (
            <EmptyState
              title="No audit events yet"
              body="Actions appear here as soon as anyone creates a type, runs a channel, or changes a role."
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-[#d3d8de]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#f6f7f9] text-[10px] uppercase tracking-wide text-[#8f99a8]">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">When</th>
                    <th className="px-3 py-1.5 font-medium">Actor</th>
                    <th className="px-3 py-1.5 font-medium">Action</th>
                    <th className="px-3 py-1.5 font-medium">Resource</th>
                    <th className="px-3 py-1.5 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-t border-[#e5e8eb]">
                      <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-[#5f6b7c]">
                        {new Date(e.createdAt).toLocaleString("en-CA", { hour12: false })}
                      </td>
                      <td className="px-3 py-1.5 text-[#1c2127]">{e.actorEmail ?? "—"}</td>
                      <td className="px-3 py-1.5 text-[11px] text-[#215db0]">{e.action}</td>
                      <td className="px-3 py-1.5 text-[#5f6b7c]">
                        {e.resourceType ?? "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium",
                            OUTCOME_TONE[e.outcome] ?? "bg-[#f6f7f9] text-[#5f6b7c]",
                          )}
                        >
                          {e.outcome}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-3">
          {items.length === 0 && !loading ? (
            <EmptyState
              title="Nothing waiting for review"
              body="When extraction is not confident enough to save on its own, the item lands here instead of being discarded."
            />
          ) : (
            <div className="space-y-1.5">
              {items.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-3 rounded-md border border-[#d3d8de] bg-white px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[#1c2127]">{i.span}</p>
                    <p className="truncate text-[11px] text-[#8f99a8]">
                      {i.channelName} · {i.objectType}
                      {i.code ? ` · ${i.code}` : ""}
                    </p>
                  </div>
                  <span className="rounded bg-[#fdf0e6] px-1.5 py-0.5 text-[10px] font-medium text-[#935610]">
                    {i.decision}
                  </span>
                  <button
                    type="button"
                    onClick={() => void resolve(i.id, "confirmed")}
                    className="rounded border border-[#9fe1cb] bg-[#e8f4ec] px-2 py-1 text-[11px] font-medium text-[#1c6e42]"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolve(i.id, "rejected")}
                    className="rounded border border-[#d3d8de] px-2 py-1 text-[11px] text-[#5f6b7c]"
                  >
                    Reject
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-[#d3d8de] bg-[#f6f7f9] px-6 py-10 text-center">
      <p className="text-sm font-medium text-[#1c2127]">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#5f6b7c]">{body}</p>
    </div>
  );
}
