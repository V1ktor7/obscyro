"use client";

import { useMemo, useState } from "react";

import type { SimExport } from "@/lib/platform-api";

import {
  ACTION_FIELDS,
  ACTION_LABEL,
  METRIC_FIELDS,
  METRIC_LABEL,
  blankRule,
  compoundingWarning,
  describeRule,
  ruleProblem,
  type ActionKind,
  type CompareOp,
  type MetricFn,
  type PolicyRule,
  type TriggerWhen,
} from "./policy-shape";

/**
 * Writing a response, in the vocabulary of the twin in front of you.
 *
 * Every list on this screen is read off the export rather than typed: the
 * facilities are the ones that exist, the resources are the ones somebody
 * declared, the catchments are the twelve that carry a head count. An id typed
 * by hand is a rule that fires against nothing and reports success.
 *
 * Each rule shows its own sentence underneath as you build it. The engine
 * renders the same sentence into the trace after a run — seeing it beforehand
 * is the difference between writing a rule and guessing at one.
 */

export interface PolicyDraft {
  id?: string;
  name: string;
  description: string;
  rules: PolicyRule[];
}

const OPS: CompareOp[] = [">", ">=", "<", "<=", "==", "!="];
const WHENS: Array<{ id: TriggerWhen; label: string }> = [
  { id: "every_tick", label: "every step" },
  { id: "from_tick", label: "from step" },
  { id: "between", label: "between two steps" },
];

export default function PolicyComposer({
  snapshot,
  initial,
  onSave,
  onCancel,
}: {
  snapshot: SimExport;
  initial: PolicyDraft | null;
  onSave: (draft: PolicyDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rules, setRules] = useState<PolicyRule[]>(
    initial?.rules?.length ? initial.rules : [blankRule("r1")],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facilities = useMemo(
    () =>
      [...snapshot.facilities]
        .filter((f) => Object.keys(f.resources).length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot],
  );
  const activities = useMemo(() => {
    const out = new Set<string>();
    for (const f of snapshot.facilities) {
      for (const r of Object.values(f.resources)) for (const a of r.enables) out.add(a);
    }
    return Array.from(out).sort();
  }, [snapshot]);
  const acuities = useMemo(() => {
    const out = new Set<string>();
    for (const t of snapshot.object_types) {
      const key = t.properties.find((p) => p.mechanic === "serves_severity")?.key;
      if (!key) continue;
      for (const o of snapshot.objects) {
        if (o.type !== t.name) continue;
        const v = o.properties[key];
        if (typeof v === "string" && v.trim()) out.add(v.trim());
      }
    }
    return Array.from(out).sort();
  }, [snapshot]);

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of snapshot.facilities) m.set(f.id, f.name);
    for (const p of snapshot.populations) m.set(p.id, p.name);
    return (id: string) => m.get(id) ?? id;
  }, [snapshot]);

  function patch(i: number, fn: (r: PolicyRule) => PolicyRule) {
    setRules((prev) => prev.map((r, j) => (j === i ? fn(structuredClone(r)) : r)));
  }

  const problems = rules.map(ruleProblem);
  const blocked = !name.trim()
    ? "Give the response a name."
    : rules.length === 0
      ? "A response with no rules does nothing."
      : (problems.find((p) => p) ?? null);

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ id: initial?.id, name: name.trim(), description, rules });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <div className="flex items-center justify-between border-b border-line bg-white px-6 py-3">
        <div className="flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this response"
            aria-label="Name this response"
            className="w-full max-w-lg border-0 bg-transparent p-0 text-sm font-medium text-ink placeholder:text-ink-ghost focus:outline-none"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What it does, and why"
            aria-label="Description"
            className="mt-1 w-full max-w-2xl border-0 bg-transparent p-0 text-[11px] text-ink-faint placeholder:text-ink-ghost focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-body hover:border-ink-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!!blocked || saving}
            className="rounded-md bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-deep disabled:bg-ink-ghost"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mx-6 mt-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 px-6 py-5">
        {rules.map((rule, i) => {
          const kind = rule.action.kind;
          const shown = ACTION_FIELDS[kind];
          const compare = "compare" in rule.condition ? rule.condition.compare : null;
          const warn = compoundingWarning(rule);
          return (
            <section
              key={i}
              className="rounded-lg border border-line bg-white p-4"
              aria-label={`Rule ${i + 1}`}
            >
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={rule.id}
                  onChange={(e) => patch(i, (r) => ({ ...r, id: e.target.value }))}
                  aria-label={`Name of rule ${i + 1}`}
                  className="w-32 rounded-md border border-line px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                />
                <Select
                  label={`Action of rule ${i + 1}`}
                  value={kind}
                  onChange={(v) =>
                    patch(i, (r) => ({ ...r, action: { ...blankRule(r.id, v as ActionKind).action } }))
                  }
                  options={Object.entries(ACTION_LABEL).map(([id, l]) => ({ id, label: l }))}
                />
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setRules((p) => p.filter((_, j) => j !== i))}
                  className="text-[11px] text-ink-faint hover:text-danger"
                >
                  Remove
                </button>
              </div>

              <Row label="When">
                <Select
                  label={`Trigger of rule ${i + 1}`}
                  value={rule.trigger.when}
                  onChange={(v) =>
                    patch(i, (r) => ({ ...r, trigger: { ...r.trigger, when: v as TriggerWhen } }))
                  }
                  options={WHENS.map((w) => ({ id: w.id, label: w.label }))}
                />
                {rule.trigger.when !== "every_tick" ? (
                  <Num
                    label={`Start step of rule ${i + 1}`}
                    value={rule.trigger.start}
                    onChange={(n) => patch(i, (r) => ({ ...r, trigger: { ...r.trigger, start: n } }))}
                  />
                ) : null}
                {rule.trigger.when === "between" ? (
                  <Num
                    label={`End step of rule ${i + 1}`}
                    value={rule.trigger.end ?? rule.trigger.start}
                    onChange={(n) => patch(i, (r) => ({ ...r, trigger: { ...r.trigger, end: n } }))}
                  />
                ) : null}
              </Row>

              <Row label="If">
                <Select
                  label={`Condition of rule ${i + 1}`}
                  value={compare ? compare.left.fn : "always"}
                  onChange={(v) =>
                    patch(i, (r) => ({
                      ...r,
                      condition:
                        v === "always"
                          ? { always: true }
                          : {
                              compare: {
                                left: { fn: v as MetricFn },
                                op: ">",
                                right: 0,
                              },
                            },
                    }))
                  }
                  options={[
                    { id: "always", label: "always" },
                    ...Object.entries(METRIC_LABEL).map(([id, l]) => ({ id, label: l })),
                  ]}
                />
                {compare ? (
                  <>
                    {METRIC_FIELDS[compare.left.fn].map((f) => (
                      <Select
                        key={String(f)}
                        label={`${String(f)} of the reading, rule ${i + 1}`}
                        value={String(compare.left[f] ?? "")}
                        onChange={(v) =>
                          patch(i, (r) => {
                            const c = (r.condition as { compare: NonNullable<typeof compare> }).compare;
                            c.left = { ...c.left, [f]: v || null };
                            return r;
                          })
                        }
                        options={optionsFor(String(f), { facilities, activities, acuities, pops: snapshot.populations })}
                        allowBlank
                      />
                    ))}
                    <Select
                      label={`Comparison of rule ${i + 1}`}
                      value={compare.op}
                      onChange={(v) =>
                        patch(i, (r) => {
                          (r.condition as { compare: NonNullable<typeof compare> }).compare.op =
                            v as CompareOp;
                          return r;
                        })
                      }
                      options={OPS.map((o) => ({ id: o, label: o }))}
                    />
                    <Num
                      label={`Threshold of rule ${i + 1}`}
                      value={compare.right}
                      step="any"
                      onChange={(n) =>
                        patch(i, (r) => {
                          (r.condition as { compare: NonNullable<typeof compare> }).compare.right = n;
                          return r;
                        })
                      }
                    />
                  </>
                ) : null}
              </Row>

              <Row label="Then">
                {shown.map((f) =>
                  f === "amount" || f === "factor" ? (
                    <Num
                      key={String(f)}
                      label={`${f === "amount" ? "Amount" : "Factor"} of rule ${i + 1}`}
                      value={Number(rule.action[f] ?? 0)}
                      step="any"
                      onChange={(n) =>
                        patch(i, (r) => ({ ...r, action: { ...r.action, [f]: n } }))
                      }
                    />
                  ) : (
                    <Select
                      key={String(f)}
                      label={`${String(f)} of rule ${i + 1}`}
                      value={String(rule.action[f] ?? "")}
                      onChange={(v) =>
                        patch(i, (r) => ({ ...r, action: { ...r.action, [f]: v || null } }))
                      }
                      options={optionsFor(String(f), { facilities, activities, acuities, pops: snapshot.populations })}
                      allowBlank
                    />
                  ),
                )}
              </Row>

              <Row label="Costs">
                <Num
                  label={`Delay of rule ${i + 1}`}
                  value={rule.action.friction.delay}
                  suffix="steps of delay"
                  onChange={(n) =>
                    patch(i, (r) => ({
                      ...r,
                      action: { ...r.action, friction: { ...r.action.friction, delay: n } },
                    }))
                  }
                />
                <Num
                  label={`Cost of rule ${i + 1}`}
                  value={rule.action.friction.cost}
                  suffix="$"
                  step="any"
                  onChange={(n) =>
                    patch(i, (r) => ({
                      ...r,
                      action: { ...r.action, friction: { ...r.action.friction, cost: n } },
                    }))
                  }
                />
              </Row>

              <p className="mt-3 border-t border-line-soft pt-3 text-[11px] leading-relaxed text-ink-body">
                {describeRule(rule, labelOf)}
              </p>
              {problems[i] ? (
                <p className="mt-1 text-[11px] text-danger">{problems[i]}</p>
              ) : null}
              {warn ? <p className="mt-1 text-[11px] text-warn">{warn}</p> : null}
            </section>
          );
        })}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRules((p) => [...p, blankRule(`r${p.length + 1}`)])}
            className="rounded-md border border-line bg-white px-3 py-1.5 text-xs text-ink-body hover:border-ink-ghost"
          >
            Add a rule
          </button>
          {/* One rule per catchment is how any public-health lever is written,
              and typing twelve of them by hand is not a workflow. */}
          <button
            type="button"
            onClick={() =>
              setRules((p) => [
                ...p,
                ...snapshot.populations.map((pop, k) => {
                  const r = blankRule(`dem${p.length + k + 1}`, "modify_demand");
                  r.action.population = pop.id;
                  r.action.factor = 0.7;
                  r.trigger = { when: "between", start: 21, end: 21 };
                  return r;
                }),
              ])
            }
            className="rounded-md border border-line bg-white px-3 py-1.5 text-xs text-ink-body hover:border-ink-ghost"
          >
            One demand rule per catchment ({snapshot.populations.length})
          </button>
        </div>

        {blocked ? <p className="text-[11px] text-ink-faint">{blocked}</p> : null}
      </div>
    </div>
  );
}

function optionsFor(
  field: string,
  src: {
    facilities: SimExport["facilities"];
    activities: string[];
    acuities: string[];
    pops: SimExport["populations"];
  },
): Array<{ id: string; label: string }> {
  if (field === "source" || field === "target" || field === "facility") {
    return src.facilities.map((f) => ({ id: f.id, label: f.name }));
  }
  if (field === "population") return src.pops.map((p) => ({ id: p.id, label: p.name }));
  if (field === "activity" || field === "resource") {
    return src.activities.map((a) => ({ id: a, label: a }));
  }
  if (field === "acuity") return src.acuities.map((a) => ({ id: a, label: a }));
  if (field === "category") {
    return ["space", "staff", "stuff", "systems"].map((c) => ({ id: c, label: c }));
  }
  return [];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  allowBlank,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
  allowBlank?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[16rem] rounded-md border border-line bg-white px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
    >
      {allowBlank ? <option value="">—</option> : null}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Num({
  label,
  value,
  onChange,
  suffix,
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        step={step}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-md border border-line bg-white px-2 py-1 text-right text-xs text-ink focus:border-brand focus:outline-none"
      />
      {suffix ? <span className="text-[11px] text-ink-faint">{suffix}</span> : null}
    </span>
  );
}
