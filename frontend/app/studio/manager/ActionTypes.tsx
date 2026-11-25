"use client";

/**
 * Action types: what the analyst may propose in this project.
 *
 * What an option of the analyst can contain used to be written in the code. It
 * is set here. A person declares an action type in their own words: what it
 * changes, within what bounds, in how long, and who can approve it. The
 * analyst reads the list, proposes only what it holds, and every proposal is
 * still tested by the engine and applied by a person.
 *
 * Four built-in types cover what the analyst could already propose. A project
 * that changes none of them and adds none works exactly as before.
 *
 * Nothing is typed by name: an activity, a contact layer, a site or a recorded
 * response is picked from what the twin declares. A type that points at
 * something the twin does not hold says so, with what is missing.
 *
 * Under the list, the analyst's tools. They are code and cannot be written
 * here; a project can switch one off.
 */

import { Loader2, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  createActionType,
  fetchActionTypes,
  fetchAnalystTools,
  removeActionType,
  saveActionType,
  switchAnalystTool,
  type ActionType,
  type ActionTypeList,
  type AnalystToolLine,
  type TwinOffer,
} from "../analyst-api";
import { EFFECTS, WHERE, blankForm, boundsLines, draftOf, effectLabel, formOf, modesFor, standingOf, type ActionForm } from "./action-types";

const LABEL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";
const FIELD = "rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none disabled:opacity-60";
const BUTTON = "flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-body hover:border-brand disabled:opacity-50";
const why = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

type Read = { state: "loading" } | { state: "failed"; why: string } | { state: "read"; list: ActionTypeList; tools: AnalystToolLine[] };

export function ActionTypesPage({ env }: { env: string | null }) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  /** The key being edited, "" for a new type, null when the form is closed. */
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!env) return;
    let stale = false;
    Promise.all([fetchActionTypes(env), fetchAnalystTools(env)]).then(
      ([list, t]) => {
        if (!stale) setRead({ state: "read", list, tools: t.tools });
      },
      (e: unknown) => {
        if (!stale) setRead({ state: "failed", why: why(e, "Check the connection and read again.") });
      },
    );
    return () => {
      stale = true;
    };
  }, [env]);
  useEffect(() => load(), [load]);

  if (!env) return <p className="text-xs text-ink-muted">Open an environment to read its action types.</p>;
  if (read.state === "loading") return <p className="text-xs text-ink-muted">Reading the action types…</p>;
  if (read.state === "failed") {
    return (
      <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-xs text-danger-ink">
        The action types could not be read: {read.why}
      </p>
    );
  }
  const { list, tools } = read;
  const declared = list.types.some((t) => t.declared);

  /** One write, then the list read again: what is on screen is what the server holds. */
  async function act(tag: string, work: () => Promise<unknown>, failed: string) {
    setBusy(tag);
    setProblem(null);
    try {
      await work();
      load();
    } catch (e) {
      setProblem(why(e, failed));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (t: ActionType) =>
    act(`toggle:${t.key}`, () => saveActionType(env, t.key, { ...draftOf(formOf(t)).draft, active: !t.active }), "The action type could not be changed. Check the connection and try again.");
  const remove = (t: ActionType) => {
    const question = t.builtIn
      ? `Reset “${t.name}” to the built-in type? It becomes unbounded and switched on again.`
      : `Remove the action type “${t.name}”? The analyst will no longer propose under it. Nothing already tested or decided changes.`;
    if (!window.confirm(question)) return;
    void act(`remove:${t.key}`, () => removeActionType(env, t.key), "The action type could not be removed. Check the connection and try again.");
  };

  return (
    <div className="flex max-w-5xl flex-col gap-5 text-xs text-ink-body">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 leading-relaxed text-ink-muted">
          An action type is something the analyst may propose in this project: what it changes, within what bounds, in how long, and who can
          approve it. The analyst reads this list and proposes only what it holds. Every proposal is still tested by the engine, and applied
          only by a person. {declared ? "This project declared its own: the analyst is told to keep to them." : "This project declared none: the four built-in types stand, and the analyst works as it always did."}
        </p>
        <button type="button" onClick={() => load()} className={cn(BUTTON, "shrink-0")}>
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Read again
        </button>
      </div>

      {list.offerProblem ? (
        <p role="alert" className="rounded bg-warn-soft px-2 py-1.5 text-warn-ink">{list.offerProblem}</p>
      ) : null}
      {problem ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-danger-ink">{problem}</p>
      ) : null}

      <section aria-label="Action types" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-ink">What the analyst may propose</h3>
          <span className="rounded bg-line-faint px-1.5 text-[10px] text-ink-muted">{list.types.filter((t) => t.active).length} on</span>
          <button type="button" disabled={editing !== null} onClick={() => setEditing("")} className={cn(BUTTON, "ml-auto")}>
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add an action type
          </button>
        </div>

        {editing === "" ? (
          <TypeForm
            key="new"
            initial={blankForm()}
            fixedEffect={false}
            offer={list.offer}
            title="New action type"
            onCancel={() => setEditing(null)}
            onSave={(form) => createActionType(env, draftOf(form).draft)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        ) : null}

        <ul className="flex flex-col gap-2">
          {list.types.map((t) =>
            editing === t.key ? (
              <li key={t.key}>
                <TypeForm
                  initial={formOf(t)}
                  fixedEffect
                  offer={list.offer}
                  title={`${t.name}`}
                  onCancel={() => setEditing(null)}
                  onSave={(form) => saveActionType(env, t.key, draftOf(form).draft)}
                  onSaved={() => {
                    setEditing(null);
                    load();
                  }}
                />
              </li>
            ) : (
              <li key={t.key} aria-label={t.name} className={cn("rounded-md border bg-surface p-3", t.active ? "border-line" : "border-line-soft opacity-70")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink">{t.name}</span>
                  <span className="rounded bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand-deep">{effectLabel(t.effect)}</span>
                  <span className="text-[10.5px] text-ink-faint">{standingOf(t)}</span>
                  <code className="rounded bg-canvas px-1 text-[10.5px] text-ink-muted" title="The name the analyst gives it in a test">{t.key}</code>
                  <span className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={t.active}
                      aria-label={`${t.name}: ${t.active ? "on" : "off"}`}
                      disabled={busy !== null}
                      onClick={() => void toggle(t)}
                      className={cn("flex h-5 w-9 items-center rounded-full border px-0.5 disabled:opacity-50", t.active ? "justify-end border-brand bg-brand-soft" : "justify-start border-line bg-canvas")}
                    >
                      <span className={cn("h-3.5 w-3.5 rounded-full", t.active ? "bg-brand" : "bg-ink-ghost")} />
                    </button>
                    <span className="w-6 text-[10.5px] text-ink-muted">{busy === `toggle:${t.key}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : t.active ? "On" : "Off"}</span>
                    <button type="button" disabled={editing !== null || busy !== null} onClick={() => setEditing(t.key)} className={BUTTON}>
                      <Pencil className="h-3 w-3" aria-hidden="true" />
                      Edit
                    </button>
                    {t.declared ? (
                      <button type="button" disabled={busy !== null} onClick={() => remove(t)} className={BUTTON}>
                        {t.builtIn ? <RotateCcw className="h-3 w-3" aria-hidden="true" /> : <Trash2 className="h-3 w-3" aria-hidden="true" />}
                        {t.builtIn ? "Reset" : "Remove"}
                      </button>
                    ) : null}
                  </span>
                </div>
                {t.description ? <p className="mt-1 leading-relaxed text-ink-muted">{t.description}</p> : null}
                <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-ink-body">
                  {boundsLines(t, list.offer).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-ink-muted">{t.approver ? `Can be approved by ${t.approver}.` : "No approver declared."}</p>
                {!t.active ? <p className="mt-1 text-[11px] text-ink-muted">Switched off: the analyst does not propose this kind of change under this type.</p> : null}
                {t.missing ? (
                  <p role="alert" className="mt-1.5 rounded bg-warn-soft px-2 py-1 text-[11px] text-warn-ink">
                    Cannot be tested on this twin. {t.missing}
                  </p>
                ) : null}
              </li>
            ),
          )}
        </ul>
        <p className="leading-relaxed text-ink-faint">
          An action type changes only what a run can be made to change. Staff and stocks are not in the twin, so no action type can name them:
          the analyst says so as a limit. A price and a delay come from the twin&apos;s price list, where it prices what the type opens.
        </p>
      </section>

      <ToolsSection env={env} tools={tools} onChanged={load} />
    </div>
  );
}

/** A list to pick several from, or "any". Filtered by a box when it is long. */
function PickMany({
  label,
  any,
  options,
  value,
  onChange,
}: {
  label: string;
  /** What "no bound" is called for this list. */
  any: string;
  options: { id: string; name: string }[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const shown = options.filter((o) => !q || o.name.toLowerCase().includes(q));
  const chosen = new Set(value ?? []);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={LABEL}>{label}</legend>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" className="accent-brand" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : [])} />
        {any}
      </label>
      {value !== null ? (
        <>
          {options.length > 8 ? (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" aria-label={`Filter ${label.toLowerCase()}`} className={FIELD} />
          ) : null}
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded border border-line-soft bg-canvas p-1.5">
            {options.length === 0 ? <span className="text-ink-faint">The twin declares none.</span> : null}
            {shown.slice(0, 200).map((o) => (
              <label key={o.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={chosen.has(o.id)}
                  onChange={(e) => onChange(e.target.checked ? [...(value ?? []), o.id] : (value ?? []).filter((id) => id !== o.id))}
                />
                {o.name}
              </label>
            ))}
            {shown.length > 200 ? <span className="text-ink-faint">{shown.length - 200} more: filter to find them.</span> : null}
          </div>
          <span className="text-[10.5px] text-ink-faint">{chosen.size} picked</span>
        </>
      ) : null}
    </fieldset>
  );
}

function TypeForm({
  initial,
  fixedEffect,
  offer,
  title,
  onCancel,
  onSave,
  onSaved,
}: {
  initial: ActionForm;
  /** A type that exists keeps what it changes. */
  fixedEffect: boolean;
  offer: TwinOffer | null;
  title: string;
  onCancel: () => void;
  onSave: (form: ActionForm) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [f, setF] = useState<ActionForm>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ActionForm>(key: K, value: ActionForm[K]) => setF((cur) => ({ ...cur, [key]: value }));

  const sitesFor = (activity: string) => (offer?.sites ?? []).filter((s) => !activity || s.activities.includes(activity));
  const routeSources = (offer?.sites ?? []).filter((s) => offer!.routes.some((r) => r.source === s.id));
  const routeTargets = (offer?.sites ?? []).filter((s) => offer!.routes.some((r) => r.target === s.id));
  const modes = modesFor(offer, f.activity);

  async function save() {
    const { problems: found } = draftOf(f);
    setProblems(found);
    if (found.length) return;
    setSaving(true);
    try {
      await onSave(f);
      onSaved();
    } catch (e) {
      setProblems([why(e, "The action type could not be saved. Check the connection and try again.")]);
    } finally {
      setSaving(false);
    }
  }

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
          <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Open overflow beds" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Who can approve it</span>
          <input value={f.approver} onChange={(e) => set("approver", e.target.value)} placeholder="Director of nursing" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL}>What it is, for a person and for the analyst</span>
          <input value={f.description} onChange={(e) => set("description", e.target.value)} className={FIELD} />
        </label>
        <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-2">{EFFECTS.find((e) => e.key === f.effect)!.says}</p>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>What it changes</span>
          <select value={f.effect} disabled={fixedEffect} onChange={(e) => setF({ ...blankForm(e.target.value as ActionForm["effect"]), name: f.name, description: f.description, approver: f.approver, leadDays: f.leadDays, active: f.active })} className={FIELD}>
            {EFFECTS.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Days before it can apply</span>
          <input value={f.leadDays} onChange={(e) => set("leadDays", e.target.value)} inputMode="numeric" placeholder="none declared" className={FIELD} />
        </label>
        <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-2">Days are counted from the decision, day 0 of a run. Left empty, the type has no delay of its own.</p>
      </div>

      <div className="grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-2">
        {f.effect === "capacity" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Activity</span>
              <select value={f.activity} onChange={(e) => setF((cur) => ({ ...cur, activity: e.target.value, mode: "" }))} className={FIELD}>
                <option value="">Any activity a site provides</option>
                {(offer?.activities ?? []).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                {f.activity && !(offer?.activities ?? []).includes(f.activity) ? <option value={f.activity}>{f.activity} (not in the twin)</option> : null}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Units, from and to</span>
              <div className="flex items-center gap-1.5">
                <input value={f.minUnits} onChange={(e) => set("minUnits", e.target.value)} inputMode="numeric" placeholder="no fewest" aria-label="Fewest units" className={cn(FIELD, "w-24")} />
                <span className="text-ink-faint">to</span>
                <input value={f.maxUnits} onChange={(e) => set("maxUnits", e.target.value)} inputMode="numeric" placeholder="no most" aria-label="Most units" className={cn(FIELD, "w-24")} />
              </div>
              <span className="text-[10.5px] leading-snug text-ink-faint">A negative number closes units. Empty: no bound on that side.</span>
            </div>
            <PickMany label="Sites" any="Any site that provides the activity" options={sitesFor(f.activity)} value={f.sites} onChange={(v) => set("sites", v)} />
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
              <span className={LABEL}>Mode of the price list</span>
              <select value={f.mode} onChange={(e) => set("mode", e.target.value)} className={FIELD}>
                <option value="">Any mode the price list holds</option>
                {modes.map((m) => (
                  <option key={m.mode} value={m.mode}>
                    {m.mode} · {m.leadDays} day{m.leadDays === 1 ? "" : "s"}
                  </option>
                ))}
                {f.mode && !modes.some((m) => m.mode === f.mode) ? <option value={f.mode}>{f.mode} (not in the price list)</option> : null}
              </select>
              </label>
              <span className="text-[10.5px] leading-snug text-ink-faint">
                {modes.length ? "A mode has its price and takes its days: both come from the price list." : "The price list holds no mode for this: nothing is priced, and the type declares no price of its own."}
              </span>
            </div>
          </>
        ) : null}

        {f.effect === "measure" ? (
          <>
            <fieldset className="flex flex-col gap-1">
              <legend className={LABEL}>Contact layers, and the range of their factor</legend>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-brand" checked={f.layers === null} onChange={(e) => set("layers", e.target.checked ? null : [])} />
                Any contact layer the twin declares, any factor
              </label>
              {f.layers !== null
                ? (offer?.layers ?? []).map((layer) => {
                    const held = f.layers!.find((l) => l.layer === layer);
                    const put = (next: { minFactor: string; maxFactor: string } | null) =>
                      set("layers", next ? [...f.layers!.filter((l) => l.layer !== layer), { layer, ...next }] : f.layers!.filter((l) => l.layer !== layer));
                    return (
                      <div key={layer} className="flex items-center gap-1.5">
                        <label className="flex w-32 items-center gap-1.5">
                          <input type="checkbox" className="accent-brand" checked={!!held} onChange={(e) => put(e.target.checked ? { minFactor: "0", maxFactor: "1" } : null)} />
                          {layer}
                        </label>
                        {held ? (
                          <>
                            <input value={held.minFactor} onChange={(e) => put({ ...held, minFactor: e.target.value })} inputMode="decimal" aria-label={`Lowest factor on ${layer}`} className={cn(FIELD, "w-16")} />
                            <span className="text-ink-faint">to</span>
                            <input value={held.maxFactor} onChange={(e) => put({ ...held, maxFactor: e.target.value })} inputMode="decimal" aria-label={`Highest factor on ${layer}`} className={cn(FIELD, "w-16")} />
                          </>
                        ) : null}
                      </div>
                    );
                  })
                : null}
              {f.layers !== null && (offer?.layers ?? []).length === 0 ? <span className="text-ink-faint">The twin declares no contact layer.</span> : null}
              <span className="text-[10.5px] leading-snug text-ink-faint">0 removes the contact, 0.5 halves it, above 1 increases it.</span>
            </fieldset>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Days it may last, at most</span>
                <input value={f.maxDays} onChange={(e) => set("maxDays", e.target.value)} inputMode="numeric" placeholder="no bound" className={cn(FIELD, "w-28")} />
              </label>
              <PickMany label="Catchments" any="Any catchment, or all of them" options={offer?.catchments ?? []} value={f.catchments} onChange={(v) => set("catchments", v)} />
            </div>
          </>
        ) : null}

        {f.effect === "transfer" ? (
          <>
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Patients a day, at most</span>
                <input value={f.maxPerDay} onChange={(e) => set("maxPerDay", e.target.value)} inputMode="numeric" placeholder="what a route carries" className={cn(FIELD, "w-40")} />
              </label>
              <span className="text-[10.5px] leading-snug text-ink-faint">
                The twin holds no flow for its routes: a run lets each carry 20 patients a day, and that is an assumption. {offer ? `${offer.routes.length} route${offer.routes.length === 1 ? "" : "s"} in the twin.` : ""}
              </span>
            </div>
            <span />
            <PickMany label="Sent from" any="Any site a route leaves" options={routeSources} value={f.from} onChange={(v) => set("from", v)} />
            <PickMany label="Sent to" any="Any site a route reaches" options={routeTargets} value={f.to} onChange={(v) => set("to", v)} />
          </>
        ) : null}

        {f.effect === "response" ? (
          <PickMany label="Recorded responses" any="Any recorded response" options={offer?.responses ?? []} value={f.responses} onChange={(v) => set("responses", v)} />
        ) : null}
      </div>

      <label className="flex items-center gap-1.5">
        <input type="checkbox" className="accent-brand" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
        On: the analyst may propose it
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

/** The analyst's tools, and the switch a project has on each. */
function ToolsSection({ env, tools, onChanged }: { env: string; tools: AnalystToolLine[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function flip(t: AnalystToolLine) {
    setBusy(t.name);
    setProblem(null);
    try {
      await switchAnalystTool(env, t.name, !t.on);
      onChanged();
    } catch (e) {
      setProblem(why(e, "The tool could not be switched. Check the connection and try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="The analyst's tools" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">What the analyst can use</h3>
        <span className="rounded bg-line-faint px-1.5 text-[10px] text-ink-muted">{tools.filter((t) => t.on).length} of {tools.length} on</span>
      </div>
      <p className="leading-relaxed text-ink-muted">
        The analyst&apos;s own tools are code: each is tested, and every figure it returns is checked. A project can switch one off, and the
        analyst is then not offered it. A reading tool of the project&apos;s own is declared under Functions, and switched there.
      </p>
      {problem ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-danger-ink">{problem}</p>
      ) : null}
      <ul className="flex flex-col rounded-md border border-line bg-surface">
        {tools.map((t) => (
          <li key={t.name} aria-label={t.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-line-soft px-3 py-2 last:border-0">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5">
                <code className="text-[11.5px] font-semibold text-ink">{t.name}</code>
                {t.where.map((w) => (
                  <span key={w} className="rounded bg-canvas px-1 text-[10px] text-ink-muted">{WHERE[w] ?? w}</span>
                ))}
              </p>
              <p className="leading-relaxed text-ink-muted">{t.reads}</p>
              {t.why ? <p className="text-[10.5px] leading-snug text-ink-faint">{t.origin === "project" ? t.why : `Always on. ${t.why}`}</p> : null}
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                role="switch"
                aria-checked={t.on}
                aria-label={`${t.name}: ${t.on ? "on" : "off"}`}
                disabled={!t.switchable || busy !== null}
                onClick={() => void flip(t)}
                className={cn("flex h-5 w-9 items-center rounded-full border px-0.5 disabled:opacity-50", t.on ? "justify-end border-brand bg-brand-soft" : "justify-start border-line bg-canvas")}
              >
                <span className={cn("h-3.5 w-3.5 rounded-full", t.on ? "bg-brand" : "bg-ink-ghost")} />
              </button>
              <span className="w-6 text-[10.5px] text-ink-muted">{busy === t.name ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : t.on ? "On" : "Off"}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
