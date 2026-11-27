---
# The English of docs/changelog.md. When that page changes, bring this one up to date, then run `npm run docs:stamp`.
title: "Changelog"
description: "What changed in Obscyro, from the most recent to the oldest. Each entry says whether it is a new feature or a change."
source: "docs/changelog.md"
translatedFrom: "1c1695fbd9e24e18"
---

What changed in Obscyro, from the most recent to the oldest. Each entry says what it is:

- **New feature**: something the product did not do.
- **Change**: something it already did, and now does differently, better or faster. A fix is one.

An entry is written the day the change ships, in the same commit as the code. Since November 2026, every visible change has its own. The months before are summarised. The full detail, commit by commit, is in [the repository's history](https://github.com/V1ktor7/obscyro/commits/main).

## 27 November 2026

- **New feature · Data.** Kept series. Under Data › Kept series, one sees everything the platform can show a model of the past: the twin's measures, unit by unit, and the datasets kept as series. Each line says which stretch it is about, since when it is kept, how many points it has, for how many units or entities, and what is missing.
- **New feature · Data.** Keeping a dataset as a series. One picks, among the dataset's columns, the one of the time, the one of the value and those that name the entity (a region, a site, a virus). From then on every write of the dataset is read, and only what changes is written down. A value its source corrects keeps the old one and the new one. What a write could not read is written on the series.
- **New feature · Data.** “Look” shows a series as a model would be handed it: a regular grid, over 48 hours by the hour or 30 days by the day. A value holds until the next one, and a gap stays a gap, never a zero.

## 26 November 2026

- **Change · Studio.** The “Analyst” panel of the frame really closes. Its cross, the Escape key and the “Analyst” button left it drawn over the page, where it hid what was underneath. Closed, it still keeps what was asked.

## 25 November 2026

- **New feature · Ontology.** Action types. Under Ontology › Action types, a project declares what the analyst may propose: a name in the institution's words, what the type changes (capacity, a measure, a transfer, a recorded response), its bounds (a range of units, sites, layers and their factor, days, patients a day), the days it takes before it can apply, and who can approve it. The activity, the sites and the layers are picked from what the twin declares. A type the twin does not let the analyst test says so, with what is missing.
- **New feature · Analyst.** The analyst keeps to the project's action types. It reads the list before proposing, a proposal out of bounds is refused before it runs in the engine and is not shown, and an idea no type covers goes in the limits of its answer. Four built-in types, unbounded, cover what it already proposed: a project that sets nothing works exactly as before.
- **New feature · Analyst.** An option says which action type it falls under and who can approve it, and the recorded decision keeps it. It is a mention: applying an option stays a person's click.
- **New feature · Ontology.** The same page shows the analyst's tools, with what each reads, and lets one be switched off for the project. With the web search off, Event finder and Investigate say so instead of searching.

- **New feature · Ontology.** Function types. Under Ontology › Functions, a project declares itself what the analyst can read, without code: a count or a total over the objects of a type (in one value, by property, by unit or by site), a list of objects, a formula, the history of a measure at a unit, or rows of a dataset. One picks from what the project holds, says what the tool is given (a text, a bounded number, a date, one value among a list) and the name of each value returned. A tool that cannot run says so, with what is missing.
- **New feature · Ontology.** A declared tool is tried before it serves. “Try” runs it once with the inputs it is given and shows what the analyst would read, or the sentence of the refusal. No model is called.
- **New feature · Analyst.** The analyst uses the tools the project declared, in Ask and in Options, like its own. The trace writes their label followed by “(declared in this project)”, and a figure a declared tool did not return is taken out of the answer, as for the others. A tool that is off is no longer offered.
- **Change · Ontology.** The Functions view and the Action types view say that a reading tool is declared under Functions, and a declared tool says there where it is switched on and off.

- **New feature · Analyst.** What the analyst can use is shown on screen. The “What it can use” tab, on the Scenarios and Network pages, lists its tools by what they read, with a sentence for each, what it is given, and those the project switched off. The same list heads the Functions view of the ontology.

## 24 November 2026

- **New feature · Analyst.** Investigating the series of a unit. On the Network page, one selects a site, and the Investigate tab searches official sources for what was going on around it over 24 hours, 72 hours, 7 days or 30 days. Each event found is set beside the series the twin kept: the episode beyond the alert threshold it goes with, how many days apart, the mean of the three days before and of the three days from its start, and the reasons to doubt. The events already in the calendar are compared in the same way. A pairing is a coincidence in time: the screen writes “goes with”, never “caused”.
- **New feature · Analyst.** One sees the investigation work, and it leaves its trace. Each step is written on screen when it ends: the series read, the calendar, the neighbouring units, what goes to the web, each search, each passage cited, the comparison, the check. A bar says where things stand. Everything is kept in the journal, and a past investigation reopens as it was delivered.
- **New feature · Analyst.** Only the sentence goes into a search. The tab proposes one, which names the unit and the dates and none of its figures; it can be changed before it is sent. The series, the threshold and the neighbours are read by the server and are never sent to the model. Without a reading over the span, no search is made.
- **New feature · Studio.** The Network page carries the analyst in a folding panel, under the inspector of the selected site, with the Ask and Investigate tabs. Opening it folds the inspector; folding it does not lose what is under way. The “Analyst” button at the bottom right is no longer shown on this page.
- **New feature · Studio.** The timeline of the Network page draws the series of the selected unit: the measure the map paints, as a staircase, with its alert threshold. When an investigation is on screen, its episodes are bands on it and its events are marks, at the day their source dates them.
- **Change · Studio.** The timeline of the Network page offers four windows instead of two: 24 h, 72 h, 7 days, 30 days. It is also the span of an investigation.
- **New feature · Studio.** The open alerts are in the explorer of the Network page, under the “Alerts” tab, with their number. A click on an alert selects its site on the map and opens its inspector; “Situation” leads to its card.
- **Change · Studio.** The six pages of the Twin section are filed in three groups: Network, the map one works from; “Library” (Scenarios, Events, Profiles); “Setup” (Response, Units). The section now opens on Network. No page changed its address.
- **New feature · Studio.** The two maps of the twin carry the same switch, “Live · Scenario”, at the head of their bar: it says which map one is on and leads to the other, on the same project.

## 23 November 2026

- **Change · Studio.** Every figure a unit reports carries its age. The “Also reports” list of a unit's sheet, and that of the inspector of the network map, write once the age their values share (“Values read 27m ago.”). A value read at another hour carries its own on its line, and a figure of the day before says when it was published.
- **Change · Twin.** The change of a value is always counted from an earlier hour. When a value is corrected within its hour, the twin keeps two readings at the same time: the change used to be counted against the first writing. Both are now stepped over.

## 22 November 2026

- **New feature · Studio.** A unit's sheet says, for each measure, the change since the reading kept before and the hour of that reading: “Up 6 pts since the reading of 16:45.”. With no earlier reading, it writes so; against a reading with no value, no change is counted. A change has no colour: more is not always worse.
- **New feature · Twin.** A figure can be declared “of the day before”. A numeric property says the period it describes (a type's editor, “Describes”); a measure that reads it is written “Yesterday's average, published 14m ago” instead of taking the age of the hour that republished it. Its 30-day mean is given with the number of days it rests on.
- **New feature · Twin.** A measure can be a duration, held in hours and written “5 h 59”. The new `only` aggregate takes the value of the one object that carries it: under a unit that holds several, an average already made is not averaged again, and the sheet says why there is no value. A source that published no figure is said to be so, and is never read as a zero.
- **Change · Studio.** On the network map, the inspector of a site is redone. The open alert comes first; then the measure the map paints, with its gauge and its age; what else the site reports, each figure with its change; the figures of the day before apart, with their mean; the history over 24 hours. Each block folds, and so does the whole panel. A site that counts several units says the history is read unit by unit.
- **New feature · Studio.** A unit's sheet and a site's inspector say where the figures come from: “About these figures” prints what the organisation wrote on the object types read, that is the source, its licence and its limits.
- **Change · Analyst.** `unit_now` says when a measure is a figure of the day before, how a duration is written, and why a measure has no value when there is a reason.
- **New feature · Twin.** The twin can declare a price list. A price is an object of the ontology, under whatever name the organisation likes: what a unit of an activity costs to open and to keep open for a day, in whole cents, with a range if wanted, a mode (normal, rush) and its delay, and its source. A row attached to a site holds for that site and comes before the network's price. A price can also be a formula, which names the numbers of its row and the quantities of the operation. A row with no source is a demo price, and the screen says so wherever it is used.
- **New feature · Analyst.** In the Options tab, each option is read on three counts: what it changes, the day it can be ready, what it costs. A click on a cost opens its lines: the quantity, the price, the arithmetic and the source of each. When the list prices an activity in several modes, the analyst can propose the same capacity sooner at a higher price, or later at a lower one; a day the delay does not allow is refused. The options no other beats on both waiting and cost are marked “Not beaten”, without being ranked among themselves. Without a price list, nothing changes.
- **New feature · Analyst.** The analyst reads the price list (`list_prices`), and an amount no tool returned is struck from an answer like any other figure.
- **New feature · Ontology.** The “Functions” view shows the twin's price list: the cost formulas with what each may name, every price row, and the rows that could not be read, with the reason. A type's panel shows the prices of its units.
- **Change · Analyst.** A recorded decision keeps the expected cost and the prices it was counted from. A price corrected later does not change what it shows.
- **Change · Studio.** The costs of recorded responses are shown as demo prices: on an option card, under the ranking of the Events page and under the options of the replay. They are the amounts their rules declare, and none has a source.
- **New feature · Studio.** The situation card follows a signal after it is raised. It shows the measure that raised it as the twin wrote it down: when raised, at the decision, then the lowest, the highest and the last reading. It writes how long after the signal the decision was taken, what became of the alert, and what the tested run gave. What is measured and what was expected are side by side, never subtracted, and the card does not conclude.
- **New feature · Alerts.** The threshold editor says, for each rule, what became of the signals it raised, including the share a person closed as false positives.
- **New feature · Twin.** The twin keeps what it measures. Every five minutes it writes down, for each unit, the measures whose value changed or was read at a new time. A unit's sheet shows the history of the value shown over 48 hours: a staircase line, the lowest, the highest, and the date of the first reading kept. The history starts today: nothing from before is reconstructed, and the screen says so.
- **Change · Alerts.** Each alert gives the age of its own value. The age is counted on what the alert's measure reads, and no longer on everything under the unit: a stretcher occupancy alert, at a unit that also carries an air quality station, has the age of the stretcher census, not the station's. If what the measure reads publishes no time, the alert says the age is unknown, even when another source of the unit has one. It is the same age in the banner, the list of alerts, the situation card and the analyst's answers.
- **Change · Alerts.** An emergency reading has an age at every hour. The emergency file writes the hour on a single digit from midnight to ten in the morning (`9:45`), which was not read: during those ten hours, alerts said “age of the value unknown”. A date with no hour is read too, as the start of that day: the age can then be too large by a day at most, never too small.
- **Change · Studio.** A unit's sheet names three ages. Under the value, the age of that value (“This value was read 14m ago”). In each alert, the age of the value that raised it. In the “Oldest source” box, the age of the whole unit, the oldest of all its sources. The situation card does the same: each figure carries its age, and the unit's is named apart. Detail: [the Units page](/docs/product/units-page).

## 21 November 2026

- **Change · Data.** A wide file loads as a dataset. The API refused a file's rows beyond 1 MiB, and a half-megabyte CSV with about fifty columns, such as a daily public-health series, is already over that once its rows are sent. The limit is 16 MiB for loading rows, as for the map's layers. On the map, “Add data” also keeps the file as a dataset up to that size. The rest of the API keeps 1 MiB.
- **Change · Analyst.** In the Options tab, after “Add to scenario”, the banner says the option is in the scenario and that Run should give the figures of its card. It was showing instead the warning meant for an edit made elsewhere.
- **Change · Studio.** On the Network page, a click on a line of the explorer opens the site where the unit stands, and the map moves to it. Before, the line lit up and nothing else happened. A line that has no site of its own, an establishment for instance, frames the map on the sites of what it contains, and the explorer writes why no panel opened. The other way round, a site chosen on the map lights its unit in the explorer, which opens the branch and scrolls to it.
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
