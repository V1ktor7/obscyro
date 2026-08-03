"use client";

import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import {
  listEnvTypes,
  listTwinMetrics,
  retireTwinMetric,
  saveTwinMetric,
  type EnvObjectType,
  type TwinMetric,
  type TwinMetricSelector,
  type TwinMetricUnit,
} from "@/lib/platform-api";

// ---------------------------------------------------------------------------
// The editor for what the twin displays.
//
// Types and properties come from the ontology as dropdowns rather than free
// text. A metric that counts `Bed` where `status` is `occupied` is only useful
// if those three strings match rows that exist, and a text field is a machine
// for getting them subtly wrong — `Beds`, `Status`, `Occupied`.
//
// A denominator is offered only for a percentage or a ratio. "Staff available"
// is a count; asking what to divide it by would invite an answer.
// ---------------------------------------------------------------------------

const UNITS: { value: TwinMetricUnit; label: string; hint: string }[] = [
  { value: "percent", label: "Percentage", hint: "shown as 76%" },
  { value: "ratio", label: "Ratio", hint: "shown as 0.76" },
  { value: "count", label: "Count", hint: "shown as 4" },
  { value: "number", label: "Number", hint: "shown as 12.3" },
];

const AGGS = ["count", "sum", "mean", "min", "max"] as const;

const FIELD =
  "w-full rounded border border-line bg-white px-2 py-1.5 text-[11.5px] text-ink focus:border-brand focus:outline-none";
const LABEL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";

function emptySelector(): TwinMetricSelector {
  return { ofType: null, where: [], agg: "count", property: null };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export default function MetricEditor({
  env,
  onClose,
  onSaved,
}: {
  env: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [metrics, setMetrics] = useState<TwinMetric[]>([]);
  const [types, setTypes] = useState<EnvObjectType[]>([]);
  const [editing, setEditing] = useState<TwinMetric | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // draft
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState<TwinMetricUnit>("count");
  const [numerator, setNumerator] = useState<TwinMetricSelector>(emptySelector);
  const [denominator, setDenominator] = useState<TwinMetricSelector | null>(null);

  const reload = useMemo(
    () => async () => {
      try {
        const [{ metrics: list }, schema] = await Promise.all([
          listTwinMetrics(env),
          listEnvTypes(env).catch(() => ({ types: [] as EnvObjectType[] })),
        ]);
        setMetrics(list);
        setTypes(schema.types);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [env],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  function startNew() {
    setEditing("new");
    setKey("");
    setLabel("");
    setUnit("count");
    setNumerator(emptySelector());
    setDenominator(null);
    setError(null);
  }

  function startEdit(m: TwinMetric) {
    setEditing(m);
    setKey(m.key);
    setLabel(m.label);
    setUnit(m.unit);
    setNumerator({ ...emptySelector(), ...m.numerator, where: m.numerator.where ?? [] });
    setDenominator(
      m.denominator ? { ...emptySelector(), ...m.denominator, where: m.denominator.where ?? [] } : null,
    );
    setError(null);
  }

  // A percentage or a ratio has to divide by something; a count must not.
  useEffect(() => {
    const needs = unit === "percent" || unit === "ratio";
    setDenominator((cur) => (needs ? (cur ?? emptySelector()) : null));
  }, [unit]);

  async function save() {
    const finalKey = editing === "new" ? slug(key || label) : key;
    if (!finalKey || !label.trim()) {
      setError("A key and a label are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveTwinMetric(env, finalKey, {
        label: label.trim(),
        unit,
        numerator,
        denominator,
      });
      await reload();
      setEditing(null);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: TwinMetric) {
    const ok = window.confirm(
      `Retire "${m.label}"?\n\nAn alert rule that thresholds on "${m.key}" will stop finding a value.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await retireTwinMetric(env, m.key);
      await reload();
      if (editing !== "new" && editing?.key === m.key) setEditing(null);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]">
      <div className="flex max-h-[80vh] w-[720px] overflow-hidden rounded-md border border-line bg-white shadow-lg">
        {/* list */}
        <aside className="flex w-[230px] shrink-0 flex-col border-r border-line">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <p className="flex-1 text-xs font-medium text-ink">Metrics</p>
            <button
              type="button"
              onClick={startNew}
              title="New metric"
              className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-brand"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {metrics.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => startEdit(m)}
                className={cn(
                  "flex w-full items-center gap-2 border-l-[3px] px-3 py-1.5 text-left",
                  editing !== "new" && editing?.key === m.key
                    ? "border-l-brand bg-brand-soft"
                    : "border-l-transparent hover:bg-canvas-raised",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">
                  {m.label}
                </span>
                <span className="shrink-0 text-[9.5px] text-ink-faint">{m.unit}</span>
              </button>
            ))}
          </div>
          <p className="border-t border-line-soft px-3 py-2 text-[10px] leading-snug text-ink-faint">
            A metric is evaluated over a unit and everything under it, so a
            hospital&apos;s number is its wards&apos; totals — not their average.
          </p>
        </aside>

        {/* form */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <p className="flex-1 text-xs font-medium text-ink">
              {editing === "new" ? "New metric" : editing ? editing.label : "Pick a metric"}
            </p>
            {editing && editing !== "new" ? (
              <button
                type="button"
                onClick={() => void remove(editing)}
                title="Retire this metric"
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
              Choose a metric to change what it counts,
              <br />
              or add one the twin does not display yet.
            </p>
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <span className={LABEL}>Label</span>
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Occupancy"
                      className={cn(FIELD, "mt-1")}
                    />
                  </div>
                  <div className="w-[150px] shrink-0">
                    <span className={LABEL}>Shown as</span>
                    <select
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as TwinMetricUnit)}
                      className={cn(FIELD, "mt-1")}
                    >
                      {UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label} — {u.hint}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <p className="text-[10px] text-ink-faint">
                  key ·{" "}
                  <span className="tabular-nums">
                    {editing === "new" ? slug(key || label) || "…" : key}
                  </span>
                  {editing === "new"
                    ? " — what an alert rule names. Fixed once saved."
                    : " — an alert rule may reference this."}
                </p>

                <SelectorForm
                  title={denominator ? "Numerator" : "What to measure"}
                  types={types}
                  value={numerator}
                  onChange={setNumerator}
                />

                {denominator ? (
                  <SelectorForm
                    title="Divided by"
                    types={types}
                    value={denominator}
                    onChange={(v) => setDenominator(v)}
                  />
                ) : null}
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
                  disabled={busy}
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

function SelectorForm({
  title,
  types,
  value,
  onChange,
}: {
  title: string;
  types: EnvObjectType[];
  value: TwinMetricSelector;
  onChange: (v: TwinMetricSelector) => void;
}) {
  const chosen = types.find((t) => t.name === value.ofType);
  const props = chosen?.propertySchema ?? [];
  const numericProps = props.filter((p) => p.type === "number");
  const where = value.where ?? [];

  return (
    <div className="rounded border border-line bg-canvas-raised p-2.5">
      <p className={cn(LABEL, "mb-2 block")}>{title}</p>

      <div className="flex gap-2">
        <div className="w-[130px] shrink-0">
          <span className="text-[10px] text-ink-faint">Aggregate</span>
          <select
            value={value.agg}
            onChange={(e) =>
              onChange({ ...value, agg: e.target.value as TwinMetricSelector["agg"] })
            }
            className={cn(FIELD, "mt-1")}
          >
            {AGGS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] text-ink-faint">Object type</span>
          <select
            value={value.ofType ?? ""}
            onChange={(e) =>
              onChange({ ...value, ofType: e.target.value || null, where: [] })
            }
            className={cn(FIELD, "mt-1")}
          >
            <option value="">any type</option>
            {types.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {value.agg !== "count" ? (
        <div className="mt-2">
          <span className="text-[10px] text-ink-faint">Numeric property to {value.agg}</span>
          <select
            value={value.property ?? ""}
            onChange={(e) => onChange({ ...value, property: e.target.value || null })}
            className={cn(FIELD, "mt-1")}
          >
            <option value="">choose…</option>
            {numericProps.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label ?? p.key}
              </option>
            ))}
          </select>
          {chosen && numericProps.length === 0 ? (
            <p className="mt-1 text-[10px] text-warn-ink">
              {chosen.name} has no numeric property — only a count works here.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2">
        <span className="text-[10px] text-ink-faint">Only where</span>
        {where.length === 0 ? (
          <p className="mt-1 text-[10.5px] text-ink-faint">no filter — every instance counts</p>
        ) : null}
        {where.map((f, i) => (
          <div key={i} className="mt-1 flex items-center gap-1.5">
            <select
              value={f.property}
              onChange={(e) => {
                const next = [...where];
                next[i] = { ...f, property: e.target.value };
                onChange({ ...value, where: next });
              }}
              className={cn(FIELD, "flex-1")}
            >
              <option value="">property…</option>
              {props.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label ?? p.key}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-[11px] text-ink-faint">=</span>
            <input
              value={f.equals}
              onChange={(e) => {
                const next = [...where];
                next[i] = { ...f, equals: e.target.value };
                onChange({ ...value, where: next });
              }}
              placeholder="occupied"
              className={cn(FIELD, "flex-1")}
            />
            <button
              type="button"
              onClick={() => onChange({ ...value, where: where.filter((_, j) => j !== i) })}
              className="shrink-0 rounded p-0.5 text-ink-faint hover:text-danger"
              aria-label="Remove filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({ ...value, where: [...where, { property: "", equals: "" }] })
          }
          className="mt-1.5 text-[11px] text-brand hover:underline"
        >
          + add a filter
        </button>
      </div>
    </div>
  );
}
