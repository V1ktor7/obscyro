"use client";

/**
 * Editing an exposure: what the air, the heat or the water did, and the
 * published effect that turns it into arrivals. Or an observed episode,
 * replayed per 1,000 residents. Every field here is an input of the helper;
 * the arrivals it sends are recomputed from them on every change.
 */

import { cn } from "@/lib/cn";
import { staySteps } from "./engine";
import {
  base1000, coefOf, CURVES, EXP_GROUPS, EXPOSURES, hasRange, lagNote, riseSeries, setCoef, SRC,
  type Coef, type Exposure,
} from "./exposures";
import { fmt, sig, tidy, u1, uN, type Ctx } from "./format";
import type { ChipKey } from "./model";
import { PlacePicker } from "./EffectEditor";
import type { BuilderTwin } from "./twin";
import { BTN_SM, HELP, IN, NumIn, Row, Seg } from "./ui";

const toggle = (list: string[], v: string, on: boolean) => { const s = new Set(list); if (on) s.add(v); else s.delete(v); return Array.from(s); };

function Choice({ on, onClick, children, note }: { on: boolean; onClick: () => void; children: React.ReactNode; note?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("flex flex-col items-start rounded border px-2 py-1 text-left text-[11.5px] leading-tight",
        on ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-white text-ink-body hover:border-brand")}>
      {children}
      {note ? <small className="text-[10px] text-ink-faint">{note}</small> : null}
    </button>
  );
}

function Txt({ value, onChange, placeholder, width = 170, label }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number; label: string }) {
  return <input className={IN} type="text" style={{ width }} aria-label={label} value={value} placeholder={placeholder} onChange={(ev) => onChange(ev.target.value)} />;
}

function Source({ c }: { c: Coef }) {
  const s = c.src ? SRC[c.src] : null;
  if (!s) return null;
  return <> Source: {s.url ? <a className="text-brand-deep underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.cite}</a> : s.cite}.</>;
}

function CoefCard({ x, c, change }: { x: Exposure; c: Coef; change: (fn: () => void) => void }) {
  if (x.coef === "custom") {
    const u = x.custom;
    return (
      <>
        <Row label="Exposure"><Txt label="Exposure" value={u.agent} placeholder="PM2.5" onChange={(v) => change(() => { u.agent = v; })} /> measured in <Txt label="Unit" width={80} value={u.unit} placeholder="µg/m³" onChange={(v) => change(() => { u.unit = v; })} /></Row>
        <Row label="Outcome"><Txt label="Outcome" width={260} value={u.outcome} placeholder="asthma ER visits" onChange={(v) => change(() => { u.outcome = v; })} /></Row>
        <Row label="Relative risk">
          <NumIn label="Relative risk" value={u.rr} min={0} onChange={(n) => change(() => { u.rr = n; })} /> per <NumIn label="Increment" value={u.per} min={0} onChange={(n) => change(() => { u.per = n; })} /> {u.unit}
          <span className="text-[11px] text-ink-faint">95 % CI</span>
          <NumIn label="Lower bound" value={u.lo} min={0} onChange={(n) => change(() => { u.lo = n; })} /> to <NumIn label="Upper bound" value={u.hi} min={0} onChange={(n) => change(() => { u.hi = n; })} />
        </Row>
        <Row label="Source"><Txt label="Source" width={360} value={u.source} placeholder="Authors, journal, year, setting" onChange={(v) => change(() => { u.source = v; })} /></Row>
        <p className={HELP}>A relative risk per increment, as a time-series or case-crossover study reports it. The helper scales it as RR^(rise ÷ increment), the way those studies model it.</p>
      </>
    );
  }
  return (
    <p className={HELP}>
      {c.kind === "rr" ? <><b className="text-ink">×{c.rr}</b> (95 % CI {c.lo} to {c.hi}) per {c.per} {c.unit} of {c.agent}, for {c.outcome}. Measured in {c.setting}; exposure {c.avg === 2 ? "averaged over the day and the day before" : "on a single day"}.</> : null}
      {c.kind === "abs" ? <><b className="text-ink">+{c.value}</b> {c.outcome} a day per 1,000 residents on the hottest 5 % of days.</> : null}
      {c.kind === "attack" ? "No coefficient: you say how many fall ill and how many of them come to the ER." : null}
      <Source c={c} />
    </p>
  );
}

/** The rate the rise multiplies the usual rate by, written next to the field while it is typed. */
function RateHint({ x, c, tw }: { x: Exposure; c: Coef; tw: BuilderTwin }) {
  const s = x.where.mode === "each" ? tw.pops.map((p) => Number(x.where.each[p.id]) || 0) : riseSeries(x) || [];
  const top = s.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  if (!(c.rr! > 0 && c.per > 0 && top)) return null;
  return (
    <p className={HELP}>
      At {top >= 0 ? "+" : "−"}{sig(Math.abs(top))} {c.unit}: <b className="text-ink">×{sig(Math.pow(c.rr!, top / c.per))}</b> the usual rate
      {c.lo != null && c.hi != null && c.lo > 0 ? ` (95 % range ×${sig(Math.pow(c.lo, top / c.per))} to ×${sig(Math.pow(c.hi, top / c.per))})` : ""}
      {(c.avg || 1) === 2 ? ", before the averaging with the day before" : ""}.
    </p>
  );
}

function CurveEditor({ x, k, c, ctx, change, onOpenProfile }: { x: Exposure; k: ChipKey; c: Coef; ctx: Ctx; change: (fn: () => void) => void; onOpenProfile?: (key: string) => void }) {
  if (k === "what") {
    const curves = Array.from(CURVES.values());
    return (
      <div className="flex flex-col gap-2">
        <Row label="Observed episodes" top>
          <span className="flex flex-wrap gap-1">
            {curves.map((p) => (
              <Choice key={p.key} on={p.key === x.coef} note={p.totals ? `${sig(p.totals.central)} / 1,000` : undefined}
                onClick={() => change(() => { x.coef = p.key; x.days = p.days ?? x.days; x.sev = p.sev ?? x.sev; x.version = "central"; })}>
                {p.agent} · {p.short}
              </Choice>
            ))}
          </span>
        </Row>
        <p className={HELP}>
          {c.outcome} a day per 1,000 residents{c.from ? `, as ${c.regionsN} regions lived it from ${c.from} to ${c.to}` : ""}.{" "}
          {onOpenProfile ? <button type="button" className={BTN_SM} onClick={() => onOpenProfile(x.coef)}>Open in the catalogue</button> : null}
        </p>
      </div>
    );
  }
  if (k === "rise") {
    const has = hasRange(c);
    const versions = (has ? ["low", "central", "high"] : ["central"]) as Exposure["version"][];
    return (
      <div className="flex flex-col gap-2">
        <Row label="Version">
          <Seg label="Version" value={x.version} onChange={(v) => change(() => { x.version = v; })}
            options={versions.map((v) => ({ v, label: `${v} · ${sig(c.totals?.[v] ?? 0)} per 1,000` }))} />
        </Row>
        <Row label="Scale">× <NumIn label="Scale" value={x.scale} min={0} step={0.05} onChange={(n) => change(() => { if (n != null && n > 0) x.scale = n; })} /><span className="text-[11px] text-ink-faint">1 is the episode as it was</span></Row>
        <p className={HELP}>{has ? "Low and high are the 10th and 90th percentile of the regions, day by day: the spread a territory can expect. " : ""}Scale it only with a reason (an older territory, a milder variant), and write the reason in the event’s description.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Row label="Starts on">{u1(ctx)} <NumIn label="Start" value={x.start} min={0} step={1} onChange={(n) => change(() => { if (n != null && n >= 0) x.start = Math.round(n); })} /><span className="text-[11px] text-ink-faint">and lasts {c.days} {uN(ctx)}, as the episode did</span></Row>
      <p className={HELP}>Day 0 of the profile is {c.from ? `${c.from}, the start of the episode` : "the first row of the series"}. A territory far from where it began can be reached weeks later: move the start rather than the shape.</p>
    </div>
  );
}

export default function ExposureEditor({ x, k, tw, ctx, change, onOpenProfile }: {
  x: Exposure; k: ChipKey; tw: BuilderTwin; ctx: Ctx; change: (fn: () => void) => void; onOpenProfile?: (key: string) => void;
}) {
  const c = coefOf(x);
  if (c.kind === "curve" && (k === "what" || k === "rise" || k === "when")) return <CurveEditor x={x} k={k} c={c} ctx={ctx} change={change} onOpenProfile={onOpenProfile} />;
  const body: React.ReactNode[] = [];

  if (k === "what") {
    body.push(...EXP_GROUPS.map((g) => (
      <Row key={g} label={g} top>
        <span className="flex flex-wrap gap-1">
          {EXPOSURES.filter((e) => e.group === g).map((e) => (
            <Choice key={e.key} on={e.key === x.coef} note={e.kind === "rr" && e.rr ? `×${e.rr}` : undefined} onClick={() => change(() => setCoef(x, tw, e.key))}>{e.short}</Choice>
          ))}
        </span>
      </Row>
    )));
    body.push(<CoefCard key="card" x={x} c={c} change={change} />);
  }

  if (k === "rise") {
    if (c.kind === "abs") {
      body.push(
        <Row key="a" label="Adds"><NumIn label="Arrivals added" value={x.abs} onChange={(n) => change(() => { x.abs = n ?? 0; })} /> {c.outcome} a {u1(ctx)} per 1,000 residents</Row>,
        <p key="b" className={HELP}>{c.value} is the published figure. Change it only with a source.</p>,
      );
    } else if (c.kind === "attack") {
      body.push(
        <Row key="a" label="Fall ill"><NumIn label="Share who fall ill" value={x.attack.ill} min={0} max={100} onChange={(n) => change(() => { x.attack.ill = n ?? 0; })} /> % of the residents of the territories supplied</Row>,
        <Row key="b" label="Come to the ER"><NumIn label="Share who come to the ER" value={x.attack.er} min={0} max={100} onChange={(n) => change(() => { x.attack.er = n ?? 0; })} /> % of those who fall ill</Row>,
        <p key="c" className={HELP}>Both are your assumptions: from the outbreak investigation if there is one, otherwise a range you are willing to defend.</p>,
      );
    } else if (x.where.mode === "each") {
      body.push(<p key="a" className={HELP}>Each territory has its own reading: set them under where.</p>, <RateHint key="b" x={x} c={c} tw={tw} />);
    } else {
      body.push(
        <Row key="a" label={c.agent || "Exposure"}>
          <Seg label="How the rise is given" value={x.rise.mode} onChange={(v) => change(() => {
            if (v === "series" && !String(x.rise.series).trim()) x.rise.series = Array.from({ length: Math.max(1, x.days) }, () => String(tidy(x.rise.value || 0))).join(" ");
            x.rise.mode = v;
          })} options={[{ v: "same", label: `Same every ${u1(ctx)}` }, { v: "series", label: `${u1(ctx)[0]!.toUpperCase()}${u1(ctx).slice(1)} by ${u1(ctx)}` }]} />
        </Row>,
      );
      if (x.rise.mode === "same") {
        body.push(
          <Row key="b" label="Rises by">
            <NumIn label="Rise" value={x.rise.value} onChange={(n) => change(() => { x.rise.value = n ?? 0; x.rise.usual = null; x.rise.episode = null; })} /> {c.unit}
            <span className="text-[11px] text-ink-faint">above its usual level; negative for cleaner air</span>
          </Row>,
          <Row key="c" label="From readings">
            usual <NumIn label="Usual level" value={x.rise.usual} min={0} onChange={(n) => change(() => { x.rise.usual = n; if (x.rise.usual != null && x.rise.episode != null) x.rise.value = tidy(x.rise.episode - x.rise.usual); })} />
            during the episode <NumIn label="Level during the episode" value={x.rise.episode} min={0} onChange={(n) => change(() => { x.rise.episode = n; if (x.rise.usual != null && x.rise.episode != null) x.rise.value = tidy(x.rise.episode - x.rise.usual); })} /> {c.unit}
          </Row>,
        );
      } else {
        body.push(
          <Row key="b" label="Rises by">
            <input className={cn(IN, "w-[260px]")} type="text" aria-label="Rise, one value per step" value={x.rise.series} placeholder="40 90 130 70" onChange={(ev) => change(() => { x.rise.series = ev.target.value; })} /> {c.unit}, one value per {u1(ctx)}
          </Row>,
          <p key="c" className={HELP}>Separate the values with spaces or semicolons; “12,5” is read as 12.5. Daily averages, the way the study measured them.</p>,
        );
      }
      if (x.where.mode === "near") body.push(<p key="d" className={HELP}>This is the rise at the source; it fades with distance under where.</p>);
      body.push(<RateHint key="e" x={x} c={c} tw={tw} />);
    }
  }

  if (k === "where") {
    const opts: { v: Exposure["where"]["mode"]; label: string }[] = [{ v: "all", label: `Every territory · ${fmt(tw.popTotal)} residents` }, { v: "some", label: "Some territories" }];
    if (c.kind === "rr") opts.push({ v: "each", label: "A reading per territory" }, { v: "near", label: "Fading from a place" });
    const pops = [...tw.pops].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    body.push(
      <Row key="a" label="Where">
        <Seg label="Where" value={x.where.mode} options={opts} onChange={(v) => change(() => {
          const r = Math.max(0, ...(riseSeries(x) || [0]));
          x.where.mode = v;
          if (v === "each" && !Object.keys(x.where.each).length && r) for (const p of tw.pops) x.where.each[p.id] = r;
        })} />
      </Row>,
    );
    if (x.where.mode === "some") {
      body.push(
        <div key="b" className="grid max-h-56 grid-cols-1 gap-x-3 overflow-y-auto rounded border border-line-soft bg-white p-1.5 sm:grid-cols-2">
          {pops.map((p) => (
            <label key={p.id} className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px] hover:bg-canvas">
              <input type="checkbox" checked={x.where.pops.includes(p.id)} onChange={(ev) => change(() => { x.where.pops = toggle(x.where.pops, p.id, ev.target.checked); })} />
              <span className="min-w-0 flex-1 truncate text-ink-body" title={p.name}>{p.name}</span>
              <em className="not-italic tabular-nums text-ink-faint">{fmt(p.size)}</em>
            </label>
          ))}
        </div>,
        <p key="c" className={HELP}>Or click territories on the map.</p>,
      );
    }
    if (x.where.mode === "each") {
      body.push(
        <div key="b" className="grid max-h-72 grid-cols-1 gap-x-3 overflow-y-auto rounded border border-line-soft bg-white p-1.5 sm:grid-cols-2">
          {pops.map((p) => (
            <label key={p.id} className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate text-ink-body" title={p.name}>{p.name}</span>
              <NumIn label={`Rise in ${p.name}`} width={64} value={x.where.each[p.id] ?? null} onChange={(n) => change(() => { if (n != null) x.where.each[p.id] = n; else delete x.where.each[p.id]; })} />
              <span className="text-ink-faint">{c.unit}</span>
            </label>
          ))}
        </div>,
        <p key="c" className={HELP}>The rise in each territory over the episode: from your stations, the one nearest the territory or the mean of those inside it. Blank is no change there.</p>,
      );
    }
    if (x.where.mode === "near") {
      body.push(
        <Row key="b" label="From"><PlacePicker tw={tw} at={x.where.at} onPick={(at) => change(() => { x.where.at = at; })} /></Row>,
        <Row key="c" label="Fades to nothing at"><NumIn label="Radius in km" value={x.where.radius} min={1} step={1} onChange={(n) => change(() => { if (n != null && n > 0) x.where.radius = n; })} /> km</Row>,
        <p key="d" className={HELP}>The rise you enter is at the source; a territory halfway to the edge gets half of it. That fade is an assumption, not a dispersion model.</p>,
      );
    }
  }

  if (k === "when") {
    if (c.kind === "attack") {
      body.push(
        <Row key="a" label="Contaminated on">{u1(ctx)} <NumIn label="Start" value={x.start} min={0} step={1} onChange={(n) => change(() => { if (n != null && n >= 0) x.start = Math.round(n); })} /></Row>,
        <Row key="b" label="Incubation"><NumIn label="Incubation" value={x.lag} min={0} step={1} onChange={(n) => change(() => { if (n != null && n >= 0) x.lag = Math.round(n); })} /> {uN(ctx)} <span className="text-[11px] text-ink-faint">depends on the pathogen: from what was found</span></Row>,
        <Row key="c" label="Arrivals spread over"><NumIn label="Spread" value={x.attack.spread} min={1} step={1} onChange={(n) => change(() => { if (n != null && n >= 1) x.attack.spread = Math.round(n); })} /> {uN(ctx)}</Row>,
      );
    } else {
      const D = (riseSeries(x) || []).length, series = c.kind === "rr" && x.rise.mode === "series" && x.where.mode !== "each";
      body.push(
        <Row key="a" label="Starts on">
          {u1(ctx)} <NumIn label="Start" value={x.start} min={0} step={1} onChange={(n) => change(() => { if (n != null && n >= 0) x.start = Math.round(n); })} />
          {series
            ? <span className="text-[11px] text-ink-faint">and lasts {D} {D === 1 ? u1(ctx) : uN(ctx)}, one per value</span>
            : <>for <NumIn label="Length" value={x.days} min={1} step={1} onChange={(n) => change(() => { if (n != null && n >= 1) x.days = Math.round(n); })} /> {uN(ctx)}</>}
        </Row>,
        <Row key="b" label="Felt"><NumIn label="Lag" value={x.lag} min={0} step={1} onChange={(n) => change(() => { if (n != null && n >= 0) x.lag = Math.round(n); })} /> {uN(ctx)} later <span className="text-[11px] text-ink-faint">{lagNote(x, c)}</span></Row>,
      );
      if (x.coef === "custom") {
        body.push(
          <Row key="c" label="Exposure measured">
            <Seg label="Averaging" value={String(x.avg)} onChange={(v) => change(() => { x.avg = Number(v); })} options={[{ v: "1", label: "On the day" }, { v: "2", label: "Averaged with the day before" }]} />
          </Row>,
        );
      }
    }
  }

  if (k === "base" && c.kind === "rr") {
    const b = base1000(x, tw);
    body.push(
      <Row key="a" label="Usually">
        <NumIn label="Usual rate" value={x.base.value} min={0} onChange={(n) => change(() => { x.base.value = n; })} /> {c.outcome}
        <Seg label="Unit of the usual rate" value={x.base.unit} onChange={(v) => change(() => { x.base.unit = v; })}
          options={[{ v: "day1000", label: `a ${u1(ctx)} per 1,000 residents` }, { v: "all", label: `a ${u1(ctx)} across every territory` }, { v: "year1000", label: "a year per 1,000 residents" }]} />
      </Row>,
      b == null ? null : <p key="b" className={HELP}>= {sig(b)} per 1,000 a {u1(ctx)}, about {sig((b * tw.popTotal) / 1000)} a {u1(ctx)} across the twin ({fmt(tw.popTotal)} residents).</p>,
      <Row key="c" label="Source"><input className={cn(IN, "w-full max-w-[520px]")} type="text" aria-label="Source of the usual rate" value={x.base.source} placeholder="Where this number comes from" onChange={(ev) => change(() => { x.base.source = ev.target.value; })} /></Row>,
      <p key="d" className={HELP}>None of this twin’s files carry it: it comes from your ER data, for {c.outcome} only.{c.base === "asthma" ? <> Order of magnitude only: in Ontario in 2006, adults made 1.7 to 10.1 asthma ER visits a year per 1,000 and children 8.7 to 25.2, depending on the region (<a className="text-brand-deep underline" href={SRC.ontario!.url ?? undefined} target="_blank" rel="noopener noreferrer">{SRC.ontario!.cite}</a>).</> : null}</p>,
    );
  }

  if (k === "who") {
    body.push(
      <Row key="a" label="Arrive as">
        <Seg label="Severity" value={x.sev} onChange={(v) => change(() => { x.sev = v; })} options={tw.severities.map((v) => ({ v, label: v }))} />
      </Row>,
      <p key="b" className={HELP}>{tw.protocols.map((p) => `${p.severity} holds one ${p.resource ?? "unit"}${p.stay != null ? ` for ${staySteps(p.stay)} ${staySteps(p.stay) === 1 ? u1(ctx) : uN(ctx)}` : ""}`).join("; ")}{tw.protocols.length ? "." : "This twin declares no care protocol."}</p>,
    );
  }

  return <div className="flex flex-col gap-2">{body}</div>;
}
