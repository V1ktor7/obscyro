"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";

import {
  dismissSignal,
  getCommandBoard,
  getSignalDetail,
  moveSignal,
  seedSignalConfig,
  type BoardSignal,
  type CommandBoard,
  type Severity,
  type SignalEvent,
  type WorkflowStage,
} from "../signals-api";
import { useStudio } from "../StudioShell";

// ---------------------------------------------------------------------------
// The response board.
//
// Nothing here is a constant. The domains, the columns and their order all come
// from /command-board — change a workflow in the database and this page changes
// shape without a deploy. That is the whole point of the schema behind it.
// ---------------------------------------------------------------------------

const SEV: Record<Severity, { dot: string; border: string; chip: string; label: string }> = {
  critical: {
    dot: "bg-[#c23030]",
    border: "border-l-[#c23030]",
    chip: "bg-[#fdf1f1] text-[#c23030]",
    label: "critique",
  },
  warn: {
    dot: "bg-[#d9822b]",
    border: "border-l-[#d9822b]",
    chip: "bg-[#fdf6ec] text-[#8a5a12]",
    label: "avertissement",
  },
  info: {
    dot: "bg-[#2d72d2]",
    border: "border-l-[#2d72d2]",
    chip: "bg-[#e7f2fd] text-[#215db0]",
    label: "information",
  },
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "à l'instant";
  const m = Math.round(ms / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

export default function ResponseView() {
  const { selectedEnv } = useStudio();
  const [board, setBoard] = useState<CommandBoard | null>(null);
  const [domain, setDomain] = useState<string>("");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    stages: WorkflowStage[];
    events: SignalEvent[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedEnv) return;
    try {
      const b = await getCommandBoard(selectedEnv);
      setBoard(b);
      setError(null);
      setDomain((cur) => (cur && b.domains.some((d) => d.domain === cur) ? cur : b.domains[0]?.domain ?? ""));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedEnv]);

  useEffect(() => {
    void load();
  }, [load]);

  // A domain usually maps to one workflow. When it maps to several, the board
  // cannot invent a column set — so it asks rather than picking arbitrarily.
  const workflowsHere = useMemo(() => {
    if (!board || !domain) return [];
    const ids = new Set(
      board.signalTypes.filter((t) => t.domain === domain).map((t) => t.workflowId),
    );
    return board.workflows.filter((w) => ids.has(w.id));
  }, [board, domain]);

  useEffect(() => {
    setWorkflowId((cur) =>
      cur && workflowsHere.some((w) => w.id === cur) ? cur : workflowsHere[0]?.id ?? "",
    );
  }, [workflowsHere]);

  const workflow = workflowsHere.find((w) => w.id === workflowId) ?? null;

  const signalsHere = useMemo(
    () =>
      (board?.signals ?? []).filter(
        (s) => s.domain === domain && (!workflow || s.workflowId === workflow.id),
      ),
    [board, domain, workflow],
  );

  const selected = useMemo(
    () => (board?.signals ?? []).find((s) => s.id === sel) ?? null,
    [board, sel],
  );

  const openDetail = useCallback(async (id: string) => {
    setSel(id);
    setDetail(null);
    try {
      const d = await getSignalDetail(id);
      setDetail({ stages: d.stages, events: d.events });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  async function act(fn: () => Promise<unknown>, tag: string) {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      await load();
      if (sel) await openDetail(sel);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // --- empty states ---------------------------------------------------------

  if (board && board.workflows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-[#1c2127]">Aucun flux de travail défini</p>
          <p className="mt-2 text-xs leading-relaxed text-[#5f6b7c]">
            Un signal ne peut exister sans un flux à traverser. Installe le jeu de départ pour
            commencer — ce sont des lignes ordinaires que tu renommes ou supprimes ensuite, rien
            dans le moteur n&apos;en dépend.
          </p>
          <button
            type="button"
            disabled={busy !== null || !selectedEnv}
            onClick={() =>
              void act(() => seedSignalConfig(selectedEnv!), "seed")
            }
            className="mt-4 inline-flex items-center gap-2 rounded border border-[#215db0] bg-[#2d72d2] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Installer le jeu de départ
          </button>
          {error ? <p className="mt-3 text-xs text-[#a82255]">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
          Réponse
        </span>
        <span className="text-[11px] text-[#5f6b7c]">
          {board ? `${board.signals.filter((s) => !s.closedAt).length} signaux ouverts` : "…"}
        </span>
        {error ? (
          <span className="max-w-[46ch] truncate text-[11px] text-[#a82255]" title={error}>
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 rounded border border-[#d3d8de] px-2 py-1 text-[11px] text-[#404854]"
        >
          <RefreshCw className="h-3 w-3" /> Rafraîchir
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_320px]">
        {/* domaines */}
        <aside className="overflow-y-auto border-r border-[#d3d8de] bg-white">
          <p className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
            Domaines
          </p>
          {(board?.domains ?? []).map((d) => (
            <button
              key={d.domain}
              type="button"
              onClick={() => {
                setDomain(d.domain);
                setSel(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 border-l-[3px] px-3 py-1.5 text-left",
                domain === d.domain
                  ? "border-l-[#2d72d2] bg-[#e7f2fd]"
                  : "border-l-transparent hover:bg-[#f8f9fa]",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[#1c2127]">
                {d.domain}
              </span>
              {d.critical > 0 ? (
                <span className="text-[10px] font-bold text-[#c23030]">{d.critical}!</span>
              ) : null}
              <span className="text-[10px] tabular-nums text-[#8f99a8]">{d.open}</span>
            </button>
          ))}
          <p className="border-t border-[#e5e8eb] px-3 py-2 text-[10.5px] leading-snug text-[#8f99a8]">
            Chaque domaine suit son propre flux. Les étapes viennent de la base, pas du code.
          </p>
        </aside>

        {/* tableau */}
        <section className="min-w-0 overflow-auto bg-[#f6f7f9] p-3">
          {workflowsHere.length > 1 ? (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-[#8f99a8]">Flux</span>
              {workflowsHere.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWorkflowId(w.id)}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    workflowId === w.id
                      ? "border-[#2d72d2] bg-[#e7f2fd] font-medium text-[#215db0]"
                      : "border-[#d3d8de] bg-white text-[#5f6b7c]",
                  )}
                >
                  {w.name}
                </button>
              ))}
            </div>
          ) : null}

          {workflow ? (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${workflow.stages.length}, minmax(0,1fr))` }}
            >
              {workflow.stages.map((st) => {
                const cards = signalsHere.filter((s) => s.stageId === st.id);
                return (
                  <div
                    key={st.id}
                    className="flex min-h-[240px] flex-col rounded-md border border-[#d3d8de] bg-white"
                  >
                    <div className="flex items-center gap-1.5 border-b border-[#e5e8eb] px-2.5 py-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
                        {st.name}
                      </span>
                      {st.requiresApproval ? (
                        <span
                          title="Franchir cette étape exige une approbation nominative"
                          className="rounded bg-[#f0edf7] px-1 text-[9px] font-semibold text-[#5b4a86]"
                        >
                          ✓
                        </span>
                      ) : null}
                      <span className="ml-auto rounded bg-[#f1f3f5] px-1.5 text-[10px] font-semibold text-[#5f6b7c]">
                        {cards.length}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                      {cards.length === 0 ? (
                        <p className="py-3 text-center text-[10.5px] text-[#8f99a8]">—</p>
                      ) : (
                        cards.map((s) => <Card key={s.id} s={s} sel={sel} onPick={openDetail} />)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="p-6 text-center text-xs text-[#8f99a8]">
              Aucun type de signal dans ce domaine.
            </p>
          )}
        </section>

        {/* détail */}
        <aside className="overflow-y-auto border-l border-[#d3d8de] bg-white">
          <Detail
            signal={selected}
            detail={detail}
            busy={busy}
            onMove={(dir) =>
              selected && void act(() => moveSignal(selected.id, { direction: dir }), dir)
            }
            onDismiss={(reason) =>
              selected && void act(() => dismissSignal(selected.id, reason), "dismiss")
            }
          />
        </aside>
      </div>
    </div>
  );
}

function Card({
  s,
  sel,
  onPick,
}: {
  s: BoardSignal;
  sel: string | null;
  onPick: (id: string) => void;
}) {
  const sv = SEV[s.severity];
  return (
    <button
      type="button"
      onClick={() => onPick(s.id)}
      className={cn(
        "rounded border border-l-[3px] bg-white p-2 text-left",
        sv.border,
        sel === s.id ? "border-[#2d72d2] bg-[#e7f2fd]" : "border-[#d3d8de] hover:border-[#2d72d2]",
      )}
    >
      <p className="text-[11.5px] font-semibold leading-tight text-[#1c2127]">{s.title}</p>
      <p className="mt-0.5 text-[10px] text-[#8f99a8]">{s.signalTypeName}</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-[9.5px] text-[#8f99a8]">
        <span>{ago(s.detectedAt)}</span>
        {s.originKind === "twin_alert" ? <span>· auto</span> : null}
        {s.severity === "critical" ? (
          <span className={cn("rounded px-1 font-semibold", sv.chip)}>{sv.label}</span>
        ) : null}
      </div>
    </button>
  );
}

function Detail({
  signal,
  detail,
  busy,
  onMove,
  onDismiss,
}: {
  signal: BoardSignal | null;
  detail: { stages: WorkflowStage[]; events: SignalEvent[] } | null;
  busy: string | null;
  onMove: (d: "forward" | "back") => void;
  onDismiss: (reason: string) => void;
}) {
  if (!signal) {
    return (
      <p className="p-6 text-center text-[11.5px] leading-relaxed text-[#8f99a8]">
        Choisis un signal pour voir son étape,
        <br />
        ses options et son journal de décision.
      </p>
    );
  }
  const sv = SEV[signal.severity];
  const stages = detail?.stages ?? [];
  const idx = stages.findIndex((s) => s.id === signal.stageId);
  const next = idx >= 0 ? stages[idx + 1] : undefined;

  return (
    <div>
      <div className="border-b border-[#e5e8eb] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", sv.dot)} />
          <span className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
            {signal.signalTypeName}
          </span>
          {signal.originKind === "twin_alert" ? (
            <span className="ml-auto rounded bg-[#f1f3f5] px-1.5 py-0.5 text-[9px] text-[#5f6b7c]">
              levé automatiquement
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-[#1c2127]">{signal.title}</p>
        <p className="mt-0.5 text-[10.5px] text-[#8f99a8]">
          détecté il y a {ago(signal.detectedAt)}
          {signal.closedAt ? ` · clos — ${signal.closedReason ?? ""}` : ""}
        </p>
        {signal.detail ? (
          <p className="mt-2 text-[11.5px] leading-relaxed text-[#404854]">{signal.detail}</p>
        ) : null}
      </div>

      {/* étapes */}
      <div className="border-b border-[#e5e8eb] px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">Étape</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {stages.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px]",
                s.id === signal.stageId
                  ? "bg-[#2d72d2] font-semibold text-white"
                  : i < idx
                    ? "bg-[#e8f6f0] text-[#12684c]"
                    : "bg-[#f1f3f5] text-[#8f99a8]",
              )}
            >
              {s.name}
            </span>
          ))}
        </div>
        {next?.requiresApproval ? (
          <p className="mt-2 rounded bg-[#f0edf7] px-2 py-1.5 text-[10.5px] leading-snug text-[#5b4a86]">
            Franchir « {next.name} » vaut approbation. Ton nom sera inscrit au journal.
          </p>
        ) : null}
      </div>

      {/* options — honnêtement vide */}
      <div className="border-b border-[#e5e8eb] px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">Options</p>
        <p className="mt-1 text-[10.5px] leading-snug text-[#8f99a8]">
          Aucune règle de réponse n&apos;est implémentée. La table existe, le moteur ne calcule
          encore aucun candidat — mieux vaut le dire que d&apos;inventer des options.
        </p>
      </div>

      {/* journal */}
      <div className="border-b border-[#e5e8eb] px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]">
          Journal de décision
        </p>
        {detail === null ? (
          <p className="mt-1 text-[10.5px] text-[#8f99a8]">…</p>
        ) : (
          <div className="mt-1 space-y-1">
            {detail.events.map((e) => (
              <div key={e.id} className="text-[10.5px] leading-snug text-[#5f6b7c]">
                <b className="font-semibold text-[#404854]">{e.kind}</b>
                {e.actorUserId ? "" : " · système"} · {ago(e.createdAt)}
                {e.note ? <span className="block text-[#8f99a8]">{e.note}</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {!signal.closedAt ? (
        <div className="space-y-1.5 px-3 py-2.5">
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy !== null || idx <= 0}
              onClick={() => onMove("back")}
              className="flex-1 rounded border border-[#d3d8de] px-2 py-1.5 text-[11px] text-[#404854] disabled:opacity-40"
            >
              Reculer
            </button>
            <button
              type="button"
              disabled={busy !== null || !next}
              onClick={() => onMove("forward")}
              className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[#215db0] bg-[#2d72d2] px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
            >
              {busy === "forward" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {next?.isTerminal ? `Clore — ${next.name}` : "Avancer →"}
            </button>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              const reason = window.prompt(
                "Pourquoi ce signal n'aurait-il pas dû se déclencher ?\nLe motif est ce qui permet de mesurer le taux de fausses alertes.",
              );
              if (reason?.trim()) onDismiss(reason.trim());
            }}
            className="w-full rounded border border-[#d3d8de] px-2 py-1.5 text-[11px] text-[#5f6b7c] disabled:opacity-40"
          >
            Faux positif
          </button>
        </div>
      ) : null}
    </div>
  );
}
