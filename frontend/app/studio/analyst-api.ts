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
  /** What the tool kept beside its result, whole: read by the screen, never by the model. */
  record?: unknown;
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
  /** Set when the figures exist but were written beside the wrong name. */
  misattributed?: { figure: string; saidOf: string; belongsTo: string[] }[];
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
  usage: Usage;
}

/** What an exchange cost. `webSearches` is there only when the exchange could search the web. */
export interface Usage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  webSearches?: number;
}

/** What a stream sends, whatever the exchange ends with. `exchangeId` names it in the journal. */
export type StreamEvent<R> =
  | { type: "status"; message: string }
  | { type: "step"; step: AnalystStep }
  | { type: "done"; result: R; exchangeId?: string }
  | { type: "failed"; message: string }
  | { type: "ping" };

export type AnalystEvent = StreamEvent<AnalystResult>;

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

/**
 * Whether the analyst can be asked on this server, and on which model. When it
 * cannot, `reason` names the setting at fault and `why` says it in the
 * server's own words. Both are absent from an older server.
 */
export interface AnalystStatus {
  configured: boolean;
  model: string;
  models?: string[];
  reason?: "no_key" | "unknown_model" | null;
  why?: string | null;
}

export async function fetchAnalyst(env: string): Promise<AnalystStatus> {
  return apiFetch(`/v1/ontology/${enc(env)}/analyst`);
}

/** Whole lines out of what has arrived so far; the rest waits for more. */
export function parseLines<E = AnalystEvent>(buffer: string): { events: E[]; remainder: string } {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  const events: E[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as E);
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
/**
 * What the person has in front of them when they ask from another page than
 * the scenario map. Ids only: the server looks the names up itself.
 */
export interface AskFocus {
  /** The Studio page, as its address names it ("live", "response", "situation"). */
  page?: string;
  unitId?: string;
  signalId?: string;
}

export async function askAnalyst(
  env: string,
  body: { question: string; scenarioId: string | null; looking: "reality" | "scenario"; run: RunDigest | null; focus?: AskFocus | null },
  onEvent: (e: AnalystEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamExchange<AnalystResult>(`/v1/ontology/${enc(env)}/analyst/ask`, body, onEvent, signal);
}

/** One exchange with the analyst, heard line by line. */
async function streamExchange<R>(path: string, body: unknown, onEvent: (e: StreamEvent<R>) => void, signal?: AbortSignal): Promise<void> {
  const token = getStoredKey();
  const res = await fetch(`${API_BASE}${path}`, {
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
    const { events, remainder } = parseLines<StreamEvent<R>>(buffer);
    buffer = remainder;
    for (const e of events) if (e.type !== "ping") onEvent(e);
  }
  // A last line without its newline is still a line.
  for (const e of parseLines<StreamEvent<R>>(`${buffer}\n`).events) if (e.type !== "ping") onEvent(e);
}

// ---------------------------------------------------------------------------
// Options: an objective, up to three options, each tested by the engine.
// ---------------------------------------------------------------------------

/** How sure anyone can be of something a run rests on. Assigned by the server, never by the model. */
export type Evidence = "measured" | "published" | "assumption";

export interface Basis {
  element: string;
  evidence: Evidence;
  /** Where it comes from: the twin, the scenario, the option, or a rule of the engine. */
  from: "twin" | "scenario" | "option" | "engine";
}

/** One column of the comparison: a run's figures, as the engine counted them. */
export interface OptionFigures {
  /** Highest occupancy across every site, as a share; null when the run reports none. */
  peakOccupancy: number | null;
  peakDay: number | null;
  sitesWithQueue: number;
  sitesWithActivity: number;
  firstQueueDay: number | null;
  waitingDays: number;
  peakWaiting: number;
  peakWaitingDay: number;
  strandedWaitingDays: number | null;
}

/** A stamp as this page writes it: what "Add to scenario" creates. */
export interface OptionStamp {
  body: Record<string, unknown> & { kind: string };
  start: number;
  days: number;
}

/** A choice of the scenario an option takes out: replaced by one of its stamps, or removed. */
export interface RetiredChoice {
  /** The stamp's id in the scenario when the option was tested. */
  id: string;
  stamp: OptionStamp;
  /** The choice as a line, written by the server from the stamp. */
  text: string;
  /** Position, in the option's stamps, of what takes its place; null when it is removed. */
  replacedBy: number | null;
}

/** One thing an option does to the scenario, in the server's own words. */
export interface OptionChange {
  does: "adds" | "replaces" | "removes";
  /** What is in the scenario once it is applied; null for a removal. */
  now: string | null;
  /** The scenario's choice it takes out; null for an addition. */
  was: string | null;
}

/**
 * What a run cost, as far as anything says. The engine counts the cost a rule
 * of a recorded response declares for its action, each time the action fires.
 * Capacity an option opens is priced by the twin's price list when it declares
 * one (`priced`). Measures carry no price, and whatever nothing prices is
 * unpriced, not free.
 */
export interface OptionCost {
  /** What the run cost, in dollars: the engine's count and the price list's total; null when nothing gives a cost. */
  counted: number | null;
  /** True when that figure is the whole cost of what the option changes: only then can two options be weighed. */
  complete: boolean;
  /** The same, as a sentence written by the server. */
  says: string;
  /**
   * True when an amount behind the count has no source: a price row that names
   * none, or the amount a rule of a recorded response declares. Absent when
   * nothing is counted, and from records kept before the server said it.
   */
  demo?: boolean;
  /** What the twin's price list gives for the capacity the option opens, line by line. Absent when the twin declares no price. */
  priced?: CostLedger;
}

/** An amount in whole cents, with its low and high ends. Without a declared range the three are the same. */
export interface PriceAmount {
  cents: number;
  low: number;
  high: number;
}

/** One line of an option's cost: a change of the option, the price row it used, and the arithmetic written out. */
export interface LedgerLine {
  /** The change of the option that caused it, by its position among the option's stamps. */
  stamp: number;
  siteId: string;
  site: string;
  activity: string;
  category: "opening" | "running" | "formula";
  fromDay: number;
  toDay: number;
  units: number;
  days: number;
  price: {
    id: string;
    type: string;
    mode: string;
    /** True when the row is the site's own price, which comes before the network's. */
    ofSite: boolean;
    unit: PriceAmount | null;
    formula: string | null;
    values: Record<string, number> | null;
    /** Where the price comes from; null for a demo price. */
    source: string | null;
    demo: boolean;
  };
  cents: number;
  lowCents: number;
  highCents: number;
  /** The arithmetic, written out by the server. */
  says: string;
}

export interface CostLedger {
  lines: LedgerLine[];
  totalCents: number;
  lowCents: number;
  highCents: number;
  /** True when at least one price used is a range: the three totals then differ. */
  ranged: boolean;
  byCategory: Record<LedgerLine["category"], number>;
  /** True when at least one line rests on a price with no source. */
  demo: boolean;
  /** What the price list does not price, each with the reason. */
  unpriced: { stamp: number; why: string }[];
  /** For each priced change: the mode it uses and the day its units are open. */
  availability: { stamp: number; site: string; activity: string; mode: string; leadDays: number; fromDay: number }[];
}

export interface ProposedOption {
  /** The step that tested it: what a decision is recorded against. */
  step: string;
  label: string;
  /** The stamps it writes: what it adds, and what it puts in place of a choice. */
  stamps: OptionStamp[];
  /** The scenario's choices it takes out. Absent from an exchange journalled before an option could. */
  retires?: RetiredChoice[];
  /** What it adds, replaces and removes, in the order asked. */
  changes?: OptionChange[];
  figures: OptionFigures;
  /** What its run cost. Absent from an exchange journalled before an option could contain a recorded response. */
  cost?: OptionCost;
  sites: { id: string; name: string; capacity: number; asItIs: RunDigestSiteBreak; withOption: RunDigestSiteBreak }[];
  basis: Basis[];
  arrivals: Record<string, number[]>;
  notes: string[];
  mechanism: string;
  notTested: string[];
}

export interface OptionsProposal {
  objective: string;
  horizon: number;
  activity: string;
  /** The scenario as it stands; null when nothing could be tested. */
  asItIs: OptionFigures | null;
  /** What the scenario as it stands cost in its run. */
  asItIsCost?: OptionCost | null;
  options: ProposedOption[];
  /** What every column shares. */
  basis: Basis[];
  reading: { text: string; sources: string[] }[];
  humanChoices: string[];
  limits: string[];
  focusSites: string[];
}

export interface OptionsFinding {
  where: "reading" | "mechanism" | "not_tested" | "human_choice" | "limit";
  option: string | null;
  index: number;
  figures: string[];
  /** Set when the figures exist but were written beside the wrong name. */
  misattributed?: { figure: string; saidOf: string; belongsTo: string[] }[];
}

export interface OptionsResult {
  status: "answered" | "declined" | "incomplete";
  answer: OptionsProposal | null;
  verified: boolean;
  struck: OptionsFinding[];
  steps: AnalystStep[];
  message: string | null;
  model: string;
  usage: { requests: number; inputTokens: number; outputTokens: number };
}

export type OptionsEvent = StreamEvent<OptionsResult>;

/**
 * State an objective, and hear the options being tested.
 *
 * `horizon` and `activity` are the page's own: a test has to answer what Run
 * would show with the option in the scenario.
 */
export async function proposeOptions(
  env: string,
  body: { objective: string; scenarioId: string; horizon: number; activity: string; run: RunDigest | null },
  onEvent: (e: OptionsEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamExchange<OptionsResult>(`/v1/ontology/${enc(env)}/analyst/options`, body, onEvent, signal);
}

// ---------------------------------------------------------------------------
// Decisions: a tested option a person retained, and what they expected of it.
// ---------------------------------------------------------------------------

export interface DecisionExpected {
  horizon: number;
  activity: string;
  asItIs: OptionFigures;
  withOption: OptionFigures;
  sites: ProposedOption["sites"];
  arrivals: Record<string, number[]>;
  basis: Basis[];
  /** What the option did to the scenario, and the choices it took out. Absent from older decisions, which only added. */
  changes?: OptionChange[];
  retires?: RetiredChoice[];
  mechanism: string;
  notTested: string[];
  notes: string[];
  /** What the engine counted as the cost of the tested run. Absent from older decisions. */
  cost?: OptionCost;
  /**
   * The same two runs made again on the network as it was when the signal
   * opened: what the situation card showed when a prepared response was
   * engaged. Absent when no such test had given figures.
   */
  retested?: { testedAt: string; current: boolean; asItIs: OptionFigures; withOption: OptionFigures };
}

export interface Decision {
  id: string;
  scenarioId: string | null;
  scenarioName: string;
  exchangeId: string | null;
  optionStep: string;
  objective: string;
  optionLabel: string;
  optionStamps: OptionStamp[];
  expected: DecisionExpected;
  sourceSteps: Pick<AnalystStep, "id" | "tool" | "input" | "output">[];
  note: string | null;
  decidedBy: string | null;
  decidedAt: string;
  /** The signal it was taken on, when a prepared response was engaged. Absent or null for one recorded from the Options tab. */
  signal?: { id: string; title: string } | null;
  preparedResponseId?: string | null;
}

/**
 * Record that a tested option was retained.
 *
 * Only the exchange and the step are sent: the server copies the figures from
 * its own journal of the test.
 */
export async function recordDecision(env: string, body: { exchangeId: string; step: string; note?: string | null }): Promise<Decision> {
  return apiFetch(`/v1/ontology/${enc(env)}/decisions`, { method: "POST", body });
}

export async function listDecisions(env: string): Promise<{ decisions: Decision[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/decisions`);
}

export interface FollowUpFit {
  n: number;
  meanAbsoluteError: number | null;
  peakSimulated: { step: number; value: number } | null;
  peakObserved: { step: number; value: number } | null;
  peakOffset: number | null;
  correlation: number | null;
}

export type FollowUp =
  | { linked: false; reason: string }
  | {
      linked: true;
      dataset: { id: string; name: string };
      acuity: string;
      origin: string;
      horizon: number;
      reported: number;
      expected: number[] | null;
      observed: (number | null)[];
      fit: FollowUpFit | null;
      totals: { days: number; expected: number; observed: number; gap: number } | null;
    };

/** A decision's expected arrivals beside the series its scenario is compared with. */
export async function fetchFollowUp(env: string, decisionId: string): Promise<FollowUp> {
  return apiFetch(`/v1/ontology/${enc(env)}/decisions/${enc(decisionId)}/follow-up`);
}

// ---------------------------------------------------------------------------
// Event finder: official web sources searched for what was happening around
// the network, and the calendar of the events a person accepted.
// ---------------------------------------------------------------------------

/** How an event reaches a health network. */
export type Door = "demand" | "capacity" | "access" | "care";

export const DOOR_LABEL: Record<Door, { label: string; title: string }> = {
  demand: { label: "Demand", title: "More people need care." },
  capacity: { label: "Capacity", title: "Less to care with." },
  access: { label: "Access", title: "People cannot reach care, or are kept from moving." },
  care: { label: "Care", title: "Each patient needs more, or for longer." },
};

/** A passage of a page, as the search returned it under a cited sentence. */
export interface CandidatePassage {
  step: string;
  url: string;
  title: string;
  text: string;
}

export interface EventCandidate {
  /** "c1", "c2", …: what an acceptance names. */
  id: string;
  title: string;
  /** Null when no passage states the day: the person enters it from the source. */
  startDate: string | null;
  endDate: string | null;
  /** Dates the model gave that no passage states, taken out by the server. */
  datesRemoved: ("start" | "end")[];
  place: string;
  door: Door;
  url: string;
  sourceTitle: string;
  /** Fewer than fifteen words, found word for word in a passage. */
  quote: string;
  /** True when the model's quotation was in no passage and the passage's opening words stand in for it. */
  quoteReplaced: boolean;
  passages: CandidatePassage[];
  evidence: Evidence;
}

export interface EventsProposal {
  request: string;
  /** The domains the search was restricted to. */
  sources: string[];
  searches: number;
  candidates: EventCandidate[];
  notFound: string[];
  limits: string[];
}

export interface EventsFinding {
  where: "title" | "place" | "quote" | "start_date" | "end_date" | "dates" | "source" | "not_found" | "limit";
  candidate: number | null;
  index: number;
  figures: string[];
}

export interface EventsResult {
  status: "answered" | "declined" | "incomplete";
  answer: EventsProposal | null;
  verified: boolean;
  struck: EventsFinding[];
  steps: AnalystStep[];
  message: string | null;
  model: string;
  usage: Usage;
}

export type EventsEvent = StreamEvent<EventsResult>;

/**
 * Search the allowed sources for events, and hear each search as it lands.
 *
 * Only the request is sent: the search is never handed the twin, the scenario
 * or a run. `scenarioId` is kept in the journal to say where it was asked from.
 */
export async function findEvents(
  env: string,
  body: { request: string; scenarioId: string | null },
  onEvent: (e: EventsEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamExchange<EventsResult>(`/v1/ontology/${enc(env)}/analyst/events`, body, onEvent, signal);
}

/** An event of the calendar: a candidate a person accepted. */
export interface HealthEvent {
  id: string;
  title: string;
  place: string;
  door: Door;
  /** The dates the person validated, YYYY-MM-DD. */
  startsOn: string;
  endsOn: string | null;
  /** What the analyst had proposed. */
  proposedStartsOn: string | null;
  proposedEndsOn: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
  passage: string;
  sources: CandidatePassage[];
  proposedByAnalyst: boolean;
  exchangeId: string | null;
  candidate: string | null;
  validatedBy: string | null;
  validatedAt: string;
}

/**
 * Accept a candidate into the calendar.
 *
 * Only the search, the candidate and the validated dates are sent: the server
 * copies the title, the link and the passage from its own journal. There is no
 * call to reject a candidate — rejecting records nothing.
 */
export async function acceptEvent(env: string, body: { exchangeId: string; candidate: string; startsOn: string; endsOn: string | null }): Promise<HealthEvent> {
  return apiFetch(`/v1/ontology/${enc(env)}/health-events`, { method: "POST", body });
}

export async function listHealthEvents(env: string): Promise<{ events: HealthEvent[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/health-events`);
}

export async function removeHealthEvent(env: string, id: string): Promise<void> {
  await apiFetch(`/v1/ontology/${enc(env)}/health-events/${enc(id)}`, { method: "DELETE" });
}

export interface WebSources {
  domains: string[];
  /** True when the project never set a list and the starting one applies. */
  isDefault: boolean;
  defaults: string[];
  max: number;
}

export async function fetchWebSources(env: string): Promise<WebSources> {
  return apiFetch(`/v1/ontology/${enc(env)}/web-sources`);
}

export async function saveWebSources(env: string, domains: string[]): Promise<WebSources> {
  return apiFetch(`/v1/ontology/${enc(env)}/web-sources`, { method: "PUT", body: { domains } });
}

/** The site a link points to, without its "www.". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** An address is shown as a link only when it is a web page: nothing else is ever given an href. */
export function isWebLink(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "https:" || p === "http:";
  } catch {
    return false;
  }
}

/** The validated events a `list_events` step returned, with their links: what a WEB chip is made from. */
export interface ListedEvent {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  place: string;
  door: Door;
  url: string;
  sourceTitle: string | null;
  passage: string;
}

export function listedEvents(step: Pick<AnalystStep, "tool" | "ok" | "record"> | undefined): ListedEvent[] {
  if (!step || step.tool !== "list_events" || !step.ok) return [];
  const events = (step.record as { events?: unknown } | undefined)?.events;
  return Array.isArray(events) ? (events as ListedEvent[]).filter((e) => typeof e?.url === "string" && typeof e?.title === "string") : [];
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
    case "test_option":
      return `Option tested in the engine: ${str(i.label)}`;
    case "list_events": {
      const n = step.ok ? ((step.output as { events?: unknown[] } | null)?.events?.length ?? 0) : 0;
      const period =
        i.from_day !== undefined || i.to_day !== undefined
          ? `, days ${i.from_day ?? "…"} to ${i.to_day ?? "…"} of the run`
          : str(i.from_date) || str(i.to_date)
            ? `, ${str(i.from_date) || "…"} to ${str(i.to_date) || "…"}`
            : "";
      return `Validated events from official sources${period}${step.ok ? `: ${n}` : ""}`;
    }
    case "web_search": {
      const n = step.ok ? ((step.output as { results?: unknown[] } | null)?.results?.length ?? 0) : 0;
      return `Web search: “${str(i.query)}”${step.ok ? ` · ${n} page${n === 1 ? "" : "s"}` : ""}`;
    }
    case "web_passage":
      return `Passage cited from ${hostOf(str(i.url))}`;
    case "calculate": {
      const result = step.ok ? (step.output as { result?: number } | null)?.result : undefined;
      return `${str(i.label) || "Calculation"}: ${str(i.expression)}${result !== undefined ? ` = ${result}` : ""}`;
    }
    default:
      return step.tool;
  }
}
