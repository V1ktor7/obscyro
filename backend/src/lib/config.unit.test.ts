import assert from "node:assert/strict";
import { test } from "node:test";

import { ANALYST_MODELS, DEFAULT_ANALYST_MODEL, analystModelFrom, analystOffBecause } from "./config.js";

// ---------------------------------------------------------------------------
// Which Claude model the analyst runs on is a setting of the server
// (`ANALYST_MODEL`). What is checked here is what a setting comes to: the
// model asked for, the default when none is, and no silent substitute when
// the value names nothing the analyst can run on.
// ---------------------------------------------------------------------------

test("with no setting the analyst runs on the default model", () => {
  assert.deepEqual(analystModelFrom(undefined), { model: DEFAULT_ANALYST_MODEL, refused: null });
  assert.deepEqual(analystModelFrom(""), { model: DEFAULT_ANALYST_MODEL, refused: null });
  assert.deepEqual(analystModelFrom("   "), { model: DEFAULT_ANALYST_MODEL, refused: null });
  assert.equal(DEFAULT_ANALYST_MODEL, "claude-opus-5-5");
});

test("a model of the list is taken as asked, whatever its case and the spaces around it", () => {
  for (const m of ANALYST_MODELS) assert.deepEqual(analystModelFrom(m), { model: m, refused: null });
  assert.deepEqual(analystModelFrom("  Claude-Sonnet-5-5 "), { model: "claude-sonnet-5-5", refused: null });
  assert.deepEqual(analystModelFrom("CLAUDE-HAIKU-5-5"), { model: "claude-haiku-5-5", refused: null });
});

test("a value that names no model of the list is kept as refused, not swapped for the default", () => {
  // A slip in the name of a cheaper model must not end up billed at the dearest one's price.
  assert.deepEqual(analystModelFrom("claude-sonet-5-5"), { model: DEFAULT_ANALYST_MODEL, refused: "claude-sonet-5-5" });
  // Nor is any model the list does not hold: the request is written for these three.
  assert.equal(analystModelFrom("claude-haiku-4-5").refused, "claude-haiku-4-5");
  assert.equal(analystModelFrom("sonnet").refused, "sonnet");
});

test("the analyst is off without a key, or with a model it cannot run on, and says which", () => {
  const on = { anthropicApiKey: "key", analystModel: analystModelFrom("claude-sonnet-5-5") };
  assert.equal(analystOffBecause(on), null);
  assert.equal(analystOffBecause({ anthropicApiKey: "key", analystModel: analystModelFrom(undefined) }), null);

  assert.deepEqual(analystOffBecause({ ...on, anthropicApiKey: "" }), {
    reason: "no_key",
    says: "The analyst is not switched on for this server: it needs a Claude API key (ANTHROPIC_API_KEY).",
  });

  const slip = analystOffBecause({ anthropicApiKey: "key", analystModel: analystModelFrom("claude-sonet-5-5") });
  assert.equal(slip?.reason, "unknown_model");
  assert.equal(
    slip?.says,
    'The analyst is switched off on this server: ANALYST_MODEL is set to "claude-sonet-5-5", which is not a model it can run on. ' +
      "An administrator has to set it to one of claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5, or leave it unset.",
  );
  // The missing key is said first: without it nothing else matters.
  assert.equal(analystOffBecause({ anthropicApiKey: "", analystModel: analystModelFrom("nope") })?.reason, "no_key");
});
