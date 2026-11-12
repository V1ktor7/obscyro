/** Numbers and words the builder writes, in one place so every panel says them the same way. */

export const fmt = (n: number, d = 0) => Number(n).toLocaleString("en-CA", { maximumFractionDigits: d });

/** A number at a sensible precision: whole above 100, three significant figures below 1. */
export function sig(n: number): string {
  const a = Math.abs(n);
  return a === 0 ? "0" : a >= 100 ? fmt(n) : a >= 10 ? fmt(n, 1) : a >= 1 ? fmt(n, 2) : Number(n.toPrecision(3)).toString();
}

export const tidy = (x: number) => +Number(x).toFixed(6);
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const names = (list: string[], noun: string) =>
  list.length === 1 ? list[0]! : list.length === 2 ? `${list[0]} and ${list[1]}` : `${list.length} ${noun}`;

export type StepUnit = "step" | "hour" | "day" | "week";
export const UNITS: Record<StepUnit, [string, string]> = { step: ["step", "steps"], hour: ["hour", "hours"], day: ["day", "days"], week: ["week", "weeks"] };

export interface Ctx {
  horizon: number;
  unit: StepUnit;
}
export const u1 = (c: Ctx) => UNITS[c.unit][0];
export const uN = (c: Ctx) => UNITS[c.unit][1];

export function addDays(s: string, n: number): string {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Sentences carry a little markup: `code` for the ontology's own names, and
 * **bold** for a number worth reading first. `Rich` renders it.
 */
export type Markup = string;
