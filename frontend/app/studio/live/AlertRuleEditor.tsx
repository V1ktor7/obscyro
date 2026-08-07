"use client";

import { AlertTriangle, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import {
  createTwinAlertRule,
  deleteTwinAlertRule,
  listTwinAlertRules,
  listTwinMetrics,
  updateTwinAlertRule,
  type TwinAlertOp,
  type TwinAlertRule,
  type TwinAlertSeverity,
  type TwinMetric,
} from "@/lib/platform-api";
import {
  getCommandBoard,
  setSignalTypeAlertMetric,
  signalTypeForMetric,
  type SignalType,
} from "../signals-api";

// ---------------------------------------------------------------------------
// When the twin shouts.
//
// The routes existed and nothing called them: a threshold could only be set by
// curl, which means it was not a feature. That is why a network could show an
// emergency ward at 100% occupancy while the response board sat at zero.
//
// The part worth the trouble is the wiring notice. The bridge that turns an
// alert into a signal is an inner join:
//
//   JOIN signal_type st ON st.alert_metric = a.metric AND st.active
//
// A rule whose metric no signal type claims fires an alert that reaches
// nobody — no error, no log, no row. The rule looks configured, the twin turns
// red, and Response stays empty. Every rule here says which of the two it is.
// ---------------------------------------------------------------------------

const OPS: { value: TwinAlertOp; label: string }[] = [
  { value: ">=", label: "is at or above" },
  { value: ">", label: "is above" },
  { value: "<=", label: "is at or below" },
  { value: "<", label: "is below" },
  { value: "==", label: "equals" },
];

const SEVERITIES: { value: TwinAlertSeverity; label: string; tone: string }[] = [
  { value: "info", label: "information", tone: "text-brand-deep" },
  { value: "warn", label: "warning", tone: "text-warn-ink" },
  { value: "critical", label: "critical", tone: "text-danger-ink" },
];

const FIELD =
  "w-full rounded border border-line bg-white px-2 py-1.5 text-[11.5px] text-ink focus:border-brand focus:outline-none";
const LABEL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";

/** Unit kinds a rule can be limited to. Empty means every unit. */
const KINDS = ["", "hospital", "ward", "lab", "pharmacy", "clinic", "org", "department"];

export default function AlertRuleEditor({
  env,
  onClose,
}: {
  env: string;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<TwinAlertRule[]>([]);
  const [metrics, setMetrics] = useState<TwinMetric[]>([]);
  const [signalTypes, setSignalTypes] = useState<SignalType[]>([]);
  const [editing, setEditing] = useState<TwinAlertRule | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wireTo, setWireTo] = useState("");
  const [rewiring, setRewiring] = useState(false);

  // draft
  const [metric, setMetric] = useState("");
  const [op, setOp] = useState<TwinAlertOp>(">=");
  const [threshold, setThreshold] = useState("90");
  const [severity, setSeverity] = useState<TwinAlertSeverity>("critical");
  const [unitKind, setUnitKind] = useState("");
  const [message, setMessage] = useState("");
  const [recommendation, setRecommendation] = useState("");

  const reload = useCallback(async () => {
    try {
      const [{ rules: r }, { metrics: m }, board] = await Promise.all([
        listTwinAlertRules(env),
        listTwinMetrics(env),
        // The board carries the signal types, which is what says whether an
        // alert on this metric can reach anyone.
        getCommandBoard(env).catch(() => ({ signalTypes: [] as SignalType[] })),
      ]);
      setRules(r);
      setMetrics(m);
      setSignalTypes(board.signalTypes ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [env]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Signal type claiming a metric, or null when an alert on it goes nowhere. */
  const wiredTo = useCallback(
    (metricKey: string) => signalTypeForMetric(signalTypes, metricKey),
    [signalTypes],
  );

  function startNew() {
    setEditing("new");
    setMetric(metrics[0]?.key ?? "");
    setOp(">=");
    setThreshold("90");
    setSeverity("critical");
    setUnitKind("");
    setMessage("{unit} — {value}");
    setRecommendation("");
    setError(null);
  }

  function startEdit(r: TwinAlertRule) {
    setEditing(r);
    setMetric(r.metric);
    setOp(r.op);
    setThreshold(String(r.threshold));
    setSeverity(r.severity);
    setUnitKind(r.unitKind ?? "");
    setMessage(r.messageTemplate);
    setRecommendation(r.recommendationTemplate ?? "");
    setError(null);
  }

  async function save() {
    const value = Number(threshold);
    if (!metric || !Number.isFinite(value) || !message.trim()) {
      setError("A metric, a numeric threshold and a message are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        metric,
        op,
        threshold: value,
        severity,
        unitKind: unitKind || null,
        messageTemplate: message.trim(),
        recommendationTemplate: recommendation.trim() || undefined,
      };
      if (editing === "new") await createTwinAlertRule(env, body);
      else if (editing) await updateTwinAlertRule(env, editing.id, body);
      await reload();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: TwinAlertRule) {
    const ok = window.confirm(
      `Delete this rule?\n\n${r.metric} ${r.op} ${r.threshold}\n\nOpen alerts it already raised stay where they are.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteTwinAlertRule(env, r.id);
      await reload();
      if (editing !== "new" && editing?.id === r.id) setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Point an existing signal type at this metric, so the alert reaches Response. */
  async function wire() {
    if (!wireTo || !metric) return;
    setBusy(true);
    setError(null);
    try {
      await setSignalTypeAlertMetric(env, wireTo, metric, rewiring);
      await reload();
      setWireTo("");
      setRewiring(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const metricLabel = (key: string) =>
    metrics.find((m) => m.key === key)?.label ?? key;

  const draftSignal = wiredTo(metric);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]">
      <div className="flex max-h-[80vh] w-[760px] overflow-hidden rounded-md border border-line bg-white shadow-lg">
        {/* list */}
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-line">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <p className="flex-1 text-xs font-medium text-ink">Alert rules</p>
            <button
              type="button"
              onClick={startNew}
              title="New rule"
              className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-brand"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rules.length === 0 ? (
              <p className="px-3 py-2 text-[10.5px] leading-snug text-ink-faint">
                No rule yet, so nothing the twin measures can raise a signal.
              </p>
            ) : (
              rules.map((r) => {
                const reaches = wiredTo(r.metric) !== null;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => startEdit(r)}
                    className={cn(
                      "flex w-full items-start gap-2 border-l-[3px] px-3 py-1.5 text-left",
                      editing !== "new" && editing?.id === r.id
                        ? "border-l-brand bg-brand-soft"
                        : "border-l-transparent hover:bg-canvas-raised",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium text-ink">
                        {metricLabel(r.metric)} {r.op} {r.threshold}
                      </span>
                      <span className="block truncate text-[10px] text-ink-faint">
                        {r.severity}
                        {r.unitKind ? ` · ${r.unitKind}` : " · every unit"}
                      </span>
                    </span>
                    {!reaches ? (
                      <AlertTriangle
                        className="mt-0.5 h-3 w-3 shrink-0 text-warn"
                        aria-label="Not wired to a signal type"
                      />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          <p className="border-t border-line-soft px-3 py-2 text-[10px] leading-snug text-ink-faint">
            A rule is evaluated on every twin refresh. It opens one alert per unit and closes it
            when the condition clears.
          </p>
        </aside>

        {/* form */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <p className="flex-1 text-xs font-medium text-ink">
              {editing === "new" ? "New rule" : editing ? "Edit rule" : "Pick a rule"}
            </p>
            {editing && editing !== "new" ? (
              <button
                type="button"
                onClick={() => void remove(editing)}
                title="Delete this rule"
                className="rounded p-0.5 text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-ink-body"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {!editing ? (
            <p className="p-6 text-center text-[11.5px] leading-relaxed text-ink-faint">
              Choose a rule to change its threshold,
              <br />
              or add one so the twin can raise a signal.
            </p>
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <div>
                  <span className={LABEL}>Raise an alert when</span>
                  <div className="mt-1 flex gap-1.5">
                    <select
                      value={metric}
                      onChange={(e) => setMetric(e.target.value)}
                      className={cn(FIELD, "flex-1")}
                    >
                      {metrics.length === 0 ? <option value="">no metric defined</option> : null}
                      {metrics.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={op}
                      onChange={(e) => setOp(e.target.value as TwinAlertOp)}
                      className={cn(FIELD, "w-[130px] shrink-0")}
                    >
                      {OPS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      inputMode="decimal"
                      className={cn(FIELD, "w-[80px] shrink-0 tabular-nums")}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-ink-faint">
                    key · {metric || "—"} — a rule names a metric by its key, not its label.
                  </p>
                </div>

                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <span className={LABEL}>Severity</span>
                    <select
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value as TwinAlertSeverity)}
                      className={cn(FIELD, "mt-1")}
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className={LABEL}>Only on units of kind</span>
                    <select
                      value={unitKind}
                      onChange={(e) => setUnitKind(e.target.value)}
                      className={cn(FIELD, "mt-1")}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k || "every unit"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <span className={LABEL}>Message</span>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="{unit} — {value}"
                    className={cn(FIELD, "mt-1")}
                  />
                  <p className="mt-1 text-[10px] text-ink-faint">
                    {["{unit}", "{value}", "{threshold}"].map((p, i) => (
                      <span key={p}>
                        {i > 0 ? " · " : ""}
                        <span className="rounded bg-canvas-raised px-1 ring-1 ring-line-soft">
                          {p}
                        </span>
                      </span>
                    ))}{" "}
                    are replaced when the alert fires. Anything else is left as written, so a
                    typo shows rather than leaving a gap in the sentence.
                  </p>
                  {message && /\{\{?(\w+)\}?\}/.test(message) ? (
                    <p className="mt-1 text-[10px] text-ink-muted">
                      preview ·{" "}
                      <span className="text-ink-body">
                        {message
                          .replace(/\{\{?unit\}?\}/g, "HND Emergency")
                          .replace(/\{\{?value\}?\}/g, "96.67")
                          .replace(/\{\{?threshold\}?\}/g, threshold || "90")}
                      </span>
                    </p>
                  ) : null}
                </div>

                <div>
                  <span className={LABEL}>Recommendation — optional</span>
                  <input
                    value={recommendation}
                    onChange={(e) => setRecommendation(e.target.value)}
                    placeholder="Consider diverting admissions"
                    className={cn(FIELD, "mt-1")}
                  />
                </div>

                {/* the wiring, which is otherwise invisible */}
                {draftSignal ? (
                  <div className="rounded border border-ok/40 bg-ok-soft px-2 py-1.5 text-[10.5px] leading-snug text-ok-ink">
                    <p>
                      Reaches Response as <b className="font-semibold">{draftSignal.name}</b> in{" "}
                      <b className="font-semibold">{draftSignal.domain}</b>.
                    </p>
                    {/*
                      Rewiring has to be reachable from the wired state too. The
                      first version of this panel only offered the control when
                      nothing claimed the metric, so an occupancy alert pointed
                      at a staffing signal type — green, and wrong — had no way
                      back. Being wired is not the same as being wired correctly.
                    */}
                    {rewiring ? (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <select
                          value={wireTo}
                          onChange={(e) => setWireTo(e.target.value)}
                          className="min-w-0 flex-1 rounded border border-ok/40 bg-white px-1.5 py-1 text-[10.5px] text-ink focus:border-brand focus:outline-none"
                        >
                          <option value="">raise it as…</option>
                          {signalTypes
                            .filter((st) => st.active)
                            .map((st) => (
                              <option key={st.key} value={st.key}>
                                {st.name} · {st.domain}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          disabled={!wireTo || busy}
                          onClick={() => void wire()}
                          className="shrink-0 rounded border border-ok/40 bg-white px-2 py-1 text-[10.5px] font-medium text-ok-ink disabled:opacity-40"
                        >
                          Rewire
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRewiring(true)}
                        className="mt-1 underline underline-offset-2"
                      >
                        raise it as something else
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded border border-warn-line bg-warn-soft px-2 py-1.5 text-[10.5px] leading-snug text-warn-ink">
                    <p>
                      <b className="font-semibold">This alert will reach nobody.</b> No signal type
                      claims <span className="font-medium">{metric || "this metric"}</span>, so the
                      alert opens on the unit and the response board stays empty — silently.
                    </p>
                    {/*
                      Fixable here rather than "go and fix it in Response": this
                      is where you find out, and the wiring is one field.
                    */}
                    {metric && signalTypes.length > 0 ? (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <select
                          value={wireTo}
                          onChange={(e) => setWireTo(e.target.value)}
                          className="min-w-0 flex-1 rounded border border-warn-line bg-white px-1.5 py-1 text-[10.5px] text-ink focus:border-brand focus:outline-none"
                        >
                          <option value="">raise it as…</option>
                          {signalTypes
                            .filter((st) => st.active)
                            .map((st) => (
                              <option key={st.key} value={st.key}>
                                {st.name} · {st.domain}
                                {st.alertMetric ? ` (now ${st.alertMetric})` : ""}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          disabled={!wireTo || busy}
                          onClick={() => void wire()}
                          className="shrink-0 rounded border border-warn-line bg-white px-2 py-1 text-[10.5px] font-medium text-warn-ink disabled:opacity-40"
                        >
                          Wire it
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {error ? (
                <p className="mx-3 mb-2 rounded border border-danger/40 bg-danger-soft px-2 py-1.5 text-[11px] text-danger-ink">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-line-soft px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded border border-line px-3 py-1.5 text-[11px] text-ink-body"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || metrics.length === 0}
                  onClick={() => void save()}
                  className="inline-flex items-center gap-1.5 rounded border border-brand-deep bg-brand px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Save
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
