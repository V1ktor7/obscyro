---
# The English of docs/analyst.md. When that page changes, bring this one up to date, then run `npm run docs:stamp`.
title: "The analyst"
description: "The analyst is the folding “Analyst” panel of the Scenarios page: you ask it a question, and it answers from what its reading tools returned, showing everything it read."
source: "docs/analyst.md"
translatedFrom: "9e51de233d6a68e9"
---

The analyst is the folding “Analyst” panel of the Scenarios page. You ask it a question about the twin, the open scenario or the run on screen; it answers relying only on what its reading tools returned, and shows everything it read.

It is also one click away on the other pages of the Studio, through the “Analyst” button at the bottom right, and in the situation card that opens from an alert. There it answers about the network as it stands now: what is open, and the live figures of a unit, each with its age.

On the network map (the Network page), it has a panel of its own, under the inspector of the selected site. One asks a question there, and one investigates the series of a unit: the **Investigate** tab searches for what was going on around it, and sets each event found beside what the twin measured (see “The investigations”). It is a first piece of the “Measured effects” step of the loop.

A fifth tab, “What it can use”, makes the analyst do nothing: it lists its tools.

The panel has four working tabs, which cover five steps of the [decision loop](/docs/product/decision-loop):

| Tab | Step of the loop | What you do there |
|---|---|---|
| Ask | Situation | Ask a question, read the answer and what was read to write it |
| Event finder | Precedents | Search official sources for what was happening around the network, accept or reject each event found |
| Options | Tested options, Recommendation | State an objective, see up to three options tested by the engine beside the scenario as it is |
| Decisions | Follow-up | Read back what was retained, what was expected of it, and the gap with what was observed |

The diagrams of the loop, the verifier and the calculator are in [Algorithms](/docs/product/algorithms), sections A1 to A3; those of the tested options and the decisions, sections A8 and A9; that of the online search and the calendar, section A10; those of the price list, the cost ledger and the delay of an option, section A12; those of the investigation of a series, section A13; those of the action types, section A14.

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

**The model.** The analyst runs on the Claude model named by the `ANALYST_MODEL` variable of the API service, read when the service starts. Three values are accepted:

| Value | Price published by Anthropic per million tokens, input and output, read on 2026-11-21 |
|---|---|
| `claude-opus-5-5`, also taken when the variable is empty | $4 and $20 |
| `claude-sonnet-5-5` | $2 and $10 |
| `claude-haiku-5-5` | $0.10 and $0.50 when the request is 100,000 tokens or fewer; $0.50 and $2.50 above that |

Any other value switches the analyst off, and the panel says which one it was given. It does not fall back on another model: a slip in the name of a cheaper model must not be billed at the price of the dearest one without anyone knowing. The model that answered is written under each answer (“Written by…”) and kept in the journal.

What a model is worth is known by replaying the reference questions. The whole set, twenty questions, passed twice in a row on `claude-haiku-5-5`, with no figure removed. On `claude-opus-5-5`, the first thirteen questions passed twice in a row; the whole set was not replayed to the end there. `claude-sonnet-5-5` has never been replayed: according to Anthropic's documentation it accepts the same request, but nothing says what its answers are worth. The reference questions are questions of the Ask tab: they say nothing of the Options tab or of the search for events. The effort asked for is `medium` for all three.

What the tools read from the twin (counts and capacities, never a person) is sent to the Claude API to write the answer. The panel says so at its foot.

The Event finder tab uses the web search of the Claude API. It has no variable of its own: it works with the same key, on two conditions that are set in the Claude console and not in the product. Web search must be allowed for the organisation (it is by default; switched off, the request fails with an error from the model), and the project's domains must not fall outside a list the organisation may have restricted. It is billed on top of tokens: US$10 per 1,000 searches at the rate read on 2026-11-17 and read again on 2026-11-20, eight searches at most per request.

## The routes

| Route | What it returns |
|---|---|
| `GET /v1/ontology/:env/analyst` | `{ configured, model }`: can the analyst be asked |
| `POST /v1/ontology/:env/analyst/ask` | A stream, one JSON line per event: a question and its answer |
| `POST /v1/ontology/:env/analyst/options` | The same stream: an objective and the tested options |
| `POST /v1/ontology/:env/analyst/events` | The same stream: a request and the candidate events found online |
| `POST /v1/ontology/:env/analyst/investigate` | The same stream: the series of a unit over a span, the events found online, and each one set beside the series |
| `GET /v1/ontology/:env/analyst/investigations` | The investigations kept in the journal, most recent first (`unitId` for a single unit) |
| `GET /v1/ontology/:env/analyst/investigations/:id` | One investigation as it was delivered, steps included. Nothing is recomputed |
| `POST /v1/ontology/:env/analyst/run` | A shorter stream: the scenario run by the server the way Run does it, and its digest, in the shape `ask` and `options` accept as `run`. Calls no model and writes nothing |
| `POST /v1/ontology/:env/decisions` | Records a decision from a tested option |
| `GET /v1/ontology/:env/decisions` | The project's decisions, most recent first (`scenarioId` for a single scenario) |
| `GET /v1/ontology/:env/decisions/:id/follow-up` | The arrivals a decision expected beside the observed series, with the gap |
| `POST /v1/ontology/:env/prepared-responses` | Keeps a tested option as a prepared response for a kind of signal |
| `GET /v1/ontology/:env/prepared-responses` | The project's prepared responses, in the order they were kept (`signalTypeId` for a single kind of signal) |
| `DELETE /v1/ontology/:env/prepared-responses/:id` | Retires a prepared response: it is no longer offered, without being erased |
| `POST /v1/ontology/:env/signals/:id/engage` | Engages a prepared response on a signal: records the decision, writes it on the signal's trail, and moves the signal one stage forward |
| `GET /v1/ontology/:env/action-types` | The project's action types, what the twin offers a type, and for each what it lacks to be tested |
| `POST /v1/ontology/:env/action-types` | Adds an action type; its key is made from its name |
| `PUT /v1/ontology/:env/action-types/:key` | Changes a type, or what the project changes of a built-in one |
| `DELETE /v1/ontology/:env/action-types/:key` | Removes a type of the project, or resets a built-in one to what it was |
| `GET /v1/ontology/:env/analyst/tools` | The analyst's tools: what each reads, what it does (read, compute, run the engine, search), where it comes from (the code, or the project), what it is given, where it is offered, whether it is on |
| `PUT /v1/ontology/:env/analyst/tools/:name` | Switches a tool off or on for the project (`on`) |
| `GET /v1/ontology/:env/function-types` | The project's function types (the reading tools it declared), what each lacks to run, those that can no longer be read, and what the project holds that a type can point at |
| `POST /v1/ontology/:env/function-types` | Declares a reading tool; its name is made from its label |
| `PUT /v1/ontology/:env/function-types/:key` | Changes a function type, or switches it off (`active`). The tool keeps its name |
| `DELETE /v1/ontology/:env/function-types/:key` | Removes a function type: the analyst no longer has it at hand |
| `POST /v1/ontology/:env/function-types/:key/try` | Runs a declared tool once, with `input`, and returns what the analyst would read (`result`) or the sentence of the refusal (`refused`). Calls no model and writes nothing |
| `POST /v1/ontology/:env/health-events` | Accepts a candidate: it enters the calendar |
| `GET /v1/ontology/:env/health-events` | The project's calendar, oldest to most recent (`from`, `to` for a period) |
| `DELETE /v1/ontology/:env/health-events/:id` | Removes an event from the calendar |
| `GET /v1/ontology/:env/situation` | The situation card of a unit, an alert or a signal (`unit`, `alert`, `signal`): the unit's live figures with their age, the alert, the stage of the signal and a question already written. Calls no model and writes nothing |
| `GET /v1/ontology/:env/web-sources` | The domains the search is allowed to look in |
| `PUT /v1/ontology/:env/web-sources` | Replaces that list |

Body of a question: `question`, `scenarioId` (or `null`), `looking` (`reality` or `scenario`), `run` (the digest of the run on screen, or `null`), and `focus` (or `null`): what the person has in front of them when they ask from somewhere other than the scenario map, namely `page`, `unitId`, `signalId`. These are ids: the server looks the names up itself, and an id it does not find in the project is left out.

Body of an objective: `objective`, `scenarioId` (required: an option is added to a scenario), `horizon` and `activity` (the page's own, so that the test answers what Run would show), `run`.

Body of a decision: `exchangeId` and `step`, nothing else. The figures are copied by the server from its journal.

Body of a prepared response: `exchangeId`, `step`, `signalTypeId`, and if needed `label` (what it is called) and `approver` (who can approve it, in words). No figure: the server copies them from its journal, as for a decision. Body of an engagement: `responseId`, and `note` if needed.

Body of an event search: `request`, and `scenarioId` (or `null`), which only tells the journal where the request was made from. Neither the run nor anything from the twin is part of it.

Body of an investigation: `unitId`, `metric`, `from` and `to` (two instants), `request` (the sentence, the only thing that goes into a search) and `zone` (the clock days are counted on, the browser's; `null` for UTC). The span is 366 days at most.

Body of an acceptance: `exchangeId` (of a search or of an investigation), `candidate` (`c1`, `c2`…), `startsOn` and `endsOn` (or `null`). The title, the link and the passage are copied by the server from its journal.

Lines of the stream:

| `type` | Content |
|---|---|
| `status` | What is being done |
| `step` | A tool call: its number (`s1`, `s2`…), its input, its result or its refusal, and the record the tool kept for the screen if it keeps one. In an investigation, the steps the program does itself are numbered `p1`, `p2`… |
| `done` | The answer or the proposal, the figures removed, the steps, the model, the tokens, and `exchangeId`, the identifier of the exchange in the journal |
| `failed` | The model or the engine could not be reached, or the Claude account has no credit left; replaces `done` |
| `ping` | Nothing: keeps the connection open |

A request refused before it starts (no session, analyst off, simulation service not configured, invalid body) is an ordinary HTTP error, not a stream.

## The tools

None of them writes. Fourteen read. Two more exist only in the Options tab: `list_responses`, which reads what an option can contain as a recorded response, and `test_option`, which runs the engine. A third, `list_actions`, is offered there only in a project that declared action types. A tool a project switched off is offered nowhere. Two worlds: `reality`, the twin as it is; `scenario`, the same twin read through the open scenario.

To these tools of the code are added, in Ask and in Options, the reading tools the project declared itself: see “The function types”. They are not in the table below, since every project has its own; the “What it can use” tab lists them.

The Event finder tab is apart: it has none of these tools. It has only the API's web search (`web_search`), which runs at Anthropic and not with us, and its delivery tool. That is what guarantees a search can take nothing from the twin with it.

| Tool | What it reads |
|---|---|
| `describe_twin` | Overview: sites, activities and units, territories, the declared care and spread model, what the twin lacks. Apart from what it lacks, the units that have no capacity of their own because it is in their sub-units |
| `find_sites` | The sites, filtered by name, activity or territory, largest first |
| `get_site` | One site: place, units per activity, patients present, territories served, what the scenario changes there |
| `compare_catchments` | For an activity: each territory, its residents, its sites, its units per 1,000 residents |
| `scenario_recipe` | The scenario: starting conditions, events, choices (measures, capacity, a recorded response the run follows), modified links, comparison series |
| `list_prices` | The price list the twin declares: what a unit of an activity costs to open and to keep open for a day, in each mode, the delay of that mode, the sites a price holds for, and its source. A price with no source is called a demo price. The rows that could not be read as a price are given with their reason. Without a price list, the tool says so: nothing has a price, and nothing is free |
| `read_run` | The run on screen: digest of both passes, sites where people wait, one site day by day, the network day by day |
| `list_datasets` | The project's datasets and their columns |
| `preview_dataset` | The first rows of a dataset and the values of its category columns |
| `read_series` | A column read as a daily series: total, mean, extremes, values |
| `list_events` | The calendar: the validated events, their dates, their place, their gate, the source that published them and the passage quoted. When day 0 of the scenario has a date, each event is also placed on the days of the run |
| `list_alerts` | What is open now: the alerts, worst first, each with its unit, its measure and its value, since when it has been open, the age of the value, and the signal it raised with its stage. Also says how many alert rules exist and when the thresholds were last checked. For the whole project or for one unit |
| `unit_now` | The live figures of a unit, as its page shows them: each measure the organisation defined with the age of its own value, what stands under the unit by type, the age of the whole unit (or that it is unknown, and why), its open alerts; a measure says when it is a figure of the day before (`covers`), how a duration is written (`written_as`) and, when there is a reason, why it has no value (`no_value_because`) |
| `calculate` | A calculation, on numbers already read or given in the question |
| `list_responses` | Options tab only. The recorded responses an option can contain: those of the organisation's library (Events page) and those the engine writes itself, each under a name, with what its rules do and whether they declare a cost. With `routes_from`, the sites to which the patients waiting at a site can be transferred |
| `list_actions` | Options tab only, and only in a project that declared action types. The active types, each with what it changes, its bounds, the days before it can apply, who can approve it, and whether it can be tested on this twin |
| `test_option` | Options tab only. Adds an option to the open scenario, for the time of a run on the server, and returns the scenario as it is beside the scenario with the option, with what the engine counted as cost when a recorded response is in one of the two runs. When the twin declares a price list, it also returns what the list gives for the capacity opened: the total, the total by category, each line, what is unpriced, and the day each change is available |

A tool that cannot answer (unknown name, two sites for one name, no run on screen, a table that holds several series, an option that cannot be tested) says so with a reasoned refusal that the model reads. It never guesses.

**Live.** `list_alerts` and `unit_now` do not read the twin's export as the others do: they read what the screens read, the alert feed of the banner and the computation of the unit page ([Algorithms](/docs/product/algorithms), D9). That is deliberate. A unit's page adds up everything under it, its sub-units included; the export counts only what is attached to the unit itself, because that is what a run uses. For a ward with no sub-unit the two give the same figure; for a hospital that has wards, they do not. A person looking at a unit's page and asking the analyst has to be given that page's figure: `unit_now` gives it, rounded the way the page writes it, and `get_site` remains the engine's reading. The overview (`describe_twin`) keeps the same separation. An institution whose whole capacity is in its facilities has none of its own in a run: the tool puts it under “how_the_tree_is_built”, says that nothing is missing, and points to `unit_now` for the figure on its page. Only a unit under which nothing holds capacity is listed among the gaps. The three counts of sites (capacity of their own, capacity in their sub-units, no capacity under them) add up to the total. Three rules go with live reading: a value is never given without its age (exact, “at least”, or unknown with its reason); no open alert is not good news in itself (the tool says when the thresholds were checked, and whether no rule exists at all); and these tools read the present moment, not the past.

The digest of the run on screen is built by the page (`run-digest.ts`) with the functions the Result panel already reads: the analyst and the panel cannot diverge on a figure. The digest of a tested option is built by the server (`scenario-run.ts`), and a test holds the two together: [Algorithms](/docs/product/algorithms), section A4.

## The options

You state an objective: “nobody waits at this site any more”, “the fewest patient-days of waiting with at most 100 beds added”. The analyst reads the situation, proposes up to three options and runs each one through the engine before showing it.

An option is a label and one to four changes:

| Change | What it takes to test it |
|---|---|
| Capacity: units of an activity, at a site, from a given day (negative: units closed) | The site already offers that activity; you cannot close more than it has. When the price list prices that activity in several modes, the change says which one, and the day asked respects the delay of that mode |
| Measure: contact layers multiplied, in some territories, for a number of days | The twin declares those layers |
| Transfer: patients waiting at one site, sent to another, so many a day, from a given day | The twin holds a transfer route between the two sites, the destination offers the activity, and no more than twenty patients a day are asked for |
| Recorded response: a response of the organisation's library, or one of those the engine writes itself | It is named by the name `list_responses` gives it. A response of the engine holds for the whole run |
| Replace a choice of the scenario: the same capacity or the same measure, with other units, another day, another duration | The choice is named the way `scenario_recipe` names it; it is a capacity replaced by a capacity, or a measure by a measure |
| Remove a choice of the scenario | The choice is named |

“40 beds instead of the scenario's 60” is therefore a single stamp at +40: the test runs without the 60 and with the 40, and that is what the recipe holds once the option is applied. Only choices (measures, capacity, a recorded response) can be replaced or removed. Starting conditions and events are what happens: an option does not undo them.

**Price and delay.** When the twin declares a price list, a capacity an option opens has a cost: opening it, then keeping it open for the days of the run. If the list prices the activity in several modes (normal in fourteen days, rush in three at another price), the analyst can propose the same capacity sooner and dearer, or later and cheaper: those are two options, both tested. The decision is taken on day 0 of the run; asking for units before the end of their mode's delay is refused, with the first day possible. The tab's instructions forbid it to give a price the list does not hold: it says there is none. The detail, the cost ledger and its rules: [Algorithms](/docs/product/algorithms), A12.

A transfer and a recorded response are of another kind than the first two: they are not things placed on a given day, but rules the engine evaluates at every step of the run. A transfer of four patients a day from Lakeshore to Nord sends nobody as long as nobody waits at Lakeshore, nor when Nord is full. A run follows one response at a time: so an option holds either a recorded response, or transfers, which make one between them; and if the scenario already follows one, the option has to remove it to test another in its place.

### Two ways of asking “what if”, a single run

The product had two paths that did not know each other. Now that a recorded response can be a stamp of the scenario, the second can run what the first writes, through the same run as its other stamps, on the page as on the server.

| | Events page and replay of the units page | Scenarios page and analyst |
|---|---|---|
| What is varied | A response: rules the engine evaluates at every step, on a given event | Stamps: what happens on a given day (outbreak, heat wave, measure, capacity, starting conditions), and a recorded response |
| What this path can do and the other cannot | Write and edit a response: its conditions, its delay, its effectiveness, its cost. Compare several responses on one event and rank them on counts (deaths, care not delivered, cost), over several seeds. Vary the strength of a response (half, double). Branch: “what if we had acted on that day” | Spread an epidemic from the model the twin declares. Set starting conditions. Replace or remove a choice. Have the analyst propose and test options, with their levels of evidence. Record a decision and follow it. Keep a prepared response, retested when a signal opens |
| What it still cannot do | Start from a scenario made of stamps. Record a decision. Keep a prepared response ([issue 22](https://github.com/V1ktor7/obscyro/issues/22)) | Follow more than one response in a run. Write or edit the rules of a response, apart from the transfer between two sites. Make a response the engine writes itself start on a given day. Give a price to a measure, or to a transfer ([issue 39](https://github.com/V1ktor7/obscyro/issues/39)). Run several seeds |

What the two have in common: the engine, the shape of a response (rules, with delay, effectiveness and cost), and the marking of a dominated option, made by the same function.

What comes from the model and what does not:

| On screen | Where it comes from |
|---|---|
| The figures on the cards: peak, sites with a queue, patient-days of waiting, first day of a queue, for the scenario as it is and for each option. The bar and the squares draw them; they add nothing | The engine's runs, read from the record of each test. Never from a sentence |
| The gap between an option and the scenario as it is (“−7,049 vs as it is”) | The program: the subtraction of the two figures shown, rounded, so it can be redone in your head |
| The count “2 measured · 1 published · 3 assumption” of a card | The program: it counts the items of the list per level. The three levels are never added together |
| The level of evidence of each item: Measured, Published, Assumption | The program, from where the item comes from (twin, scenario, option, a rule of the engine) |
| The stamps that “Add to scenario” adds | The test: they are the ones the engine received. A recorded response is one of them, with its rules |
| “Cost counted: 7,500 $” on a card, or the sentence that says why nothing is counted | The engine: the cost each rule of the response declares, each time it fired in this run. Without a price list, a capacity and a measure have no price: the card then says that the count is not the whole cost, or that there is none. Those amounts have no source: the card carries “demo price” |
| “Cost 1,472,000 $”, with its range, on a card; on a click, its lines | The ledger, from the twin's price list: each line writes its arithmetic (units × days × price), its mode, whether the price is the site's own, and its source. The total is the sum of the lines, in whole cents. What the list does not price is written under “Not priced”, with the reason |
| “Delay”: “Open from day 14”, the mode and its delay | The program, from the mode settled at the test and the delay the list gives it. The decision is taken on day 0 of the run |
| “demo price” | The program: at least one price behind this amount has no source. On the total, and on each line concerned |
| “Dominated”, with the name of another option | The program, from the two runs: the other costs as much or less and leaves as much or less waiting. Only between options whose cost is whole |
| “Not beaten” | The program, when a price list is on screen: among the options whose cost is whole, no other does at least as well on waiting and on cost at once. Several options can carry it |
| “What it does to the scenario”: what the option adds, replaces and removes, when it does more than add | The program, from the stamps. The button then reads “Apply to scenario” |
| The mechanism in one sentence, what the test does not say, the reading, the trade-offs, the limits | The model, every figure checked by the verifier |

What the tab does not do, by construction: rank the options (they stay in the order of the tests, and no card is marked as the best), list one that was not tested, hide one that was, write to the scenario. Trade-offs of values are presented apart, under “Yours to weigh”. One thing only is said of an option against another: that it is dominated, when the other costs as much or less and leaves as much or less waiting. That stays true whatever value one gives a patient-day of waiting, so it is not a trade-off; between two options neither of which dominates the other, the tab does not choose. With a price list, it only marks those no other beats (“Not beaten”), which can be several: the faster and dearer one, the slower and cheaper one. No score mixes waiting and money.

Cost and duration are bounded: three tests at most per objective, and the scenario as it is runs only once for the three, in a single pass of the engine. Three options make four passes. During a test, the tab says how long it has been running.

## The action types

What the analyst may propose is set in the Studio, under **Ontology › Action types**. The full diagram is in [Algorithms](/docs/product/algorithms), section A14.

An action type says, in the institution's words:

| What it says | Example |
|---|---|
| Its name | “Open overflow beds” |
| What it changes, among the four things a run can be made to change | Capacity |
| On what, and within what bounds | The activity “lit”, from 10 to 60 units, at Lakeshore and Nord only |
| In how long | Two days before it can apply, counted from the decision |
| Who can approve it | “The director of nursing” |
| Whether it is on | Switched off, it is no longer proposed |

The four things a run can be made to change, and what a type can bound in each:

| Effect | Bounds |
|---|---|
| Capacity | The activity; a range of units (negative: units closed); the sites; the mode of the price list the units are opened in |
| Measure | The contact layers, with the range of their factor; the number of days at most; the catchments |
| Transfer | The patients a day at most; the sites of departure; the sites of arrival |
| Recorded response | The responses allowed |

A bound left empty is not a bound at zero: nothing limits on that side. Nothing is typed by its name: the activity, the layers, the sites, the catchments, the modes and the responses are picked from what the twin declares.

**The four built-in types.** Every project starts with one type per effect, unbounded and on: what the analyst could already propose. As long as a project changes none and adds none, the analyst works exactly as before: same instructions, same tools, same options. To stop a kind of change from being proposed at all, its built-in type is switched off. To bound it, it is changed, or a type of the project's own is added.

**What it changes for the analyst**, once a project declared something:

- it reads the list before proposing (`list_actions`), with the bounds, the delay and the approver of each type;
- each change of an option says which type it falls under. Out of bounds, the test is refused before it runs, with the bound that was passed, and the proposal is not shown;
- an idea no type covers is not an option: it goes in the limits of the answer, with the mention that no action type of the project covers it;
- a type the twin does not let it test (an activity no site provides, a layer it does not declare) is said as such, on screen and to the analyst, with what is missing.

On an option's card, “Action type” gives the type's name and “can be approved by …”. It is kept with the decision. The screen says who *can* approve: nobody approves in the product, and applying the option stays a click of the person.

The price and the delay of capacity always come from the twin's price list. An action type has no price of its own; it can only fix the mode in which its units are opened.

**Switching a tool off.** Under the list of types, the same page shows the analyst's tools, with what each reads and where it is offered. The tools of the code stay code: they can neither be rewritten nor removed from the Studio. One can be switched off, and the analyst then no longer has it at hand. A reading tool the project declared is switched on and off where it is declared, under Functions. With the web search off, the Event finder tab and the investigation refuse to start and say why. Three tools cannot be switched off, and the page says why: `calculate`, `test_option` and `list_actions`.

## The function types

What the analyst can read, beyond the tools of the code, is declared in the Studio, under **Ontology › Functions**. A function type is a reading tool of the project. The full diagram is in [Algorithms](/docs/product/algorithms), section A15.

It is not code. One picks one of five blocks, and sets it:

| Block | What it reads | Example |
|---|---|---|
| Count or total (`aggregate`) | A count, a sum, a mean, a minimum or a maximum over the objects of a type, in one value or by group: a property, the unit each object is attached to, or its site | The ventilators whose status is “available”, by site |
| List of objects (`objects`) | The objects of a type, filtered, with the properties to return | The first twenty ventilators in maintenance, with their model |
| Formula (`formula`) | A calculation over named counts and totals | `round(closed / (closed + staffed) * 100, 1)` |
| History of a measure (`history`) | The readings the twin kept of a measure at a unit, over a window | The occupancy of a unit over the last 72 hours |
| Rows of a dataset (`dataset`) | Columns of a dataset of the project, filtered | The admissions by day, for one region |

A function type also says:

| What it says | What it is for |
|---|---|
| Its name, in the institution's words | It is what the trace of an answer shows. The tool's name is made from it (`ventilators_available_by_site`) and no longer changes |
| What it reads, and when to use it | The analyst decides to call it from that sentence |
| Its inputs, six at most | A text, a number with its bounds, a date, or one value among a list. An input can feed a filter, the group of a count, the unit or the window of a history |
| The name of each value returned | A result carries its units in its names: `flow_litres_per_minute`, not `flow` |
| Whether it is on | Off, it is no longer offered to the analyst. It can still be tried |

Nothing is typed by its name: the object type and its properties, the measure, the dataset and its columns are picked from what the project holds.

**Trying before trusting.** “Try” runs the tool once, with the inputs it is given, and shows what the analyst would read: the result, or the sentence of the refusal. No model is called and nothing is kept.

**What it changes for the analyst.** A tool that is on is offered to it from the next exchange, in Ask and in Options, beside the tools of the code. It uses it the same way, and the rule of numbers is the same: a figure the tool did not return is taken out of the answer. In the trace, the step carries the project's label, followed by “(declared in this project)”. A project that declared no function type works exactly as before.

**What a declared tool says of itself.** Where what it returns comes from (the objects of a type, a formula, the kept readings, a dataset); how many objects it read and how many it lists; and when a read reached its ceiling, that the result rests on the first objects and not on all. A count by unit places each object at the unit it is attached to, not at the units above, and says so.

**What it refuses**, in a sentence the analyst reads: an input outside its bounds, with the bound; a unit it does not find; a measure whose history the twin does not keep; a column the dataset does not have; a formula with a value missing (nothing stands in for it); a result too long to be read at once, with what to narrow.

**What it lacks to run** is written on its card: an object type the ontology does not have, a property the type does not declare, a measure that is not kept, a dataset that is absent. It is not a refusal at declaration: a tool can be declared before its data arrives.

A declared tool only reads. For what the analyst may **propose**, see “The action types”.

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

## The investigations

On the network map, one sees that a unit is doing badly: its measure went past its threshold, twice this week. The **Investigate** tab of the “Analyst” panel of the Network page answers the question that follows: what was going on around it? It searches official sources for events, then sets each one beside the series the twin kept at that unit. The full diagram is in [Algorithms](/docs/product/algorithms), section A13.

One selects a site on the map, the measure the map paints, and a span (24 h, 72 h, 7 days, 30 days, the same as the timeline's). The tab proposes a sentence, which names the unit and the two dates. One reads it, changes it if one wishes, and clicks “Investigate this span”.

Two things then work, and the screen shows both while they work:

| Who | What it does | Its steps |
|---|---|---|
| The program | Reads the series kept over the span, marks in it the episodes where the measure was beyond its alert threshold, reads the calendar of validated events and the three nearest units that report the same measure. At the end, sets each event beside the series | `p1`, `p2`, … |
| The model | Searches the allowed sources for events, exactly as the Event finder tab does, from the sentence and nothing else | `s1`, `s2`, … |

What each event found carries, and where it comes from:

| On screen | Where it comes from |
|---|---|
| The title, the link, the quotation, the dates, the door: level “Published” | The search, checked as in Event finder (see “The events”) |
| “Goes with episode 2: it starts 2 days before.” | The program: the event starts at most 7 days before the episode, or during it |
| The means of the 3 days before and of the 3 days from its start, and the change: level “Measured” | The program, on the readings kept; each mean says how many days it rests on |
| “Reasons to doubt” | The program: no date, outside the span, no reading before or after, the episode had already begun, other events go with the same episode |
| “What this cannot say” | The program, then the limits the search wrote |

Three rules hold the whole tab.

- **Only the sentence goes into a search.** The series, the threshold, the calendar and the neighbours are read by the server and enter no message to the model. The proposed sentence names the unit and the dates, none of its figures; the step “What goes to the web” writes it in the trace before the search leaves.
- **What is brought together coincides, and nothing more.** An event is published, an episode is measured; that they have anything to do with each other is a supposition. The screen writes “goes with”, never “caused”, and the first limit of every investigation says it again.
- **An episode is counted against a threshold that exists.** It is that of the least severe alert rule on this measure at this unit. Without a rule there is no episode: each event is set beside the means of the days around it, and the tab says so.

While it works, a bar of seven segments says where things stand (series, calendar, neighbours, searches, passages, comparison, check), a line says what is under way and for how long, and the trace is open: the steps are written into it one by one. Nothing is animated that did not happen, and an investigation that has ended names what it did not reach: a search that cited no passage ends at six pieces out of seven, “not reached: passages”.

**Accept into the calendar** brings a candidate into the calendar, as in Event finder; **Reject** sends nothing. The events already in the calendar for those days are set beside the series in the same way, under “Already in the calendar for this span”.

Every investigation is kept in the journal, steps included. “Kept in the journal” lists those of the selected unit; a click reopens one as it was delivered, with nothing recomputed, and a candidate can still be accepted from it.

When an investigation is on screen, the timeline at the bottom draws it: the series as a staircase, its episodes as bands, each event as a mark at the day its source dates it (dashed for a candidate, solid for an event of the calendar).

No series, no search: if nothing was kept of this measure over the span, the investigation stops at its first step, costs nothing, and says which day the history starts.

An investigation costs what its search costs (see “What a search costs”): the program's reads call no model.

## The decisions

“Record decision” keeps the option retained with what is expected of it. The browser sends only the identifier of the exchange and the step of the test; the server copies everything else from its journal: the objective, the stamps, the figures of the tested run with and without the option, the arrivals day by day, the levels of evidence, the source steps. So only an option the engine tested can be recorded.

A decision can bear on a recorded response or on a transfer: it keeps its rules, as the engine received them, and what the run counted as cost. The Decisions tab writes it under the expected figures. When the cost comes from the price list, the decision keeps the whole ledger: the lines, the price of each, its source or the demo mention, the mode and the day the units were to be open. A price corrected later does not change what it shows.

A decision cannot be edited: revising it means recording another one.

The follow-up (“Compare with observed”) exists when an observed series is linked to the scenario, through the “Reality check” setting of the Result panel. It sets the arrivals the tested run expected beside those that were counted, and gives the gap: totals over the days both report, average gap per day, offset of the peaks. It does not conclude. And it compares arrivals only: the twin keeps the readings of its own measures, but those are not the queue or the occupancy the engine counts, and nothing sets them beside a run yet. So the expected queue has nothing observed to face it, which the screen says. A decision taken on a signal has a second follow-up, on that signal's situation card: the measure that raised the signal, as the twin wrote it down since the decision, beside what the run gave ([Algorithms](/docs/product/algorithms), A9).

### Prepared responses, and “Engage”

In an emergency nobody builds a scenario: what was prepared is applied. So the work is done in two stages.

**In calm time.** Under each tested option, “Keep as a prepared response for…” keeps it for a kind of signal. You choose the kind, and if needed who can approve it, in words (a role). Nothing else is sent: the server copies the figures of the test from its journal, with its date and a mark of the choices of the scenario it ran on. A prepared response is therefore always an option the engine really tested. The button refuses when the scenario has changed since the tests: the figures would be those of another scenario.

**Live.** The situation card of a signal shows the responses prepared for its kind, in the order they were kept, with no ranking. Each says: what it changes; the run with it beside the same run without it; what that run rests on, counted by level of evidence; what its test does not say; and what that test is worth today. Three things can be known without running anything again, and each is written above the button, before the click: the scenario of the test no longer exists, its choices have changed since, or the test is more than thirty days old. None says the response is bad; they say what the figures are figures of.

**The retest.** As soon as a signal opens, the server runs every response prepared for its kind through the engine again, on the network as it is: the twin read at that instant, and the scenario with its choices of today. Nobody asks for it, and no language model takes part. The card first shows the last test known, with its date, and says that a test is waiting its turn or running. When it finishes, its two runs take the place of those of the kept test, and the line above says when it ran (“Tested on the current state 40 s ago”); what the kept test gave stays written below, in one line. Meanwhile the card reads itself again every five seconds instead of thirty: the result arrives without a click.

A retest takes about one minute on the Montréal twin. The cost is bounded. One run at a time per project. No new run while the state has not changed: the card then says that the state was found unchanged, and when. And a limit of three minutes, after which the test is abandoned. A test that is queued, running, abandoned or failed is never shown as a result: the card says what became of it and why, and keeps the figures of the last test known. An unreachable engine blocks neither the card nor “Engage”. After fifteen minutes, a retest is no longer called a test “of the current state”: the card writes how old it is, and flags it before the click. The retest starts when a signal opens, not for as long as the card stays open. The detail: [Algorithms](/docs/product/algorithms), A11.

“Engage” makes three writes in one click: a decision, tied to the signal, with the figures of the kept test as what is expected of it and, when the card showed a retest, its figures beside them with their date; a line on the signal's trail, naming the response and the person; and the move of the signal to its next stage. If that stage requires an approval, the person engaging is the one recorded as having given it. Every refusal comes before the first write: a closed signal, a signal at its last stage, a response prepared for another kind of signal. Nothing is triggered in any other system: Obscyro records and follows, and the screen says so.

The decision reads back in three places: on the card, among the decisions already taken on this kind of signal; in the signal's trail, on the Response page; and in the Decisions tab, where it carries the name of the signal.

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

Each exchange is kept in `app.analyst_exchange` (migration 059): the question or the objective, the world looked at, each step with its input, its result and its record, what was shown, the figures removed, the model and the tokens. The `kind` column says whether it is a question (`ask`), an objective (`options`, migration 060) an event search (`events`, migration 062) or an investigation (`investigation`, migration 069). For a search, the world looked at is `web`, and the steps are the queries, the pages returned and the passages quoted. An investigation also keeps the program's steps, among them the series read, in the record of its first step: that is what lets it be read again as it was delivered. Nothing is modified after insertion.

Tokens are kept request by request (`usage.byRequest`) and per price: what was read at full price (`input`), what was written to the cache (`cacheWrite`), what was read back from the cache (`cacheRead`), what was written by the model (`output`), and the web searches launched in the request. An exchange costs little or a lot depending on the share of each request that is read back from the cache: that is what this detail makes it possible to check afterwards, instead of assuming it. The total shown on screen remains the sum of all tokens, whatever their price.

The identifier of the row is chosen before the exchange and leaves with the `done` line of the stream. That is what allows a decision to be recorded from a test: if the write to the journal failed, the decision is refused and the test has to be run again.

Decisions are in `app.decision` (migration 061). Accepted events are in `app.health_event`, and a project's authorised sources in `app.project_web_source` (migration 062).

## The screen

`AnalystPanel.tsx`, in an `OverlayPanel` under “Layers”, folded on arrival. Four tabs, in the order of the loop, then “What it can use”; each is built only when first opened, then keeps what was done in it.

**Event finder** (`EventFinderTab.tsx`), top to bottom: the request, and suggested requests on the scenario's dates, where the place remains to be written; the sources searched and the means to change them; the searches, shown while they run; a banner that says whether everything was found in the passages; one card per candidate (gate, “Published” level, WEB chip, title, place, quotation and link, the passages it rests on, which open the step where the passage reads in full, dates to correct, Accept, Reject); what was not found; the limits; the steps. A rejected candidate folds into one line, with the means to come back to it: the rejection wrote nothing anywhere.

**Context** (`ContextLane.tsx`) is not in the panel but in the timeline: the lane of validated events, above the stamp lanes. A click on an event opens it: source, quotation, who accepted it, and the means to remove it.

**Options** (`OptionsTab.tsx`), top to bottom: what the options are tested on; the objective, and objectives suggested from the run on screen; the tests, shown while they run, with the duration of what is in progress; the card of the scenario as it is, with a dashed border; one card per option; the reading; the trade-offs left to the person; the limits; what every option rests on; the steps. A banner says when the scenario is no longer the one that was tested, and why: an option added from the tab, several added together, or an edit made elsewhere.

An option's card reads at a glance and explains itself on a click (`option-cards.tsx`). At the top: its letter, its label, and what the run comes to in three words (“Nobody waits”, or “4 sites with a queue”). Then its figures, drawn:

- the patient-days of waiting, with the gap from the scenario as it is, and a bar. Every bar in the tab is on the same scale, that of the longest wait, and a tick on it marks the scenario as it is: two options are compared without reading a figure;
- the sites with a queue, “3 of 34”, and a square per site, red when it has a queue. Beyond 60 sites, the squares become a share of a bar;
- the peak occupancy and its day, the first day somebody waits, and the waiting where no site serves when the scenario has some.

When the twin declares a price list, two blocks follow the figures. “Delay”: for each priced capacity, the first day its units are open, its mode, and the days that mode takes from the decision. “Cost”: the total, its range when a price declares one, the “demo price” mark when a price has no source, and the number of lines. A click on “Cost” opens the lines: for each, what it prices (opening, running, formula), the site, the days, the mode, its arithmetic written out, and its source; then the total of the list, and what is unpriced with the reason. Under the cost, “Not beaten” or “Dominated” when the option could be weighed.

Under the figures, three folded lines, which open on a click: “Why this option” (the mechanism, what the option replaces or removes, and the step that tested it), “What it rests on” (each item with its level of evidence; the count per level reads without opening), “What this test does not say”. A line whose text lost a figure opens by itself: a removal is not hidden behind a click. At the bottom, “Add to scenario” (or “Apply to scenario”) and “Record decision”.

**Decisions** (`DecisionsTab.tsx`): the decisions of the open scenario first, then those of the project's other scenarios. Each is a card of the same design: who took it, when, the objective, the figures expected with the option (the gap is given against the same run without it), the delay and the cost kept with their lines when there were any, then, folded, what was expected without the option, the mechanism, what it rested on, what the test did not say. The follow-up is asked for with a button. The tab reads even when the analyst is off: a decision is a record, not an answer.

**What it can use** (`ToolsTab.tsx`): what the analyst has at hand. The tools are filed by what they read (the twin, the scenario and its run, the network now, the datasets, the calendar, calculation, the options, the web), then those the project declared. Each carries its name, a sentence, what it does (“Reads”, “Computes”, “Runs the engine”, “Searches”), and “Declared here” when it was declared in the project rather than written in the code. A tool the project switched off is shown as switched off, not hidden: “it could, and was told not to” is not “it cannot”. A click on a tool says what it is given and in which tabs it is used; a tool used elsewhere than in the open panel says so, and a declared tool says where it is switched on and off. Under the list, what the analyst never does: write, compute in its head, read anything about a person. The tab is read without the model, and the same list heads the “Functions” view of the ontology.

**Ask**, top to bottom:

- what it will read (the scenario or reality, and the run if there is one);
- the question, and questions suggested from what is on screen;
- the steps, which arrive while it reads;
- the answer: a green banner when every figure is traced, an orange one with their number when some were removed; under each paragraph, the chips of the steps cited, which open the step, and, when the paragraph relies on events of the calendar, one WEB chip per event with its link and the “Published” level;
- what is assumed, what the answer cannot say;
- the sites the answer talks about, which point the map at them;
- the questions to ask next.

**The action types** (`manager/ActionTypes.tsx`, under Ontology › Action types). At the top, a sentence that says whether the project declared its types or the four built-in ones stand. Then a card per type: its name, what it changes, where it comes from (built-in, built-in and changed here, or the project's), its key, its bounds in words, who can approve it, a switch, “Edit”, and “Remove” or “Reset”. A type the twin does not let the analyst test carries a banner with what is missing. The form offers only what the twin declares, and says what to correct before sending. Under the list, “What the analyst can use”: one line per tool, with its switch.

**The function types** (`manager/FunctionTypes.tsx`, under Ontology › Functions, between the list of tools and the cost formulas). At the top, a sentence that says what a function type is, and “Declare a tool”. Then a card per declared tool: its label, its block, the name the analyst calls it by, its description, a sentence that says again what it reads (“Counts the Ventilator where status is “available”, by site.”), what it is given, a switch, “Try”, “Edit” and “Remove”. A tool that cannot run on this project carries a banner with what is missing; a kept row that can no longer be read is named above the list. The form changes with the block and offers only what the project holds: its object types and their properties, the measures the twin keeps, its datasets and their columns. It says what to correct before sending, and shows the server's sentence when the server refuses. “Try” opens under the card one box per input and “Run it once”: the result is shown as the analyst would read it, with its duration, or the sentence of the refusal. Declaring, changing or removing a tool reads again the “What the analyst can use” list above.

**On the network map** (`command/NetworkAnalyst.tsx`). An “Analyst” `OverlayPanel` in the right column, under the inspector of the selected site, folded on arrival. Opening it folds the inspector. Two tabs: **Ask**, the same as everywhere else, with the selected unit; **Investigate** (`InvestigateTab.tsx`); and “What it can use”, the same as on the Scenarios page. The panel is built only when first opened, then keeps what was done in it when it is folded or the other tab is shown: an investigation under way goes on. From top to bottom, Investigate shows: the unit, the measure and the span; the sentence, under “The only thing that goes to the web”; the button; the investigations already kept for this unit; then, once started, the progress bar, what is under way, what the program read of the series, the candidates in two lines each (the title, then the date and the sentence that says how the event sits), the events already in the calendar, what the investigation cannot say, and the trace. A click on a candidate opens it: what is published, what is measured, the reasons to doubt, the dates and the two buttons. The timeline at the bottom (`NetworkTimeline.tsx`) draws what the investigation found. The “Analyst” button of the shell is not shown on this page.

**Elsewhere than on the scenario map** (`AnalystDock.tsx`). The Studio's shell carries an “Analyst” button, at the bottom right of every page. It opens the Ask tab alone, on the network as it stands now. The question goes with what the person has in front of them: the page, and the unit selected on Units or the signal open on Response. The suggested questions follow: “What is open right now, and where?”, plus one about the unit or the signal when there is one. The panel keeps what was asked when it is closed and opened again. Two pages do not have this button, because they already hold the analyst where the work is done: Scenarios, whose panel also has the scenario, the run and the options, and the situation card.

**The situation card** (`situation/SituationView.tsx`, at the address `/studio/situation`). It opens with “Situation”: on an alert, in the list at the top right and in the banner; on a signal, in Response; on a unit, in its sheet on the Units page. From top to bottom:

- the unit, and where it sits in the tree;
- the time of the reading, when the thresholds were checked, and how many alert rules the project has (with no rule at all, the card says nothing can open);
- the alert the card was opened from, with its value, since when it has been open and the age of the value; or the mention that it is no longer open;
- the unit's live figures, as its page shows them, each with the age of its own value, then the age of the unit's oldest source (“Oldest source under this unit”) with its reason when it is not exact, and what stands under the unit by type;
- the unit's other open alerts;
- the signal, and the path of its workflow with the stage it stands at;
- the responses prepared for the signal's kind, with the figures of their last test and what it is worth today, the retest of each on the current state, and the “Engage” button (see “Prepared responses”);
- the decisions already taken on signals of this kind, with what was expected of them;
- the analyst, with a question already written from the unit and the alert. It is not sent: asking it is the person's click;
- what the card cannot say.

The card reads itself again every thirty seconds, and every five seconds while a prepared response is being retested. If a reading fails, the last one stays on screen, said to be no longer up to date. Everything above the analyst reads without it: when it is switched off, the card is whole and says so.

The original mock-up is `design/scenario-analyst.html`.

## Adding a tool

A reading tool that fits in one of the five blocks (a count or a total over objects, a list of objects, a formula, the history of a measure, rows of a dataset) is declared from the Studio, without code: see “The function types”. What follows is for a tool that needs new logic, or that has to read something else.

1. Write it in `backend/src/services/analyst-tools.ts`: a name, a description for the model, an input schema, a validation, a pure function that reads. Add it to `READ_TOOLS`. A tool that only serves the options goes in `analyst-options.ts` and in `OPTION_TOOLS`.
2. It reads, it does not write. If it has to propose a write, validation remains a human click on screen. If it has to return more than the model needs to read (day-by-day series, what is needed to act), it returns a `Recorded`: the result goes to the model, the record to the screen and to the journal.
3. Its results name things the way the twin names them, and carry their units in the field names (`occupancy_pct`, `units_per_1000_residents`).
4. A case it cannot handle throws a `ToolError` that says what to do instead.
5. Give it a readable label in `stepLabel` (`frontend/app/studio/analyst-api.ts`). A tool declared in a project does not need one: its step carries the label the project gave it.
6. Test it in `analyst-tools.unit.test.ts`.
7. Write its sentence for the “Action types” page (`READS` in `analyst-settings.ts`): a test fails as long as it is missing.
8. Update the table of tools above, and diagram A1 if the loop changes.

## The reference questions

The analyst is a language model: “it worked when I tried” is not a test. The same question can be answered well one day and badly the next, after a change to its instructions or to the description of a tool. Twenty reference questions, on the Montréal twin and the Omicron scenario fitted to INSPQ data, say what a good answer must contain.

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
- Three questions are about live reading, where a model is most tempted to reassure. `open-now`: nothing is open, but the reference project has no alert rule, and a good answer says so instead of concluding that all is well. `unit-now`: the figure of the unit's page, with an unknown age said as unknown. `no-history`: “what changed since this morning” has no answer from it, because none of its tools reads the readings the twin keeps; a good answer says so without inferring a change from a single reading.
- The script exits with an error as soon as a question fails: it can serve as a guard before changing the instructions or a tool.
- The expected facts are in the code (`QUESTIONS`). When the twin or the scenario changes, it is the question that gets corrected.

**Code.** `backend/src/services/analyst-eval.ts` (the questions, the judging, the reading of a stream), `backend/scripts/analyst-eval.ts` (the replay), `serverRun` in `backend/src/services/scenario-run.ts` and the route `POST /v1/ontology/:env/analyst/run` in `backend/src/routes/analyst.ts` (the run done by the server). **Tests.** `analyst-eval.unit.test.ts`, `scenario-run.unit.test.ts`, `routes/analyst.unit.test.ts`.

## Known limits

- Each question, each objective is independent: the analyst does not remember the previous one.
- The bounds of an action type hold the analyst, not a person: a stamp placed by hand on the map is not subject to them.
- The approver of an action type is a text. Nothing in the product waits for their agreement: the screen says who can approve, not that somebody did.
- The bounds apply to one change, not to a total: two options of sixty beds make a hundred and twenty. And capacity lasts until the end of the run: a type does not bound its duration.
- An action type names only what a run can be made to change. Recalling staff or ordering a stock cannot be declared: the twin does not hold them.
- A tool declared from the Studio fits in one of five blocks. A read that needs new logic stays a tool of the code. A tool that writes cannot be declared: what the analyst may propose is set by the action types.
- A filter of a declared tool knows only equality: neither “greater than”, nor a period between two dates. A count is grouped by one thing only, and by unit an object is not carried up to the units above.
- A declared tool reads the twin as it is, never through the open scenario, and is offered neither in Event finder nor in an investigation.
- The product does not know of a property that it describes a person. The twin is made of objects of the network and aggregated values; it is the person who declares a tool who chooses what it returns.
- It searches online only in the Event finder tab and in an investigation. In Ask and Options it reads the events already validated, and says when none covers the moment asked about.
- An investigation brings dates together, it does not measure an effect. It says an event starts two days before an episode, not that it caused it, and it does not separate the share of two events that go with the same episode. A pairing seen once is not replicated.
- An investigation does not know whether an event concerns the unit: an event's place is a text, linked to no territory. The person judges it, from the source.
- An investigation has episodes only if an alert rule covers the measure at that unit. What is usual for a unit at a given hour is not computed.
- An investigation reads only what the twin kept, and the history starts the day the recording started: over an older span there is no series, and no search is made.
- The Investigate tab is offered only for a site that counts a single unit and for a measure the organisation defined: those are the only series kept.
- A search sees only what the authorised sources publish and what the API's search engine retained of it. An event absent from the candidates is not an event that did not happen.
- The server holds of a web page only the quoted passage, 150 characters at most. A date the page gives elsewhere than in that passage stays empty: the source has to be opened and the date entered.
- What is verified about a candidate: its link, its quotation, its dates. Whether the passage really says what the title takes from it, and whether the gate is the right one, is for the person to judge when accepting.
- The title, the place and the gate of a candidate cannot be corrected on screen: only the dates can. A badly titled candidate is rejected.
- An event has only a place written in words. It is tied to no territory of the twin, and the engine does not receive it: it is a marker for reading a run, not an input of the run.
- The validated events are the project's, not a scenario's: every scenario of the project sees the same calendar.
- An event search costs about 70 cents: each search launched returns ten pages, close to 15,000 tokens, and no setting of the API lets you ask for fewer without giving up the cap on searches. See “What a search costs”.
- The reference questions judge the Ask tab only. On `claude-haiku-5-5`, the Options tab has been tried on a single objective (three options tested, among them a transfer of patients and two recorded responses), and the search for events has not; `claude-sonnet-5-5` has not been tried anywhere.
- The twin holds no staff and no stocks: the analyst says so, it does not fill the gap.
- The twin keeps the readings of its measures since the day the recording started ([Algorithms](/docs/product/algorithms), D11), and a unit's page shows them. No tool of the code reads them in Ask: so without a declared tool the analyst cannot say what was open earlier, or what changed since this morning, and it says so. A project can give it that read by declaring a function type of the `history` block, for a measure the organisation defined. In an investigation, it is the program that reads the readings, not the model.
- The age of an alert or of a measure is that of what the measure reads. The unit has its own too, the oldest of all its sources, which can be older than the age of one of its values: the analyst is given both, and must give with a figure the age of that figure. A date with no hour gives an age to the day.
- The open signals `list_alerts` counts include those whose alert has cleared: they can be far more numerous than the open alerts.
- The run on screen is not kept when the page is reloaded; Run has to be launched again. Nor are the tested options: what remains are the recorded decisions and the journal.
- An option is made of capacity, measures, transfers of patients or a recorded response. Staff, a stock, a new link between a site and a territory cannot be tested: the engine or the twin does not carry them. The analyst files them under the limits.
- A run follows a single recorded response. Two responses cannot be tested together, and a response the engine writes itself cannot start on a given day.
- A transfer can only be tested between two sites the twin links by a transfer route. The twin holds the flow of no route: the run gives each twenty patients a day, and that is an assumption.
- The two responses the engine writes itself watch a single activity, the first of the twin in alphabetical order among those that are space, whatever activity the run reads. `list_responses` says which.
- A cost exists only where a rule declares one, or where the twin's price list prices a capacity that is opened. A measure, a transfer written by the analyst, units that are closed and a capacity the list does not hold have no price: no option that contains one can be called dominated, dominating or “Not beaten”.
- The cost of an option is that of its choices: opening units, then keeping them open for the days of the run. It is not what the network costs to run, and it counts neither staff nor stocks, which the twin does not hold.
- A cost formula can name, besides the numbers of its row, only `units` and `days`. A transfer is not priced: the formula of an ambulance (a flat fee, so much a kilometre) has nothing to apply to as long as a transfer is not an operation the ledger prices ([issue 39](https://github.com/V1ktor7/obscyro/issues/39)).
- The amounts of the rules of a recorded response do not come from the price list and have no source: they are shown as demo prices, on the Options tab, the Events page and the replay of the units page.
- With a response that adds or moves units during the run, the island's occupancy is weighted by the usual capacity: the engine does not return the capacity of each day. The run says so.
- An option is tested on the scenario as it is at the time of the test. Adding one option then another gives a scenario no test covered: the screen warns, and the objective has to be stated again.
- An option can replace or remove a choice of the scenario, but not a starting condition or an event. Replacing a capacity by a measure is done in two changes of the same option: remove one, add the other.
- Applying an option that removes a choice is done in two writes, the new stamp then the removal of the old one, and not in a single operation. If the second fails, the recipe keeps both stamps: the screen shows it, and the removal is done by hand. If the stamp to remove is no longer there at the time of the click, nothing is written.
- The name of a choice (`choice-a`) holds for one exchange. A later question reads the recipe again and may give it another name.
- An objective takes a little under three minutes on the Montréal twin. One pass of the engine takes about thirty seconds there; the first test launches two (the scenario as it is, then the option) after reading the twin and computing the spread, the following ones a single pass. It is the engine that sets the duration: to go faster the engine has to be made faster, not the analyst.
- The follow-up of a decision compares arrivals only (see “The decisions”).
- A prepared response is kept from an option tested in the Options tab. A response written on the Events page cannot be kept yet: it has no journalled test to copy figures from.
- What is known of a kept test is limited to its date and the scenario it ran on. The scenario's mark is taken when the response is kept; that the twin itself has changed since (beds added or removed) does not show. Testing a response again on the state of the moment does not exist yet.
- Engaging makes three writes in a row, not a single operation: if the last one fails, the decision and its line on the trail exist, and the signal has not moved.
- A recorded decision cannot be deleted on screen.

## Files

| Role | File |
|---|---|
| Loop, closing of a question, `give_answer` | `backend/src/services/analyst.ts` |
| Live reading, `list_alerts`, `unit_now` | `backend/src/services/live-reading.ts` |
| Situation card | `backend/src/services/situation.ts`, `backend/src/routes/situation.ts`, `frontend/app/studio/situation/SituationView.tsx`, `situation-api.ts` |
| The analyst in the Studio's shell | `frontend/app/studio/AnalystDock.tsx` |
| Prepared responses, retest, “Engage” | `backend/src/services/prepared-responses.ts`, `backend/src/services/response-retest.ts`, `backend/src/routes/prepared-responses.ts`, `frontend/app/studio/simulation/hex/KeepPrepared.tsx`, `frontend/app/studio/situation/PreparedResponses.tsx`, `prepared-api.ts` |
| Reading tools, digest of the run | `backend/src/services/analyst-tools.ts` |
| The `test_option` tool, closing of an objective, `give_options` | `backend/src/services/analyst-options.ts` |
| The `list_responses` tool, recorded responses, the rule of a transfer | `backend/src/services/analyst-responses.ts` |
| The twin's price list, the cost ledger of an option, the `list_prices` tool | `backend/src/services/price-catalogue.ts`, `cost-ledger.ts`, `analyst-tools.ts` |
| The price list in the ontology: the “Functions” view, the prices of a type | `frontend/app/studio/manager/PriceList.tsx`, `price-list.ts` |
| Action types: declaration, bounds, checking a change | `backend/src/services/action-types.ts` |
| The `list_actions` tool, what the twin offers a type | `backend/src/services/analyst-actions.ts` |
| Tools a project switched off | `backend/src/services/analyst-settings.ts` |
| Routes of the action types and of the tools | `backend/src/routes/action-types.ts` |
| “Action types” view of the ontology | `frontend/app/studio/manager/ActionTypes.tsx`, `action-types.ts` |
| Function types: declaration, the five blocks, translation into a tool | `backend/src/services/function-types.ts` |
| What a declared tool reads from the database, where an object stands, the declared tools of an exchange | `backend/src/services/function-reads.ts` |
| Routes of the function types, and the trial of a tool | `backend/src/routes/function-types.ts` |
| “Functions” view of the ontology: declaring, correcting, switching off, trying | `frontend/app/studio/manager/FunctionTypes.tsx`, `function-types.ts` |
| “What it can use” tab | `frontend/app/studio/simulation/hex/ToolsTab.tsx` |
| Closing of an event search, `give_events` | `backend/src/services/analyst-events.ts` |
| Reading the web search: queries, pages, passages, dates, quotations | `backend/src/services/analyst-web.ts` |
| Investigating a series: the series, the episodes, the neighbours, the comparison | `backend/src/services/investigation.ts` |
| Investigations read again from the journal | `backend/src/services/investigation-journal.ts` |
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
| Journal, decisions, calendar | `backend/scripts/migrations/059_analyst_exchange.sql`, `060_analyst_exchange_kind.sql`, `061_decision.sql`, `062_health_event.sql`, `069_analyst_investigation.sql`, `070_action_type.sql` |
| Calls and labels on the screen side | `frontend/app/studio/analyst-api.ts` |
| Panel and Ask tab | `frontend/app/studio/simulation/hex/AnalystPanel.tsx` |
| Options and Decisions tabs | `frontend/app/studio/simulation/hex/OptionsTab.tsx`, `DecisionsTab.tsx` |
| Event finder tab | `frontend/app/studio/simulation/hex/EventFinderTab.tsx` |
| “What it can use” tab, and the same list in the Functions view | `frontend/app/studio/simulation/hex/ToolsTab.tsx` |
| Analyst panel of the network map, Investigate tab | `frontend/app/studio/command/NetworkAnalyst.tsx`, `InvestigateTab.tsx`, `investigation.ts` |
| Timeline of the network map: series, episodes, events | `frontend/app/studio/command/NetworkTimeline.tsx`, `series-lane.ts` |
| Context lane of the timeline | `frontend/app/studio/simulation/hex/ContextLane.tsx`, `context-lane.ts` |
| Parts shared by the tabs | `frontend/app/studio/simulation/hex/analyst-parts.tsx` |
| Card of an option or a decision: drawn figures, gap, levels of evidence, folded lines | `frontend/app/studio/simulation/hex/option-cards.tsx`, tests `option-cards.test.tsx` |
| Digest of the run | `frontend/app/studio/simulation/hex/run-digest.ts` |
