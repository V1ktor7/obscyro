"use client";

/**
 * The profile catalogue: events ready to drop into one, and the ones the
 * organisation made itself.
 *
 * It opens two ways. Inside the builder ("From a profile"), a profile is added
 * to the event being written, which stays as it was underneath. As a page of
 * its own (Twin → Profiles), a profile starts a new event.
 *
 * Every preview is computed on the open twin: the totals, the sentences, the
 * places a preset aims at. A profile made in Montréal reads in Rimouski.
 */

import { BookOpen, FileSpreadsheet, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { deleteSimProfile, listSimProfiles, saveSimProfile, type SimProfileRecord } from "@/lib/platform-api";
import { cn } from "@/lib/cn";
import { CURVES, EXP, EXPOSURES, hasRange, SRC, type Coef } from "./exposures";
import { addDays, fmt, sig, type Ctx } from "./format";
import { itemLabel, itemWindow, sentenceOf, type Item } from "./items";
import type { Part } from "./model";
import {
  BUILT_IN, COVID, decodeBytes, guessMapping, parseCsv, perThousand, PROFILE_TYPES, profileFromSaved, profileTable, readSeries,
  type Profile, type ProfileType, type SavedProfile, type SavedProfileBody, type SeriesMapping, type Table,
} from "./profiles";
import type { BuilderTwin } from "./twin";
import { BTN, BTN_P, BTN_SM, HELP, IN, Key, LBL, Row, Seg, TINTS } from "./ui";

const TIER_CLS: Record<string, string> = {
  Observed: "bg-ok-soft text-ok-ink", Published: "bg-ok-soft text-ok-ink", "Published × assumption": "bg-warn-soft text-warn-ink",
  Assumption: "bg-canvas text-ink-muted", Yours: "bg-canvas text-ink-muted",
};
const GROUPS: [ProfileType, string][] = [["observed", "Observed episodes"], ["exposure", "Exposure × published effect"], ["network", "Network"], ["combined", "Combined"], ["mine", "Yours"]];

const plain = (parts: Part[]) => parts.map((p) => (typeof p === "string" ? p : p.text)).join("").replace(/`|\*\*/g, "");

function toSaved(r: SimProfileRecord): SavedProfile | null {
  const b = r.body as SavedProfileBody;
  if (!b || !["series", "exposure", "changes"].includes(String((b as { kind?: unknown }).kind))) return null;
  return { id: r.id, name: r.name, description: r.description, body: b, createdAt: r.createdAt };
}

/* ---------- small pictures ---------- */

function Spark({ p, tw, ctx }: { p: Profile; tw: BuilderTwin; ctx: Ctx }) {
  const c = p.curveKey ? CURVES.get(p.curveKey) : null;
  if (c?.curves) {
    const v = c.curves.central, top = Math.max(1e-9, ...c.curves.high), n = Math.max(1, v.length - 1);
    const X = (k: number) => ((k / n) * 240).toFixed(1), Y = (y: number) => (32 - (y / top) * 28).toFixed(1);
    const hi = c.curves.high.map((y, k) => `${X(k)},${Y(y)}`), lo = c.curves.low.map((y, k) => `${X(k)},${Y(y)}`).reverse();
    return (
      <svg viewBox="0 0 240 34" preserveAspectRatio="none" aria-hidden="true" className="h-8 w-full">
        <polygon points={[...hi, ...lo].join(" ")} fill="#2d72d2" fillOpacity={0.14} />
        <path d={v.map((y, k) => `${k ? "L" : "M"}${X(k)},${Y(y)}`).join(" ")} fill="none" stroke="#2d72d2" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const items = p.build(ctx, tw, []), wins = items.map(itemWindow), end = Math.max(1, ...wins.map((w) => w[1])) + 1;
  const h = Math.min(8, 30 / Math.max(1, items.length));
  return (
    <svg viewBox="0 0 240 34" preserveAspectRatio="none" aria-hidden="true" className="h-8 w-full">
      {wins.map(([a, b], k) => <rect key={k} x={((a / end) * 240).toFixed(1)} y={(2 + k * (h + 2)).toFixed(1)} width={Math.max(3, ((b - a + 1) / end) * 240).toFixed(1)} height={h.toFixed(1)} rx={2} fill={TINTS[k % TINTS.length]![1]} fillOpacity={0.55} />)}
    </svg>
  );
}

function CurveChart({ c, label }: { c: Pick<Coef, "curves" | "icu" | "days" | "from" | "tests" | "kind">; label?: string }) {
  const W = 380, Hh = 150, L = 38, R = 8, T = 8, B = 20, n = c.days ?? c.curves!.central.length;
  const top = Math.max(1e-9, ...c.curves!.high, ...(c.icu || [])) * 1.08;
  const X = (d: number) => L + (d / Math.max(1, n - 1)) * (W - L - R), Y = (v: number) => T + (1 - v / top) * (Hh - T - B);
  const pts = (arr: number[]) => arr.map((v, d) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`);
  const range = hasRange(c as Coef);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Arrivals per 1,000 residents a day, by day of the episode" className="block h-auto w-full rounded-md border border-line-soft bg-white">
        {[0, 0.5, 1].map((fr) => { const v = (top / 1.08) * fr; return <g key={fr}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#eef1f4" /><text x={L - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="#8f99a8">{sig(v)}</text></g>; })}
        {[0, Math.round((n - 1) / 2), n - 1].map((d) => <text key={d} x={X(d)} y={Hh - 5} textAnchor="middle" fontSize="9" fill="#8f99a8">{c.from ? addDays(c.from, d).slice(5) : `day ${d}`}</text>)}
        {range ? <polygon points={[...pts(c.curves!.high), ...pts(c.curves!.low).reverse()].join(" ")} fill="#2d72d2" fillOpacity={0.14} /> : null}
        <polyline points={pts(c.curves!.central).join(" ")} fill="none" stroke="#2d72d2" strokeWidth={1.8} />
        {c.icu ? <polyline points={pts(c.icu).join(" ")} fill="none" stroke="#a82255" strokeWidth={1.3} strokeDasharray="4 3" /> : null}
      </svg>
      <Key items={[["#2d72d2", range ? "central: the median region" : label ?? "per 1,000 residents, a day"], ...(range ? [["#2d72d2", "10th to 90th percentile of the regions", "band"] as [string, string, "band"]] : []), ...(c.icu ? [["#a82255", "intensive care (reference only)", "dash"] as [string, string, "dash"]] : [])]} />
    </>
  );
}

function ItemsTimeline({ items, tw }: { items: Item[]; tw: BuilderTwin }) {
  const W = 380, rowH = 22, L = 150, wins = items.map(itemWindow), end = Math.max(1, ...wins.map((w) => w[1])) + 1;
  const X = (d: number) => L + (d / end) * (W - L - 6), Hh = 8 + items.length * rowH + 14;
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="When each change applies" className="block h-auto w-full rounded-md border border-line-soft bg-white">
      {items.map((it, k) => {
        const [a, b] = wins[k]!, y = 4 + k * rowH, col = TINTS[k % TINTS.length]![1];
        return <g key={k}><text x={6} y={y + 13} fontSize="10.5" fill="#404854">{itemLabel(it, tw).slice(0, 26)}</text><rect x={X(a)} y={y + 3} width={Math.max(3, X(b + 1) - X(a))} height={14} rx={3} fill={col} fillOpacity={0.25} stroke={col} /></g>;
      })}
      <text x={L} y={Hh - 4} fontSize="9" fill="#8f99a8">day 0</text>
      <text x={W - 6} y={Hh - 4} textAnchor="end" fontSize="9" fill="#8f99a8">day {end - 1}</text>
    </svg>
  );
}

/* ---------- the detail of one profile ---------- */

function Detail({ p, tw, ctx, mode, onUse, onStartNew, onDelete }: {
  p: Profile | null; tw: BuilderTwin; ctx: Ctx; mode: "pick" | "page"; onUse?: (p: Profile) => void; onStartNew?: (p: Profile) => void; onDelete?: (p: Profile) => void;
}) {
  if (!p) return <p className={HELP}>Pick a profile to see what it adds to an event.</p>;
  const items = p.build(ctx, tw, []);
  const wide: Ctx = { ...ctx, horizon: Math.min(365, Math.max(ctx.horizon, 1 + Math.max(0, ...items.map((it) => itemWindow(it)[1])))) };
  const c = p.curveKey ? CURVES.get(p.curveKey) : null;
  const t = c?.tests ?? [];
  const typeLabel = PROFILE_TYPES.find((x) => x[0] === p.type)?.[1];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{p.name}</h3>
        <div className="mt-1 flex flex-wrap gap-1">
          <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-medium", TIER_CLS[p.tier] ?? "bg-canvas text-ink-muted")}>{p.tier}</span>
          {typeLabel && typeLabel !== p.tier ? <span className="rounded-full bg-canvas px-2 py-0.5 text-[10.5px] font-medium text-ink-muted">{typeLabel}</span> : null}
        </div>
      </div>
      <p className={HELP}>{p.desc}</p>
      {c?.curves ? <CurveChart c={c} label={`${c.outcome} per 1,000 residents, a day`} /> : <ItemsTimeline items={items} tw={tw} />}
      <div>
        <p className={cn(LBL, "mb-1")}>What it adds to an event, on this twin</p>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] leading-snug text-ink-body">
          {items.map((it, k) => <li key={k}>{plain(sentenceOf(it, tw, wide))}</li>)}
        </ul>
      </div>
      <div>
        <p className={cn(LBL, "mb-1")}>Left to choose when you use it</p>
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-body">{p.open.map((o) => <li key={o}>{o}</li>)}</ul>
      </div>
      <div>
        <p className={cn(LBL, "mb-1")}>How far to trust it</p>
        {c && t.length ? (() => {
          const inside = t.filter((z) => z.inside).length;
          const rs = t.map((z) => z.ratio).filter((v): v is number => v != null).sort((a, b) => a - b);
          const sh = t.map((z) => z.shape).filter((v): v is number => v != null).sort((a, b) => a - b);
          const lags = t.map((z) => z.peakLag);
          return (
            <>
              <p className={HELP}>Rebuilt without each region and applied to it: the region’s real total fell inside the low–high range for <b className="text-ink">{inside} of {t.length}</b> regions, at <b className="text-ink">{rs[0]} to {rs[rs.length - 1]}</b> times the central version (median {rs[Math.floor(rs.length / 2)]}). Median shape match r = {sh[Math.floor(sh.length / 2)]}; peaks from {Math.min(...lags)} to +{Math.max(...lags)} days apart.</p>
              <details className="mt-1 text-[11.5px]">
                <summary className="cursor-pointer text-brand-deep">The {t.length} regions</summary>
                <table className="mt-1 w-full border-collapse text-[11px] tabular-nums">
                  <thead><tr className="text-left text-ink-faint"><th className="py-0.5 font-medium">Region</th><th className="text-right font-medium">Real</th><th className="text-right font-medium">Central</th><th className="text-right font-medium">Ratio</th><th className="pl-2 font-medium">In range</th></tr></thead>
                  <tbody>{t.map((z) => <tr key={z.region} className="border-t border-line-faint"><td className="py-0.5">{z.region.replace(/^\d+ - /, "")}</td><td className="text-right">{z.real}</td><td className="text-right">{z.central}</td><td className="text-right">{z.ratio ?? "—"}</td><td className={cn("pl-2", z.inside ? "text-ok-ink" : "text-warn-ink")}>{z.inside ? "yes" : "no"}</td></tr>)}</tbody>
                </table>
                <p className={HELP}>Per 1,000 residents, over the whole wave.</p>
              </details>
            </>
          );
        })() : <p className={HELP}>{p.reliabilityShort.charAt(0).toUpperCase() + p.reliabilityShort.slice(1)}.</p>}
      </div>
      <div>
        <p className={cn(LBL, "mb-1")}>Source</p>
        <p className={HELP}>{p.curveKey && c?.src === "inspq" ? SRC.inspq!.cite : p.source}.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {mode === "pick" && onUse ? <button type="button" className={BTN_P} onClick={() => onUse(p)}>Add to the current event</button> : null}
        {onStartNew ? <button type="button" className={mode === "page" ? BTN_P : BTN} onClick={() => onStartNew(p)}>Start a new event with it</button> : null}
        {p.type === "mine" && onDelete ? <button type="button" className={cn(BTN, "hover:border-danger hover:text-danger")} onClick={() => onDelete(p)}><Trash2 className="h-3.5 w-3.5" />Delete</button> : null}
      </div>
    </div>
  );
}

/* ---------- creating one ---------- */

type CreateMode = "data" | "exposure" | "event";
interface Draft {
  csv: string; pop: string; sev: string; smooth: boolean; name: string; coef: string; series: string; usual: string; picked: string[] | null;
  table: Table | null; fileError: string | null; map: SeriesMapping;
}
const EMPTY_MAP: SeriesMapping = { dateCol: "", countCol: "", filterCol: "", filterVal: "", from: "", to: "", cumulative: false, sumSameDay: false };

function rowsFromJson(text: string): Record<string, string>[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? (Object.values(data).find(Array.isArray) as unknown[] | undefined) ?? [] : [];
  return list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? "" : String(v)])));
}

function Create({ env, tw, ctx, items, onSaved, onCancel }: { env: string; tw: BuilderTwin; ctx: Ctx; items: Item[] | null; onSaved: (id: string) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<CreateMode>("data");
  const [d, setD] = useState<Draft>({
    csv: "", pop: "", sev: tw.severities.find((s) => /hosp|admi/i.test(s)) ?? tw.severities[0] ?? "", smooth: true, name: "", coef: "smoke-asthma-er", series: "", usual: "",
    picked: null, table: null, fileError: null, map: EMPTY_MAP,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setMap = (patch: Partial<SeriesMapping>) => setD((x) => ({ ...x, map: { ...x.map, ...patch } }));
  const picked = d.picked ?? (items ?? []).map((it) => it.key);

  async function load(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { set({ fileError: "Excel files are not read here yet. Save the sheet as CSV (File → Save as → CSV UTF-8) and upload that.", table: null }); return; }
    if (file.size > 60 * 1024 * 1024) { set({ fileError: `This file is ${fmt(file.size / 1024 / 1024)} MB. Cut it to the series you need first.`, table: null }); return; }
    try {
      const { text, encoding } = decodeBytes(await file.arrayBuffer());
      const rows = /\.json$/i.test(file.name) ? rowsFromJson(text) : parseCsv(text);
      if (!rows.length) { set({ fileError: "No rows could be read from this file: it needs a header line and at least one row.", table: null }); return; }
      const t = profileTable(file.name, rows, encoding);
      const m = guessMapping(t);
      setD((x) => ({ ...x, table: t, fileError: null, map: m, name: x.name || file.name.replace(/\.[^.]+$/, "") }));
    } catch (e) {
      set({ fileError: `This file could not be read: ${(e as Error).message}`, table: null });
    }
  }

  const draft = useMemo(() => {
    const name = d.name.trim();
    if (mode === "data") {
      if (!d.table && !d.csv.trim()) return { quiet: true as const };
      const sr = readSeries(d.csv, d.table, d.table ? d.map : EMPTY_MAP);
      if (sr.error) return { error: sr.error, notes: sr.notes };
      const rows = sr.rows!, pop = Number(d.pop);
      if (!(pop > 0)) return { error: "Say how many residents these counts come from: without it, the series cannot become a rate.", notes: sr.notes };
      const curve = perThousand(rows, pop, d.smooth), total = curve.reduce((a, v) => a + v, 0);
      if (!name) return { error: "Give it a name.", notes: sr.notes };
      const source = d.table ? `${d.table.name}${d.map.filterCol && d.map.filterVal ? `, ${d.map.filterVal}` : ""}` : "a pasted series";
      return { ok: true as const, notes: sr.notes, curve, rows, total, body: { kind: "series", sev: d.sev, curve: curve.map((v) => Number(v.toPrecision(6))), from: rows[0]![0], to: rows[rows.length - 1]![0], population: pop, source } as SavedProfileBody };
    }
    if (mode === "exposure") {
      const c = EXP.get(d.coef)!, nums = d.series.replace(/(\d),(\d)/g, "$1.$2").split(/[\s;,]+/).filter(Boolean).map(Number);
      if (!nums.length) return { quiet: true as const };
      if (nums.some((v) => !Number.isFinite(v))) return { error: "The rise is not all numbers." };
      if (!name) return { error: "Give it a name." };
      return { ok: true as const, c, nums, body: { kind: "exposure", coef: d.coef, series: nums.join(" "), usual: d.usual === "" ? null : Number(d.usual) } as SavedProfileBody };
    }
    const kept = (items ?? []).filter((it) => picked.includes(it.key));
    if (!kept.length) return { error: "Pick at least one change." };
    if (!name) return { error: "Give it a name." };
    const first = Math.min(...kept.map((it) => itemWindow(it)[0]));
    const shifted = kept.map((it) => {
      const c: Item = JSON.parse(JSON.stringify(it));
      if (c.kind === "exposure") c.x.start -= first;
      else { c.e.profile.start -= first; if (c.e.profile.end != null) c.e.profile.end -= first; if (c.e.profile.peak_tick != null) c.e.profile.peak_tick -= first; }
      return { item: c };
    });
    return { ok: true as const, kept, body: { kind: "changes", items: shifted } as SavedProfileBody };
  }, [mode, d, items, picked]);

  async function save() {
    if (!("ok" in draft) || busy) return;
    setBusy(true); setErr(null);
    try {
      const desc = mode === "data" && "rows" in draft && draft.rows
        ? `Imported: ${draft.rows.length} days from ${draft.rows[0]![0]} to ${draft.rows[draft.rows.length - 1]![0]}, divided by ${fmt(Number(d.pop))} residents.`
        : mode === "exposure" ? "Your exposure, with a published effect." : "Saved from an event.";
      const r = await saveSimProfile(env, { name: d.name.trim(), description: desc, body: draft.body as unknown as Record<string, unknown> });
      onSaved(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const t = d.table, cols = t?.columns ?? [];
  const numeric = cols.filter((c) => t!.prof[c]!.numeric);
  const cats = cols.filter((c) => t && !t.prof[c]!.numeric && c !== d.map.dateCol && t.prof[c]!.distinct > 1 && t.prof[c]!.distinct <= 400);
  const ex = COVID.example;

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-md border border-brand bg-white p-3"
      onDragOver={(ev) => { if (mode === "data") ev.preventDefault(); }}
      onDrop={(ev) => { if (mode !== "data") return; ev.preventDefault(); void load(ev.dataTransfer.files?.[0]); }}>
      <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-ink">Create a profile</h2><button type="button" className={cn(BTN_SM, "ml-auto")} onClick={onCancel}>Cancel</button></div>
      <Row label="Start from">
        <Seg label="Start from" value={mode} onChange={(v) => { setMode(v); set({ picked: null }); }}
          options={[{ v: "data", label: "Your data" }, { v: "exposure", label: "An exposure" }, { v: "event", label: "The current event", disabled: items ? undefined : "Open the catalogue from an event to keep its changes" }]} />
      </Row>

      {mode === "data" ? (
        <>
          <p className={HELP}>A dated series of counts (admissions, ER visits, cases), one value per day. It becomes a rate per 1,000 residents, so it can be applied to any territory.</p>
          <Row>
            <label className={cn(BTN, "cursor-pointer")}><Upload className="h-3.5 w-3.5" />Upload a file<input type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xls" hidden onChange={(ev) => { void load(ev.target.files?.[0]); ev.target.value = ""; }} /></label>
            <span className="text-[11px] text-ink-faint">CSV, TSV or JSON. Or drop it on this panel, or paste below.</span>
          </Row>
          {d.fileError ? <p className="text-[11.5px] text-warn-ink">{d.fileError}</p> : null}
          {t ? (
            <>
              <div className="flex items-center gap-2 rounded border border-line-soft bg-canvas-raised px-2 py-1.5 text-[11.5px] text-ink-body">
                <FileSpreadsheet className="h-4 w-4 text-ink-faint" />
                <span><b>{t.name}</b> · {fmt(t.rows.length)} rows · {cols.length} columns · {t.meta}</span>
                <button type="button" className={cn(BTN_SM, "ml-auto")} onClick={() => set({ table: null, fileError: null, map: EMPTY_MAP })}>Remove</button>
              </div>
              <Row label="Dates in">
                <select className={IN} aria-label="Date column" value={d.map.dateCol} onChange={(ev) => setMap({ dateCol: ev.target.value, from: "", to: "" })}>{cols.map((c) => <option key={c}>{c}</option>)}</select>
                <span className={cn(LBL, "ml-2")}>Counts in</span>
                <select className={IN} aria-label="Count column" value={d.map.countCol} onChange={(ev) => setMap({ countCol: ev.target.value, cumulative: /cum/i.test(ev.target.value) })}>
                  {numeric.length ? numeric.map((c) => <option key={c}>{c}</option>) : <option value="">no column reads as numbers</option>}
                </select>
              </Row>
              <Row label="Only rows where">
                <select className={IN} aria-label="Filter column" value={d.map.filterCol} onChange={(ev) => setMap({ filterCol: ev.target.value, filterVal: "" })}>
                  <option value="">every row</option>{cats.map((c) => <option key={c}>{c}</option>)}
                </select>
                {d.map.filterCol ? <>is <select className={cn(IN, "max-w-[300px]")} aria-label="Filter value" value={d.map.filterVal}
                  onChange={(ev) => { const v = ev.target.value; setD((x) => ({ ...x, map: { ...x.map, filterVal: v }, name: v && (!x.name.trim() || x.name === t.name.replace(/\.[^.]+$/, "")) ? `${t.name.replace(/\.[^.]+$/, "")} · ${v}` : x.name })); }}>
                  <option value="">pick a value…</option>{t.prof[d.map.filterCol]!.top.map(([v, n]) => <option key={v} value={v}>{v} · {fmt(n)} rows</option>)}
                </select></> : null}
              </Row>
              <Row label="Period">
                <input className={IN} type="date" aria-label="From" value={d.map.from} onChange={(ev) => setMap({ from: ev.target.value })} /> to
                <input className={IN} type="date" aria-label="To" value={d.map.to} onChange={(ev) => setMap({ to: ev.target.value })} />
                <span className="text-[11px] text-ink-faint">blank keeps every day</span>
              </Row>
              <Row label="">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={d.map.cumulative} onChange={(ev) => setMap({ cumulative: ev.target.checked })} />The counts are cumulative</label>
                <label className="ml-3 inline-flex items-center gap-1.5"><input type="checkbox" checked={d.map.sumSameDay} onChange={(ev) => setMap({ sumSameDay: ev.target.checked })} />Add up the rows of the same day</label>
              </Row>
            </>
          ) : (
            <>
              <textarea className={cn(IN, "h-24 w-full py-1 font-mono")} aria-label="Pasted series" value={d.csv} placeholder={"date,count\n2021-12-05,4\n2021-12-06,6"} onChange={(ev) => set({ csv: ev.target.value })} />
              <Row><button type="button" className={BTN_SM} onClick={() => set({ csv: ex.csv, pop: String(ex.population), name: d.name || `Omicron as ${ex.region.replace(/^\d+ - /, "")} lived it` })}>Fill with an example: {ex.region}, {ex.wave}</button></Row>
            </>
          )}
          <Row label="Population counted"><input className={cn(IN, "w-28")} type="number" min={1} step={1} aria-label="Population counted" value={d.pop} onChange={(ev) => set({ pop: ev.target.value })} /> residents <span className="text-[11px] text-ink-faint">the people these counts come from</span></Row>
          <Row label="They arrive as">
            {tw.severities.length ? <Seg label="Severity" value={d.sev} onChange={(v) => set({ sev: v })} options={tw.severities.map((v) => ({ v, label: v }))} /> : <span className="text-[11px] text-warn-ink">this twin names no severity</span>}
            <label className="ml-2 inline-flex items-center gap-1.5"><input type="checkbox" checked={d.smooth} onChange={(ev) => set({ smooth: ev.target.checked })} />Smooth over 7 days</label>
          </Row>
        </>
      ) : null}

      {mode === "exposure" ? (
        <>
          <p className={HELP}>What the air did, day by day, and the published effect it has. The usual rate can stay empty: it will be asked for when the profile is used.</p>
          <Row label="Effect">
            <select className={cn(IN, "max-w-[420px]")} aria-label="Effect" value={d.coef} onChange={(ev) => set({ coef: ev.target.value })}>
              {EXPOSURES.filter((e) => e.kind === "rr" && e.key !== "custom").map((e) => <option key={e.key} value={e.key}>{e.group} · {e.short} (×{e.rr})</option>)}
            </select>
          </Row>
          <Row label="Rise, day by day"><input className={cn(IN, "w-[240px]")} type="text" aria-label="Rise, day by day" value={d.series} placeholder="35 80 120 60" onChange={(ev) => set({ series: ev.target.value })} /> {EXP.get(d.coef)!.unit}</Row>
          <Row label="Usual rate"><input className={cn(IN, "w-24")} type="number" min={0} step="any" aria-label="Usual rate" value={d.usual} onChange={(ev) => set({ usual: ev.target.value })} /> {EXP.get(d.coef)!.outcome} a day per 1,000 <span className="text-[11px] text-ink-faint">optional</span></Row>
        </>
      ) : null}

      {mode === "event" && items ? (
        <>
          <p className={HELP}>Keep the changes of the event you are building, as a profile anyone can drop into another event. Their days are kept relative to the first one.</p>
          {items.length ? (
            <div className="flex flex-col gap-1 rounded border border-line-soft bg-white p-1.5">
              {items.map((it) => (
                <label key={it.key} className="flex items-start gap-1.5 text-[11.5px] text-ink-body">
                  <input type="checkbox" className="mt-0.5" checked={picked.includes(it.key)} onChange={(ev) => set({ picked: ev.target.checked ? [...picked, it.key] : picked.filter((k) => k !== it.key) })} />
                  <span>{plain(sentenceOf(it, tw, ctx))}</span>
                </label>
              ))}
            </div>
          ) : <p className="text-[11.5px] text-warn-ink">The current event has no change yet.</p>}
        </>
      ) : null}

      <Row label="Name"><input className={cn(IN, "w-[320px]")} type="text" aria-label="Profile name" value={d.name} placeholder="What it is, in a few words" onChange={(ev) => set({ name: ev.target.value })} /></Row>

      {"notes" in draft && draft.notes ? draft.notes.map((n) => <p key={n} className={HELP}>{n}</p>) : null}
      {"error" in draft && draft.error ? <p className="text-[11.5px] text-warn-ink">{draft.error}</p> : null}
      {"ok" in draft && mode === "data" && "curve" in draft && draft.curve ? (
        <>
          <CurveChart c={{ kind: "curve", curves: { low: draft.curve, central: draft.curve, high: draft.curve }, days: draft.curve.length, from: draft.rows![0]![0], tests: [], icu: null }} label="per 1,000 residents, a day" />
          <p className={HELP}>{draft.rows!.length} days, {sig(draft.total!)} per 1,000 residents in all. Applied to the whole twin ({fmt(tw.popTotal)} residents): about {fmt((draft.total! * tw.popTotal) / 1000)} arrivals as {d.sev}.</p>
        </>
      ) : null}
      {"ok" in draft && mode === "exposure" && "nums" in draft && draft.nums && draft.c ? (
        <p className={HELP}>At the highest day (+{sig(Math.max(...draft.nums))} {draft.c.unit}): ×{sig(Math.pow(draft.c.rr!, Math.max(...draft.nums) / draft.c.per))} the usual rate of {draft.c.outcome}.</p>
      ) : null}
      {"ok" in draft && mode === "event" && "kept" in draft && draft.kept ? <p className={HELP}>{draft.kept.length} change{draft.kept.length === 1 ? "" : "s"} kept.</p> : null}
      {err ? <p className="text-[11.5px] text-danger">{err}</p> : null}
      <Row><button type="button" className={BTN_P} disabled={!("ok" in draft) || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save the profile"}</button></Row>
    </div>
  );
}

/* ---------- the catalogue ---------- */

export default function ProfileCatalogue({ env, tw, ctx, mode, focus = null, items = null, onUse, onStartNew, onClose }: {
  env: string; tw: BuilderTwin; ctx: Ctx; mode: "pick" | "page"; focus?: string | null; items?: Item[] | null;
  onUse?: (p: Profile) => void; onStartNew?: (p: Profile) => void; onClose?: () => void;
}) {
  const [saved, setSaved] = useState<SavedProfile[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<ProfileType | "all">("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { profiles } = await listSimProfiles(env);
      setSaved(profiles.map(toSaved).filter((s): s is SavedProfile => !!s));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [env]);
  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => [...BUILT_IN, ...saved.map(profileFromSaved)], [saved]);
  useEffect(() => {
    if (sel) return;
    const f = focus ? all.find((p) => p.id === focus || p.curveKey === focus) : null;
    setSel(f?.id ?? all[0]?.id ?? null);
  }, [all, focus, sel]);

  const needle = q.trim().toLowerCase();
  const keep = all.filter((p) => (type === "all" || p.type === type) && (!needle || `${p.name} ${p.summary} ${p.desc} ${p.type}`.toLowerCase().includes(needle)));
  const selected = all.find((p) => p.id === sel) ?? null;

  async function remove(p: Profile) {
    if (!window.confirm(`Delete the profile “${p.name}”? Events already built with it keep their changes. This cannot be undone.`)) return;
    try { await deleteSimProfile(env, p.id); setSel(null); await load(); } catch (e) { setLoadError((e as Error).message); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2">
        <BookOpen className="h-4 w-4 text-ink-faint" />
        <h1 className="text-sm font-semibold text-ink">Profiles</h1>
        <span className="text-[11.5px] text-ink-faint">{all.length} profiles{mode === "pick" ? " · pick one to add it to the event you are writing" : ""}</span>
        <Seg label="Type of profile" value={type} onChange={setType} options={PROFILE_TYPES.map(([v, l]) => ({ v, label: l }))} />
        <span className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2">
          <Search className="h-3.5 w-3.5 text-ink-faint" />
          <input type="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Smoke, COVID, flood…" aria-label="Search profiles" className="h-[26px] w-40 bg-transparent text-xs focus:outline-none" />
        </span>
        <button type="button" className={cn(BTN, "ml-auto")} onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" />Create a profile</button>
        {onClose ? <button type="button" className={BTN} onClick={onClose}><X className="h-3.5 w-3.5" />Back to the event</button> : null}
      </header>
      {loadError ? <p className="shrink-0 border-b border-warn-line bg-warn-soft px-4 py-1.5 text-[11.5px] text-warn-ink">Your saved profiles could not be loaded: {loadError}. The built-in ones are below.</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:overflow-hidden">
        <div className="min-h-0 p-4 lg:overflow-y-auto">
          {creating ? <Create env={env} tw={tw} ctx={ctx} items={items} onCancel={() => setCreating(false)} onSaved={async (id) => { setCreating(false); await load(); setSel(id); setType("all"); }} /> : null}
          {GROUPS.map(([t, title]) => {
            const ps = keep.filter((p) => p.type === t);
            if (!ps.length) return null;
            return (
              <section key={t} className="mb-4">
                <h4 className={cn(LBL, "mb-1.5")}>{title} · {ps.length}</h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {ps.map((p) => (
                    <button key={p.id} type="button" onClick={() => setSel(p.id)} aria-pressed={p.id === sel}
                      className={cn("flex flex-col gap-1 rounded-md border bg-white p-2.5 text-left", p.id === sel ? "border-brand ring-1 ring-brand/30" : "border-line hover:border-ink-ghost")}>
                      <span className="flex items-start gap-2"><b className="flex-1 text-[12.5px] font-semibold leading-snug text-ink">{p.name}</b><span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", TIER_CLS[p.tier] ?? "bg-canvas text-ink-muted")}>{p.tier}</span></span>
                      <Spark p={p} tw={tw} ctx={ctx} />
                      <span className="text-[11.5px] leading-snug text-ink-body">{p.summary}</span>
                      <span className="text-[11px] leading-snug text-ink-faint">{p.source} · {p.reliabilityShort}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          {!keep.length ? <p className={HELP}>No profile matches “{q}”.</p> : null}
          {!saved.length && !loadError && type === "mine" ? <p className={HELP}>You have not saved a profile yet. Create one from your data, from an exposure, or from an event.</p> : null}
        </div>
        <aside className="min-h-0 border-t border-line bg-white p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <Detail p={selected} tw={tw} ctx={ctx} mode={mode} onUse={onUse} onStartNew={onStartNew} onDelete={(p) => void remove(p)} />
        </aside>
      </div>
    </div>
  );
}
