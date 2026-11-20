import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { READ_TOOLS, Recorded, ToolError, type AnalystContext, type AnalystTool } from "./analyst-tools.js";
import { Ledger, checkAnswer, type AnswerDraft, type Finding } from "./analyst-verify.js";
import { WEB_PASSAGE, WebReader, passageLedger, passageOf, webSearchTool, type WebSearch } from "./analyst-web.js";

/**
 * The analyst: a language model that reads the twin through tools and explains
 * what it read.
 *
 * What the model does here is narrow on purpose. It decides which tool to call
 * next, and it writes sentences. It does not hold facts about the network, it
 * does not do arithmetic, and it does not decide anything. Every figure in what
 * it writes is looked up afterwards in the results it was given
 * (`analyst-verify.ts`), and the whole exchange — each call, each result — is
 * returned beside the answer so a person can check any sentence against what
 * was actually read.
 *
 * The loop is written out rather than left to the SDK's runner because three
 * things in it are ours: the record of every step, the check that sends a
 * draft back when a figure cannot be traced, and the rule that an answer is
 * delivered through one call (`give_answer`) so it arrives as paragraphs with
 * their sources rather than as prose to be parsed.
 *
 * The loop does not know what is being asked for. How an exchange ends — what
 * the model is told, the call it delivers through, how that delivery is
 * checked — is a `Closing`. A question ends with `give_answer` (below); an
 * objective ends with tested options (`analyst-options.ts`). Both are read,
 * recorded and checked by the same code.
 *
 * One exchange may also search the web (`analyst-events.ts`). That search is
 * run by the API inside a request, not by us, so it does not come back as a
 * call to execute: its queries, its results and the passages it was cited to
 * are read off each response and recorded as steps like any other reading.
 */

export const ANALYST_MODEL = "claude-opus-5-5";

/** Requests to the model for one question. A question that needs more is asking too much at once. */
const MAX_REQUESTS = 16;
/** Drafts sent back for untraced figures before one is accepted with those figures struck. */
const MAX_REJECTED_DRAFTS = 2;

export interface Step {
  /** "s1", "s2", …: what a paragraph cites. */
  id: string;
  tool: string;
  input: unknown;
  ok: boolean;
  /** The tool's result, or `{ error }` when it refused. */
  output: unknown;
  ms: number;
  /**
   * What the tool kept beside its result (`Recorded`): the same reading, whole.
   * Shown and journalled, never sent to the model and never cited.
   */
  record?: unknown;
}

export interface AnalystAnswer {
  paragraphs: { text: string; sources: string[] }[];
  assumptions: string[];
  limits: string[];
  followUps: string[];
  /** Ids of the sites the answer is about, for the map. */
  focusSites: string[];
}

/**
 * What one request to the model was billed for.
 *
 * Input is three things at three prices: read in full, written to the prompt
 * cache (above the base price), or served from it (a small fraction of the
 * base price). A long exchange is cheap or dear by how much of each request is
 * the third kind, so the three are kept apart instead of summed.
 */
export interface RequestUsage {
  /** Input no cache held, billed at the base price. */
  input: number;
  /** Input written to the cache by this request. */
  cacheWrite: number;
  /** Input served from the cache. */
  cacheRead: number;
  output: number;
  /** Web searches the API ran inside this request; present only when the exchange could search. */
  webSearches?: number;
}

export interface AnalystUsage {
  requests: number;
  /** Every input token of every request, whatever it was billed at: the three kinds below, summed. */
  inputTokens: number;
  outputTokens: number;
  /** Web searches the API ran and billed; present only when the exchange could search. */
  webSearches?: number;
  /** Of `inputTokens`, what was written to the cache and what was served from it. The rest was read in full. */
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** One line per request, in order: where an exchange's tokens went, for the journal. */
  byRequest: RequestUsage[];
}

/** What an exchange comes to: `A` is what was delivered, `F` a figure that had to be taken out of it. */
export interface LoopResult<A, F> {
  /**
   * `answered`: an answer, checked. `declined`: the model or its safeguards
   * would not answer. `incomplete`: the loop ended without an answer.
   */
  status: "answered" | "declined" | "incomplete";
  answer: A | null;
  /** True when no figure had to be struck from the answer. */
  verified: boolean;
  /** Figures taken out because no step held them. */
  struck: F[];
  steps: Step[];
  /** Why there is no answer, when there is none. */
  message: string | null;
  /** The model that wrote the answer; differs from the one asked for after a fallback. */
  model: string;
  usage: AnalystUsage;
}

export type LoopEvent<A, F> =
  | { type: "status"; message: string }
  | { type: "step"; step: Step }
  | { type: "done"; result: LoopResult<A, F> };

export type AnalystResult = LoopResult<AnalystAnswer, Finding>;
export type AnalystEvent = LoopEvent<AnalystAnswer, Finding>;

/** What a delivery is checked against: every step so far, and what the person typed. */
export interface Reading {
  steps: Step[];
  /** One ledger per step id: the figures its result holds. Empty for a refusal. */
  ledgers: ReadonlyMap<string, Ledger>;
  /** The figures the person wrote themselves, theirs to use. */
  question: Ledger;
}

/**
 * How an exchange ends.
 *
 * `D` is the delivery once its shape is accepted, `A` what reaches the person,
 * `F` a figure that could not be traced.
 */
export interface Closing<D, A, F> {
  system: string;
  /** The one call the model delivers through. */
  tool: Anthropic.Beta.BetaTool;
  /** The first message: what the person is looking at, and what they asked. */
  opening: string;
  /** What the person typed, word for word. */
  asked: string;
  /**
   * Sent when the model answers in prose instead of through `tool`. Given what
   * was read so far, because for an exchange that searches the web prose is a
   * stage, not a mistake: it is what the passages are cited from, and the reply
   * is where the model learns their step ids.
   */
  nudge: string | ((read: Reading) => string);
  /** How many times prose is answered with `nudge` before giving up. One when absent. */
  proseTurns?: number;
  /**
   * For an exchange whose reading is heavy to send twice. After a prose turn,
   * everything a delivery may rest on, as the one message a new conversation
   * starts from; null when nothing has been recorded yet, and the conversation
   * then goes on as it is, with `nudge`.
   *
   * A search for events reads some seventy thousand tokens of pages, and all a
   * candidate may rest on is the few short passages cited from them. Sending
   * the pages again with the delivery, and a third time when a draft is sent
   * back, was more than half of what a search cost. Once this is used the
   * exchange can search no more: the web tool is not offered again.
   */
  handoff?(read: Reading): string | null;
  /** Said on screen while the first request runs. */
  firstStatus?: string;
  /** Why there is no answer, for each way the loop can end without one. */
  words: { declined: string; tooMuch: string; noForm: string; tooLong: string };
  /** Is this a delivery at all? `invalid` goes back to the model and costs no draft. */
  parse(input: unknown, read: Reading): { data: D } | { invalid: string };
  /**
   * Check every figure. While drafts may still be sent back (`final` false), a
   * figure that cannot be traced returns the draft; once they may not, it is
   * struck and listed.
   */
  check(data: D, read: Reading, final: boolean): { sendBack: string } | { answer: A; struck: F[] };
}

type Message = Anthropic.Beta.BetaMessage;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

/** The one call the loop makes. Narrow, so a test can stand in for the API. */
export interface AnalystModel {
  create(params: CreateParams): Promise<Message>;
}

export function anthropicModel(client: Anthropic): AnalystModel {
  return { create: (params) => client.beta.messages.create(params) };
}

// ---------------------------------------------------------------------------
// What the model is told.
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are the analyst inside Obscyro, a decision-support tool built on the digital twin of a health network. The person asking is a planner or a manager working in the Studio; the context block says what they are looking at. They are not a modeller. They need to understand what the twin and the last simulation run show, well enough to decide something and to defend the decision to someone else.

# What you know

Nothing, until you read it. You have no knowledge of this network: not its hospitals, not its bed counts, not its population. Everything you say about it must come from a tool result in this conversation. General knowledge about health systems may shape how you explain, but it is never the source of a figure and never a fact about this network.

Each tool result comes back as {"step": "s3", "result": ...}. The step id is how you cite it.

# Figures

This is the rule the whole product rests on, so it is enforced by a program, not left to you:

- Every figure in your answer must appear in the result of a step that the same paragraph cites, or in the person's own question.
- A figure you derive (a difference, a ratio, a percentage, a total, a rate) must be computed with the calculate tool, and the paragraph must cite that step. Do not do arithmetic yourself, even when it is easy.
- You may round a figure the way a person would (7,316 as "about 7,300"; 0.941 as "94 %"). You may not change it. Counts of people and percentages come from the tools already rounded as the screen shows them: write them as given, do not round them again.
- A figure belongs to the row it was read in. When you name several sites or catchments with a figure each, take each pair from the same row of the result, one row at a time. The checker also verifies that a figure written beside a name is in that name's row.
- After you answer, a checker looks up every figure in the steps the paragraph cites. A figure it cannot find is sent back to you, and if it still cannot be found it is removed from the answer and replaced by a gap the person will see. A gap is worse than a sentence without a number: if you cannot source a figure, write the sentence without it.

# How to work

1. Read before you write. Start from what the person is looking at (given in the context block). If you do not know the names this twin uses, call describe_twin first.
2. Read what the question needs and no more. Most questions take two to six calls. Do not call a tool twice with the same input.
3. If a tool refuses (an unknown name, no run on screen), read its message: it says what to do instead.
4. If the tools cannot answer the question, say exactly what is missing. Never fill the gap with an estimate.
5. When you are done, call give_answer once, on its own, with nothing else in that turn. Do not write the answer as plain text.

# What a good answer is

- It answers the question in its first sentence, then gives the reasons.
- It is in plain words, in the language the person wrote in. No jargon the person did not use; if a term from the twin needs explaining, explain it once.
- It names sites and catchments as the twin names them.
- It keeps three things apart: what the twin records (a fact about the network), what a run produced (the result of a model under stated conditions, not a forecast), and what is an assumption of the scenario.
- It is short: two to five paragraphs, a few sentences each. One idea per paragraph, each citing the steps it rests on.
- It states the mechanism, not only the number: why a site queues while its neighbour has room, what the added beds changed and where.

# What is open now

list_alerts and unit_now read the network as it stands this minute: the open alerts, and a unit's figures exactly as its page shows them. Four rules go with them.

- A live value is never given without its age. Write the age the tool gives ("value read 37 min ago", "at least 2 h ago"). When the age is unknown, say so, with the reason the tool gives. Acting fast on an old value is the danger.
- No open alert is not good news by itself. Say when the thresholds were last checked, and when the project has no alert rule, say that nothing could have opened.
- There is no history. You cannot say what was open earlier, or what changed since this morning: say that, do not infer it.
- unit_now counts everything under a unit, its sub-units included, which is what the unit page shows. get_site counts what stands at a site itself, which is what a run uses. When the two could be confused, say which one you are giving.

# Published events

list_events returns the events a person validated from official web sources, each with the source that published it and a short quoted passage. They are their own kind of thing, and you keep it apart from the others: not a fact the twin records, not a result of a run, not an assumption of the scenario, but what a source published. Introduce one as what its source states ("according to quebec.ca, …"), cite the step, and never write it as something the twin measured. When day 0 has a calendar date the tool places each event on the run's days: use those days as given, and do not convert a date into a day yourself. You cannot search the web here. If nothing validated covers the moment asked about, say so, and say that events are found and validated in the Event finder tab.

# What you do not do

- You do not decide. When asked what should be done, set out what the evidence supports, what each option would change according to what was read, and what would have to be run to test an option that has not been run. You cannot run a simulation yourself: tell the person what to place on the map and run.
- You do not present a model result as a prediction of what will happen.
- You follow the system, not people. The twin holds counts and capacities, never a person's record, and you never reason about an individual.
- You do not claim an action was taken. Your tools only read.

# give_answer

- paragraphs: the answer. Each has its text and the step ids its figures and claims come from.
- assumptions: what the answer depends on that is assumed rather than recorded, such as the scenario's starting conditions. One short sentence each. Empty if none.
- limits: what the twin or the run cannot say that matters for this question, such as no staff, no stocks, no transfers between sites, a run that was edited since. One short sentence each. Empty if none.
- follow_ups: up to three short questions the person could ask next and that your tools could answer.
- focus_sites: ids of up to five sites the answer is about, so the map can point at them. Empty if the answer is not about particular sites.`;

const GIVE_ANSWER: Anthropic.Beta.BetaTool = {
  name: "give_answer",
  description:
    "Deliver your answer to the person. Call it once, on its own, when you have read everything you need. Every figure in a paragraph must be in the result of a step that paragraph cites, or in the question.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      paragraphs: {
        type: "array",
        description: "The answer, two to five short paragraphs, the direct answer first.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Plain sentences. No markdown, no lists, no headings." },
            sources: {
              type: "array",
              description: "Ids of the steps this paragraph's figures and claims come from, for example [\"s2\", \"s5\"].",
              items: { type: "string" },
            },
          },
          required: ["text", "sources"],
          additionalProperties: false,
        },
      },
      assumptions: { type: "array", items: { type: "string" }, description: "What the answer assumes rather than reads. May be empty." },
      limits: { type: "array", items: { type: "string" }, description: "What the twin or the run cannot say that matters here. May be empty." },
      follow_ups: { type: "array", items: { type: "string" }, description: "Up to three next questions the tools could answer." },
      focus_sites: { type: "array", items: { type: "string" }, description: "Ids of up to five sites the answer is about." },
    },
    required: ["paragraphs", "assumptions", "limits", "follow_ups", "focus_sites"],
    additionalProperties: false,
  },
};

const answerInput = z.object({
  paragraphs: z
    .array(z.object({ text: z.string().trim().min(1).max(2400), sources: z.array(z.string().max(12)).max(40) }))
    .min(1)
    .max(8),
  assumptions: z.array(z.string().trim().min(1).max(600)).max(10),
  limits: z.array(z.string().trim().min(1).max(600)).max(10),
  follow_ups: z.array(z.string().trim().min(1).max(300)).max(5),
  focus_sites: z.array(z.string().max(80)).max(10),
});

/**
 * What the person has in front of them when they ask from somewhere other than
 * the Scenarios map. Resolved by the server from ids: no name here was typed by
 * the caller.
 */
export interface AskFocus {
  /** The Studio page, as its address names it. */
  page: string | null;
  unit: { id: string; name: string } | null;
  signal: { id: string; title: string; kind: string; stage: string; step: string; unitId: string | null } | null;
}

export interface AskInput {
  question: string;
  /** What the person is looking at. */
  looking: "reality" | "scenario";
  focus?: AskFocus | null;
}

function contextBlock(ctx: AnalystContext, input: AskInput): string {
  const lines = [`Environment: ${ctx.environment}`];
  if (ctx.scenario) {
    lines.push(`Open scenario: "${ctx.scenario.name}"`);
    lines.push(
      input.looking === "scenario"
        ? "The person is looking at the scenario world (the twin with this scenario's edits). Read that world unless they ask about reality."
        : "The person is looking at reality (the twin as it stands), with the scenario set aside. Read that world unless they ask about the scenario.",
    );
  } else {
    lines.push("No scenario is open. Only the 'reality' world exists.");
  }
  if (ctx.run) {
    lines.push(
      `A run is on screen: ${ctx.run.horizon} days, activity "${ctx.run.activity}", ran at ${ctx.run.ranAt}` +
        (ctx.run.stale ? ". The scenario was edited after it, so it is out of date." : ", up to date with the scenario."),
    );
  } else {
    lines.push("No run is on screen.");
  }
  const focus = input.focus;
  if (focus?.page) lines.push(`The person is on the "${focus.page}" page of the Studio.`);
  if (focus?.unit) {
    lines.push(`They have a unit selected: "${focus.unit.name}" (id ${focus.unit.id}). unit_now and list_alerts take this id.`);
  }
  if (focus?.signal) {
    const s = focus.signal;
    lines.push(
      `They have a signal open: "${s.title}" (${s.kind}, at the stage "${s.stage}", step ${s.step})` +
        (s.unitId ? `, about the unit with id ${s.unitId}.` : "."),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The loop.
// ---------------------------------------------------------------------------

type ContentBlock = Anthropic.Beta.BetaContentBlock;

/**
 * An assistant turn, as it must be sent back.
 *
 * Unchanged, except after a fallback: blocks the declining model produced
 * before the handover (its thinking, its tool calls) belong to a model that is
 * no longer in the conversation and must not be echoed. The `fallback` block
 * itself stays where it was.
 */
export function echo(content: ContentBlock[]): ContentBlock[] {
  let boundary = -1;
  content.forEach((b, i) => {
    if (b.type === "fallback") boundary = i;
  });
  if (boundary < 0) return content;
  return content.filter(
    (b, i) => i >= boundary || !(b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use"),
  );
}

function describeFindings(findings: Finding[], draft: AnswerDraft): string {
  const lines = findings.map((f) => {
    const figures = f.figures.map((x) => `"${x}"`).join(", ");
    if (f.misattributed) {
      return f.misattributed
        .map(
          (m) =>
            `- Paragraph ${f.index + 1}: "${m.figure}" is written about ${m.saidOf}, but in the steps cited that figure is in the row of ${m.belongsTo.join(" or ")}, not in ${m.saidOf}'s. Re-read the rows and correct the sentence.`,
        )
        .join("\n");
    }
    if (f.where === "paragraph") {
      const cited = draft.paragraphs[f.index]!.sources;
      return `- Paragraph ${f.index + 1}: ${figures} ${f.figures.length === 1 ? "is" : "are"} not in the results of the steps it cites (${cited.join(", ") || "none cited"}) nor in the question.`;
    }
    return `- ${f.where === "assumption" ? "Assumption" : "Limit"} ${f.index + 1}: ${figures} ${f.figures.length === 1 ? "is" : "are"} not in any result read.`;
  });
  return (
    "The answer was not delivered. These figures could not be traced, or are written beside the wrong name:\n" +
    lines.join("\n") +
    "\nFor a figure that could not be traced: cite the step that holds it, or compute it with calculate and cite that step, or rewrite the sentence without the figure. " +
    "For a figure beside the wrong name: go back to the row of that name in the step and copy its own figure. Then call give_answer again with the whole answer."
  );
}

type AnswerInput = z.infer<typeof answerInput>;

/** How a question ends: `give_answer`, each paragraph checked against the steps it cites. */
export function askClosing(ctx: AnalystContext, input: AskInput): Closing<AnswerInput, AnalystAnswer, Finding> {
  const draftOf = (data: AnswerInput, read: Reading): AnswerDraft => {
    const known = new Set(read.steps.map((s) => s.id));
    return {
      // A source that names no step is dropped rather than trusted.
      paragraphs: data.paragraphs.map((p) => ({ text: p.text, sources: [...new Set(p.sources)].filter((s) => known.has(s)) })),
      assumptions: data.assumptions,
      limits: data.limits,
    };
  };
  return {
    system: SYSTEM_PROMPT,
    tool: GIVE_ANSWER,
    opening: `<context>\n${contextBlock(ctx, input)}\n</context>\n\n<question>\n${input.question}\n</question>`,
    asked: input.question,
    nudge: "Deliver the answer by calling give_answer, with each paragraph citing the steps it rests on. Do not answer in plain text.",
    words: {
      declined: "The model declined to answer this question. Nothing was made up in its place. Try asking about what the twin or the run shows.",
      tooMuch: "The question needed more reading than one answer allows. Ask about one site, one catchment or one part of the run at a time.",
      noForm: "The analyst did not deliver an answer in a form that could be checked, so none is shown.",
      tooLong: "The analyst read for too long without reaching an answer. Ask a narrower question.",
    },
    parse(raw) {
      const parsed = answerInput.safeParse(raw);
      return parsed.success
        ? { data: parsed.data }
        : { invalid: `The answer was not delivered: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.` };
    },
    check(data, read, final) {
      const draft = draftOf(data, read);
      const checked = checkAnswer(draft, read.ledgers, read.question);
      if (checked.findings.length > 0 && !final) return { sendBack: describeFindings(checked.findings, draft) };
      return {
        answer: {
          paragraphs: checked.struck.paragraphs,
          assumptions: checked.struck.assumptions,
          limits: checked.struck.limits,
          followUps: data.follow_ups.slice(0, 3),
          focusSites: data.focus_sites.slice(0, 5),
        },
        struck: checked.findings,
      };
    },
  };
}

/** A question about the twin, a scenario or the run on screen, answered from what the tools read. */
export function ask(
  model: AnalystModel,
  ctx: AnalystContext,
  input: AskInput,
  onEvent: (e: AnalystEvent) => void = () => {},
  tools: AnalystTool[] = READ_TOOLS,
  /** Aborts when nobody is waiting for the answer any more. */
  gone?: AbortSignal,
): Promise<AnalystResult> {
  return converse(model, ctx, askClosing(ctx, input), onEvent, tools, gone);
}

/**
 * The exchange itself: the model reads through tools until it delivers through
 * the closing's call, and what it delivers is checked before anyone sees it.
 */
export async function converse<D, A, F>(
  model: AnalystModel,
  ctx: AnalystContext,
  closing: Closing<D, A, F>,
  onEvent: (e: LoopEvent<A, F>) => void = () => {},
  tools: AnalystTool[] = READ_TOOLS,
  /** Aborts when nobody is waiting for the answer any more. */
  gone?: AbortSignal,
  /** Lets the model search the web, within these sources and this many searches. */
  web?: WebSearch,
): Promise<LoopResult<A, F>> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const steps: Step[] = [];
  const ledgers = new Map<string, Ledger>();
  const question = new Ledger();
  question.addText(closing.asked);
  ctx.known.absorb(question);
  const read: Reading = { steps, ledgers, question };

  const usage: AnalystUsage = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    ...(web ? { webSearches: 0 } : {}),
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    byRequest: [],
  };
  let servedBy = ANALYST_MODEL;
  let rejected = 0;
  let nudges = 0;
  // True once the reading was handed over to a new conversation: no search from there on.
  let delivering = false;
  const reader = new WebReader();

  /** A step, numbered, with what a sentence may take from it. */
  const keep = (s: Omit<Step, "id">, ledger: Ledger): Step => {
    const step: Step = { id: `s${steps.length + 1}`, ...s };
    steps.push(step);
    ledgers.set(step.id, ledger);
    ctx.known.absorb(ledger);
    onEvent({ type: "step", step });
    return step;
  };

  const finish = (r: Pick<LoopResult<A, F>, "status" | "answer" | "verified" | "struck" | "message">): LoopResult<A, F> => {
    const result: LoopResult<A, F> = { ...r, steps, model: servedBy, usage };
    onEvent({ type: "done", result });
    return result;
  };

  const messages: MessageParam[] = [{ role: "user", content: closing.opening }];

  for (let turn = 0; turn < MAX_REQUESTS; turn++) {
    if (gone?.aborted) {
      return finish({ status: "incomplete", answer: null, verified: false, struck: [], message: "Stopped before an answer was reached." });
    }
    onEvent({ type: "status", message: steps.length === 0 ? (closing.firstStatus ?? "Reading the question") : "Deciding what to read next" });
    const res = await model.create({
      model: ANALYST_MODEL,
      max_tokens: 16000,
      // Thinking is always on for this model; effort is the control. Medium is
      // its default, set here so a change of default cannot change the product.
      output_config: { effort: "medium" },
      // A safeguard that misfires on a question about an epidemic should not
      // take the analyst down: a declined request is retried on the model
      // Anthropic recommends for that category.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // The system prompt and the tools never change, and each request repeats
      // everything before it: cached, a long exchange costs a fraction.
      cache_control: { type: "ephemeral" },
      system: closing.system,
      tools: [
        ...tools.map((t): Anthropic.Beta.BetaTool => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        // Gone after a handoff, so the cap on searches holds for the whole
        // exchange: the API counts searches per conversation, and this is a new one.
        ...(web && !delivering ? [webSearchTool(web)] : []),
        closing.tool,
      ],
      messages,
    });
    const billed: RequestUsage = {
      input: res.usage.input_tokens,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      output: res.usage.output_tokens,
      ...(web ? { webSearches: res.usage.server_tool_use?.web_search_requests ?? 0 } : {}),
    };
    usage.requests += 1;
    usage.inputTokens += billed.input + billed.cacheWrite + billed.cacheRead;
    usage.outputTokens += billed.output;
    usage.cacheWriteTokens += billed.cacheWrite;
    usage.cacheReadTokens += billed.cacheRead;
    usage.byRequest.push(billed);
    if (web) usage.webSearches = (usage.webSearches ?? 0) + (billed.webSearches ?? 0);
    servedBy = res.model;

    if (res.stop_reason === "refusal") {
      return finish({ status: "declined", answer: null, verified: false, struck: [], message: closing.words.declined });
    }
    if (res.stop_reason === "max_tokens" || res.stop_reason === "model_context_window_exceeded") {
      return finish({ status: "incomplete", answer: null, verified: false, struck: [], message: closing.words.tooMuch });
    }

    // What the API searched and cited inside this request. A search result
    // carries no fact a sentence may lean on — only a passage does.
    for (const s of reader.read(res.content)) {
      const passage = s.tool === WEB_PASSAGE ? passageOf(s.output) : null;
      keep({ ...s, ms: 0 }, passage ? passageLedger(passage) : new Ledger());
    }

    messages.push({ role: "assistant", content: echo(res.content) });

    // The API paused a long search turn: the same turn goes back as it is, and
    // the API carries on. A user message here would end the turn instead.
    if (res.stop_reason === "pause_turn") {
      onEvent({ type: "status", message: "Still searching" });
      continue;
    }

    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (uses.length === 0) {
      // It answered in prose. Prose has no sources, so it cannot be checked
      // paragraph by paragraph: ask for the answer in its proper form.
      if (nudges < (closing.proseTurns ?? 1)) {
        nudges += 1;
        const fresh = closing.handoff?.(read) ?? null;
        if (fresh !== null) {
          // What was read stays in the steps and the journal. The model is
          // sent what a delivery may rest on, and not the pages again.
          messages.length = 0;
          messages.push({ role: "user", content: fresh });
          delivering = true;
        } else {
          messages.push({ role: "user", content: typeof closing.nudge === "string" ? closing.nudge : closing.nudge(read) });
        }
        continue;
      }
      return finish({ status: "incomplete", answer: null, verified: false, struck: [], message: closing.words.noForm });
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      if (use.name === closing.tool.name) {
        // A search asked for in the same breath has not run yet: the API runs
        // it on the next request, once this call is answered.
        if (uses.length > 1 || reader.waiting > 0) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: `${closing.tool.name} must be called on its own, after you have read the results of your other calls. Read them, then call it again.`,
          });
          continue;
        }
        const parsed = closing.parse(use.input, read);
        if ("invalid" in parsed) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: parsed.invalid });
          continue;
        }
        onEvent({ type: "status", message: "Checking every figure against what was read" });
        const checked = closing.check(parsed.data, read, rejected >= MAX_REJECTED_DRAFTS);
        if ("sendBack" in checked) {
          rejected += 1;
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: checked.sendBack });
          continue;
        }
        return finish({ status: "answered", answer: checked.answer, verified: checked.struck.length === 0, struck: checked.struck, message: null });
      }

      const tool = byName.get(use.name);
      const started = Date.now();
      let ok = true;
      let output: unknown;
      let record: unknown;
      if (!tool) {
        ok = false;
        output = { error: `There is no tool called "${use.name}".` };
      } else {
        const parsed = tool.parse.safeParse(use.input);
        if (!parsed.success) {
          ok = false;
          output = { error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}.` };
        } else {
          try {
            if (tool.busy) onEvent({ type: "status", message: tool.busy });
            output = await tool.run(ctx, parsed.data);
            // What the tool kept for the screen stays out of what the model reads.
            if (output instanceof Recorded) {
              record = output.record;
              output = output.result;
            }
          } catch (err) {
            // A tool's refusal is information for the model. Anything else is
            // a fault of ours and must not be dressed up as one.
            if (!(err instanceof ToolError)) throw err;
            ok = false;
            output = { error: err.message };
          }
        }
      }
      // A refusal carries no facts: only what a tool returned can be cited.
      const ledger = new Ledger();
      if (ok) ledger.addJson(output);
      const step = keep({ tool: use.name, input: use.input, ok, output, ms: Date.now() - started, ...(record !== undefined ? { record } : {}) }, ledger);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        ...(ok ? {} : { is_error: true }),
        content: JSON.stringify({ step: step.id, result: output }),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return finish({ status: "incomplete", answer: null, verified: false, struck: [], message: closing.words.tooLong });
}
