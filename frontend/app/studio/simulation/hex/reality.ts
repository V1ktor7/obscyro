/**
 * A scenario's reality check: which observed series its run is read against.
 *
 * Kept on the scenario, as a parameter override like the stamps, so the
 * comparison is still there when the scenario is opened again — and so two
 * scenarios over the same twin can each answer to their own data. It is not a
 * stamp: the engine never receives it, and it changes no result.
 */

import type { ScenarioOverride } from "../../scenarios-api";

export const REALITY_KEY = "reality";

export interface RealityConfig {
  datasetId: string;
  datasetName: string;
  /** Column holding the date. */
  when: string;
  /** Column holding the observed count. */
  value: string;
  /** The date day 0 is, YYYY-MM-DD. */
  origin: string;
  /** The severity whose arrivals the series is compared with. */
  acuity: string;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The override holding the check, when the scenario has one that can be read. */
export function realityFromOverrides(overrides: ScenarioOverride[]): { id: string; config: RealityConfig } | null {
  // The last one written wins: a check is replaced, never stacked.
  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i]!;
    if (o.targetType !== "param" || o.op !== "set_param" || o.payload.key !== REALITY_KEY) continue;
    const v = o.payload.value as Partial<RealityConfig> | undefined;
    if (!v || !isText(v.datasetId) || !isText(v.when) || !isText(v.value) || !isDay(v.origin) || !isText(v.acuity)) continue;
    return {
      id: o.id,
      config: {
        datasetId: v.datasetId,
        datasetName: isText(v.datasetName) ? v.datasetName : "",
        when: v.when,
        value: v.value,
        origin: v.origin,
        acuity: v.acuity,
      },
    };
  }
  return null;
}

export function realityToOverride(config: RealityConfig) {
  return {
    targetType: "param" as const,
    targetLocalKey: REALITY_KEY,
    op: "set_param" as const,
    payload: { key: REALITY_KEY, value: { ...config } },
    effectiveOffsetHours: 0,
    durationHours: null,
    note: `Compared with ${config.datasetName || "an observed series"} · ${config.value}`,
  };
}

/** The calendar date of a day of the run. */
export function dateOfDay(origin: string, day: number): string {
  const d = new Date(`${origin}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}
