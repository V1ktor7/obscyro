/**
 * No number without a source.
 *
 * The analyst is a language model, and a language model can write "7,316" as
 * easily as "7,361". Asking it nicely not to is not a control. This file is the
 * control: every figure in an answer is looked up in what the tools actually
 * returned, and a figure that cannot be found does not reach the screen.
 *
 * The check is per paragraph. A paragraph names the steps it rests on, and its
 * figures must be in the results of *those* steps (or in the question itself).
 * That is what makes a source chip mean something: it is not "a tool was called
 * at some point", it is "this number is in that result".
 *
 * What it proves and what it does not. It proves the figure exists in a tool
 * result, as written or rounded the way a person rounds. It does not prove the
 * sentence around it is right — "7,316 beds" where the tool said "7,316
 * patient-days" passes. The trace is on the screen for that reason: a person
 * can open the step and read what the number was.
 */

/** One figure as it was written. */
export interface NumberToken {
  /** As it appears, suffix included: "7,316", "94 %", "2021-12-13". */
  raw: string;
  start: number;
  end: number;
  kind: "number" | "date";
  /** Absolute value, scale applied ("225k" is 225000). Zero for a date. */
  value: number;
  /** Half the width of what the writing can mean: 0.5 for "94", 0.05 for "9.4". */
  half: number;
  /** Followed by %, "percent" or "points": may be a share written out of 100. */
  percent: boolean;
  /** A whole number ending in zeros: how many, so "6,000" can stand for 5,999. */
  zeros: number;
  /** The date, when `kind` is "date". */
  date: string | null;
}

// Three ways a figure is written, tried in this order:
//   1. an ISO date, so its parts are not read as three numbers;
//   2. grouped thousands: 7,316 · 225 710 · 1,234.5 · 1 234,5. The first group
//      does not start with 0, so a French "0,941" stays a decimal;
//   3. plain: 94 · 9.4 · 7,3.
const NUMBER =
  /(\d{4}-\d{2}-\d{2})|([1-9]\d{0,2}(?:[ \u00a0\u202f,]\d{3})+(?!\d)(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)/g;
const PERCENT = /^[ \u00a0\u202f]?(%|percent\b|per cent\b|pour cent\b|points?\b|pts?\b|pp\b)/i;
const SCALE: [RegExp, number][] = [
  [/^[ \u00a0\u202f]?(k|K)\b/, 1e3],
  [/^[ \u00a0\u202f]?(thousand|mille|milliers?)\b/i, 1e3],
  [/^[ \u00a0\u202f]?(M\b|millions?\b)/, 1e6],
];
const LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/;

interface Parsed {
  value: number;
  decimals: number;
  /** Zeros a whole number ends in. */
  zeros: number;
}

function finish(whole: string, fraction: string | undefined): Parsed | null {
  const digits = whole.replace(/\D/g, "");
  const value = Number(fraction ? `${digits}.${fraction}` : digits);
  if (!Number.isFinite(value)) return null;
  const zeros = fraction || value === 0 ? 0 : (/0+$/.exec(digits)?.[0].length ?? 0);
  return { value, decimals: fraction?.length ?? 0, zeros };
}

/** "7,316" · "225 710" · "1,234.5": the separators between groups of three are not decimals. */
function parseGrouped(text: string): Parsed | null {
  const m = /^(.*\d{3})(?:[.,](\d+))?$/.exec(text);
  return m ? finish(m[1]!, m[2]) : null;
}

/** "94" · "9.4" · "7,3". */
function parsePlain(text: string): Parsed | null {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(text);
  return m ? finish(m[1]!, m[2]) : null;
}

/**
 * Every figure in a piece of text.
 *
 * Digits that belong to a name are not figures: the 19 of COVID-19, the 1 of
 * H1N1, the 3 of "s3". A run of digits glued to a letter, or to a letter and a
 * hyphen, is part of a word.
 */
export function numbersIn(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  NUMBER.lastIndex = 0;
  for (let m = NUMBER.exec(text); m; m = NUMBER.exec(text)) {
    const start = m.index;
    let end = start + m[0].length;
    const before = text[start - 1] ?? "";
    const before2 = text[start - 2] ?? "";
    if (LETTER.test(before) || (before === "-" && LETTER.test(before2))) continue;
    // "3.2.1", an IP, a version: not one figure, and not worth guessing at.
    if (before === "." && /\d/.test(before2)) continue;

    if (m[1]) {
      out.push({ raw: m[1], start, end, kind: "date", value: 0, half: 0, percent: false, zeros: 0, date: m[1] });
      continue;
    }
    const parsed = m[2] ? parseGrouped(m[2]) : parsePlain(m[3]!);
    if (!parsed) continue;
    const rest = text.slice(end);
    let scale = 1;
    for (const [re, by] of SCALE) {
      const s = re.exec(rest);
      if (s) {
        scale = by;
        end += s[0].length;
        break;
      }
    }
    const pct = scale === 1 ? PERCENT.exec(rest) : null;
    if (pct) end += pct[0].length;
    out.push({
      raw: text.slice(start, end),
      start,
      end,
      kind: "number",
      value: Math.abs(parsed.value) * scale,
      half: 0.5 * 10 ** -parsed.decimals * scale,
      percent: Boolean(pct),
      zeros: scale === 1 ? parsed.zeros : 0,
      date: null,
    });
  }
  return out;
}

/**
 * What a set of tool results contains.
 *
 * Every number in the JSON, every number written inside a string, every date
 * and its parts, and the length of every list — counting the rows of a result
 * is reading it, not inventing.
 */
export class Ledger {
  private readonly values: number[] = [];
  private readonly dates = new Set<string>();

  get size(): number {
    return this.values.length + this.dates.size;
  }

  addNumber(n: number): void {
    if (Number.isFinite(n)) this.values.push(Math.abs(n));
  }

  addText(text: string): void {
    for (const t of numbersIn(text)) {
      if (t.kind === "date") {
        this.dates.add(t.date!);
        // "13 December 2021" is the same statement as 2021-12-13.
        const [y, mo, d] = t.date!.split("-").map(Number);
        this.addNumber(y!);
        this.addNumber(mo!);
        this.addNumber(d!);
      } else {
        this.addNumber(t.value);
      }
    }
  }

  addJson(value: unknown): void {
    if (typeof value === "number") return this.addNumber(value);
    if (typeof value === "string") return this.addText(value);
    if (Array.isArray(value)) {
      this.addNumber(value.length);
      for (const v of value) this.addJson(v);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        this.addText(k);
        this.addJson(v);
      }
    }
  }

  /** Another ledger's contents, added to this one. */
  absorb(other: Ledger): void {
    for (const v of other.values) this.values.push(v);
    for (const d of other.dates) this.dates.add(d);
  }

  has(token: NumberToken): boolean {
    if (token.kind === "date") return this.dates.has(token.date!);
    const a = token.value;
    const slack = 1e-9 * Math.max(1, a);
    for (const v of this.values) {
      // A share may be written out of 100: 0.94 is "94 %".
      const forms = token.percent ? [v, v * 100] : [v];
      for (const c of forms) {
        const gap = Math.abs(c - a);
        if (gap <= token.half + slack) return true;
        // A round figure for a near one: "6,000" for 5,999, "7,300" for 7,316.
        // Bounded both ways, so "100" cannot stand for 60.
        if (token.zeros > 0 && gap <= 0.5 * 10 ** token.zeros + slack && gap <= 0.05 * a) return true;
      }
    }
    return false;
  }
}

/** The figures of a text that the ledger does not hold. */
export function unsourced(text: string, ledger: Ledger): NumberToken[] {
  return numbersIn(text).filter((t) => !ledger.has(t));
}

/** What replaces a figure nobody could trace. */
export const STRUCK = "[unverified]";

/** The text with the given figures taken out. */
export function strike(text: string, tokens: NumberToken[]): string {
  let out = text;
  for (const t of [...tokens].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, t.start) + STRUCK + out.slice(t.end);
  }
  return out;
}

// ---------------------------------------------------------------------------
// An answer, checked.
// ---------------------------------------------------------------------------

export interface AnswerParagraph {
  text: string;
  /** Ids of the steps whose results this paragraph rests on. */
  sources: string[];
}

export interface AnswerDraft {
  paragraphs: AnswerParagraph[];
  assumptions: string[];
  limits: string[];
}

export interface Finding {
  where: "paragraph" | "assumption" | "limit";
  /** Position in its list, from zero. */
  index: number;
  /** The figures as written. */
  figures: string[];
}

export interface Checked {
  findings: Finding[];
  /** The same answer with every untraced figure taken out. */
  struck: AnswerDraft;
}

/**
 * Check an answer against the steps that produced it.
 *
 * `ledgers` holds one ledger per step id; `question` holds what the person
 * typed, whose figures are theirs to use. A paragraph is checked against the
 * steps it names. Assumptions and limits name no step, so they are checked
 * against everything that was read.
 */
export function checkAnswer(draft: AnswerDraft, ledgers: ReadonlyMap<string, Ledger>, question: Ledger): Checked {
  const everything = new Ledger();
  everything.absorb(question);
  for (const l of ledgers.values()) everything.absorb(l);

  const findings: Finding[] = [];
  const paragraphs = draft.paragraphs.map((p, index) => {
    const own = new Ledger();
    own.absorb(question);
    for (const id of p.sources) {
      const l = ledgers.get(id);
      if (l) own.absorb(l);
    }
    const bad = unsourced(p.text, own);
    if (bad.length) findings.push({ where: "paragraph", index, figures: bad.map((t) => t.raw) });
    return { ...p, text: strike(p.text, bad) };
  });
  const loose = (where: "assumption" | "limit", items: string[]) =>
    items.map((text, index) => {
      const bad = unsourced(text, everything);
      if (bad.length) findings.push({ where, index, figures: bad.map((t) => t.raw) });
      return strike(text, bad);
    });
  return {
    findings,
    struck: { paragraphs, assumptions: loose("assumption", draft.assumptions), limits: loose("limit", draft.limits) },
  };
}
