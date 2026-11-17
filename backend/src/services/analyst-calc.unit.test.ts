import assert from "node:assert/strict";
import { test } from "node:test";

import { CalcError, evaluate } from "./analyst-calc.js";

test("arithmetic follows the usual order", () => {
  assert.equal(evaluate("2 + 3 * 4").value, 14);
  assert.equal(evaluate("(2 + 3) * 4").value, 20);
  assert.equal(evaluate("2 ^ 3 ^ 2").value, 512);
  assert.equal(evaluate("-2 ^ 2").value, -4);
  assert.equal(evaluate("10 - 4 - 3").value, 3);
  assert.equal(evaluate("100 / 4 / 5").value, 5);
});

test("the signs people type are understood", () => {
  assert.equal(evaluate("6 × 7").value, 42);
  assert.equal(evaluate("84 ÷ 2").value, 42);
  assert.equal(evaluate("50 − 8").value, 42);
});

test("functions do what their names say", () => {
  assert.equal(evaluate("round((7316 - 267) / 7316 * 100, 1)").value, 96.4);
  assert.equal(evaluate("round(234 / 225710 * 1000, 2)").value, 1.04);
  assert.equal(evaluate("max(3, 9, 4) - min(3, 9, 4)").value, 6);
  assert.equal(evaluate("sum(1, 2, 3) + mean(2, 4)").value, 9);
  assert.equal(evaluate("abs(-5) + sqrt(16) + floor(2.9) + ceil(2.1)").value, 14);
});

test("the operands are reported as written, without the decimals asked of round", () => {
  assert.deepEqual(evaluate("round((7316 - 267) / 7316 * 100, 1)").operands, ["7316", "267", "7316", "100"]);
  assert.deepEqual(evaluate("round(2.5)").operands, ["2.5"]);
});

test("anything that is not arithmetic is refused, with a reason", () => {
  assert.throws(() => evaluate("7,316 - 267"), CalcError);
  assert.throws(() => evaluate("process.exit(1)"), CalcError);
  assert.throws(() => evaluate("x + 1"), /Unknown function|Expected/);
  assert.throws(() => evaluate("1 / 0"), /Division by zero/);
  assert.throws(() => evaluate("2 +"), /ends too early/);
  assert.throws(() => evaluate("(2 + 3"), /Expected "\)"/);
  assert.throws(() => evaluate("2 3"), /after the expression/);
  assert.throws(() => evaluate("round()"), /argument/);
  assert.throws(() => evaluate("sqrt(0 - 4)"), /not a finite number/);
  assert.throws(() => evaluate(""), /Empty/);
});
