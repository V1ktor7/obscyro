"use client";

/**
 * Kept series: what the platform can show a model of the past.
 *
 * A forecasting model only knows what it is shown. This page lists every
 * series the project keeps, and says of each how far back it goes, how much
 * of it there is and what is missing from it. The twin's measures are here
 * with nothing to declare. A dataset is kept as a series once a person says
 * which column is the time, which the value, and which name the entity: the
 * columns are picked from the dataset's own schema, never typed.
 *
 * "Look" reads a series the way a model would be handed it: a regular grid
 * where each value holds until the next and a gap stays a gap.
 */

import { Eye, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import { declareSeries, fetchSeries, readSeriesGrid, removeSeries, type GridAnswer, type GridStep, type SeriesLine, type SeriesList, type SeriesOffer } from "../series-api";
import { useStudio } from "../StudioShell";
import { ENTITY_COLUMNS_MAX, blankSeriesForm, columnsOf, coversText, draftOfSeries, gapsText, holdsText, lastKnown, lookWindow, sparkPaths, stepText, type SeriesForm } from "./kept-series";

const LABEL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";
const FIELD = "rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none disabled:opacity-60";
const BUTTON = "flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-body hover:border-brand disabled:opacity-50";
const why = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

/** How many entities a look draws before it says how many more there are. */
const LOOK_ENTITIES = 8;

type Read = { state: "loading" } | { state: "failed"; why: string } | { state: "read"; list: SeriesList };

export default function KeptSeriesView() {
  const { hasKey, selectedEnv: env } = useStudio();
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [adding, setAdding] = useState(false);
  const [looking, setLooking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [told, setTold] = useState<string | null>(null);

  const load = useCallback(() => {
    // Nothing is asked of the server without a session and a project to ask about.
    if (!env || !hasKey) return;
    let stale = false;
    fetchSeries(env).then(
      (list) => !stale && setRead({ state: "read", list }),
      (e: unknown) => !stale && setRead({ state: "failed", why: why(e, "Check the connection and read again.") }),
    );
    return () => {
      stale = true;
    };
  }, [env, hasKey]);
  useEffect(() => load(), [load]);

  if (!hasKey) return <p className="p-8 text-sm text-ink-faint">Sign in to see what is kept.</p>;
  if (!env) return <p className="p-8 text-sm text-ink-faint">Select an environment first.</p>;
  if (read.state === "loading") return <p className="p-8 text-sm text-ink-muted">Reading what is kept…</p>;
  if (read.state === "failed") {
    return (
      <p role="alert" className="m-8 rounded bg-danger-soft px-3 py-2 text-sm text-danger-ink">
        The kept series could not be read: {read.why}
      </p>
    );
  }
  const { list } = read;
  const twin = list.series.filter((s) => s.origin === "twin");
  const declared = list.series.filter((s) => s.origin === "dataset");

  const remove = async (line: SeriesLine) => {
    if (!window.confirm(`Stop keeping “${line.label}”? The points written down for it are removed. The copies of the dataset are not touched.`)) return;
    setBusy(line.key);
    setProblem(null);
    try {
      await removeSeries(env, line.key);
      if (looking === line.key) setLooking(null);
      load();
    } catch (e) {
      setProblem(why(e, "The series could not be removed. Check the connection and try again."));
    } finally {
      setBusy(null);
    }
  };

  const group = (title: string, about: string, lines: SeriesLine[], empty: string) => (
    <section aria-label={title} className="flex flex-col gap-2">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        <p className="text-xs leading-relaxed text-ink-muted">{about}</p>
      </div>
      {lines.length === 0 ? <p className="rounded-md border border-line-soft bg-surface px-3 py-2 text-xs text-ink-muted">{empty}</p> : null}
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.key} aria-label={line.label} className="rounded-md border border-line bg-surface p-3 text-xs text-ink-body">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ink">{line.label}</span>
              <code className="rounded bg-canvas px-1 text-[10.5px] text-ink-muted" title="The name a read asks for">{line.key}</code>
              {line.unit ? <span className="rounded bg-canvas px-1 text-[10.5px] text-ink-muted">{line.unit}</span> : null}
              <span className="ml-auto flex items-center gap-1.5">
                <button type="button" disabled={line.points === 0} aria-expanded={looking === line.key} onClick={() => setLooking(looking === line.key ? null : line.key)} className={BUTTON}>
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  Look
                </button>
                {line.origin === "dataset" ? (
                  <button type="button" disabled={busy !== null} onClick={() => void remove(line)} className={BUTTON}>
                    {busy === line.key ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3 w-3" aria-hidden="true" />}
                    Remove
                  </button>
                ) : null}
              </span>
            </div>
            <p className="mt-1 text-ink-muted">
              {line.from} · {stepText(line.step)}
              {line.declared ? ` · time in ${line.declared.timeColumn}, value in ${line.declared.valueColumn}${line.declared.entityColumns.length ? `, by ${line.declared.entityColumns.join(" and ")}` : ""}` : ""}
            </p>
            <p className="mt-1 text-ink">{holdsText(line)}</p>
            <p className="mt-0.5 text-ink-muted">{coversText(line)}</p>
            {gapsText(line).map((g) => (
              <p key={g} className="mt-0.5 text-ink-muted">{g}</p>
            ))}
            {line.note ? (
              <p role="alert" className="mt-1.5 rounded bg-warn-soft px-2 py-1 text-[11px] text-warn-ink">
                The last write was not read whole. {line.note}
              </p>
            ) : null}
            {looking === line.key ? <LookPanel env={env} line={line} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-medium text-ink">
            Kept series <span className="ml-1 rounded bg-line-faint px-1.5 text-[11px] text-ink-muted">{list.series.length}</span>
          </h1>
          <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-muted">
            A series is a value followed over time, for one or several places. It is what a model can be shown of the past, and nothing else: where a
            series starts, a model knows nothing of what came before.
          </p>
        </div>
        <button type="button" onClick={() => load()} className={cn(BUTTON, "shrink-0")}>
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Read again
        </button>
        <button type="button" disabled={adding} onClick={() => setAdding(true)} className={cn(BUTTON, "shrink-0")}>
          <Plus className="h-3 w-3" aria-hidden="true" />
          Keep a dataset as a series
        </button>
      </div>

      {problem ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-xs text-danger-ink">{problem}</p>
      ) : null}
      {told ? (
        <p role="status" className="rounded bg-ok-soft px-2 py-1.5 text-xs text-ok-ink">{told}</p>
      ) : null}

      {adding ? (
        <SeriesFormPanel
          env={env}
          offer={list.offer}
          onCancel={() => setAdding(false)}
          onDeclared={(said) => {
            setAdding(false);
            setTold(said);
            load();
          }}
        />
      ) : null}

      {group(
        "Measures of the twin",
        "Every measure the organisation defined is kept, unit by unit, each time its value changes. Nothing is declared for them.",
        twin,
        "The twin kept no reading in this project yet. A measure is kept from the first time it has a value.",
      )}
      {group(
        "Series of datasets",
        "A dataset that does not enter the twin is kept once it is declared here. From then on, every write of the dataset is read, and only what changed is written down.",
        declared,
        "No dataset is kept as a series yet. Its copies are kept, but nothing in them is filed by place and by time.",
      )}
    </div>
  );
}

/** One series read the way a model would be handed it: a regular grid, gaps included. */
function LookPanel({ env, line }: { env: string; line: SeriesLine }) {
  const [step, setStep] = useState<GridStep>(line.step === "day" || line.step === "week" ? "day" : "hour");
  const [answer, setAnswer] = useState<GridAnswer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setAnswer(null);
    setProblem(null);
    readSeriesGrid(env, { key: line.key, ...lookWindow(step, new Date()), step, agg: "mean" }).then(
      (a) => !stale && setAnswer(a),
      (e: unknown) => !stale && setProblem(why(e, "The series could not be read. Check the connection and try again.")),
    );
    return () => {
      stale = true;
    };
  }, [env, line.key, step]);

  return (
    <div aria-label={`Look at ${line.label}`} role="region" className="mt-2 flex flex-col gap-2 rounded border border-line-soft bg-canvas p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>What a model would be shown</span>
        <div role="group" aria-label="Step" className="flex">
          {(["hour", "day"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={step === s}
              onClick={() => setStep(s)}
              className={cn("border px-2 py-0.5 text-[11px]", step === s ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-surface text-ink-body")}
            >
              {s === "hour" ? "Last 48 hours, by the hour" : "Last 30 days, by the day"}
            </button>
          ))}
        </div>
      </div>
      {problem ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1 text-xs text-danger-ink">{problem}</p>
      ) : null}
      {!answer && !problem ? <p className="text-xs text-ink-muted">Reading…</p> : null}
      {answer ? (
        <>
          <ul className="flex flex-col gap-1">
            {answer.series.slice(0, LOOK_ENTITIES).map((s) => {
              const last = lastKnown(s.values);
              return (
                <li key={s.entity} aria-label={s.label} className="grid grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] items-center gap-3 text-[11.5px]">
                  <span className="truncate text-ink" title={s.label}>{s.label}</span>
                  <svg viewBox="0 0 160 24" className="h-6 w-[160px]" role="img" aria-label={`${s.values.length - s.emptySteps} of ${s.values.length} steps have a value`}>
                    {sparkPaths(s.values, 160, 22).map((d) => (
                      <path key={d} d={d} transform="translate(0 1)" className="fill-none stroke-brand" strokeWidth={1.5} strokeLinecap="round" />
                    ))}
                  </svg>
                  <span className="text-ink-muted">
                    {last ? `${last.value.toLocaleString("en-CA", { maximumFractionDigits: 2 })}${last.stepsAgo === 0 ? "" : `, ${last.stepsAgo} step${last.stepsAgo === 1 ? "" : "s"} back`}` : "No value in this stretch"}
                    {s.emptySteps > 0 ? ` · ${s.emptySteps} of ${s.values.length} steps with no value` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {answer.series.length > LOOK_ENTITIES ? <p className="text-[11px] text-ink-faint">And {answer.series.length - LOOK_ENTITIES} more, read the same way.</p> : null}
          <p className="text-[11px] leading-snug text-ink-faint">{answer.howToRead}</p>
        </>
      ) : null}
    </div>
  );
}

function SeriesFormPanel({ env, offer, onCancel, onDeclared }: { env: string; offer: SeriesOffer; onCancel: () => void; onDeclared: (said: string) => void }) {
  const [f, setF] = useState<SeriesForm>(blankSeriesForm);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof SeriesForm>(key: K, value: SeriesForm[K]) => setF((cur) => ({ ...cur, [key]: value }));
  const columns = columnsOf(offer, f.datasetId);

  async function save() {
    const { draft, problems: found } = draftOfSeries(f);
    setProblems(found);
    if (found.length) return;
    setSaving(true);
    try {
      const out = await declareSeries(env, draft);
      const read = out.captured
        ? `${out.captured.written.toLocaleString("en-CA")} point${out.captured.written === 1 ? "" : "s"} read from the dataset's latest copy.${out.captured.note ? ` ${out.captured.note}` : ""}`
        : "The dataset has not been written yet: its next write is read.";
      onDeclared(`“${out.series.label}” is kept. ${read}`);
    } catch (e) {
      setProblems([why(e, "The series could not be declared. Check the connection and try again.")]);
    } finally {
      setSaving(false);
    }
  }

  const columnSelect = (label: string, value: string, onPick: (v: string) => void) => (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <select value={value} disabled={!f.datasetId} onChange={(e) => onPick(e.target.value)} className={FIELD}>
        <option value="">{f.datasetId ? "pick a column…" : "pick the dataset first"}</option>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.type})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form
      aria-label="Keep a dataset as a series"
      className="flex flex-col gap-3 rounded-md border border-brand bg-surface p-3 text-xs text-ink-body"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-[13px] font-semibold text-ink">Keep a dataset as a series</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name</span>
          <input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="Respiratory virus detections" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Dataset</span>
          <select value={f.datasetId} onChange={(e) => setF((cur) => ({ ...cur, datasetId: e.target.value, timeColumn: "", valueColumn: "", entityColumns: [] }))} className={FIELD}>
            <option value="">pick a dataset…</option>
            {offer.datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {columnSelect("Column of the time", f.timeColumn, (v) => set("timeColumn", v))}
        {columnSelect("Column of the value", f.valueColumn, (v) => set("valueColumn", v))}
        <label className="flex flex-col gap-1">
          <span className={LABEL}>The source publishes</span>
          <select value={f.step} onChange={(e) => set("step", e.target.value as SeriesForm["step"])} className={FIELD}>
            <option value="hour">every hour</option>
            <option value="day">every day</option>
            <option value="week">every week</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Unit of the value</span>
          <input value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="detections" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL}>Time zone of the file</span>
          <input value={f.timeZone} onChange={(e) => set("timeZone", e.target.value)} placeholder="America/Toronto" className={cn(FIELD, "max-w-xs")} />
        </label>
        <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-2">
          Needed when the time carries no zone, as in 2026-11-27T12:50 or 2026-11-27: the file does not say which city&apos;s clock it is written on, and a
          guess would move every point by hours. Left empty, such a time is not placed, and the series says so.
        </p>
        <fieldset className="flex flex-col gap-1 sm:col-span-2">
          <legend className={LABEL}>Columns that name what the value is about</legend>
          {columns.length === 0 ? <span className="text-ink-faint">Pick the dataset first.</span> : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {columns.map((c) => (
              <label key={c.name} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={f.entityColumns.includes(c.name)}
                  disabled={!f.entityColumns.includes(c.name) && f.entityColumns.length >= ENTITY_COLUMNS_MAX}
                  onChange={(e) => set("entityColumns", e.target.checked ? [...f.entityColumns, c.name] : f.entityColumns.filter((x) => x !== c.name))}
                />
                {c.name}
              </label>
            ))}
          </div>
          <span className="text-[10.5px] leading-snug text-ink-faint">
            A region, a site, a virus. With none, the dataset is read as one series. When two rows share these columns and a time and disagree, a column is
            missing here: they are left out, and the series says how many.
          </span>
        </fieldset>
      </div>

      {problems.length ? (
        <ul role="alert" className="flex list-disc flex-col gap-0.5 rounded bg-danger-soft py-1.5 pl-6 pr-2 text-danger-ink">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-[10.5px] leading-snug text-ink-faint">
        The dataset&apos;s latest copy is read at once, and every write after it. Its older copies are not read by this.
      </p>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="flex items-center gap-1 rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-60">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
          Keep it
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="rounded border border-line px-2.5 py-1 text-xs text-ink-body">
          Cancel
        </button>
      </div>
    </form>
  );
}
