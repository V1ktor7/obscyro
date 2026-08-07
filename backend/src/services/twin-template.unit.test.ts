import assert from "node:assert/strict";
import { test } from "node:test";

import { fillTemplate } from "./twin.js";

// ---------------------------------------------------------------------------
// What this pins: a clinician never reads a placeholder.
//
// The engine shipped substituting `{{value}}`. The alert-rule panel then
// documented and pre-filled `{value}`. The first alert raised through the
// panel reached the screen as "Occupation critique à {unit} — {value}%" —
// correct severity, correct unit, and a sentence nobody can act on.
//
// `{unit}` had been documented before it existed at all.
// ---------------------------------------------------------------------------

const CTX = { unit: "HND Emergency", value: 96.666, threshold: 90 };

test("single braces — what the panel writes", () => {
  assert.equal(
    fillTemplate("Occupation critique à {unit} — {value}%", CTX),
    "Occupation critique à HND Emergency — 96.67%",
  );
});

test("double braces — what rules created before the panel hold", () => {
  assert.equal(
    fillTemplate("{{unit}} dépasse {{threshold}} à {{value}}%", CTX),
    "HND Emergency dépasse 90 à 96.67%",
  );
});

test("the two styles mix in one message", () => {
  // Nobody would write this on purpose; an edited rule can end up this way.
  assert.equal(fillTemplate("{unit}: {{value}}", CTX), "HND Emergency: 96.67");
});

test("the value is rounded to two decimals, not to an integer", () => {
  // 96.67 and 97 are a different claim about a ward at capacity.
  assert.equal(fillTemplate("{value}", CTX), "96.67");
  assert.equal(fillTemplate("{value}", { ...CTX, value: 50 }), "50");
});

test("an unknown key stays visible rather than leaving a hole", () => {
  // A typo should look like a typo, not like a sentence with a missing word.
  assert.equal(
    fillTemplate("{unit} — {valeur}%", CTX),
    "HND Emergency — {valeur}%",
  );
});

test("a message with no placeholder is left alone", () => {
  assert.equal(fillTemplate("Occupation critique", CTX), "Occupation critique");
  assert.equal(fillTemplate("", CTX), "");
});

test("a unit the tree could not name still yields a sentence", () => {
  assert.equal(
    fillTemplate("Occupation à {unit}", { ...CTX, unit: "this unit" }),
    "Occupation à this unit",
  );
});
