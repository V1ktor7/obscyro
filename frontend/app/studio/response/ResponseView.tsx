"use client";

import { Loader2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

import {
  createSignalType,
  dismissSignal,
  getCommandBoard,
  getSignalDetail,
  moveSignal,
  renameSignalDomain,
  seedSignalConfig,
  type BoardSignal,
  type CommandBoard,
  type Severity,
  type SignalEvent,
  type Workflow,
  type WorkflowStage,
} from "../signals-api";
import { useAlertFeed } from "../AlertFeed";
import { useAnalystFocus } from "../AnalystDock";
import { SIGNAL_PARAM, situationHref, unitHref } from "../alert-feed-state";
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
    dot: "bg-danger",
    border: "border-l-danger",
    chip: "bg-danger-soft text-danger",
    label: "critique",
  },
  warn: {
    dot: "bg-warn",
    border: "border-l-warn",
    chip: "bg-warn-soft text-warn-ink",
    label: "avertissement",
  },
  info: {
    dot: "bg-brand",
    border: "border-l-brand",
    chip: "bg-brand-soft text-brand-deep",
    label: "information",
  },
};

/** The API takes a signal id as a UUID and refuses anything else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the board holds, against what there is. The list stops at the most
 * recent signals, and a board that says "500 open signals" when there are
 * 2,752 states a limit as if it were the whole.
 */
export function shownOfTotal(shown: number, total: number | undefined): string {
  if (typeof total !== "number" || total <= shown) return `${shown} open signals`;
  return `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} open signals, most recent first`;
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creatingDomain, setCreatingDomain] = useState(false);

  // An alert links here with its signal in the address. The board is asked
  // for that signal by name: the list stops at the most recent ones, and an
  // alert open for weeks links to a signal far older than that.
  const linkedSignal = useSearchParams().get(SIGNAL_PARAM);
  // The analyst is told which signal is open: a question asked from here is about it.
  useAnalystFocus({ signalId: sel ?? undefined });
  const linkedId = linkedSignal && UUID.test(linkedSignal) ? linkedSignal : null;

  const load = useCallback(async () => {
    if (!selectedEnv) return;
    try {
      const b = await getCommandBoard(selectedEnv, linkedId ? { signal: linkedId } : undefined);
      setBoard(b);
      setError(null);
      setDomain((cur) => (cur && b.domains.some((d) => d.domain === cur) ? cur : b.domains[0]?.domain ?? ""));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedEnv, linkedId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The board follows the signals on its own. The shell's alert feed says how
  // many signals are open and when one last changed; when either moves, the
  // board is read again. It used to change only when somebody pressed Refresh,
  // so a signal raised at 03:00 waited for a click.
  const { feed } = useAlertFeed();
  const signalsVersion = feed ? `${feed.signals.open}|${feed.signals.changedAt ?? ""}` : null;
  const seenVersion = useRef<string | null>(null);
  useEffect(() => {
    if (signalsVersion === null) return;
    const first = seenVersion.current === null;
    const changed = seenVersion.current !== signalsVersion;
    seenVersion.current = signalsVersion;
    // The first value is the state the board was just loaded in.
    if (!first && changed) void load();
  }, [signalsVersion, load]);

  // Show the linked signal, whatever domain and workflow it sits in.
  const openedLink = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedSignal || !board || openedLink.current === linkedSignal) return;
    const s = board.signals.find((x) => x.id === linkedSignal);
    if (!s) return;
    openedLink.current = linkedSignal;
    setDomain(s.domain);
    setWorkflowId(s.workflowId);
    void openDetail(s.id);
    // `openDetail` is stable; it is declared below this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedSignal, board]);

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

  // A link that leads nowhere says so, rather than showing a board with
  // nothing opened.
  const linkLost = Boolean(
    linkedSignal && board && !board.signals.some((s) => s.id === linkedSignal),
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

  async function commitRename(from: string, raw: string) {
    const to = raw.trim();
    setRenaming(null);
    if (!to || to === from || !selectedEnv) return;
    setDomain((cur) => (cur === from ? to : cur));
    await act(() => renameSignalDomain(selectedEnv, from, to), "rename");
  }

  // --- empty states ---------------------------------------------------------

  if (board && board.workflows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-ink">No workflows defined</p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            A signal cannot exist without a workflow to travel through. Install the starter set
            to begin — they are ordinary rows you can rename or delete afterwards, and nothing in
            the engine depends on them.
          </p>
          <button
            type="button"
            disabled={busy !== null || !selectedEnv}
            onClick={() =>
              void act(() => seedSignalConfig(selectedEnv!), "seed")
            }
            className="mt-4 inline-flex items-center gap-2 rounded border border-brand-deep bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === "seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Installer le jeu de départ
          </button>
          {error ? <p className="mt-3 text-xs text-danger-ink">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          Response
        </span>
        <span className="text-[11px] text-ink-muted">
          {board
            ? shownOfTotal(board.signals.filter((s) => !s.closedAt).length, board.total)
            : "…"}
        </span>
        {linkLost ? (
          <span role="status" className="text-[11px] text-warn-ink">
            The signal this link names is not in this project.
          </span>
        ) : null}
        {error ? (
          <span className="max-w-[46ch] truncate text-[11px] text-danger-ink" title={error}>
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[11px] text-ink-body"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* domaines */}
        <aside className="flex w-[190px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
          <div className="flex items-center gap-1 px-3 py-2">
            <p className="flex-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Domaines
            </p>
            <button
              type="button"
              title="Nouveau domaine"
              onClick={() => setCreatingDomain(true)}
              className="rounded p-0.5 text-ink-faint hover:bg-surface-hover hover:text-brand"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {(board?.domains ?? []).map((d) =>
            renaming === d.domain ? (
              <input
                key={d.domain}
                autoFocus
                defaultValue={d.domain}
                onBlur={(e) => void commitRename(d.domain, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename(d.domain, e.currentTarget.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="mx-2 my-0.5 rounded border border-brand px-2 py-1 text-[11.5px] focus:outline-none"
              />
            ) : (
              <div
                key={d.domain}
                className={cn(
                  "group flex items-center gap-1 border-l-[3px] pr-1.5",
                  domain === d.domain
                    ? "border-l-brand bg-brand-soft"
                    : "border-l-transparent hover:bg-surface-hover",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setDomain(d.domain);
                    setSel(null);
                  }}
                  className="min-w-0 flex-1 py-1.5 pl-3 text-left"
                >
                  <span className="block truncate text-[11.5px] font-medium text-ink">
                    {d.domain}
                  </span>
                </button>
                <button
                  type="button"
                  title="Renommer"
                  onClick={() => setRenaming(d.domain)}
                  className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 hover:text-brand group-hover:opacity-100"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {d.critical > 0 ? (
                  <span className="shrink-0 text-[10px] font-bold text-danger">{d.critical}!</span>
                ) : null}
                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{d.open}</span>
              </div>
            ),
          )}
          <p className="mt-auto border-t border-line-soft px-3 py-2 text-[10.5px] leading-snug text-ink-faint">
            A domain is the name its signal types share. Renaming it moves all of them; a
            domain with no type stops existing.
          </p>
        </aside>

        {/* tableau */}
        <section className="min-w-0 flex-1 overflow-auto bg-canvas p-3">
          {workflowsHere.length > 1 ? (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-ink-faint">Flux</span>
              {workflowsHere.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWorkflowId(w.id)}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    workflowId === w.id
                      ? "border-brand bg-brand-soft font-medium text-brand-deep"
                      : "border-line bg-surface text-ink-muted",
                  )}
                >
                  {w.name}
                </button>
              ))}
            </div>
          ) : null}

          {workflow ? (
            <div
              className="grid gap-2.5"
              style={{
                // A column narrower than this stops being readable, so a long
                // workflow scrolls instead of crushing every card.
                gridTemplateColumns: `repeat(${workflow.stages.length}, minmax(190px,1fr))`,
              }}
            >
              {workflow.stages.map((st) => {
                const cards = signalsHere.filter((s) => s.stageId === st.id);
                return (
                  <div
                    key={st.id}
                    className="flex min-h-[240px] flex-col rounded-md border border-line bg-surface"
                  >
                    <div className="flex items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                        {st.name}
                      </span>
                      {st.requiresApproval ? (
                        <span
                          title="Passing this stage requires a named approval"
                          className="rounded bg-scenario-soft px-1 text-[9px] font-semibold text-scenario"
                        >
                          ✓
                        </span>
                      ) : null}
                      <span className="ml-auto rounded bg-canvas-raised px-1.5 text-[10px] font-semibold text-ink-muted">
                        {cards.length}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                      {cards.length === 0 ? (
                        <p className="py-3 text-center text-[10.5px] text-ink-faint">—</p>
                      ) : (
                        cards.map((s) => <Card key={s.id} s={s} sel={sel} onPick={openDetail} />)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="p-6 text-center text-xs text-ink-faint">
              No signal types in this domain.
            </p>
          )}
        </section>

        {/* détail — seulement quand un signal est choisi, sinon le tableau étouffe */}
        {selected ? (
          <aside className="w-[310px] shrink-0 overflow-y-auto border-l border-line bg-surface">
            <Detail
              signal={selected}
              env={selectedEnv}
              detail={detail}
              busy={busy}
              onClose={() => setSel(null)}
              onMove={(dir) =>
                void act(() => moveSignal(selected.id, { direction: dir }), dir)
              }
              onDismiss={(reason) =>
                void act(() => dismissSignal(selected.id, reason), "dismiss")
              }
            />
          </aside>
        ) : null}
      </div>

      {creatingDomain && board ? (
        <NewDomainDialog
          workflows={board.workflows}
          busy={busy === "newDomain"}
          onCancel={() => setCreatingDomain(false)}
          onCreate={async (input) => {
            if (!selectedEnv) return;
            await act(() => createSignalType(selectedEnv, input), "newDomain");
            setDomain(input.domain);
            setSel(null);
            setCreatingDomain(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A domain has no row of its own — it is the string its signal types share. So
 * creating one means defining the first type that lives in it, and the dialog
 * says so rather than pretending there is a domains table.
 */
function NewDomainDialog({
  workflows,
  busy,
  onCancel,
  onCreate,
}: {
  workflows: Workflow[];
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: {
    key: string;
    name: string;
    domain: string;
    workflowId: string;
    defaultSeverity: Severity;
  }) => Promise<void>;
}) {
  const [domain, setDomainName] = useState("");
  const [name, setName] = useState("");
  const [workflowId, setWorkflowId] = useState(workflows[0]?.id ?? "");
  const [severity, setSeverity] = useState<Severity>("warn");

  const key = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining marks left by NFD
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
  const ready = domain.trim() !== "" && key !== "" && workflowId !== "" && !busy;

  const field =
    "mt-1 w-full rounded border border-line px-2 py-1.5 text-[11.5px] focus:border-brand focus:outline-none";
  const label = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]">
      <div className="w-[380px] rounded-md border border-line bg-surface shadow-lg">
        <div className="border-b border-line-soft px-4 py-2.5">
          <p className="text-xs font-medium text-ink">New domain</p>
          <p className="mt-1 text-[10.5px] leading-snug text-ink-faint">
            A domain is the name its signal types share. Define the first type and the domain
            exists.
          </p>
        </div>
        <div className="space-y-2.5 px-4 py-3">
          <div>
            <span className={label}>Domaine</span>
            <input
              autoFocus
              value={domain}
              onChange={(e) => setDomainName(e.target.value)}
              placeholder="Operating theatre"
              className={field}
            />
          </div>
          <div>
            <span className={label}>First signal type</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room not released"
              className={field}
            />
            {key ? <p className="mt-1 text-[10px] text-ink-faint">clé · {key}</p> : null}
          </div>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <span className={label}>Flux</span>
              <select
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                className={field}
              >
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[110px] shrink-0">
              <span className={label}>Severity</span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className={field}
              >
                <option value="info">information</option>
                <option value="warn">avertissement</option>
                <option value="critical">critique</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-line px-3 py-1.5 text-[11px] text-ink-body"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              void onCreate({
                key,
                name: name.trim(),
                domain: domain.trim(),
                workflowId,
                defaultSeverity: severity,
              })
            }
            className="inline-flex items-center gap-1.5 rounded border border-brand-deep bg-brand px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Créer
          </button>
        </div>
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
        "rounded border border-l-[3px] bg-surface p-2 text-left",
        sv.border,
        sel === s.id ? "border-brand bg-brand-soft" : "border-line hover:border-brand",
      )}
    >
      <p className="text-[11.5px] font-semibold leading-tight text-ink">{s.title}</p>
      <p className="mt-0.5 text-[10px] text-ink-faint">{s.signalTypeName}</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-[9.5px] text-ink-faint">
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
  env,
  detail,
  busy,
  onClose,
  onMove,
  onDismiss,
}: {
  signal: BoardSignal;
  env: string | null;
  detail: { stages: WorkflowStage[]; events: SignalEvent[] } | null;
  busy: string | null;
  onClose: () => void;
  onMove: (d: "forward" | "back") => void;
  onDismiss: (reason: string) => void;
}) {
  const sv = SEV[signal.severity];
  const stages = detail?.stages ?? [];
  const idx = stages.findIndex((s) => s.id === signal.stageId);
  const next = idx >= 0 ? stages[idx + 1] : undefined;

  return (
    <div>
      <div className="border-b border-line-soft px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", sv.dot)} />
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            {signal.signalTypeName}
          </span>
          {signal.originKind === "twin_alert" ? (
            <span className="ml-auto rounded bg-canvas-raised px-1.5 py-0.5 text-[9px] text-ink-muted">
              raised automatically
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            title="Fermer"
            className={cn(
              "shrink-0 rounded p-0.5 text-ink-faint hover:bg-surface-hover hover:text-ink-body",
              signal.originKind === "twin_alert" ? "" : "ml-auto",
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">{signal.title}</p>
        <p className="mt-0.5 text-[10.5px] text-ink-faint">
          détecté il y a {ago(signal.detectedAt)}
          {signal.closedAt ? ` · clos — ${signal.closedReason ?? ""}` : ""}
        </p>
        {signal.detail ? (
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-body">{signal.detail}</p>
        ) : null}
        {/* A signal leads to its situation card, and one about a unit to that unit as well. */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link
            href={situationHref({ signal: signal.id, unit: signal.subjectKind === "object_instance" ? signal.subjectId : null }, env)}
            className="inline-flex rounded border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:border-brand hover:bg-brand-soft"
          >
            Situation
          </Link>
          {signal.subjectKind === "object_instance" && signal.subjectId ? (
            <Link
              href={unitHref(signal.subjectId, env)}
              className="inline-flex rounded border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink hover:border-brand hover:bg-brand-soft"
            >
              Open unit
            </Link>
          ) : null}
        </div>
      </div>

      {/* étapes */}
      <div className="border-b border-line-soft px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Stage</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {stages.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px]",
                s.id === signal.stageId
                  ? "bg-brand font-semibold text-white"
                  : i < idx
                    ? "bg-ok-soft text-ok-ink"
                    : "bg-canvas-raised text-ink-faint",
              )}
            >
              {s.name}
            </span>
          ))}
        </div>
        {next?.requiresApproval ? (
          <p className="mt-2 rounded bg-scenario-soft px-2 py-1.5 text-[10.5px] leading-snug text-scenario">
            Franchir « {next.name} » vaut approbation. Ton nom sera inscrit au journal.
          </p>
        ) : null}
      </div>

      {/* options: prepared in calm time, shown and engaged on the situation card */}
      <div className="border-b border-line-soft px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Options</p>
        <p className="mt-1 text-[10.5px] leading-snug text-ink-faint">
          The responses prepared for this kind of signal are on its situation card, with the figures of their last
          test, and are engaged there. Nothing is computed here: a response is a tested option somebody kept.
        </p>
      </div>

      {/* journal */}
      <div className="border-b border-line-soft px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          Decision log
        </p>
        {detail === null ? (
          <p className="mt-1 text-[10.5px] text-ink-faint">…</p>
        ) : (
          <div className="mt-1 space-y-1">
            {detail.events.map((e) => (
              <div key={e.id} className="text-[10.5px] leading-snug text-ink-muted">
                <b className="font-semibold text-ink-body">{e.kind}</b>
                {e.actorUserId ? "" : " · système"} · {ago(e.createdAt)}
                {e.note ? <span className="block text-ink-faint">{e.note}</span> : null}
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
              className="flex-1 rounded border border-line px-2 py-1.5 text-[11px] text-ink-body disabled:opacity-40"
            >
              Reculer
            </button>
            <button
              type="button"
              disabled={busy !== null || !next}
              onClick={() => onMove("forward")}
              className="flex flex-1 items-center justify-center gap-1.5 rounded border border-brand-deep bg-brand px-2 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
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
                "Why should this signal not have fired?\nThe reason is what makes the false-alarm rate measurable.",
              );
              if (reason?.trim()) onDismiss(reason.trim());
            }}
            className="w-full rounded border border-line px-2 py-1.5 text-[11px] text-ink-muted disabled:opacity-40"
          >
            Faux positif
          </button>
        </div>
      ) : null}
    </div>
  );
}
