"use client";

/**
 * What the engine will apply, for the change being looked at: arrivals by
 * severity, capacity at the sites it reaches, objects written, or the arrivals
 * an exposure adds with its published range. Nothing is simulated here: no
 * queue, no death. Only what the event feeds in, computed the engine's way.
 */

import { matching } from "./engine";
import { bandNote, coefOf, exposureByTerritory, exposureEffects, exposureSeries, hasRange, rangeLabel } from "./exposures";
import { fmt, sig, u1, uN, type Ctx } from "./format";
import { allEffects, problemsOf, type Item } from "./items";
import { capacityAt, fam, objectsAt, siteReach, typeOf, writtenValue, propOf, say } from "./model";
import { readsUnavailable, type BActivity, type BuilderTwin } from "./twin";
import { HELP, Key, MiniChart, Rich, type Series } from "./ui";
import { arrivalsAt } from "./engine";

const SEV_COLOURS = ["#215db0", "#935610", "#6b3fa0", "#0f6b68", "#a82255", "#1c6e42"];

function Big({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-4">
      {items.map(([b, s], k) => (
        <div key={k} className="flex flex-col">
          <b className="text-lg font-semibold tabular-nums leading-tight text-ink">{b}</b>
          <span className="text-[11px] text-ink-muted">{s}</span>
        </div>
      ))}
    </div>
  );
}

export default function ApplyPanel({ it, items, tw, ctx, day, colour }: { it: Item | null; items: Item[]; tw: BuilderTwin; ctx: Ctx; day: number; colour: string }) {
  if (!it) return <p className={HELP}>Select a change to see what it amounts to.</p>;
  if (problemsOf(it, tw, ctx).length) return <p className="text-[11.5px] text-warn-ink">Nothing yet: this change still has something to fix.</p>;
  const H = ctx.horizon;

  if (it.kind === "exposure") {
    const x = it.x, c = coefOf(x), mid = exposureSeries(x, tw, ctx), ci = hasRange(c);
    const lo = ci ? exposureSeries(x, tw, ctx, "lo") : null, hi = ci ? exposureSeries(x, tw, ctx, "hi") : null;
    const sum = (a: number[]) => a.reduce((n, v) => n + v, 0), sign = (v: number) => (v < 0 ? "−" : "+");
    const at = mid.reduce((b, v, t) => (Math.abs(v) > Math.abs(mid[b]!) ? t : b), 0);
    const others = items.filter((o) => o !== it).flatMap((o) => (o.kind === "exposure" ? exposureEffects(o.x, tw, ctx) : [o.e])).filter((e) => fam(e) === "arrivals");
    const other = Array.from({ length: H }, (_, t) => Array.from(arrivalsAt(t, others, tw.pops, tw.severities).values()).reduce((a, b) => a + b, 0));
    const showOther = other.some((v) => v > 0);
    const series: Series[] = [...(ci ? [{ band: [lo!, hi!] as [number[], number[]], c: colour }] : []), { v: mid, c: colour, w: 1.8 }, ...(showOther ? [{ v: other, c: "#8f99a8", dash: true }] : [])];
    const here = Object.entries(exposureByTerritory(x, tw, ctx, day)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
    return (
      <div>
        <Big items={[[`${sign(mid[at]!)}${sig(Math.abs(mid[at]!))}`, `arrivals a ${u1(ctx)} at the most, ${u1(ctx)} ${at}${ci ? ` · ${rangeLabel(c)} ${sig(lo![at]!)}–${sig(hi![at]!)}` : ""}`],
          [fmt(sum(mid), 1), `over the run${ci ? ` · ${fmt(sum(lo!), 1)}–${fmt(sum(hi!), 1)}` : ""}`]]} />
        <MiniChart series={series} horizon={H} day={day} label="Arrivals this change adds, by step" />
        <Key items={[[colour, "this change"], ...(ci ? [[colour, rangeLabel(c), "band"] as [string, string, "band"]] : []), ...(showOther ? [["#8f99a8", "every other arrival change", "dash"] as [string, string, "dash"]] : [])]} />
        <p className="mt-2 text-[11.5px] text-ink-body">On {u1(ctx)} {day}: {here.length ? here.map(([id, v], k) => <span key={id}>{k ? " · " : ""}{tw.popById.get(id)?.name ?? id} <b className="tabular-nums">{sign(v)}{sig(Math.abs(v))}</b></span>) : "nothing"}.</p>
        <p className={HELP}>{c.kind === "rr" ? `Usual rate × (${c.rr}^(rise ÷ ${c.per}) − 1), per territory and per ${u1(ctx)}, times its residents. ` : ""}Nothing is simulated: this is only what the change feeds in.{ci ? bandNote(c) : ""}</p>
      </div>
    );
  }

  const e = it.e, f = fam(e);
  if (f === "arrivals") {
    const all = allEffects(items, tw, ctx).filter((x) => fam(x) === "arrivals");
    const per = tw.severities.map(() => [] as number[]);
    let total = 0, peak = 0, at = 0;
    for (let t = 0; t < H; t++) {
      const by = new Map<string, number>();
      for (const [k, v] of Array.from(arrivalsAt(t, all, tw.pops, tw.severities))) { const s = k.split("|")[1]!; by.set(s, (by.get(s) || 0) + v); }
      let s = 0;
      tw.severities.forEach((a, n) => { per[n]!.push(by.get(a) || 0); s += by.get(a) || 0; });
      total += s;
      if (s > peak) { peak = s; at = t; }
    }
    const now = tw.severities.map((a, n) => [a, per[n]![day] || 0] as const);
    return (
      <div>
        <Big items={[[sig(peak), `arrivals a ${u1(ctx)} at the peak, ${u1(ctx)} ${at}`], [fmt(total), `over the ${H} ${uN(ctx)}`]]} />
        <MiniChart series={tw.severities.map((_, n) => ({ v: per[n]!, c: SEV_COLOURS[n % SEV_COLOURS.length]!, fill: true }))} horizon={H} day={day} label="Arrivals by step, by severity" />
        <Key items={tw.severities.map((a, n) => [SEV_COLOURS[n % SEV_COLOURS.length]!, a])} />
        <p className="mt-2 text-[11.5px] text-ink-body">On {u1(ctx)} {day}: {now.map(([a, v], k) => <span key={a}>{k ? " · " : ""}<b className="tabular-nums">{sig(v)}</b> {a}</span>)}.</p>
        <p className={HELP}>Every arrival change together. For scale, the network holds {tw.activities.map((a) => `${fmt(a.total)} ${a.id}`).join(" and ")}. Nothing here is simulated.</p>
      </div>
    );
  }

  if (f === "capacity") {
    const R = siteReach(ctx, tw, e).filter((r) => !r.out && !r.late);
    const acts = ((e.select.activity || []).length ? e.select.activity!.map((a) => tw.activityById.get(a)).filter((a): a is BActivity => !!a) : tw.activities).filter((a) => R.some((r) => (r.s.capacity[a.id] || 0) > 0));
    if (!acts.length) return <p className="text-[11.5px] text-warn-ink">No site in range holds this resource.</p>;
    const capEffects = allEffects(items, tw, ctx).filter((x) => fam(x) === "capacity");
    return (
      <div className="flex flex-col gap-3">
        {acts.map((a) => {
          const sites = R.filter((r) => (r.s.capacity[a.id] || 0) > 0).map((r) => r.s), base = sites.reduce((n, s) => n + (s.capacity[a.id] || 0), 0);
          const alone: number[] = [], every: number[] = [];
          for (let t = 0; t < H; t++) { alone.push(sites.reduce((n, s) => n + capacityAt(s, a, t, [e]), 0)); every.push(sites.reduce((n, s) => n + capacityAt(s, a, t, capEffects), 0)); }
          const ext = alone.reduce((m, v) => (Math.abs(v - base) > Math.abs(m - base) ? v : m), base), at = alone.indexOf(ext);
          const differs = every.some((v, t) => Math.abs(v - alone[t]!) > 1e-9);
          return (
            <div key={a.id}>
              <Big items={[[`${fmt(base)} → ${fmt(ext, 1)}`, `${a.id} at ${sites.length} site${sites.length === 1 ? "" : "s"}, at the furthest (${u1(ctx)} ${at})`],
                [`${ext >= base ? "+" : "−"}${sig((Math.abs(ext - base) / a.total) * 100)} %`, `of the network's ${fmt(a.total)}`]]} />
              <MiniChart zero={false} series={[{ v: alone.map(() => base), c: "#8f99a8", dash: true }, { v: alone, c: colour, fill: true }, ...(differs ? [{ v: every, c: "#1c2127", w: 1.2 }] : [])]} horizon={H} day={day} label={`Capacity of ${a.id} by step`} />
              <Key items={[["#8f99a8", "as it stands", "dash"], [colour, "with this change"], ...(differs ? [["#1c2127", "with every capacity change"] as [string, string]] : [])]} />
              <p className="mt-2 text-[11.5px] text-ink-body">On {u1(ctx)} {day}: <b className="tabular-nums">{fmt(alone[day] ?? 0, 1)}</b> of {fmt(base)}.</p>
            </div>
          );
        })}
        <p className={HELP}>Rebuilt from the baseline on every {u1(ctx)}, so the change does not compound. The axis does not start at zero.</p>
      </div>
    );
  }

  if (f === "route") return <p className={HELP}>Route throughput is applied to the routes the change names.</p>;

  const m = matching(e, tw.objects), T = typeOf(tw, e)!, def = propOf(tw, e);
  if (!T.placed) {
    return (
      <div className="flex flex-col gap-1.5">
        {m.hits.slice(0, 8).map((o) => {
          const before = o.properties[e.property_key ?? ""], after = typeof before === "number" || e.op === "set" ? writtenValue(e, def, before) : before;
          return <p key={o.id} className="text-[11.5px] text-ink-body"><b>{o.id.slice(0, 8)}</b> · <Rich text={`\`${e.property_key}\``} /> {say(before)} → {say(after)}</p>;
        })}
        {m.hits.length > 8 ? <p className={HELP}>and {m.hits.length - 8} more.</p> : null}
        <p className={HELP}>Written at full strength while the change is on, then back to the original value. These objects hang off no site, so distance cannot reach them.</p>
      </div>
    );
  }
  const counts: number[] = [], free: number[] = [];
  const key = e.property_key ?? "";
  const isStatus = typeof e.value === "string" && tw.rules.unavailable_keys.includes(key);
  const pool = tw.objectsByType.get(T.name) ?? [];
  const freeBase = pool.filter((o) => !readsUnavailable(tw, key, o.properties[key])).length;
  for (let t = 0; t < H; t++) {
    const hit = objectsAt(tw, e, m.hits, t);
    counts.push(hit.length);
    if (isStatus) {
      const wasFree = hit.filter((o) => !readsUnavailable(tw, key, o.properties[key])).length;
      free.push(readsUnavailable(tw, key, e.value) ? freeBase - wasFree : freeBase + (hit.length - wasFree));
    }
  }
  const most = Math.max(...counts), ext = isStatus ? free.reduce((a, v) => (Math.abs(v - freeBase) > Math.abs(a - freeBase) ? v : a), freeBase) : null;
  return (
    <div>
      <Big items={[[fmt(most), `of ${fmt(T.n)} written at the most`], ...(isStatus ? [[`${fmt(freeBase)} → ${fmt(ext!)}`, `free ${T.name} in the network`] as [string, string]] : [])]} />
      <MiniChart series={isStatus ? [{ v: free.map(() => freeBase), c: "#8f99a8", dash: true }, { v: free, c: "#1c2127", w: 1.3 }, { v: counts, c: colour, fill: true }] : [{ v: counts, c: colour, fill: true }]} horizon={H} day={day} label="Objects written by step" />
      <Key items={[[colour, "objects written"], ...(isStatus ? [["#1c2127", "free in the network"], ["#8f99a8", "free as it stands", "dash"]] as [string, string, "dash"?][] : [])] as [string, string, "dash"?][]} />
      <p className="mt-2 text-[11.5px] text-ink-body">On {u1(ctx)} {day}: <b className="tabular-nums">{fmt(counts[day] ?? 0)}</b> written{isStatus ? <> · <b className="tabular-nums">{fmt(free[day] ?? 0)}</b> free</> : null}.</p>
      <p className={HELP}>{isStatus && readsUnavailable(tw, key, e.value) ? `The twin read ${fmt(T.n - freeBase)} of ${fmt(T.n)} as already in use. Writing an object that is already out of service frees nothing and takes nothing.` : "An object is written or it is not: there is no partial switch."}</p>
    </div>
  );
}
