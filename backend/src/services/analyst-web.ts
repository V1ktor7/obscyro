import type Anthropic from "@anthropic-ai/sdk";

import { Ledger, numbersIn } from "./analyst-verify.js";

/**
 * The web, as the analyst is allowed to read it.
 *
 * The search itself is not ours: it is the Claude API's web search tool, run on
 * Anthropic's side inside a request. What is ours is what we keep of it and
 * what we let rest on it.
 *
 * The API hands back three things in the clear: each query, the pages a query
 * returned (address and title, their content stays encrypted), and — when the
 * model writes a sentence from a page — the short passage of that page the
 * sentence is cited to (`cited_text`, 150 characters at most). That passage is
 * the only text of a web page this server ever holds, so it is the unit of
 * proof: a date or a figure "from the web" counts only if it is in a passage.
 *
 * Searches are called directly (`allowed_callers: ["direct"]`), not from the
 * API's code sandbox. Three reasons: every query and every result then shows
 * as a step; the cap on searches holds across the requests of one exchange,
 * which it does not for searches run from the sandbox; and nothing is executed
 * anywhere on our behalf.
 */

type ContentBlock = Anthropic.Beta.BetaContentBlock;

export interface WebSearch {
  /** The only domains results may come from: the project's list. */
  domains: string[];
  /** Searches allowed for one exchange. */
  maxUses: number;
}

export const WEB_SEARCH = "web_search";
export const WEB_PASSAGE = "web_passage";

export function webSearchTool(web: WebSearch): Anthropic.Beta.BetaWebSearchTool20260318 {
  return {
    type: "web_search_20260318",
    name: WEB_SEARCH,
    allowed_callers: ["direct"],
    allowed_domains: web.domains,
    max_uses: web.maxUses,
  };
}

/** A passage of a page, as the API returned it under a cited sentence. */
export interface WebPassage {
  url: string;
  /** The page's title; empty when the page has none. */
  title: string;
  cited_text: string;
}

/** What a search or a passage becomes in the trace, before it is numbered. */
export interface WebStep {
  tool: typeof WEB_SEARCH | typeof WEB_PASSAGE;
  input: unknown;
  ok: boolean;
  output: unknown;
}

const SEARCH_ERRORS: Record<string, string> = {
  too_many_requests: "The search service was being asked too much at once.",
  invalid_tool_input: "The search query was not one the service could run.",
  max_uses_exceeded: "The searches allowed for one request were used up.",
  query_too_long: "The query was too long.",
  request_too_large: "The search request was too large, usually because the list of allowed sources is long.",
  unavailable: "The search service was unavailable.",
};

/**
 * Reads the web blocks of each response of one exchange, in order.
 *
 * A search and its results are two blocks paired by id, and they can arrive in
 * two different responses: when the model asks for a search and one of our own
 * tools at once, the API hands our tool call back first and runs the search on
 * the next request. So the reader remembers what was asked until it is answered.
 */
export class WebReader {
  private readonly asked = new Map<string, unknown>();
  private readonly kept = new Set<string>();

  /** Searches asked for whose results have not come back yet. */
  get waiting(): number {
    return this.asked.size;
  }

  read(content: ContentBlock[]): WebStep[] {
    const out: WebStep[] = [];
    for (const b of content) {
      if (b.type === "server_tool_use" && b.name === WEB_SEARCH) {
        this.asked.set(b.id, b.input);
      } else if (b.type === "web_search_tool_result") {
        const input = this.asked.get(b.tool_use_id) ?? {};
        this.asked.delete(b.tool_use_id);
        if (Array.isArray(b.content)) {
          // A search that matched nothing is an empty list, not an error.
          out.push({
            tool: WEB_SEARCH,
            input,
            ok: true,
            output: { results: b.content.map((r) => ({ url: r.url, title: r.title, page_age: r.page_age })) },
          });
        } else {
          const code = b.content.error_code;
          out.push({ tool: WEB_SEARCH, input, ok: false, output: { error: `${SEARCH_ERRORS[code] ?? "The search failed."} (${code})` } });
        }
      } else if (b.type === "text" && b.citations) {
        for (const c of b.citations) {
          if (c.type !== "web_search_result_location") continue;
          const text = c.cited_text.trim();
          if (!text) continue;
          const key = `${c.url}\n${text}`;
          if (this.kept.has(key)) continue;
          this.kept.add(key);
          const passage: WebPassage = { url: c.url, title: (c.title ?? "").trim(), cited_text: text };
          out.push({ tool: WEB_PASSAGE, input: { url: c.url }, ok: true, output: passage });
        }
      }
    }
    return out;
  }
}

/** A step's output, when it is a passage. */
export function passageOf(output: unknown): WebPassage | null {
  const o = output as Partial<WebPassage> | null;
  if (!o || typeof o.url !== "string" || typeof o.cited_text !== "string") return null;
  return { url: o.url, title: typeof o.title === "string" ? o.title : "", cited_text: o.cited_text };
}

// ---------------------------------------------------------------------------
// Dates, as a page writes them.
// ---------------------------------------------------------------------------

const MONTHS: [string, number][] = [
  ["janvier", 1], ["janv", 1], ["january", 1], ["jan", 1],
  ["fevrier", 2], ["fevr", 2], ["february", 2], ["feb", 2],
  ["mars", 3], ["march", 3], ["mar", 3],
  ["avril", 4], ["avr", 4], ["april", 4], ["apr", 4],
  ["mai", 5], ["may", 5],
  ["juin", 6], ["june", 6], ["jun", 6],
  ["juillet", 7], ["juil", 7], ["july", 7], ["jul", 7],
  ["aout", 8], ["august", 8], ["aug", 8],
  ["septembre", 9], ["september", 9], ["sept", 9], ["sep", 9],
  ["octobre", 10], ["october", 10], ["oct", 10],
  ["novembre", 11], ["november", 11], ["nov", 11],
  ["decembre", 12], ["december", 12], ["dec", 12],
];
const MONTH_OF = new Map(MONTHS);
// Longest first, so "janvier" is not read as "jan" followed by "vier".
const MONTH_RE = MONTHS.map(([name]) => name)
  .sort((a, b) => b.length - a.length)
  .join("|");

const DAY = String.raw`(?<![\d.,])(\d{1,2})(?:er|re|e|st|nd|rd|th)?`;
const YEAR = String.raw`(?:,?\s+(\d{4})(?!\d))?`;
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
// "du 20 au 31 décembre 2021", "December 20 to 31" is not written this way in English.
const DAY_TO_DAY_MONTH = new RegExp(String.raw`${DAY}\s+(?:au|to|et|and|-|–)\s+${DAY}\s+(${MONTH_RE})\b\.?${YEAR}`, "g");
// "31 décembre 2021", "1er janvier", "17 January 2022".
const DAY_MONTH = new RegExp(String.raw`${DAY}\s+(${MONTH_RE})\b\.?${YEAR}`, "g");
// "December 31, 2021", "Jan. 17".
const MONTH_DAY = new RegExp(String.raw`\b(${MONTH_RE})\b\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)${YEAR}`, "g");

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** A day a text states. `year` is null when the text gives the day and the month only. */
export interface StatedDate {
  day: number;
  month: number;
  year: number | null;
}

const real = (day: number, month: number): boolean => month >= 1 && month <= 12 && day >= 1 && day <= 31;

/**
 * Every day a text states, in French or in English, however it writes it.
 *
 * A month without a day ("in January 2022") states no day and returns nothing:
 * a date is not completed from a guess.
 */
export function statedDates(text: string): StatedDate[] {
  const t = fold(text);
  const out: StatedDate[] = [];
  const add = (day: number, month: number, year: number | null) => {
    if (!real(day, month)) return;
    if (!out.some((d) => d.day === day && d.month === month && d.year === year)) out.push({ day, month, year });
  };
  for (const m of t.matchAll(ISO_DATE)) add(Number(m[3]), Number(m[2]), Number(m[1]));
  for (const m of t.matchAll(DAY_TO_DAY_MONTH)) {
    const month = MONTH_OF.get(m[3]!)!;
    const year = m[4] ? Number(m[4]) : null;
    add(Number(m[1]), month, year);
    add(Number(m[2]), month, year);
  }
  for (const m of t.matchAll(DAY_MONTH)) add(Number(m[1]), MONTH_OF.get(m[2]!)!, m[3] ? Number(m[3]) : null);
  for (const m of t.matchAll(MONTH_DAY)) add(Number(m[2]), MONTH_OF.get(m[1]!)!, m[3] ? Number(m[3]) : null);
  return out;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** What a passage lets a sentence say: its figures, and the days it states. */
export function passageLedger(p: WebPassage): Ledger {
  const ledger = new Ledger();
  for (const text of [p.cited_text, p.title]) {
    ledger.addText(text);
    // "31 décembre 2021" is the same statement as 2021-12-31.
    for (const d of statedDates(text)) if (d.year !== null) ledger.addText(`${d.year}-${pad(d.month)}-${pad(d.day)}`);
  }
  return ledger;
}

/**
 * Is this date stated by these passages?
 *
 * The day and the month must be written in a passage. The year must be written
 * with them, or — when the passage gives only "31 décembre" — be a year the
 * passages or the person's own request name. A passage that states another
 * year beside that day does not support the date.
 */
export function dateStated(iso: string, passages: readonly WebPassage[], asked: Ledger): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const texts = passages.flatMap((p) => [p.cited_text, p.title]);
  const stated = texts.flatMap(statedDates).filter((d) => d.day === day && d.month === month);
  if (stated.some((d) => d.year === year)) return true;
  if (!stated.some((d) => d.year === null)) return false;
  const token = numbersIn(String(year))[0]!;
  return asked.has(token) || texts.some((t) => numbersIn(t).some((n) => n.kind === "number" && n.value === year));
}

// ---------------------------------------------------------------------------
// A quotation, checked against the passage it claims to come from.
// ---------------------------------------------------------------------------

/** Fewer than fifteen words: a quotation, not an extract. */
export const QUOTE_MAX_WORDS = 14;

/** Typography evened out, so a curly apostrophe or a narrow space is not a difference. */
const even = (s: string): string =>
  s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[\s  ]+/g, " ")
    .trim();

/** The quotation as written, without the marks or the ellipsis put around it. */
export function bareQuote(quote: string): string {
  return even(quote)
    .replace(/^["' ]+|["' ]+$/g, "")
    .replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "")
    .trim();
}

export const wordsIn = (text: string): number => even(text).split(" ").filter(Boolean).length;

/** The passage this quotation is copied from, word for word; null when none holds it. */
export function quotedFrom<P extends WebPassage>(quote: string, passages: readonly P[]): P | null {
  const q = bareQuote(quote);
  if (!q) return null;
  return passages.find((p) => even(p.cited_text).includes(q)) ?? null;
}

/** The start of a passage, short enough to quote: what stands in for a quotation that could not be verified. */
export function excerpt(text: string): string {
  const words = even(text).replace(/(\.\.\.|…)$/, "").trim().split(" ").filter(Boolean);
  return words.length <= QUOTE_MAX_WORDS ? words.join(" ") : `${words.slice(0, QUOTE_MAX_WORDS).join(" ")}…`;
}
