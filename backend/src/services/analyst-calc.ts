/**
 * Arithmetic the analyst does not do in its head.
 *
 * A language model asked for "267 against 7,316, as a percentage" will usually
 * be right and occasionally be confidently wrong, and nothing on the screen
 * tells the two apart. So it does not get to: it writes the expression, this
 * evaluates it, and the result enters the record as a tool result like any
 * other — with the expression beside it, where a person can redo it.
 *
 * A small grammar on purpose. Numbers, + − × ÷ ^, brackets and a handful of
 * functions. No variables, no property access, nothing evaluated as code.
 */

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

type Tok =
  | { t: "num"; v: number; raw: string }
  | { t: "id"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]), raw: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_]+/.exec(src.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    // The signs people type: × ÷ − and the en dash.
    const sign = c === "×" ? "*" : c === "÷" ? "/" : c === "−" || c === "–" ? "-" : c;
    if ("+-*/^(),".includes(sign)) {
      out.push({ t: "op", v: sign as "+" });
      i += 1;
      continue;
    }
    throw new CalcError(
      `Unexpected "${c}" at position ${i + 1}. Write numbers without thousands separators (7316, not 7,316) and use + - * / ^ ( ).`,
    );
  }
  return out;
}

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  abs: ([x]) => Math.abs(x!),
  sqrt: ([x]) => Math.sqrt(x!),
  floor: ([x]) => Math.floor(x!),
  ceil: ([x]) => Math.ceil(x!),
  round: ([x, n = 0]) => {
    const k = 10 ** Math.trunc(n);
    return Math.round(x! * k) / k;
  },
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
  sum: (xs) => xs.reduce((a, b) => a + b, 0),
  mean: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
};
const ARITY: Record<string, [number, number]> = {
  abs: [1, 1],
  sqrt: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 2],
  min: [1, Infinity],
  max: [1, Infinity],
  sum: [1, Infinity],
  mean: [1, Infinity],
};

export interface Evaluated {
  value: number;
  /**
   * The numbers the expression was built from, as written. The count of
   * decimals asked of `round` is not one of them: it is an instruction.
   */
  operands: string[];
}

/** Evaluate an arithmetic expression. Throws `CalcError` on anything else. */
export function evaluate(expression: string): Evaluated {
  if (expression.length > 600) throw new CalcError("Expression too long (600 characters at most).");
  const toks = lex(expression);
  if (toks.length === 0) throw new CalcError("Empty expression.");
  let pos = 0;
  const operands: string[] = [];
  let recording = true;

  const peek = () => toks[pos];
  const isOp = (v: string) => {
    const t = toks[pos];
    return t !== undefined && t.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new CalcError(`Expected "${v}"${peek() ? "" : " before the end"}.`);
    pos += 1;
  };

  // expr := term (("+" | "-") term)*
  function expr(): number {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[pos++] as { v: string }).v;
      const right = term();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  // term := unary (("*" | "/") unary)*
  function term(): number {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[pos++] as { v: string }).v;
      const right = unary();
      if (op === "/" && right === 0) throw new CalcError("Division by zero.");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  // unary := "-" unary | power
  function unary(): number {
    if (isOp("-")) {
      pos += 1;
      return -unary();
    }
    if (isOp("+")) {
      pos += 1;
      return unary();
    }
    return power();
  }
  // power := atom ("^" unary)?     right-associative, binds tighter than a sign
  function power(): number {
    const base = atom();
    if (isOp("^")) {
      pos += 1;
      return base ** unary();
    }
    return base;
  }
  function atom(): number {
    const t = peek();
    if (!t) throw new CalcError("The expression ends too early.");
    if (t.t === "num") {
      pos += 1;
      if (recording) operands.push(t.raw);
      return t.v;
    }
    if (t.t === "id") {
      const fn = FUNCTIONS[t.v];
      if (!fn) {
        throw new CalcError(`Unknown function "${t.v}". Available: ${Object.keys(FUNCTIONS).join(", ")}.`);
      }
      pos += 1;
      expect("(");
      const args: number[] = [];
      if (!isOp(")")) {
        for (;;) {
          // The second argument of round() says how many decimals to keep.
          const was = recording;
          if (t.v === "round" && args.length === 1) recording = false;
          args.push(expr());
          recording = was;
          if (isOp(",")) {
            pos += 1;
            continue;
          }
          break;
        }
      }
      expect(")");
      const [lo, hi] = ARITY[t.v]!;
      if (args.length < lo || args.length > hi) {
        throw new CalcError(`${t.v}() takes ${lo === hi ? lo : `${lo} or more`} argument${hi === 1 ? "" : "s"}, got ${args.length}.`);
      }
      return fn(args);
    }
    if (t.v === "(") {
      pos += 1;
      const v = expr();
      expect(")");
      return v;
    }
    throw new CalcError(`Unexpected "${t.v}".`);
  }

  const value = expr();
  if (pos < toks.length) {
    const t = toks[pos]!;
    throw new CalcError(`Unexpected "${t.t === "num" ? t.raw : t.v}" after the expression.`);
  }
  if (!Number.isFinite(value)) throw new CalcError("The result is not a finite number.");
  return { value, operands };
}

/**
 * Numbers that are units, not facts: per cent, per thousand, a week, a day.
 * Anything else in an expression has to have come from somewhere.
 */
export const UNIT_CONSTANTS: ReadonlySet<number> = new Set([0, 1, 2, 7, 10, 24, 100, 1000]);
