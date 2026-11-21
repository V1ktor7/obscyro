---
# The English of docs/changelog.md. When that page changes, bring this one up to date, then run `npm run docs:stamp`.
title: "Changelog"
description: "What changed in Obscyro, from the most recent to the oldest. Each entry says whether it is a new feature or a change."
source: "docs/changelog.md"
translatedFrom: "9ee2dbac13f5b891"
---

What changed in Obscyro, from the most recent to the oldest. Each entry says what it is:

- **New feature**: something the product did not do.
- **Change**: something it already did, and now does differently, better or faster. A fix is one.

An entry is written the day the change ships, in the same commit as the code. Since November 2026, every visible change has its own. The months before are summarised. The full detail, commit by commit, is in [the repository's history](https://github.com/V1ktor7/obscyro/commits/main).

## 21 November 2026

- **Change · Analyst.** In the Options tab, the cards follow the order in which the options were tested, even when the model lists them in another order.
- **Change · Analyst.** The analyst's Claude model is set by a variable of the API service (`ANALYST_MODEL`): Opus 5.5 as before when it is empty, or Sonnet 5.5 or Haiku 5.5, which cost less per question. An unknown value switches the analyst off, and the panel says why.
- **Change · Studio.** The twin arrives continuously again on the Units page, in the site view of the Network page, and in “Live metrics”. The browser was refusing this stream: the page showed “Live stream” for half a minute without receiving anything, then read the twin again every five seconds. The chip now writes “Connecting” until the stream has delivered something, and “Live stream” only after.
- **New feature · Analyst.** An option can contain a transfer of patients between two sites, or a recorded response: those of the Events page and those the engine writes itself. It is tested by the same run as capacity and measures. “Add to scenario” writes it into the recipe as a stamp, and Run then gives the figures of the test again.
- **New feature · Analyst.** In the Options tab, what the engine counted as cost is written on each card, and an option that costs as much or more than another for as much or more waiting is marked “Dominated”. Nothing else is ranked. A capacity and a measure have no price: the card says so in place of a figure.
- **Change · Studio.** The Units page is redone. The units are no longer a column of cards in no order: they are a list ranked on the measure chosen, the units in alert first. The counters at the top (“In alert”, “Reporting, no alert”, “No value”) are also the filters. The units that report nothing for the measure are folded away, and are never read as a zero. You find a unit by its name, without the accents, and you sort from highest to lowest, the reverse, or by name. A name reads in full. The unit's sheet stays beside the list instead of opening in a window: you compare by clicking from one line to the next. Detail: [the Units page](/docs/product/units-page).
- **New feature · Studio.** A “Tiles” view on the Units page: one square per unit that has a value, coloured by its distance from the alert threshold, to see the whole network at a glance.
- **New feature · Studio.** On the Units page, a twin that has a hierarchy unfolds: a click on a unit shows what it contains, and a folded unit says how many units under it are in alert.
- **Change · Studio.** On the Units page, “Measures” and “Alert thresholds” are buttons with their name, in place of two icons. “Seed demo” is now offered only on a project with no unit. “Ask the analyst”, in a unit's sheet, opens the analyst with that unit.
- **Change · Alerts.** The Response board shows first what needs somebody. The signals raised by an alert that cleared on its own, and that nobody has touched, are set apart in an “Alert cleared” tab, always counted next to the “Active” tab. A signal somebody has taken up stays on the board, marked “alert cleared” once its alert has cleared.
- **New feature · Alerts.** The signals set apart close in one go, by domain, with a required reason. Each signal's log keeps who closed them and why, and they are recorded as cleared on their own: neither resolved, nor false positives.
- **Change · Alerts.** An acknowledgement holds for as long as the condition holds. Before, an acknowledged alert was reopened five seconds later, with a new signal and a new banner. If the rule fires at a higher severity, it is a new alert.
- **Change · Alerts.** The counters by domain of the Response board are right past 500 signals: they are counted over all the open signals, no longer over the list displayed.

## 20 November 2026

- **New feature · Studio.** Prepared responses are retested on the current state. As soon as a signal opens, the engine runs every response prepared for its kind again on the network as it is, without anyone asking and without a language model. The situation card first shows the last test known with its date, then the new result in its place, with the time of the test (“Tested on the current state 40 s ago”). A test that is running or abandoned is never shown as a result, and an unreachable engine blocks neither the card nor “Engage”.
- **Change · Analyst.** In its overview of the twin, the analyst no longer says of an institution that it “carries no capacity” when that capacity is in its facilities. It tells two cases apart: a unit whose capacity is in its sub-units, which is the shape of the tree and not a gap, and a unit under which nothing holds any, which is one. For the first, it points to the figure the unit's page shows.
- **New feature · Studio.** Prepared responses. An option tested in Scenarios can be kept for a kind of signal (“Keep as a prepared response for…”). The situation card of a signal of that kind shows it with the figures of its test, its date, and a warning if the scenario has changed since. One click on “Engage” records the decision on the signal and moves it one stage forward. Nothing is triggered in any other system.
- **New feature · Studio.** A situation card opens in one click from an alert, a signal or a unit: the unit's live figures with their age, the alert, the stage of the signal, and a question already written for the analyst. It reads in full even when the analyst is switched off.
- **New feature · Analyst.** The analyst can be reached from every page of the Studio, through the “Analyst” button at the bottom right. The question goes with what you are looking at: the page, and the unit or the signal selected.
- **New feature · Analyst.** The analyst reads what is happening now. You can ask it what is open and where: it returns the alerts, the value of each and its age, and the stage of its signal. You can ask it for the live figures of a unit: it gives the ones its page shows.
- **Change · Analyst.** When the analyst's Claude account has no credit left, the screen says so, and says that an administrator has to add some. Before, it suggested trying again, which could change nothing.
- **Change · Site.** The “Core API” section is removed from the site's documentation: nine pages, one per endpoint of the terminology API. The endpoints still exist; their reference is the one the API serves itself, at `/documentation`.
- **New feature · Studio.** An “API keys” page in the Admin section. The key the browser uses is shown there in full, masked until you ask to see it, with a button to copy it. The other keys show how they start. You create a key there, which is shown once to be copied, and revoke one.
- **New feature · Site.** The product's documentation is on the site, under Docs: the decision loop, the Scenarios page, the analyst, the algorithms with their diagrams, and this changelog. They are the repository's pages, in English like the rest of the site. The French page in the repository remains the original: when it changes, a test points at the English page that has fallen behind.
- **Change · Site.** The public site takes the Studio's dark theme: home, feature pages, documentation, sign-in and account. The content does not change.
- **Change · Studio.** The whole Studio moves to a dark theme: a near-black ground, dark grey panels, a single blue, square corners. The pages of a section are tabs above the page, so the map keeps the full width. Maps have a dark ground and colour scales redrawn for it.
- **Change · Analyst.** In the Options tab, each tested option is a card that reads at a glance: the result in three words, a bar for the waiting, a square per site. The full explanation unfolds on a click. The Decisions tab takes the same design.
- **Change · Studio.** The Models page no longer shows its tabs twice.
- **New feature · Analyst.** An option can replace or remove a choice the scenario already holds, and not only add one. The button then reads “Apply to scenario”.
- **New feature · Analyst.** A reference question on the waiting per site of a run. Replaying the reference questions becomes a command, and the journal keeps what each request cost.
- **Change · Analyst.** The online search for events is faster: the searches of one request start together, and pages are no longer read again to deliver.

## 19 November 2026

- **New feature · Alerts.** An alert reaches every page of the Studio, with one click to its unit and to its signal.
- **Change · Alerts.** A screen that wakes up announces what opened while it was away. The age of a value says whether it is exact, a floor, or unknown. The “Signal” link of an old alert finds its signal again.

## 18 November 2026

- **Change · Scenarios.** Testing an option no longer reruns the “events only” pass: it is shorter, and its duration is measured.

## 17 November 2026

- **New feature · Scenarios.** The analyst: you ask a question about the network or about a run, it reads the twin with tools, and no figure passes without a source.
- **New feature · Scenarios.** The analyst proposes options, the engine tests each one, and the decision retained is recorded with what is expected of it.
- **New feature · Analyst.** Online search proposes events drawn from official sources; a person validates them. A candidate shows the passages it rests on.
- **New feature · Analyst.** Twelve reference questions, replayable against the real model.
- **New feature · Scenarios.** A three-step guide on the map, which reads where the page stands.
- **Change · Engine.** A drop in capacity has an effect and an end, and doing nothing no longer wins the ranking on price.
- **Change · Analyst.** A figure written beside the name of a site has to come from that site's line.
- **Change · Scenarios.** The guide fits a laptop without scrolling, and only the current step is detailed. The Options tab says why the scenario is no longer the one that was tested.

## 13 November 2026

- **New feature · Scenarios.** A scenario starts from a network that is already occupied, the beds added are used, and the result says where it breaks.
- **Change · Scenarios.** The results have their own panel, and a long panel scrolls. A territory with no hospital for the activity read is named, not hidden.

## 12 November 2026

- **New feature · Models.** The daily forecast loop: a series is forecast every day, and the forecast is compared with what happens.
- **New feature · Events.** An event is composed in sentences, from a catalogue of profiles. A curve written day by day reads in one line.
- **Change · Models.** A table without dates is refused, and a forecast loop can be deleted.
- **Change · Scenarios.** A twin read through a scenario keeps its hospitals.

## 11 November 2026

- **Change · Studio.** Maps take the whole page, and the panels float over them.

## 9 November 2026

- **New feature · Scenarios.** The hexagon map replaces the Compose and Outbreak screens: events and measures are placed on the map.
- **New feature · Spread.** Mixing between territories is declared per contact route, and a measure can target some territories only.

## 6 November 2026

- **New feature · Site.** The globe has its own screen, and each feature has its page.
- **Change · Site.** A clear offer, with no mention of a test phase.

## September 2026

- **New features.** The lab trains a model on a table, with its baseline, forecasts a series while saying what the forecast is worth, and offers a Python notebook. Dashboards have cards that read the twin, an execution or a model. On the network map, you choose the measure shown, coloured from the threshold of its rule; you draw catchments; a boundary is coloured from a number it carries. Pipelines gain the “last per key” node, composing a value from a pattern, and an output that is the complete set. The twin evaluates its alerts even when nobody is watching.
- **Changes.** The Studio is entirely in English. The freshness of a value measures the age of the data, not that of the download, and a missing value is no longer a zero. Occupancy is no longer cut off at 100 %. The network map no longer stops at 500 sites without saying so. Syncs read a file in its real encoding, no longer lose files at pagination, and a passing failure no longer switches a feed off.

## August 2026

- **New features.** The event engine: you compose an event, it starts from a place, takes time to arrive and weakens on the way; a timeline places its windows; the simulation gives back its data. The spread model, connected to the map, with its levers fitted to an observed wave. Overlay scenarios: a scenario is edited beside the twin it changes, without copying it. Signals: the twin's alerts become signals, visible and movable on a board. The twin's metrics become definitions that you create and tune from the software, with their thresholds. On the map: layers come from the ontology, you draw a flow between two sites, you draw areas, and spatial questions go through PostGIS. You replay a run step by step, on the real map, and set an observed series beside it. The ontology declares the identity of a type, what a link does, and the unit and bounds of a property. Dashboards are composed from what the data carries.
- **Changes.** The Studio's palette becomes role names. The environment lives in the page's address and is chosen in the header. Demand follows population and not the number of beds; arrivals are shared out by the size of sites; capacity is counted by declared role. The order of an event's effects no longer decides the result. The public site is redone.

## July 2026

- **New features.** The ontology manager. Data channels, fed by webhook, with a durable queue. Projects and their datasets, with versions. Sources, syncs and the REST connector. The lineage graph and the Pipeline Builder, with pipelines that run on their own and link rules. The network globe: sites, flows, and the detail of a site. Units as a tree and as a treemap. The causal lab. The role model and the audit log. The Studio's navigation: rail, sub-navigation, command palette. The first overlay scenarios.
- **Changes.** The “environment” becomes the “project”. The Studio's home page replaces the dropdown of environments.

## June 2026

- **New features.** Clinical extraction: concepts and contexts drawn from a text. The Studio: a node editor, access by account, the Source and Webhook nodes, a format router. The ontology per environment and its query API. Data quality, with its scans. The twin's alerts and roll-ups. The hybrid simulation service and its forecast mode.
- **Changes.** Deployment applies migrations before starting the server.

## May 2026

- **First release.** The terminology API: API keys and per-key limits, concept lookup, synonyms, hierarchy, normalisation, translation and disambiguation, on SNOMED CT (International Edition, February 2026). The documentation site and the account console.
