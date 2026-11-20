"use client";

/**
 * "Keep as a prepared response for…": the calm-time half of the live loop.
 *
 * An option the engine just tested can be kept for a kind of signal. The day a
 * signal of that kind is raised, its situation card shows this response with
 * the figures of this very test, and one click engages it.
 *
 * Nothing with a figure in it leaves this component: it names the journalled
 * test and the kind of signal, and the server copies the rest from its journal.
 * That is what keeps an untested response from being kept as a tested one.
 */

import { BookmarkPlus, Check, Loader2 } from "lucide-react";
import { useId, useState } from "react";

import { keepPrepared } from "../../prepared-api";
import { listSignalTypes, type SignalType } from "../../signals-api";

const INPUT = "h-7 min-w-0 flex-1 border border-line bg-surface px-2 text-[11.5px] text-ink focus:border-brand focus:outline-none";

export default function KeepPrepared({
  env,
  exchangeId,
  step,
  label,
  current,
  disabled = false,
}: {
  env: string;
  /** The journalled exchange the option was tested in; null when the test was not journalled. */
  exchangeId: string | null;
  step: string;
  label: string;
  /** False when the scenario changed since the tests: the figures are then those of another scenario. */
  current: boolean;
  disabled?: boolean;
}) {
  const kindId = useId();
  const approverId = useId();
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<SignalType[] | null>(null);
  const [kind, setKind] = useState("");
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setError(null);
    if (kinds) return;
    try {
      const all = (await listSignalTypes(env)).filter((t) => t.active);
      setKinds(all);
      setKind((k) => k || all[0]?.id || "");
    } catch (e) {
      setError(`The kinds of signal could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function keep() {
    if (!exchangeId || !kind || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await keepPrepared(env, { exchangeId, step, signalTypeId: kind, approver: approver.trim() || null });
      setKept(saved.signalType);
      setOpen(false);
    } catch (e) {
      setError(`“${label}” was not kept: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (kept) {
    return (
      <p className="flex items-start gap-1 text-[11px] text-ink-muted">
        <Check className="mt-px h-3 w-3 shrink-0 text-ok-ink" aria-hidden="true" />
        Kept as a prepared response for “{kept}”. A signal of that kind will show it on its situation card, with the figures of this test.
      </p>
    );
  }

  const why = !exchangeId
    ? "This test was not journalled, so there is nothing to keep a response from. Test again."
    : !current
      ? "The scenario changed since these tests: the figures are those of another scenario. Test again before keeping one."
      : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {!open ? (
        <button
          type="button"
          disabled={disabled || !exchangeId || !current}
          onClick={() => void show()}
          title={why}
          className="flex h-7 items-center gap-1 self-start border border-line-strong bg-surface px-2.5 text-[11.5px] font-semibold text-ink hover:bg-surface-hover disabled:opacity-60"
        >
          <BookmarkPlus className="h-3 w-3" aria-hidden="true" /> Keep as a prepared response for…
        </button>
      ) : (
        <form
          aria-label={`Keep “${label}” as a prepared response`}
          className="flex flex-col gap-1.5 border border-line bg-canvas-raised p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void keep();
          }}
        >
          {kinds === null && !error ? <p className="text-[11px] text-ink-muted">Reading the kinds of signal…</p> : null}
          {kinds !== null && kinds.length === 0 ? (
            <p className="text-[11px] text-ink-body">No kind of signal is defined for this organisation. Define one on the Response page first.</p>
          ) : null}
          {kinds && kinds.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <label htmlFor={kindId} className="text-[11px] text-ink-muted">
                  Kind of signal
                </label>
                <select id={kindId} value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT}>
                  {kinds.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.domain} · {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <label htmlFor={approverId} className="text-[11px] text-ink-muted">
                  Who can approve it
                </label>
                <input
                  id={approverId}
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  maxLength={200}
                  placeholder="A role, optional"
                  className={INPUT}
                />
              </div>
              <p className="text-[10.5px] text-ink-faint">
                Kept with the figures of this test, its date, and the scenario it ran on. If that scenario changes later, the card will say so.
              </p>
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="submit"
              disabled={busy || !kind}
              className="flex h-7 items-center gap-1 bg-brand px-2.5 text-[11.5px] font-semibold text-white hover:bg-brand-deep disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null} Keep
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-7 border border-line px-2.5 text-[11.5px] text-ink-body hover:bg-surface-hover">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1 text-[11.5px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
