/**
 * The loop's rules, applied to what it froze.
 *
 * Which model is in force, when a horizon is drifting, when the shadow model
 * earns its place: none of it is stored, because none of it is a judgement made
 * at the time. Each is a rule fixed before looking at any result, applied to
 * forecasts that cannot change — so it gives the same answer every time it is
 * read, and anyone can check it by hand.
 */

import type { LoopView } from "../forecast-loops-api";

/** Set before looking at any result, and shown on screen as set. */
export const RULE = { window: 28, minPoints: 14, drift: 1.5, clear: 1.25, promoWindow: 56, promoMin: 28, promoGain: 0.9 };
/** The horizons a replacement is judged on: the ones planning is done at. */
export const DECIDE = [7, 14, 21];

export const addDays = (s: string, n: number): string => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Made on the morning of `made`, knowing everything up to the day before. */
export const targetOf = (made: string, h: number) => addDays(made, h - 1);
export const madeOf = (target: string, h: number) => addDays(target, -(h - 1));
const isMonday = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay() === 1;

export interface Retrain { on: string; mae: number | null; points: number }
export interface Resolved { made: string; tgt: string; f: number; a: number; naive: number }
export interface DriftEvent { day: string; kind: "alert" | "clear"; spec: string; h: number; live: number; expected: number | null }
export type LoopEvent =
  | { day: string; kind: "start" | "retrain" }
  | { day: string; kind: "promote"; from: string; to: string; a: number; b: number }
  | DriftEvent;

export interface Loop {
  days: string[];
  specs: string[];
  horizons: number[];
  obs: (day: string) => number | null;
  forecast: (spec: string, h: number, made: string) => number | null;
  retrainOf: (spec: string, h: number, day: string) => Retrain | null;
  resolvedAt: (spec: string, h: number, today: string, win: number) => Resolved[];
  liveStats: (spec: string, h: number, today: string, win?: number) => { n: number; mae?: number; naive?: number };
  bandOf: (spec: string, h: number, today: string) => [number, number] | null;
  inForce: Record<string, string>;
  events: LoopEvent[];
  alertsOn: (day: string) => Record<number, DriftEvent>;
}

export function buildLoop(view: Pick<LoopView, "actual" | "forecasts" | "retrains" | "loop">): Loop {
  const specs = view.loop.specs.map((s) => s.key);
  const horizons = view.loop.horizons;
  const F = new Map<string, number>();
  let lastMade: string | null = null;
  for (const f of view.forecasts) {
    F.set(`${f.spec}|${f.h}|${f.made}`, f.value);
    if (!lastMade || f.made > lastMade) lastMade = f.made;
  }
  const R = new Map<string, Retrain[]>();
  for (const r of view.retrains) {
    const k = `${r.spec}|${r.h}`;
    R.set(k, [...(R.get(k) || []), { on: r.on, mae: r.mae, points: r.points }]);
  }
  for (const list of Array.from(R.values())) list.sort((a, b) => (a.on < b.on ? -1 : 1));

  const days: string[] = [];
  if (lastMade) for (let s = view.loop.startDate; s <= lastMade; s = addDays(s, 1)) days.push(s);

  const obs = (s: string) => (view.actual[s] == null ? null : view.actual[s]!);
  const forecast = (spec: string, h: number, made: string) => F.get(`${spec}|${h}|${made}`) ?? null;
  const retrainOf = (spec: string, h: number, day: string) => {
    let r: Retrain | null = null;
    for (const x of R.get(`${spec}|${h}`) || []) if (x.on <= day) r = x;
    return r;
  };
  const resolvedAt = (spec: string, h: number, today: string, win: number) => {
    const out: Resolved[] = [];
    for (let k = 1; k <= win; k++) {
      const tgt = addDays(today, -k), made = madeOf(tgt, h);
      if (made < view.loop.startDate) break;
      const f = forecast(spec, h, made), a = obs(tgt), naive = obs(addDays(made, -1));
      if (f == null || a == null || naive == null) continue;
      out.push({ made, tgt, f, a, naive });
    }
    return out;
  };
  const liveStats = (spec: string, h: number, today: string, win = RULE.window) => {
    const r = resolvedAt(spec, h, today, win);
    if (!r.length) return { n: 0 };
    return {
      n: r.length,
      mae: r.reduce((s, x) => s + Math.abs(x.a - x.f), 0) / r.length,
      naive: r.reduce((s, x) => s + Math.abs(x.a - x.naive), 0) / r.length,
    };
  };
  /** The 10th and 90th percentiles of our own last 56 errors at this horizon. */
  const bandOf = (spec: string, h: number, today: string): [number, number] | null => {
    const r = resolvedAt(spec, h, today, 56);
    if (r.length < RULE.minPoints) return null;
    const e = r.map((x) => x.a - x.f).sort((a, b) => a - b);
    const q = (p: number) => { const k = (e.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k); return e[lo]! + (e[hi]! - e[lo]!) * (k - lo); };
    return [q(0.1), q(0.9)];
  };

  // Morning by morning: which model was in force, the Monday refits, alerts, replacements.
  let current = specs[0] ?? "A";
  const inForce: Record<string, string> = {};
  const events: LoopEvent[] = [];
  const alertOn: Record<number, boolean> = {};
  for (const day of days) {
    if (day === view.loop.startDate) events.push({ day, kind: "start" });
    else if (isMonday(day)) {
      /** Mean error over the planning horizons, or null while any has too few scored. */
      const score = (spec: string) => {
        let s = 0, n = 0;
        for (const h of DECIDE) {
          if (!horizons.includes(h)) continue;
          const st = liveStats(spec, h, day, RULE.promoWindow);
          if (st.n < RULE.promoMin) return null;
          s += st.mae!;
          n++;
        }
        return n ? s / n : null;
      };
      for (const other of specs) {
        if (other === current) continue;
        const a = score(current), b = score(other);
        if (a != null && b != null && b <= RULE.promoGain * a) {
          events.push({ day, kind: "promote", from: current, to: other, a, b });
          current = other;
        }
      }
      events.push({ day, kind: "retrain" });
    }
    inForce[day] = current;
    for (const h of horizons) {
      const st = liveStats(current, h, day), rt = retrainOf(current, h, day);
      // Raised at 1.5×, lowered only below 1.25×, so an error hovering at the line does not flicker.
      const drift = !!(st.n >= RULE.minPoints && rt?.mae && st.mae! >= (alertOn[h] ? RULE.clear : RULE.drift) * rt.mae);
      if (drift !== !!alertOn[h]) events.push({ day, kind: drift ? "alert" : "clear", spec: current, h, live: st.mae!, expected: rt?.mae ?? null });
      alertOn[h] = drift;
    }
  }
  const alertsOn = (day: string) => {
    const on: Record<number, DriftEvent> = {};
    for (const e of events) {
      if (e.day > day) break;
      if (e.kind === "alert") on[e.h] = e;
      if (e.kind === "clear") delete on[e.h];
    }
    return on;
  };
  return { days, specs, horizons, obs, forecast, retrainOf, resolvedAt, liveStats, bandOf, inForce, events, alertsOn };
}
