"use client";

/**
 * Reality check: the run's arrivals beside what was actually counted.
 *
 * A scenario that reproduces a wave nobody can see reproduced is a claim. This
 * puts an observed series from the project's own datasets on the run's axis —
 * day 0 pinned to a date — and reports the gap in the series' own unit. The
 * numbers come from the platform's observed-series comparison: the peak offset
 * is given before anything else, because a curve that peaks eleven days late
 * can still correlate at 0.94.
 *
 * Both runs are compared. Which one should match depends on what the scenario
 * holds: a wave fitted as it happened is the events-only run; a wave whose real
 * measures are stamped as choices is the other.
 */

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { fetchObservedSeries, type SeriesFit } from "@/lib/platform-api";

import { listDatasets, type Dataset } from "../../datasets-api";
import { dateOfDay, type RealityConfig } from "./reality";

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";
const FIELD = "min-w-0 rounded border border-line bg-white px-2 py-1 text-[12px] text-ink focus:border-brand focus:outline-none";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-CA");
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function fitSentence(fit: SeriesFit | null): string {
  if (!fit || fit.n === 0 || fit.meanAbsoluteError === null) return "no day in common";
  const off = fit.peakOffset;
  const peak =
    off === null ? "" : off === 0 ? ", peak on the same day" : `, peak ${Math.abs(off)} day${Math.abs(off) === 1 ? "" : "s"} ${off > 0 ? "late" : "early"}`;
  return `${one(fit.meanAbsoluteError)} a day off on average over ${fit.n} days${peak}`;
}

function Chart({
  observed,
  events,
  full,
  day,
  horizon,
  label,
}: {
  observed: Array<number | null>;
  events: number[];
  full: number[];
  day: number;
  horizon: number;
  label: string;
}) {
  const W = 1000;
  const H = 300;
  const top = Math.max(1, ...observed.filter((v): v is number => v !== null), ...events, ...full) * 1.08;
  const x = (t: number) => ((t + 0.5) / horizon) * W;
  const y = (v: number) => H - (v / top) * H;
  const line = (xs: Array<number | null>) =>
    xs
      .map((v, t) => (v === null || !Number.isFinite(v) ? null : `${x(t)},${y(v)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[120px] w-full" role="img" aria-label={label}>
        <rect width={W} height={H} fill="#f6f7f9" />
        <polyline points={line(events)} fill="none" stroke="#8f99a8" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <polyline points={line(full)} fill="none" stroke="#2d72d2" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <polyline points={line(observed)} fill="none" stroke="#1c2127" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={x(day)} x2={x(day)} y1={0} y2={H} stroke="#1c2127" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute right-1 top-0 rounded bg-white/90 px-1 text-[10px] tabular-nums text-ink-muted">{Math.round(top)}</span>
    </div>
  );
}

export default function RealityCheck({
  env,
  config,
  acuities,
  suggested,
  horizon,
  day,
  events,
  full,
  stale,
  busy,
  onSave,
  onClear,
}: {
  env: string;
  config: RealityConfig | null;
  /** Severities the twin's model produces. */
  acuities: string[];
  /** The severity that occupies the activity being read, when the care protocols say. */
  suggested: string | null;
  horizon: number;
  day: number;
  /** Arrivals per day by severity, from the last run; null before one. */
  events: Record<string, number[]> | null;
  full: Record<string, number[]> | null;
  stale: boolean;
  busy: boolean;
  onSave: (config: RealityConfig) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [datasetId, setDatasetId] = useState(config?.datasetId ?? "");
  const [when, setWhen] = useState(config?.when ?? "");
  const [value, setValue] = useState(config?.value ?? "");
  const [origin, setOrigin] = useState(config?.origin ?? "");
  const [acuity, setAcuity] = useState(config?.acuity ?? suggested ?? acuities[0] ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const [observed, setObserved] = useState<Array<number | null> | null>(null);
  const [fits, setFits] = useState<{ events: SeriesFit | null; full: SeriesFit | null } | null>(null);
  const [reported, setReported] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simEvents = config && events ? (events[config.acuity] ?? null) : null;
  const simFull = config && full ? (full[config.acuity] ?? null) : null;
  // A stable key, so the comparison is fetched once per run and per configuration.
  const key = useMemo(
    () => (config ? JSON.stringify([config, horizon, simEvents, simFull]) : ""),
    [config, horizon, simEvents, simFull],
  );

  useEffect(() => {
    if (!config) {
      setObserved(null);
      setFits(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    const ask = (simulated?: number[]) =>
      fetchObservedSeries(env, { datasetId: config.datasetId, when: config.when, value: config.value, origin: config.origin, horizon, ...(simulated ? { simulated } : {}) });
    void (async () => {
      try {
        const a = await ask(simEvents ?? undefined);
        const b = simFull ? await ask(simFull) : null;
        if (!live) return;
        setObserved(a.series);
        setReported(a.reported);
        setFits({ events: simEvents ? a.fit : null, full: b ? b.fit : null });
      } catch (e) {
        if (live) setError(message(e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // `key` stands for config, horizon and both simulated series.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, key]);

  function open() {
    setEditing(true);
    setFormError(null);
    if (datasets === null) {
      void listDatasets(env)
        .then(({ datasets: list }) => {
          setDatasets(list);
          if (!datasetId && list[0]) pick(list[0], list);
        })
        .catch((e) => setFormError(message(e)));
    }
  }

  const columns = (id: string, list: Dataset[] | null = datasets) => (list?.find((d) => d.id === id)?.columnSchema ?? []).map((c) => c.name);

  function pick(d: Dataset, list: Dataset[] | null = datasets) {
    const cols = columns(d.id, list);
    setDatasetId(d.id);
    setWhen(cols.find((c) => /date|jour|day/i.test(c)) ?? cols[0] ?? "");
    setValue(cols.find((c) => !/date|jour|day|region|région|nom|name/i.test(c)) ?? cols[1] ?? cols[0] ?? "");
  }

  function save() {
    const ds = datasets?.find((d) => d.id === datasetId);
    if (!ds) return setFormError("Pick the dataset that holds the observed series.");
    if (!when || !value) return setFormError("Pick the column with the date and the column with the count.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(origin)) return setFormError("Say which date day 0 is.");
    if (!acuity) return setFormError("Pick the severity the series counts.");
    setEditing(false);
    onSave({ datasetId: ds.id, datasetName: ds.name, when, value, origin, acuity });
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Reality check</span>
        <p className="text-[12px] text-ink-body">
          Put an observed daily series beside the run. It must be a dataset of this project, with one row per day.
        </p>
        {datasets === null && !formError ? (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading the datasets…</p>
        ) : datasets !== null && datasets.length === 0 ? (
          <p className="text-[12px] text-ink-muted">This project holds no dataset yet. Add the observed series under Data, then come back.</p>
        ) : (
          <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-[12px]">
            <label htmlFor="rc-dataset" className="text-ink-muted">Dataset</label>
            <select id="rc-dataset" className={FIELD} value={datasetId} onChange={(e) => { const d = datasets?.find((x) => x.id === e.target.value); if (d) pick(d); }}>
              {(datasets ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <label htmlFor="rc-when" className="text-ink-muted">Date column</label>
            <select id="rc-when" className={FIELD} value={when} onChange={(e) => setWhen(e.target.value)}>
              {columns(datasetId).map((c) => <option key={c}>{c}</option>)}
            </select>
            <label htmlFor="rc-value" className="text-ink-muted">Count column</label>
            <select id="rc-value" className={FIELD} value={value} onChange={(e) => setValue(e.target.value)}>
              {columns(datasetId).map((c) => <option key={c}>{c}</option>)}
            </select>
            <label htmlFor="rc-origin" className="text-ink-muted">Day 0 is</label>
            <input id="rc-origin" type="date" className={cn(FIELD, "w-fit")} value={origin} onChange={(e) => setOrigin(e.target.value)} />
            <label htmlFor="rc-acuity" className="text-ink-muted">It counts</label>
            <select id="rc-acuity" className={FIELD} value={acuity} onChange={(e) => setAcuity(e.target.value)}>
              {acuities.map((a) => <option key={a} value={a}>{a} arrivals</option>)}
            </select>
          </div>
        )}
        {formError ? <p role="alert" className="rounded bg-danger-soft px-2 py-1 text-[11.5px] text-danger-ink">{formError}</p> : null}
        <div className="flex gap-1.5">
          <button type="button" disabled={busy || !datasets?.length} onClick={save} className="rounded bg-brand px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-50">Compare</button>
          <button type="button" onClick={() => setEditing(false)} className="rounded border border-line px-2.5 py-1 text-[12px] hover:bg-canvas-raised">Cancel</button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Reality check</span>
        <p className="text-[12px] text-ink-muted">Nothing observed is set beside this scenario yet.</p>
        <button type="button" onClick={open} className="self-start rounded border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-canvas-raised">
          Compare with observed data
        </button>
      </div>
    );
  }

  const last = dateOfDay(config.origin, horizon - 1);
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>Reality check · {config.acuity} arrivals a day</span>
      <p className="text-[11.5px] text-ink-muted">
        {config.datasetName || "Observed series"} · {config.value} · day 0 is {shortDate(config.origin)}, day {horizon - 1} is {shortDate(last)}
      </p>
      {error ? (
        <p role="alert" className="rounded bg-danger-soft px-2 py-1 text-[11.5px] text-danger-ink">The observed series could not be read: {error}</p>
      ) : !observed ? (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading the observed series…</p>
      ) : reported === 0 ? (
        <p className="rounded bg-warn-soft px-2 py-1 text-[11.5px] text-warn-ink">
          The dataset reports nothing between {shortDate(config.origin)} and {shortDate(last)}. Check the date day 0 is.
        </p>
      ) : (
        <>
          <Chart
            observed={observed}
            events={simEvents ?? []}
            full={simFull ?? []}
            day={day}
            horizon={horizon}
            label={`Observed ${config.value} and simulated ${config.acuity} arrivals, by day`}
          />
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-body">
            <span className="flex items-center gap-1.5"><span className="h-[2px] w-4 bg-ink" />Observed</span>
            <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-ink-faint" />Events only</span>
            <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-brand" />Your scenario</span>
          </div>
          {!simEvents ? (
            <p className="text-[12px] text-ink-muted">
              {events ? `The last run produced no ${config.acuity} arrivals.` : "Run to see how close the scenario comes."}
            </p>
          ) : (
            <div className={cn("flex flex-col gap-0.5 text-[12px] tabular-nums text-ink-body", (stale || loading) && "opacity-60")}>
              <span><span className="text-ink-muted">Events only:</span> {fitSentence(fits?.events ?? null)}</span>
              <span><span className="font-semibold text-brand-deep">Your scenario:</span> {fitSentence(fits?.full ?? null)}</span>
            </div>
          )}
          <p className="text-[11px] text-ink-faint">
            The gap is in arrivals a day, over the days both report ({reported} observed). A close match after the fact
            shows the scenario can reproduce the wave, not that it would have predicted it.
          </p>
        </>
      )}
      <div className="flex gap-1.5">
        <button type="button" disabled={busy} onClick={open} className="rounded border border-line bg-white px-2 py-1 text-[11.5px] hover:bg-canvas-raised disabled:opacity-50">Change</button>
        <button type="button" disabled={busy} onClick={onClear} className="rounded border border-line bg-white px-2 py-1 text-[11.5px] text-ink-muted hover:bg-canvas-raised disabled:opacity-50">Stop comparing</button>
      </div>
    </div>
  );
}
