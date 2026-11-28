"use client";

/**
 * Imported models: a forecasting model trained somewhere else, plugged in.
 *
 * The platform does not train these. It shows a model the history it keeps
 * and takes back a forecast. Before any of it reaches a map, a model goes
 * through the same steps, in the same order, and this screen is that order:
 * imported; its contract checked on a sample; replayed on the last days, each
 * time with only what was known then; put on trial, each forecast frozen; and
 * shown only while a rule fixed in advance says it beats two simple rules.
 *
 * No key is typed or shown here. A model hosted elsewhere names the variable
 * an administrator set on the API, and the screen says where the series go
 * before anything leaves.
 */

import { Check, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import {
  backtestForecastModel,
  fetchForecastModels,
  importForecastModel,
  removeForecastModel,
  setForecastTrial,
  verifyForecastModel,
  type Companion,
  type ForecastModel,
  type ModelOffer,
  type Score,
  type TrialRun,
  type Verification,
} from "../forecast-models-api";
import {
  NOT_IN_THE_TWIN,
  backtestText,
  blankModelForm,
  companionChoices,
  companionName,
  draftOfModel,
  errorLines,
  horizonRows,
  leavesText,
  roadOf,
  sentText,
  shapeText,
  sourceText,
  standingText,
  type ModelForm,
} from "./imported-models";

const LABEL = "text-[10px] font-medium uppercase tracking-wide text-ink-faint";
const FIELD = "rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none disabled:opacity-60";
const BUTTON = "flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-body hover:border-brand disabled:opacity-50";
const PRIMARY = "flex items-center gap-1 rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-deep disabled:opacity-60";
const why = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);
const RHYTHMS = [1, 3, 6, 12, 24];

type Read = { state: "loading" } | { state: "failed"; why: string } | { state: "read"; models: ForecastModel[]; offer: ModelOffer };

/** What the last action on a model gave, kept while the page is open. */
interface Result {
  verification?: Verification;
  run?: TrialRun | null;
  nextRunAt?: string | null;
}

export default function ImportedModelsTab({ env }: { env: string | null }) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});

  const load = useCallback(() => {
    if (!env) return;
    let stale = false;
    fetchForecastModels(env).then(
      (out) => !stale && setRead({ state: "read", ...out }),
      (e: unknown) => {
        if (stale) return;
        const said = why(e, "Check the connection and read again.");
        // A list already on screen stays there: a read that fails takes nothing away from what was read.
        setRead((cur) => (cur.state === "read" ? cur : { state: "failed", why: said }));
        setProblem(`The models could not be read again: ${said}`);
      },
    );
    return () => {
      stale = true;
    };
  }, [env]);
  useEffect(() => load(), [load]);

  if (!env) return <p className="text-sm text-ink-faint">Select an environment first.</p>;
  if (read.state === "loading") return <p className="text-sm text-ink-muted">Reading the imported models…</p>;
  if (read.state === "failed") {
    return (
      <p role="alert" className="rounded bg-danger-soft px-3 py-2 text-sm text-danger-ink">
        The imported models could not be read: {read.why}
      </p>
    );
  }
  const { models, offer } = read;
  const measureOf = (key: string) => offer.measures.find((m) => m.key === key) ?? null;

  /** One action on one model: the model comes back as the server now holds it. */
  async function act(model: ForecastModel, what: string, fallback: string, run: () => Promise<{ model: ForecastModel } & Result>) {
    setBusy(`${what}:${model.key}`);
    setProblem(null);
    try {
      const out = await run();
      setRead((cur) => (cur.state === "read" ? { ...cur, models: cur.models.map((m) => (m.key === out.model.key ? out.model : m)) } : cur));
      setResults((cur) => ({ ...cur, [model.key]: { ...cur[model.key], ...out } }));
    } catch (e) {
      setProblem(why(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  async function remove(model: ForecastModel) {
    if (!window.confirm(`Remove “${model.label}”? Its replay and the forecasts it froze are removed with it. The series it was shown are not touched.`)) return;
    setBusy(`remove:${model.key}`);
    setProblem(null);
    try {
      await removeForecastModel(env!, model.key);
      load();
    } catch (e) {
      setProblem(why(e, "The model could not be removed. Check the connection and try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-medium text-ink">
            Imported models <span className="ml-1 rounded bg-line-faint px-1.5 text-[11px] text-ink-muted">{models.length}</span>
          </h1>
          <p className="mt-1 max-w-[75ch] text-xs leading-relaxed text-ink-muted">
            A forecasting model that is already trained, plugged in. It is shown the history the platform keeps and gives back a forecast. Nothing is
            trained here. A model is shown on the network only while its frozen forecasts do better than two simple rules.
          </p>
        </div>
        <button type="button" onClick={() => load()} className={cn(BUTTON, "shrink-0")}>
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Read again
        </button>
        <button type="button" disabled={adding} onClick={() => setAdding(true)} className={cn(BUTTON, "shrink-0")}>
          <Plus className="h-3 w-3" aria-hidden="true" />
          Import a model
        </button>
      </div>

      {!offer.service.configured ? (
        <p role="note" className="rounded bg-warn-soft px-2 py-1.5 text-xs text-warn-ink">
          {offer.service.says}
        </p>
      ) : null}
      <p className="text-xs text-ink-muted">{NOT_IN_THE_TWIN}</p>

      {problem ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-xs text-danger-ink">{problem}</p>
      ) : null}

      {adding ? (
        <ImportForm
          env={env}
          offer={offer}
          onCancel={() => setAdding(false)}
          onImported={() => {
            setAdding(false);
            load();
          }}
        />
      ) : null}

      {models.length === 0 && !adding ? (
        <p className="rounded-md border border-line-soft bg-surface px-3 py-2 text-xs text-ink-muted">
          No model is imported yet. The reference rule can be imported with nothing else to set up: it shows the whole road, and gives the error a model has to beat.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {models.map((model) => {
          const measure = measureOf(model.metric);
          const result = results[model.key] ?? {};
          const on = (what: string) => busy === `${what}:${model.key}`;
          return (
            <li key={model.key} aria-label={model.label} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-xs text-ink-body">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">{model.label}</span>
                <code className="rounded bg-canvas px-1 text-[10.5px] text-ink-muted">{model.key}</code>
                <button type="button" disabled={busy !== null} onClick={() => void remove(model)} className={cn(BUTTON, "ml-auto")}>
                  {on("remove") ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3 w-3" aria-hidden="true" />}
                  Remove
                </button>
              </div>

              <ol aria-label="Where this model stands" className="flex flex-wrap gap-1.5">
                {roadOf(model).map((step) => (
                  <li
                    key={step.id}
                    aria-current={step.done ? "step" : undefined}
                    className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px]", step.done ? "bg-brand-soft text-brand-deep" : "bg-canvas text-ink-faint")}
                  >
                    {step.done ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                    {step.label}
                  </li>
                ))}
              </ol>

              <p className="text-ink-muted">{sourceText(model)}</p>
              <p className="text-ink">{shapeText(model, measure?.label ?? null)}</p>
              {model.companions.length ? <p className="text-ink-muted">Shown beside it: {model.companions.map((c) => c.name).join(", ")}.</p> : null}
              {model.lastError ? (
                <p role="alert" className="rounded bg-warn-soft px-2 py-1 text-[11px] text-warn-ink">
                  {model.lastError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(model, "verify", "The contract could not be checked. Check the connection and try again.", () => verifyForecastModel(env, model.key))}
                  className={BUTTON}
                >
                  {on("verify") ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                  Check the contract on a sample
                </button>
                <button
                  type="button"
                  disabled={busy !== null || model.state === "imported"}
                  title={model.state === "imported" ? "Check the contract first" : undefined}
                  onClick={() => void act(model, "replay", "The replay could not run. Check the connection and try again.", () => backtestForecastModel(env, model.key))}
                  className={BUTTON}
                >
                  {on("replay") ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                  Replay on the last {offer.limits.backtestDays} days
                </button>
                <TrialControl
                  model={model}
                  disabled={busy !== null}
                  busy={on("trial")}
                  onSet={(turnOn, everyHours) => void act(model, "trial", "The trial could not be changed. Check the connection and try again.", () => setForecastTrial(env, model.key, turnOn, everyHours))}
                />
              </div>

              {result.verification ? <VerificationPanel v={result.verification} /> : null}
              {model.backtest ? <BacktestPanel model={model} /> : null}
              {model.state === "on_trial" || model.standing ? <TrialPanel model={model} run={result.run ?? null} nextRunAt={result.nextRunAt ?? null} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The three errors side by side, the lowest marked: what a model has to be under to be shown. */
function Errors({ score, unit, label }: { score: Score; unit: string | null; label: string }) {
  const lines = errorLines(score, unit, label);
  if (lines.length === 0) return null;
  return (
    <ul aria-label="Mean error" className="flex flex-wrap gap-x-4 gap-y-1">
      {lines.map((l) => (
        <li key={l.who} className={cn("flex items-baseline gap-1.5", l.best ? "text-ink" : "text-ink-muted")}>
          <span className={cn("text-[13px] font-semibold tabular-nums", l.best && "text-brand-deep")}>{l.value}</span>
          <span>{l.who}</span>
          {l.best ? <span className="rounded bg-brand-soft px-1 text-[10px] text-brand-deep">lowest</span> : null}
        </li>
      ))}
    </ul>
  );
}

function VerificationPanel({ v }: { v: Verification }) {
  return (
    <div aria-label="Contract check" role="region" className="flex flex-col gap-1 rounded border border-line-soft bg-canvas p-2">
      <span className={LABEL}>Contract checked on a sample</span>
      <p role="status" className={cn("flex items-center gap-1", v.ok ? "text-ok-ink" : "text-danger-ink")}>
        {v.ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
        {v.ok ? "The answer keeps the contract." : `Refused: ${v.why}`}
      </p>
      <p className="text-ink-body">Sent to: {v.sent.to}</p>
      <p className="text-ink-muted">{sentText(v)}</p>
      {v.leftOut.length ? (
        <p className="text-ink-muted">
          {v.leftOut.length} unit{v.leftOut.length === 1 ? " was" : "s were"} left out. {v.leftOut[0]!.name}: {v.leftOut[0]!.why}
        </p>
      ) : null}
      {v.sample ? (
        <p className="text-ink-muted">
          First steps for {v.sample.unit}: {v.sample.likely.map((x) => (x === null ? "no value" : x.toLocaleString("en-CA", { maximumFractionDigits: 1 }))).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function BacktestPanel({ model }: { model: ForecastModel }) {
  const b = model.backtest!;
  const rows = horizonRows(b.byHorizon, b.unit);
  return (
    <div aria-label="Replay on the past" role="region" className="flex flex-col gap-1.5 rounded border border-line-soft bg-canvas p-2">
      <span className={LABEL}>Replayed on the past · not a forecast</span>
      {backtestText(b).map((s) => (
        <p key={s} className="text-ink-body">{s}</p>
      ))}
      <Errors score={b.overall} unit={b.unit} label={model.label} />
      {b.overall.n > 0 ? (
        <table className="mt-1 w-full max-w-xl text-left text-[11px]">
          <caption className="sr-only">Mean error by how far ahead the forecast looks</caption>
          <thead className="text-ink-faint">
            <tr>
              <th scope="col" className="py-0.5 font-normal">Steps ahead</th>
              <th scope="col" className="py-0.5 font-normal">{model.label}</th>
              <th scope="col" className="py-0.5 font-normal">The last value holds</th>
              <th scope="col" className="py-0.5 font-normal">A week before</th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-ink-body">
            {rows.map((r) => (
              <tr key={r.step} className="border-t border-line-soft">
                <th scope="row" className="py-0.5 font-normal text-ink-muted">{r.step}</th>
                <td className={cn("py-0.5", r.beats && "font-semibold text-brand-deep")}>{r.model}</td>
                <td className="py-0.5">{r.held}</td>
                <td className="py-0.5">{r.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function TrialControl({ model, disabled, busy, onSet }: { model: ForecastModel; disabled: boolean; busy: boolean; onSet: (on: boolean, everyHours?: number) => void }) {
  const [every, setEvery] = useState(model.trialEveryHours);
  if (model.state === "on_trial") {
    return (
      <button type="button" disabled={disabled} onClick={() => onSet(false)} className={BUTTON}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
        Take off trial
      </button>
    );
  }
  const ready = model.state === "tried";
  return (
    <span className="flex items-center gap-1.5">
      <label className="flex items-center gap-1 text-[11px] text-ink-muted">
        every
        <select aria-label="Trial rhythm" value={every} disabled={disabled || !ready} onChange={(e) => setEvery(Number(e.target.value))} className={FIELD}>
          {RHYTHMS.map((h) => (
            <option key={h} value={h}>
              {h} h
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={disabled || !ready} title={ready ? undefined : "Replay it on the past first"} onClick={() => onSet(true, every)} className={BUTTON}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
        Put on trial
      </button>
    </span>
  );
}

function TrialPanel({ model, run, nextRunAt }: { model: ForecastModel; run: TrialRun | null; nextRunAt: string | null }) {
  const s = model.standing;
  const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  return (
    <div aria-label="Trial" role="region" className="flex flex-col gap-1.5 rounded border border-line-soft bg-canvas p-2">
      <span className={LABEL}>On trial · every forecast is frozen</span>
      {model.state === "on_trial" ? (
        <p className="text-ink-body">
          It runs every {model.trialEveryHours} hour{model.trialEveryHours === 1 ? "" : "s"}, 25 minutes after the hour. Each forecast is written once and cannot be changed afterwards.
          {model.lastRunAt ? ` Last run: ${at(model.lastRunAt)}.` : ""}
        </p>
      ) : (
        <p className="text-ink-muted">It is off trial: what it forecast stays frozen, and it makes no more.</p>
      )}
      {run ? (
        <p className="text-ink-muted">
          {run.missed
            ? `The origin of ${at(run.origin)} is too old to be forecast honestly: no forecast is made late.`
            : run.frozen > 0
              ? `${run.frozen} forecast${run.frozen === 1 ? "" : "s"} frozen for the origin of ${at(run.origin)}.`
              : run.why
                ? `Nothing was frozen for the origin of ${at(run.origin)}: ${run.why}`
                : `The origin of ${at(run.origin)} was already frozen.`}
          {nextRunAt ? ` Next run: ${at(nextRunAt)}.` : ""}
        </p>
      ) : null}
      {s ? (
        <>
          {standingText(s).map((line) => (
            <p key={line} className={cn(line.startsWith("Shown.") ? "text-ok-ink" : "text-ink-body")}>{line}</p>
          ))}
          <Errors score={s.overall} unit={s.unit} label={model.label} />
        </>
      ) : null}
    </div>
  );
}

function ImportForm({ env, offer, onCancel, onImported }: { env: string; offer: ModelOffer; onCancel: () => void; onImported: () => void }) {
  const [f, setF] = useState<ModelForm>(blankModelForm);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState("");
  const set = <K extends keyof ModelForm>(key: K, value: ModelForm[K]) => setF((cur) => ({ ...cur, [key]: value }));
  const choices = companionChoices(offer, f.metric);

  async function save() {
    const { draft, problems: found } = draftOfModel(f, offer);
    setProblems(found);
    if (found.length) return;
    setSaving(true);
    try {
      await importForecastModel(env, draft);
      onImported();
    } catch (e) {
      setProblems([why(e, "The model could not be imported. Check the connection and try again.")]);
    } finally {
      setSaving(false);
    }
  }

  function addCompanion(value: string) {
    const choice = choices.find((c) => c.value === value);
    if (!choice) return;
    const taken = f.companions.map((c) => c.name);
    const name = companionName(value.replace(/^twin:|^calendar:/, ""), taken);
    const companion: Companion = { name, kind: choice.kind, series: value, entity: choice.entities[0] ?? null };
    set("companions", [...f.companions, companion]);
    setAdding("");
  }

  return (
    <form
      aria-label="Import a model"
      className="flex flex-col gap-3 rounded-md border border-brand bg-surface p-3 text-xs text-ink-body"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-[13px] font-semibold text-ink">Import a model</p>

      <fieldset className="flex flex-col gap-2">
        <legend className={LABEL}>1 · Where it comes from</legend>
        <div className="flex flex-col gap-1">
          {(
            [
              ["reference", "The reference rule, built in: the same hour a week before. No model is called."],
              ["service", "An open model served by the model service, such as Chronos-2."],
              ["endpoint", "A model hosted at an address that speaks the contract."],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex items-start gap-1.5">
              <input type="radio" name="source" className="mt-0.5 accent-brand" checked={f.source === value} onChange={() => set("source", value)} />
              {text}
            </label>
          ))}
        </div>
        {f.source === "service" ? (
          <label className="flex max-w-xs flex-col gap-1">
            <span className={LABEL}>Model the service serves</span>
            <input value={f.serviceModel} onChange={(e) => set("serviceModel", e.target.value)} className={FIELD} />
          </label>
        ) : null}
        {f.source === "endpoint" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Address</span>
              <input value={f.endpointUrl} onChange={(e) => set("endpointUrl", e.target.value)} placeholder="https://models.example.org/forecast" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Name of the variable that holds its key</span>
              <input value={f.endpointKeyEnv} onChange={(e) => set("endpointKeyEnv", e.target.value)} placeholder={`${offer.keyPrefix}ACME`} className={FIELD} />
            </label>
            <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-2">
              Never type a key here. An administrator sets it on the API as an environment variable whose name starts with {offer.keyPrefix}; this field takes that
              name, and the key is never shown. Leave it empty for an address that asks for none.
            </p>
          </div>
        ) : null}
        <p role="note" className="rounded bg-canvas px-2 py-1 text-[11px] text-ink-body">
          {leavesText(f, offer)}
        </p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className={LABEL}>2 · What it forecasts</legend>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Measure of the twin</span>
          <select value={f.metric} onChange={(e) => setF((cur) => ({ ...cur, metric: e.target.value, companions: [] }))} className={FIELD}>
            <option value="">pick a measure…</option>
            {offer.measures.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} · {m.units} units
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name</span>
          <input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="Chronos-2, stretcher occupancy" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Step</span>
          <select value={f.step} onChange={(e) => set("step", e.target.value as ModelForm["step"])} className={FIELD}>
            <option value="hour">by the hour</option>
            <option value="day">by the day</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Horizon, in steps</span>
          <input inputMode="numeric" value={f.horizonSteps} onChange={(e) => set("horizonSteps", e.target.value)} className={FIELD} />
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className={LABEL}>3 · What it is shown</legend>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>History, in steps</span>
          <input inputMode="numeric" value={f.historySteps} onChange={(e) => set("historySteps", e.target.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>History a unit needs, in days</span>
          <input inputMode="numeric" value={f.minHistoryDays} onChange={(e) => set("minHistoryDays", e.target.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>A value holds for, in hours</span>
          <input inputMode="decimal" value={f.holdHours} onChange={(e) => set("holdHours", e.target.value)} className={FIELD} />
        </label>
        <p className="text-[10.5px] leading-snug text-ink-faint sm:col-span-3">
          A unit with less history than asked is left out, with the reason, rather than sent with a history padded out. When a source goes quiet for longer than a
          value holds, the model is shown a gap, not a flat line.
        </p>
        <div className="flex flex-col gap-1 sm:col-span-3">
          <span className={LABEL}>Companion series</span>
          {f.companions.length === 0 ? <span className="text-ink-faint">None: the model is shown the history of the measure alone.</span> : null}
          <ul className="flex flex-col gap-1">
            {f.companions.map((c, i) => {
              const choice = choices.find((x) => x.value === c.series);
              return (
                <li key={c.name} aria-label={c.name} className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-canvas px-1 text-[10.5px] text-ink-muted">{c.name}</code>
                  <span>{choice?.label ?? c.series}</span>
                  {choice && choice.entities.length ? (
                    <select
                      aria-label={`Entity of ${c.name}`}
                      value={c.entity ?? ""}
                      onChange={(e) => set("companions", f.companions.map((x, j) => (j === i ? { ...x, entity: e.target.value } : x)))}
                      className={FIELD}
                    >
                      {choice.entities.map((en) => (
                        <option key={en} value={en}>
                          {en}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button type="button" onClick={() => set("companions", f.companions.filter((_, j) => j !== i))} className={BUTTON}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <select aria-label="Add a companion series" value={adding} disabled={!f.metric || f.companions.length >= 8} onChange={(e) => addCompanion(e.target.value)} className={cn(FIELD, "max-w-md")}>
            <option value="">{f.metric ? "add a series the project keeps…" : "pick the measure first"}</option>
            {choices
              .filter((c) => c.kind === "known" || !f.companions.some((x) => x.series === c.value && c.entities.length === 0))
              .map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
          </select>
        </div>
        {f.companions.some((c) => c.kind === "known") ? (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Time zone of the calendar</span>
            <input value={f.timeZone} onChange={(e) => set("timeZone", e.target.value)} placeholder="America/Toronto" className={FIELD} />
          </label>
        ) : null}
      </fieldset>

      {problems.length ? (
        <ul role="alert" className="flex list-disc flex-col gap-0.5 rounded bg-danger-soft py-1.5 pl-6 pr-2 text-danger-ink">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-[10.5px] leading-snug text-ink-faint">Importing sends nothing anywhere. The first thing to leave is the sample that checks the contract, and you start it.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={PRIMARY}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
          Import
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className="rounded border border-line px-2.5 py-1 text-xs text-ink-body">
          Cancel
        </button>
      </div>
    </form>
  );
}
