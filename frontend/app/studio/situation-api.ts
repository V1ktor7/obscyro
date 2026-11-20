import { apiFetch } from "@/lib/auth";
import type { TwinAlertSeverity } from "@/lib/platform-api";

/**
 * The situation card, as the server reads it.
 *
 * One reading, with no language model in it: the unit's live figures as its
 * page shows them, the alert the card was opened from, where the signal stands,
 * and a question already written for the analyst. The unit and alert parts are
 * the very objects the analyst's `unit_now` and `list_alerts` tools are handed,
 * which is why their keys are written the tools' way: the card and the analyst
 * cannot show two figures for one ward.
 */

const enc = encodeURIComponent;

/** How old a value is: exact, a floor, or unknown with the reason. */
export interface ValueAge {
  known: "exact" | "at_least" | "unknown";
  age: string | null;
  /** The whole phrase, as the alert banner writes it. */
  says: string;
  why: string | null;
}

export type CountedIn = "percent" | "ratio" | "count" | "number";

export interface AlertReading {
  id: string;
  unit: string;
  unit_id: string;
  severity: TwinAlertSeverity;
  measure: string;
  measure_key: string;
  value: number | null;
  counted_in: CountedIn;
  says: string;
  opened_at: string;
  open_for: string;
  value_age: ValueAge;
  signal: { id: string; title: string; kind: string; domain: string; stage: string; step: string; needs_approval: boolean; closed: boolean } | null;
}

export interface UnitReading {
  read_at: string;
  unit: { id: string; name: string; inside: string | null; sub_units: number };
  measures: { key: string; measure: string; value: number | null; counted_in: CountedIn; about?: string[] }[];
  under_it_by_type: Record<string, number>;
  linked: number;
  value_age: ValueAge;
  last_written_here: string | null;
  open_alerts: AlertReading[];
  how_to_read: string[];
}

export interface SituationSignal {
  id: string;
  title: string;
  severity: TwinAlertSeverity;
  detectedAt: string;
  closedAt: string | null;
  unitId: string | null;
  alertId: string | null;
  type: string;
  domain: string;
  stage: string;
  stageNo: number;
  stages: number;
  needsApproval: boolean;
  isLast: boolean;
  path: { name: string; current: boolean; needsApproval: boolean }[];
}

export interface SituationCard {
  /** The server's clock when this was read. */
  at: string;
  unit: UnitReading | null;
  alert: { state: "open"; reading: AlertReading } | { state: "not_open" } | null;
  signal: SituationSignal | null;
  decisions: { items: never[]; note: string };
  /** A question for the analyst, written by the program. */
  question: string;
  checked: { at: string | null; says: string };
  alertRules: number;
  limits: string[];
  analyst: { configured: boolean };
}

export interface SituationOf {
  unit?: string | null;
  alert?: string | null;
  signal?: string | null;
}

export async function getSituation(env: string, of: SituationOf): Promise<SituationCard> {
  const q = new URLSearchParams();
  if (of.unit) q.set("unit", of.unit);
  if (of.alert) q.set("alert", of.alert);
  if (of.signal) q.set("signal", of.signal);
  return apiFetch<SituationCard>(`/v1/ontology/${enc(env)}/situation?${q.toString()}`);
}

/** A measure's value the way the unit page prints it. The server already rounded it; this only adds the sign. */
export function printed(value: number | null, countedIn: CountedIn): string {
  if (value === null) return "—";
  if (countedIn === "percent") return `${value}%`;
  if (countedIn === "ratio") return value.toFixed(2);
  if (countedIn === "count") return String(value);
  return value.toFixed(1);
}
