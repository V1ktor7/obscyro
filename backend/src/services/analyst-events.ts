import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { Closing, Reading, Step } from "./analyst.js";
import { Ledger, strike, unsourced } from "./analyst-verify.js";
import {
  QUOTE_MAX_WORDS,
  WEB_PASSAGE,
  WEB_SEARCH,
  bareQuote,
  dateStated,
  excerpt,
  passageOf,
  quotedFrom,
  wordsIn,
  type WebPassage,
  type WebSearch,
} from "./analyst-web.js";
import { sourceAllows } from "./web-sources.js";

/**
 * The event finder: what was happening around the network, from official
 * sources, proposed one candidate at a time.
 *
 * The analyst knows the twin and nothing else. It cannot say a curfew began on
 * a given day. Here it may search the web — only the sources the project
 * allows, only so many times — and what it finds is a list of candidate
 * events. A candidate is a proposal: it enters the calendar when a person
 * accepts it, and not before (`health-events.ts`).
 *
 * This exchange is kept apart from the others on purpose. The model is handed
 * no tool that reads the twin, a scenario or a dataset, and its context names
 * none of them: there is nothing of the organisation's it could put into a
 * search. A query can only hold what the person typed — a place, a period, a
 * subject.
 *
 * What the model writes and what it does not. It writes the title, the place,
 * and picks the door. The link, the page's title and the passage are the
 * API's, taken from the citations of its own sentences; the quotation is its
 * choice of words *inside* a passage and is checked to be there; a date is
 * kept only when a passage states it. Whatever fails is taken out, and the
 * person is told what to enter from the source.
 */

/** Searches for one request. Each one is billed, and ten pages of results is a lot to read. */
export const MAX_SEARCHES = 8;
export const MAX_CANDIDATES = 12;

/** How an event reaches a health network. The same four as `docs/decision-loop.md`. */
export const DOORS = ["demand", "capacity", "access", "care"] as const;
export type Door = (typeof DOORS)[number];

export function eventSearch(domains: string[]): WebSearch {
  return { domains, maxUses: MAX_SEARCHES };
}

export const EVENTS_PROMPT = `You are the analyst inside Obscyro, a decision-support tool for a health network. A planner is looking at a scenario on a map and needs to know what was happening around the network at the time: public health measures, closures, weather alerts, outbreaks, strikes. In this exchange your job is to find such events in official sources, for the place and the period the person names, and to propose each one as a candidate. A person will accept or reject every candidate before it enters the calendar. You propose; you do not decide.

# What you know

Nothing about the network. In this exchange you have no access to the twin, to the scenario or to any of the organisation's data, and none of it may go into a search. A search query holds only a place, a period and a subject.

Nothing about the period either, as far as the person is concerned: what you remember of it is not a source. An event exists here only if an allowed source returned it.

# How to work

1. Search with web_search. Results come only from the sources this project allows; they are listed in the context. You have at most ${MAX_SEARCHES} searches for the whole request, so plan them: one subject per search, in the language of the source (French for Québec government sites) and in English when that helps.
2. Then write what you found as plain sentences, one or two per event, each stating the event and its dates the way the source states them. Write them from the search results, so that each sentence carries its citation. This is how a passage gets recorded: an event you wrote no cited sentence about has no passage, and cannot be proposed.
3. You will then be sent the passages that were recorded, each with an id (s4, s5, …). Deliver the candidates by calling give_events once, on its own.

# A candidate

- title: what happened, in a few plain words, in the language the person wrote in. No figure that is not in the candidate's passages.
- start_date, end_date: YYYY-MM-DD. A date must be stated in one of the passages the candidate cites: the day and the month in the passage itself, the year in the passage or in the person's request. If the passages do not state the day, give an empty string; the person will read the source and enter it. Never infer a date and never compute one. end_date is empty when the source states no end, or when the event lasted one day.
- place: where it applied, as the source says it: a city, a region, a province.
- door: how the event reaches a health network.
  - demand: more people need care (an outbreak, a heat wave).
  - capacity: less to care with (a strike, beds closed, a power failure).
  - access: people cannot reach care, or are kept from moving (a curfew, a lockdown, a closed road, a storm).
  - care: each patient needs more, or for longer (a more severe strain, a change of protocol).
- passages: the ids of one to three recorded passages the candidate rests on.
- quote: fewer than fifteen words copied exactly, character for character, from one of those passages. It is shown in quotation marks beside the link, so choose the words that state the event.

One candidate per event. A measure and its lifting are one candidate when the passages give both dates; two different measures are two candidates.

# What you do not do

- You do not state what the passages do not say. If the allowed sources did not return something the person asked for, it goes in not_found, in one sentence.
- You do not judge an event, or say what should have been done.
- You follow the system, not people: nothing about an individual's health, and no named person other than an office holder acting in that role.

# give_events

- candidates: as above. May be empty.
- not_found: what was asked for and not found in the allowed sources. One short sentence each. May be empty.
- limits: what these candidates cannot say that matters, for example that a source gives the day a measure was announced and not the day it came into force. One short sentence each. May be empty.`;

const GIVE_EVENTS: Anthropic.Beta.BetaTool = {
  name: "give_events",
  description:
    "Deliver the candidate events. Call it once, on its own, after you have written your cited sentences and been sent the ids of the recorded passages. Every candidate cites passages, quotes one of them exactly, and gives only dates those passages state.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        description: `Up to ${MAX_CANDIDATES} candidate events, in date order.`,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "What happened, in a few plain words." },
            start_date: { type: "string", description: "YYYY-MM-DD, or an empty string when the passages do not state the day." },
            end_date: { type: "string", description: "YYYY-MM-DD, or an empty string when no end is stated or the event lasted one day." },
            place: { type: "string", description: "Where it applied, as the source says it." },
            door: { type: "string", enum: [...DOORS], description: "How the event reaches a health network." },
            passages: { type: "array", items: { type: "string" }, description: 'Ids of the recorded passages it rests on, for example ["s4"].' },
            quote: { type: "string", description: "Fewer than fifteen words copied exactly from one of those passages." },
          },
          required: ["title", "start_date", "end_date", "place", "door", "passages", "quote"],
          additionalProperties: false,
        },
      },
      not_found: { type: "array", items: { type: "string" }, description: "What was asked for and not found in the allowed sources. May be empty." },
      limits: { type: "array", items: { type: "string" }, description: "What these candidates cannot say that matters. May be empty." },
    },
    required: ["candidates", "not_found", "limits"],
    additionalProperties: false,
  },
};

const day = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "write YYYY-MM-DD, or an empty string");
const line = z.string().trim().min(1).max(600);
const eventsInput = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        start_date: day,
        end_date: day,
        place: z.string().trim().min(1).max(200),
        door: z.enum(DOORS),
        passages: z.array(z.string().max(12)).min(1).max(3),
        quote: z.string().trim().min(1).max(400),
      }),
    )
    .max(MAX_CANDIDATES),
  not_found: z.array(line).max(10),
  limits: z.array(line).max(10),
});
type EventsInput = z.infer<typeof eventsInput>;

// ---------------------------------------------------------------------------
// What the person receives.
// ---------------------------------------------------------------------------

/** A passage a candidate rests on, with the step that recorded it. */
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
  /** Dates the model gave that no passage states, taken out. */
  datesRemoved: ("start" | "end")[];
  place: string;
  door: Door;
  /** The page the quotation is from. */
  url: string;
  sourceTitle: string;
  /** Fewer than fifteen words, found word for word in a passage. */
  quote: string;
  /** True when the model's quotation was in no passage, and the passage's opening words stand in for it. */
  quoteReplaced: boolean;
  passages: CandidatePassage[];
  /** Assigned here, never by the model: a candidate is what a source published. */
  evidence: "published";
}

export interface EventsProposal {
  request: string;
  /** The domains the search was restricted to. */
  sources: string[];
  /** Searches the API ran. */
  searches: number;
  candidates: EventCandidate[];
  notFound: string[];
  limits: string[];
}

export interface EventsFinding {
  where: "title" | "place" | "quote" | "start_date" | "end_date" | "dates" | "source" | "not_found" | "limit";
  /** The candidate's position as delivered, from zero; null for not_found and limits. */
  candidate: number | null;
  /** Position in its list, from zero. */
  index: number;
  /** What could not be traced, as written. */
  figures: string[];
}

export interface EventsAsk {
  request: string;
  /** The project's allowed sources. */
  domains: string[];
  /** Today, YYYY-MM-DD: so "last winter" means something. */
  today: string;
}

const isPassage = (s: Step): boolean => s.tool === WEB_PASSAGE && s.ok;

function recorded(read: Reading): CandidatePassage[] {
  return read.steps.filter(isPassage).flatMap((s) => {
    const p = passageOf(s.output);
    return p ? [{ step: s.id, url: p.url, title: p.title, text: p.cited_text }] : [];
  });
}

function listPassages(passages: CandidatePassage[]): string {
  return passages.map((p) => `${p.step} | ${p.url} | ${p.title || "untitled"} | "${p.text}"`).join("\n");
}

function afterProse(read: Reading): string {
  const passages = recorded(read);
  if (passages.length === 0) {
    return (
      "No passage was recorded: your sentences carried no citation, so there is nothing a candidate could rest on. " +
      "Either search and write what the results state, sentence by sentence, or call give_events with no candidate and say in not_found what the allowed sources did not return."
    );
  }
  return (
    "These passages were recorded from your cited sentences. They are the only text a candidate may rest on:\n" +
    listPassages(passages) +
    "\n\nNow deliver by calling give_events, on its own. Each candidate cites the ids of its passages, its quote is copied exactly from one of them, and its dates are the ones those passages state."
  );
}

const asWeb = (p: CandidatePassage): WebPassage => ({ url: p.url, title: p.title, cited_text: p.text });

const realDay = (iso: string): boolean => {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

function describeFindings(findings: EventsFinding[], passages: CandidatePassage[]): string {
  const say = (f: EventsFinding): string => {
    const n = f.candidate === null ? "" : `Candidate ${f.candidate + 1}`;
    const what = f.figures.map((x) => `"${x}"`).join(", ");
    switch (f.where) {
      case "title":
        return `- ${n}, title: ${what} ${f.figures.length === 1 ? "is" : "are"} not in the passages it cites nor in the request.`;
      case "place":
        return `- ${n}, place: ${what} ${f.figures.length === 1 ? "is" : "are"} not in the passages it cites nor in the request.`;
      case "quote":
        return `- ${n}, quote: ${what} is not, word for word and in fewer than fifteen words, in any passage it cites. Copy the words from the passage itself.`;
      case "start_date":
        return `- ${n}, start_date: ${what} is not stated in the passages it cites. Give the date the passage states, or an empty string.`;
      case "end_date":
        return `- ${n}, end_date: ${what} is not stated in the passages it cites. Give the date the passage states, or an empty string.`;
      case "dates":
        return `- ${n}: end_date ${what} is before start_date.`;
      case "source":
        return `- ${n}: its passage is from ${what}, which is outside the sources this project allows. Rest it on a passage from an allowed source, or leave it out.`;
      case "not_found":
        return `- not_found ${f.index + 1}: ${what} ${f.figures.length === 1 ? "is" : "are"} not in any passage nor in the request.`;
      default:
        return `- Limit ${f.index + 1}: ${what} ${f.figures.length === 1 ? "is" : "are"} not in any passage nor in the request.`;
    }
  };
  return (
    "The candidates were not delivered. These could not be traced to the passages:\n" +
    findings.map(say).join("\n") +
    "\n\nThe recorded passages are:\n" +
    listPassages(passages) +
    "\n\nCorrect each one, then call give_events again with everything."
  );
}

/**
 * How a search for events ends.
 *
 * The delivery is checked against the passages and nothing else. On the last
 * allowed draft, what still cannot be traced is taken out rather than shown:
 * a date becomes blank, a quotation becomes the passage's own opening words, a
 * figure in a title is struck, and a candidate resting on a page outside the
 * allowed sources is dropped.
 */
export function eventsClosing(input: EventsAsk): Closing<EventsInput, EventsProposal, EventsFinding> {
  return {
    system: EVENTS_PROMPT,
    tool: GIVE_EVENTS,
    opening:
      `<context>\nToday is ${input.today}.\nSources you may search: ${input.domains.join(", ")}.\nSearches allowed: ${MAX_SEARCHES}.\n</context>\n\n` +
      `<request>\n${input.request}\n</request>`,
    asked: input.request,
    nudge: afterProse,
    // Prose is expected once, after the searches; a second round covers a search made late.
    proseTurns: 2,
    firstStatus: "Searching the allowed sources",
    words: {
      declined: "The model declined to search for this. Nothing was made up in its place. Name a place, a period and a kind of event.",
      tooMuch: "The request needed more searching than one exchange allows. Ask for one kind of event, or a shorter period.",
      noForm: "The analyst did not deliver its candidates in a form that could be checked, so none is shown.",
      tooLong: "The analyst searched for too long without delivering candidates. Ask for one kind of event, or a shorter period.",
    },
    parse(raw, read) {
      const parsed = eventsInput.safeParse(raw);
      if (!parsed.success) {
        return { invalid: `The candidates were not delivered: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.` };
      }
      const passages = recorded(read);
      const known = new Set(passages.map((p) => p.step));
      const strangers = [...new Set(parsed.data.candidates.flatMap((c) => c.passages).filter((id) => !known.has(id)))];
      if (strangers.length) {
        return {
          invalid:
            `The candidates were not delivered: ${strangers.join(", ")} ${strangers.length === 1 ? "is" : "are"} not a recorded passage. ` +
            (passages.length
              ? `A candidate can only rest on these:\n${listPassages(passages)}`
              : "No passage has been recorded yet: write what the search results state, as cited sentences, before delivering."),
        };
      }
      return { data: parsed.data };
    },
    check(data, read, final) {
      const passages = recorded(read);
      const byStep = new Map(passages.map((p) => [p.step, p]));
      const everything = new Ledger();
      everything.absorb(read.question);
      for (const p of passages) everything.absorb(read.ledgers.get(p.step)!);

      const findings: EventsFinding[] = [];
      const candidates: EventCandidate[] = [];
      data.candidates.forEach((c, i) => {
        const cited = [...new Set(c.passages)].map((id) => byStep.get(id)!);
        const own = new Ledger();
        own.absorb(read.question);
        for (const p of cited) own.absorb(read.ledgers.get(p.step)!);
        const at = (where: EventsFinding["where"], figures: string[]) => findings.push({ where, candidate: i, index: 0, figures });

        const badTitle = unsourced(c.title, own);
        if (badTitle.length) at("title", badTitle.map((t) => t.raw));
        const badPlace = unsourced(c.place, own);
        if (badPlace.length) at("place", badPlace.map((t) => t.raw));

        const quote = bareQuote(c.quote);
        const from = wordsIn(quote) <= QUOTE_MAX_WORDS ? quotedFrom(quote, cited.map((p) => ({ ...asWeb(p), step: p.step }))) : null;
        if (!from) at("quote", [c.quote]);
        // The page the quotation is from is the candidate's source; failing that, the first passage it cites.
        const source = from ? byStep.get(from.step)! : cited[0]!;
        const offList = !sourceAllows(input.domains, source.url);
        if (offList) at("source", [source.url]);

        const web = cited.map(asWeb);
        const stated = (iso: string): boolean => realDay(iso) && dateStated(iso, web, read.question);
        let startDate = c.start_date || null;
        let endDate = c.end_date || null;
        const datesRemoved: EventCandidate["datesRemoved"] = [];
        if (startDate && !stated(startDate)) {
          at("start_date", [startDate]);
          startDate = null;
          datesRemoved.push("start");
        }
        if (endDate && !stated(endDate)) {
          at("end_date", [endDate]);
          endDate = null;
          datesRemoved.push("end");
        }
        if (startDate && endDate && endDate < startDate) {
          at("dates", [endDate]);
          endDate = null;
          datesRemoved.push("end");
        }

        if (offList) return;
        candidates.push({
          id: `c${candidates.length + 1}`,
          title: strike(c.title, badTitle),
          startDate,
          endDate,
          datesRemoved,
          place: strike(c.place, badPlace),
          door: c.door,
          url: source.url,
          sourceTitle: source.title,
          quote: from ? quote : excerpt(source.text),
          quoteReplaced: !from,
          passages: cited,
          evidence: "published",
        });
      });

      const loose = (where: "not_found" | "limit", items: string[]) =>
        items.map((text, index) => {
          const bad = unsourced(text, everything);
          if (bad.length) findings.push({ where, candidate: null, index, figures: bad.map((t) => t.raw) });
          return strike(text, bad);
        });
      const notFound = loose("not_found", data.not_found);
      const limits = loose("limit", data.limits);

      if (findings.length && !final) return { sendBack: describeFindings(findings, passages) };
      return {
        answer: {
          request: input.request,
          sources: input.domains,
          searches: read.steps.filter((s) => s.tool === WEB_SEARCH).length,
          candidates,
          notFound,
          limits,
        },
        struck: findings,
      };
    },
  };
}
