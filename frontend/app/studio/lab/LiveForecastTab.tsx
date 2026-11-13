"use client";

/**
 * Live forecasts: the daily loop, morning by morning.
 *
 * Every number here was frozen by the server the morning it stands for, from
 * what was known that morning: the series up to the day before, the driver one
 * day further behind. This screen only reads those forecasts back and applies
 * the loop's rules to them (loop-rules.ts). Dragging the ruler replays another
 * morning exactly as it looked then; "what happened next" is shown greyed and
 * can be hidden, because nobody knew it that morning.
 */

import Link from "next/link";
import { Loader2, Pause, Play, Plus, TriangleAlert, CircleCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { listDatasets, type Dataset } from "../datasets-api";
import {
  catchUpForecastLoop,
  createForecastLoop,
  forecastLoopView,
  listForecastLoops,
  type ForecastLoop,
  type LoopView,
} from "../forecast-loops-api";
import { RULE, addDays, buildLoop, madeOf, targetOf, type Loop } from "./loop-rules";

const BTN = "inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1 text-[12px] text-ink-body hover:border-brand hover:text-brand disabled:opacity-50";
const BTN_P = "inline-flex items-center gap-1.5 rounded bg-brand px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-deep disabled:opacity-50";
const PANEL = "rounded-md border border-line bg-white p-3";
const H2 = "text-[13px] font-semibold text-ink";
const FIELD = "rounded border border-line bg-white px-2 py-1 text-[12px] text-ink focus:border-brand focus:outline-none";

const fmt = (n: number, d = 0) => Number(n).toLocaleString("en-CA", { maximumFractionDigits: d, minimumFractionDigits: d });
const r1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : fmt(v, 1));
const dayLabel = (s: string, year = false) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const shortLabel = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

// ---------------------------------------------------------------------------
// The chart: the series as known that morning, this morning's forecasts, and
// what was forecast for the past days at the chosen horizon.
// ---------------------------------------------------------------------------

function Chart({ L: loop, day, spec, h, real, unit }: { L: Loop; day: string; spec: string; h: number; real: boolean; unit: string }) {
  const W = 760, Hh = 236, Lp = 38, R = 10, T = 10, B = 22;
  const days: string[] = [];
  for (let s = addDays(day, -90); s <= addDays(day, 21); s = addDays(s, 1)) days.push(s);
  const n = days.length, X = (k: number) => Lp + (k / (n - 1)) * (W - Lp - R), at = (s: string) => days.indexOf(s);
  const yday = addDays(day, -1);
  const pts = loop.horizons
    .map((hh) => ({ h: hh, s: targetOf(day, hh), f: loop.forecast(spec, hh, day), b: loop.bandOf(spec, hh, day) }))
    .filter((p): p is { h: number; s: string; f: number; b: [number, number] | null } => p.f != null);
  const past = days.map((s) => {
    if (s >= day) return null;
    const made = madeOf(s, h);
    const sp = loop.inForce[made];
    return sp ? loop.forecast(sp, h, made) : null;
  });
  const vals = [
    ...days.map((s) => (s < day || real ? loop.obs(s) : null)),
    ...past,
    ...pts.flatMap((p) => [p.f, p.b ? p.f + p.b[1] : null]),
  ].filter((v): v is number => v != null);
  const top = Math.max(10, ...vals) * 1.08, Y = (v: number) => T + (1 - Math.max(0, v) / top) * (Hh - T - B);
  const step = top > 400 ? 100 : top > 120 ? 40 : top > 60 ? 20 : top > 25 ? 10 : 5;
  const grid: number[] = [];
  for (let v = 0; v <= top; v += step) grid.push(v);
  const path = (arr: (number | null)[]) => {
    let d = "", pen = false;
    arr.forEach((v, k) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(k).toFixed(1)},${Y(v).toFixed(1)} `; pen = true; });
    return d;
  };
  const xm = X(at(day) - 0.5);
  const bands = pts.filter((p) => p.b);
  const last = loop.obs(yday);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="h-auto w-full" role="img" aria-label={`${unit} known, forecasts made this morning and earlier forecasts at ${h} days`}>
      {grid.map((v) => (
        <g key={v}>
          <line x1={Lp} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#eef1f4" />
          <text x={Lp - 5} y={Y(v) + 3} textAnchor="end" fontSize={10} fill="#8f99a8">{v}</text>
        </g>
      ))}
      {days.map((s, k) => (s.endsWith("-01") || s.endsWith("-15") ? <text key={s} x={X(k)} y={Hh - 6} textAnchor="middle" fontSize={10} fill="#8f99a8">{shortLabel(s)}</text> : null))}
      <rect x={xm} y={T} width={Math.max(0, W - R - xm)} height={Hh - T - B} fill="#f8f9fa" />
      {bands.length > 1 ? (
        <polygon
          points={[...bands.map((p) => `${X(at(p.s)).toFixed(1)},${Y(p.f + p.b![1]).toFixed(1)}`), ...bands.slice().reverse().map((p) => `${X(at(p.s)).toFixed(1)},${Y(p.f + p.b![0]).toFixed(1)}`)].join(" ")}
          fill="#2d72d2" fillOpacity={0.13}
        />
      ) : null}
      {real ? <path d={path(days.map((s) => (s >= yday ? loop.obs(s) : null)))} fill="none" stroke="#8f99a8" strokeWidth={1.4} strokeDasharray="3 3" /> : null}
      <path d={path(days.map((s) => (s < day ? loop.obs(s) : null)))} fill="none" stroke="#1c2127" strokeWidth={1.6} />
      {past.map((v, k) => (v == null ? null : <circle key={k} cx={X(k)} cy={Y(v)} r={2.2} fill="#d9822b" />))}
      {last != null && pts.length ? (
        <>
          <line x1={X(at(yday))} x2={X(at(pts[pts.length - 1]!.s))} y1={Y(last)} y2={Y(last)} stroke="#8f99a8" strokeWidth={1.2} strokeDasharray="6 4" />
          <path d={`M${X(at(yday)).toFixed(1)},${Y(last).toFixed(1)} ${pts.map((p) => `L${X(at(p.s)).toFixed(1)},${Y(p.f).toFixed(1)}`).join(" ")}`} fill="none" stroke="#2d72d2" strokeWidth={2} />
          {pts.map((p) => <circle key={p.h} cx={X(at(p.s))} cy={Y(p.f)} r={p.h === h ? 4.2 : 3} fill={p.h === h ? "#2d72d2" : "#fff"} stroke="#2d72d2" strokeWidth={1.6} />)}
        </>
      ) : null}
      <line x1={xm} x2={xm} y1={T} y2={Hh - B} stroke="#1c2127" />
      <text x={xm + 4} y={T + 10} fontSize={10} fill="#1c2127">this morning</text>
    </svg>
  );
}

function Legend({ items }: { items: [string, string, "line" | "dash" | "dots" | "band"][] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
      {items.map(([c, t, k]) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          {k === "dots" ? <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            : k === "band" ? <span className="h-2.5 w-4 rounded-sm" style={{ background: c, opacity: 0.2 }} />
            : <span className="w-4" style={{ borderTop: `2px ${k === "dash" ? "dashed" : "solid"} ${c}` }} />}
          {t}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Starting a loop.
// ---------------------------------------------------------------------------

function NewLoop({ env, onCreated, onCancel }: { env: string; onCreated: (l: ForecastLoop) => void; onCancel: (() => void) | null }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [name, setName] = useState("");
  const [ds, setDs] = useState("");
  const [time, setTime] = useState("");
  const [target, setTarget] = useState("");
  const [dds, setDds] = useState("");
  const [dtime, setDtime] = useState("");
  const [dcol, setDcol] = useState("");
  const [start, setStart] = useState("2021-09-06");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void listDatasets(env).then(({ datasets }) => {
      if (!live) return;
      setDatasets(datasets);
      // A sensible first guess: hospital admissions, driven by test positivity.
      const adm = datasets.find((d) => /admission/i.test(d.name) && !/intensif|icu/i.test(d.name)) ?? datasets[0];
      if (adm) {
        setDs(adm.id);
        const cols = (adm.columnSchema ?? []).map((c) => c.name);
        setTime(cols.find((c) => /date|jour|day/i.test(c)) ?? cols[0] ?? "");
        setTarget(cols.find((c) => /admission/i.test(c)) ?? cols.find((c) => !/date|region/i.test(c)) ?? "");
        setName(`${adm.name.replace(/^[^—]*—\s*/, "")}`.slice(0, 80));
      }
      const pos = datasets.find((d) => /positivit/i.test(d.name));
      if (pos) {
        setDds(pos.id);
        const cols = (pos.columnSchema ?? []).map((c) => c.name);
        setDtime(cols.find((c) => /date|jour|day/i.test(c)) ?? cols[0] ?? "");
        setDcol(cols.find((c) => /positiv|taux/i.test(c)) ?? "");
      }
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [env]);

  const colsOf = (id: string) => (datasets.find((d) => d.id === id)?.columnSchema ?? []).map((c) => c.name);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const loop = await createForecastLoop(env, {
        name: name.trim() || "Forecast loop",
        datasetId: ds,
        timeColumn: time,
        target,
        driver: dds && dtime && dcol ? { datasetId: dds, timeColumn: dtime, column: dcol, delay: 1 } : null,
        startDate: start,
      });
      onCreated(loop);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn(PANEL, "max-w-[760px]")}>
      <h2 className={H2}>Start a daily forecasting loop</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
        Every morning, each horizon (1, 3, 7, 14 and 21 days) is forecast by two models from what was known that morning, and the forecast is frozen.
        Every Monday both are refitted. The loop starts at the first morning below and replays every morning since, until the morning after the last value; then it waits for new data.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr]">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint" htmlFor="lf-name">Name</label>
        <input id="lf-name" className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">What is forecast</span>
        <span className="flex flex-wrap gap-1.5">
          <select aria-label="Series dataset" className={FIELD} value={ds} onChange={(e) => setDs(e.target.value)}>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select aria-label="Date column" className={FIELD} value={time} onChange={(e) => setTime(e.target.value)}>{colsOf(ds).map((c) => <option key={c}>{c}</option>)}</select>
          <select aria-label="Value column" className={FIELD} value={target} onChange={(e) => setTarget(e.target.value)}>{colsOf(ds).map((c) => <option key={c}>{c}</option>)}</select>
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Driver (optional)</span>
        <span className="flex flex-wrap gap-1.5">
          <select aria-label="Driver dataset" className={FIELD} value={dds} onChange={(e) => setDds(e.target.value)}>
            <option value="">None</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {dds ? (
            <>
              <select aria-label="Driver date column" className={FIELD} value={dtime} onChange={(e) => setDtime(e.target.value)}>{colsOf(dds).map((c) => <option key={c}>{c}</option>)}</select>
              <select aria-label="Driver value column" className={FIELD} value={dcol} onChange={(e) => setDcol(e.target.value)}>{colsOf(dds).map((c) => <option key={c}>{c}</option>)}</select>
              <span className="self-center text-[11px] text-ink-faint">read one day later than the series</span>
            </>
          ) : null}
        </span>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint" htmlFor="lf-start">First morning</label>
        <input id="lf-start" type="date" className={cn(FIELD, "w-fit")} value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      {err ? <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-[12px] text-danger-ink">{err}</p> : null}
      <div className="mt-3 flex gap-2">
        <button type="button" className={BTN_P} disabled={busy || !ds || !time || !target} onClick={() => void create()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Start the loop
        </button>
        {onCancel ? <button type="button" className={BTN} onClick={onCancel}>Cancel</button> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------

export default function LiveForecastTab({ env, onError }: { env: string | null; onError: (m: string | null) => void }) {
  const [loops, setLoops] = useState<ForecastLoop[] | null>(null);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [view, setView] = useState<LoopView | null>(null);
  const [creating, setCreating] = useState(false);
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [h, setH] = useState(7);
  const [real, setReal] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [nudging, setNudging] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLoops = useCallback(async () => {
    if (!env) return;
    try {
      const { loops } = await listForecastLoops(env);
      setLoops(loops);
      setLoopId((cur) => (cur && loops.some((l) => l.id === cur) ? cur : loops[0]?.id ?? null));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setLoops([]);
    }
  }, [env, onError]);

  useEffect(() => { void loadLoops(); }, [loadLoops]);

  const loadView = useCallback(async () => {
    if (!env || !loopId) return;
    try {
      setView(await forecastLoopView(env, loopId));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [env, loopId, onError]);

  useEffect(() => { setView(null); setDayIdx(null); void loadView(); }, [loadView]);

  // While the server is still replaying, read again every ten seconds.
  useEffect(() => {
    if (view?.loop.status !== "replaying") return;
    const t = setInterval(() => void loadView(), 10_000);
    return () => clearInterval(t);
  }, [view?.loop.status, loadView]);

  const L = useMemo(() => (view ? buildLoop(view) : null), [view]);
  const lastIdx = L ? L.days.length - 1 : 0;
  const idx = dayIdx == null ? lastIdx : Math.min(dayIdx, lastIdx);
  const day = L?.days[idx] ?? null;

  useEffect(() => {
    if (!playing || !L) return;
    timer.current = setInterval(() => {
      setDayIdx((cur) => {
        const c = cur == null ? lastIdx : cur;
        if (c >= lastIdx) { setPlaying(false); return lastIdx; }
        return c + 1;
      });
    }, 140);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, L, lastIdx]);

  if (!env) return <p className="text-[12px] text-ink-muted">Pick a project first.</p>;
  if (loops == null) return <p className="flex items-center gap-2 text-[12px] text-ink-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading the loops…</p>;
  if (creating || !loops.length) {
    return (
      <NewLoop
        env={env}
        onCancel={loops.length ? () => setCreating(false) : null}
        onCreated={(l) => { setCreating(false); setLoops([...(loops || []), l]); setLoopId(l.id); }}
      />
    );
  }

  const loop = view?.loop ?? loops.find((l) => l.id === loopId) ?? loops[0]!;
  const unit = loop.target;
  const total = view?.lastDay ? Math.max(1, Math.round((Date.parse(`${addDays(view.lastDay, 1)}T00:00:00Z`) - Date.parse(`${loop.startDate}T00:00:00Z`)) / 86_400_000) + 1) : null;
  const done = loop.frozenThrough ? Math.round((Date.parse(`${loop.frozenThrough}T00:00:00Z`) - Date.parse(`${loop.startDate}T00:00:00Z`)) / 86_400_000) + 1 : 0;

  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[14px] font-medium text-ink">Live forecasts</span>
      <select aria-label="Loop" className={FIELD} value={loop.id} onChange={(e) => setLoopId(e.target.value)}>
        {loops.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      {day ? <span className="text-[12px] text-ink-faint">Morning of {dayLabel(day, true)} · {loop.status === "live" && idx === lastIdx ? "latest" : "replay"}</span> : null}
      {L && day ? (Object.keys(L.alertsOn(day)).length ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn-ink"><TriangleAlert className="h-3 w-3" />{Object.keys(L.alertsOn(day)).length} horizon{Object.keys(L.alertsOn(day)).length === 1 ? "" : "s"} drifting</span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok-ink"><CircleCheck className="h-3 w-3" />Within expected error</span>
      )) : null}
      <span className="flex-1" />
      <button type="button" className={BTN} disabled={!L || L.days.length < 2} onClick={() => { if (!playing && idx >= lastIdx) setDayIdx(0); setPlaying((p) => !p); }}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{playing ? "Pause" : "Replay the mornings"}
      </button>
      <button type="button" className={BTN} onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" />New loop</button>
      <Link href="/studio/events" className={BTN_P} title="The forecast is the expected future: an event is tested on top of it">Test an event on top of it</Link>
    </div>
  );

  const progress = loop.status !== "live" ? (
    <div className={cn("mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[12px]", loop.status === "failed" ? "border-danger-ink/30 bg-danger-soft text-danger-ink" : "border-line bg-canvas text-ink-body")}>
      {loop.status === "failed" ? <TriangleAlert className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <span className="min-w-0 flex-1">
        {loop.status === "failed"
          ? `The last block failed: ${loop.lastError ?? "unknown error"}.`
          : `Replaying the mornings since ${dayLabel(loop.startDate, true)}: ${fmt(done)}${total ? ` of ${fmt(total)}` : ""} frozen. The server keeps going on its own, a block of four weeks every few seconds.`}
      </span>
      <button type="button" className={BTN} disabled={nudging} onClick={() => { setNudging(true); void catchUpForecastLoop(env, loop.id).then(() => loadView()).catch((e) => onError(e instanceof Error ? e.message : String(e))).finally(() => setNudging(false)); }}>
        {nudging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{loop.status === "failed" ? "Try again" : "Freeze the next block now"}
      </button>
    </div>
  ) : null;

  if (!view || !L || !day) {
    return (
      <div>
        {header}
        {progress}
        <p className="text-[12px] text-ink-muted">{view ? "No morning frozen yet. The first block takes about twenty seconds." : "Loading…"}</p>
      </div>
    );
  }

  const spec = L.inForce[day] ?? L.specs[0]!;
  const specLabel = (k: string) => loop.specs.find((s) => s.key === k)?.label ?? k;
  const alerts = L.alertsOn(day);
  const knownTo = addDays(day, -1);
  const pend = L.horizons.map((hh) => ({ h: hh, made: day, tgt: targetOf(day, hh), f: L.forecast(spec, hh, day), naive: L.obs(knownTo), a: null as number | null, spec }));
  const doneRows = L.resolvedAt(spec, h, day, 12).map((x) => ({ ...x, h, spec: L.inForce[x.made] ?? spec }));
  const nextMonday = (() => { let s = addDays(day, 1); while (new Date(`${s}T00:00:00Z`).getUTCDay() !== 1) s = addDays(s, 1); return s; })();
  const frozenCount = view.forecasts.filter((f) => f.made <= day).length;
  const seen = L.events.filter((e) => e.day <= day && e.kind !== "retrain").slice(-14).reverse();
  const pos = (k: number) => ((k + 0.5) / L.days.length) * 100;

  return (
    <div>
      {header}
      {progress}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className={PANEL}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className={H2}>This morning&apos;s forecast</h2>
              <span className="text-[11.5px] text-ink-faint">
                {unit} known up to {dayLabel(knownTo)}{loop.driver ? `, ${loop.driver.column} up to ${dayLabel(addDays(day, -1 - loop.driver.delay))}` : ""}. Model in force: {specLabel(spec)}.
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {L.horizons.map((hh) => {
                const s = targetOf(day, hh), f = L.forecast(spec, hh, day), b = L.bandOf(spec, hh, day), a = L.obs(s);
                return (
                  <button key={hh} type="button" onClick={() => setH(hh)}
                    className={cn("flex flex-col rounded border px-2 py-1.5 text-left", hh === h ? "border-brand bg-brand-soft" : "border-line bg-white hover:border-brand")}>
                    <span className="text-[11px] text-ink-faint">in {hh} day{hh === 1 ? "" : "s"} · {dayLabel(s)}</span>
                    <b className="text-[18px] font-semibold tabular-nums text-ink">{f == null ? "—" : fmt(f)}</b>
                    <span className="text-[10.5px] text-ink-muted">{b && f != null ? `80 %: ${fmt(Math.max(0, f + b[0]))} to ${fmt(f + b[1])}` : `range after ${RULE.minPoints} scored`}</span>
                    {real && a != null ? <span className="text-[10.5px] text-ink-faint">happened: {fmt(a)}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-2"><Chart L={L} day={day} spec={spec} h={h} real={real} unit={unit} /></div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-body">
              <span className="text-ink-muted">Earlier forecasts shown at</span>
              <span className="inline-flex overflow-hidden rounded border border-line">
                {L.horizons.map((hh) => (
                  <button key={hh} type="button" onClick={() => setH(hh)} className={cn("px-2 py-0.5 text-[11.5px]", hh === h ? "bg-brand text-white" : "bg-white hover:bg-canvas")}>{hh} d</button>
                ))}
              </span>
              <label className="ml-2 inline-flex items-center gap-1.5"><input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} />Show what happened next</label>
            </div>
            <Legend items={[
              ["#1c2127", `${unit}, as known that morning`, "line"],
              ...(real ? [["#8f99a8", "what happened next (not known that morning)", "dash"] as [string, string, "dash"]] : []),
              ["#d9822b", `what was forecast ${h} day${h === 1 ? "" : "s"} earlier`, "dots"],
              ["#2d72d2", "this morning's forecast", "line"],
              ["#2d72d2", "80 % of our own past errors", "band"],
              ["#8f99a8", "naive: same as yesterday", "dash"],
            ]} />
          </section>

          <section className={PANEL}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className={H2}>How good it has been</h2>
              <span className="text-[11.5px] text-ink-faint">model in force, scored on the last {RULE.window} days whose outcome is known</span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead className="text-left text-[11px] text-ink-faint">
                  <tr><th className="py-1 font-medium">Horizon</th><th className="py-1 text-right font-medium">Error expected</th><th className="py-1 text-right font-medium">Error, last {RULE.window} days</th><th className="py-1 pl-3 font-medium">Against the naive forecast</th><th className="py-1 font-medium">Status</th></tr>
                </thead>
                <tbody>
                  {L.horizons.map((hh) => {
                    const st = L.liveStats(spec, hh, day), rt = L.retrainOf(spec, hh, day), al = alerts[hh];
                    const enough = st.n >= RULE.minPoints;
                    return (
                      <tr key={hh} className={cn("border-t border-line", hh === h && "bg-brand-soft/50")}>
                        <td className="py-1">{hh} day{hh === 1 ? "" : "s"}</td>
                        <td className="py-1 text-right">{rt?.mae != null ? r1(rt.mae) : "—"} <span className="text-ink-faint">a day</span></td>
                        <td className="py-1 text-right">{st.n ? r1(st.mae) : "—"} <span className="text-ink-faint">({st.n})</span></td>
                        <td className="py-1 pl-3">
                          {enough
                            ? st.mae! < st.naive!
                              ? <span className="text-ok-ink">{Math.round((1 - st.mae! / st.naive!) * 100)} % better</span>
                              : <span className="text-warn-ink">no better ({Math.round((st.mae! / st.naive! - 1) * 100)} % worse)</span>
                            : <span className="text-ink-faint">too few scored yet</span>}
                        </td>
                        <td className="py-1">
                          {!enough ? <span className="rounded bg-canvas px-1.5 py-0.5 text-[10.5px] text-ink-muted">waiting</span>
                            : al ? <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn-ink">drift · {(st.mae! / (L.retrainOf(spec, hh, day)?.mae || st.mae!)).toFixed(1)}×</span>
                            : <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[10.5px] text-ok-ink">ok</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Error is the average gap in {unit} a day. Expected is what the refit measured on the last eight known weeks, fitted without them, at the last Monday refit; an alert is raised when the
              last {RULE.window} days run {RULE.drift}× above it, with at least {RULE.minPoints} scored, and lowered below {RULE.clear}×. The thresholds were set before looking at any result.
            </p>
          </section>

          <section className={PANEL}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className={H2}>Frozen forecasts</h2>
              <span className="text-[11.5px] text-ink-faint">this morning&apos;s {L.horizons.length}, then the last 12 at {h} day{h === 1 ? "" : "s"} whose day has come</span>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead className="text-left text-[11px] text-ink-faint">
                  <tr>{["Made on", "For", "Horizon", "Forecast", "Naive", "Happened", "Error", "Naive error", "Model"].map((c, k) => <th key={c} className={cn("py-1 font-medium", k >= 2 && k <= 7 && "text-right")}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {[...pend, ...doneRows].map((x, k) => {
                    const pending = x.a == null;
                    return (
                      <tr key={k} className={cn("border-t border-line", pending && "text-ink-muted")}>
                        <td className="py-1">{dayLabel(x.made)}</td>
                        <td className="py-1">{dayLabel(x.tgt)}</td>
                        <td className="py-1 text-right">{x.h}</td>
                        <td className="py-1 text-right">{r1(x.f)}</td>
                        <td className="py-1 text-right">{r1(x.naive)}</td>
                        <td className="py-1 text-right">{pending ? "pending" : r1(x.a)}</td>
                        <td className="py-1 text-right">{pending || x.f == null ? "" : r1(x.a! - x.f)}</td>
                        <td className="py-1 text-right">{pending || x.naive == null ? "" : r1(x.a! - x.naive)}</td>
                        <td className="py-1 pl-2">{loop.specs.find((s) => s.key === x.spec)?.estimator === "ridge" ? "Ridge" : "Boosting"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">A forecast is stored the morning it is made and never edited. The naive forecast is “same as yesterday”: a model that cannot beat it is not worth running.</p>
          </section>

          <section className={PANEL}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className={H2}>Mornings</h2>
              <span className="text-[11.5px] text-ink-faint">Drag to replay another morning. Grey ticks: Monday refits · orange: drift alerts · blue: model replaced.</span>
            </div>
            <div className="relative mt-3 h-6">
              {L.events.map((e, k) => {
                const i = L.days.indexOf(e.day);
                if (i < 0) return null;
                if (e.kind === "retrain" || e.kind === "start") return <i key={k} className="absolute top-0 h-2 w-px bg-[#c5cbd3]" style={{ left: `${pos(i)}%` }} />;
                if (e.kind === "alert") return <i key={k} className="absolute h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#d9822b]" style={{ left: `${pos(i)}%`, top: `${10 + L.horizons.indexOf(e.h) * 2}px` }} title={`${e.day}: drift alert at ${e.h} days`} />;
                if (e.kind === "promote") return <i key={k} className="absolute top-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-[#2d72d2]" style={{ left: `${pos(i)}%` }} title={`${e.day}: model replaced`} />;
                return null;
              })}
            </div>
            <input type="range" aria-label="Morning" className="w-full accent-[#2d72d2]" min={0} max={lastIdx} value={idx}
              onChange={(e) => { setPlaying(false); setDayIdx(Number(e.target.value)); }} />
            <div className="flex justify-between text-[10.5px] text-ink-faint"><span>{dayLabel(L.days[0]!, true)}</span><span>{dayLabel(L.days[lastIdx]!, true)}</span></div>
          </section>
        </div>

        <aside className="flex flex-col gap-3">
          <section className={PANEL}>
            <h3 className="text-[12px] font-semibold text-ink">The loop this morning</h3>
            <ol className="mt-2 flex flex-col gap-1.5 text-[12px] leading-snug text-ink-body">
              {[
                ["Data in", `${unit} up to ${dayLabel(knownTo)}${loop.driver ? `; ${loop.driver.column} ${loop.driver.delay} day${loop.driver.delay === 1 ? "" : "s"} behind, up to ${dayLabel(addDays(day, -1 - loop.driver.delay))}` : ""}.`],
                ["Forecast", `${L.horizons.length} horizons × ${loop.specs.length} models, from what was known this morning. One model per horizon, trained for that horizon.`],
                ["Frozen", `${fmt(frozenCount)} forecasts stored since ${dayLabel(loop.startDate, true)}. None is ever edited.`],
                ["Drift check", Object.keys(alerts).length ? `${Object.keys(alerts).length} horizon${Object.keys(alerts).length === 1 ? "" : "s"} above ${RULE.drift}× the expected error: ${Object.keys(alerts).map((x) => `${x} d`).join(", ")}.` : "Every horizon within its expected error."],
                ["Retrain", `Every Monday, next on ${dayLabel(nextMonday)}. The model in force is replaced only if the other beats it by ${Math.round((1 - RULE.promoGain) * 100)} % at 7, 14 and 21 days over the last 8 weeks.`],
              ].map(([t, d], k) => (
                <li key={t} className="flex gap-2"><b className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-canvas text-[10px] text-ink-muted">{k + 1}</b><span><span className="font-semibold text-ink">{t}.</span> {d}</span></li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              {loop.status === "live" && view.lastDay ? `The series was last updated on ${dayLabel(view.lastDay, true)}; every morning before was replayed as if the loop had been running. ` : ""}
              Replayed with today&apos;s archive: values published on the morning itself were sometimes revised later, so a loop run live would do a little worse.
            </p>
          </section>

          <section className={PANEL}>
            <h3 className="text-[12px] font-semibold text-ink">Models <span className="font-normal text-ink-faint">both run every morning</span></h3>
            <div className="mt-2 flex flex-col gap-2">
              {loop.specs.map((s) => {
                const rt = L.retrainOf(s.key, h, day), st = L.liveStats(s.key, h, day);
                return (
                  <div key={s.key} className={cn("rounded border px-2 py-1.5", s.key === spec ? "border-brand bg-brand-soft/40" : "border-line")}>
                    <div className="flex items-start gap-2 text-[12px] text-ink">
                      <span className="min-w-0 flex-1">{s.label}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10.5px]", s.key === spec ? "bg-ok-soft text-ok-ink" : "bg-canvas text-ink-muted")}>{s.key === spec ? "in force" : "shadow"}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      Refitted {rt ? dayLabel(rt.on) : "—"} on {rt ? fmt(rt.points) : "—"} days · at {h} d: expected {r1(rt?.mae)}, last {RULE.window} days {st.n ? r1(st.mae) : "—"} a day
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">Both run on the same data; only the one in force is shown to decision-makers. The other is scored in the shadow, so a replacement is earned, not assumed.</p>
          </section>

          <section className={PANEL}>
            <h3 className="text-[12px] font-semibold text-ink">What the loop did <span className="font-normal text-ink-faint">· {L.events.filter((e) => e.day <= day && e.kind === "alert").length} alerts, {L.events.filter((e) => e.day <= day && e.kind === "promote").length} replacements so far</span></h3>
            <div className="mt-2 flex flex-col gap-1">
              {seen.length ? seen.map((e, k) => {
                const t = e.kind === "start" ? "The loop starts: both models fitted on everything known that morning."
                  : e.kind === "promote" ? `${specLabel(e.to)} replaces ${specLabel(e.from)}: ${r1(e.b)} against ${r1(e.a)} a day over 8 weeks.`
                  : e.kind === "alert" ? `Drift at ${e.h} days: error ${r1(e.live)} a day against ${r1(e.expected)} expected.`
                  : e.kind === "clear" ? `Back within expected error at ${e.h} days (${r1(e.live)} against ${r1(e.expected)}).` : "";
                return (
                  <button key={k} type="button" onClick={() => { setPlaying(false); setDayIdx(L.days.indexOf(e.day)); }}
                    className="flex gap-2 rounded px-1 py-0.5 text-left text-[11.5px] leading-snug text-ink-body hover:bg-canvas">
                    <span className="w-20 shrink-0 text-ink-faint">{dayLabel(e.day)}</span>
                    <span className={e.kind === "alert" ? "text-warn-ink" : ""}>{t}</span>
                  </button>
                );
              }) : <p className="text-[11.5px] text-ink-faint">Nothing yet.</p>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
