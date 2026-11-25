import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../lib/errors.js";
import type { EventsProposal } from "./analyst-events.js";
import { eventFromExchange, type JournalledSearch } from "./health-events.js";

const refused = (code: string) => (err: unknown) => err instanceof AppError && err.code === code;

const PASSAGE = {
  step: "s2",
  url: "https://www.quebec.ca/nouvelles/couvre-feu",
  title: "Nouvelles mesures pour freiner la transmission",
  text: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021, de 22 h à 5 h, partout au Québec.",
};

const proposal: EventsProposal = {
  request: "What measures were in force in Montréal between 2021-12-01 and 2022-02-28?",
  sources: ["quebec.ca"],
  searches: 2,
  candidates: [
    {
      id: "c1",
      title: "Curfew across Québec",
      startDate: "2021-12-31",
      endDate: null,
      datesRemoved: [],
      place: "Québec",
      door: "access",
      url: PASSAGE.url,
      sourceTitle: PASSAGE.title,
      quote: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021",
      quoteReplaced: false,
      passages: [PASSAGE],
      evidence: "published",
    },
    {
      id: "c2",
      title: "Schools closed",
      // The passage did not state the day: the person enters it.
      startDate: null,
      endDate: null,
      datesRemoved: ["start"],
      place: "Québec",
      door: "access",
      url: "https://www.quebec.ca/education",
      sourceTitle: "",
      quote: "les écoles demeureront fermées",
      quoteReplaced: false,
      passages: [{ step: "s3", url: "https://www.quebec.ca/education", title: "", text: "les écoles demeureront fermées jusqu'à nouvel ordre" }],
      evidence: "published",
    },
  ],
  notFound: [],
  limits: [],
};

const journalled = (over: Partial<JournalledSearch> = {}): JournalledSearch => ({ kind: "events", status: "answered", answer: proposal, ...over });

test("an accepted event is the journalled candidate, on the dates the person validated", () => {
  const draft = eventFromExchange(journalled(), "c1", { startsOn: "2021-12-31", endsOn: "2022-01-17" });
  assert.deepEqual(draft, {
    title: "Curfew across Québec",
    place: "Québec",
    door: "access",
    // Validated by the person: they added the end the passage did not give.
    startsOn: "2021-12-31",
    endsOn: "2022-01-17",
    // What the analyst had proposed stays beside it.
    proposedStartsOn: "2021-12-31",
    proposedEndsOn: null,
    sourceUrl: PASSAGE.url,
    sourceTitle: PASSAGE.title,
    passage: "Un couvre-feu sera en vigueur à compter du 31 décembre 2021",
    sources: [PASSAGE],
    candidate: "c1",
  });
});

test("a candidate whose date was left blank is accepted on the date the person entered", () => {
  const draft = eventFromExchange(journalled(), "c2", { startsOn: "2021-12-20", endsOn: null });
  assert.equal(draft.startsOn, "2021-12-20");
  assert.equal(draft.proposedStartsOn, null);
  assert.equal(draft.sourceTitle, null);
});

test("a candidate of an investigation is accepted like one of a search", () => {
  // What an investigation journals: the search's proposal, and what was measured beside it.
  const investigated = journalled({ kind: "investigation", answer: { ...proposal, investigation: { compared: [] } } });
  const draft = eventFromExchange(investigated, "c1", { startsOn: "2021-12-31", endsOn: null });
  assert.equal(draft.candidate, "c1");
  assert.equal(draft.title, proposal.candidates[0]!.title);
});

test("only a candidate that a search delivered can be accepted", () => {
  const dates = { startsOn: "2021-12-31", endsOn: null };
  assert.throws(() => eventFromExchange(journalled(), "c9", dates), refused("NOT_A_CANDIDATE"));
  // An answer to a question, or options, is not a search for events.
  assert.throws(() => eventFromExchange(journalled({ kind: "ask" }), "c1", dates), refused("NOT_AN_EVENTS_EXCHANGE"));
  assert.throws(() => eventFromExchange(journalled({ status: "incomplete", answer: null }), "c1", dates), refused("NOT_AN_EVENTS_EXCHANGE"));
  assert.throws(() => eventFromExchange(journalled({ answer: { candidates: [{ id: "c1" }] } }), "c1", dates), refused("EXCHANGE_UNREADABLE"));
});

test("the validated dates must be days of the calendar, in order", () => {
  assert.throws(() => eventFromExchange(journalled(), "c1", { startsOn: "2021-02-30", endsOn: null }), refused("EVENT_DATES_INVALID"));
  assert.throws(() => eventFromExchange(journalled(), "c1", { startsOn: "2021-12-31", endsOn: "2021-13-01" }), refused("EVENT_DATES_INVALID"));
  assert.throws(() => eventFromExchange(journalled(), "c1", { startsOn: "2021-12-31", endsOn: "2021-12-30" }), /ends before it starts/);
  // One day is a period.
  assert.equal(eventFromExchange(journalled(), "c1", { startsOn: "2021-12-31", endsOn: "2021-12-31" }).endsOn, "2021-12-31");
});
