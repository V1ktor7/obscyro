import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_ATTEMPTS, backoffMs } from "./channel-jobs.js";
import { isRetryableOutcome, type ChannelRunOutcome } from "./channel-runner.js";

function outcome(partial: Partial<ChannelRunOutcome>): ChannelRunOutcome {
  return {
    status: "failed",
    conceptCount: 0,
    savedCount: 0,
    flaggedCount: 0,
    error: "boom",
    errorCode: null,
    durationMs: 1,
    stepTimings: {},
    stepIo: [],
    ...partial,
  };
}

describe("isRetryableOutcome", () => {
  it("retries when the NLP service is unreachable", () => {
    assert.equal(isRetryableOutcome(outcome({ errorCode: "NLP_UNAVAILABLE" })), true);
    assert.equal(isRetryableOutcome(outcome({ errorCode: "NLP_UPSTREAM_ERROR" })), true);
  });

  it("does not retry permanent failures", () => {
    assert.equal(isRetryableOutcome(outcome({ errorCode: "EMPTY_INPUT" })), false);
    assert.equal(isRetryableOutcome(outcome({ errorCode: "NO_EXTRACT_STEP" })), false);
    assert.equal(isRetryableOutcome(outcome({ errorCode: "ENVIRONMENT_NOT_FOUND" })), false);
    assert.equal(isRetryableOutcome(outcome({ errorCode: "INTERNAL_ERROR" })), false);
    assert.equal(isRetryableOutcome(outcome({ errorCode: null })), false);
  });

  it("never retries successful or flagged runs", () => {
    assert.equal(
      isRetryableOutcome(outcome({ status: "succeeded", error: null, errorCode: "NLP_UNAVAILABLE" })),
      false,
    );
    assert.equal(
      isRetryableOutcome(outcome({ status: "flagged", error: null, errorCode: "NLP_UNAVAILABLE" })),
      false,
    );
  });
});

describe("backoffMs", () => {
  it("grows exponentially and caps at the last step", () => {
    assert.equal(backoffMs(1), 30_000);
    assert.equal(backoffMs(2), 120_000);
    assert.equal(backoffMs(3), 480_000);
    assert.equal(backoffMs(4), 1_800_000);
    assert.equal(backoffMs(MAX_ATTEMPTS), 1_800_000);
    assert.equal(backoffMs(99), 1_800_000);
  });

  it("clamps out-of-range attempt numbers", () => {
    assert.equal(backoffMs(0), 30_000);
    assert.equal(backoffMs(-1), 30_000);
  });
});
