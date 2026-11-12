"use client";

/**
 * Editing one part of a plain change: the part whose chip was clicked. Every
 * control writes straight into the SimEffect the engine will receive, through
 * the same words the sentence uses ("drops by 30 %" is a multiply by 0.7).
 */

import { useState } from "react";

import type { SimEffect, SimTarget } from "@/lib/platform-api";
import { cn } from "@/lib/cn";
import { distanceKm, magnitudeAt, staySteps } from "./engine";
import { clamp, fmt, sig, tidy, u1, uN, type Ctx } from "./format";
import {
  amountOf, defaultPoint, fam, isText, modeOf, opsFor, propOf, scopeOf, setAmount, typeOf, unitOf,
  type ChipKey, type FormMemory, type Mode,
} from "./model";
import { readsUnavailable, type BuilderTwin, type BType } from "./twin";
import { BTN_SM, HELP, IN, NumIn, Row, Seg } from "./ui";

export const MECHANIC: Record<string, string> = {
  serves_severity: "names the severity this row describes",
  occupies_for: "how many steps one unit of demand holds what it consumes",
  consumes_activity: "names what it draws on",
  consumes_amount: "how much of that it draws, per unit per step",
  scales_incidence: "how many people this covers, for an incidence to be multiplied by",
  dies_without: "how long someone can wait without it",
};

const sortByName = <T extends { name: string }>(a: T[]) => [...a].sort((x, y) => x.name.localeCompare(y.name, "fr"));
const toggle = (list: string[], v: string, on: boolean) => { const s = new Set(list); if (on) s.add(v); else s.delete(v); return Array.from(s); };
function setSelect(e: SimEffect, dim: keyof SimEffect["select"], list: string[]) {
  if (list.length) (e.select as Record<string, string[]>)[dim] = list;
  else delete (e.select as Record<string, string[]>)[dim];
}

export function ShapeIcon({ shape }: { shape: SimEffect["profile"]["shape"] }) {
  const p = { start: 0, end: 20, shape, peak: 1 };
  let d = "M0,17";
  for (let t = 0; t <= 20; t++) { const y = 17 - magnitudeAt(p, t) * 15; d += ` L${t * 2},${y.toFixed(1)} L${t * 2 + 2},${y.toFixed(1)}`; }
  return <svg width="46" height="18" viewBox="0 0 42 18" aria-hidden="true"><path d={`${d} L42,17`} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

/** A row of toggle buttons for values, each with an optional note underneath. */
function Vals({ items, on, onPick }: { items: { v: string; label: string; note?: string }[]; on: (v: string) => boolean; onPick: (v: string) => void }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((o) => (
        <button key={o.v} type="button" aria-pressed={on(o.v)} onClick={() => onPick(o.v)}
          className={cn("flex flex-col items-start rounded border px-2 py-1 text-left font-mono text-[11.5px] leading-tight",
            on(o.v) ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-white text-ink-body hover:border-brand")}>
          {o.label}
          {o.note ? <small className="font-sans text-[10px] text-ink-faint">{o.note}</small> : null}
        </button>
      ))}
    </span>
  );
}

function Checks<T extends { id: string; name: string }>({ list, checked, onToggle, extra, filter }: { list: T[]; checked: (id: string) => boolean; onToggle: (id: string, on: boolean) => void; extra: (t: T) => string; filter?: string }) {
  const q = (filter ?? "").trim().toLowerCase();
  return (
    <div className="grid max-h-56 grid-cols-1 gap-x-3 overflow-y-auto rounded border border-line-soft bg-white p-1.5 sm:grid-cols-2">
      {list.filter((t) => !q || t.name.toLowerCase().includes(q)).map((t) => (
        <label key={t.id} className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px] hover:bg-canvas">
          <input type="checkbox" checked={checked(t.id)} onChange={(ev) => onToggle(t.id, ev.target.checked)} />
          <span className="min-w-0 flex-1 truncate text-ink-body" title={t.name}>{t.name}</span>
          <em className="not-italic tabular-nums text-ink-faint">{extra(t)}</em>
        </label>
      ))}
    </div>
  );
}

/** The point a change starts from: one of the twin's sites, or wherever was clicked on the map. */
export function PlacePicker({ tw, at, onPick }: { tw: BuilderTwin; at: [number, number]; onPick: (at: [number, number]) => void }) {
  const here = tw.sites.find((s) => distanceKm(at, s.loc) < 0.15);
  return (
    <>
      <select className={cn(IN, "max-w-[300px]")} aria-label="Starting point" value={here?.id ?? ""} onChange={(ev) => { const s = tw.siteById.get(ev.target.value); if (s) onPick(s.loc); }}>
        <option value="">{here ? "" : `A point (${at[0].toFixed(3)}, ${at[1].toFixed(3)})`}</option>
        {sortByName(tw.sites).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <span className="text-[11px] text-ink-faint">or click anywhere on the map</span>
    </>
  );
}

function ReachRow({ e, mem, change }: { e: SimEffect; mem: FormMemory; change: (fn: () => void) => void }) {
  const mode = e.reach == null ? mem.reach || "all" : e.reach < 1 ? "share" : "count";
  return (
    <Row label="How many">
      <Seg label="How many objects" value={mode} onChange={(v) => change(() => { mem.reach = v; e.reach = v === "all" ? null : v === "share" ? 0.25 : 10; })}
        options={[{ v: "all", label: "All of them" }, { v: "share", label: "A share" }, { v: "count", label: "A number" }]} />
      {mode === "share" ? <><NumIn label="Share in percent" value={e.reach == null ? 100 : tidy(e.reach * 100)} min={1} max={100} step={1} onChange={(n) => change(() => { if (n != null && n > 0) e.reach = n >= 100 ? null : tidy(n / 100); })} /> %</> : null}
      {mode === "count" ? <NumIn label="Number of objects" value={e.reach == null ? 1 : Math.trunc(e.reach)} min={1} step={1} onChange={(n) => change(() => { if (n != null && n >= 1) e.reach = Math.trunc(n); })} /> : null}
    </Row>
  );
}

export default function EffectEditor({ e, mem, k, tw, ctx, targets, change }: {
  e: SimEffect; mem: FormMemory; k: ChipKey; tw: BuilderTwin; ctx: Ctx; targets: SimTarget[]; change: (fn: () => void) => void;
}) {
  const [siteQ, setSiteQ] = useState("");
  const f = fam(e), def = propOf(tw, e), T = typeOf(tw, e);
  const body: React.ReactNode[] = [];

  if (k === "what") {
    if (f === "arrivals") {
      body.push(
        <Row key="a" label="Counted">
          <Seg label="How arrivals are counted" value={e.target} onChange={(v) => change(() => { e.target = v; })}
            options={[{ v: "demand.incidence", label: "Per 1,000 residents" }, { v: "demand.volume", label: "As a flat number" }]} />
        </Row>,
        <p key="b" className={HELP}>{e.target === "demand.incidence"
          ? "Each territory generates arrivals in proportion to its own population. This is what something spreading through a population does."
          : "The same count in each selected territory, whatever its size: a coach crash brings forty people whoever lives nearby."}</p>,
      );
    } else if (f === "capacity") {
      const cur = (e.select.activity || [])[0] || "";
      body.push(
        <Row key="a" label="Which resource" top>
          <Seg label="Resource" value={cur} onChange={(v) => change(() => setSelect(e, "activity", v ? [v] : []))}
            options={[{ v: "", label: "Everything a site has" }, ...tw.activities.map((a) => ({ v: a.id, label: <><code className="font-mono">{a.id}</code> · {fmt(a.total)}</> }))]} />
        </Row>,
        <p key="b" className={HELP}>Capacity is how much of something a site has at all. It is rebuilt from its baseline on every {u1(ctx)}, so a change never compounds.</p>,
      );
    } else if (f === "object" && T) {
      body.push(
        <Row key="a" label="Property" top>
          <Vals items={T.props.filter((p) => p.mechanic !== "scales_incidence").map((p) => ({ v: p.key, label: p.key, note: p.behaviour === "state" ? "switch" : p.behaviour ? "raise or lower" : "set only" }))}
            on={(v) => v === e.property_key}
            onPick={(v) => change(() => {
              const d = T.props.find((p) => p.key === v), arithmetic = opsFor(d?.behaviour).includes("multiply");
              e.property_key = v; e.op = arithmetic ? "multiply" : "set"; e.value = arithmetic ? 1 : d?.type === "number" ? 0 : "";
            })} />
        </Row>,
      );
      if (def) body.push(<p key="b" className={HELP}>{def.mechanic && MECHANIC[def.mechanic] ? `The engine reads this as ${MECHANIC[def.mechanic]}. ` : ""}{def.behaviour === "state" ? "Declared a state: it is switched, never calculated." : def.behaviour ? `Declared a ${def.behaviour}: it can be raised, lowered or set.` : "No behaviour is declared, so it can only be set."}</p>);
    }
  }

  if (k === "where") {
    if (f === "arrivals") {
      const some = (e.select.population || []).length > 0 || !!mem.pops;
      body.push(
        <Row key="a" label="Territories">
          <Seg label="Territories" value={some ? "some" : "all"} onChange={(v) => change(() => { mem.pops = v === "some"; if (v === "all") delete e.select.population; })}
            options={[{ v: "all", label: `Every territory · ${fmt(tw.popTotal)} residents` }, { v: "some", label: "Some territories" }]} />
        </Row>,
      );
      if (some) body.push(<Checks key="b" list={sortByName(tw.pops)} checked={(id) => (e.select.population || []).includes(id)} extra={(p) => fmt(p.size)}
        onToggle={(id, on) => change(() => setSelect(e, "population", toggle(e.select.population || [], id, on)))} />);
      body.push(<p key="c" className={HELP}>Arrivals belong to a territory, not to a point on the map: the engine refuses a radius here. Click a territory on the map to tick it.</p>);
    } else if (f === "object" && T && !T.placed) {
      body.push(<p key="a" className={HELP}>The {fmt(T.n)} <code className="font-mono">{T.name}</code> are attached to no site, so a change reaches them wherever it happens. The engine cannot address one of them by name: only all of them, or the first few by id.</p>);
      body.push(<ReachRow key="b" e={e} mem={mem} change={change} />);
    } else {
      const sc = scopeOf(e, mem);
      body.push(
        <Row key="a" label="Where">
          <Seg label="Where" value={sc} onChange={(v) => change(() => {
            mem.scope = v;
            if (v === "all") { delete e.select.facility; e.spatial = null; }
            if (v === "sites") e.spatial = null;
            if (v === "near") { delete e.select.facility; if (!e.spatial) e.spatial = { epicentre: defaultPoint(tw), radius_km: 5, falloff: "none", speed_km_per_step: null }; }
          })} options={[{ v: "all", label: "Everywhere" }, { v: "sites", label: "Some sites" }, { v: "near", label: "Around a place" }]} />
        </Row>,
      );
      if (sc === "sites") {
        const acts = f === "capacity" ? (e.select.activity || []) : [];
        const count = (id: string) => {
          const s = tw.siteById.get(id)!;
          if (f === "capacity") return (acts.length ? acts : Object.keys(s.capacity)).reduce((n, a) => n + (s.capacity[a] || 0), 0);
          return (tw.objectsByType.get(T?.name ?? "") ?? []).filter((o) => o.at === id).length;
        };
        const list = tw.sites.filter((s) => count(s.id) > 0);
        body.push(
          <Row key="b">
            <input className={cn(IN, "w-[200px]")} type="search" placeholder="Filter sites" aria-label="Filter sites" value={siteQ} onChange={(ev) => setSiteQ(ev.target.value)} />
            <span className="text-[11px] text-ink-faint">or click sites on the map · {fmt(list.length)} hold it</span>
          </Row>,
          <Checks key="c" list={sortByName(list)} filter={siteQ} checked={(id) => (e.select.facility || []).includes(id)} extra={(s) => fmt(count(s.id))}
            onToggle={(id, on) => change(() => setSelect(e, "facility", toggle(e.select.facility || [], id, on)))} />,
        );
      }
      if (sc === "near" && e.spatial) {
        const sp = e.spatial;
        body.push(
          <Row key="d" label="Starts at"><PlacePicker tw={tw} at={sp.epicentre} onPick={(at) => change(() => { sp.epicentre = at; })} /></Row>,
          <Row key="e" label="Reaches">
            <Seg label="Radius" value={sp.radius_km == null ? "none" : "km"} onChange={(v) => change(() => { sp.radius_km = v === "none" ? null : 5; if (v === "none") sp.falloff = "none"; })}
              options={[{ v: "km", label: "Up to" }, { v: "none", label: "No limit" }]} />
            {sp.radius_km == null ? null : <><NumIn label="Radius in km" value={sp.radius_km} min={0.5} step={0.5} onChange={(n) => change(() => { if (n != null && n > 0) sp.radius_km = n; })} /> km</>}
          </Row>,
          <Row key="f" label="Travels">
            <NumIn label="Speed in km per step" value={sp.speed_km_per_step || 0} min={0} step={0.5} onChange={(n) => change(() => { sp.speed_km_per_step = n != null && n > 0 ? n : null; })} /> km a {u1(ctx)}
            <span className="text-[11px] text-ink-faint">0 reaches the whole area at once, like a power cut</span>
          </Row>,
        );
        if (f === "capacity") {
          body.push(
            <Row key="g" label="Fades">
              <Seg label="Fade with distance" value={sp.falloff} onChange={(v) => change(() => { sp.falloff = v; if (v !== "none" && sp.radius_km == null) sp.radius_km = 5; })}
                options={[{ v: "none", label: "Not at all" }, { v: "linear", label: "Evenly, to nothing at the edge" }, { v: "steep", label: "Fast, close to the start" }]} />
            </Row>,
          );
        } else body.push(<p key="g" className={HELP}>Distance decides whether an object is written and when. It cannot weaken a switch, so there is no fade here.</p>);
      }
      if (f === "object") body.push(<ReachRow key="h" e={e} mem={mem} change={change} />);
    }
  }

  if (k === "change") {
    const mode = modeOf(e, mem);
    if (f === "arrivals") {
      const k1000 = ((e.select.population || []).length ? e.select.population!.reduce((n, id) => n + (tw.popById.get(id)?.size ?? 0), 0) : tw.popTotal) / 1000;
      body.push(
        <Row key="a" label="Arrivals">
          <Seg label="Direction" value={mode === "remove" ? "remove" : "add"} onChange={(v) => change(() => setAmount(e, mem, v, Number(amountOf(e))))}
            options={[{ v: "add" as Mode, label: "Rise by" }, { v: "remove" as Mode, label: "Fall by" }]} />
          <NumIn label="Amount" value={Number(amountOf(e))} min={0} onChange={(n) => change(() => setAmount(e, mem, modeOf(e, mem), n ?? NaN))} />
          {unitOf(ctx, tw, e)}
        </Row>,
        <p key="b" className={HELP}>{e.target === "demand.incidence" ? <>At full strength across the selected territories that is <b className="text-ink">{sig(Math.abs(Number(e.value)) * k1000)} arrivals a {u1(ctx)}</b>. </> : null}Arrivals only add up: there is no baseline to multiply, which is why a percentage is not offered.</p>,
      );
    } else if (isText(tw, e) && T) {
      const key = e.property_key ?? "";
      const seen = Array.from(new Set((tw.objectsByType.get(T.name) ?? []).map((o) => o.properties[key]).filter((v): v is string => typeof v === "string")));
      const status = !!T.role && tw.rules.unavailable_keys.includes(key);
      const offer = Array.from(new Set([...seen, ...(status && !seen.some((v) => readsUnavailable(tw, key, v)) ? [tw.rules.unavailable_values[0] ?? "unavailable"] : [])])).slice(0, 24);
      body.push(
        <Row key="a" label="Becomes" top>
          <Vals items={offer.map((v) => ({ v, label: v, note: status ? (readsUnavailable(tw, key, v) ? "out of service" : "free") : undefined }))} on={(v) => e.value === v} onPick={(v) => change(() => { e.op = "set"; e.value = v; })} />
          <input className={cn(IN, "w-[150px]")} type="text" placeholder="another value" aria-label="Another value" value={offer.includes(String(e.value)) ? "" : String(e.value ?? "")}
            onChange={(ev) => change(() => { e.op = "set"; e.value = ev.target.value; })} />
        </Row>,
        <p key="b" className={HELP}>{status ? <>The twin counts a <code className="font-mono">{T.name}</code> as out of service when its {key} is one of: {tw.rules.unavailable_values.join(", ")}. Any other word leaves it counted as free.</> : "A text value is switched on and off; it has no half."}</p>,
      );
    } else {
      const ops = f === "capacity" ? (targets.find((t) => t.path === e.target)?.ops ?? ["multiply", "add", "set"]) : opsFor(def?.behaviour);
      const unit = unitOf(ctx, tw, e);
      const why = "Not possible on this property: it can only be set";
      body.push(
        <Row key="a" label="Change">
          <Seg label="Kind of change" value={mode} onChange={(v) => change(() => setAmount(e, mem, v, v === "set" && typeof e.value !== "number" ? 0 : Number(amountOf(e))))}
            options={[
              { v: "lower" as Mode, label: "Drop by %", disabled: ops.includes("multiply") ? undefined : why },
              { v: "raise" as Mode, label: "Rise by %", disabled: ops.includes("multiply") ? undefined : why },
              { v: "add" as Mode, label: "Add", disabled: ops.includes("add") ? undefined : why },
              { v: "remove" as Mode, label: "Remove", disabled: ops.includes("add") ? undefined : why },
              { v: "set" as Mode, label: "Set to" },
            ]} />
          <NumIn label="Amount" value={Number(amountOf(e))} min={mode === "set" ? undefined : 0} onChange={(n) => change(() => setAmount(e, mem, modeOf(e, mem), n ?? NaN))} />
          {mode === "lower" || mode === "raise" ? "%" : unit}
        </Row>,
        <p key="b" className={HELP}>{f === "capacity"
          ? "When several changes meet on the same site, the engine applies “set” first, then percentages, then additions, whatever their order here."
          : def?.mechanic === "occupies_for" ? "The engine reads a stay in whole steps, and never less than one." : "The value is written at full strength for as long as the change is on."}</p>,
      );
    }
    if (f !== "object") {
      body.push(
        <Row key="s" label="Strength">
          <input type="range" min={5} max={100} step={5} aria-label="Strength" value={Math.round(clamp(e.profile.peak, 0.05, 1) * 100)}
            onChange={(ev) => change(() => { e.profile.peak = Number(ev.target.value) / 100; })} />
          <span className="tabular-nums">{Math.round(e.profile.peak * 100)} %</span>
          <span className="text-[11px] text-ink-faint">scales the whole change; the engine reads nothing above 100 %</span>
        </Row>,
      );
    }
  }

  if (k === "who") {
    const some = (e.select.acuity || []).length > 0 || !!mem.sevs;
    body.push(
      <Row key="a" label="Severity">
        <Seg label="Severity" value={some ? "some" : "all"} onChange={(v) => change(() => { mem.sevs = v === "some"; if (v === "all") delete e.select.acuity; })}
          options={[{ v: "all", label: "Every severity, split evenly" }, { v: "some", label: "Choose" }]} />
      </Row>,
    );
    if (some) body.push(
      <Row key="b" label="">
        {tw.severities.map((a) => (
          <label key={a} className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={(e.select.acuity || []).includes(a)} onChange={(ev) => change(() => setSelect(e, "acuity", toggle(e.select.acuity || [], a, ev.target.checked)))} />{a}
          </label>
        ))}
      </Row>,
    );
    body.push(<p key="c" className={HELP}>{tw.protocols.length
      ? <>The severities are the ones your care protocols name. A severity decides what a patient uses: {tw.protocols.map((p) => `${p.severity} holds one ${p.resource ?? "unit"}${p.stay != null ? ` for ${staySteps(p.stay)} ${staySteps(p.stay) === 1 ? u1(ctx) : uN(ctx)}` : ""}`).join("; ")}.</>
      : "This twin declares no care protocol, so a severity names nothing the engine can serve."}</p>);
  }

  if (k === "when") {
    const p = e.profile;
    if (f === "object") {
      body.push(
        <Row key="a" label="When">
          <Seg label="When" value={p.shape === "pulse" ? "pulse" : "step"} onChange={(v) => change(() => applyShape(e, ctx, v))}
            options={[{ v: "step" as const, label: "Throughout a period" }, { v: "pulse" as const, label: `For one ${u1(ctx)} only` }]} />
        </Row>,
      );
    } else {
      body.push(
        <div key="a" className="flex flex-wrap gap-1.5">
          {([["step", "Steady"], ["ramp", "Builds up"], ["pulse", `One ${u1(ctx)}`], ["gaussian", "Peaks and fades"]] as const).map(([s, l]) => (
            <button key={s} type="button" aria-pressed={p.shape === s} onClick={() => change(() => applyShape(e, ctx, s))}
              className={cn("flex flex-col items-center gap-0.5 rounded-md border px-2.5 py-1 text-[11px]", p.shape === s ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-white text-ink-body hover:border-brand")}>
              <ShapeIcon shape={s} />{l}
            </button>
          ))}
        </div>,
      );
    }
    body.push(
      <Row key="b" label={p.shape === "pulse" ? "On" : "From"}>
        {u1(ctx)} <NumIn label="Start" value={p.start} min={0} step={1} onChange={(n) => change(() => { if (n != null && n >= 0) { p.start = Math.round(n); if (p.shape === "pulse") p.end = p.start; } })} />
        {p.shape !== "pulse" ? (p.end == null
          ? <span className="text-[11px] text-ink-faint">with no end</span>
          : <>to {u1(ctx)} <NumIn label="End" value={p.end} min={0} step={1} onChange={(n) => change(() => { if (n != null && n >= 0) p.end = Math.round(n); })} /><span className="text-[11px] text-ink-faint">included</span></>) : null}
        {p.shape === "step" ? <button type="button" className={BTN_SM} onClick={() => change(() => { p.end = p.end == null ? Math.min(ctx.horizon - 1, p.start + Math.round(ctx.horizon / 3)) : null; })}>{p.end == null ? "Give it an end" : "No end"}</button> : null}
      </Row>,
    );
    if (p.shape === "gaussian" && f !== "object") {
      body.push(
        <Row key="c" label="Peak on">
          {u1(ctx)} <NumIn label="Peak" value={p.peak_tick ?? null} min={p.start} step={1} onChange={(n) => change(() => { if (n != null) p.peak_tick = Math.round(n); else delete p.peak_tick; })} />
          <span className="text-[11px] text-ink-faint">blank puts it in the middle ({sig((p.start + (p.end ?? p.start)) / 2)}); you can also drag the diamond on the timeline</span>
        </Row>,
      );
    }
    const say = f === "object" ? "An object is switched or it is not. The period decides when, never how strongly."
      : p.shape === "step" ? `Full strength on every ${u1(ctx)} of the period, both ends included.`
      : p.shape === "ramp" ? `Grows evenly, reaches full strength on the last ${u1(ctx)}, then stops at once.`
      : p.shape === "pulse" ? `Applies on that ${u1(ctx)} and no other.`
      : "A bell: its width is a sixth of the period, so it is already near zero at both ends.";
    body.push(<p key="d" className={HELP}>{say} The run counts {uN(ctx)} 0 to {ctx.horizon - 1}.</p>);
  }

  return <div className="flex flex-col gap-2">{body}</div>;
}

export function applyShape(e: SimEffect, ctx: Ctx, v: SimEffect["profile"]["shape"]) {
  const p = e.profile;
  p.shape = v;
  if (v === "pulse") { p.end = p.start; delete p.peak_tick; }
  else if (p.end == null || p.end <= p.start) p.end = Math.min(ctx.horizon - 1, p.start + Math.round(ctx.horizon / 3));
  if (v !== "gaussian") delete p.peak_tick;
}

export type { BType };
