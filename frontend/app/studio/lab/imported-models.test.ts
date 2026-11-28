import { describe, expect, it } from "vitest";

import type { Backtest, ForecastModel, ModelOffer, Score, Standing, Verification } from "../forecast-models-api";
import {
  backtestText,
  blankModelForm,
  companionChoices,
  companionName,
  draftOfModel,
  errorLines,
  errorText,
  horizonPicks,
  horizonRows,
  leavesText,
  roadOf,
  sentText,
  shapeText,
  sourceText,
  standingText,
  type ModelForm,
} from "./imported-models";

const OFFER: ModelOffer = {
  measures: [
    { key: "occupancy", label: "Stretcher occupancy", unit: "percent", units: 107, since: "2026-09-09T14:45:00.000Z" },
    { key: "iqa", label: "Air quality index", unit: "number", units: 318, since: "2026-11-22T20:00:00.000Z" },
  ],
  series: [{ key: "virus_detections", label: "Virus detections", entities: ["Quebec | Influenza", "Quebec | RSV"] }],
  calendar: ["calendar:hour", "calendar:weekday"],
  service: { configured: false, says: "The model service is not configured on this server." },
  keyPrefix: "MODEL_KEY_",
  contract: 1,
  limits: { horizonMax: 336, historyMax: 2160, seriesMax: 300, sampleUnits: 3, backtestDays: 14 },
};
const score = (over: Partial<Score> = {}): Score => ({ n: 4000, model: 6.2, reference: 29.4, held: 8.3, inside: 0.8, ...over });
const form = (over: Partial<ModelForm> = {}): ModelForm => ({ ...blankModelForm(), label: "Chronos-2, occupancy", metric: "occupancy", ...over });

describe("the road a model travels", () => {
  const steps = (m: Pick<ForecastModel, "state" | "standing">) => roadOf(m).filter((s) => s.done).map((s) => s.id);

  it("marks every step up to where the model is, in order", () => {
    expect(steps({ state: "imported", standing: null })).toEqual(["imported"]);
    expect(steps({ state: "verified", standing: null })).toEqual(["imported", "verified"]);
    expect(steps({ state: "tried", standing: null })).toEqual(["imported", "verified", "tried"]);
    expect(roadOf({ state: "imported", standing: null }).map((s) => s.label)).toEqual(["Imported", "Contract checked", "Replayed on the past", "On trial", "Shown"]);
  });

  it("marks “shown” only when the model is on trial and the rule says so: nobody ticks it", () => {
    const standing = { shown: true } as Standing;
    expect(steps({ state: "on_trial", standing: null })).toEqual(["imported", "verified", "tried", "on_trial"]);
    expect(steps({ state: "on_trial", standing: { ...standing, shown: false } })).toEqual(["imported", "verified", "tried", "on_trial"]);
    expect(steps({ state: "on_trial", standing })).toEqual(["imported", "verified", "tried", "on_trial", "shown"]);
    // Taken off trial, a model that was shown is not any more.
    expect(steps({ state: "tried", standing })).toEqual(["imported", "verified", "tried"]);
  });
});

describe("a model in words", () => {
  it("says where it comes from, and never shows an address whole", () => {
    expect(sourceText({ source: "reference", serviceModel: null, endpointUrl: null })).toBe("The reference rule, “the same hour a week before”. Built in: no model is called.");
    expect(sourceText({ source: "service", serviceModel: "chronos-2", endpointUrl: null })).toBe("An open model, “chronos-2”, served by the model service.");
    // A key someone pasted into the address would otherwise be put back on the screen.
    expect(sourceText({ source: "endpoint", serviceModel: null, endpointUrl: "https://api.acme.io/v1/forecast?token=SECRET" })).toBe("A model hosted at api.acme.io, which speaks the contract.");
    expect(sourceText({ source: "endpoint", serviceModel: null, endpointUrl: "not an address" })).toBe("A model hosted at an address, which speaks the contract.");
  });

  it("says what it forecasts, for where, how far, and from how much history", () => {
    const m = { metric: "occupancy", units: null, step: "hour" as const, historySteps: 336, horizonSteps: 72 };
    expect(shapeText(m, "Stretcher occupancy")).toBe("Stretcher occupancy, for every unit that carries it: the next 3 days, by the hour, from 14 days of history.");
    expect(shapeText({ ...m, units: ["u1"], horizonSteps: 30, historySteps: 36 }, null)).toBe("occupancy, for 1 unit: the next 30 hours, by the hour, from 36 hours of history.");
    expect(shapeText({ ...m, step: "day", horizonSteps: 14, historySteps: 56 }, "Stretcher occupancy")).toBe("Stretcher occupancy, for every unit that carries it: the next 14 days, by the day, from 56 days of history.");
  });
});

describe("the three errors", () => {
  it("are written in the measure's own unit: an occupancy is off by points", () => {
    expect(errorText(6.24, "percent")).toBe("6.2 points");
    expect(errorText(1.5, "hours")).toBe("1.5 hours");
    expect(errorText(12, "count")).toBe("12");
    expect(errorText(null, "percent")).toBe("nothing to compare");
  });

  it("are set side by side, the model first, with the lowest marked", () => {
    expect(errorLines(score(), "percent", "Chronos-2")).toEqual([
      { who: "Chronos-2", value: "6.2 points", best: true },
      { who: "“the last value holds”", value: "8.3 points", best: false },
      { who: "“the same hour a week before”", value: "29.4 points", best: false },
    ]);
    // A model that loses to the last value: the rule is the one marked.
    expect(errorLines(score({ model: 12 }), "percent", "Chronos-2").map((l) => l.best)).toEqual([false, true, false]);
    expect(errorLines(score({ n: 0, model: null, reference: null, held: null }), "percent", "Chronos-2")).toEqual([]);
  });

  it("are shown at a few steps of the horizon, and the last one", () => {
    expect(horizonPicks(72)).toEqual([1, 6, 12, 24, 48, 72]);
    expect(horizonPicks(30)).toEqual([1, 6, 12, 24, 30]);
    expect(horizonPicks(1)).toEqual([1]);
    const by = Array.from({ length: 24 }, (_, i) => score({ n: 8, model: i === 0 ? 2 : 30, held: 8.3, reference: 29.4 }));
    const rows = horizonRows(by, "percent");
    expect(rows.map((r) => r.step)).toEqual([1, 6, 12, 24]);
    expect(rows[0]).toEqual({ step: 1, n: 8, model: "2 points", held: "8.3 points", reference: "29.4 points", beats: true });
    // Further ahead it does worse than both rules.
    expect(rows[3]!.beats).toBe(false);
    expect(horizonRows([score({ n: 0, model: null, reference: null, held: null })], "percent")[0]!.beats).toBeNull();
  });
});

describe("what a replay and a trial say", () => {
  const backtest = (over: Partial<Backtest> = {}): Backtest => ({
    ranAt: "2026-11-27T12:00:00.000Z",
    days: 14,
    step: "hour",
    horizon: 72,
    origins: Array.from({ length: 14 }, (_, i) => ({ origin: `2026-11-${13 + i}T12:00:00.000Z`, series: 107, leftOut: 0, score: score() })),
    overall: score({ n: 100152 }),
    byHorizon: [],
    verdict: { beats: true, why: "Its error is 6.2, under both rules." },
    partial: false,
    stopped: null,
    said: null,
    unit: "percent",
    ...over,
  });

  it("says how much a replay compared, then its verdict", () => {
    expect(backtestText(backtest())).toEqual([
      "Replayed over 14 days: 14 forecasts made with what was known then, 100,152 steps held against what was measured since.",
      "Its error is 6.2, under both rules.",
    ]);
  });

  it("says what stopped a replay before its end", () => {
    const stopped = "At the origin of 2026-11-25 12:00 UTC: Series “s1”, step 1: the range is out of order (low 1, likely 0, high 3).";
    expect(backtestText(backtest({ partial: true, stopped, overall: score({ n: 0, model: null, reference: null, held: null }), origins: [], verdict: { beats: null, why: "Nothing could be compared yet." } }))).toEqual([
      "Replayed over 14 days: nothing could be compared.",
      stopped,
      "Nothing could be compared yet.",
    ]);
  });

  it("says what the display rule decided, and why", () => {
    const standing = (over: Partial<Standing> = {}): Standing => ({ computedAt: "", windowDays: 14, forecasts: 5992, origins: 56, overall: score(), byHorizon: [], shown: true, why: "Its error is 6.2, under both rules.", unit: "percent", ...over });
    expect(standingText(standing())).toEqual(["5,992 forecasts frozen over the last 14 days, made at 56 origins.", "Shown. Its error is 6.2, under both rules."]);
    expect(standingText(standing({ shown: false, why: "Only 48 steps of its frozen forecasts have been measured so far. It is judged from 200.", forecasts: 107, origins: 1 }))).toEqual([
      "107 forecasts frozen over the last 14 days, made at 1 origin.",
      "Not shown. Only 48 steps of its frozen forecasts have been measured so far. It is judged from 200.",
    ]);
    expect(standingText(standing({ forecasts: 0, origins: 0, shown: false, why: "No forecast has been frozen yet: the trial has just begun." }))[0]).toBe("No forecast has been frozen yet.");
  });

  it("says what left the server when a contract was checked", () => {
    const v = (sent: Partial<Verification["sent"]>): Verification => ({ ok: true, why: null, sent: { to: "x", series: 3, history: 336, horizon: 72, step: "hour", companions: [], bytes: 18_400, ...sent }, leftOut: [], sample: null, said: null, ms: 1 });
    expect(sentText(v({}))).toBe("3 series under opaque labels, 336 steps of history each: 18 kB. No unit is named.");
    expect(sentText(v({ companions: ["air", "hour"], bytes: 900 }))).toBe("3 series under opaque labels, 336 steps of history each, with the companion series air, hour: 900 bytes. No unit is named.");
    expect(sentText(v({ series: 0, bytes: 0 }))).toBe("Nothing was sent.");
  });
});

describe("the import form", () => {
  it("says where the series would go before anything is imported", () => {
    expect(leavesText(form(), OFFER)).toBe("Nothing leaves this server: the reference is computed here.");
    expect(leavesText(form({ source: "service" }), OFFER)).toMatch(/Counts and rates under opaque labels.*They would go to the model service, which is not configured: this model cannot be called yet\.$/);
    expect(leavesText(form({ source: "service" }), { service: { configured: true, says: "" } })).toMatch(/They go to the model service\.$/);
    expect(leavesText(form({ source: "endpoint", endpointUrl: "https://api.acme.io/v1/f?token=SECRET" }), OFFER)).toMatch(/No unit's name or identifier does, and nothing about a person\. They go to api\.acme\.io, outside this platform\.$/);
    expect(leavesText(form({ source: "endpoint", endpointUrl: "" }), OFFER)).toMatch(/They go to the address you give, outside this platform\.$/);
  });

  it("offers as companions what the project keeps: other measures, kept series, the calendar", () => {
    const choices = companionChoices(OFFER, "occupancy");
    expect(choices.map((c) => [c.value, c.kind])).toEqual([["twin:iqa", "past"], ["virus_detections", "past"], ["calendar:hour", "known"], ["calendar:weekday", "known"]]);
    // The measure being forecast is not a companion of itself.
    expect(choices.some((c) => c.value === "twin:occupancy")).toBe(false);
    expect(choices[1]!.entities).toEqual(["Quebec | Influenza", "Quebec | RSV"]);
    expect(companionName("Qualité de l'air", [])).toBe("qualite_de_l_air");
    expect(companionName("iqa", ["iqa"])).toBe("iqa_2");
    expect(companionName("???", [])).toBe("series");
  });

  it("sends what was filled in, and only what the source needs", () => {
    const { draft, problems } = draftOfModel(form({ serviceModel: "chronos-2", endpointUrl: "https://x", endpointKeyEnv: "MODEL_KEY_X" }), OFFER);
    expect(problems).toEqual([]);
    // The reference has no model to name and no address: what was typed for another source does not travel.
    expect(draft).toEqual({
      label: "Chronos-2, occupancy",
      source: "reference",
      serviceModel: null,
      endpointUrl: null,
      endpointKeyEnv: null,
      metric: "occupancy",
      units: null,
      step: "hour",
      historySteps: 336,
      horizonSteps: 72,
      holdHours: 3,
      minHistoryDays: 14,
      companions: [],
      timeZone: null,
    });
    const hosted = draftOfModel(form({ source: "endpoint", endpointUrl: " https://api.acme.io/f ", endpointKeyEnv: "MODEL_KEY_ACME", holdHours: "" }), OFFER).draft;
    expect([hosted.endpointUrl, hosted.endpointKeyEnv, hosted.serviceModel, hosted.holdHours]).toEqual(["https://api.acme.io/f", "MODEL_KEY_ACME", null, null]);
  });

  it("says what to correct before anything is sent", () => {
    expect(draftOfModel(blankModelForm(), OFFER).problems).toEqual(["Give the model a name.", "Pick the measure it forecasts."]);
    expect(draftOfModel(form({ source: "service", serviceModel: " " }), OFFER).problems).toEqual(["Name the open model the model service serves."]);
    expect(draftOfModel(form({ source: "endpoint", endpointUrl: "http://api.acme.io" }), OFFER).problems).toEqual(["Give the model's address, starting with https://."]);
    expect(draftOfModel(form({ horizonSteps: "400", historySteps: "12", minHistoryDays: "0", holdHours: "soon" }), OFFER).problems).toEqual([
      "A horizon is 1 to 336 steps.",
      "A history is 24 to 2,160 steps.",
      "The history a unit needs is 1 to 365 days.",
      "How long a value holds is a number of hours, or nothing.",
    ]);
    expect(draftOfModel(form({ companions: [{ name: "hour", kind: "known", series: "calendar:hour", entity: null }] }), OFFER).problems).toEqual(["The hour of the day is an hour somewhere: give the time zone, such as America/Toronto."]);
  });

  it("takes the name of a variable for a key, and refuses what looks like the key itself", () => {
    const withKey = (endpointKeyEnv: string) => draftOfModel(form({ source: "endpoint", endpointUrl: "https://api.acme.io/f", endpointKeyEnv }), OFFER).problems;
    expect(withKey("MODEL_KEY_ACME")).toEqual([]);
    expect(withKey("")).toEqual([]);
    expect(withKey("sk-live-9f2c1a")).toEqual(["The key is named by a variable that starts with MODEL_KEY_. Give that name, never the key itself."]);
    expect(withKey("DATABASE_URL")).toEqual(["The key is named by a variable that starts with MODEL_KEY_. Give that name, never the key itself."]);
  });
});
