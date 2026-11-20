---
# The English of docs/analyst.md. When that page changes, bring this one up to date, then run `npm run docs:stamp`.
title: "The analyst"
description: "The analyst is the folding “Analyst” panel of the Scenarios page: you ask it a question, and it answers from what its reading tools returned, showing everything it read."
source: "docs/analyst.md"
translatedFrom: "51b000c0df18806a"
---

The analyst is the folding “Analyst” panel of the Scenarios page. You ask it a question about the twin, the open scenario or the run on screen; it answers relying only on what its reading tools returned, and shows everything it read.

The panel has four tabs, which cover five steps of the [decision loop](/docs/product/decision-loop):

| Tab | Step of the loop | What you do there |
|---|---|---|
| Ask | Situation | Ask a question, read the answer and what was read to write it |
| Event finder | Precedents | Search official sources for what was happening around the network, accept or reject each event found |
| Options | Tested options, Recommendation | State an objective, see up to three options tested by the engine beside the scenario as it is |
| Decisions | Follow-up | Read back what was retained, what was expected of it, and the gap with what was observed |

The diagrams of the loop, the verifier and the calculator are in [Algorithms](/docs/product/algorithms), sections A1 to A3; those of the tested options and the decisions, sections A8 and A9; that of the online search and the calendar, section A10.

## What it does, and what it does not

| It does | It does not |
|---|---|
| Choose what to read, then write | Hold a fact about the network |
| Cite, for each paragraph, the steps it rests on | Do arithmetic in its head |
| Say what is missing when the tools cannot answer | Fill a gap with an estimate |
| Read | Write to the twin or the scenario |
| Have an option tested by the engine, and say what the test shows | Rank options it has not tested, recommend, decide |
| Search online, in the sources the project authorises, and propose events | Put an event on the calendar, send anything from the twin into a search, treat what a source published as measured |

## Putting it into service

It reads the twin through the Claude API. It needs the `ANTHROPIC_API_KEY` variable on the API service. Without it the analyst is off, the panel says so, and nothing else in the product depends on it.

It also needs credit on the Claude account of that key. When there is none left, the API refuses every request, and the analyst says so as it is: “The analyst's Claude account has no credit left, so it cannot answer. An administrator has to add credit in the Claude Console; trying again will not help until then.” No answer is made up in its place.

What the tools read from the twin (counts and capacities, never a person) is sent to the Claude API to write the answer. The panel says so at its foot.

The Event finder tab uses the web search of the Claude API. It has no variable of its own: it works with the same key, on two conditions that are set in the Claude console and not in the product. Web search must be allowed for the organisation (it is by default; switched off, the request fails with an error from the model), and the project's domains must not fall outside a list the organisation may have restricted. It is billed on top of tokens: US$10 per 1,000 searches at the rate read on 2026-11-17 and read again on 2026-11-20, eight searches at most per request.

## The routes

| Route | What it returns |
|---|---|
| `GET /v1/ontology/:env/analyst` | `{ configured, model }`: can the analyst be asked |
| `POST /v1/ontology/:env/analyst/ask` | A stream, one JSON line per event: a question and its answer |
| `POST /v1/ontology/:env/analyst/options` | The same stream: an objective and the tested options |
| `POST /v1/ontology/:env/analyst/events` | The same stream: a request and the candidate events found online |
| `POST /v1/ontology/:env/analyst/run` | A shorter stream: the scenario run by the server the way Run does it, and its digest, in the shape `ask` and `options` accept as `run`. Calls no model and writes nothing |
| `POST /v1/ontology/:env/decisions` | Records a decision from a tested option |
| `GET /v1/ontology/:env/decisions` | The project's decisions, most recent first (`scenarioId` for a single scenario) |
| `GET /v1/ontology/:env/decisions/:id/follow-up` | The arrivals a decision expected beside the observed series, with the gap |
| `POST /v1/ontology/:env/health-events` | Accepts a candidate: it enters the calendar |
| `GET /v1/ontology/:env/health-events` | The project's calendar, oldest to most recent (`from`, `to` for a period) |
| `DELETE /v1/ontology/:env/health-events/:id` | Removes an event from the calendar |
| `GET /v1/ontology/:env/web-sources` | The domains the search is allowed to look in |
| `PUT /v1/ontology/:env/web-sources` | Replaces that list |

Body of a question: `question`, `scenarioId` (or `null`), `looking` (`reality` or `scenario`), `run` (the digest of the run on screen, or `null`).

Body of an objective: `objective`, `scenarioId` (required: an option is added to a scenario), `horizon` and `activity` (the page's own, so that the test answers what Run would show), `run`.

Body of a decision: `exchangeId` and `step`, nothing else. The figures are copied by the server from its journal.

Body of an event search: `request`, and `scenarioId` (or `null`), which only tells the journal where the request was made from. Neither the run nor anything from the twin is part of it.

Body of an acceptance: `exchangeId`, `candidate` (`c1`, `c2`…), `startsOn` and `endsOn` (or `null`). The title, the link and the passage are copied by the server from its journal.

Lines of the stream:

| `type` | Content |
|---|---|
| `status` | What is being done |
| `step` | A tool call: its number (`s1`, `s2`…), its input, its result or its refusal, and the record the tool kept for the screen if it keeps one |
| `done` | The answer or the proposal, the figures removed, the steps, the model, the tokens, and `exchangeId`, the identifier of the exchange in the journal |
| `failed` | The model or the engine could not be reached, or the Claude account has no credit left; replaces `done` |
| `ping` | Nothing: keeps the connection open |

A request refused before it starts (no session, analyst off, simulation service not configured, invalid body) is an ordinary HTTP error, not a stream.

## The tools

None of them writes. Eleven read; a twelfth, `test_option`, runs the engine, and exists only in the Options tab. Two worlds: `reality`, the twin as it is; `scenario`, the same twin read through the open scenario.

The Event finder tab is apart: it has none of these tools. It has only the API's web search (`web_search`), which runs at Anthropic and not with us, and its delivery tool. That is what guarantees a search can take nothing from the twin with it.

| Tool | What it reads |
|---|---|
| `describe_twin` | Overview: sites, activities and units, territories, the declared care and spread model, what the twin lacks |
| `find_sites` | The sites, filtered by name, activity or territory, largest first |
| `get_site` | One site: place, units per activity, patients present, territories served, what the scenario changes there |
| `compare_catchments` | For an activity: each territory, its residents, its sites, its units per 1,000 residents |
| `scenario_recipe` | The scenario: starting conditions, events, choices, modified links, comparison series |
| `read_run` | The run on screen: digest of both passes, sites where people wait, one site day by day, the network day by day |
| `list_datasets` | The project's datasets and their columns |
| `preview_dataset` | The first rows of a dataset and the values of its category columns |
| `read_series` | A column read as a daily series: total, mean, extremes, values |
| `list_events` | The calendar: the validated events, their dates, their place, their gate, the source that published them and the passage quoted. When day 0 of the scenario has a date, each event is also placed on the days of the run |
| `calculate` | A calculation, on numbers already read or given in the question |
| `test_option` | Options tab only. Adds an option to the open scenario, for the time of a run on the server, and returns the scenario as it is beside the scenario with the option |

A tool that cannot answer (unknown name, two sites for one name, no run on screen, a table that holds several series, an option that cannot be tested) says so with a reasoned refusal that the model reads. It never guesses.

The digest of the run on screen is built by the page (`run-digest.ts`) with the functions the Result panel already reads: the analyst and the panel cannot diverge on a figure. The digest of a tested option is built by the server (`scenario-run.ts`), and a test holds the two together: [Algorithms](/docs/product/algorithms), section A4.

## The options

You state an objective: “nobody waits at this site any more”, “the fewest patient-days of waiting with at most 100 beds added”. The analyst reads the situation, proposes up to three options and runs each one through the engine before showing it.

An option is a label and one to four changes:

| Change | What it takes to test it |
|---|---|
| Capacity: units of an activity, at a site, from a given day (negative: units closed) | The site already offers that activity; you cannot close more than it has |
| Measure: contact layers multiplied, in some territories, for a number of days | The twin declares those layers |
| Replace a choice of the scenario: the same capacity or the same measure, with other units, another day, another duration | The choice is named the way `scenario_recipe` names it; it is a capacity replaced by a capacity, or a measure by a measure |
| Remove a choice of the scenario | The choice is named |

“40 beds instead of the scenario's 60” is therefore a single stamp at +40: the test runs without the 60 and with the 40, and that is what the recipe holds once the option is applied. Only choices (measures, capacity) can be replaced or removed. Starting conditions and events are what happens: an option does not undo them.

What comes from the model and what does not:

| On screen | Where it comes from |
|---|---|
| The figures on the cards: peak, sites with a queue, patient-days of waiting, first day of a queue, for the scenario as it is and for each option. The bar and the squares draw them; they add nothing | The engine's runs, read from the record of each test. Never from a sentence |
| The gap between an option and the scenario as it is (“−7,049 vs as it is”) | The program: the subtraction of the two figures shown, rounded, so it can be redone in your head |
| The count “2 measured · 1 published · 3 assumption” of a card | The program: it counts the items of the list per level. The three levels are never added together |
| The level of evidence of each item: Measured, Published, Assumption | The program, from where the item comes from (twin, scenario, option, a rule of the engine) |
| The stamps that “Add to scenario” adds | The test: they are the ones the engine received |
| “What it does to the scenario”: what the option adds, replaces and removes, when it does more than add | The program, from the stamps. The button then reads “Apply to scenario” |
| The mechanism in one sentence, what the test does not say, the reading, the trade-offs, the limits | The model, every figure checked by the verifier |

What the tab does not do, by construction: rank the options (they stay in the order of the tests, and no card is marked as the best), list one that was not tested, hide one that was, write to the scenario. Trade-offs of values are presented apart, under “Yours to weigh”.

Cost and duration are bounded: three tests at most per objective, and the scenario as it is runs only once for the three, in a single pass of the engine. Three options make four passes. During a test, the tab says how long it has been running.

## The events

The analyst knows only the twin. It cannot say that a curfew began on such a day. The Event finder tab gives it an online search, limited to the official sources the project authorises, and a calendar that only what a person accepted can enter. The full diagram is in [Algorithms](/docs/product/algorithms), section A10.

You write a request: “What measures were in force in Montréal between 2021-12-01 and 2022-02-28?”. The analyst searches, then returns **candidate** events: a title, dates, a place, the gate through which the event touches a health network (demand, capacity, access, care), the link to the source and a short quoted passage, in quotation marks.

What comes from the model and what does not:

| On screen | Where it comes from |
|---|---|
| The link, the page's title, the passage | The search's citations, returned by the API. The server checks that the page is among the authorised sources |
| The quotation in quotation marks, under fifteen words | The model chooses it **within** a passage; the server checks that it is there, word for word. Otherwise it is the first words of the passage, and the screen says so |
| The dates | The model proposes them; the server keeps only those a passage states. The others stay empty, and the person enters them from the source |
| The “Published” level and the WEB chip | The program |
| The title, the place, the gate | The model. A figure in the title that is not in the passages is removed |

**Accept** puts the candidate on the calendar, with the dates the person validated; they can correct them first, and both versions are kept. **Reject** sends nothing to the server: the candidate enters no table of events, and neither the analyst nor the timeline sees it. It stays in the journal of the exchange where it was proposed, like everything the analyst wrote.

Once accepted, an event:

- appears in the “Context” lane of the timeline, placed from the date the scenario gives to its day 0 (the “Reality check” setting). Without that date, the lane says why it is empty;
- is read by the analyst with `list_events`, in the Ask and Options tabs. An answer that uses it carries, under the paragraph, a WEB chip with the link and the “Published” level;
- is removed from the calendar from the timeline, on a confirmed click.

The sources are set in the tab (“Sources searched”, Change): a list of domains per project, twenty at most. With nothing set, the starting list applies: inspq.qc.ca, quebec.ca, msss.gouv.qc.ca, donneesquebec.ca, canada.ca, who.int.

Nothing from the twin leaves in a search. In that exchange the model has no reading tool, and its context names neither the project nor the scenario: it has only the request, the list of sources and today's date.

### What a search costs

An event search costs about 70 cents, at the API prices read on 2026-11-20. What costs is reading the pages a first time: each search launched returns ten pages, close to 15,000 tokens, or roughly 8 cents, and the model usually launches five or six per request, eight at most.

What the product does so as not to pay twice for the same pages:

- **The searches start together.** The instructions ask for them to be planned and launched in the same step, because a search launched on its own makes the model read again everything the earlier ones returned. It is an instruction, not a guarantee: if the model searches in several stages, the reading comes back.
- **The delivery is made without the pages.** As soon as passages have been picked out, the candidates are delivered in a fresh conversation, which holds only the request, the searches made and the passages. The search tool is no longer offered there: the cap of eight searches holds for the whole exchange.
- **The journal keeps the tokens of each request, per price** (`usage.byRequest`): read at full price, written to the cache, read back from the cache, written by the model, and the searches.

What is not done, and why:

- **Filtering of the results by the API** (the search launched from its code sandbox, which keeps only the useful extracts). The API's documentation says so: searches launched that way do not count towards the cap of an exchange with several requests, and that mode is not eligible for the commitments not to retain data. The cap of eight searches has to hold, so the search stays called directly.
- **Turning the cache off for this exchange.** Writing the pages to the cache costs a quarter more than simply reading them. But if the model launches a search after the others, everything before it is read again, and without the cache that reading would cost twenty times more. The cache stays, as an insurance.
- **Lowering the cap of eight searches.** The cap is a limit, not a target.

## The decisions

“Record decision” keeps the option retained with what is expected of it. The browser sends only the identifier of the exchange and the step of the test; the server copies everything else from its journal: the objective, the stamps, the figures of the tested run with and without the option, the arrivals day by day, the levels of evidence, the source steps. So only an option the engine tested can be recorded.

A decision cannot be edited: revising it means recording another one.

The follow-up (“Compare with observed”) exists when an observed series is linked to the scenario, through the “Reality check” setting of the Result panel. It sets the arrivals the tested run expected beside those that were counted, and gives the gap: totals over the days both report, average gap per day, offset of the peaks. It does not conclude. And it compares arrivals only: the twin keeps no history of queues or of occupancy, so the expected queue has nothing observed to face it, which the screen says.

## The rule of numbers

1. Each paragraph cites the steps it rests on.
2. Each figure in the paragraph must be found in the results of **those** steps, or in the person's question.
3. A derived figure (difference, share, rate) goes through `calculate`, which becomes a cited step.
4. A figure written beside the name of a site or a territory must be in that name's line. If it is in another's line, it is a swap.
5. A figure that cannot be found, or is swapped, sends the draft back to the model, twice at most. After that it is removed, and the screen shows the place where it was.
6. A figure that came from the web must be found in the quoted passage, or in the title of its page. A date counts there when the passage writes it, even spelled out. In an answer, an event of the calendar is cited by the `list_events` step that returned it: its dates are the ones a person validated.

The tools return counts of people and percentages rounded once, the way the screen writes them (103, 93 %). Returned with one decimal, the model rounded them a second time: 103.46 became 103.5 then “about 104”, beside a panel that says 103. And the list of sites where people wait arrives in the order in which they break, so that “which one first” is read rather than computed.

What the rule guarantees: no figure shown was invented, or taken from another site's line. What it does not guarantee: that the sentence around the figure is right. That is why each step opens under the answer, with what the tool returned.

## The journal

Each exchange is kept in `app.analyst_exchange` (migration 059): the question or the objective, the world looked at, each step with its input, its result and its record, what was shown, the figures removed, the model and the tokens. The `kind` column says whether it is a question (`ask`), an objective (`options`, migration 060) or an event search (`events`, migration 062). For a search, the world looked at is `web`, and the steps are the queries, the pages returned and the passages quoted. Nothing is modified after insertion.

Tokens are kept request by request (`usage.byRequest`) and per price: what was read at full price (`input`), what was written to the cache (`cacheWrite`), what was read back from the cache (`cacheRead`), what was written by the model (`output`), and the web searches launched in the request. An exchange costs little or a lot depending on the share of each request that is read back from the cache: that is what this detail makes it possible to check afterwards, instead of assuming it. The total shown on screen remains the sum of all tokens, whatever their price.

The identifier of the row is chosen before the exchange and leaves with the `done` line of the stream. That is what allows a decision to be recorded from a test: if the write to the journal failed, the decision is refused and the test has to be run again.

Decisions are in `app.decision` (migration 061). Accepted events are in `app.health_event`, and a project's authorised sources in `app.project_web_source` (migration 062).

## The screen

`AnalystPanel.tsx`, in an `OverlayPanel` under “Layers”, folded on arrival. Four tabs, in the order of the loop; each is built only when first opened, then keeps what was done in it.

**Event finder** (`EventFinderTab.tsx`), top to bottom: the request, and suggested requests on the scenario's dates, where the place remains to be written; the sources searched and the means to change them; the searches, shown while they run; a banner that says whether everything was found in the passages; one card per candidate (gate, “Published” level, WEB chip, title, place, quotation and link, the passages it rests on, which open the step where the passage reads in full, dates to correct, Accept, Reject); what was not found; the limits; the steps. A rejected candidate folds into one line, with the means to come back to it: the rejection wrote nothing anywhere.

**Context** (`ContextLane.tsx`) is not in the panel but in the timeline: the lane of validated events, above the stamp lanes. A click on an event opens it: source, quotation, who accepted it, and the means to remove it.

**Options** (`OptionsTab.tsx`), top to bottom: what the options are tested on; the objective, and objectives suggested from the run on screen; the tests, shown while they run, with the duration of what is in progress; the card of the scenario as it is, with a dashed border; one card per option; the reading; the trade-offs left to the person; the limits; what every option rests on; the steps. A banner says when the scenario is no longer the one that was tested, and why: an option added from the tab, several added together, or an edit made elsewhere.

An option's card reads at a glance and explains itself on a click (`option-cards.tsx`). At the top: its letter, its label, and what the run comes to in three words (“Nobody waits”, or “4 sites with a queue”). Then its figures, drawn:

- the patient-days of waiting, with the gap from the scenario as it is, and a bar. Every bar in the tab is on the same scale, that of the longest wait, and a tick on it marks the scenario as it is: two options are compared without reading a figure;
- the sites with a queue, “3 of 34”, and a square per site, red when it has a queue. Beyond 60 sites, the squares become a share of a bar;
- the peak occupancy and its day, the first day somebody waits, and the waiting where no site serves when the scenario has some.

Under the figures, three folded lines, which open on a click: “Why this option” (the mechanism, what the option replaces or removes, and the step that tested it), “What it rests on” (each item with its level of evidence; the count per level reads without opening), “What this test does not say”. A line whose text lost a figure opens by itself: a removal is not hidden behind a click. At the bottom, “Add to scenario” (or “Apply to scenario”) and “Record decision”.

**Decisions** (`DecisionsTab.tsx`): the decisions of the open scenario first, then those of the project's other scenarios. Each is a card of the same design: who took it, when, the objective, the figures expected with the option (the gap is given against the same run without it), then, folded, what was expected without the option, the mechanism, what it rested on, what the test did not say. The follow-up is asked for with a button. The tab reads even when the analyst is off: a decision is a record, not an answer.

**Ask**, top to bottom:

- what it will read (the scenario or reality, and the run if there is one);
- the question, and questions suggested from what is on screen;
- the steps, which arrive while it reads;
- the answer: a green banner when every figure is traced, an orange one with their number when some were removed; under each paragraph, the chips of the steps cited, which open the step, and, when the paragraph relies on events of the calendar, one WEB chip per event with its link and the “Published” level;
- what is assumed, what the answer cannot say;
- the sites the answer talks about, which point the map at them;
- the questions to ask next.

The original mock-up is `design/scenario-analyst.html`. It also shows a tab that is not built yet: “What it can use”.

## Adding a tool

1. Write it in `backend/src/services/analyst-tools.ts`: a name, a description for the model, an input schema, a validation, a pure function that reads. Add it to `READ_TOOLS`. A tool that only serves the options goes in `analyst-options.ts` and in `OPTION_TOOLS`.
2. It reads, it does not write. If it has to propose a write, validation remains a human click on screen. If it has to return more than the model needs to read (day-by-day series, what is needed to act), it returns a `Recorded`: the result goes to the model, the record to the screen and to the journal.
3. Its results name things the way the twin names them, and carry their units in the field names (`occupancy_pct`, `units_per_1000_residents`).
4. A case it cannot handle throws a `ToolError` that says what to do instead.
5. Give it a readable label in `stepLabel` (`frontend/app/studio/analyst-api.ts`).
6. Test it in `analyst-tools.unit.test.ts`.
7. Update the table of tools above, and diagram A1 if the loop changes.

## The reference questions

The analyst is a language model: “it worked when I tried” is not a test. The same question can be answered well one day and badly the next, after a change to its instructions or to the description of a tool. Seventeen reference questions, on the Montréal twin and the Omicron scenario fitted to INSPQ data, say what a good answer must contain.

```bash
# backend/ — by hand, never in the test suite: it calls the real API
npm run eval:analyst
npm run eval:analyst -- --times 2 --show
npm run eval:analyst -- --only three-sites,two-catchments,in-french,run-waiting-by-site
```

**The key.** The script acts as a person: it needs an Obscyro API key of a user who can read the environment. The browser's key can be read and copied in the Studio, under Admin → API keys; a key can also be created there, or on the account's keys page (`/app/keys`). On that last page, a key just created at once becomes the browser's: revoking it afterwards signs the Studio out. The script reads the key from `OBSCYRO_API_KEY` if the variable exists; otherwise it asks for it in the terminal, typed or pasted without being displayed. That is the way to prefer: the key is then written nowhere, neither in a file nor in the terminal's history. It has no place in the repository, in `backend/.env`, or in a log, and the script never prints it.

When the terminal does not let you paste at the prompt, the key can go from the clipboard to the variable without being displayed or entering the history. In Git Bash on Windows, after copying the key:

```bash
OBSCYRO_API_KEY="$(powershell.exe -NoProfile -Command Get-Clipboard | tr -d '\r\n')" npm run eval:analyst
```

**The run.** Some questions are about “the run on screen”. The script has no screen: it asks the server to run the reference scenario (`POST /v1/ontology/:env/analyst/run`), that is, the two passes Run does on the page, summarised the way the page summarises them. That digest goes with the questions about the run. Allow about a minute before the first question, and the script writes in one line which run it is (peak, sites with a queue, patient-days of waiting, with and without the choices): that is what makes it possible to tell a wrong answer from a scenario edited since.

| Option | What it does |
|---|---|
| `--horizon`, `--activity` | The days of the run and the activity it reads. By default 60 days and `litsantephysique`, like the page |
| `--save-run file.json` | Keeps the run done by the server |
| `--run file.json` | Replays a kept run, without doing another |
| `--no-run` | Does no run: the questions about the run are skipped, and the report says so |
| `--only id,id` | Only these questions |
| `--times n` | Each question n times. By default 2 |
| `--show` | Prints each answer, for a person to read |

| What is judged | How |
|---|---|
| An answer was given | The exchange ends as expected |
| No figure removed | `verified` true, the list of removed figures empty |
| The right tools read | Each expected tool was called and returned something (`a\|b`: one or the other) |
| The known facts are there | Each expected figure is in the answer, exact or rounded the way the verifier allows |
| The expected words are there | Ignoring case and accents |
| Each name keeps its figure | A name and its figure are in the same clause (`pairs`): that is what catches two right figures each written beside the wrong site. A colon does not end the clause: “Dorval has slightly more: 1.15 per 1,000” does say 1.15 of Dorval (`statementsOf`) |

What is not judged: the quality of the writing. That still takes a person, who reads the answers with `--show`.

- Each question is replayed twice by default: a set that passes once has not shown that it passes.
- Four questions cover what proved fragile with the real model: three sites cited with one figure each (`three-sites`), the sites of a run with their waiting (`run-waiting-by-site`), two territories compared (`two-catchments`), a question asked in French (`in-french`).
- The script exits with an error as soon as a question fails: it can serve as a guard before changing the instructions or a tool.
- The expected facts are in the code (`QUESTIONS`). When the twin or the scenario changes, it is the question that gets corrected.

**Code.** `backend/src/services/analyst-eval.ts` (the questions, the judging, the reading of a stream), `backend/scripts/analyst-eval.ts` (the replay), `serverRun` in `backend/src/services/scenario-run.ts` and the route `POST /v1/ontology/:env/analyst/run` in `backend/src/routes/analyst.ts` (the run done by the server). **Tests.** `analyst-eval.unit.test.ts`, `scenario-run.unit.test.ts`, `routes/analyst.unit.test.ts`.

## Known limits

- Each question, each objective is independent: the analyst does not remember the previous one.
- It searches online only in the Event finder tab. In Ask and Options it reads the events already validated, and says when none covers the moment asked about.
- A search sees only what the authorised sources publish and what the API's search engine retained of it. An event absent from the candidates is not an event that did not happen.
- The server holds of a web page only the quoted passage, 150 characters at most. A date the page gives elsewhere than in that passage stays empty: the source has to be opened and the date entered.
- What is verified about a candidate: its link, its quotation, its dates. Whether the passage really says what the title takes from it, and whether the gate is the right one, is for the person to judge when accepting.
- The title, the place and the gate of a candidate cannot be corrected on screen: only the dates can. A badly titled candidate is rejected.
- An event has only a place written in words. It is tied to no territory of the twin, and the engine does not receive it: it is a marker for reading a run, not an input of the run.
- The validated events are the project's, not a scenario's: every scenario of the project sees the same calendar.
- An event search costs about 70 cents: each search launched returns ten pages, close to 15,000 tokens, and no setting of the API lets you ask for fewer without giving up the cap on searches. See “What a search costs”.
- The twin holds no staff, no stocks and no history: the analyst says so, it does not fill the gap.
- The run on screen is not kept when the page is reloaded; Run has to be launched again. Nor are the tested options: what remains are the recorded decisions and the journal.
- An option is made of capacity and measures. A transfer of patients, staff, a stock, a new link between a site and a territory cannot be tested: the engine or the twin does not carry them. The analyst files them under the limits.
- An option is tested on the scenario as it is at the time of the test. Adding one option then another gives a scenario no test covered: the screen warns, and the objective has to be stated again.
- An option can replace or remove a choice of the scenario, but not a starting condition or an event. Replacing a capacity by a measure is done in two changes of the same option: remove one, add the other.
- Applying an option that removes a choice is done in two writes, the new stamp then the removal of the old one, and not in a single operation. If the second fails, the recipe keeps both stamps: the screen shows it, and the removal is done by hand. If the stamp to remove is no longer there at the time of the click, nothing is written.
- The name of a choice (`choice-a`) holds for one exchange. A later question reads the recipe again and may give it another name.
- An objective takes a little under three minutes on the Montréal twin. One pass of the engine takes about thirty seconds there; the first test launches two (the scenario as it is, then the option) after reading the twin and computing the spread, the following ones a single pass. It is the engine that sets the duration: to go faster the engine has to be made faster, not the analyst.
- The follow-up of a decision compares arrivals only (see “The decisions”).
- A recorded decision cannot be deleted on screen.

## Files

| Role | File |
|---|---|
| Loop, closing of a question, `give_answer` | `backend/src/services/analyst.ts` |
| Reading tools, digest of the run | `backend/src/services/analyst-tools.ts` |
| The `test_option` tool, closing of an objective, `give_options` | `backend/src/services/analyst-options.ts` |
| Closing of an event search, `give_events` | `backend/src/services/analyst-events.ts` |
| Reading the web search: queries, pages, passages, dates, quotations | `backend/src/services/analyst-web.ts` |
| A project's authorised sources | `backend/src/services/web-sources.ts` |
| Calendar of accepted events | `backend/src/services/health-events.ts` |
| Run of a scenario on the server | `backend/src/services/scenario-run.ts`, `scenario-stamps.ts` |
| Decisions and follow-up | `backend/src/services/decisions.ts` |
| Verifier | `backend/src/services/analyst-verify.ts` |
| Calculator | `backend/src/services/analyst-calc.ts` |
| The analyst's routes, context, journal | `backend/src/routes/analyst.ts` |
| The decisions' routes | `backend/src/routes/decisions.ts` |
| Routes of the calendar and the sources | `backend/src/routes/health-events.ts` |
| Streamed response | `backend/src/lib/ndjson.ts` |
| Journal, decisions, calendar | `backend/scripts/migrations/059_analyst_exchange.sql`, `060_analyst_exchange_kind.sql`, `061_decision.sql`, `062_health_event.sql` |
| Calls and labels on the screen side | `frontend/app/studio/analyst-api.ts` |
| Panel and Ask tab | `frontend/app/studio/simulation/hex/AnalystPanel.tsx` |
| Options and Decisions tabs | `frontend/app/studio/simulation/hex/OptionsTab.tsx`, `DecisionsTab.tsx` |
| Event finder tab | `frontend/app/studio/simulation/hex/EventFinderTab.tsx` |
| Context lane of the timeline | `frontend/app/studio/simulation/hex/ContextLane.tsx`, `context-lane.ts` |
| Parts shared by the tabs | `frontend/app/studio/simulation/hex/analyst-parts.tsx` |
| Card of an option or a decision: drawn figures, gap, levels of evidence, folded lines | `frontend/app/studio/simulation/hex/option-cards.tsx`, tests `option-cards.test.tsx` |
| Digest of the run | `frontend/app/studio/simulation/hex/run-digest.ts` |
