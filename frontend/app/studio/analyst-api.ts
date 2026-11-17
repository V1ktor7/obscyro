/**
 * The analyst: a question about the twin, answered from what read-only tools
 * returned, with every tool call shown beside the answer.
 *
 * The server streams the reading as it happens, one JSON object per line, so
 * the panel can show each step when it lands rather than a spinner for a
 * minute. The last line is the answer.
 */

import { API_BASE, ApiError, apiFetch, getStoredKey } from "@/lib/auth";

const enc = encodeURIComponent;

export interface AnalystStep {
  /** "s1", "s2", …: what a paragraph cites. */
  id: string;
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  /** What the tool returned, or `{ error }` when it refused. */
  output: unknown;
  ms: number;
}

export interface AnalystAnswer {
  paragraphs: { text: string; sources: string[] }[];
  assumptions: string[];
  limits: string[];
  followUps: string[];
  focusSites: string[];
}

export interface AnalystFinding {
  where: "paragraph" | "assumption" | "limit";
  index: number;
  figures: string[];
}

export interface AnalystResult {
  status: "answered" | "declined" | "incomplete";
  answer: AnalystAnswer | null;
  /** True when no figure had to be taken out of the answer. */
  verified: boolean;
  struck: AnalystFinding[];
  steps: AnalystStep[];
  message: string | null;
  model: string;
  usage: { requests: number; inputTokens: number; outputTokens: number };
}

export type AnalystEvent =
  | { type: "status"; message: string }
  | { type: "step"; step: AnalystStep }
  | { type: "done"; result: AnalystResult }
  | { type: "failed"; message: string }
  | { type: "ping" };

/** The run on screen, summarised for the analyst. Mirrors the server's schema. */
export interface RunDigestSiteBreak {
  firstDay: number | null;
  days: number;
  peakWaiting: number;
  peakDay: number;
  waitingDays: number;
  peakOccupancy: number;
}

export interface RunDigestVariant {
  island: (number | null)[];
  sitesWithQueue: number;
  sitesWithActivity: number;
  firstQueueDay: number | null;
  waitingDays: number;
  peakWaiting: number;
  peakWaitingDay: number;
  strandedWaitingDays: number | null;
  arrivals: Record<string, number[]>;
  notes: string[];
}

export interface RunDigest {
  ranAt: string;
  stale: boolean;
  horizon: number;
  activity: string;
  events: RunDigestVariant;
  full: RunDigestVariant;
  sites: {
    id: string;
    name: string;
    capacity: number;
    events: RunDigestSiteBreak;
    full: RunDigestSiteBreak;
    daily: {
      occupancyEvents: (number | null)[];
      occupancyFull: (number | null)[];
      waitingEvents: (number | null)[];
      waitingFull: (number | null)[];
    } | null;
  }[];
  stranded: { names: string[]; residents: number } | null;
}

export async function fetchAnalyst(env: string): Promise<{ configured: boolean; model: string }> {
  return apiFetch(`/v1/ontology/${enc(env)}/analyst`);
}

/** Whole lines out of what has arrived so far; the rest waits for more. */
export function parseLines(buffer: string): { events: AnalystEvent[]; remainder: string } {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  const events: AnalystEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AnalystEvent);
    } catch {
      // A line that is not JSON is not ours; the answer does not depend on it.
    }
  }
  return { events, remainder };
}

/**
 * Ask, and hear each step as it happens.
 *
 * Resolves when the stream ends. Rejects with an `ApiError` when the server
 * refuses the question before starting (not signed in, analyst not switched
 * on); a failure after that arrives as a `failed` event.
 */
export async function askAnalyst(
  env: string,
  body: { question: string; scenarioId: string | null; looking: "reality" | "scenario"; run: RunDigest | null },
  onEvent: (e: AnalystEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getStoredKey();
  const res = await fetch(`${API_BASE}/v1/ontology/${enc(env)}/analyst/ask`, {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? res.statusText);
  }
  if (!res.body) throw new ApiError(502, "NO_STREAM", "The analyst sent nothing back.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, remainder } = parseLines(buffer);
    buffer = remainder;
    for (const e of events) if (e.type !== "ping") onEvent(e);
  }
  // A last line without its newline is still a line.
  for (const e of parseLines(`${buffer}\n`).events) if (e.type !== "ping") onEvent(e);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A step, in the words a planner would use for it. */
export function stepLabel(step: Pick<AnalystStep, "tool" | "input" | "output" | "ok">): string {
  const i = step.input ?? {};
  const world = i.world === "scenario" ? "with the scenario" : "as it stands";
  switch (step.tool) {
    case "describe_twin":
      return `Overview of the twin, ${world}`;
    case "find_sites": {
      const by = [str(i.name) && `named “${str(i.name)}”`, str(i.activity) && `providing ${str(i.activity)}`, str(i.catchment) && `serving ${str(i.catchment)}`]
        .filter(Boolean)
        .join(", ");
      return `Sites ${by || "of the network"}, ${world}`;
    }
    case "get_site":
      return `One site: ${str(i.site)}, ${world}`;
    case "compare_catchments":
      return `Catchments compared on ${str(i.activity)}, ${world}`;
    case "scenario_recipe":
      return "What the scenario contains";
    case "read_run":
      return i.part === "site"
        ? `The run, day by day at ${str(i.site)}`
        : i.part === "sites"
          ? "The run: where somebody waits"
          : i.part === "daily"
            ? "The run, day by day across the network"
            : "The run: summary of both runs";
    case "list_datasets":
      return "Datasets in the project";
    case "preview_dataset":
      return `First rows of ${str(i.dataset)}`;
    case "read_series":
      return `Series ${str(i.value_column)} of ${str(i.dataset)}`;
    case "calculate": {
      const result = step.ok ? (step.output as { result?: number } | null)?.result : undefined;
      return `${str(i.label) || "Calculation"}: ${str(i.expression)}${result !== undefined ? ` = ${result}` : ""}`;
    }
    default:
      return step.tool;
  }
}
