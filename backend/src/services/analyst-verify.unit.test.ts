import assert from "node:assert/strict";
import { test } from "node:test";

import { Ledger, STRUCK, checkAnswer, clausesOf, numbersIn, strike, unsourced } from "./analyst-verify.js";

const values = (text: string) => numbersIn(text).map((t) => (t.kind === "date" ? t.date : t.value));

test("figures are read the way people write them, in English and in French", () => {
  assert.deepEqual(values("7,316 patient-days"), [7316]);
  assert.deepEqual(values("225 710 résidents"), [225710]);
  assert.deepEqual(values("225 710 résidents"), [225710]);
  assert.deepEqual(values("1,234.5 and 1 234,5"), [1234.5, 1234.5]);
  assert.deepEqual(values("7,3 par jour"), [7.3]);
  assert.deepEqual(values("0,941 puis 0.941"), [0.941, 0.941]);
  assert.deepEqual(values("day 17, up to 103 waiting"), [17, 103]);
  assert.deepEqual(values("from 94 % to 93 %"), [94, 93]);
  assert.deepEqual(values("about 225k residents and 2.1 million visits"), [225000, 2100000]);
});

test("a date is one thing, not three numbers", () => {
  assert.deepEqual(values("from 2021-12-13 for 60 days"), ["2021-12-13", 60]);
});

test("digits that belong to a name are not figures", () => {
  assert.deepEqual(values("COVID-19 and H1N1, see s3 and RLS6"), []);
  assert.deepEqual(values("COVID-19 filled 34 sites"), [34]);
});

test("a figure may be rounded the way a person rounds, and not otherwise", () => {
  const l = new Ledger();
  l.addJson({ waiting: 7316.4, share: 0.9412, sick: 5999, beds: 60 });
  const bad = (text: string) => unsourced(text, l).map((t) => t.raw);
  assert.deepEqual(bad("7,316 patient-days"), []);
  assert.deepEqual(bad("about 7,300 patient-days"), []);
  assert.deepEqual(bad("94 % full, or 94.1 %"), []);
  assert.deepEqual(bad("6,000 sick"), []);
  assert.deepEqual(bad("60 beds"), []);
  // Close is not the same: a transposition, a neighbour, a round figure too far.
  assert.deepEqual(bad("7,361 patient-days"), ["7,361"]);
  assert.deepEqual(bad("95 % full"), ["95 %"]);
  assert.deepEqual(bad("100 beds"), ["100"]);
  assert.deepEqual(bad("8,000 patient-days"), ["8,000"]);
});

test("a share is a percentage only when written as one", () => {
  const l = new Ledger();
  l.addNumber(0.83);
  assert.equal(unsourced("83 % immune", l).length, 0);
  assert.equal(unsourced("83 points", l).length, 0);
  assert.equal(unsourced("83 beds", l).length, 1);
});

test("the ledger holds numbers inside strings, dates and their parts, and how long a list is", () => {
  const l = new Ledger();
  l.addJson({ note: "+60 beds from day 10", day_0_is: "2021-12-13", sites: [{ name: "a" }, { name: "b" }, { name: "c" }] });
  const bad = (text: string) => unsourced(text, l).map((t) => t.raw);
  assert.deepEqual(bad("60 beds from day 10"), []);
  assert.deepEqual(bad("starting 2021-12-13"), []);
  assert.deepEqual(bad("13 December 2021"), []);
  assert.deepEqual(bad("the 3 sites listed"), []);
  assert.deepEqual(bad("starting 2021-12-14"), ["2021-12-14"]);
  assert.deepEqual(bad("the 4 sites listed"), ["4"]);
});

test("striking takes out exactly the figure and its unit sign", () => {
  const l = new Ledger();
  l.addNumber(34);
  const text = "8 of 34 sites queue, 12 % of them early.";
  assert.equal(strike(text, unsourced(text, l)), `${STRUCK} of 34 sites queue, ${STRUCK} of them early.`);
});

test("a paragraph is checked against the steps it cites, not against everything read", () => {
  const s1 = new Ledger();
  s1.addJson({ units: 234 });
  const s2 = new Ledger();
  s2.addJson({ residents: 225710 });
  const question = new Ledger();
  question.addText("What if we add 60 beds?");
  const ledgers = new Map([
    ["s1", s1],
    ["s2", s2],
  ]);

  const ok = checkAnswer(
    {
      paragraphs: [
        { text: "Lakeshore has 234 beds for 225,710 residents.", sources: ["s1", "s2"] },
        { text: "Adding 60 beds is the option you asked about.", sources: [] },
      ],
      assumptions: ["The 234 beds are all staffed."],
      limits: [],
    },
    ledgers,
    question,
  );
  assert.deepEqual(ok.findings, []);

  // 225,710 is in s2, which this paragraph does not cite.
  const wrongSource = checkAnswer(
    { paragraphs: [{ text: "Lakeshore has 234 beds for 225,710 residents.", sources: ["s1"] }], assumptions: [], limits: [] },
    ledgers,
    question,
  );
  assert.deepEqual(wrongSource.findings, [{ where: "paragraph", index: 0, figures: ["225,710"] }]);
  assert.equal(wrongSource.struck.paragraphs[0]!.text, `Lakeshore has 234 beds for ${STRUCK} residents.`);

  // An assumption cites nothing, so it may use anything that was read, and nothing else.
  const loose = checkAnswer({ paragraphs: [{ text: "Fine.", sources: [] }], assumptions: ["Assumes 85 % occupancy."], limits: ["No staff."] }, ledgers, question);
  assert.deepEqual(loose.findings, [{ where: "assumption", index: 0, figures: ["85 %"] }]);
});

// --- whose figure it is ---------------------------------------------------------------
//
// The first answer the analyst gave in production: every figure "found", and
// Lachine given LaSalle's day. These are the rows it had read.

const SITES = {
  days: 60,
  sites_where_somebody_waits_in_either_run: [
    { order: 1, name: "HÔPITAL GÉNÉRAL DU LAKESHORE", usual_units: 234, events_only: { from_day: 17, most_waiting_at_once: 103, patient_days_waiting: 3012 } },
    { order: 2, name: "HÔPITAL DE LASALLE", usual_units: 110, events_only: { from_day: 18, most_waiting_at_once: 37, patient_days_waiting: 1101 } },
    { order: 3, name: "HÔPITAL DE LACHINE", usual_units: 56, events_only: { from_day: 19, most_waiting_at_once: 21, patient_days_waiting: 540 } },
    { order: 4, name: "HÔPITAL SANTA CABRINI", usual_units: 305, events_only: { from_day: 22, most_waiting_at_once: 44, patient_days_waiting: 890 } },
  ],
};
const CATCHMENTS = {
  catchments: [
    { name: "RLS de Pierrefonds - Lac Saint-Louis", residents: 225710, units: 234, units_per_1000_residents: 1.04 },
    { name: "RLS de Dorval - Lachine - LaSalle", residents: 144500, units: 166, units_per_1000_residents: 1.15 },
  ],
  whole_network: { residents: 2050000, units: 6210, units_per_1000_residents: 3.03 },
};

function read(...results: unknown[]): Ledger {
  const l = new Ledger();
  for (const r of results) l.addJson(r);
  return l;
}
const swaps = (text: string, l: Ledger) => l.misattributed(text).map((m) => `${m.token.raw} said of ${m.saidOf}, is ${m.belongsTo.join("/")}`);

test("a text is cut into statements without cutting a figure", () => {
  assert.deepEqual(
    clausesOf("Lachine follows on day 18, LaSalle on day 19 and Verdun on day 21. About 7,316 wait.").map((c) => c.text.trim()),
    ["Lachine follows on day 18", "LaSalle on day 19", "Verdun on day 21", "About 7,316 wait"],
  );
});

test("a figure beside a name has to be in that name's row", () => {
  const l = read(SITES);
  assert.deepEqual(swaps("Lachine follows on day 18, LaSalle on day 19.", l), [
    "18 said of HÔPITAL DE LACHINE, is HÔPITAL DE LASALLE",
    "19 said of HÔPITAL DE LASALLE, is HÔPITAL DE LACHINE",
  ]);
  assert.deepEqual(swaps("LaSalle follows on day 18, Lachine on day 19 and Santa Cabrini on day 22.", l), []);
  assert.deepEqual(swaps("Lakeshore is first, on day 17, with up to 103 people waiting.", l), []);
});

test("a figure that belongs to nobody is nobody's to swap", () => {
  const l = read(SITES, CATCHMENTS);
  // 60 is the length of the run and 3.03 the network's figure: said beside a name, still true.
  assert.deepEqual(swaps("Lakeshore breaks on day 17 of a 60-day run.", l), []);
  assert.deepEqual(swaps("Pierrefonds - Lac Saint-Louis has 1.04 per 1,000, against 3.03 for the network.", l), []);
  // A figure in no row at all is the other check's business, not this one's.
  assert.deepEqual(swaps("Lachine has 412 staff.", l), []);
});

test("a catchment and a site that share a word are told apart by the rest of the name", () => {
  const l = read(SITES, CATCHMENTS);
  // The catchment's own figure, said of the catchment: its three words are all there.
  assert.deepEqual(swaps("Dorval - Lachine - LaSalle has 1.15 beds per 1,000.", l), []);
  // The other catchment's figure, said of it: a swap.
  assert.deepEqual(swaps("Dorval - Lachine - LaSalle has 1.04 beds per 1,000.", l), [
    "1.04 said of RLS de Dorval - Lachine - LaSalle, is RLS de Pierrefonds - Lac Saint-Louis",
  ]);
});

test("a rounded figure is still that row's figure", () => {
  const l = read(SITES);
  assert.deepEqual(swaps("Lakeshore accounts for about 3,000 patient-days.", l), []);
});

test("a swap sends the draft back with whose figure it is, and is struck if it stays", () => {
  const ledgers = new Map([["s2", read(SITES)]]);
  const checked = checkAnswer(
    { paragraphs: [{ text: "Lachine follows on day 18, LaSalle on day 19.", sources: ["s2"] }], assumptions: [], limits: [] },
    ledgers,
    new Ledger(),
  );
  assert.equal(checked.findings.length, 1);
  assert.deepEqual(checked.findings[0]!.figures, ["18", "19"]);
  assert.deepEqual(checked.findings[0]!.misattributed![0], { figure: "18", saidOf: "HÔPITAL DE LACHINE", belongsTo: ["HÔPITAL DE LASALLE"] });
  assert.equal(checked.struck.paragraphs[0]!.text, `Lachine follows on day ${STRUCK}, LaSalle on day ${STRUCK}.`);
  // The right sentence passes.
  const right = checkAnswer(
    { paragraphs: [{ text: "LaSalle follows on day 18, Lachine on day 19.", sources: ["s2"] }], assumptions: [], limits: [] },
    ledgers,
    new Ledger(),
  );
  assert.deepEqual(right.findings, []);
});

test("a name made only of words every site has attributes nothing", () => {
  const l = read({ sites: [{ name: "Hôpital général de Montréal", units: 400 }, { name: "Hôpital de Verdun", units: 244 }] });
  assert.deepEqual(swaps("In Montréal, 244 beds are in use.", l), []);
});

