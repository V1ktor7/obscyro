"use client";

/**
 * Function types: the reading tools of the analyst that this project declares.
 *
 * The analyst's own tools are code. An institution that wants it to read
 * something of its own declares a tool here, from one of five blocks the
 * program already knows how to run. Nothing typed here is run as code: a
 * formula is evaluated by the calculator, which knows arithmetic and nothing
 * else.
 *
 * A declared tool is tried before it is trusted: "Try" runs it once with the
 * inputs a person gives and shows what the analyst would read, without calling
 * any model.
 *
 * What a tool points at is picked from what the project holds: its object
 * types and their properties, the measures the twin keeps, its datasets. A
 * tool that points at something the project does not hold says so, with what
 * is missing.
 */

import { Loader2, Pencil, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  createFunctionType,
  fetchFunctionTypes,
  removeFunctionType,
  saveFunctionType,
  tryFunctionType,
  type FunctionOffer,
  type FunctionTrial,
  type FunctionType,
  type FunctionTypeList,
} from "../analyst-api";
import { AGGS, BLOCKS, STANDINGS, blankFunctionForm, blockLabel, draftOfFunction, formOfFunction, inputText, saysOf, trialInput, type FilterForm, type FunctionForm, type InputForm } from "./function-types";

const LABEL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";
const FIELD = "rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none disabled:opacity-60";
const BUTTON = "flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-body hover:border-brand disabled:opacity-50";
const SMALL = "text-[11px] text-brand hover:underline disabled:text-ink-ghost disabled:no-underline";
const why = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

type Read = { state: "loading" } | { state: "failed"; why: string } | { state: "read"; list: FunctionTypeList };

export function FunctionTypesPage({ env, onChanged }: { env: string | null; onChanged?: () => void }) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  /** The key being edited, "" for a new type, null when the form is closed. */
  const [editing, setEditing] = useState<string | null>(null);
  const [trying, setTrying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!env) return;
    let stale = false;
    fetchFunctionTypes(env).then(
      (list) => !stale && setRead({ state: "read", list }),
      (e: unknown) => !stale && setRead({ state: "failed", why: why(e, "Check the connection and read again.") }),
    );
    return () => {
      stale = true;
    };
  }, [env]);
  useEffect(() => load(), [load]);

  if (!env) return <p className="text-xs text-ink-muted">Open an environment to read its function types.</p>;
  if (read.state === "loading") return <p className="text-xs text-ink-muted">Reading the function types…</p>;
  if (read.state === "failed") {
    return (
      <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-xs text-danger-ink">
        The function types could not be read: {read.why}
      </p>
    );
  }
  const { list } = read;
  const changed = () => {
    load();
    onChanged?.();
  };

  async function act(tag: string, work: () => Promise<unknown>, failed: string) {
    setBusy(tag);
    setProblem(null);
    try {
      await work();
      changed();
    } catch (e) {
      setProblem(why(e, failed));
    } finally {
      setBusy(null);
    }
  }
  const toggle = (t: FunctionType) =>
    act(`toggle:${t.key}`, () => saveFunctionType(env, t.key, { ...draftOfFunction(formOfFunction(t)).draft, active: !t.active }), "The tool could not be changed. Check the connection and try again.");
  const remove = (t: FunctionType) => {
    if (!window.confirm(`Remove the tool “${t.label}”? The analyst will no longer be offered it. Answers already given keep the steps where it was used.`)) return;
    void act(`remove:${t.key}`, () => removeFunctionType(env, t.key), "The tool could not be removed. Check the connection and try again.");
  };

  return (
    <div className="flex max-w-5xl flex-col gap-3 text-xs text-ink-body">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 leading-relaxed text-ink-muted">
          A function type is a reading tool you declare for the analyst: what it reads, from which of five blocks, and what it is given. It only
          reads, and nothing written here is run as code. The analyst is offered it from its next exchange, and every figure it returns is checked
          like any other. {list.types.length === 0 ? "This project declared none: the analyst has the tools of the code, listed above." : ""}
        </p>
        <button type="button" onClick={() => load()} className={cn(BUTTON, "shrink-0")}>
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Read again
        </button>
        <button type="button" disabled={editing !== null} onClick={() => setEditing("")} className={cn(BUTTON, "shrink-0")}>
          <Plus className="h-3 w-3" aria-hidden="true" />
          Declare a tool
        </button>
      </div>

      {problem ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-danger-ink">{problem}</p>
      ) : null}
      {list.unreadable.length ? (
        <p role="alert" className="rounded bg-warn-soft px-2 py-1.5 text-warn-ink">
          {list.unreadable.length === 1 ? "One stored tool can" : `${list.unreadable.length} stored tools can`} no longer be read and {list.unreadable.length === 1 ? "is" : "are"} not offered to the analyst:{" "}
          {list.unreadable.join(", ")}.
        </p>
      ) : null}

      {editing === "" ? (
        <FunctionTypeForm
          key="new"
          initial={blankFunctionForm()}
          fixedBlock={false}
          offer={list.offer}
          title="New tool"
          onCancel={() => setEditing(null)}
          onSave={(form) => createFunctionType(env, draftOfFunction(form).draft)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {list.types.map((t) =>
          editing === t.key ? (
            <li key={t.key}>
              <FunctionTypeForm
                initial={formOfFunction(t)}
                fixedBlock
                offer={list.offer}
                title={t.label}
                onCancel={() => setEditing(null)}
                onSave={(form) => saveFunctionType(env, t.key, draftOfFunction(form).draft)}
                onSaved={() => {
                  setEditing(null);
                  changed();
                }}
              />
            </li>
          ) : (
            <li key={t.key} aria-label={t.label} className={cn("rounded-md border bg-surface p-3", t.active ? "border-line" : "border-line-soft opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">{t.label}</span>
                <span className="rounded bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand-deep">{blockLabel(t.block)}</span>
                <code className="rounded bg-canvas px-1 text-[10.5px] text-ink-muted" title="The tool's name, as the analyst calls it">{t.key}</code>
                <span className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={t.active}
                    aria-label={`${t.label}: ${t.active ? "on" : "off"}`}
                    disabled={busy !== null}
                    onClick={() => void toggle(t)}
                    className={cn("flex h-5 w-9 items-center rounded-full border px-0.5 disabled:opacity-50", t.active ? "justify-end border-brand bg-brand-soft" : "justify-start border-line bg-canvas")}
                  >
                    <span className={cn("h-3.5 w-3.5 rounded-full", t.active ? "bg-brand" : "bg-ink-ghost")} />
                  </button>
                  <span className="w-6 text-[10.5px] text-ink-muted">{busy === `toggle:${t.key}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : t.active ? "On" : "Off"}</span>
                  <button type="button" onClick={() => setTrying(trying === t.key ? null : t.key)} aria-expanded={trying === t.key} className={BUTTON}>
                    <Play className="h-3 w-3" aria-hidden="true" />
                    Try
                  </button>
                  <button type="button" disabled={editing !== null || busy !== null} onClick={() => setEditing(t.key)} className={BUTTON}>
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    Edit
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => remove(t)} className={BUTTON}>
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    Remove
                  </button>
                </span>
              </div>
              <p className="mt-1 leading-relaxed text-ink-muted">{t.description}</p>
              <p className="mt-1 text-[11.5px] text-ink-body">{saysOf(t)}</p>
              {t.inputs.length ? (
                <p className="mt-1 text-[11px] text-ink-muted">
                  Given: {t.inputs.map((i) => `${i.name} (${inputText(i)})`).join(" · ")}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-faint">It is given nothing.</p>
              )}
              {!t.active ? <p className="mt-1 text-[11px] text-ink-muted">Switched off: the analyst is not offered it. It can still be tried.</p> : null}
              {t.missing ? (
                <p role="alert" className="mt-1.5 rounded bg-warn-soft px-2 py-1 text-[11px] text-warn-ink">
                  Cannot run on this project. {t.missing}
                </p>
              ) : null}
              {trying === t.key ? <TryPanel env={env} type={t} /> : null}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Run a declared tool once with what a person gives it, and show what the analyst would read. No model is called. */
function TryPanel({ env, type }: { env: string; type: FunctionType }) {
  const [filled, setFilled] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [trial, setTrial] = useState<FunctionTrial | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setProblem(null);
    try {
      setTrial(await tryFunctionType(env, type.key, trialInput(type.inputs, filled)));
    } catch (e) {
      setTrial(null);
      setProblem(why(e, "The tool could not be tried. Check the connection and try again."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <form
      aria-label={`Try ${type.label}`}
      className="mt-2 flex flex-col gap-2 rounded border border-line-soft bg-canvas p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {type.inputs.map((i) => (
          <label key={i.name} className="flex flex-col gap-0.5">
            <span className={LABEL}>
              {i.name}
              {i.required ? "" : " (optional)"}
            </span>
            {i.kind === "choice" ? (
              <select value={filled[i.name] ?? ""} onChange={(e) => setFilled((f) => ({ ...f, [i.name]: e.target.value }))} className={FIELD}>
                <option value="">—</option>
                {i.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={i.kind === "date" ? "date" : "text"}
                inputMode={i.kind === "number" ? "decimal" : undefined}
                value={filled[i.name] ?? ""}
                onChange={(e) => setFilled((f) => ({ ...f, [i.name]: e.target.value }))}
                title={i.says}
                className={cn(FIELD, "w-36")}
              />
            )}
          </label>
        ))}
        <button type="submit" disabled={running} className="flex items-center gap-1 rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-60">
          {running ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
          Run it once
        </button>
        <span className="text-[10.5px] text-ink-faint">No model is called, and nothing is kept.</span>
      </div>
      {problem ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1 text-danger-ink">{problem}</p>
      ) : null}
      {trial ? (
        trial.ok ? (
          <>
            <span className={LABEL}>What the analyst would read · {trial.ms} ms</span>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-2 font-mono text-[10.5px] text-ink">{JSON.stringify(trial.result, null, 2)}</pre>
          </>
        ) : (
          <p role="status" className="rounded bg-warn-soft px-2 py-1 text-warn-ink">
            Refused, as the analyst would be told: {trial.refused}
          </p>
        )
      ) : null}
    </form>
  );
}

/** A filter of a block: on a property or a column, equal to a written value or to one of the tool's inputs. */
function Filters({ label, options, inputs, value, onChange }: { label: string; options: string[]; inputs: InputForm[]; value: FilterForm[]; onChange: (next: FilterForm[]) => void }) {
  const put = (i: number, patch: Partial<FilterForm>) => onChange(value.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  return (
    <fieldset className="flex flex-col gap-1 sm:col-span-2">
      <legend className={LABEL}>{label}</legend>
      {value.length === 0 ? <span className="text-ink-faint">No filter: everything of it is read.</span> : null}
      {value.map((f, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <select value={f.on} onChange={(e) => put(i, { on: e.target.value })} aria-label={`Filter ${i + 1}: on`} className={FIELD}>
            <option value="">pick…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {f.on && !options.includes(f.on) ? <option value={f.on}>{f.on} (not there)</option> : null}
          </select>
          <span className="text-ink-faint">is</span>
          <select value={f.from} onChange={(e) => put(i, { from: e.target.value })} aria-label={`Filter ${i + 1}: taken from`} className={FIELD}>
            <option value="">a value written here</option>
            {inputs.filter((x) => x.name).map((x) => (
              <option key={x.name} value={x.name}>
                the input {x.name}
              </option>
            ))}
          </select>
          {f.from ? null : <input value={f.value} onChange={(e) => put(i, { value: e.target.value })} aria-label={`Filter ${i + 1}: value`} placeholder="available" className={cn(FIELD, "w-36")} />}
          <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label={`Remove filter ${i + 1}`} className="text-ink-faint hover:text-ink">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" disabled={value.length >= 6} onClick={() => onChange([...value, { on: "", from: "", value: "" }])} className={cn(SMALL, "self-start")}>
        Add a filter
      </button>
    </fieldset>
  );
}

function FunctionTypeForm({
  initial,
  fixedBlock,
  offer,
  title,
  onCancel,
  onSave,
  onSaved,
}: {
  initial: FunctionForm;
  /** A tool that exists keeps its block. */
  fixedBlock: boolean;
  offer: FunctionOffer;
  title: string;
  onCancel: () => void;
  onSave: (form: FunctionForm) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [f, setF] = useState<FunctionForm>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FunctionForm>(key: K, value: FunctionForm[K]) => setF((cur) => ({ ...cur, [key]: value }));
  const putInput = (i: number, patch: Partial<InputForm>) => set("inputs", f.inputs.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const propertiesOf = (type: string) => offer.objectTypes.find((t) => t.name === type)?.properties ?? [];
  const columns = offer.datasets.find((d) => d.slug === f.source || d.id === f.source || d.name === f.source)?.columns ?? [];
  const here = f.block === "dataset" ? columns : propertiesOf(f.source);
  const choiceInputs = f.inputs.filter((i) => i.kind === "choice" && i.name);
  const numberInputs = f.inputs.filter((i) => i.kind === "number" && i.name);

  async function save() {
    const { problems: found } = draftOfFunction(f);
    setProblems(found);
    if (found.length) return;
    setSaving(true);
    try {
      await onSave(f);
      onSaved();
    } catch (e) {
      setProblems([why(e, "The tool could not be saved. Check the connection and try again.")]);
    } finally {
      setSaving(false);
    }
  }

  const typeSelect = (value: string, onPick: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={label} className={FIELD}>
      <option value="">pick an object type…</option>
      {offer.objectTypes.map((t) => (
        <option key={t.name} value={t.name}>
          {t.name}
        </option>
      ))}
      {value && !offer.objectTypes.some((t) => t.name === value) ? <option value={value}>{value} (not in the ontology)</option> : null}
    </select>
  );
  const propertySelect = (type: string, value: string, onPick: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={label} className={FIELD}>
      <option value="">pick a property…</option>
      {propertiesOf(type).map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
      {value && !propertiesOf(type).includes(value) ? <option value={value}>{value} (not on this type)</option> : null}
    </select>
  );

  return (
    <form
      aria-label={title}
      className="flex flex-col gap-3 rounded-md border border-brand bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name, in your own words</span>
          <input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="Ventilators available by site" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Block</span>
          <select value={f.block} disabled={fixedBlock} onChange={(e) => setF({ ...blankFunctionForm(e.target.value as FunctionForm["block"]), label: f.label, description: f.description, active: f.active, inputs: f.inputs })} className={FIELD}>
            {BLOCKS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL}>What it reads, and when to use it</span>
          <textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="The ventilators that are free, at each site. Use it before proposing a transfer of ventilated patients." className={cn(FIELD, "resize-none")} />
        </label>
        <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-2">
          The analyst decides to call the tool from that sentence. {BLOCKS.find((b) => b.key === f.block)!.says}
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
        <legend className={LABEL}>What it is given</legend>
        {f.inputs.length === 0 ? <span className="text-ink-faint">Nothing: it reads the same thing every time it is called.</span> : null}
        {f.inputs.map((x, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input value={x.name} onChange={(e) => putInput(i, { name: e.target.value })} aria-label={`Input ${i + 1}: name`} placeholder="site" className={cn(FIELD, "w-28 font-mono")} />
            <select value={x.kind} onChange={(e) => putInput(i, { kind: e.target.value as InputForm["kind"] })} aria-label={`Input ${i + 1}: kind`} className={FIELD}>
              <option value="text">text</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="choice">one of a list</option>
            </select>
            <input value={x.says} onChange={(e) => putInput(i, { says: e.target.value })} aria-label={`Input ${i + 1}: what it is for`} placeholder="The site's name." className={cn(FIELD, "min-w-40 flex-1")} />
            {x.kind === "number" ? (
              <>
                <input value={x.min} onChange={(e) => putInput(i, { min: e.target.value })} aria-label={`Input ${i + 1}: least`} placeholder="least" className={cn(FIELD, "w-16")} />
                <input value={x.max} onChange={(e) => putInput(i, { max: e.target.value })} aria-label={`Input ${i + 1}: most`} placeholder="most" className={cn(FIELD, "w-16")} />
              </>
            ) : null}
            {x.kind === "choice" ? <input value={x.choices} onChange={(e) => putInput(i, { choices: e.target.value })} aria-label={`Input ${i + 1}: the list`} placeholder="site, status" className={cn(FIELD, "w-40")} /> : null}
            <label className="flex items-center gap-1">
              <input type="checkbox" className="accent-brand" checked={x.required} onChange={(e) => putInput(i, { required: e.target.checked })} />
              required
            </label>
            <button type="button" onClick={() => set("inputs", f.inputs.filter((_, k) => k !== i))} aria-label={`Remove input ${i + 1}`} className="text-ink-faint hover:text-ink">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button type="button" disabled={f.inputs.length >= 6} onClick={() => set("inputs", [...f.inputs, { name: "", kind: "text", required: true, says: "", min: "", max: "", choices: "" }])} className={cn(SMALL, "self-start")}>
          Add an input
        </button>
      </fieldset>

      <div className="grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-2">
        {f.block === "objects" || f.block === "aggregate" ? (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Object type</span>
            {typeSelect(f.source, (v) => setF((cur) => ({ ...cur, source: v, where: [], fields: [], property: "", groupBy: "" })), "Object type")}
          </label>
        ) : null}

        {f.block === "aggregate" ? (
          <>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>What is computed</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={f.agg} onChange={(e) => set("agg", e.target.value as FunctionForm["agg"])} aria-label="What is computed" className={FIELD}>
                  {AGGS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {f.agg === "count" ? <span className="text-ink-faint">of the objects that match</span> : propertySelect(f.source, f.property, (v) => set("property", v), "Property it is taken over")}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>By group</span>
              <select value={f.groupBy} onChange={(e) => set("groupBy", e.target.value)} className={FIELD}>
                <option value="">No group: one value</option>
                {STANDINGS.map((s) => (
                  <option key={s.key} value={`@${s.key}`}>
                    by {s.label}
                  </option>
                ))}
                {here.map((p) => (
                  <option key={p} value={`=${p}`}>
                    by {p}
                  </option>
                ))}
                {choiceInputs.map((i) => (
                  <option key={i.name} value={i.name}>
                    by the input {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Name of the value returned</span>
              <input value={f.as} onChange={(e) => set("as", e.target.value)} placeholder="ventilators_available" className={cn(FIELD, "font-mono")} />
            </label>
          </>
        ) : null}

        {f.block === "objects" ? (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Objects listed, at most</span>
            <input value={f.limit} onChange={(e) => set("limit", e.target.value)} inputMode="numeric" className={cn(FIELD, "w-24")} />
          </label>
        ) : null}

        {f.block === "dataset" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Dataset</span>
              <select value={f.source} onChange={(e) => setF((cur) => ({ ...cur, source: e.target.value, where: [], fields: [] }))} className={FIELD}>
                <option value="">pick a dataset…</option>
                {offer.datasets.map((d) => (
                  <option key={d.id} value={d.slug}>
                    {d.name}
                  </option>
                ))}
                {f.source && !offer.datasets.some((d) => d.slug === f.source) ? <option value={f.source}>{f.source} (not in the project)</option> : null}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Rows listed, at most</span>
              <input value={f.limit} onChange={(e) => set("limit", e.target.value)} inputMode="numeric" className={cn(FIELD, "w-24")} />
            </label>
          </>
        ) : null}

        {f.block === "objects" || f.block === "dataset" ? (
          <fieldset className="flex flex-col gap-1 sm:col-span-2">
            <legend className={LABEL}>{f.block === "objects" ? "Properties returned, and the name each is returned under" : "Columns returned"}</legend>
            {here.length === 0 ? <span className="text-ink-faint">{f.source ? "It declares none." : f.block === "objects" ? "Pick the object type first." : "Pick the dataset first."}</span> : null}
            <div className="flex flex-col gap-1">
              {here.map((p) => {
                const held = f.fields.find((x) => x.property === p);
                return (
                  <div key={p} className="flex items-center gap-1.5">
                    <label className="flex w-48 items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={!!held}
                        onChange={(e) => set("fields", e.target.checked ? [...f.fields, { property: p, as: p.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[_0-9]+|_+$/g, "") || "value" }] : f.fields.filter((x) => x.property !== p))}
                      />
                      {p}
                    </label>
                    {held && f.block === "objects" ? (
                      <input
                        value={held.as}
                        onChange={(e) => set("fields", f.fields.map((x) => (x.property === p ? { ...x, as: e.target.value } : x)))}
                        aria-label={`Name ${p} is returned under`}
                        className={cn(FIELD, "w-48 font-mono")}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            {f.block === "objects" ? <span className="text-[10.5px] leading-snug text-ink-faint">Give a name that says the unit: flow_litres_per_minute, not flow.</span> : null}
          </fieldset>
        ) : null}

        {f.block === "objects" || f.block === "aggregate" || f.block === "dataset" ? (
          <Filters label="Filters" options={here} inputs={f.inputs} value={f.where} onChange={(v) => set("where", v)} />
        ) : null}

        {f.block === "formula" ? (
          <>
            <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
              <legend className={LABEL}>Named values the formula is computed from</legend>
              {f.values.map((v, i) => {
                const put = (patch: Partial<FunctionForm["values"][number]>) => set("values", f.values.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <input value={v.name} onChange={(e) => put({ name: e.target.value })} aria-label={`Value ${i + 1}: name`} placeholder="closed" className={cn(FIELD, "w-28 font-mono")} />
                    <span className="text-ink-faint">is the</span>
                    <select value={v.agg} onChange={(e) => put({ agg: e.target.value as FunctionForm["agg"] })} aria-label={`Value ${i + 1}: what is computed`} className={FIELD}>
                      {AGGS.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label.toLowerCase()}
                        </option>
                      ))}
                    </select>
                    {v.agg === "count" ? null : propertySelect(v.type, v.property, (p) => put({ property: p }), `Value ${i + 1}: property`)}
                    <span className="text-ink-faint">of</span>
                    {typeSelect(v.type, (t) => put({ type: t, property: "" }), `Value ${i + 1}: object type`)}
                    <button type="button" onClick={() => set("values", f.values.filter((_, k) => k !== i))} aria-label={`Remove value ${i + 1}`} className="text-ink-faint hover:text-ink">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              <button type="button" disabled={f.values.length >= 6} onClick={() => set("values", [...f.values, { name: "", type: "", agg: "sum", property: "", where: [] }])} className={cn(SMALL, "self-start")}>
                Add a value
              </button>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Formula</span>
              <input value={f.expression} onChange={(e) => set("expression", e.target.value)} placeholder="round(closed / (closed + staffed) * 100, 1)" className={cn(FIELD, "font-mono")} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Name of the result returned</span>
              <input value={f.as} onChange={(e) => set("as", e.target.value)} placeholder="beds_closed_pct" className={cn(FIELD, "font-mono")} />
            </label>
            <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-2">
              The formula may name its values{numberInputs.length ? ` and the number inputs (${numberInputs.map((i) => i.name).join(", ")})` : ""}, with + − × ÷, parentheses and round, min, max, sum, mean. A value that is missing
              stops the formula: nothing stands in for it.
            </p>
          </>
        ) : null}

        {f.block === "history" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Measure</span>
              <select value={f.metric} onChange={(e) => set("metric", e.target.value)} className={FIELD}>
                <option value="">pick a measure…</option>
                {offer.metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
                {f.metric && !offer.metrics.some((m) => m.key === f.metric) ? <option value={f.metric}>{f.metric} (not kept)</option> : null}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Unit</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={f.unit.from} onChange={(e) => set("unit", { ...f.unit, from: e.target.value })} aria-label="Unit: taken from" className={FIELD}>
                  <option value="">a unit named here</option>
                  {f.inputs.filter((x) => x.name && (x.kind === "text" || x.kind === "choice")).map((x) => (
                    <option key={x.name} value={x.name}>
                      the input {x.name}
                    </option>
                  ))}
                </select>
                {f.unit.from ? null : <input value={f.unit.value} onChange={(e) => set("unit", { ...f.unit, value: e.target.value })} aria-label="Unit: name" placeholder="CHUM" className={cn(FIELD, "w-40")} />}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Window, in hours</span>
              <select value={f.hours.startsWith("@") ? f.hours : "="} onChange={(e) => set("hours", e.target.value === "=" ? "24" : e.target.value)} aria-label="Window: taken from" className={FIELD}>
                <option value="=">a number of hours written here</option>
                {numberInputs.map((x) => (
                  <option key={x.name} value={`@${x.name}`}>
                    the input {x.name}
                  </option>
                ))}
              </select>
              {f.hours.startsWith("@") ? null : <input value={f.hours} onChange={(e) => set("hours", e.target.value)} inputMode="numeric" aria-label="Window: hours" className={cn(FIELD, "w-24")} />}
            </label>
            <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-2">Only the measures the organisation defined are kept over time, and nothing is known before the history started.</p>
          </>
        ) : null}
      </div>

      <label className="flex items-center gap-1.5">
        <input type="checkbox" className="accent-brand" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
        On: the analyst is offered it
      </label>

      {problems.length ? (
        <ul role="alert" className="flex list-disc flex-col gap-0.5 rounded bg-danger-soft py-1.5 pl-6 pr-2 text-danger-ink">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="flex items-center gap-1 rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-60">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
          Save
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="rounded border border-line px-2.5 py-1 text-xs text-ink-body">
          Cancel
        </button>
      </div>
    </form>
  );
}
