---
# The English of docs/algorithms.md. When that page changes, bring this one up to date, then run `npm run docs:stamp`.
title: "Obscyro's algorithms"
description: "Every algorithm of the product has its section here: what it is for, its diagram, its rules, where it lives in the code and which tests hold it."
source: "docs/algorithms.md"
translatedFrom: "0098419838c96f23"
---

Every algorithm of the product has its section here: what it is for, its diagram, its rules, where it lives in the code and which tests hold it.

**This file is updated with the code.** Adding, changing or removing an algorithm also means adding, changing or removing its section and its diagram, in the same commit (see [CLAUDE.md](https://github.com/V1ktor7/obscyro/blob/main/CLAUDE.md)). A diagram is drawn from the code one has just read.

## Table

| Ref. | Algorithm | Main file |
|---|---|---|
| **A** | **Decision support, the Scenarios page** | |
| [A1](#a1-the-analysts-loop) | The analyst's loop | `backend/src/services/analyst.ts` |
| [A2](#a2-number-verifier) | Number verifier | `backend/src/services/analyst-verify.ts` |
| [A3](#a3-calculator) | Calculator | `backend/src/services/analyst-calc.ts` |
| [A4](#a4-a-scenarios-run) | A scenario's run, in two passes, on the page and on the server | `frontend/app/studio/simulation/hex/engine.ts`, `backend/src/services/scenario-run.ts` |
| [A5](#a5-where-it-breaks) | Where it breaks: reading the queues | `frontend/app/studio/simulation/hex/results.ts` |
| [A6](#a6-comparison-with-reality) | Comparison with reality | `backend/src/services/observed-series.ts` |
| [A7](#a7-hexagon-grid-and-layers) | Hexagon grid and layers | `frontend/app/studio/simulation/hex/hex-grid.ts` |
| [A8](#a8-options-tested-by-the-engine) | Options tested by the engine | `backend/src/services/analyst-options.ts` |
| [A9](#a9-recorded-decision-and-follow-up) | Recorded decision and follow-up | `backend/src/services/decisions.ts` |
| [A10](#a10-online-search-and-calendar-of-events) | Validated online search and calendar of events | `backend/src/services/analyst-events.ts` |
| [A11](#a11-retest-of-a-prepared-response) | Retest of a prepared response, when a signal opens | `backend/src/services/response-retest.ts` |
| [A12](#a12-prices-the-cost-ledger-and-the-delay-of-an-option) | Prices, the cost ledger and the delay of an option | `backend/src/services/price-catalogue.ts`, `cost-ledger.ts` |
| [A13](#a13-investigating-a-series) | Investigating a series: events set beside what the twin measured | `backend/src/services/investigation.ts` |
| [A14](#a14-action-types) | Action types: what the analyst may propose, and within what bounds | `backend/src/services/action-types.ts` |
| [A15](#a15-function-types) | Function types: a reading tool declared from the Studio, and its translation into a tool of the analyst | `backend/src/services/function-types.ts` |
| **B** | **Twin and simulation engine** | |
| [B1](#b1-export-of-the-twin) | Export of the twin to the engine | `backend/src/services/twin-export.ts` |
| [B2](#b2-one-step-of-the-event-engine) | One step of the event engine | `simulation-service/app/events/dynamics.py` |
| [B3](#b3-spread) | Spread between declared states | `simulation-service/app/events/spread.py` |
| [B4](#b4-policies-score-and-comparison) | Policies, score and comparison | `simulation-service/app/events/policy.py` |
| [B5](#b5-overlay-scenario) | A scenario as an overlay on the twin | `backend/src/services/scenario-overrides.ts` |
| [B6](#b6-event-drawn-from-an-observed-series) | Event drawn from an observed series | `backend/src/services/sim-event-from-rows.ts` |
| **C** | **Forecasting and lab** | |
| [C1](#c1-daily-forecast-loop) | Daily forecast loop | `backend/src/services/forecast-loops.ts` |
| [C2](#c2-forecasting-a-series-and-learning-on-a-table) | Forecasting a series, learning on a table | `simulation-service/app/lab/timeseries.py` |
| [C3](#c3-leading-signals) | Leading signals: lag and replication | `backend/src/services/lag-scan.ts` |
| [C4](#c4-imported-forecasting-models) | Imported forecasting models: the contract, the reference, the replay on the past | `backend/src/services/forecast-models.ts`, `forecast-contract.ts` |
| [C4](#c4-causal-lab) | Causal lab | `backend/src/services/causal-lab.ts` |
| [C5](#c5-hybrid-simulation) | Hybrid simulation, graph of models | `simulation-service/app/runner.py` |
| **D** | **Data** | |
| [D1](#d1-clinical-extraction) | Clinical extraction from a text | `nlp-service/app/main.py` |
| [D2](#d2-data-pipelines) | Data pipelines | `backend/src/services/pipeline.ts` |
| [D3](#d3-identity-of-objects) | Identity of objects | `backend/src/services/identity.ts` |
| [D4](#d4-data-quality) | Data quality, six layers | `backend/src/services/data-quality.ts` |
| [D5](#d5-twin-alerts-and-signals) | Twin alerts and signals | `backend/src/services/twin-alert-scheduler.ts` |
| [D6](#d6-twin-metrics) | Twin metrics | `backend/src/services/twin-metrics.ts` |
| [D7](#d7-freshness-of-a-value) | Freshness of a value: the age of a unit, and of each measure | `backend/src/services/observed-at.ts` |
| [D8](#d8-zone-correspondence) | Zone correspondence | `backend/src/services/zone-correspondence.ts` |
| [D9](#d9-live-reading-and-situation-card) | Live reading and situation card | `backend/src/services/live-reading.ts`, `situation.ts` |
| [D10](#d10-sites-and-units-on-the-network-map) | Sites and units on the network map, and the inspector of a site | `frontend/app/studio/command/units-tree.ts` |
| [D11](#d11-history-of-twin-measures) | History of twin measures | `backend/src/services/twin-history.ts` |
| [D12](#d12-kept-series) | Kept series: a history a model can read, on a regular grid, and caught up from kept copies | `backend/src/services/series.ts`, `series-catchup.ts` |

---

# A. Decision support, the Scenarios page

## A1. The analyst's loop

**Purpose.** Answer a question about the twin, the open scenario or the run on screen, relying only on what tools returned. The language model chooses what to read and writes; it holds no fact, does no arithmetic and does not decide. Detail: [The analyst](/docs/product/analyst).

The same loop serves three kinds of exchange. What tells them apart is their **closing**: the instructions given to the model, the tool through which it delivers, and the way that delivery is checked. A question closes with `give_answer`; an objective closes with `give_options`, after tests (A8); an event search closes with `give_events`, after online searches (A10). An investigation (A13) is not a fourth closing: it is an event search, which the program frames with steps it does itself.

```mermaid
sequenceDiagram
    participant P as Person
    participant B as Loop analyst.ts
    participant M as Claude model
    participant O as Tools
    participant C as Closing
    P->>B: question, objective or request, open scenario, run on screen,<br/>and what the person is looking at (page, unit, signal)
    loop at most 16 requests to the model
        B->>M: instructions of the closing, tools, exchange so far
        opt the exchange has online search (A10)
            M-->>B: searches done by the API within the request, pages returned, passages cited
            B-->>P: one step per search and per cited passage
        end
        alt the API paused a long search turn
            B->>M: the same turn, sent back as it is
        else the model answers in prose
            B->>M: the closing asked again, with the passages noted if there are any
        else the model calls a tool
            M-->>B: tool call
            B->>O: runs it, input validated
            O-->>B: result or reasoned refusal, plus a full record for the screen
            B-->>P: step s1, s2, ... shown as it happens
            B->>M: the result alone, with its step number
        else the model delivers through the closing's tool
            M-->>B: give_answer, give_options or give_events
            B->>C: does the delivery have the right shape
            alt shape refused
                C-->>B: reason, sent back to the model without counting a draft
            else shape accepted
                B->>C: is every figure in the steps cited
                alt everything is traced, or two drafts already sent back
                    C-->>B: delivery accepted, untraceable figures removed
                else a figure cannot be found
                    C-->>B: figures named
                    B->>M: draft refused, to be corrected
                end
            end
        end
    end
    B-->>P: delivery, steps, figures removed, model, tokens, identifier of the exchange
    B->>B: exchange journalled in app.analyst_exchange, with its kind
```

**Rules.**
- Model: the one named by the `ANALYST_MODEL` variable of the service, among `claude-opus-5-5` (taken when it is empty), `claude-sonnet-5-5` and `claude-haiku-5-5`. A value outside that list switches the analyst off, which says so, instead of making it fall back on another model. Effort `medium`, free choice of tool. A request refused by a safeguard is replayed on the fallback model the API provides (`fallbacks: "default"`).
- At most 16 requests to the model per exchange, and 2 drafts sent back for untraceable figures.
- Delivery goes through the closing's tool, alone in its turn. An answer in prose is asked for again once, then abandoned. Twice when the exchange searches online: there, prose is a step, since it is where the cited passages come from (A10).
- Online search is not run by the loop but by the API, inside a request. The loop reads in each response what the API searched, the pages returned and the passages cited, and makes numbered steps of them like the others. A returned page carries no citable figure; only a passage does.
- A turn the API pauses (`pause_turn`) is sent back to it as it is, without a word from us: an added message would close the turn. A delivery requested at the same time as a search is refused once, while the search runs.
- A tool's refusal (unknown name, no run on screen) is a step the model reads; it carries no citable figure. A failure on our side is never disguised as a refusal.
- A tool can keep, beside its result, a full record (`Recorded`): it is shown and journalled, never sent to the model. So no sentence can rest on it.
- What the person is looking at arrives as ids (`focus`: page, unit, signal). The server looks the names up itself, in this project only, and writes them into the context of the question: no text typed by the caller enters the instructions.
- The tools read two sources, and each says which: the twin's export, which is what a run uses, and the live reading (D9), which is what the screens show.
- The tools of a question or of an objective are those of the code, less those the project switched off (A14), plus the reading tools it declared (A15). A declared tool goes through the loop with no special case; its step carries in addition the label the project gave it.
- A refusal by the model produces no invented answer.
- If the person leaves, nothing more is asked of the model.
- The identifier of the exchange is chosen before starting and leaves with the last line of the stream: it is what a decision will name (A9).

**Code.** `backend/src/services/analyst.ts` (`converse`, `Closing`, `askClosing`), `analyst-web.ts` (`WebReader`), `backend/src/routes/analyst.ts`, `backend/src/lib/ndjson.ts`, `frontend/app/studio/simulation/hex/AnalystPanel.tsx`, `frontend/app/studio/AnalystDock.tsx`.
**Tests.** `analyst.unit.test.ts`, `analyst-options.unit.test.ts`, `analyst-events.unit.test.ts`, `analyst-web.unit.test.ts`, `routes/analyst.unit.test.ts`, `lib/ndjson.unit.test.ts`, `AnalystPanel.test.tsx`.

## A2. Number verifier

**Purpose.** Prevent a figure from reaching the screen without a tool having returned it, or beside the wrong name. Each paragraph is checked against the steps it cites itself, not against everything that was read: that is what gives a source chip a meaning.

```mermaid
flowchart TD
    A["A paragraph and the steps it cites"] --> B["Pick out every figure in the text:<br/>dates, thousands, decimals, percentages, k and M"]
    B --> C{"Figure stuck to a word?<br/>COVID-19, H1N1, s3"}
    C -->|"yes"| D["Ignored: it is part of a name"]
    C -->|"no"| E["The paragraph's register:<br/>numbers of the cited steps, plus those of the question"]
    E --> F{"Is the figure in the register?"}
    F -->|"exact, rounded, a share written as a percentage,<br/>or a round figure within 5 percent"| K{"A site or territory name<br/>in the same clause?"}
    K -->|"no"| G["Traced"]
    K -->|"yes"| L{"Is the figure in that name's line,<br/>or does it belong to nobody?"}
    L -->|"yes"| G
    L -->|"no: it is in another name's line"| H{"Fewer than two drafts<br/>already sent back?"}
    F -->|"no"| H
    H -->|"yes"| I["Draft sent back to the model:<br/>figures named, and whom they belong to"]
    H -->|"no"| J["Figure removed from the text<br/>and listed on screen"]
```

**Rules.**
- The register of a step holds: every number of the result, every number written in a string, every date and its parts (year, month, day), and the length of every list.
- Rounding allowed: “94” for 93.6; “94 %” for a share of 0.941; “6,000” for 5,999. A round figure cannot be off by more than 5 %: “100” does not stand for 60.
- Assumptions and limits cite no step: they are checked against everything that was read.
- **Whose figure it is.** A tool's result is made of lines that carry a name (a site, a territory). The text is cut into clauses, at sentence ends, at commas and at the words that join two clauses. A figure written in the same clause as a name is at fault when three things are true: no line of that name holds it, it is not a figure that belongs to nobody (a total, the question, a calculation), and the line of another name holds it. So the check catches a swap, and stays silent when it cannot decide.
- A name is recognised by its distinctive words (“lakeshore”, “santa cabrini”), ignoring case and accents. A name made only of words common to all (“Hôpital général de Montréal”) attributes nothing.
- **What the check proves:** the figure exists in a cited tool result, and not in the line of a name other than the one it is written beside. **What it does not prove:** that the sentence around it is right. That is why every step can still be consulted under the answer.
- Origin of the attribution rule: the first answer given in production, every figure “found”, gave Lachine the day that belonged to LaSalle.
- **What comes from the web.** The register of a cited passage holds the figures of the passage and of its page's title, and the dates they spell out (“31 décembre 2021” stands for 2021-12-31); never the figures of the page's address. A figure that came from the web must therefore be found in the cited passage. The rules specific to candidates (word-for-word quotation, stated date) are in A10.

**Code.** `backend/src/services/analyst-verify.ts`. **Tests.** `analyst-verify.unit.test.ts`.

## A3. Calculator

**Purpose.** Do the arithmetic in the model's place, and refuse to compute on a number that comes from nowhere.

```mermaid
flowchart TD
    A["Expression written by the model<br/>round((7316 - 267) / 7316 * 100, 1)"] --> B["Split into numbers, operators, functions"]
    B --> C{"Anything other than arithmetic?"}
    C -->|"yes"| X["Reasoned refusal"]
    C -->|"no"| D["Pick out the operands<br/>except round's number of decimals"]
    D --> E{"Is every operand already read,<br/>in the question, or a unit?"}
    E -->|"no"| Y["Refusal: read the figure first"]
    E -->|"yes"| F["Evaluation with the usual precedence"]
    F --> G{"Finite result?"}
    G -->|"no"| X
    G -->|"yes"| H["Result returned as a step, citable"]
```

**Rules.** Operators `+ - * / ^` and parentheses. Functions `round, abs, sqrt, floor, ceil, min, max, sum, mean`. Nothing is executed as code. Units allowed without a source: 0, 1, 2, 7, 10, 24, 100, 1000. The analyst's `calculate` tool knows no variable and has access to nothing.

**The same evaluation serves cost formulas** (A12), with named values added. The check on operands belongs to the `calculate` tool: a cost formula is declared in the twin, and its numbers are those of its price row.

```mermaid
flowchart TD
    A["Formula of a price row<br/>ceil(units / places) * frais_fixe"] --> B["Splitting: numbers, operators, names"]
    B --> C{"Is a name followed by a parenthesis?"}
    C -->|"yes"| D{"Is it one of the functions of the list?"}
    D -->|"no"| X["Refusal: unknown function"]
    D -->|"yes"| E["Function applied to its arguments"]
    C -->|"no"| F{"Is the name among the values handed?"}
    F -->|"no"| Y["Refusal: unknown name,<br/>with the list of what the formula can name"]
    F -->|"yes"| G{"Is its value a finite number?"}
    G -->|"no"| Z["Refusal: this name has no value"]
    G -->|"yes"| H["The value takes the place of the name,<br/>and the pair is noted (used)"]
    E --> I["Evaluation with the usual precedence"]
    H --> I
    I --> J{"Finite result?"}
    J -->|"no"| X2["Refusal"]
    J -->|"yes"| K["Result, with the values<br/>put in place of the names"]
```

A named value is looked up only among those the caller hands, and a function only among those of the list: a word of the formula is never taken for anything else. A formula with a hole in it gives no result, never a result with a zero in the hole.

**Code.** `backend/src/services/analyst-calc.ts` (`evaluate`, `FUNCTION_NAMES`), the `calculate` tool in `analyst-tools.ts`. **Tests.** `analyst-calc.unit.test.ts`, `analyst-tools.unit.test.ts`, `cost-ledger.unit.test.ts`.

## A4. A scenario's run

**Purpose.** Say what the planner's choices change. The scenario goes through the engine twice: once with what happens to the city, once with the choices added. The difference between the two is the effect of the choices, built rather than deduced.

```mermaid
flowchart TD
    S["The scenario's stamps"] --> C["Starting conditions: usual occupancy,<br/>prior immunity, transmissibility"]
    S --> E["Events: outbreaks, heat wave"]
    S --> K["Choices: measures, added capacity,<br/>recorded response"]
    C --> V1["Pass 1: events only"]
    E --> V1
    C --> V2["Pass 2: with the choices"]
    E --> V2
    K --> V2
    V1 --> T["Translation into the engine's input"]
    V2 --> T
    T --> P{"An outbreak,<br/>and the twin declares a spread?"}
    P -->|"yes"| SP["Spread: states per territory,<br/>demand produced"]
    P -->|"no"| EV["Event: the effects of the pass"]
    SP --> EV
    EV --> W{"Who launches the run?"}
    W -->|"the page, Run button"| EP["Event stored under a fixed name,<br/>through three routes of the API"]
    W -->|"the server: a tested option,<br/>the retest of a prepared response,<br/>or POST /analyst/run"| ES["Event sent to the engine, nothing is stored"]
    EP --> RUN["Simulation of the network through the scenario:<br/>with no response, or following the recorded response<br/>the pass holds"]
    ES --> RUN
    RUN --> G["Per day and per site: occupancy, queue,<br/>capacity. Per day: arrivals, unserved"]
    G --> D["Digest of the run: both passes, the sites where people wait"]
    D --> R["Page: Result panel, Where it breaks list,<br/>comparison with reality, digest for the analyst"]
    D --> O["Server: result of a tested option (A8)"]
    D --> O3["Server: retest of a prepared response (A11)"]
    D --> O2["Server: digest returned by POST /analyst/run,<br/>for a question about the run asked without a screen"]
```

**Rules.**
- The conditions are in both passes: they say where one starts from, not what one chooses.
- The engine seeds only once: every outbreak starts on the day of the first, and the screen says so.
- Two conditions of the same kind: the higher one wins, and the screen says so.
- On the page, the two stored events are rewritten at each run under a fixed name. On the server, nothing is stored: a tested option is not an event of the library, and the analyst writes nothing.
- The island's occupancy is weighted by the capacity of each site, added capacity included from the day it opens.
- Both sides read the twin the same way: the context (sites, territories, declared model) comes from the twin as it is, and the engine receives the twin read through the scenario.
- **A recorded response is a stamp like the others** (`response`). Every other stamp is something that happens on a given day; this one carries rules the engine evaluates at every step (B4). It is a choice: only the pass “with the choices” follows it, in place of the “do nothing” response; the “events only” pass never responds. Three origins: the organisation's library (Events page), whose rules travel in the stamp as they were when it was placed; a response the engine writes itself from the network, which goes by its name; and a transfer written by the test of an option of the analyst (A8).
- **The day of a response.** The rules of a response placed on day 12 do not apply before day 12: each rule is shifted, and a rule its author already made start later keeps its own day (`rulesFromStep`, the function the replay of the units page branches with). A response the engine writes itself holds for the whole run: the engine writes its rules, and they cannot be shifted.
- **One response per run.** The engine follows one at a time. If the recipe holds two, the first by day is followed, and the Result panel names the one that is not.
- **What a response cost.** The server reads from the table of steps what the engine counted: the cost each rule declares for its action, each time the action fired (`PassDigest.cost`). Zero when the pass follows no response, or one none of whose rules declares a cost; what that zero means is settled in A8.
- **A limit that is said.** A response that adds or moves units during the run changes the capacity of the sites, and the engine does not return the capacity of each day. The island's occupancy is then weighted by the usual capacity, and the run says so in its notes.

**The same scenario gives the same figures on the page and on the server.** The translation of the stamps and the reading of the tables exist in two copies, one per side. What holds them together is a recording of the real engine, `backend/src/services/scenario-run-parity.fixture.json`: a small twin, a scenario, options, what each run asks of the engine (the effects, and the response followed when there is one), what the engine answers, and the digest that comes out. The server's test and the page's test both replay it, each with its own code. Each must send the engine the recorded requests and find the recorded figures: changing one side alone makes the other fail.

```mermaid
flowchart LR
    M["Real engine, launched by hand<br/>make-scenario-run-fixture.ts"] --> F["Recording:<br/>requests, answers, digests"]
    F --> TS["Server's test:<br/>scenario-run.ts replays"]
    F --> TP["Page's test:<br/>runScenario and runDigest replay"]
    TS --> Q{"Same requests to the engine,<br/>same figures?"}
    TP --> Q
    Q -->|"yes on both sides"| OK["The page and the server agree"]
    Q -->|"no on one side"| KO["That side changed alone: its test fails"]
```

The recording holds six runs: the scenario as it is; the scenario with the stamps of an option; the scenario where an option replaced a choice (the old stamp removed, the new one written); and three runs with a recorded response: a response of the library (a transfer of patients, placed on a given day, at a declared cost), a response the engine writes itself, and the transfer as the analyst's test writes it. All but the first are what guarantees that applying a tested option to the scenario and then launching Run gives the figures of the test again, a recorded response included. It is regenerated by hand when the engine or the translation changes (`cd backend && npx tsx scripts/make-scenario-run-fixture.ts`, with Python and the dependencies of the simulation service), then both suites are run again.

On the server, the run exists in two forms. `ScenarioRunner.digest` does both passes, like the page: it is the one the parity test replays, and the one `serverRun` calls for the route `POST /v1/ontology/:env/analyst/run`. That route returns the digest a person would have on screen after Run, so that a question about the run can be asked by a script, without a browser ([The analyst](/docs/product/analyst), the reference questions). It calls no model, writes nothing, and refuses an activity no site offers before calling on the engine. `ScenarioRunner.full` does only the “with the choices” pass: that is what a tested option reads (A8), because the options' table compares the scenario with its choices to the scenario with the option added, and the “events only” pass shows nothing there. The retest of a prepared response (A11) reads the same pass, for the same reason. Both forms go through the same digest of a pass (`passFigures`), so a column of the table cannot differ from what Run displays for the same pass; a test checks it on the recording.

Testing several options does not redo everything: a spread is kept according to what was asked of it, so an option that only adds beds does not reintegrate the epidemic. Each call to the engine is timed (`timings`), so that the duration of a test is a measurement and not an impression.

**Code.** Page: `frontend/app/studio/simulation/hex/engine.ts` (`runScenario`), `stamps.ts` (`engineInput`), `run-digest.ts`, `frontend/app/studio/command/branch.ts` (`rulesFromStep`). Server: `backend/src/services/scenario-run.ts` (`ScenarioRunner`, `serverRun`, `costByStep`), `scenario-stamps.ts` (`engineInput`, `rulesFromStep`, `twinContext`), `scenario-run-recording.ts`, route `POST /v1/ontology/:env/analyst/run` in `backend/src/routes/analyst.ts`. Recording: `backend/scripts/make-scenario-run-fixture.ts`, `simulation-service/scripts/engine_once.py`.
**Tests.** `hex.test.ts`, `HexTwinView.test.tsx`, `run-parity.test.ts` (page); `scenario-run.unit.test.ts` (server).

## A5. Where it breaks

**Purpose.** A peak of 96 % across all sites says the network held. It does not say that four hospitals were full for three weeks. Occupancy caps at 100 % and says nothing about those who were turned away: it is the queue, site by site, that says it.

```mermaid
flowchart TD
    A["Grid of day by site: occupancy and queue"] --> B["For each site that offers the activity"]
    B --> C{"A queue of at least 0.5 person<br/>at the end of the day?"}
    C -->|"no"| D["Day without a queue"]
    C -->|"yes"| E["First day, number of days,<br/>largest queue and its day,<br/>patient-days of waiting"]
    E --> F["Digest per pass: sites with a queue,<br/>first day, patient-days, peak"]
    F --> G["Both passes side by side,<br/>the worst first"]
    A --> H["Territories no site serves:<br/>unserved minus the visible queues"]
    H --> G
```

**Rules.** A queue under 0.5 is arithmetic, not a person. A patient-day of waiting counts one person waiting one day: one person for three days counts three. A territory with no site for the activity appears in no line of the engine: it is named apart, so that a tenth of the island is not waiting under a panel that says nobody waits.

**Code.** `frontend/app/studio/simulation/hex/results.ts`, `BreakList.tsx`. **Tests.** `results.test.ts`.

## A6. Comparison with reality

**Purpose.** Set an observed series on the axis of the run and say how far apart the two are, starting with what misleads least.

```mermaid
flowchart TD
    A["Rows of a dataset"] --> B["Place each date on a day of the run.<br/>Day not reported: empty, not zero"]
    B --> C{"Cumulative column?"}
    C -->|"yes"| D["Differences from one day to the next"]
    C -->|"no"| E["Observed series"]
    D --> E
    E --> F["Keep the days where both series have a value"]
    S["Simulated arrivals per day"] --> F
    F --> G["1. Gap between the two peaks, in days"]
    G --> H["2. Mean absolute error per day"]
    H --> I["3. Correlation, given last and never alone"]
```

**Rules.** A repeated date: the last row wins, there is no summing. Two curves that rise then fall correlate strongly whether the model is right or not: correlation only comes last. A fit after the fact is not a forecast, and the screen says so.

**Code.** `backend/src/services/observed-series.ts`, route `POST /v1/ontology/:env/observed-series`, `frontend/app/studio/simulation/hex/RealityCheck.tsx`. **Tests.** `observed-series.unit.test.ts`.

## A7. Hexagon grid and layers

**Purpose.** A single grid for everything shown on the map: a stretcher reading, the population of a territory and a drawn measure fall on the same cells, so they overlay without a join.

```mermaid
flowchart TD
    A["The twin's located sites"] --> G["H3 cells, whose size follows the extent of the network"]
    B["Outlines of the territories, if there are any"] --> G
    G --> C{"Outlines available?"}
    C -->|"yes"| D["Each cell takes the territory<br/>whose outline contains it"]
    C -->|"no"| E["Each cell takes the territory<br/>of the nearest site"]
    D --> F["Residents spread over the cells of the territory"]
    E --> F
    F --> H["A layer: a site on its cell,<br/>a territory on all its cells"]
    H --> I["Several values on one cell:<br/>sum, mean or maximum, as the layer declares"]
```

**Rules.** The grid is built from the twin, never shipped with the client. The way of combining is declared by the layer: beds add up, a temperature does not.

**Code.** `frontend/app/studio/simulation/hex/hex-grid.ts`, `layers.ts`, `backend/src/services/twin-layers.ts`. **Tests.** `hex.test.ts`, `twin-layers.unit.test.ts`.

## A8. Options tested by the engine

**Purpose.** A recommendation that rests on no run is an opinion. The person states their objective; the analyst proposes up to three options, and each goes through the engine before being shown, beside the scenario as it is. The model writes sentences; the figures of the table, the stamps and the levels of evidence come from the program. What an option may contain, and within what bounds, is set by project: those are the action types (A14).

```mermaid
flowchart TD
    A["The person's objective,<br/>open scenario, the page's horizon and activity"] --> B["The analyst reads: run on screen, site, territories, recipe"]
    B --> B2["scenario_recipe: each choice of the scenario<br/>carries a name (choice-a, choice-b…)"]
    B --> B3["list_responses: the recorded responses<br/>(library, engine), each under a name,<br/>and where a site's patients can be sent"]
    B2 --> C["test_option: a label and 1 to 4 changes.<br/>Add a capacity, a measure, a transfer<br/>or a recorded response;<br/>replace a named choice, or remove it"]
    B3 --> C
    C --> D{"Testable?<br/>known site that offers the activity, declared layer,<br/>transfer route in the twin, a single response,<br/>day within the run, not already tested, fewer than 3 tests"}
    D -->|"no"| E["Reasoned refusal, read by the model.<br/>Does not count as a test"]
    E --> B
    D -->|"yes"| D2{"Does the change name<br/>a choice of the scenario?"}
    D2 -->|"no: it adds"| F["Changes written like the page's stamps"]
    D2 -->|"yes"| D3{"Is it really a choice (measure, capacity),<br/>of the same kind, named only once,<br/>and replaced by something other than itself?"}
    D3 -->|"no"| E
    D3 -->|"yes"| D4["The old stamp leaves the list.<br/>Replacement: what the change does not say<br/>is kept from the old one"]
    D4 --> F
    F --> F2{"For each capacity the price list prices:<br/>does the mode exist, and does its delay<br/>allow the day asked? (A12)"}
    F2 -->|"no"| E
    F2 -->|"yes, or nothing to price"| G["One pass of the scenario as it is, with its choices:<br/>launched once, kept for all the options"]
    F2 -->|"yes, or nothing to price"| H["One pass of the scenario, the removed stamps taken out,<br/>those of the option added (A4)"]
    G --> I["Result for the model: both runs in digest,<br/>the sites where people wait, what the option rests on"]
    H --> I
    H --> J["Record for the screen: whole figures, stamps written,<br/>choices removed, what is added, replaced, removed,<br/>arrivals per day, levels of evidence,<br/>cost counted by the engine,<br/>and the ledger of the price list when the twin declares one (A12)"]
    I --> K{"Another option to test?"}
    K -->|"yes"| C
    K -->|"no"| L["give_options: one mechanism per option,<br/>what the test does not say, reading, trade-offs, limits"]
    L --> M{"Is every tested option listed,<br/>and nothing else?"}
    M -->|"no"| N["Sent back to the model: an untested option is not listed,<br/>a tested option is not hidden"]
    N --> L
    M -->|"yes"| O["Number verifier on every sentence (A2)"]
    O --> P["Proposal: table drawn from the records,<br/>in the order of the tests, with no ranking"]
    J --> P
    P --> P2{"Two options whose cost is whole,<br/>and one costs as much or more<br/>for as much or more waiting?"}
    P2 -->|"yes"| P3["That one is marked Dominated,<br/>with the name of the option that dominates it"]
    P2 -->|"no"| P4["No Dominated.<br/>With a price list on screen:<br/>Not beaten on the weighed options none beats (A12)"]
    P --> Q{"Add to scenario / Apply to scenario:<br/>a human click. Does the option remove a choice?"}
    Q -->|"no"| Q1["The stamps are written"]
    Q -->|"yes"| Q2["The recipe is read again"]
    Q2 --> Q3{"Is every stamp to remove<br/>still there?"}
    Q3 -->|"no"| Q4["Nothing is written, and the screen says which one is missing"]
    Q3 -->|"yes"| Q5["For each stamp: the new one written, then the old one removed.<br/>Finally the choices removed with no replacement"]
    P --> R["Record decision: a human click (A9)"]
```

**Rules.**
- Three options at most per objective, four changes at most per option. Each test costs the engine one pass of the network, plus a spread if the option changes a contact; the scenario as it is costs one pass, once only. So three options make four passes. The “events only” pass that Run does on the page is not launched: nothing in the table reads it.
- The passes follow one another; they do not run at the same time. The simulation service is a single process: measured locally, launching two passes together gains only 18 % over launching them one after the other, for twice the memory.
- Each test keeps in its record what its duration was made of: reading the twin (on the first test only), then each call to the engine. That record goes to the journal, not to the model.
- A capacity is tested at a site that already offers the activity; negative, it closes units, never more than the site has. A measure is tested on a contact layer the twin declares.
- **A recorded response in an option.** The `response` change names a response by the name `list_responses` gives it: `response-a`, `response-b`… for those of the organisation's library, sorted by name; `transfer-when-full` and `surge-then-transfer` for the two the engine writes itself. As for a choice, never a UUID. A response of the library can start on a given day; a response of the engine holds for the whole run, and giving it a day is refused. It becomes a `response` stamp of the option, tested by the same run as the other stamps (A4).
- **A transfer of patients.** The `transfer` change names two sites, a number of patients per day and a day. The program writes its rule (`transferRule`): when somebody waits at the first site for the activity the run reads, and the second has a free unit of it, up to that number of patients are sent there. The condition on the destination is not one precaution more: without it patients are sent to wait behind those of a full hospital. Several transfers of one option make a single response, one rule each. Refused, with what can be asked instead: two sites between which the twin holds no transfer route (the refusal lists where the patients of the first can go), a destination that does not offer the activity, more patients a day than a route carries.
- **What a route carries.** The twin holds the flow of no route. So the run gives each the same: twenty patients a day (`ROUTE_CAPACITY`), on the page as on the server. It is an assumption of the engine, and it appears as such among what the option rests on; that the route exists is a measure of the twin.
- **One response per run, hence per option.** An option holds either one `response` change or `transfer` changes. If the scenario already follows a response, the test is refused until the option removes it (`remove`, by its choice name): testing another in its place is then a single test.
- **The cost comes from two places, and from nowhere else.** The engine counts one thing (`costOf`): the cost a rule of a response declares for its action, each time it fires. The twin's price list, when it declares one, gives the cost of the capacity the option opens (A12, `withPriceList`). The two are added when both exist; neither stands in for the other. Without a price list, nothing changes: a capacity and a measure then have no price, and the card writes that in place of a figure. A response none of whose rules declares a cost is unpriced, not free. The transfer the program writes declares no cost: nobody gave one, and inventing one would put on screen a figure no tool returned.
- **A cost is called whole when everything the option changes has a price**: a response with a declared cost, capacity the list prices, or both. A measure, a capacity the list does not hold, units that are closed, a choice taken out of the scenario have no price: the count is then shown and said to be incomplete.
- **A mode is chosen, and its delay is respected.** When the list prices an activity in several modes, `test_option` asks which one each capacity uses, and refuses a day the mode's delay does not allow, saying the first day possible and the modes that are fast enough (A12). That is what makes it possible to test the same capacity sooner at a higher price, or later at a lower one.
- **A demo price shows.** A price row with no source is a demo price, and every total that contains one carries the “demo price” mark. The amounts the rules of a recorded response declare have no source either: what the engine counts for it carries the same mark (`OptionCost.demo`), and the tool's result says so to the model.
- **A dominated option is marked, from the runs.** Between two options whose cost is whole, the one that costs as much or more and leaves as much or more waiting (strictly worse on one of the two) carries “Dominated” and the name of the other. It is the only comparison of cost and effect that needs no exchange rate between a dollar and a patient-day: whatever value one gives them, that option is not the one to prefer on these two counts. The waiting counted includes that of the territories no site serves, so that a queue moved out of sight does not pass for a queue avoided. The marking is made by the function of the replay of the units page (`dominatedBy`, `frontend/app/studio/command/options.ts`): both screens make it the same way. An option whose cost is not whole is neither dominated nor dominating: it would take a price nobody gave. When a price list is on screen, the weighed options no other beats carry “Not beaten” (A12).
- **Replacing or removing a choice.** A change can take the place of a choice the scenario already holds (`replaces`), or remove it (`remove`). “40 beds instead of 60” is then a single stamp at +40, and not a −20 stacked on a +60: the test runs on the scenario without the old stamp and with the new one, and that is what the recipe will hold. A replacement says only what differs (the units, the day, the duration); the rest is kept from the choice replaced.
- **A choice is designated by a name, not by its identifier.** `scenario_recipe` gives each choice a name made of letters (`choice-a`, `choice-b`…), valid for the time of the exchange. A stamp's identifier is a UUID: thirty-six characters to copy without a mistake, and full of digits the verifier would then find “in a step”. The record of the test, for its part, keeps the stamp's identifier: that is what the page removes.
- **Only a choice can be replaced.** A starting condition says where the run begins, an event says what happens: an option that removed one would test another scenario while calling it a response. Neither has a name, and designating them is refused, with the list of what can be. Also refused: replacing a capacity by a measure (one is removed and the other added, in the same option), naming the same choice twice, replacing a choice by itself.
- **What is removed is said.** The record lists what the option adds, replaces and removes, in sentences written by the program from the stamps; the option's card shows them as they are, and “Takes out of the scenario: …” appears among what the option rests on, at the **assumption** level. A recorded decision keeps them.
- A refusal by the engine (a scenario with no event, for example) is read by the model. An engine that cannot be reached is a failure: the exchange stops and says so, with no invented option.
- The level of evidence of each item is assigned by the program, from where it comes from: **measured** for what the twin holds (units of a site, residents of a territory), **published** for the rate of a heat wave, **assumption** for the scenario's conditions, the choices, the option itself (the rules of a response included: when they fire, their delay, their effectiveness, their cost are what their author wrote), the engine's routing rule and the flow of a route. The model chooses none of them.
- The mechanism of an option is checked against the result of its own test; the reading, against the steps it cites; the rest, against everything that was read. A figure of the objective belongs to the person and can be repeated.
- The mechanism and the reading get both checks of the verifier (A2), like the paragraphs of an answer: a figure nobody returned, and a figure that exists but is written beside the wrong site or the wrong territory.
- The table follows the order of the tests, whatever order the model lists the options in: an order it chose would be a ranking. Nothing ranks the options: saying which ones reach the objective according to the runs is a reading, choosing between them belongs to the person. Trade-offs of values are presented apart, as such. “Dominated” is not a ranking: the mark says nothing of two options neither of which dominates the other, and choosing between those stays with the person.
- The analyst writes nothing. An option enters the scenario on the “Add to scenario” click, written like a stamp placed on the map; Run then gives the figures of the test again (A4). When the option removes a choice, the button reads “Apply to scenario”: the recipe is read again, and if a stamp to remove is no longer there (someone edited it since the test), nothing is written and the screen says so. Otherwise the new stamp is written then the old one removed, as the recipe does when a stamp is edited by hand: a stop half-way leaves one stamp too many, which can be seen, rather than one too few. The parity fixture covers a replacement: the figures of the test and those of Run after the click are the same. If the scenario is no longer the one that was tested, the screen says which of three cases it is: one option added from the tab (Run must give its column again, the other columns no longer describe this scenario), several options added together (no test covered them together), or an edit made elsewhere (every column is out of date).
- A run is not a forecast: the table carries it in its title.

**Code.** `backend/src/services/analyst-options.ts` (`testOption`, `choiceNamed`, `stampOf`, `responseStamp`, `transfersStamp`, `costOf`, `withPriceList`, `settleMode`, `priceBasis`, `benchFor`, `optionsClosing`), `price-catalogue.ts` and `cost-ledger.ts` (A12), `analyst-responses.ts` (`listResponses`, `listedResponses`, `transferRule`, `transferRoutes`, `whatRulesDo`, `declaresCost`), `scenario-stamps.ts` (`basisOfStamp`, `choiceRefs`, `choiceLine`), `scenario-run.ts` (`ScenarioRunner.withOption`, `ROUTE_CAPACITY`), `analyst-tools.ts` (`scenario_recipe`), route `POST /v1/ontology/:env/analyst/options` in `backend/src/routes/analyst.ts`; `frontend/app/studio/simulation/hex/OptionsTab.tsx`, `option-cards.tsx` (`weighOptions`, `CostLine`, `DelayLine`, `DemoPrice`), `analyst-parts.tsx` (`OptionChanges`), `option-write.ts` (`writeOption`), `addOption` in `HexTwinView.tsx`, `frontend/app/studio/command/options.ts` (`dominatedBy`).
**Tests.** `analyst-options.unit.test.ts`, `scenario-run.unit.test.ts` (parity, including the replacement and the recorded responses), `option-cards.test.tsx`, `command/options.test.ts`, `analyst-tools.unit.test.ts`, `routes/analyst.unit.test.ts`, `OptionsTab.test.tsx`, `option-write.test.ts`, `run-parity.test.ts`, `DecisionsTab.test.tsx`, `HexTwinView.test.tsx`. The fixture `scenario-run-parity.fixture.json` is written by `backend/scripts/make-scenario-run-fixture.ts`.

## A9. Recorded decision and follow-up

**Purpose.** Keep what a person retained with the result they expected of it, so that it can be set later against what happened. Without that, only a memory is compared with a result.

```mermaid
flowchart TD
    A["Record decision click on a tested option"] --> B["The browser sends two things:<br/>the identifier of the exchange and the step of the test"]
    B --> C["The server reads the exchange back from its journal"]
    C --> D{"An options exchange, delivered,<br/>and the step is a successful test?"}
    D -->|"no"| E["Refusal: only a tested option can be recorded"]
    D -->|"yes"| F["Copied from the journal: objective, option, stamps,<br/>figures with and without the option, arrivals per day,<br/>levels of evidence, source steps"]
    F --> G["Row of app.decision: who, when, which scenario.<br/>Never modified afterwards"]
    G --> H["Decisions tab: expected without the option, expected with it"]
    H --> I{"Is an observed series linked to the scenario?<br/>the reality setting"}
    I -->|"no"| J["Says why there is nothing to compare"]
    I -->|"yes"| K["Observed series set on the days of the run (A6)"]
    K --> L["Arrivals expected by the tested run,<br/>for the severity the series counts"]
    L --> M["Gap: totals over the common days,<br/>average gap per day, offset of the peaks"]
    M --> N["The gap is given as it is.<br/>The person judges"]
```

**Rules.**
- No figure of a decision comes from the browser. The server copies them from the journalled exchange (`app.analyst_exchange`, kind `options`): a figure sent with the request is ignored, and a step that is not a successful test is refused.
- A decision stands on its own: it keeps the name of the scenario and a copy of the source steps, to stay readable if the scenario or the exchange disappears.
- A decision cannot be edited. Revising it means recording another one.
- **A decision keeps the expected cost, and the prices it was counted from.** The cost of the option is copied from the journal with its whole ledger (A12): the lines, the price of each, its source or the demo mention, the mode and the day the units were to be open. A price corrected later in the twin does not change what the decision shows: the Decisions tab reopens the lines of the day of the test.
- The follow-up compares arrivals, nothing else: it is the only thing the tested run expected that the network also counts day by day. The twin keeps the readings of its own measures (D11), but those are not the queue or the occupancy the engine counts, and nothing sets them beside a run yet. So the expected queue has nothing observed beside it, and the screen says so.
- A day the series does not report is not compared. A series that reports nothing does not give a gap of zero, it gives no gap.
- The follow-up does not conclude. It gives the gap; saying whether the decision held belongs to the person.

**Follow-up on the signal.** A decision taken on a signal is read back with what was measured afterwards, in the same place: that signal's situation card.

```mermaid
flowchart TD
    A["Situation card of a signal"] --> B{"Signal raised by an alert on a unit,<br/>on a measure the twin keeps?"}
    B -->|"no"| B1["The card says why nothing is followed"]
    B -->|"yes"| C["Readings of that measure at that unit (D11),<br/>from when the signal was raised to its closing, or to now"]
    C --> D{"Was a decision taken on this signal?"}
    D -->|"no"| E["Measured since it was raised:<br/>the value when raised, the lowest, the highest, the last reading"]
    D -->|"yes: the first one counts"| F["Delay between the signal being raised and the decision,<br/>written on the signal's log when the response is engaged"]
    F --> G["Measured since the decision:<br/>the value at the decision, the lowest, the highest,<br/>the last reading, and the measured change"]
    F --> H["Expected: what the tested run gave.<br/>The retest made at opening if it gave figures, else the kept test;<br/>the site's figures when the unit is one"]
    G --> I["Set side by side, never subtracted:<br/>the run counts a queue and an occupancy capped at 100%,<br/>the twin measures what the organisation defined"]
    H --> I
    E --> J["What became of the alert: it holds, it is acknowledged,<br/>or it cleared, and how long after"]
    I --> J
    J --> K["The card gives the figures and stops.<br/>The person judges"]
```

- **Measured, recorded, expected: three things, never mixed.** Measured: the measure that raised the signal, at its unit, as the twin wrote it down (D11). Recorded: who decided, when, and how long after the signal was raised. Expected: what the run that tested the response gave, in the engine's terms. The screen separates them under three headings.
- **No figure sets the run against the twin.** The run counts people waiting and an occupancy that stops at 100% of capacity; the twin measures what the organisation defined, and can read 143%. Subtracting one from the other would give a number that means nothing. Each side gives its own change, in its own unit: points of the measure on one side, patient-days of waiting on the other. The card writes why no gap is computed between the two.
- **The run in question is named.** When the retest made at the opening of the signal had given figures, those are the ones shown, with their date. Otherwise it is the test kept in calm time, and the card says so. The figures by site always come from the kept test: a retest keeps only the network's. If the signal's unit is not a site of that run, the run gives no figure for it, and the card writes so.
- **The delay is written twice.** It is computed from two recorded times, the signal's and the decision's, and it is also written on the signal's log when the response is engaged (`secondsSinceRaised`), a log nothing modifies afterwards.
- **What the twin showed.** The value “at the decision” is the last reading written down at that moment: what the person had in front of them, not what the source published later for the same hour.
- **No new reading is not no change.** When nothing was written down since the decision, the card writes so, and gives no change. A measure that lost its value says so instead of showing a figure.
- **A caught-up reading is said.** When readings counted over the stretch were caught up afterwards from a kept copy of the source (D12), the card writes how many: the twin did not show them at the time.
- **A change after a decision is not its effect.** Other things changed at the same time, and this follow-up does not tell them apart. The card says so, and does not conclude.
- **A closed signal** is followed until its closing, and the card keeps how it was closed.
- **What is not followed.** A signal no alert raised has no measure. Neither does a signal raised on a built-in count: the twin keeps only the measures the organisation defined. A signal older than the history has no readings before the day it started. Each case is written on the card.

**Prepared response and engagement.** A decision can also be taken on a signal, by engaging a response prepared in calm time.

```mermaid
flowchart TD
    A["Click Keep as a prepared response for…<br/>under a tested option"] --> B{"Has the scenario changed<br/>since the tests?"}
    B -->|"yes"| B1["Button refused: the figures would be<br/>those of another scenario"]
    B -->|"no"| C["The browser sends: the exchange, the step of the test,<br/>the kind of signal, who can approve"]
    C --> D{"Step = a successful test of an options exchange,<br/>and a kind of signal of this organisation?"}
    D -->|"no"| E["Refusal: only a tested option can be kept"]
    D -->|"yes"| F["Row of app.prepared_response: figures copied from the journal,<br/>date of the test, mark of the scenario's choices"]
    F --> G["Situation card of a signal of that kind:<br/>responses in the order they were kept"]
    G --> G2{"Did the retest made when the signal opened<br/>give figures? (A11)"}
    G2 -->|"yes"| G3["Its figures are the card's, with their date;<br/>those of the kept test stay written below"]
    G3 --> K
    G2 -->|"no, or not yet"| H{"Does the kept test still speak of the present?"}
    H -->|"scenario gone, scenario changed,<br/>or a test more than 30 days old"| I["The reason is written above the button"]
    H -->|"nothing known against it"| J["No warning"]
    I --> K["Click Engage"]
    J --> K
    K --> L{"A signal of this project, open,<br/>with a stage ahead of it,<br/>and a response prepared for its kind?"}
    L -->|"no"| M["Refusal, before any write"]
    L -->|"yes"| N["1. Decision: app.decision, tied to the signal<br/>and to the response, the kept test's figures as expected;<br/>those of the retest the card showed, beside them"]
    N --> O["2. Signal's trail: option_taken,<br/>the response, the person"]
    O --> P["3. The signal moves one stage forward;<br/>if the stage requires an approval,<br/>the person engaging is the one approving"]
```

- **Only a tested option can be kept.** Like a decision, a prepared response is copied by the server from the journalled exchange. No figure comes from the browser: an untested response cannot pass for a tested one.
- **A test carries its date and its state.** `tested_at` is the date of the exchange. `scenario_mark` is a mark of the scenario's choices when the response is kept: it depends neither on the order of the choices nor on the rows that hold them, and changes as soon as a choice is added, removed or modified.
- **What the test is worth is said before the click.** Three things can be known without running anything again: the scenario no longer exists, its choices have changed, the test is more than thirty days old (`OLD_AFTER_DAYS`). Each is written in one sentence. None says the response is bad. These three sentences are about the kept test: when the retest made as the signal opened gave figures (A11), those are the ones the card shows, and it is their date that is said.
- **The decision keeps both tests.** `expected` stays that of the kept test, with its sites and its arrivals. When the card showed a retest, `expected.retested` holds its two runs and their date, and the Decisions tab writes it under the expected figures.
- **Nothing is ranked.** The responses are listed in the order they were kept.
- **Every refusal comes before the first write.** A signal's trail cannot be rewritten: an engagement that cannot go through is refused before it leaves a line there (`stageAhead`).
- **Retiring is not erasing.** A retired response is no longer offered; the decisions that engaged it still read.
- **Nothing is triggered elsewhere.** Engaging records and follows. The screen says so.

**Code.** `backend/src/services/decisions.ts` (`decisionFromExchange`, `followUp`, `realityOf`, `listDecisionsForSignalType`, `listDecisionsForSignal`), `signal-follow-up.ts` (`signalFacts`, `signalFollowUp`), `twin-history.ts` (`readReadingsBetween`), `prepared-responses.ts` (`scenarioMark`, `standingOf`, `onCard`), `response-retest.ts` (`expectedOnEngage`), `signals.ts` (`stageAhead`, `recordOptionTaken`, `moveSignal`), `backend/src/routes/decisions.ts`, `routes/prepared-responses.ts`, migrations `060_analyst_exchange_kind.sql`, `061_decision.sql` and `065_prepared_response.sql`; `frontend/app/studio/simulation/hex/DecisionsTab.tsx`, `KeepPrepared.tsx`, `frontend/app/studio/situation/PreparedResponses.tsx`, `SituationView.tsx`.
**Tests.** `decisions.unit.test.ts`, `signal-follow-up.unit.test.ts`, `prepared-responses.unit.test.ts`, `analyst-options.unit.test.ts` (from a tested option to a decision), `routes/decisions.unit.test.ts`, `DecisionsTab.test.tsx`, `KeepPrepared.test.tsx`, `PreparedResponses.test.tsx`.

## A10. Online search and calendar of events

**Purpose.** Say what was happening around the network at a given date: a curfew, a school closure, a heat wave. The analyst knows only the twin; here it can search online, in the only sources the project authorises. Each find is a **candidate**, and a candidate is nothing until a person has accepted it. This is the “Precedents” step of the [loop](/docs/product/decision-loop).

```mermaid
flowchart TD
    A["The person's request:<br/>a place, a period, a subject"] --> B["A separate exchange: no tool that reads the twin,<br/>a scenario or a dataset"]
    B --> C["Web search of the Claude API, called directly:<br/>the project's domains only, 8 searches at most,<br/>planned in advance and launched together"]
    C --> D["web_search step: the query and the pages returned<br/>address and title; the content stays encrypted"]
    D --> E["The model writes what the pages say,<br/>one sentence per event: the API attaches its citations to it"]
    E --> F["One web_passage step per citation:<br/>address, title, passage of 150 characters at most"]
    F --> F2{"At least one passage noted?"}
    F2 -->|"no"| F3["The conversation continues as it is:<br/>the model still has to write from the pages"]
    F3 --> E
    F2 -->|"yes"| G["A fresh conversation: the request, the searches made,<br/>the passages noted with their step number.<br/>The pages are not sent again, search is no longer offered"]
    G --> H["give_events: for each candidate a title, dates,<br/>a place, a gate, its passages, a quotation"]
    H --> I{"Is every cited passage<br/>a web_passage step?"}
    I -->|"no"| H
    I -->|"yes"| J{"Quotation word for word in a passage, under 15 words?<br/>Dates stated by a passage?<br/>Figures of the title in the passages?<br/>Page among the authorised sources?"}
    J -->|"no, and fewer than two drafts sent back"| K["Draft sent back to the model,<br/>with what is missing and the passages"]
    K --> H
    J -->|"no, on the last draft"| L["What is missing is removed: date left empty,<br/>quotation replaced by the start of the passage,<br/>figure of the title removed, candidate outside the sources set aside"]
    J -->|"yes"| M["Candidates on screen: Published level,<br/>WEB chip with the link, quotation in quotation marks"]
    L --> M
    M --> N{"The person"}
    N -->|"Reject"| O["Nothing is sent to the server:<br/>the candidate enters no table"]
    N -->|"Accept, dates corrected if need be"| P["The browser sends the exchange, the candidate and the dates"]
    P --> Q["The server copies from its journal the title, the place,<br/>the gate, the link, the quotation and the passages"]
    Q --> R["Row of app.health_event:<br/>validated dates, proposed dates, who, when"]
    R --> S["Context lane of the timeline:<br/>placed from the date of the scenario's day 0"]
    R --> T["The analyst's list_events tool:<br/>events, days of the run, source, quotation"]
    T --> U["Answer of the Ask tab: WEB chip with the link,<br/>Published level, never “measured”"]
```

**Rules.**
- **Nothing from the twin leaves in a search.** The exchange has no reading tool and its context names neither the project nor the scenario: the model has at hand only the person's request, the list of sources and today's date. So a query can hold only a place, a period and a subject. Every query is a step, shown and journalled.
- **Sources.** The list of domains can be set per project (`app.project_web_source`). With nothing set, the starting list applies: inspq.qc.ca, quebec.ca, msss.gouv.qc.ca, donneesquebec.ca, canada.ca, who.int. A domain covers its subdomains; ASCII only, twenty entries at most. The API restricts the search to that list (`allowed_domains`), and the server checks in turn that a candidate's page is in it.
- **Cap.** Eight searches per request (`max_uses`). They are called directly (`allowed_callers: ["direct"]`) and not from the API's code sandbox: that way each search is a visible step, and the cap holds for the whole exchange, which it does not for a search launched from the code sandbox.
- **The searches start together.** The instructions ask for the searches to be planned before the first and launched in the same step. A search launched on its own makes the model read again everything the earlier ones returned. One more search remains possible afterwards, for what the first results did not return. It is an instruction: nothing forces the model to follow it.
- **The pages are read only once.** What a search returns is by far the largest part of what the exchange reads: about 14,000 tokens per search, ten pages each. Yet nothing of a page can reach a candidate other than through a cited passage. As soon as passages are noted, delivery is therefore asked for in a fresh conversation that holds only the request, the list of searches made and the passages. Before, the pages set off again with the delivery, then a third time when a draft was sent back: more than half the tokens of a request. Once that hand-off is made, the search tool is no longer offered: the cap holds for the whole exchange because the tool is no longer there, and not because the API would count from one conversation to the next. What was read stays whole in the steps and in the journal. What a search costs is in [The analyst](/docs/product/analyst), “What a search costs”.
- **The passage is the unit of evidence.** The API returns in the clear only the address and the title of the pages and, under each sentence the model writes from a page, the passage that supports it (150 characters at most). It is the only text of a web page the server holds. A page merely returned by a search supports nothing.
- **Quotation.** Under fifteen words, copied word for word from a passage the candidate cites (give or take spaces and typographic quotation marks). A quotation that cannot be found is replaced, on the last draft, by the first words of the passage, and the screen says so.
- **Dates.** A date holds when a passage (or the title of its page) states the day and the month, in French or in English; the year must be written there, or be a year the passages or the request name. “In January 2022” states no day. A date that cannot be found is removed and left empty: the person reads the source and enters it.
- **Gates.** Each candidate says through which gate it touches a health network: demand, capacity, access, care. The model chooses it; the person sees it before accepting.
- **Level of evidence.** “Published”, assigned by the program. A validated event is never presented as measured by the twin or as the result of a run.
- **Validation.** Accepting sends the identifier of the exchange, that of the candidate and the validated dates, nothing else: the server copies the rest from the journalled exchange (`app.analyst_exchange`, kind `events`, or `investigation` when the candidate comes from an investigation, A13), as for a decision (A9). A candidate the search did not deliver cannot be accepted; the same candidate cannot be accepted twice. The dates proposed by the analyst are kept beside the validated dates.
- **Rejection.** There is no route for rejecting: a rejected candidate enters no table of events, and neither `list_events` nor the timeline sees it. It stays, like everything the analyst wrote, in the journal of the exchange where it was proposed, which no tool reads back.
- **Removal.** An accepted event is removed from the calendar on a confirmed click, kept in the audit log.
- **On the timeline.** The “Context” lane places each event from the date the scenario gives to its day 0 (the “reality” setting). Without that date, nothing is drawn and the lane says why. Events there are outlined, not filled: they are not stamps, the engine never receives them.
- **For the analyst.** `list_events` returns the validated events, with their days on the axis of the run when day 0 has a date: the program counts the days, not the model. Each event's link stays in the record of the step, for the screen.

**Code.** `backend/src/services/analyst-events.ts` (`eventsClosing`, `handoff`, `EVENTS_PROMPT`), the `converse` loop of `analyst.ts` (`Closing.handoff`, `usage.byRequest`), `analyst-web.ts` (`webSearchTool`, `WebReader`, `statedDates`, `dateStated`, `quotedFrom`), `web-sources.ts`, `health-events.ts` (`eventFromExchange`), the `listEvents` tool in `analyst-tools.ts`, route `POST /v1/ontology/:env/analyst/events` in `backend/src/routes/analyst.ts`, `backend/src/routes/health-events.ts`, migration `062_health_event.sql`; `frontend/app/studio/simulation/hex/EventFinderTab.tsx`, `ContextLane.tsx`, `context-lane.ts`, `WebChip` in `analyst-parts.tsx`.
**Tests.** `analyst-events.unit.test.ts`, `analyst-web.unit.test.ts`, `web-sources.unit.test.ts`, `health-events.unit.test.ts`, `analyst-tools.unit.test.ts` (`list_events`), `routes/health-events.unit.test.ts`, `routes/analyst.unit.test.ts`; `EventFinderTab.test.tsx`, `ContextLane.test.tsx`, `context-lane.test.ts`, `AnalystPanel.test.tsx`, `HexTwinView.test.tsx`.

## A11. Retest of a prepared response

**Purpose.** Say what a prepared response would give on the network as it is now, without anyone asking. The test kept in calm time says what it gave the day it was kept. So when a signal opens, the server runs every response prepared for its kind through the engine again, while the person reads the card. No language model takes part.

```mermaid
flowchart TD
    A["A signal has just been created:<br/>by the alert bridge (D5), or by hand"] --> B{"Is a request for this kind of signal<br/>already waiting its turn in this project?"}
    B -->|"yes"| B1["Nothing more: the batch that is waiting<br/>will test the same responses"]
    B -->|"no"| C["The project's queue: one batch at a time"]
    C --> D["Responses prepared for this kind"]
    D --> E{"Already queued or running,<br/>or tested less than a minute ago?"}
    E -->|"yes"| E1["Left as it is"]
    E -->|"no"| F["Row of app.prepared_response_test: queued"]
    F --> G{"Does the scenario of the test still exist,<br/>in this project?"}
    G -->|"no"| G1["abandoned, with the reason"]
    G -->|"yes"| H["Read: the twin as it is,<br/>the twin through the scenario,<br/>the scenario's choices today"]
    H --> I["Mark of the state (stateMark)"]
    I --> J{"Same mark as the last finished<br/>retest of this response?"}
    J -->|"yes"| J1["unchanged: no run,<br/>the row names that retest"]
    J -->|"no"| K["running"]
    K --> L{"Are the choices the response replaces or removes<br/>still in the scenario?"}
    L -->|"no"| L1["abandoned, with the reason,<br/>before any call to the engine"]
    L -->|"yes"| M["Pass of the scenario as it is:<br/>once for the whole batch"]
    M --> N["Pass of the scenario with the response"]
    N --> O{"Did the engine answer<br/>within the limit?"}
    O -->|"yes"| P["done: the two runs,<br/>and what the time was made of"]
    O -->|"limit passed"| Q["abandoned, with the reason;<br/>the next ones of the batch are not tried"]
    O -->|"engine unreachable"| R["failed, with the reason;<br/>the next ones of the batch are not tried"]
    P --> S["Situation card (D9): the retest's figures<br/>take the place of the kept test's"]
    J1 --> S
    G1 --> T["Card: the reason is written;<br/>the figures stay those of the last test known"]
    L1 --> T
    Q --> T
    R --> T
```

**Rules.**
- **The trigger is a signal opening**, through the alert bridge or by hand. The request leaves after the signal is created and nobody waits for it: raising a signal, reading its card and engaging a response do not depend on the engine. An unreachable engine leaves the card whole and “Engage” usable.
- **No language model.** A retest is made of passes of the engine and of nothing else.
- **The scenario as it is now.** The retest runs on the choices the scenario holds today and on the twin read at that instant, with the horizon and the activity of the original test. The choices the response replaces or removes are found by what they are, not by the row that held them: a choice deleted and written again is the same choice. If it is no longer in the scenario, the retest is abandoned and says so, rather than run on something else.
- **The same figures as Run.** The passes are those of a tested option (`ScenarioRunner.full`, A4). A test replays the parity recording and finds the page's figures.
- **One run at a time per project.** A project's batches follow one another. Signals of one kind that open together ask for a single batch.
- **No run when nothing changed.** The mark of the state (`stateMark`) covers what the engine receives: the sites and what they hold, the catchments, the routes, the declared model, the scenario's choices, the horizon and the activity. The time of the reading is not part of it. With the same mark as the last finished retest, the row is `unchanged`, names that retest, and the engine is not asked.
- **A response tested less than a minute ago is left as it is** (`MIN_GAP_MS`), like one already queued or running.
- **The scenario as it is runs once per batch.** Three responses make four passes, not six.
- **A limit.** Past three minutes (`RETEST_TIMEOUT_MS`), the retest is abandoned and says so. When the engine does not answer, the next responses of the batch are not tried: each would only wait for the same silence.
- **Never an unfinished run as a result.** Queued, running, abandoned or failed: the card says where it stands and why, and its figures stay those of the last test known. The queue lives in the server's memory: at start-up, a row left queued or running is closed as abandoned.
- **“The current state” has a duration.** A retest is called “on the current state” for fifteen minutes (`CURRENT_FOR_MS`) after its run, or after the last time the state was found unchanged. After that the card writes how old it is (“Tested on the network as it was 3 h ago”) and flags it before the click.
- **The card states the conditions of the run.** Under the figures of a retest, it writes that the starting state is the twin read when the test ran, hence measured, and that the response, the events and the choices of the scenario are assumptions. A run remains the result of a model under those conditions, not a forecast.
- **The decision keeps what the card showed**: the kept test's figures as expected, and those of the retest beside them, with their date (A9).
- **Duration.** On the Montréal twin, the first response of a batch is retested in one minute: two seconds to read the twin, then two passes of the engine of twenty-nine seconds each, the scenario as it is then the scenario with the response; the spread takes less than a second. Each further response of the batch adds one pass. Each retest keeps what its time was made of (`timing`): a measure, not a result.
- **What the retest does not do.** It starts when a signal opens, not for as long as the card stays open: the card of a signal opened hours ago shows a retest from hours ago, and says so ([issue 26](https://github.com/V1ktor7/obscyro/issues/26)). And it keeps only the figures of the two runs: the sites and the day-by-day arrivals of a decision stay those of the kept test.
- Units and aggregated values, never a person.

**Code.** `backend/src/services/response-retest.ts` (`stateMark`, `retiredNow`, `retestOne`, `Retests`, `sqlStore`, `liveTest`, `expectedOnEngage`, `startRetests`, `requestRetests`), `alert-bridge.ts` and `backend/src/routes/signals.ts` (the request), `backend/src/index.ts` (start-up), `prepared-responses.ts` (`onCard`), `backend/src/routes/situation.ts`, migration `066_prepared_response_test.sql`; `frontend/app/studio/situation/PreparedResponses.tsx`, `SituationView.tsx`, `prepared-api.ts`.
**Tests.** `response-retest.unit.test.ts`, `alert-bridge.unit.test.ts`; `PreparedResponses.test.tsx`, `SituationView.test.tsx`, `DecisionsTab.test.tsx`.

## A12. Prices, the cost ledger and the delay of an option

**Purpose.** Put beside each option what it costs and the day it can be ready, so that a person compares three things: what it changes, how fast, at what price. No price is written in the code. A price is an object of the twin, declared by the institution; the ledger turns it into lines a person can redo by hand. This is not a treasury: no budget, no funding, no cash position.

**The price list, and the ledger of an option.**

```mermaid
flowchart TD
    A["Export of the twin, read through the scenario (B1):<br/>types, objects, sites"] --> B{"Does a type bind a property<br/>to the prices_activity mechanic?"}
    B -->|"no"| B1["No price list:<br/>nothing changes, no cost is added"]
    B -->|"yes"| C["Each instance of that type is a price row:<br/>activity, mode, delay, amounts, formula, source"]
    C --> D{"Can the row be read?<br/>amounts in whole cents, never negative,<br/>low, price and high in order, a whole delay,<br/>an amount or a formula"}
    D -->|"no"| D1["Set aside, with the reason.<br/>Neither rounded nor silently ignored"]
    D -->|"yes"| E{"Two rows for the same activity,<br/>the same mode and the same place?"}
    E -->|"yes"| D1
    E -->|"no"| F["Catalogue"]
    G["Each capacity of the option:<br/>site, activity, units, first day,<br/>days open, mode"] --> H{"Does it open units?"}
    H -->|"no: it closes some"| U["Unpriced, with the reason"]
    H -->|"yes"| I{"Does the site have rows of its own<br/>for this activity?"}
    F --> I
    I -->|"yes"| J["They alone count for this site"]
    I -->|"no"| K["The rows that hold for the whole network"]
    J --> L{"A row for this mode?<br/>A single mode with none named: that one"}
    K --> L
    L -->|"no row for the activity,<br/>mode absent, or mode to be named"| U
    L -->|"yes"| M{"Does the row have a formula?"}
    M -->|"yes"| N["Formula evaluated (A3) with the row's numbers,<br/>then units and days of the operation.<br/>Result in cents, rounded once"]
    N -->|"unknown name, negative result,<br/>or not a finite number"| U
    N -->|"otherwise"| O["One line: the formula,<br/>the values put in place of the names, the amount"]
    M -->|"no"| P["Opening: units × price to open.<br/>Running: units × days open × price a day.<br/>Each at the low, the likely and the high"]
    O --> Q["Ledger: the lines, the total that is their sum,<br/>the low total and the high total, the total by category,<br/>the demo mark, what is unpriced,<br/>and the availability of each change"]
    P --> Q
    U --> Q
```

**The delay of a mode**, checked before any run.

```mermaid
flowchart TD
    A["test_option: a capacity,<br/>with or without a mode"] --> B{"Does it close units?"}
    B -->|"yes, and a mode is given"| R1["Refusal: a mode is a way of opening units"]
    B -->|"yes, with no mode"| N0["No mode, no price"]
    B -->|"no"| C{"Does the list hold a price<br/>for this activity at this site?"}
    C -->|"no, and a mode is given"| R2["Refusal: there is nothing to choose.<br/>list_prices says what is priced"]
    C -->|"no, with no mode"| N0
    C -->|"yes"| D{"Is a mode named?"}
    D -->|"yes, and the list does not have it"| R3["Refusal, with the modes of the list<br/>and the delay of each"]
    D -->|"no, and the list has several"| R4["Refusal: say which one.<br/>Choosing the cheap one or the fast one<br/>would be deciding what is compared"]
    D -->|"yes, and it exists"| E["Mode settled"]
    D -->|"no, and the list has only one"| E
    E --> F{"Does the day asked come<br/>before the end of the mode's delay?<br/>The decision is taken on day 0 of the run"}
    F -->|"yes"| R5["Refusal: the first day possible,<br/>and the modes that are fast enough, if any"]
    F -->|"no"| G["The run opens the units on the day asked"]
    G --> H["Ledger: the lines of that mode.<br/>Availability: the mode, its delay,<br/>the first day the units are open"]
```

**The mark of the options no other beats.**

```mermaid
flowchart TD
    A["Tested options, each with its cost"] --> B{"Whole cost?<br/>Everything the option changes has a price"}
    B -->|"no"| C["Not weighed: neither dominated, nor dominating, nor marked"]
    B -->|"yes"| D["Weighed on two counts: the waiting avoided<br/>against the scenario as it is, and the likely cost"]
    D --> E{"Does another weighed option cost as much or less<br/>for as much or more waiting avoided,<br/>and strictly better on one of the two?"}
    E -->|"yes"| F["Dominated, with the name of the other"]
    E -->|"no"| G{"At least two weighed options,<br/>and a price list on screen?"}
    G -->|"yes"| H["Not beaten.<br/>Several options can carry the mark"]
    G -->|"no"| I["No mark"]
```

**Rules.**
- **Money is data of the twin, not code.** A price list is an object type the institution names as it likes, whose properties are bound to eleven mechanics (`PRICE_MECHANICS`): what the row prices (`prices_activity`), the price of a unit open for a day and the price of opening it, each with a low and a high end, a formula (`price_formula`), the mode (`price_mode`), its delay in days (`price_lead_days`) and the source (`price_source`). Each instance is a row. No amount is written in the API or in the engine, and no type is recognised by its name. A twin that declares no price has no price.
- **A price is for a kind of resource, not for each unit.** The row names an activity, that is, the name of the type whose units are the capacity: sixty beds one adds do not exist yet and still have a price, and correcting a price touches one row. The name is compared without capitals, without accents, and without telling a space from an underscore: “Soins intensifs” and `soins_intensifs` are the same activity.
- **A site's price comes first.** A row attached to a unit, by a placement link, holds for that site (`priced_at`, B1). A site that has its own rows for an activity is priced by them alone; the other sites are priced by the rows with no attachment, which hold for the whole network.
- **Whole cents, from the row to the total.** An amount is declared in whole cents: 125050 for 1,250.50 $. An amount that is not one is refused rather than rounded, because rounding a price is changing it. Every line of the ledger is in whole cents, and a total is the sum of its lines: no sum is a floating-point number. The result of a formula is rounded once, to the cent.
- **A range is read in three passes.** An amount can carry a low and a high end. The ledger then gives three totals: low, likely, high. Nothing is drawn at random. What the screen compares between two options is the likely cost; the range is written beside it.
- **A mode is a price and a delay.** Normal in fourteen days, rush in three at another price: that is what makes “faster costs more” exist. The decision is taken on day 0 of the run; so a capacity cannot be open before the delay of its mode, and `test_option` refuses the day that asks for it, saying the first day possible. The engine itself delays nothing: it opens the units on the day asked, once that day is admitted. A row with no mode is called `standard`; a row with no delay declares zero, and the screen writes that no delay is declared, not that the thing is immediate.
- **A cost function is a formula, not code.** It is written in the calculator's language (A3) and can name two kinds of values: the numbers of its own price row, by the property's name in lower case, and the quantities of the operation. For capacity that is opened, those quantities are `units` and `days`, and they come before a number of the row that would bear the same name. The ledger line keeps the formula, the values put in place of the names and the result: “why does this cost so much” has an answer one can redo.
- **Unpriced is not free.** An activity the list does not hold, units that are closed, a mode that had to be named, a formula that names a missing value or whose result is not a price: no line, and the reason is written among what is unpriced. Never a zero. The cost of the option is then not called whole (A8).
- **A demo price shows, on itself and on what follows from it.** A row with no source is a demo price: it carries the mark, so does the ledger line, and so does every total that contains it. Among what the option rests on, a price that names its source is **published**; a demo price is an **assumption** (`priceBasis`).
- **What the cost covers.** The cost of the choices, and only that: opening units, then keeping them open for the days of the run. Not what the network costs to run, not staff or stocks, which the twin does not hold, and not what a closure would save. The screen says so.
- **Health and money stay apart.** Nothing converts waiting into dollars, and no score mixes the two. “Dominated” and “Not beaten” need no exchange rate: they only say that one option does at least as well as another on both counts at once, or that none does so against it. Several options can be “Not beaten”; choosing between them is the person's.
- **Without a price list, nothing changes.** The same options, the same figures, the same cards; “Not beaten” appears only with a price list on screen.
- **A scenario can change a price.** The catalogue is read from the export of the twin seen through the scenario, like everything else: a scenario that changes a price row with `set_property` (B5) changes the catalogue of that scenario, with nothing more to build.
- **Where prices are seen and corrected.** A price row is an instance: it is created and corrected in the “Instances” view of the ontology, or arrives through a pipeline like the rest of the twin. The “Functions” view shows the whole list, the formulas with what each may name, and the rows set aside with their reason. A type's panel shows the rows that price its units. The analyst reads the same list through `list_prices`.
- **What is missing.** Only the capacity an option opens is priced. A transfer of patients has no price: its formula (a flat fee, so much a kilometre) will have something to apply to the day the ledger prices a transfer, with its own quantities. A measure has no price. The costs of recorded responses remain the amounts of their rules, outside the list (B4). Both are the subject of [issue 39](https://github.com/V1ktor7/obscyro/issues/39).

**Code.** `backend/src/services/price-catalogue.ts` (`catalogueOf`, `modesFor`, `priceFor`, `priceListOf`, `fold`, `OPERATION_NAMES`), `cost-ledger.ts` (`ledgerOf`, `linesOf`, `formatCents`), `analyst-options.ts` (`settleMode`, `withPriceList`, `priceBasis`, `priceLines`), `analyst-tools.ts` (`list_prices`), `analyst-calc.ts` (`evaluate`), `property-schema.ts` (`PRICE_MECHANICS`), `twin-export.ts` (`priced_at`), `decisions.ts`, route `GET /v1/ontology/:env/twin/prices` in `backend/src/routes/twin.ts`; `simulation-service/app/events/mechanics.py` (`PRICE_MECHANICS`); `frontend/app/studio/simulation/hex/option-cards.tsx` (`CostLine`, `DelayLine`, `DemoPrice`, `weighOptions`), `OptionsTab.tsx`, `DecisionsTab.tsx`, `frontend/app/studio/manager/PriceList.tsx`, `price-list.ts`, `frontend/lib/money.ts`, `frontend/lib/property-schema.ts`.
**Tests.** `cost-ledger.unit.test.ts` (the calculation by hand, the formula, the missing value, a site's price, the range), `analyst-options.unit.test.ts` (the mode and its delay, nothing changes without a price list, the invented amount struck, the decision keeps the cost), `twin-figures.unit.test.ts`, `tests/test_events_mechanics.py`; `option-cards.test.tsx`, `OptionsTab.test.tsx`, `DecisionsTab.test.tsx`, `manager/PriceList.test.tsx`, `PropertyRowsEditor.test.tsx`.

## A13. Investigating a series

**Purpose.** When the series of a measure moves at a unit, say what was going on around it, and set each event found beside what the twin measured. Two things work, and stay apart: the program reads the series, its episodes, the calendar and the neighbouring units, then compares; the model searches the allowed sources for events, as in A10, from the person's sentence and nothing else. It is a first piece of the “Measured effects” step of the [loop](/docs/product/decision-loop): it says what coincides, not what causes.

**The work, step by step.**

```mermaid
flowchart TD
    A["The person, on the network map: a unit selected,<br/>the measure the map paints, a span, a sentence"] --> B["p1 twin_series: the readings kept over the span (D11),<br/>as a staircase, and the threshold: the least severe alert rule<br/>that covers this measure at this unit"]
    B --> C{"At least one value<br/>over the span?"}
    C -->|"no"| C1["End. No search is made,<br/>and the screen says where the history starts"]
    C -->|"yes"| D["Episodes: from the first reading beyond the threshold<br/>to the first reading back within it, or with no value.<br/>Two stretches less than 24 h apart are one"]
    D --> E["p2 calendar_events: the validated events<br/>of the calendar over those days (A10)"]
    E --> F{"A threshold, and at least one episode?"}
    F -->|"no"| F1["p3 nearest_units: nothing is read,<br/>and the step says why"]
    F -->|"yes"| F2["p3 nearest_units: the 3 nearest units<br/>that report the same measure,<br/>their series and their episodes at the same threshold"]
    F1 --> G["p4 search_brief: what goes to the web<br/>(the sentence, the sources, 8 searches at most)<br/>and what stays here"]
    F2 --> G
    G --> H["The event search of A10, unchanged:<br/>the model receives the sentence only.<br/>Steps s1, s2, …: searches and passages"]
    H --> I{"Candidates delivered?"}
    I -->|"no"| I1["End. What was read stays in the steps,<br/>no comparison"]
    I -->|"yes"| J["p5 events_beside_series: each candidate,<br/>and each event of the calendar,<br/>set beside the series"]
    J --> K["p6 search_check: what the check<br/>of the search took out"]
    K --> L["Last line of the stream: the candidates,<br/>and the investigation block beside them"]
    L --> M["Journal: the whole exchange, steps included,<br/>under the kind investigation"]
    L --> N["Network page: Investigate tab of the Analyst panel,<br/>and the timeline, which draws the series,<br/>the episodes and the events"]
    N --> O{"The person"}
    O -->|"Accept"| P["The candidate enters the calendar as in A10:<br/>the server copies it from the journal"]
    O -->|"Reject"| Q["Nothing is sent or recorded"]
```

**An event beside the series.**

```mermaid
flowchart TD
    A["An event: its first day, or none"] --> B{"Does it have a date?"}
    B -->|"no"| B1["Not placed. Doubt: no_date"]
    B -->|"yes"| C{"Is its first day<br/>within the span?"}
    C -->|"no"| C1["Not placed. Doubt: outside_span,<br/>before or after"]
    C -->|"yes"| D["Two means of the series:<br/>the 3 days before its first day,<br/>the 3 days from that day.<br/>Each says how many days it rests on"]
    D --> E{"Does an episode start 0 to 7 days after it,<br/>or does the event start during an episode?"}
    E -->|"none"| F["Goes with no episode"]
    E -->|"one or several"| G["The nearest in days.<br/>At the same distance, the one the event comes before"]
    G --> H{"Had the episode already begun?"}
    H -->|"yes"| H1["Doubt: starts_after,<br/>with the number of days"]
    H -->|"no"| H2["Days apart: the event starts before,<br/>or the same day"]
    F --> I{"A side with no day<br/>that has a value?"}
    H1 --> I
    H2 --> I
    I -->|"yes"| I1["Doubt: nothing_before or nothing_after.<br/>No change is computed"]
    I -->|"no"| I2["Change: the mean after minus the mean before"]
    I1 --> J{"Do other events go<br/>with the same episode?"}
    I2 --> J
    J -->|"yes"| J1["Doubt: shared, with their references"]
    J -->|"no"| K["Comparison returned"]
    J1 --> K
```

**Rules.**
- **Nothing the program reads reaches the model.** The search is that of A10: an exchange with no reading tool, which receives only the sentence, the list of sources and today's date. The series, the threshold, the calendar and the neighbours are put in no message. A test holds it: no figure of the series and no unit name appears in what is sent to the model.
- **The sentence is the person's.** The screen proposes one, which names the unit and the two dates of the span, and nothing the twin measured there. The person reads it, changes it if they wish, and sends it: it is the only thing that goes into a search. The `search_brief` step writes it down before the search leaves.
- **An episode is counted against a threshold that exists.** The threshold is that of an alert rule of the project: the least severe of those that cover the measure at this unit, because that is where an alert begins. Without a rule there is no episode, and the result says so: each event is then set beside the means of the days around it only. No threshold is made up, and what is “usual” for a unit is not computed.
- **The series is a staircase**, as on a unit's sheet (D11): a reading stands at the time its source gives, or at the time it was written down when the source does not say, and holds until the next one. The reading in force when the span opens is its first point.
- **One value a day.** A day's value is the mean of the readings dated that day. A day with no reading keeps the value in force when it began. Nothing is filled in before the first reading, and a day when the measure had no value has none: a gap is not a zero.
- **“Goes with” has a precise meaning.** An event goes with an episode when it starts at most 7 days before it, or during it. Beyond 7 days, nothing is said. An event that starts after the episode began cannot have set it off: that is written on it, as a doubt.
- **The doubts are counted by the program.** No date; outside the span; no reading before, or after; the episode had already begun; other events go with the same episode. The model writes none of them.
- **The neighbours say whether the episode is peculiar to the unit.** The three nearest units that report the same measure are read at the same threshold; an episode names those that had one over the same days. Units are placed as the network map places them: a site that counts a single unit is that unit's place. A unit without coordinates has no neighbours, and the result says so.
- **It is not a cause.** An event is published by a source, an episode is measured by the twin, and bringing them together is a supposition. The first limit of the result says so in every case, the screen writes “goes with” and never “caused”, and the three levels stay apart on every event: Published, Measured, and the reasons to doubt.
- **No series, no search.** If the span holds no value, the investigation stops after the first step: nothing is searched or paid for, and the message says which day the history starts.
- **Every step is written down.** The program's are numbered `p1`, `p2`, …; the search's keep `s1`, `s2`, …, which the candidates cite. They arrive in the stream one by one, in the order the work is done, and the screen shows them as they arrive. A read that fails (the calendar, the neighbours) is a failed step and a written limit, not a stopped investigation.
- **The trace can be read again.** The whole exchange is kept in the journal under the kind `investigation`: the sentence, the steps, the series read (in the record of the `twin_series` step), the candidates and the comparison. `GET /analyst/investigations` lists the investigations of a project or of a unit, `GET /analyst/investigations/:id` returns one as it was delivered. Nothing is recomputed when it is read again.
- **A candidate is accepted as in A10.** The server copies it from the investigation's journal; a rejected candidate is recorded nowhere.
- **On the timeline.** The timeline of the Network page draws the series of the selected unit over its own window, the same as the investigation's (24 h, 72 h, 7 days, 30 days). When an investigation of that unit and that measure is on screen, its episodes are bands under the series and its events are marks at the day their source dates them: dashed for a candidate, solid for an event of the calendar. An episode drawn is one the investigation counted, never one guessed from the line. The threshold is drawn only when it is near what was read, and the screen says so when it is not.
- **Bounds.** A span of 366 days at most, 2,000 readings a series (beyond that, the oldest are left out and the result says so). Days are counted on the clock the page sends, the browser's; UTC when none is sent.
- **A caught-up series is said.** When the series holds readings caught up from kept copies (D12), the step that reads it gives their number (`caughtUp`) and a limit of the result writes it: they are what today's measure would have read in the copy, not what the twin showed.
- **What is missing.** One factor at a time: no model separates the share of two events that go with the same episode. No replication: an event seen before an episode has been seen once (the pieces that replicate a lag across several waves are in C3, and are not connected). An event's place is a text, linked to no territory: the investigation does not know whether the event concerns the unit. The history starts the day the recorder started (D11).
- An investigation reads a unit and aggregate values, never a person.

**Code.** `backend/src/services/investigation.ts` (`investigate`, `seriesOf`, `dailyOf`, `lineFor`, `episodesOf`, `nearestTo`, `shareEpisodes`, `compareEvents`), `investigation-journal.ts` (`listInvestigations`, `readInvestigation`), `twin-history.ts` (`readReadingsBetween`), the search of A10 (`eventsClosing`, `converse`), `health-events.ts` (`eventFromExchange`), routes `POST /v1/ontology/:env/analyst/investigate`, `GET /v1/ontology/:env/analyst/investigations` and `/:id` in `backend/src/routes/analyst.ts`, migration `069_analyst_investigation.sql`; `frontend/app/studio/command/InvestigateTab.tsx`, `NetworkAnalyst.tsx`, `investigation.ts` (`stagesOf`, `verdictOf`, `doubtText`, `measuredLines`, `proposedRequest`), `NetworkTimeline.tsx`, `series-lane.ts` (`seriesLane`), `frontend/app/studio/analyst-api.ts` (`investigate`, `stepLabel`).
**Tests.** `investigation.unit.test.ts` (the series, the days, the episodes, the neighbours, the comparison, the investigation end to end with a simulated model, nothing of the series sent to the model, no search without a series), `health-events.unit.test.ts` (a candidate of an investigation is accepted); `command/investigation.test.ts`, `InvestigateTab.test.tsx`, `series-lane.test.ts`, `NetworkTimeline.test.tsx`, `analyst-api.test.ts`.

## A14. Action types

**Purpose.** Setting from the Studio what the analyst may propose. What an option could contain was a fixed list in the code: capacity, a measure, a transfer, a recorded response. A project now declares its **action types**: what each one changes, within what bounds, in how long, and who can approve it. The analyst reads the list and proposes only what it holds; every proposal still goes through the engine (A8), and it is still a person who applies it.

```mermaid
flowchart TD
    A["Action types view of the Studio: a name, what the type changes,<br/>its bounds, its delay, who approves, on or off"] --> B{"Can the draft be read?<br/>bounds in order, no more patients a day<br/>than a route carries in a run"}
    B -->|"no"| B1["Refused, with what to correct"]
    B -->|"yes"| C["Row of app.action_type, under its key"]
    C --> D["The project's list: the four built-in types,<br/>each as the project changed it, then its own"]
    D --> E{"Did the project declare<br/>anything?"}
    E -->|"no"| E1["The analyst is told nothing new:<br/>same instructions, same tools"]
    E -->|"yes"| E2["Instructions added, and the tool list_actions:<br/>the active types with their bounds,<br/>and those the twin does not let it test"]
    E1 --> F["test_option: for each change<br/>that places something"]
    E2 --> F
    F --> G{"Does the change name<br/>its action type?"}
    G -->|"yes"| G1{"Does the type exist, is it on,<br/>and does it change that kind of thing?"}
    G -->|"no"| G2{"How many active types<br/>for that kind of change?"}
    G1 -->|"no"| R["A refusal with its reason, which the model reads.<br/>Nothing runs, and the test does not count"]
    G2 -->|"none, or several"| R
    G1 -->|"yes"| H{"Within the type's bounds?<br/>units, sites, activity, mode; layers, factor, days, catchments;<br/>patients a day and the two ends; response allowed;<br/>days before it can apply"}
    G2 -->|"exactly one"| H
    H -->|"no"| R
    H -->|"yes"| I["The stamp is written as before,<br/>and the run tests it (A8)"]
    I --> J{"Was the type declared<br/>by the project?"}
    J -->|"yes"| J1["The option says which type it falls under<br/>and who can approve it"]
    J -->|"no"| J2["Nothing is added to the option"]
    K["Taking a choice out of the scenario"] --> K1["No action type is asked for"]
```

**The tools a project switches off.**

```mermaid
flowchart LR
    T["A tool's switch,<br/>Action types view"] --> U{"Can the tool<br/>be switched off?"}
    U -->|"no: calculate, test_option, list_actions"| U1["Refused, with the reason"]
    U -->|"yes"| V["Row of app.project_analyst_tool_off"]
    V --> W["Next exchange: the tool is not<br/>offered to the model"]
    V --> X["Web search off: Event finder and Investigate<br/>refuse to start, and say so"]
```

**Rules.**
- **Four effects, those a run knows how to apply.** `capacity` (units of an activity added or closed at a site), `measure` (contact layers scaled in catchments for some days), `transfer` (waiting patients sent from one site to another along a route), `response` (a recorded response the run follows). An action type can name nothing else: staff and stocks are not in the twin, and the analyst puts them in the limits.
- **Nothing is recognised by its name.** The activity, the layers, the sites, the catchments and the responses of a type are picked from what the twin declares (`twinOffer`), never typed. Sites and catchments are kept by their identifier, a response by the one a stamp keeps.
- **The bounds, by effect.** Capacity: an activity, a signed range of units (negative: units closed), sites, a mode of the price list. Measure: the layers allowed with the range of their factor, a number of days at most, catchments. Transfer: patients a day at most (never more than a route carries in a run), the sites of departure, the sites of arrival. Response: the responses allowed. And for all, the days it takes before it can apply, counted from the decision, day 0 of the run.
- **A bound left out is not a bound at zero.** Nothing limits on that side, and the analyst reads “any site” rather than a figure nobody declared.
- **Four built-in types, and a project that set nothing unchanged.** Every project starts with one type per effect, unbounded and on: what the analyst could propose before. They are not written in the database. In a project that declared nothing, the analyst's instructions are the same word for word, the `list_actions` tool is not offered, `test_option` accepts what it accepted and the recorded option carries nothing more: a test holds it. A row under the key of a built-in type is what the project changed of it; removing it makes the type as it was. A built-in type keeps what it changes.
- **The type a change falls under.** A change names it by its key (`action`). Unnamed, it is the one active type of its effect, when there is only one. No active type: the change is refused, and the refusal says to put it in the limits. Several: it has to say which.
- **A refusal comes before the run.** Out of bounds, a type switched off, an unknown type: nothing is sent to the engine, the refusal names the bound that was passed (“allows from 10 to 60 units: 80 is outside that”), the model reads it, and that test does not count among the three of the objective. A refused proposal is never shown.
- **The price and the delay come from the price list.** An action type carries no price. For capacity, it can fix the mode in which the units are opened: the price and the delay are then those of that mode in the list (A12), and another mode is refused. Its own delay (`leadDays`) is one more bound: the longer of the two applies.
- **A type that cannot be tested says so.** An activity no site provides, a layer the twin does not declare, no transfer route, a mode the price list does not hold, sites or responses that are no longer there: the screen writes it on the type, with what is missing, and `list_actions` tells the analyst, which does not propose it.
- **Taking a choice out asks for no type.** Removing from the scenario a capacity or a measure the person placed there stays possible when everything is off. Replacing a choice is placing something: what replaces it is held to the bounds of its type.
- **The option says its type, and who can approve it.** Only for a type the project declared: its name and its approver are copied by the server into the option, then into the recorded decision. The screen writes “can be approved by”, never “approved”: it is a text of the institution, nobody approves in the product.
- **No right to write.** Declaring an action type makes the analyst write nothing. An option becomes a stamp of the scenario through one click, and a decision through another.
- **The tools of the code stay code.** Each tool is tested and its results pass the verifier (A2): a project can neither rewrite one nor remove one. It can switch one off, and it is then no longer offered to the model. A reading tool of its own is declared apart, by a function type (A15), and is switched on or off where it is declared. Three cannot be switched off, and the screen says why: `calculate` (a derived figure has to be computed by a tool), `test_option` (an option that was not tested is not an option), `list_actions`. With the web search off, the event search (A10) and the investigation (A13) refuse to start.
- **Everything is kept in the audit log**: creating, changing, removing or resetting a type, switching a tool off or on.
- **What is missing.** The bounds hold the analyst, not a person: a stamp placed by hand on the map is not subject to them. The approver is a text, not a step: nothing waits for their agreement. The bounds apply to one change, not to a total: two options of 60 beds make 120. Capacity lasts until the end of the run: a type cannot bound its duration. An action type carries no price of its own: what the price list does not price stays unpriced.

**Code.** `backend/src/services/action-types.ts` (`DEFAULT_ACTION_TYPES`, `actionTypesOf`, `readDraft`, `actionFor`, `fitCapacity`, `fitMeasure`, `fitTransfer`, `fitResponse`, `missingFor`, `saidOf`), `analyst-actions.ts` (`twinOffer`, `describeAction`, `listActions`), `analyst-options.ts` (`testOption`, `ACTIONS_PROMPT`, `optionsClosing`), `analyst-settings.ts` (`toolCatalogue`, `toolsOff`, `switchTool`, `offered`), `decisions.ts`, routes `backend/src/routes/action-types.ts` and `analyst.ts`, migration `070_action_type.sql`; `frontend/app/studio/manager/ActionTypes.tsx`, `action-types.ts`, `frontend/app/studio/simulation/hex/analyst-parts.tsx` (`ActionTypesOf`), `frontend/app/studio/analyst-api.ts`.
**Tests.** `action-types.unit.test.ts` (the built-in types, the draft, the type of a change, each bound, what the twin lacks), `analyst-actions.unit.test.ts` (what the twin offers, `list_actions`, a project that set nothing unchanged, a refusal before the run, two types of one effect, an effect switched off, removing without a type), `analyst-settings.unit.test.ts`, `routes/action-types.unit.test.ts`; `manager/action-types.test.ts`, `manager/ActionTypes.test.tsx`, `analyst-parts.test.tsx`, `analyst-api.test.ts`.

## A15. Function types

**Purpose.** Declaring from the Studio what the analyst can read. Its reading tools were all written in the code: an institution that wanted it to read something else (the ventilators available by site, the share of beds closed) waited for a developer. A **function type** is a reading tool the project declares itself. It is not code: it is one of five blocks the program already knows how to run, set by a person. This section says how a declaration becomes a tool of the analyst, and what each block reads.

```mermaid
flowchart TD
    A["Functions view of the Studio: a label, a description,<br/>inputs, one block among five, its setting, on or off"] --> B{"Can the draft be read?<br/>shape of the block, each input named once,<br/>every input used exists and is of the right kind,<br/>the formula evaluates over the names it has"}
    B -->|"no"| B1["Refused, with what to correct"]
    B -->|"yes"| C["Row of app.function_type, under its key:<br/>the tool's name, made from the label,<br/>never that of a tool of the code"]
    C --> D["List of the project: each type, with what it lacks<br/>to run on this project"]
    C --> T["Try: the type is run once, with the inputs<br/>a person gives. No model is called"]
    C --> E{"Start of an Ask or Options exchange:<br/>is the type on, and its name<br/>still free in the code?"}
    E -->|"no"| E1["It is not offered to the model"]
    E -->|"yes"| F["Tool of the analyst: input schema and validation<br/>taken from the declared inputs, label for the trace"]
    F --> G["The model calls it, like a tool of the code (A1)"]
    T --> H
    G --> H{"Do the inputs pass?<br/>kind, bounds of a number,<br/>list of a choice, shape of a date"}
    H -->|"no"| R["Reasoned refusal, with the bound or the list"]
    H -->|"yes"| I["The block reads through the project's readers:<br/>objects of a type, kept readings, rows of a dataset.<br/>One more than the ceiling, to know whether it was reached"]
    I --> J{"Can it answer?<br/>unit found, measure kept, columns present,<br/>no value missing in the formula"}
    J -->|"no"| R
    J -->|"yes"| K{"Does the result fit<br/>in 24,000 characters?"}
    K -->|"no"| R
    K -->|"yes"| L["Result: the fields under their declared names,<br/>how many objects were read and how many are listed,<br/>the ceiling if it was reached, and where it comes from"]
    L --> M["In an exchange: a step, under the type's label.<br/>Its figures enter the verifier's ledger (A2)"]
    R --> M2["In an exchange: a refused step, which the model reads.<br/>It carries no citable figure"]
    L --> N["In a trial: the result is shown<br/>as the analyst would read it"]
    R --> N2["In a trial: the sentence of the refusal is shown"]
```

**The five blocks, and where an object stands.**

```mermaid
flowchart LR
    S["A call, with its inputs"] --> O["objects: the objects of a type, filtered,<br/>with the declared properties.<br/>50 rows at most"]
    S --> AG["aggregate: count, sum, mean, minimum or maximum,<br/>in one value or by group: a property,<br/>the unit of attachment, or the site.<br/>50 groups at most, the largest first"]
    S --> FO["formula: six named aggregates at most,<br/>and the number inputs,<br/>handed to the calculator (A3)"]
    S --> HI["history: the kept readings of a measure<br/>at a unit (D11), over a window in hours.<br/>The last 60"]
    S --> DS["dataset: columns of a dataset<br/>of the project, filtered. 50 rows at most"]
    AG --> U{"Grouped by unit<br/>or by site?"}
    U -->|"unit"| U1["The unit that receives the object through an attaching link,<br/>the first when there are several. A unit is its own unit"]
    U -->|"site"| U2["The physical place where the object's unit is placed,<br/>otherwise that of the nearest unit above.<br/>An object that is a site is its own site"]
    U2 --> U3{"Does the ontology call<br/>anything physical?"}
    U3 -->|"no"| U4["The site is the top of the unit's tree,<br/>as on the map"]
    U1 --> U5["Attached to nothing: group “attached to no unit”<br/>or “at no site”, counted and never hidden"]
    U2 --> U5
```

**Rules.**
- **Five blocks, and no other.** `objects`, `aggregate`, `formula`, `history`, `dataset`. The table refuses any other block name. Nothing a person types is run as code: a formula is evaluated by the calculator (A3), which knows arithmetic and nothing else.
- **Read only.** No block writes, none calls another service. A declared tool reads the twin as it is, never through a scenario.
- **The tool's name comes from the label.** “Ventilators available by site” gives `ventilators_available_by_site`: lower-case letters, digits and underscores, three characters at least. It cannot be that of a tool written in the code (`CODE_TOOL_NAMES`) nor that of another type of the project. It does not change when the type is corrected: the answers already kept in the journal cite it under that name. If the code later takes the same name, the code's tool is the one offered, and the declared type no longer is.
- **The inputs.** Six at most: a text, a number with its bounds, a date (`YYYY-MM-DD`), or one value among a list. Each says what it is for: that is what the model reads. An input can feed a filter (any kind), the group of an aggregate (one value among a list, whose values are the properties allowed), the unit of a history (a text or a list) and its window in hours (a number). The declaration is refused if a setting takes an input that does not exist or is not of the right kind.
- **An input out of bounds is refused with the bound.** “200 is above the most allowed, 72”, or the list of the values allowed. The refusal is a step the model reads.
- **A filter is an equality**, ignoring case and the spaces around. Six filters at most. A filter fed by an optional input the call leaves empty does not filter.
- **Aggregate.** It is the selector of the twin's measures (`aggregate` in `twin-metrics.ts`, D6): the objects of a type, filtered, counted, summed or averaged. By group, a count of zero is a real answer and stays listed; a group with no value (the mean of nothing) is not listed rather than set to zero. The 50 largest are returned, with the number of groups in all. A missing property value forms the group “(not said)”.
- **By unit, by site: the twin's rules.** An object stands at the unit that receives it through an attaching link, whichever way the institution drew the link (`attaches`, `aggregationEnds`); when there are several, the first one read. It is counted at that unit, not at the units above, and the result says so (`grouped_how`). Two units of one name stay two groups, each with the unit above it (`under`). The site is the physical place where the unit is placed, or that of the nearest unit above that has one; an object that is itself a site is its own site; when the ontology calls nothing physical, the site is the top of the tree, as on the network map (D10). What is attached to nothing forms a group of its own, counted.
- **Formula.** From one to six named aggregates, plus the tool's number inputs. It is evaluated once at declaration, on stand-in values, to say at once a name it does not have. At the call, a value that does not exist (no object carries the property) makes the calculation refused: nothing stands in for it. The result gives what it was computed from (`computed_from`) and the formula.
- **History.** Only the measures the organisation defined are kept (D11); another is refused, with the list of those that are. The unit is found by its name, as the other tools do. The window goes from 1 to 2,160 hours. The result gives the value that held at the start of the window, then the readings, the lowest, the highest, the latest, and the date the history starts. A reading with no value is a gap, not a zero. The last 60 readings are listed.
- **A caught-up reading is said.** When the window of a `history` block holds readings caught up from kept copies (D12), the result gives their number (`readings_caught_up`) with a sentence saying what they are. With no caught-up reading, those two fields are not there.
- **Dataset.** Found by its identifier, its short name or its name. A column it does not have makes the call refused, with the list of its columns.
- **A ceiling is said.** Each read of the ontology takes one object more than its ceiling (`ROLLUP_INSTANCE_CAP`): when it is reached, the result says it rests on the first objects and not on all (`limit`). The ceiling is never lowered by a literal. When more rows match than are listed, the result gives both numbers. A result of more than 24,000 characters is refused rather than cut, with what to narrow: a table cut without a word would pass for whole.
- **Every result says where it comes from** (`read_from`): the objects of a type of the twin, a formula over those objects, the readings the twin kept, or a named dataset.
- **A tool like the others.** It is offered in Ask and in Options beside the tools of the code. What it returns is a step, its figures enter the ledger, and a figure it did not return is taken out of the answer (A2). The loop (A1) makes no special case: the step only carries, in addition, the type's label, and the trace writes it “Ventilators available by site (declared in this project)”.
- **What is missing is said, without preventing the declaration.** An object type the ontology does not have, a property the type does not declare, a measure that is not kept, a dataset or a column that is absent: the screen writes it on the type, with what is missing (`missingForFunction`). It is not a refusal: a tool can be declared before its data arrives.
- **A row that can no longer be read is not offered.** It is named on screen (`unreadable`), not hidden.
- **Trying.** `POST …/function-types/:key/try` goes through the same validation and the same block as the analyst. No model is called, nothing is kept in the journal. A type that is off can be tried: that is how it is checked before it is switched on.
- **By project.** A function type belongs to a project, and reads through that project's readers: two projects of two organisations see nothing of each other.
- **Everything is kept in the audit log**: declaring, changing, removing.
- **What is missing.** A filter knows only equality: neither “greater than”, nor a period between two dates. An aggregate is grouped by one thing only. Two object types meet only in a formula. By unit, an object is not carried up to the units above. The `dataset` block reads the dataset's rows up to the read ceiling, without sorting them. A declared tool is offered neither in Event finder nor in Investigate, which only have the web search. The product does not know of a property that it describes a person: the twin is made of objects of the network and aggregated values, and it is the person who declares a tool who chooses what it returns.

**Code.** `backend/src/services/function-types.ts` (`readFunctionDraft`, `functionKeyFrom`, `runFunction`, `inputParser`, `toolOf`, `missingForFunction`, `listFunctionTypes`, `saveFunctionType`), `function-reads.ts` (`functionReads`, `standingFrom`, `functionOffer`, `declaredTools`, `CODE_TOOL_NAMES`), `analyst-settings.ts` (`toolCatalogue`), `analyst.ts` (`Step.label`), routes `backend/src/routes/function-types.ts` and `analyst.ts`, migration `071_function_type.sql`; `frontend/app/studio/manager/FunctionTypes.tsx`, `function-types.ts`, `ManagerView.tsx` (`FunctionsView`), `frontend/app/studio/analyst-api.ts` (`stepLabel`).
**Tests.** `function-types.unit.test.ts` (each block on a small twin, by unit and by site, a ceiling reached, a result too long, the declaration refused, the name made from the label, the declaration turned into a tool, an input out of bounds, a figure that holds and a figure taken out in an exchange, a refusal the model reads, what the project lacks), `function-reads.unit.test.ts` (where an object stands; a project without a function type unchanged; a type that is off or whose name is taken is not offered), `routes/function-types.unit.test.ts`; `manager/function-types.test.ts`, `manager/FunctionTypes.test.tsx`, `simulation/hex/ToolsTab.test.tsx`, `analyst-api.test.ts`.

---

# B. Twin and simulation engine

## B1. Export of the twin

**Purpose.** Put the twin into the shape the engine reads. The engine is in Python and the ontology in Postgres: what crosses over is a payload, not a connection. Nothing here recognises the name of a type or of a link: everything is declared (the role of the type, the behaviour of the link, the mechanics of the property).

```mermaid
flowchart TD
    A["Tree of units, instances, links, types"] --> B{"Read cap reached?"}
    B -->|"yes"| B1["Gap reported: twin truncated"]
    B --> C["Objects attached to a unit<br/>whose type declares a role"]
    C --> D["Per unit and per type: total capacity,<br/>free = total minus in use"]
    D --> E{"Role of the type"}
    E -->|"demand"| F["Patients already present"]
    E -->|"space, staff, equipment, systems"| G["Resource that enables an activity"]
    A --> H["Links that are neither hierarchy nor placement: routes"]
    A --> I{"Does a type declare a population size?"}
    I -->|"yes"| J["Declared territories,<br/>served by the units linked to them"]
    I -->|"no"| K["One territory per place, of size zero"]
    A --> L["Instances whose type binds a mechanic:<br/>care model, transitions, price list"]
    C --> C2{"Is an object with no role, attached to a unit,<br/>a price row?"}
    C2 -->|"yes"| C3["The row goes out with the sites it prices (priced_at).<br/>It is capacity nowhere"]
    C2 -->|"no"| C4["Type with no role: named among the gaps"]
    C3 --> M
    F --> M["Export: sites, objects, types, territories, routes"]
    G --> M
    H --> M
    J --> M
    K --> M
    L --> M
    M --> N["List of what is missing, named"]
    M --> O{"A unit with no capacity<br/>attached to it directly?"}
    O -->|"and nothing under it holds any"| N
    O -->|"but one of its sub-units does,<br/>at any depth"| P["Note on the shape of the tree,<br/>apart from the list of gaps"]
```

**Rules.** Only what is attached to a unit itself counts for it (`facilitiesFrom`): a hospital's wards are sites in their own right, and their beds are theirs. That is the difference with the unit page, which adds up everything under a unit (D6, D9). So a unit can come out with no capacity for two reasons that have nothing in common, and the export tells them apart (`capacityFindings`). If one of its sub-units holds capacity, that is the shape of the tree: an institution whose beds are all in its facilities. The export notes it apart (`structure`, code `CAPACITY_IN_SUBUNITS`), never among the gaps, and the unit's page shows that capacity. If nothing under it holds any, that is a gap (`FACILITY_WITHOUT_RESOURCES`), and the page shows none. “Under” means here what it means on the unit page: both readings walk the tree with the same function (`buildDescendantMap`). A bed already occupied is not free capacity. A territory with no population figure still appears, at zero, in the list of gaps. A route has no throughput in the ontology: it comes out at zero, and that is reported. The read cap is `ROLLUP_INSTANCE_CAP`; reaching it is said, because everything else would be a silent underestimate. A price row travels like the other objects whose type binds a mechanic: with its properties, and the list of the units it is attached to (`priced_at`), which says which sites it prices. It is counted as capacity nowhere, and its type is not listed among the types with no role. A price list is not a care model: a twin that declares only prices keeps, for the engine, the default model (`bindsAnyMechanic` ignores the price mechanics, as `binds_care_model` does on the engine's side). The engine reads no price.

**Code.** `backend/src/services/twin-export.ts` (`buildTwinExport`, `facilitiesFrom`, `capacityFindings`), `twin.ts` (`buildDescendantMap`), `property-schema.ts`. **Tests.** `twin-export.unit.test.ts`, `twin-figures.unit.test.ts`, `scenario-lens-links.unit.test.ts`.

## B2. One step of the event engine

**Purpose.** Move the network forward by one step: apply the event, decide the response, treat or not, propagate failures, write everything down. The order within a step is a modelling decision, written once only.

```mermaid
flowchart TD
    A["Time moves forward one step"] --> B["The event applies,<br/>starting from the baseline"]
    B --> C["The response is decided:<br/>rules evaluated on the state of the moment"]
    C --> D["The actions apply, with their cost"]
    D --> E["Arrivals per territory and per severity"]
    E --> F{"Does a site of the territory offer<br/>everything the severity consumes?"}
    F -->|"yes"| G["Shared between those sites, in proportion<br/>to their usual capacity"]
    F -->|"no"| H["Queue in the territory:<br/>unserved, and visible"]
    G --> I{"Enough free resources?"}
    I -->|"yes"| J["Treated: resources held<br/>for the length of the stay"]
    I -->|"no"| K["Waiting: the queue builds up"]
    J --> L["Cascading failures, until stable"]
    K --> L
    H --> L
    L --> R["Restocking of the stocks that declare one"]
    R --> M["Everything is written: arrivals, served,<br/>unserved, rules triggered and why"]
    M --> A
```

**Rules.**
- The response is decided before care: a policy reacts in the step where the event arrives.
- A capacity is rebuilt from a baseline at each step; a queue accumulates. The way of composing belongs to the quantity, not to the author of the event (see `simulation-service/app/events/README.md`).
- A full site remains the right place to wait; a site that does not offer the activity never becomes one.
- The weight of a site is its usual capacity for the scarcest resource the severity consumes, not what it has free that day. Weighting by what is free would give the network a perfect and free balancing, which is exactly what a transfer policy is supposed to buy.
- The usual occupancy of a scenario is held at each site for the whole run.
- A change of capacity is a change of what is free, by the same amount, and nothing else. Beds opened arrive empty. Beds closed leave first from what is free; the rest are beds still occupied, carried as an overrun until enough patients have left: a closure admits nobody and sends nobody away. When it ends, the beds come back the same way.
- Same system, same event, same policy, same seed: same trajectory.

**Code.** `simulation-service/app/events/dynamics.py` (`Engine.run`, `_apply_perturbations`, `_deliver_care`), `domain.py`, `objects.py`, `ontology.py`, `mechanics.py`. **Tests.** `simulation-service/tests/`, including `test_events_occupancy.py` for the usual occupancy and the changes of capacity.

## B3. Spread

**Purpose.** Make a condition circulate in the population without the engine knowing the word “infectious”. The twin declares states and transitions; the engine knows only three forms of transition.

```mermaid
flowchart TD
    A["Per territory: how many people in each state"] --> B["For each declared transition"]
    B --> C{"Form"}
    C -->|"spontaneous"| D["A rate of leaving the state, with no other cause"]
    C -->|"coupled"| E["A rate proportional to the share of another state,<br/>along a contact layer"]
    C -->|"forced"| F["A rate that an event changes over time"]
    E --> G["Mixing between territories, per layer,<br/>if the twin declares any"]
    D --> H["People moved from one state to another"]
    G --> H
    F --> H
    H --> I{"Does the transition produce a demand?"}
    I -->|"yes"| J["Arrivals of a severity,<br/>handed to the event engine"]
    I -->|"no"| K["States of the next step"]
    J --> K
    K --> A
```

**Rules.** A measure or a variant multiplies a contact layer, between two steps, for some territories or for all. Two transitions that describe the same passage with two rates are refused, not arbitrated. With no mixing declared, an outbreak does not leave its territory. Accepted approximation: a visitor meets the residents of the place visited, at their prevalence.

**Code.** `simulation-service/app/events/spread.py`, `backend/src/services/spread-payload.ts`. **Tests.** `simulation-service/tests/`, `spread-payload.unit.test.ts`.

## B4. Policies, score and comparison

**Purpose.** Compare responses on the same event, with a score that can be argued about.

```mermaid
flowchart TD
    A0["Where the response comes from: the organisation's library,<br/>a response the engine writes from the network,<br/>or the stamp of a scenario (A4)"] --> A
    A["Policy: rules ordered by priority"] --> B["At each step: condition evaluated<br/>on the state of the moment"]
    B --> C{"Condition true?"}
    C -->|"yes"| D["Action: transfer, reinforcement, reassignment<br/>or modified demand, with delay, cost and effectiveness"]
    C -->|"no"| E["Nothing"]
    D --> F["Rule noted with its reason:<br/>occupancy of such a site at 0.94, above 0.90"]
    F --> G["Trajectory"]
    E --> G
    G --> H["Counts: each objective keeps its series per step<br/>and its total"]
    H --> I["Several seeds per policy, mean of each count"]
    I --> J{"A gap of more than half a person<br/>on deaths?"}
    J -->|"yes"| K["Fewer deaths first"]
    J -->|"no"| L{"On care not delivered?"}
    L -->|"yes"| M["Less care not delivered first"]
    L -->|"no"| N["The least costly first.<br/>Equal everywhere: the order given, the reference first"]
```

**Rules.**
- A condition is a typed tree, not an evaluated string: it can be shown and varied by program.
- The ranking is done on counts, in this order: deaths, care not delivered, cost. A count only separates responses that are equal on the earlier ones, and a gap of less than half a person is a tie.
- It is an order of priorities, not a price: a weighted sum would require an exchange rate between a life, care not delivered and a dollar, and there is no honest one. The order remains a judgement, and the screen says so.
- The screen names the count that decided the first place. When nothing separates the first two responses, neither is marked as best.
- Comparing on a single seed would amount to optimising the seed.
- **A response is run from two places.** The Events page and the replay of the units page compare several responses on one event and rank them, as above. The Scenarios page follows one, placed as a stamp of the recipe, in the pass “with the choices” of its run (A4); that is how the analyst tests a transfer of patients (A8). What each path can do that the other cannot: [The analyst](/docs/product/analyst), “Two ways of asking ‘what if’”.
- **The costs of responses are demo prices, and the screen says so.** The cost of a response is the amount each of its rules declares, each time it fires. Those amounts are written in the responses the engine provides, or typed with a response written by hand; none comes from the twin's price list (A12) and none has a source. Under the ranking of the Events page and under the options of the replay, a sentence says so as soon as a cost is counted (`costSentence`). Bringing those amounts into the price list remains to be done ([issue 39](https://github.com/V1ktor7/obscyro/issues/39)).
- **A dominated option is marked the same way on both sides**: costing as much or more to obtain as much or less, strictly worse on one of the two (`dominatedBy`). The replay of the units page counts every cost the engine returns; the Options tab weighs only the options whose cost is whole (A8).

**Code.** `simulation-service/app/events/policy.py`, `scoring.py`, `harness.py` (`rank`, `decided_by`), `api.py` (`RANK_BY`), `frontend/app/studio/events/ranking.ts` (`rankingSentence`, `costSentence`), `frontend/app/studio/command/options.ts` (`rankOptions`, `dominatedBy`), `backend/src/services/sim-policies.ts`. **Tests.** `tests/test_events_ranking.py`, `ranking.test.ts`, `command/options.test.ts`.

## B5. Overlay scenario

**Purpose.** A scenario is not a copy of the twin: it is an ordered list of modifications read on top of it. Reading the twin “through” a scenario gives the world as it would be.

```mermaid
flowchart TD
    A["Scenario asked for"] --> B["Chain of parent scenarios, ancestors first"]
    B --> C["Modifications of each scenario,<br/>in the order of their effective day then of entry"]
    C --> D["Keep only those in force<br/>at the moment read in the scenario"]
    D --> E{"Target"}
    E -->|"instance or link"| F["Applied to the reading of the twin:<br/>create, modify, delete, link, unlink"]
    E -->|"parameter"| G["Ignored by the readings of the twin:<br/>these are the page's stamps and settings"]
    F --> H["Twin seen through the scenario"]
```

**Rules.** A reading that receives a lens it cannot honour fails loudly: silently comparing reality with itself would be the worst result. What a scenario invents receives a stable, derived identifier, so that it does not appear and disappear from one reading to the next. Reading “at a past date” is declared but not done: properties are overwritten in place.

**Code.** `backend/src/services/scenario-overrides.ts`, `scenario-apply.ts`, `ontology-lens.ts`. **Tests.** `scenario-overrides.unit.test.ts`, `scenario-apply.unit.test.ts`, `ontology-lens.unit.test.ts`.

## B6. Event drawn from an observed series

**Purpose.** The shortest path between a published file and a run: what was admitted each day becomes the arrivals of the event, with no script written by hand.

```mermaid
flowchart LR
    A["Dated rows of a dataset"] --> B["One count per day, from day zero"]
    B --> C["One effect per day on the volume of demand"]
    C --> D["Event the engine already knows how to run"]
```

**Rules.** The target is a volume, not an incidence: an incidence is per thousand people and would require a population size the file does not carry.

**Code.** `backend/src/services/sim-event-from-rows.ts`. **Tests.** `sim-event-from-rows.unit.test.ts`.

---

# C. Forecasting and lab

## C1. Daily forecast loop

**Purpose.** Know what a forecast made every morning with what was known that morning is worth. Each forecast is frozen the day it is made; nobody can retouch it afterwards.

```mermaid
flowchart TD
    A["Every morning"] --> B["For each horizon: 1, 3, 7, 14 and 21 days,<br/>and for each model, A and B"]
    B --> C["Forecast with what was known that morning:<br/>the target up to the day before, the engine one day earlier"]
    C --> D["Freeze: inserted once, never modified"]
    A --> E{"Monday, or first morning?"}
    E -->|"yes"| F["Retrain on everything that is known"]
    F --> G["Error to expect: measured on the last 56 days,<br/>without having seen them"]
    D --> H["When the target day arrives: gap between forecast and observed"]
    G --> I{"Error of the last 28 days<br/>at least 1.5 times the expected error?"}
    H --> I
    I -->|"yes"| J["Drift alert, lifted under 1.25 times"]
    H --> K{"On Monday: over 56 days, does the other model do<br/>at least 10 percent better at 7, 14 and 21 days?"}
    K -->|"yes"| L["It takes the place of the model in force"]
```

**Rules.**
- Model A: ridge regression on 14 days of the target and the calendar. Model B: gradient boosting, with the engine if there is one.
- At least 90 days of history are needed before the first morning, and 60 rows for a retraining.
- Drift requires at least 14 scored forecasts in the window; replacement, at least 28 per horizon.
- The model in force, the alerts and the replacements are not stored: they are rules set in advance, applied to frozen forecasts. They give the same answer at every reading.
- The replay is done in blocks of 28 mornings, in any order.

**Code.** `backend/src/services/forecast-loops.ts`, `simulation-service/app/lab/loop.py`, `frontend/app/studio/lab/loop-rules.ts`, migration `058_forecast_loops.sql`. **Tests.** `forecast-loops.unit.test.ts`, `tests/test_lab_loop.py`, `loop-rules.test.ts`.

## C2. Forecasting a series and learning on a table

**Purpose.** A forecast is a regression whose variables are the past. What changes is not the model, it is the way of scoring it.

```mermaid
flowchart TD
    A["Dated series"] --> B["Variables: lags of the target, calendar,<br/>lags of another series if needed"]
    B --> C["One model per horizon, trained for that horizon"]
    C --> D["Walk-forward evaluation:<br/>several successive origins"]
    D --> E["Reference: same as last time"]
    E --> F["Score: error divided by that of the reference.<br/>1.0 means doing nothing"]
    T["Any table"] --> U["Target, variables, estimator"]
    U --> V{"Time column?"}
    V -->|"yes"| W["Chronological split possible, and noted"]
    V -->|"no"| X["Random split"]
    W --> Y["Score compared with a reference that predicts the mean"]
    X --> Y
    Y --> Z["Rows set aside: counted and reported"]
```

**Rules.** A model that does not beat the reference is not deployed. A random split on a table ordered in time trains on next week: when a time column exists, the honest split is offered. The training context is kept with the score.

**Code.** `simulation-service/app/lab/timeseries.py`, `tabular.py`, `sandbox.py` (the user's code, isolated), `backend/src/services/lab-models.ts`. **Tests.** `simulation-service/tests/`.

## C3. Leading signals

**Purpose.** Say which signal precedes another and by how much, with the reasons to doubt it computed in the same pass.

```mermaid
flowchart TD
    A["A signal and a target"] --> B["Effective size: a smooth curve of 90 days<br/>may carry only 10 independent points"]
    B --> C["Correlation at each lag"]
    C --> D["Threshold raised: many tests were made"]
    D --> E["Lag retained, checked on a period<br/>held out of the search"]
    E --> F["Long series cut into episodes,<br/>one wave each"]
    F --> G["Same question asked of each episode"]
    G --> H["What is reported: the agreement between episodes,<br/>not the strength of one"]
```

**Rules.** Choosing the lag that maximises the correlation and then reporting that correlation is circular: hence the period held apart. A long series is not many observations: it is replication from one wave to the next that settles it.

**Code.** `backend/src/services/lag-scan.ts` (`effectiveSize`, `crossCorrelate`, `findLead`), `episodes.ts` (`findEpisodes`, `replicationAcross`). **Tests.** `lag-scan.unit.test.ts`, `episodes.unit.test.ts`.

## C4. Causal lab

**Purpose.** Explore, on the live data of an environment, which signals precede others, and what a series would become if another were perturbed.

```mermaid
flowchart TD
    A["Hourly signals: creations per type,<br/>mean of a property, activity of a channel"] --> B["For each pair: correlation at the best lag"]
    B --> C["Edges: who precedes whom"]
    A --> D["One-step model, ridge regression on the past"]
    D --> E["Forecast: the model iterated forward"]
    E --> F["Injected event: a future variable is perturbed"]
    F --> G["Simulated trajectory"]
```

**Rules.** The lag goes from 1 to the maximum asked for, so that the direction follows time. An edge is a precedence, not a proven cause: see C3 for the reasons to doubt it.

**Code.** `backend/src/services/causal-lab.ts`. **Tests.** no dedicated unit test to date.

## C5. Hybrid simulation

**Purpose.** Run a graph of models on a scenario branch: a mechanistic model as the base, learned models on top when they exist.

```mermaid
flowchart TD
    A["Payload: branch of the twin, parameters"] --> B["Contact graph:<br/>membership through the place links, neighbourhood through the contact links"]
    B --> C["Graph of models, executed in the order of its dependencies"]
    C --> D["Mechanistic node: SEIR with a fixed seed"]
    D --> E["Learned nodes: residual, graph network,<br/>surrogate, forecast"]
    E --> F["Quantile bands, gap from the base,<br/>importance of the variables"]
    C --> G{"Simulation service absent,<br/>or heavy model not installed?"}
    G -->|"yes"| H["Fall back to the mechanistic SEIR, in the API"]
```

**Rules.** The Python SEIR reproduces the API's at equal seed. The service is stateless: it never touches the database. Without the service, the simulation route falls back on the API's SEIR.

**Code.** `simulation-service/app/runner.py`, `graph.py`, `contacts.py`, `mechanistic.py`, `uncertainty.py`, `training.py`, `models/`; `backend/src/services/simulation.ts`, `ml-simulation.ts`. **Tests.** `simulation-service/tests/`, `simulation.unit.test.ts`, `ml-simulation.unit.test.ts`.

---

# D. Data

## C4. Imported forecasting models

**Purpose.** Plugging in a forecasting model that is already trained, instead of training one. Open models exist and do better than a model trained on a few weeks of data. The platform shows them the history it keeps (D12), takes their forecast, holds it against two simple rules, and only then relies on it. First target: the stretcher occupancy of each emergency room, over the next 72 hours, with a range.

```mermaid
flowchart TD
    A["Import: a label, a source, a measure of the twin,<br/>the step, the history shown, the horizon, the companion series"] --> B{"Are the measure and the companion series<br/>kept by the project?<br/>Is the key named by a MODEL_KEY_ variable?"}
    B -->|"no"| B1["Refused, with what to correct"]
    B -->|"yes"| C["app.forecast_model, state “imported”.<br/>Nothing has left yet"]
    C --> D["Verify: a sample of 3 units,<br/>as they stand now"]
    R["Replay on the past: one origin a day,<br/>14 days, the most recent a day old"] --> E
    D --> E["For one origin: the history of the measure<br/>on a regular grid (D12), gaps included,<br/>as known at that instant"]
    E --> F{"Does the unit have enough history<br/>(14 days by default) and at least one value?"}
    F -->|"no"| F1["Left out, with the reason"]
    F -->|"yes"| G["A series under an opaque label (s1, s2…),<br/>its companion series,<br/>the calendar given over the horizon too"]
    G --> H{"Where does the model come from?"}
    H -->|"the reference"| I["The same hour, a week before;<br/>the day before with less than a week.<br/>No call"]
    H -->|"the model service"| J["To the service: the model named<br/>and the request"]
    H -->|"an address"| K["To the address: the request alone.<br/>The key is read from a MODEL_KEY_ variable"]
    J --> L{"Does the answer keep the contract?<br/>Every series, one value per step,<br/>low, likely, high in order,<br/>a value the measure can take"}
    K --> L
    L -->|"no"| L1["Refused, with the reason.<br/>Nothing is repaired"]
    L -->|"yes"| M{"Verification or replay?"}
    I --> M
    M -->|"verification"| N["State “verified”.<br/>The screen is told what left, and to where"]
    M -->|"replay"| O["What was measured since,<br/>read with everything known today"]
    O --> P["The model's error and the errors of two rules<br/>(the week before, the last value)<br/>over the same steps: those where all have a value"]
    P --> Q["In all, by step of the horizon, by origin.<br/>State “tried”.<br/>Nothing is kept as a forecast"]
    L1 --> S["During a replay: it stops at that origin,<br/>and the model is not counted as tried"]
```

**The contract, version 1.** One format for every model. What a model is sent, then what it sends back:

```json
{
  "contract": 1,
  "step": "hour",
  "historyStart": "2026-11-13T12:00:00.000Z",
  "origin": "2026-11-27T12:00:00.000Z",
  "history": 336,
  "horizon": 72,
  "series": [
    {
      "id": "s1",
      "target": [131.2, 128.7, null, 140.0],
      "past": { "air": [14, 13, 13, 15] },
      "known": { "hour": [7, 8, 9, 10] }
    }
  ]
}
```

```json
{
  "contract": 1,
  "model": { "name": "chronos-2", "version": "2025-10" },
  "series": [{ "id": "s1", "low": [118.0], "likely": [131.5], "high": [146.2] }]
}
```

`target` has one value per step of the history, oldest first; a gap is `null`. `past` carries the companion series known up to the origin, of the same length. `known` carries those known ahead: the history, then the horizon. `low`, `likely` and `high` each have one value per step of the horizon. The arrays of the example are shortened.

**Rules.**
- **Nothing names a place.** A series travels under an opaque label (`s1`, `s2`). Only the platform knows which unit it is: no name, no identifier of the twin, nothing about a person leaves. A model hosted elsewhere receives counts and rates, and nothing to tie them to.
- **Refused, never repaired.** An answer is refused with its reason, the first one found: another version of the contract; a series missing, extra or twice; a number of values that is not the horizon; a value that is not a number; a range out of order; a value the measure cannot take. A range out of order is not sorted, a negative value is not raised to zero. A field the contract does not name is ignored.
- **What a measure can be.** A count, a duration and a rate never go below zero. An occupancy can pass 100%: stretchers in corridors are what the measure is there to show. A number with no unit has no bound.
- **The reference.** “The same hour, a week before.” For each step of the horizon, the value kept at the same hour one week earlier; if that hour was a gap, two weeks earlier, up to four. When no week gives a value (less than a week of history, a silent source), the same hour the day before, up to seven days back. When nothing gives a value, the reference says nothing for that step: it does not invent. By the day: the same weekday of the week before, then the day before. Its range is not a model's: the lowest and the highest value kept at that hour over those four weeks.
- **The reference asks for no model.** It is computed on the server and always runs.
- **Two rules to beat.** A model is held against the reference and against “the last value holds”: the last value kept in the history, flat over the whole horizon. It is what a person does with the screen as it is, with no rule at all. The second one was added after a replay over fourteen days of stretcher occupancy: the week before was off by 29 points on average, the last value by 8 points an hour ahead and by 25 a day ahead. A model that only beat the first could do worse than computing nothing.
- **Three sources.** `reference`: the built-in rule. `service`: an open model served by the model service, a service of its own that never touches the database. `endpoint`: an address that speaks the contract. Without a model service (`MODEL_SERVICE_URL` empty), everything works with the reference, and the answer says so.
- **No key is typed, kept or shown.** An address that asks for a key names an environment variable an administrator set on the API. That name has to start with `MODEL_KEY_`: no other variable of the server can be sent. Without that variable, the call stops before anything leaves. The address is `https`, cannot point at the platform's internal network, and a redirect is refused. Of the address, the screen only receives the host.
- **What the model is shown.** The history of the measure, read on a regular grid up to the origin (D12), with its gaps and the model's `holdHours` bound. A unit whose history is shorter than the threshold (14 days by default, adjustable) is left out with its reason, rather than sent with a history padded out; so is a unit with no value at all over the stretch. 300 series at most per request, 2,160 steps of history, 336 steps of horizon.
- **Companion series.** Of the past: another measure of the twin, read at the same unit, or one entity of a declared series (D12), the same for every unit. Known ahead: the calendar, the hour of the day or the day of the week, read on a declared time zone and given over the horizon too. Nothing is recognised by its name: a companion series has to be kept by the project.
- **Verifying on a sample.** Three units, as they stand now. It is the first time anything leaves for the model. The answer says what left and to where (the number of series, the history, the horizon, the companion series, the size), the units left out, and the first steps of a forecast. A model that keeps the contract becomes “verified”; otherwise it stays where it was, and the reason is kept on it.
- **The replay on the past.** One origin a day, at the hour of the last whole step, over 14 days by default (60 at most); the most recent is a day old, so that part of its horizon has been measured. At each origin, the model receives only what had been written down by that instant: the “as known at” read of D12. Nothing is trained.
- **Three errors, over the same steps.** The error is the mean absolute gap between the likely value and what was measured, in the measure's unit. The model's, the week before's (`reference`) and the last value's (`held`) are counted over the same steps: a step counts only if all three and the measure have a value, so that none is flattered by a gap. They are given in all, by step of the horizon and by origin, with the number of steps compared and the share of measures that fell inside the model's range.
- **Beating the better of the two rules, strictly.** A model has earned its place only if its error is under the lower of the two. Tying a rule a person applies by hand is not enough. The sentence of the verdict names the rule that is the bar. With nothing compared, nothing is concluded. The reference itself is not compared with itself.
- **A broken contract stops the replay.** If the model does not answer or breaks the contract at an origin, the replay stops there and the model is not counted as tried: a score over the forecasts it got right alone would flatter it. A replay that runs past two minutes stops and says how far it got.
- **A replay is not a forecast.** Nothing a replay computes is kept as a forecast or shown on the network: its result is written on the model, and nothing else.
- **The states.** Imported, verified, tried, on trial. “Shown” is not a stored state: it is a rule fixed in advance, applied to frozen forecasts.
- **Importing, verifying, replaying and removing are kept in the audit log**, with what left and to where.
- **What is missing.** The trial (a forecast frozen at a fixed hour, then scored), the display rule, the import screen, the forecast on the Network page and the model service itself are not there yet: a model is imported, verified and replayed through the API. One origin a day only. A single measure of error. No companion series known ahead other than the calendar: no holidays, no forecast weather. What the twin does not hold (ward beds, staff, calls to 811) cannot be shown to a model.

**Code.** `backend/src/services/forecast-contract.ts` (`checkForecast`, `checkRequest`, `boundsOf`, `referenceOf`, `referenceForecast`, `tallyInto`, `scoreOf`, `beatsReference`), `forecast-models.ts` (`checkModelDraft`, `importModel`, `buildRequest`, `askModel`, `sentTo`, `verifyModel`, `originsOf`, `backtestModel`, `modelOffer`), routes `backend/src/routes/forecast-models.ts`, migration `074_forecast_model.sql`.
**Tests.** `forecast-contract.unit.test.ts` (the contract accepted and refused with its reason, the reference, the scoring), `forecast-models.unit.test.ts` (what is declared, the key, where the request goes, the opaque labels, a unit with too short a history, the replay that sees nothing after the origin, the two errors, a broken contract), `routes/forecast-models.unit.test.ts`.

## D1. Clinical extraction

**Purpose.** Draw from a clinical text coded concepts and their context, without a generative model.

```mermaid
flowchart TD
    A["Clinical text"] --> B["Spotting the mentions"]
    B --> C["Embedding of each mention"]
    C --> D["Search for the nearest SNOMED descriptions,<br/>in Postgres"]
    D --> E{"Closeness and margin over the next one"}
    E -->|"clear"| F["Resolved"]
    E -->|"doubtful"| G["Flagged"]
    E -->|"insufficient"| H["Unresolved"]
    A --> I["Context by rules, in French and in English:<br/>affirmed or negated, subject, temporality"]
    F --> J["Decision: accept, flag, escalate"]
    G --> J
    I --> J
    J --> K{"Persistence asked for?"}
    K -->|"yes"| L["Clinical finding written to the ontology,<br/>with its provenance"]
```

**Rules.** The SNOMED matching uses only Obscyro's Postgres database. A patient is attached only by an explicit identifier, never guessed from a name or the text.

**Code.** `nlp-service/app/main.py`, `ner.py`, `context.py`, `embeddings.py`, `pg_index.py`; `backend/src/services/persist-extract.ts`. **Tests.** `nlp-service/tests/`, `persist-extract.integration.test.ts`.

## D2. Data pipelines

**Purpose.** Turn datasets into objects of the ontology or into other datasets, through a graph of nodes.

```mermaid
flowchart LR
    A["Input: dataset_input"] --> B["Table: filter, select, derive, cast,<br/>expand, join, latest"]
    B --> C["Clinical text: text_field,<br/>extract_snomed, validate_confidence"]
    B --> D["Outputs: object_output, dataset_output"]
    C --> D
```

**Rules.** The list of node kinds exists in one place only (`NODE_KINDS`): the route's schema is built from it, so that an accepted node is always an executable node. The objects written go through identity (D3). The ingestion channels (`channel-runner.ts`) do the same work for a payload received by webhook or by REST call.

**Code.** `backend/src/services/pipeline.ts`, `channel-runner.ts`, `rest-connector.ts`, `connectivity.ts`. **Tests.** `pipeline*.unit.test.ts`, `channel-*.unit.test.ts`, `rest-connector*.unit.test.ts`.

## D3. Identity of objects

**Purpose.** Say which properties make an object “the same real thing”, so that two pipelines do not create the same bed twice.

```mermaid
flowchart TD
    A["Object to write"] --> B["Identity keys declared on its type"]
    B --> C{"Does an object already carry these values?"}
    C -->|"yes"| D["Update of that object"]
    C -->|"no"| E["Creation"]
    D --> F["Constraint held by the database itself"]
    E --> F
```

**Rules.** Identity is declared on the type, not supplied by whichever pipeline passes. The constraint lives in the database (migration 043).

**Code.** `backend/src/services/identity.ts`, `ontology.ts` (`upsertInstanceByIdentity`). **Tests.** `identity.unit.test.ts`.

## D4. Data quality

**Purpose.** Check every object of the ontology in layers, from the simplest to the most statistical.

```mermaid
flowchart TD
    A["An object"] --> L1["L1 Shape: type of each property,<br/>existing SNOMED code"]
    L1 --> L2["L2 Value: declared bounds,<br/>no negative, valid date"]
    L2 --> L3["L3 Consistency: order of the dates,<br/>object with no link at all"]
    L3 --> L4["L4 Population: outlying value<br/>among the objects of the same type"]
    L4 --> L5["L5 Source: source silent for 7 days,<br/>identical values repeated"]
    L5 --> L6["L6 Anomaly: interquartile range<br/>or robust deviation from the median"]
    L6 --> F["Findings, each with its layer and its code"]
```

**Rules.** In L6, either of the two tests is enough to flag. At least 12 values of the same type are needed; the thresholds can be set (`DQ_IQR_K`, `DQ_ZSCORE_THRESHOLD`, `DQ_ANOMALY_MIN_SAMPLE`). Layers L4 to L6 read the whole population, to stay stable.

**Code.** `backend/src/services/data-quality.ts`. **Tests.** `data-quality.unit.test.ts`, `data-quality.integration.test.ts`.

## D5. Twin alerts and signals

**Purpose.** That a threshold crossed reaches a person within seconds, wherever they are in the Studio, with what it takes to judge: which unit, since when, how old the value is, and one click to the unit and to the signal. A rule fires at the time the threshold is crossed, not at the time someone opens the page.

```mermaid
flowchart TD
    A["Evaluator: one evaluation finished,<br/>wait 5 s, or twice its duration if it was slow"] --> B["Projects that have at least one rule"]
    B --> C["Metrics of each unit, with no lens:<br/>reality, never a scenario.<br/>Each measure a rule watches is dated<br/>on what it reads (D7)"]
    C --> D["Each rule evaluated"]
    D --> E{"The condition"}
    E -->|"holds, and no alert already holds<br/>this unit and this rule"| F["Alert opened, with two times:<br/>how old its value is, from what its measure reads<br/>(and what that age rests on),<br/>when the data was written here"]
    E -->|"holds, and an alert already holds it:<br/>open, or acknowledged at a severity at least as high"| F2["Value, age of the value and what it rests on refreshed;<br/>the write time that opened the alert does not move.<br/>Nothing new is opened"]
    E -->|"held, and demonstrably no longer holds"| G["Alert resolved, whether open or acknowledged"]
    F -->|"a person acknowledges it"| F3["Alert acknowledged: it leaves the list of open ones<br/>and stays on file for as long as the condition holds"]
    F3 -->|"next evaluation"| D
    F --> H["Bridge launched at once, one pass at a time"]
    G --> H
    H -->|"open alert with no signal"| I["Signal created, titled once"]
    H -->|"resolved alert"| I3["Note on its signal: the condition no longer holds.<br/>The signal stays open"]
    I --> I2["Responses prepared for this kind:<br/>retest requested, in the background (A11)"]
    I --> J["Workflow: steps, approval if needed.<br/>An engaged prepared response moves it forward (A9)"]
    F --> K["Alert feed: GET /alerts/feed<br/>open alerts, unit named, ages, signal, last evaluation"]
    I --> K
    K --> L["The Studio's shell: read every 3 s,<br/>a single read for all the pages"]
    L --> M["Badge: how many are open, and whether the list is up to date"]
    L --> N{"Alert absent from the previous read,<br/>and opened since?"}
    N -->|"yes"| O["Banner on every page, two minutes:<br/>Situation, Open unit, Signal"]
    N -->|"no, or first read"| M
    L --> P["Pages of the twin: the same alerts on the map, the list of units, the unit sheet"]
    L --> Q["Response: the board refreshes when the signals change"]
    Q --> V{"Signal raised by a resolved alert,<br/>and that nobody has touched?"}
    V -->|"no"| W["Active view, the one on arrival:<br/>the card says if its alert is acknowledged or has cleared"]
    V -->|"yes"| X["Alert cleared view: set apart,<br/>and counted in the header"]
    X -->|"a person, a domain, a reason"| Y["Batch close: all or none,<br/>one line in each signal's log, with who and why"]
    O -->|"click on Signal"| R["Response asks for that signal by its name:<br/>it is listed even if older than the board's 500,<br/>and whatever its view"]
    R --> S{"In this project?"}
    S -->|"yes"| T["Its sheet opens, in its domain"]
    S -->|"no"| U["The screen says the link leads nowhere"]
```

**Rules.**
- **Cadence.** The evaluator paces itself: an evaluation never starts before the previous one has ended, and the wait is five seconds, or twice the duration of the last evaluation if it was slow, without exceeding thirty seconds. So it cannot take more than a third of the database's attention, whatever the size of the twin. A slow evaluation is written to the service log.
- **Only reality raises alerts.** A reading made through a scenario, or at another date, evaluates nothing: an emergency department overflowing in a “what if” must not land on every screen as if it were happening.
- **Resolution never happens in a reading**: under a lens that hides units, their absence would look like an emptied department. One project's failure does not cost the others their evaluation.
- **Two times besides the opening.** `observed_at`: when the value was true, according to the timestamp the source publishes (D7); empty when the source does not say. `written_at`: when the data that crossed the threshold was written here; set at opening. `created_at - written_at` is the time we took to see the crossing, measured on each alert. An alert opened three seconds after its write can be about a value fifty minutes old: the screen says both.
- **An alert's age is the age of its own value.** It is counted on the sources the rule's measure reads, not on everything under the unit (D7). A stretcher occupancy alert, at a unit that also carries an air quality station, has the age of the stretcher census: before, it took the station's, two hours for a value fourteen minutes old. Two alerts of the same unit can therefore have two ages. And a value never borrows the age of another source: if what the measure reads publishes no time, the alert says the age is unknown, even when another source of the unit has one. The evaluator and a page's read of the tree date things the same way: the roll-up is given the measures the rules watch.
- **An age says what it is worth.** `observed_basis` keeps what the age rests on, as the twin computes it for the rule's measure (D7), and follows the value at each evaluation. `observed`: the source's timestamp, the screen writes “value read 37 min ago”. `partial`: one of the sources the measure reads published no readable time, the age is a floor and the screen writes “value read at least 2 h ago”. The others (`undeclared`, `unreadable`, `zone-unknown`, `empty`): no age, the screen writes “age of the value unknown” and gives the reason, on hover in the banner and in full on the unit sheet. The reason speaks of the measure (“one of the sources this measure reads…”), not of the unit. The qualifier is in the text, not in a tooltip: a figure gets repeated without its tooltip.
- **The bridge follows the evaluator.** An evaluation that opens or closes an alert launches the bridge at once; the bridge's own clock (fifteen seconds) stays as a safety net. The bridge's passes follow one another, never two at a time: “one signal per alert” rests on a `NOT EXISTS` that two simultaneous passes would both get through.
- **A signal that opens has what was prepared for its kind tested again.** The bridge asks for it after creating the signal and does not wait for the answer: the retest runs behind, one run at a time per project, without a language model (A11). A signal created by hand asks for it too.
- **A single read for the whole Studio.** The shell reads the alert feed every three seconds and gives it to every page. Before, each page had its own clock: ten seconds on the unit sheet, thirty on the globe, one request per unit on the tree, a button on Response.
- **What counts as news.** An alert is announced when it is in a read, was not in the previous one, and opened since that previous read (within two minutes, for an alert written during the read). The first read announces nothing: those alerts were open before anyone looked, and a screen that shouts forty old alerts on arrival teaches people to stop reading it. An alert already open at the previous read, which enters the list only now because the list was full, is not news.
- **A screen that comes back announces what it missed.** Computer asleep, tab frozen by the browser, network cut: at its first read, the screen announces what opened while it was not reading, and says its delay (“on this screen 26 min after it opened”). The counter going from 44 to 45 without saying which one is the silence this banner has to prevent. The announcement lasts two minutes, or until it is closed; closing it does not touch the alert.
- **Silence is not calm.** With no successful read for fifteen seconds, the badge says the list is no longer up to date and for how long; the last list read stays displayed, marked as old. The list also says when the thresholds were last checked.
- **Ages are counted on the server's clock**, not on the machine's: a computer set five minutes off does not age an alert by five minutes.
- **One click.** From an alert: its situation card (`/studio/situation?alert=…&unit=…&signal=…`, D9), its unit (`/studio/live?unit=…`, the sheet opens by itself) and its signal (`/studio/response?signal=…`). From a signal: its situation card and its unit. The link carries the project, and an alert's link carries its unit too: the card knows what to read once the alert has cleared.
- **A link finds its signal, whatever its age.** The Response board lists only the 500 most recent signals. An emergency department above its threshold for weeks has an alert still open, and a signal far older than that. So the board asks the API for the signal the link names (`?signal=` on `GET /command-board`): it is added to the list, at the top, closed or not, set apart or not, looked for in this project and this scope only. If it is not there, the screen says so instead of showing a board where nothing opens.
- **An acknowledgement holds for as long as the condition holds.** Acknowledging says “seen”, not “over”. The alert leaves the list of open alerts: no badge, no ring on the map, no announcement. It stays on file as acknowledged, and each evaluation refreshes it instead of opening another: no new alert, no new signal, no new banner for that unit and that rule. Its signal says “acknowledged” and does not get the note “the condition no longer holds”. When the condition stops, the evaluator resolves the acknowledged alert like an open one; if the condition comes back afterwards, it is a new episode, so a new alert. Only an open alert can be acknowledged: acknowledging one that has already cleared changes nothing.
- **One notch of severity more is news.** An acknowledgement covers the severity that was acknowledged. The severity is the rule's: two thresholds on the same metric (a warning at 85%, a critical at 100%) are two rules, so two alerts, and acknowledging the first does not silence the second. If the rule itself moves to a severity higher than that of the acknowledged alert, a new alert opens. A lowered severity stays covered.
- **The board shows first what needs somebody.** Each signal says what became of its alert (`alert`): it holds (`holds`), it is acknowledged and still holds (`acknowledged`), it has cleared (`cleared`), or nothing for a signal no alert raised. Response has two views. “Active”, the one on arrival: everything that is not set apart. “Alert cleared”: the signals raised by a resolved alert and that nobody has touched. A signal somebody has taken up (moved forward, decided on, annotated) stays in the active view even after its alert has cleared, with “alert cleared” on its card: it is work in progress, not noise. “Touched” is read from the log: a line written by a person, or a line that is neither the detection nor a note. The bridge's note is a system note and does not count.
- **What is set apart is counted, never hidden.** The API returns three figures over all the open signals, whatever the view (`counts`: open, active, set apart), and the two tabs display them. `total` is the number of signals of the view asked for; when the list stops at 500, the header writes “Showing 500 of 2,810 signals whose alert has cleared” rather than “500”.
- **The counters by domain are counted in the database**, over all the open signals of the view and not over the 500 listed: past 500 signals, counted on the list, they were wrong.
- **Closing in a batch is a decision, not housekeeping.** Nothing closes by itself: a condition that cleared is not a condition that was fixed. From the “Alert cleared” view, a person closes in one go the signals set apart in the domain on screen, and has to write a reason. It is a single statement: all of them close or none does. Each signal gets its own `closed` line in its log, with who and why. A signal somebody takes up between the count on screen and the click is no longer set apart and stays open; the screen displays the number actually closed.
- **The share of false positives is read where the rule is set.** The threshold editor writes, for the rule picked, what became of the signals it raised: how many, how many open, how many closed, and among the closed how many a person closed as false positives, with the share that makes. The share is counted on the closed signals, never on all of them: an open signal has not been judged yet, and with no closed signal no share is given. Those closed in a batch after an alert cleared on its own are counted apart. The counts are of signals, not of alerts: an alert on a measure no signal type claims raises none.
- **Three ways to close, never mixed.** Reached the last step of its workflow: handled. “False positive”: it should not have been raised (`false positive: …`). Closed in a batch: real, cleared on its own, without anyone having to act (`alert cleared: …`). Mixing them would make all three rates unreadable.
- An alert is a unit and an aggregated value, never a person.

**Delay.** From the moment a piece of data is written here to the moment the alert is on screen: at most five seconds of waiting by the evaluator, the duration of an evaluation, then at most three seconds of reading. That is a little over nine seconds at worst.

**Code.** `backend/src/services/twin-alert-scheduler.ts` (`nextEvaluationDelay`, `evaluationPulse`, `evaluateProject`), `alert-bridge.ts`, `response-retest.ts` (`requestRetests`), `alert-feed.ts`, `signals.ts` (`listSignals`, `countSignals`, `countOpenSignals`, `countOpenByType`, `domainCounters`, `closeClearedSignals`, `ruleOutcomes`), `twin.ts` (`evaluateAlerts`, `valueAgeOf`, `ackAlert`, `readsReality`, `getTwinTreeSnapshot`), `twin-alert-scheduler.ts` (`alertsOnFile`, `resolveAlerts`), routes `GET /v1/ontology/:env/alerts/feed`, `GET /v1/ontology/:env/twin/units/:id` and `PATCH /v1/ontology/:env/twin/alerts/:id` in `backend/src/routes/twin.ts`, `GET /v1/ontology/:env/command-board` and `POST /v1/ontology/:env/signals/close-cleared` in `backend/src/routes/signals.ts`, migrations `063_twin_alert_times.sql` and `064_twin_alert_observed_basis.sql`; `frontend/app/studio/AlertFeed.tsx`, `alert-feed-state.ts`, `AlertBanner.tsx`, `StudioShell.tsx`, `signals-api.ts`, `response/ResponseView.tsx`, `live/UnitsView.tsx`, `live/UnitSheet.tsx`.
**Tests.** `twin-alert-scheduler.unit.test.ts`, `twin-alert-ack.unit.test.ts`, `alert-bridge.unit.test.ts`, `alert-feed.unit.test.ts`, `twin-value-age.unit.test.ts`, `signals.unit.test.ts`; `alert-feed-state.test.ts`, `AlertBanner.test.tsx`, `live/UnitSheet.test.tsx`, `response/ResponseView.test.tsx`, `platform-nav.test.ts`.

## D6. Twin metrics

**Purpose.** Let each institution define its measures, without the engine knowing what a bed is.

```mermaid
flowchart TD
    A["Definition: one aggregate,<br/>divided by a second one if needed"] --> B["Objects of a unit's subtree,<br/>retained by type, role and filters"]
    B --> K{"The aggregate"}
    K -->|"count"| V["Value of the metric for the unit"]
    K -->|"sum, mean, minimum,<br/>maximum, only"| C{"How many retained objects<br/>carry a figure?"}
    C -->|"no object retained"| N["No value: nothing to read here"]
    C -->|"objects, and no figure"| W1["No value, and its reason (blank):<br/>the source published no figure"]
    C -->|"one or several"| D{"only?"}
    D -->|"no"| V
    D -->|"yes, a single figure"| V
    D -->|"yes, several"| W2["No value, and its reason (several):<br/>averages are not averaged again"]
```

**Rules.** Nothing rests on a type name or a status value written in the code: “occupied beds over beds” is a definition, not a special case. The value of a unit covers its whole subtree: a hospital's occupancy is that of its wards taken together, not an average of averages. The computation (`rollupFrom`) is kept apart from its database reads, and a test holds it against the twin's export on one twin: for a unit with no sub-unit the two give the same figure, and the page's figure for a unit is exactly the sum of the export's over everything under it.

**An average already made is not made again.** The `only` aggregate gives the value of the one object that carries it, and nothing when several do. It is for figures that arrive as averages: two emergency rooms publishing a length of stay of 4 h and 12 h do not have one of 8 h between them, since the file does not say how many people each was made from. A unit holding several such objects has no value for the measure, and says so. **A measure without a value gives its reason when it has one** (`withheldOf`): `several`, several averages that are not averaged; `blank`, what the measure reads is there but the source published no figure. With no reason, nothing the measure reads is linked to the unit. **A measure can be a duration** (unit `hours`): held in decimal hours, written in hours and minutes (“5 h 59”).

**Code.** `backend/src/services/twin-metrics.ts`, `twin.ts` (`rollupAllUnits`, `rollupFrom`, `withheldOf`), migration `068_twin_metric_hours.sql`. **Tests.** `twin-daily-figures.unit.test.ts`, `twin-metrics.unit.test.ts`, `twin-self-rollup.unit.test.ts`, `twin-figures.unit.test.ts`.

## D7. Freshness of a value

**Purpose.** Measure the age of a value from the moment it was true, not from our last download. And date each value on what it reads: the age of a whole unit and the age of one of its measures are two answers.

```mermaid
flowchart TD
    A["An age to give"] --> B{"Of what?"}
    B -->|"of a whole unit"| C["Everything under the unit"]
    B -->|"of a measure, where it has a value"| D["Only what the measure looks at:<br/>the types and roles of its definition,<br/>before its filters"]
    C --> E{"Objects, and a property declared<br/>as carrying the moment of the measurement?"}
    D --> E
    E -->|"no object"| X1["No age: nothing is linked (empty)"]
    E -->|"no declared property"| X2["Age unknown, and said to be so (undeclared)"]
    E -->|"one or several"| F["For each declared property:<br/>the newest timestamp among the objects"]
    F --> G{"How it is written"}
    G -->|"with its zone"| H["Read as it stands"]
    G -->|"date and time with no zone,<br/>the hour on one or two digits"| I["Placed on the declared clock.<br/>With no declared clock: zone-unknown"]
    G -->|"a date with no hour"| J["The start of that day on the declared clock:<br/>the oldest the reading can be"]
    G -->|"anything else, or a timestamp cut short"| K["Unreadable (unreadable)"]
    H --> L{"How many declared properties<br/>gave a time?"}
    I --> L
    J --> L
    K --> L
    L -->|"all of them"| M["The age of the oldest (observed)"]
    L -->|"some of them"| N["The age of the oldest of those read:<br/>a floor (partial)"]
    L -->|"none"| O["Age unknown, with the reason of the first"]
    M --> P{"Does the property the measure reads<br/>declare a period?"}
    N --> P
    P -->|"no"| Q["The age is that of the value"]
    P -->|"the day before (previous_day)"| R["The value is a figure of the day before.<br/>The age is that of the reading that published it"]
```

**Rules.**
- **The moment is declared, never guessed**: a column that looks like a date is not necessarily the time of the measurement. A timestamp with no zone and no declared zone is reported unreadable rather than interpreted.
- **An hour written on one digit is read.** The MSSS emergency file writes `2026-11-19T9:45` from midnight to ten in the morning, and `2026-11-19T10:45` after. Read strictly, the first was refused: for ten hours a day no emergency reading had an age, and every alert said “age of the value unknown” until the hour reached two digits. Only the hour is completed. A timestamp cut short (`2026-11-19T9:`) stays unreadable: what is missing is never filled in, and the time of our download never stands in for it.
- **A date with no hour is read as a day.** `2026-07-02`, what a registry or a weekly sample publishes, names a day on the declared clock. The age is counted from the start of that day: the oldest the reading can be. So it can be too large by a day at most, and never too small. Like a time with no zone, a date needs a declared clock.
- **Two ages, two questions.** A unit's age answers “is everything I see here up to date?”: it is counted on everything under it, and takes the oldest of its sources. A value's age answers “how old is this figure?”: it is counted on what its measure looks at. At a unit that receives a stretcher census and an air quality reading, the two differ, and both are right. The screen names them: “Oldest source” for the unit, “This value was read…” for the value.
- **What a measure looks at.** The types and roles its definition names, before its filters: a count of closed beds was made by looking at every bed, so it has the age of their latest reading, and a count of zero has an age too. A built-in measure says it in its name: `count:Lit` looks at the beds, `mean:attente` at whatever declares that number; `linkedInstanceCount` and `freshnessSeconds` are about everything under the unit, and so is their age.
- **A value does not borrow the age of another source.** A unit's age only counts the timestamps that are declared. A wastewater reading that declares no time, beside a station that declares one, leaves the unit with the station's age. The wastewater value itself has no age, and says so with its reason.
- **A measure is dated only where it has a value.** A unit with no air quality station has no index, so nothing to date.
- **A time in the future is not floored at zero.** A negative age points to a wrong clock somewhere; showing it as “just now” would hide it.

- **A figure of the day before is declared.** The hourly emergency file republishes, every hour, the average length of stay of the people who left the day before: the row is stamped 17:45 today, and the figure is yesterday's. Dated by its row, it would read “14 minutes ago”. A numeric property can therefore declare the period it describes (`period: previous_day`, set in a type's editor, “Describes”). A measure that reads a single property declared that way carries the period with its age, and the age is then that of the reading that published the figure: the screen writes “Yesterday's average, published 14m ago”, never “This value was read 14m ago”. Every object the measure reads must declare the same period; otherwise none is kept. Nothing is guessed: a column of hours looks the same whether it is of the last hour or of the day before. Limit: an alert raised on such a measure keeps, in the banner, the sentence of a value of the hour ([issue 40](https://github.com/V1ktor7/obscyro/issues/40)).
**Code.** `backend/src/services/observed-at.ts` (`readStamp`, `freshnessOf`, `freshnessAcross`), `twin-metrics.ts` (`metricLooksAt`), `twin.ts` (`measureReads`, `agesOfValues`, `valueAgeOf`, `rollupFrom`, `selfRollup`, `rollupPlaces`); `frontend/app/studio/twin-ui.ts` (`formatReadingAge`, `explainFreshness`), `alert-feed-state.ts` (`valueAge`), `live/UnitSheet.tsx`, `live/unit-trends.ts` (`agePhrase`), `property-schema.ts` (`VALUE_PERIODS`), `twin.ts` (`periodOfMeasure`).
**Tests.** `observed-at.unit.test.ts`, `twin-value-age.unit.test.ts`, `twin-self-rollup.unit.test.ts`; `twin-ui.test.ts`, `alert-feed-state.test.ts`, `live/UnitSheet.test.tsx`, `twin-daily-figures.unit.test.ts`, `live/unit-trends.test.ts`.

## D8. Zone correspondence

**Purpose.** Read a signal measured on one geography (a sewershed, a station) on the territories of the network.

```mermaid
flowchart TD
    A["Signal per source zone"] --> B["Overlaps: share of each zone<br/>that goes to each territory"]
    B --> C{"Basis of the weight"}
    C -->|"population"| D["Preferred whenever it exists"]
    C -->|"area or declared"| E["Allowed, and labelled as such"]
    D --> F{"Nature of the quantity"}
    E --> F
    F -->|"a count"| G["The shares add up"]
    F -->|"a concentration, a rate"| H["Weighted mean"]
```

**Rules.** Weighting by area misleads: a sewershed that covers 30 % of the hectares can carry 70 % of the people. Two plants at 500 copies per litre do not make 1,000.

**Code.** `backend/src/services/zone-correspondence.ts`. **Tests.** `zone-correspondence.unit.test.ts`.

## D9. Live reading and situation card

**Purpose.** To say what is happening now, to the analyst and to the person alike, with the very figures the screens show and the age of each. An alert opens a card that reads in full without the language model.

```mermaid
flowchart TD
    A["One live reading (readLive):<br/>reality only, once per question or per card"] --> B["Unit tree"]
    A --> C["Computation of the unit page (rollupAllUnits):<br/>everything under the unit, sub-units included"]
    A --> D["Alert feed of the banner (readAlertFeed)"]
    A --> E["Measures the organisation defined,<br/>number of alert rules,<br/>open signals by stage"]
    D --> F["Signals raised by the listed alerts:<br/>kind, stage, place in the workflow"]
    B --> G["unitNow: measures rounded like the page,<br/>each with the age of its own value,<br/>what stands under the unit by type,<br/>age of the whole unit, the unit's alerts"]
    C --> G
    D --> H["alertsNow: alerts, worst first,<br/>value, since when, age of the value,<br/>signal and stage, last check of the thresholds"]
    E --> H
    F --> H
    G --> I["The analyst's unit_now tool"]
    H --> J["The analyst's list_alerts tool"]
    G --> K["Situation card: GET /situation<br/>named by a unit, an alert or a signal"]
    H --> K
    K --> L{"Is the named alert<br/>among the open alerts?"}
    L -->|"yes"| M["Its reading, with the age of its value"]
    L -->|"no"| N["The card says it is no longer open;<br/>the unit is read all the same"]
    K --> O{"Is a signal named?"}
    O -->|"yes, in this project"| P["Its kind, its stage and the path of its workflow,<br/>even if its alert has cleared"]
    O -->|"yes, elsewhere"| Q["Refusal: signal not found"]
    K --> R["A question already written by the program,<br/>from the unit and the alert"]
    O -->|"yes, in this project"| S["Responses prepared for its kind, and what their test is worth;<br/>the retest of each on the current state (A11);<br/>decisions already taken on this kind of signal (A9)"]
```

**Rules.**
- **One reading, two readers.** What the analyst gets from `unit_now` and what the card shows for the same unit come out of the same function (`unitNow`), and likewise for an alert (`alertNow`). The screen and the analyst cannot give two figures for one ward.
- **The screen's source, not the engine's.** The reading starts from the computation of the unit page and the alert feed of the banner, not from the export (B1): the export counts only what is attached to the unit itself. A test holds the two together (D6).
- **Rounded like the page.** A measure is handed to the analyst as the page writes it: a percentage with no decimals, a ratio with two. It has no rounding to do, so it cannot round differently.
- **An age says what it is worth.** Exact (“value read 37 min ago”), a floor (“value read at least 2 h ago”) when one of the sources read published no time, or unknown with its reason. These are the three cases of the banner (D5), in the same words. The time the data was written here is given apart: it is not the age of the value.
- **Each figure has its age.** An alert and a measure carry the age of what the measure reads (D7). The unit keeps its own, that of the oldest of all its sources, which answers another question and can be older than the age of one of its values. The card shows each measure's age in its tile, and names the unit's (“Oldest source under this unit”). The analyst is given both, with what each one means.
- **Nothing open is not nothing to report.** The reading says how many alert rules exist and when the thresholds were last checked. With no rule at all, it says that nothing could have opened.
- **Reality only.** No scenario raises an alert, and a live figure read through a “what if” would speak of a world that does not exist.
- **The past is not in this reading.** The reading is that of now; it says so, to the analyst and on the card. What a measure was worth earlier is kept elsewhere (D11): the unit's page shows it, and the card only follows the measure that raised its signal, since it was raised (A9).
- **The card does not wait for the model.** `GET /situation` calls no model and writes nothing. The question for the analyst is written by the program; asking it is the person's move.
- **A signal is looked up in its project.** A signal of another project is not found, whoever the caller is.
- **A signal brings what was prepared for its kind.** The prepared responses, with the figures of their test and what it is worth today, what the engine made of them when the signal opened (the retest, A11), and the decisions already taken on signals of that kind (A9). A card with no signal shows none: nothing there says which kind it is. The card also says whether a response can be engaged now, and why not.
- **On screen.** The card (`/studio/situation`) reads itself again every thirty seconds, and every five seconds while a prepared response is queued or being retested, so that the result shows without a click; only the most recent reading is shown, and a reading that fails leaves the last one on screen, said to be no longer up to date. The shell's “Analyst” button and the card send the page and the selection with the question, as ids (A1).
- A unit and an aggregate value, never a person.

**Code.** `backend/src/services/live-reading.ts` (`readLive`, `unitNow`, `alertsNow`, `alertNow`, `ageOfValue`, `whyAge`, `shown`), `situation.ts` (`situationOf`, `preparedQuestion`), `backend/src/routes/situation.ts`, the tools `list_alerts` and `unit_now` in `analyst-tools.ts`; `frontend/app/studio/situation/SituationView.tsx`, `situation-api.ts`, `AnalystDock.tsx`, `alert-feed-state.ts` (`situationHref`).
**Tests.** `live-reading.unit.test.ts`, `twin-figures.unit.test.ts`, `routes/situation.unit.test.ts`; `situation/SituationView.test.tsx`, `AnalystDock.test.tsx`, `AlertBanner.test.tsx`.

## D10. Sites and units on the network map

**Purpose.** Make the network map answer the explorer set beside it, when the two do not show the same objects: the map draws sites, the explorer lists units, and a site does not carry a unit's identifier.

```mermaid
flowchart TD
    C["Click on a line of the explorer:<br/>a unit, or a heading of a grouping"] --> A{"Does a site count this unit?<br/>the site is the unit, or names it among its units"}
    A -->|"yes"| S["That site's panel opens,<br/>the map moves to it"]
    A -->|"no"| B{"Does a site count a unit above it?<br/>the nearest first"}
    B -->|"yes"| S2["That site's panel opens.<br/>The explorer says the unit has no place of its own"]
    B -->|"no"| D{"Do sites count units under it?"}
    D -->|"yes"| F["No panel. The map frames those sites,<br/>and the explorer says how many"]
    D -->|"no"| N["No panel.<br/>The explorer says the unit is not on the map"]
    M["Click on a site of the map"] --> L["The explorer lights the unit that site counts,<br/>opens the branch that hides it and scrolls to it"]
```

**Rules.**
- **The link is the list of units each site says it counts** (`contributingUnits`). A site names only the topmost unit standing on it: a ward inside a hospital is on the hospital's site without being named there. Hence the climb to the unit above.
- **Three gestures go through this link.** Hiding a branch of the explorer hides a site when all its units are hidden, and leaves it while a single one stays visible. A site's alerts are the ones raised on its units. A click on a line opens the site that counts the unit. Comparing a site's identifier with a unit's finds nothing: that is the mistake each of the three has known.
- **A click is never left without a result.** When no panel opens, the explorer writes why: the unit has no place of its own and the map shows the sites of what is under it, or no site counts it.
- **A unit counted by several sites** opens the first, and the explorer says how many sites count it.
- **A site nothing stands for in the explorer**, a sensor for instance, lights no line there, and the explorer cannot hide it.
- **The open alerts are in the explorer.** The “Alerts” tab lists the project's open alerts, the most severe first, then the most recent, with their number on the tab. They are those of the alert feed every page reads. A click on an alert selects the site that counts its unit, moves the map to it and opens its inspector: the link is the same as everywhere, the list of units each site says it counts. An alert whose unit has no site says so, and keeps its link to the situation card. The list shows and points; closing a signal or setting a threshold is still done on the Response page.
- **The line lit from the map is shown once**: the branch that hides it opens and the list scrolls to it. Folding it again afterwards is the person's choice, and a new reading of the twin does not reopen it.

**The inspector of a site.** A click on a site opens a collapsible overlay, set on the map. From top to bottom: its open alerts; the measure the map paints, with its rule, its gauge, its age and its change since the reading before; what else the site reports, each figure with its change; apart, the figures of the day before (D7), with their 30-day mean; what the twin kept of the painted measure over 24 hours; then, folded, the other readings and the units counted; and last, where the figures come from. The rows are the measures the organisation defined: none is written in the code.

```mermaid
flowchart TD
    S["A site selected on the map"] --> V["Its figures: the sum of its units,<br/>read with the network"]
    S --> U{"How many units does it count?"}
    U -->|"one"| D["A read of that unit (GET /twin/units/:id):<br/>changes, means, the text of the types.<br/>And the history of the painted measure, 24 h"]
    U -->|"several"| N["No change and no history: they are kept<br/>by unit, and the panel says so"]
    U -->|"none: the site is its own reading"| Z["The figures alone"]
    D --> P["Panel: alerts, painted measure, other figures,<br/>figures of the day before, history, source"]
    V --> P
    N --> P
    Z --> P
    D --> T["Timeline, when it is open: the series of the painted measure<br/>over the timeline's window (GET /twin/units/:id/history)"]
    T --> I{"Is an investigation of this unit<br/>and this measure on screen?"}
    I -->|"yes"| I1["Its episodes as bands,<br/>its events as marks (A13)"]
    I -->|"no"| I2["The series alone, and its alert threshold<br/>when it is near what was read"]
```

- **What was kept is kept by unit** (D11). A site that counts a single unit reads that unit's, and reads it again every minute. A site that counts several does not add them up: histories that were not kept together do not make one history.
- **Alerts come first.** The panel grew longer, and an open alert must not end up below the fold.
- **The source is a text of the twin.** “About these figures” prints the description the organisation wrote on the object types the measures read (`typeNotes`): the source, its licence, its limits. No screen names a source.
- **The analyst is under the inspector.** The right column carries two folding overlays: the inspector of the selected site, then the “Analyst” panel, with its Ask and Investigate tabs (A13), and “What it can use”, the list of its tools. Opening the analyst folds the inspector, whose name stays in view. The panel keeps what was done in it when it is folded or the other tab is shown: an investigation under way goes on. The “Analyst” button of the Studio's shell is not shown on this page.
- **The timeline draws the series of the selected unit.** Under the lanes of the alerts and of the feed events, a third lane draws the painted measure at the selected unit, as a staircase, over the timeline's window: 24 h, 72 h, 7 days or 30 days, the same window as an investigation's. The series is read only while the timeline is open, then read again every minute. With no site selected, the timeline asks for one; for a site that counts several units, or a measure that is not kept, there is no series.

**Code.** `frontend/app/studio/command/units-tree.ts` (`isSiteHidden`, `alertsForSite`, `pickFromExplorer`, `lineOfSite`, `lineAndBelow`, `unitsAbove`), `NetworkTwinView.tsx` (`pickLine`, `pickSite`), `AlertsList.tsx`, `SiteInspector.tsx`, `NetworkAnalyst.tsx`, `NetworkTimeline.tsx`, `series-lane.ts`, `frontend/app/studio/map-overlay.tsx` (`OverlayPanel`, `keepMounted`), `frontend/app/studio/TreeExplorer.tsx` (`pathTo`). **Tests.** `units-tree.test.ts`, `TreeExplorer.test.tsx`, `SiteInspector.test.tsx`, `AlertsList.test.tsx`, `NetworkTimeline.test.tsx`, `series-lane.test.ts`, `InvestigateTab.test.tsx`.

## D11. History of twin measures

**Purpose.** That the twin can say something other than “now”. A unit's measures are computed when they are read, from the objects as they stand: when one piece of data replaced another, the earlier value was lost. The twin now writes down what it measures, so that one can say what an emergency department showed this morning, and later what is usual for it and what a decision changed.

```mermaid
flowchart TD
    A["Recorder: one pass finished,<br/>wait 5 min"] --> B["Each project, one after another"]
    B --> C{"Does the project have units?"}
    C -->|"no"| C1["Nothing is read"]
    C -->|"yes"| D["Measures of each unit, with no lens:<br/>reality, never a scenario"]
    D --> E["One candidate per unit and per defined measure:<br/>the value, and the time it was true<br/>according to what the measure reads (D7)"]
    E --> F{"Against the last reading kept<br/>for that unit and that measure"}
    F -->|"no reading yet, and a value"| G["Reading written down"]
    F -->|"a different value,<br/>including no value at all any more"| G
    F -->|"same value, read at another time<br/>(more than 90 s apart)"| G
    F -->|"same value, same time"| H["Nothing is written"]
    F -->|"no reading yet, and no value"| H
    G --> I["app.twin_reading: unit, measure, value,<br/>the source's time and what it is worth,<br/>the time we wrote it down"]
    X["Catch-up from kept copies (D12):<br/>readings marked, dated at their copy"] --> I
    I --> J["GET /twin/units/:id/history:<br/>the readings of a measure over a period"]
    J --> K["The reading in force when the period opens<br/>is put first"]
    K --> L["The unit's sheet: a staircase,<br/>each value holds until the next reading"]
    L --> M{"A reading with no value?"}
    M -->|"yes"| N["The line breaks:<br/>a gap is not a zero"]
    M -->|"no"| O["The lowest, the highest,<br/>and the date of the first reading kept"]
    O --> O2["Caught-up readings are drawn like the others<br/>and said apart: the twin did not show them"]
    I --> P["GET /twin/units/:id, trends:<br/>one read for every measure of the unit"]
    P --> Q{"Does the value describe a day (D7)?"}
    Q -->|"no"| R["Reading before: the last one kept<br/>that is not the one on screen"]
    Q -->|"yes, the day before"| S["Reading before: the last one kept on an earlier day.<br/>And the mean of one value a day, 30 days at most"]
    R --> T{"A reading before, with a value?"}
    S --> T
    T -->|"yes"| U["Change: the value now minus that reading's,<br/>with the hour of that reading"]
    T -->|"no"| W["No change, and the screen writes it"]
```

**Rules.**
- **Only what changes.** A reading is written down when the value differs from the last reading kept, or when the same value is read at a new time. An hourly file read twelve times in the hour gives one reading, not twelve. An identical value read an hour later gives a second one: “still 143% at 3 pm” is information.
- **Two times, which do not say the same thing.** `observed_at`: when the value was true, according to the source's timestamp, counted on what the measure reads (D7); empty when the source does not say. `recorded_at`: when we wrote it down; for a caught-up reading, when the copy it comes from was taken. `observed_basis` keeps what the first one is worth: an age that is only a floor stays a floor.
- **A tolerance of 90 seconds.** The twin gives a value's age in whole seconds; so the same source time comes back one or two seconds apart from one pass to the next. Two times less than 90 seconds apart are the same reading. Sources publish by the hour or by the day: that margin hides no reading.
- **Absence shows.** A measure that no longer has a value is written down with an empty value, once. A gap in the readings is not a zero. A measure that never had a value starts no history.
- **Reality only.** The twin is read with no lens. A reading made through a scenario describes a world that does not exist.
- **Nothing is invented.** The history starts the day the recorder started. What is older can only come from a copy of the source that was really kept, replayed afterwards (D12). Such a reading is marked as caught up (`replayed`): it carries the time the source gave and the time the copy was taken, and the screen says so, because the twin did not show it at the time. Nothing else is reconstructed. The route returns the date of the first reading kept (`since`) and says whether it was caught up (`sinceCaughtUp`): the screen writes it. An empty list with an empty `since` means “nothing was kept”, not “nothing changed”.
- **The measures the organisation defined, not the built-in counts.** The number of linked objects, the age of the data and the counts by type are computed on the spot and are not kept. The sheet says so for those measures instead of showing an empty history.
- **A staircase.** Between two readings kept, the twin showed the first: the recorder passes every five minutes and writes down any change. So the line holds flat until the next reading, and nothing is drawn between two readings that was not read. A reading is placed at its source's time; when the source declares none, at the time it was written down.
- **Cadence.** One pass every five minutes, never two at once: the next starts five minutes after the previous one ended. So a change is written down at most five minutes after it happened, with its source's time. One project's failure does not cost the others their reading. `TWIN_HISTORY_DISABLED=1` stops the recording; what was kept stays.
- **A bounded read.** 48 hours by default, 90 days at most, 2,000 readings per answer. When the period holds more, the oldest are left out and the answer says so (`cut`).
- **A unit that is removed does not lose its past.** Readings are not tied to the object by a foreign key: the history tells what was, not what is still there. A deleted project takes its own with it.
- **What is not kept.** The objects themselves, their links and the capacities at a past date: the whole twin cannot yet be read as it was. The situation card reads of the history only the measure that raised its signal, since it was raised (A9). The analyst's tools do not read it: they say so, and point to the unit's page. An investigation (A13) reads it, but it is the program that reads it and not the model.
- A reading is a unit and an aggregated value, never a person.

- **The change since the reading before.** For each measure that has a value, a unit's sheet and a site's inspector give the change since the reading kept before, and the hour of that reading. The arithmetic is done by the server (`changeOf`), in one read for every measure of the unit (`readUnitTrends`); the screen subtracts nothing. The last reading kept is most often the value on screen itself, written down a few minutes ago: it is recognised by its hour, within 90 seconds, or by its value when the source gives no time, and the one before it is used. A value corrected within its hour leaves two readings at the same time: neither is the reading before, and the change is counted from the hour before. If the recorder has not yet written down the value on screen, the last one kept already is the reading before.
- **No change against an absence.** With no earlier reading, the screen writes that none was kept. If the reading before had no value, no change is counted: an absence is not a zero.
- **A figure of the day before is compared with the day before's.** Republished every hour, it is not compared with itself an hour earlier: its reading before is the last one kept on an earlier day, counted on the clock of its source (D7).
- **The 30-day mean.** For a figure of the day before, the mean of one value a day, the last one written down that day, over 30 days at most (`meanOfDays`). It says how many days it rests on (“average over 12 days kept”) while there are fewer than thirty. A day with no reading is not filled in.
- **A change has no colour.** Twelve more people waiting is worse; twelve more stretchers is better. The sign says “more”, and nothing else.
**Code.** `backend/src/services/twin-history.ts` (`readingsNow`, `recordReadings`, `recordProject`, `recordAllProjects`, `readUnitHistory`, `changeOf`, `meanOfDays`, `readUnitTrends`, `startTwinHistory`), `series-catchup.ts` (`recordReplayed`), route `GET /v1/ontology/:env/twin/units/:id/history` in `backend/src/routes/twin.ts`, migrations `067_twin_reading.sql` and `072_kept_series.sql` (the `replayed` mark); `frontend/app/studio/live/unit-history.ts` (`historyView`), `unit-trends.ts`, `UnitSheet.tsx`, `UnitsView.tsx`, `command/SiteInspector.tsx`.
**Tests.** `twin-history.unit.test.ts`, `twin-daily-figures.unit.test.ts`; `live/unit-history.test.ts`, `live/unit-trends.test.ts`, `live/UnitSheet.test.tsx`, `live/UnitsView.test.tsx`.

## D12. Kept series

**Purpose.** Giving a forecasting model a past it can read. A model only knows what it is shown. The platform kept that past in two shapes: the twin's readings (D11), one line when a measure changes, and the copies of the datasets, a whole file per sync. Neither answers “this measure, at this place, from this day to that one, hour by hour”. A **series** is that answer: a value followed over time, for one or several entities, read on a regular grid.

```mermaid
flowchart TD
    A["Kept series screen: on a table dataset,<br/>the column of the time, the one of the value,<br/>those that name the entity, the step, the time zone"] --> B{"Are the columns those of the dataset,<br/>distinct, and the time zone known?"}
    B -->|"no"| B1["Refused, with what to correct"]
    B -->|"yes"| C["Row of app.kept_series, under its key"]
    C --> D["The dataset's latest copy is read at once,<br/>dated at when that copy was taken"]
    W["Every write of the dataset: a sync,<br/>an upload, the output of a pipeline"] --> E["For each series declared on that dataset"]
    D --> F["Each row: the instant, the entity, the value"]
    E --> F
    F --> G{"Can the instant be read?"}
    G -->|"no, or with no zone<br/>and none declared"| G1["Row left out, counted"]
    G -->|"yes"| H{"Two rows for the same entity<br/>at the same instant, with different values?"}
    H -->|"yes"| H1["Left out, counted:<br/>a column is missing from the entity"]
    H -->|"no"| I{"Against the last point written down<br/>for that entity at that instant"}
    I -->|"none yet"| J["Point written down: entity, instant, value,<br/>the time we saw it"]
    I -->|"a different value,<br/>having none included"| J
    I -->|"the same value"| K["Nothing is written down"]
    G1 --> N["What could not be read is written on the series.<br/>The dataset's write never fails because of it"]
    H1 --> N
```

**The read on a grid.**

```mermaid
flowchart TD
    A["POST /series/read: a series, entities,<br/>from, to, the step, the rule, “as known at”"] --> B{"Does the stretch end after it starts,<br/>not after “as known at”,<br/>and in 3,000 steps at most?"}
    B -->|"no"| B1["Refused, with what to narrow"]
    B -->|"yes"| C{"Where does the series come from?"}
    C -->|"twin:measure"| D["Readings of the twin (D11), by unit.<br/>The instant is the source's time,<br/>else the time the reading was written down"]
    C -->|"a declared key"| E["Points of the series, by entity"]
    D --> F["Keep only what had been written down at “as known at”.<br/>For one instant, the last one written down"]
    E --> F
    F --> G["Plus the last point before the stretch:<br/>it is the one in force when the stretch opens"]
    G --> H["Each step covers from its start to its start plus one step.<br/>A value holds until the next point,<br/>or for holdHours at most when the read asks for it"]
    H --> I{"Was anything in force<br/>during that step?"}
    I -->|"no"| J["null: a gap, never a zero"]
    I -->|"yes"| K["mean: average weighted by the time known<br/>max: the highest value in force<br/>last: the one in force when the step ends"]
    J --> L["By entity: its values, its first point,<br/>its steps with no value, its points caught up"]
    K --> L
```

**The catch-up from kept copies.**

```mermaid
flowchart TD
    A["Kept series screen: “Catch up” on a series"] --> B["GET /series/catchup: the copies taken<br/>before the series started being kept"]
    B --> C{"A measure of the twin<br/>or a dataset series?"}
    C -->|"dataset series"| D["The copies of its own dataset"]
    C -->|"measure of the twin"| E{"Does a pipeline write today<br/>every object type the measure reads?"}
    E -->|"no: a draft, several pipelines,<br/>a measure that counts everything"| E1["Nothing is offered, with the reason"]
    E -->|"yes"| F["The datasets that pipeline reads, with their older copies.<br/>Or another dataset of the project, read in place of an input"]
    D --> G["The screen says how many copies will be read,<br/>of which dataset, through which pipeline.<br/>A person starts it"]
    F --> G
    G --> H["POST /series/catchup: one batch.<br/>12 s or 400,000 rows at most"]
    H --> I["The next copies, from the oldest<br/>to the newest, after the last one read"]
    I --> J{"Which series?"}
    J -->|"dataset series"| K["The rows of the copy become points,<br/>as at a write of the dataset"]
    J -->|"measure of the twin"| L["The copy goes through today's pipeline, in memory.<br/>Its other inputs are read as they were then"]
    L --> L0{"Did its other inputs already have a copy,<br/>and does the pipeline run without cutting the copy?"}
    L0 -->|"no"| L1["Copy left out,<br/>counted, with the reason"]
    L0 -->|"yes"| M{"Is the object of a row<br/>in the twin today?"}
    M -->|"yes, same identity"| N["It keeps the place<br/>it has today"]
    M -->|"no"| O{"Does a link rule of the pipeline<br/>find it a place?"}
    O -->|"yes"| N2["Placed by that rule"]
    O -->|"no"| O1["Left out, counted"]
    N --> P["The measure, as defined today,<br/>over today's units,<br/>at the time the copy was taken"]
    N2 --> P
    K --> Q{"Against what was written down<br/>when the copy was taken"}
    P --> Q
    Q -->|"a new or different value"| R["Written down, marked “caught up”:<br/>the source's time,<br/>and the time the copy was taken"]
    Q -->|"the same value"| S["Nothing is written down"]
    Q -->|"no value,<br/>and never had one"| S
    R --> T["app.series_catchup:<br/>where the catch-up stands"]
    S --> T
    L1 --> T
    O1 --> T
    T --> U{"Are there copies left?"}
    U -->|"yes"| V["The screen asks for another batch,<br/>or a person stops and will resume"]
    V --> H
    U -->|"no"| W["Done: the series says what was caught up<br/>and what was left out"]
```

**Rules.**
- **Two kinds of series, a single read.** A measure of the twin is a series with nothing to declare: its key is `twin:` followed by the measure, a unit is an entity, and its points are the readings of D11. A dataset series is declared from the Studio. What differs is where the points are, never how a grid is made from them.
- **Nothing is recognised by its name.** The column of the time, the one of the value and those of the entity (four at most) are picked from the dataset's schema. The dataset has to be a table of the project: every write of a table is a whole copy to read, which a stream is not. The key is made from the label.
- **Two times per point.** `at`: the instant the value is about. `seen_at`: the instant we first saw it. Both are kept, because the second is what lets a past forecast be replayed.
- **Only what changes.** A point is written down when nothing was written for its entity at its instant, or when the last value written differs. A file re-read unchanged writes nothing. A value its source corrects afterwards keeps both, the old one and the new one, each with the time it was read.
- **An absent value is kept as an absence.** A cell that is not a number (“pas d'information disponible”) gives a point with no value: a gap that was seen, not a zero. A decimal comma is read; a thousands separator is not, rather than guessed.
- **The time of a file.** An instant that carries its zone is read as it stands. One that carries none (`2026-11-27T12:50`) does not say which city's clock it is: it is read only if the series declares a time zone, as in D7. A date with no hour is the start of that day. With no zone declared, those rows are not placed, and the series says so.
- **Two rows that contradict each other do not make a point.** Same entity, same instant, two values: a column is missing from the entity. The rows are left out and counted, never averaged nor picked from.
- **A write never fails because of a series.** What a series could not read (unreadable times, ambiguous rows, a column that went away) is written on its line, and the screen shows it. The dataset already has its copy.
- **On declaration, the latest copy is read.** Its points are dated at when that copy was taken: that is since when the platform has held them. Older copies are read only when asked for: that is a catch-up. A dataset never written is declared all the same, and waits for its first write.
- **A value holds until the next point.** Over a step, `mean` is the average of what was in force, weighted by how long; `max` is the highest value in force at some moment of the step; `last` is the one in force when the step ends. A mean counts only the time known: a day half known is averaged over that half.
- **A value does not hold for ever.** A source nobody read for a month did not repeat its last figure for a month. With `holdHours`, a value stops holding that many hours after the instant it is about when no newer point came: the steps after it are gaps. Without that setting, it holds until the next point, however far that is. “Look” sets it at two steps of the source for a dataset series, which declares its step; a measure of the twin does not say how often its source publishes, and it is the read that gives the bound.
- **A gap stays a gap.** A step during which nothing was in force is `null`, never zero. Nothing is known before an entity's first point, and the answer gives the date of that first point.
- **“As known at”.** With `asOf`, the read uses only what had been written down at that instant, and the stretch cannot end after it: nothing was known of what came next. A corrected value is read as it was known that day.
- **A bounded read, refused rather than cut.** 3,000 steps and 300 entities at most per read. Beyond that the read is refused with what to narrow: a series cut without a word would pass for whole.
- **By project.** A series belongs to a project; another project does not see it.
- **Removing a series removes its points, not the copies.** The dataset's versions are not touched: declaring the series again reads the latest one. Its catch-ups are removed with it. A measure of the twin is not removed here.
- **Declaring and removing are kept in the audit log.**
- **Catching up is reading again what was kept.** A series starts the day it started being kept: the first reading of a measure of the twin, the first copy read of a dataset series. But every sync was already keeping a whole copy of its file. A catch-up reads the copies taken before that day, from the oldest to the newest, and writes down what they hold. No copy, no point: nothing is invented.
- **A dataset series reads its own copies again.** Each copy is read the way a write of the dataset is read today: the same columns, and the same rules as above.
- **A measure of the twin goes through today's pipeline again, in memory.** It takes a pipeline that writes today, and not a draft, every object type the measure reads. Each copy goes through it, and the measure is computed by the twin's own computation (D11), as it is defined today, over today's units. Nothing is written in the ontology: no object, no link, no type, no pipeline run.
- **Today's definitions, not those of the time.** The pipeline, the measure, the units and the place of each object are the ones of now. An object the twin holds today, recognised by its identity, keeps the place it has today, with all its links. One it does not hold is placed by the pipeline's link rules, read against today's twin. An object carries only what its copy said: a property the old file did not have is absent, never today's value. The screen says so before anything is started.
- **When the source changed file.** The dataset the pipeline reads today does not always have the old copies. A person can have the copies of another dataset of the project read in place of one of the pipeline's inputs: they pick the dataset and the input. The screen proposes a first choice, the dataset with the most older copies: an input of the pipeline, or another dataset most of whose columns are also those of an input, proposed in its place. A dataset that resembles no input stays in the list, without being proposed. Nothing is started without the person. The screen names the columns that dataset lacks: what the pipeline makes from them will be empty.
- **The other inputs, as they were then.** The pipeline's other inputs, a lookup table for instance, are read in their last copy taken by the time of the copy being replayed. A copy taken before one of them had any copy is left out and counted: read with a later one, it would be measured against figures that did not exist yet.
- **Marked, with its two times.** Everything a catch-up writes down is marked as caught up. A caught-up point carries the time its source gave and the time its copy was taken, not the time of the catch-up: read “as known at”, it appears at the moment the platform really held the copy.
- **A caught-up reading is held against the past.** It is compared with the last reading written down at the time of its copy or before, not with the most recent one. A copy re-read unchanged writes nothing. A unit that has no value and never had one starts no series; a unit that loses its value has that absence written down.
- **Nothing is placed by guess.** A row that cannot be made into an object (a value that cannot be read, a required property missing, no identity), an object that names no place the twin holds, a copy the pipeline fails on or that is longer than a run reads (150,000 rows): left out, counted, and said on the series.
- **In bounded batches, and resumed.** One call takes no new copy past 12 seconds or 400,000 rows (500 copies at most), and always reads at least one. The screen says before it starts how many copies will be read, asks for another batch as long as some are left, and stops when asked. It leaves two seconds between two batches, and when the API answers that it is asked too much in a minute, it waits the delay the API gives and then asks for the same batch again: the other pages of the Studio share the same limit. Where the catch-up stands stays written: it resumes from there. A finished catch-up, started again, reads nothing.
- **Refused with the reason.** No older copy; a measure that has no reading yet; a measure that counts every object of a unit, or that reads types written by several pipelines; a draft pipeline, a pipeline that calls the extraction service, a pipeline a run would refuse.
- **Forgetting what was caught up.** Removes what the catch-ups of a series wrote down, and those catch-ups with it. Only what is marked: a reading taken live and a point written by a sync are never touched, and neither are the copies. So the catch-up can be done again. The start of a catch-up and its forgetting are kept in the audit log.
- **What is missing.** A caught-up reading is not what the twin showed at the time: it is what today's measure would have read in the copy. A measure that reads types written by several pipelines is not caught up. The first point written down live can say again the last value caught up: the read is not changed by it. A file that carries its own history has all its points written down the day of its oldest copy read: read “as known at” a day before, they are not there. A source that stops publishing leaves its last value in force: for a dataset series, the read does not tell “unchanged” from “not re-read”. The grid moves by fixed steps from its start: a day is 24 hours on it, even on the day the clocks change. A stream is not kept as a series.

**Code.** `backend/src/services/series.ts` (`knownAsOf`, `onGrid`, `gridOf`, `readGrid`, `checkDraft`, `declareSeries`, `listSeries`), `series-capture.ts` (`extractPoints`, `noteOf`, `writePoints`, `captureInto`, `captureForDataset`), `series-catchup.ts` (`catchupOffer`, `runCatchup`, `typesLookedAt`, `whyNotThrough`, `readStructure`, `replayObjects`, `replayReadings`, `recordReplayed`, `forgetCatchup`, `listCatchups`), `pipeline.ts` (`execute`, options `readInput` and `onObjectRows`), `datasets.ts` (`loadTableVersion`), routes `backend/src/routes/series.ts`, migrations `072_kept_series.sql` and `073_series_catchup.sql`; `frontend/app/studio/data/KeptSeries.tsx`, `kept-series.ts`, `DataSection.tsx`, `frontend/app/studio/series-api.ts`.
**Tests.** `series.unit.test.ts` (the rows of a copy turned into points, a time with no zone, ambiguous rows, the grid, gaps, “as known at”, a corrected value, the declaration refused), `series-catchup.unit.test.ts` (two rows for one identity, a copy with no time, an identity that changes from one file to the next, a row with no place, a unit with no value, the batches and the resuming, nothing written in the ontology, the forgetting), `routes/series.unit.test.ts`; `data/kept-series.test.ts`, `data/KeptSeries.test.tsx`.
