"use client";

/**
 * Stress-testing the twin against an event.
 *
 * The screen is deliberately ordered against the temptation it creates. A table
 * saying one response saves four hundred lives is the most quotable object this
 * platform produces, and it is computed from an ontology that does not know how
 * many people a hospital serves or how many patients a road can carry. So the
 * reading comes first, the holes come second, and the run button is only
 * offered once the holes that would silently decide the answer are filled.
 *
 * The copy says "event", not "crisis". Nothing in the engine tests whether a
 * change is bad: a capacity multiplier above 1 is a wing opening, not a wing
 * lost. Calling every input a crisis would tell someone modelling a merger that
 * this screen is not for them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteSimEvent,
  fetchSimCatalogue,
  fetchSimExport,
  listSimEvents,
  listScenarios,
  deleteSimPolicy,
  listSimPolicies,
  runSimulation,
  saveSimPolicy,
  type SimPolicy,
  saveSimEvent,
  type SimComparison,
  type SimEvent,
  type SimExport,
  type SimGap,
  type SimTarget,
  type ScenarioSummary,
} from "@/lib/platform-api";
import PolicyComposer, { type PolicyDraft } from "./PolicyComposer";
import ReplayPlayer from "./ReplayPlayer";
import { downloadText, slug, toCsv } from "./download";
import { runBlockedBecause, unsizedPopulations } from "./run-gate";
import { useStudio } from "../StudioShell";
import EventWorkspace from "./EventWorkspace";
import EventLibrary from "./EventLibrary";
import { downloadCsv } from "./csv";
import EventTimeline from "./EventTimeline";

/** Sentinel for "no scenario" so the select has a real value to hold. */
const LIVE = "";

/**
 * There is no shipped catalogue of events, and that is the point.
 *
 * The page used to open with Pandemic, Flood and Cyberattack pre-selected. A
 * modelling tool that hands you finished artefacts is telling you what to think
 * about, and the ones it hands you are always the obvious ones. The engine
 * still knows how to generate them — `templates.py` — but nothing here offers
 * them, because an event that came out of a box is not a model of *your*
 * network.
 */

const RESPONSES = [
  {
    id: "null",
    label: "Do nothing",
    hint: "The baseline. Without it a ranking tells you which option is least bad, not whether any of them helped.",
  },
  {
    id: "load-balance",
    label: "Transfer patients",
    hint: "Move the most urgent cases to whoever still has room. Cheap, immediate, limited by the routes.",
  },
  {
    id: "surge-and-balance",
    label: "Add capacity, then transfer",
    hint: "Buy whatever is short at each site. Arrives three steps late and costs real money.",
  },
];

/**
 * What a run can hand back beyond the ranking.
 *
 * `decisions` is the one nobody expects to want and everybody asks for
 * eventually, because "why did the model do that" is the first question after
 * "what did it say". The reading that tripped each rule was already recorded
 * and simply never surfaced.
 */
const COLLECTABLE: Array<{ id: "steps" | "facilities" | "decisions"; label: string; hint: string }> = [
  {
    id: "steps",
    label: "One row per step",
    hint: "Arrivals, care delivered, care refused, deaths and spend, for each response.",
  },
  {
    id: "facilities",
    label: "One row per step and facility",
    hint: "How full each unit was, with its id so a row joins back to the ontology.",
  },
  {
    id: "decisions",
    label: "One row per decision",
    hint: "Every rule that fired, what it did, and the reading that tripped it.",
  },
];

/** Gaps that make a result meaningless rather than merely narrower. */
const BLOCKING: SimGap["code"][] = ["POPULATION_WITHOUT_SIZE", "ROUTE_WITHOUT_CAPACITY"];

export default function EventsView() {
  const { selectedEnv: env } = useStudio();
  const [snapshot, setSnapshot] = useState<SimExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No event is selected until one is picked. There is nothing sensible to
  // default to now that the shipped three are gone, and defaulting to the first
  // saved event would silently decide what a run was about.
  const [event, setEvent] = useState("");
  const [responses, setResponses] = useState<string[]>([
    "null",
    "load-balance",
    "surge-and-balance",
  ]);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [routeCapacity, setRouteCapacity] = useState("10");
  const [result, setResult] = useState<SimComparison | null>(null);
  const [running, setRunning] = useState(false);
  // Collected by default. The tables are the most detailed thing a run
  // produces, they were previously computed and discarded, and a checkbox
  // nobody finds is the same as not having built them.
  const [collect, setCollect] = useState<Array<"steps" | "facilities" | "decisions">>([
    "steps",
    "facilities",
    "decisions",
  ]);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [twinScenarioId, setTwinScenarioId] = useState<string>(LIVE);
  const [composed, setComposed] = useState<SimEvent[]>([]);
  const [targets, setTargets] = useState<SimTarget[]>([]);
  const [composing, setComposing] = useState<SimEvent | "new" | null>(null);
  const [policies, setPolicies] = useState<SimPolicy[]>([]);
  const [chosenPolicies, setChosenPolicies] = useState<string[]>([]);
  const [writing, setWriting] = useState<SimPolicy | "new" | null>(null);

  const load = useCallback(async () => {
    if (!env) return;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchSimExport(env, twinScenarioId || undefined));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [env, twinScenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!env) return;
    // A failure here is not worth an error banner: it costs the scenario
    // picker, and the live twin still runs.
    listScenarios(env)
      .then((r) => setScenarios(r.scenarios))
      .catch(() => setScenarios([]));
  }, [env]);

  const loadEvents = useCallback(async () => {
    if (!env) return;
    try {
      setComposed((await listSimEvents(env)).events);
    } catch {
      setComposed([]);
    }
  }, [env]);

  const loadPolicies = useCallback(async () => {
    if (!env) return;
    try {
      setPolicies((await listSimPolicies(env)).policies);
    } catch {
      setPolicies([]);
    }
  }, [env]);

  useEffect(() => {
    void loadEvents();
    void loadPolicies();
  }, [loadEvents, loadPolicies]);

  useEffect(() => {
    if (!env) return;
    // Losing the catalogue costs the composer, not the screen: the shipped
    // templates still run, so this stays a quiet failure rather than a banner.
    fetchSimCatalogue(env)
      .then((c) => setTargets(c.targets))
      .catch(() => setTargets([]));
  }, [env]);

  // The reading and the result belong to one world. Leaving a stale table on
  // screen after switching would invite reading a flood against the new wing
  // when it was run against today's network.
  useEffect(() => {
    setResult(null);
  }, [twinScenarioId]);

  // Only whether anything at all is capacity, which is what the run gate asks.
  // The totals by role and the starting census went with the panel that showed
  // them; keeping them here would be arithmetic nobody reads.
  const hasCapacity = useMemo(
    () =>
      (snapshot?.facilities ?? []).some((f) =>
        Object.values(f.resources).some((r) => r.capacity > 0),
      ),
    [snapshot],
  );

  // An event's effects name instances by id, so one written against a scenario
  // means nothing on the live twin. Splitting them here rather than letting the
  // server refuse keeps the unusable ones out of the radio group instead of
  // offering a choice that always fails.
  const world = twinScenarioId || null;
  const ownEvents = composed.filter((e) => (e.twinScenarioId ?? null) === world);
  const otherWorldEvents = composed.filter((e) => (e.twinScenarioId ?? null) !== world);

  // The composed event currently picked, if any. Templates are generated
  // server-side against the twin, so the browser never holds their effects and
  // cannot draw them.
  const selectedComposed =
    event.startsWith("event:")
      ? (ownEvents.find((e) => `event:${e.id}` === event) ?? null)
      : null;

  const blocking = (snapshot?.gaps ?? []).filter((g) => BLOCKING.includes(g.code));
  const noCapacity = !hasCapacity;

  const unsizedPops = unsizedPopulations(snapshot?.populations ?? [], sizes);
  const blockedBecause = runBlockedBecause({
    event,
    hasCapacity: !noCapacity,
    populations: snapshot?.populations ?? [],
    typedSizes: sizes,
    edgeCount: snapshot?.edges.length ?? 0,
    routeCapacity,
  });

  async function run() {
    if (!env || running || blockedBecause) return;
    setRunning(true);
    setError(null);
    try {
      const populationSizes: Record<string, number> = {};
      for (const [k, v] of Object.entries(sizes)) {
        const n = Number(v);
        if (n > 0) populationSizes[k] = n;
      }
      // Only events written here can be run: the shipped templates are gone
      // from the UI, and the branch that sent one still named the request field
      // `scenario`, which was renamed to `template` several commits ago — dead
      // and broken at the same time.
      setResult(
        await runSimulation(env, {
          eventId: event.slice(6),
          policies: responses,
          policyIds: chosenPolicies,
          populationSizes,
          routeCapacity: Number(routeCapacity) || 0,
          twinScenarioId: twinScenarioId || undefined,
          collect,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  /**
   * Composing takes the whole screen.
   *
   * It used to be a card inside the reading column, which meant the workbench
   * competed for width with a statistics panel while you were trying to build
   * something. An event is the subject of this page; while you are writing one,
   * it is the only subject.
   */
  if (writing && snapshot) {
    return (
      <PolicyComposer
        snapshot={snapshot}
        initial={
          writing === "new"
            ? null
            : {
                id: writing.id,
                name: writing.name,
                description: writing.description,
                // Stored as JSON, checked by the engine. The composer needs the
                // shape to draw a form; a stored rule that no longer matches it
                // shows as a rule with a missing field rather than a crash.
                rules: writing.rules as unknown as PolicyDraft["rules"],
              }
        }
        onCancel={() => setWriting(null)}
        onSave={async (draft) => {
          const saved = await saveSimPolicy(
            env!,
            {
              name: draft.name,
              description: draft.description,
              rules: draft.rules as unknown as Record<string, unknown>[],
            },
            draft.id,
          );
          await loadPolicies();
          setChosenPolicies((prev) =>
            prev.includes(saved.id) ? prev : [...prev, saved.id],
          );
          setWriting(null);
        }}
      />
    );
  }

  if (composing && snapshot) {
    return (
      <EventWorkspace
        snapshot={snapshot}
        targets={targets}
        initial={composing === "new" ? null : composing}
        twinScenarioId={world}
        onSave={async (body) => {
          const saved = await saveSimEvent(
            env!,
            body,
            composing === "new" ? undefined : composing.id,
          );
          await loadEvents();
          setEvent(`event:${saved.id}`);
          setComposing(null);
        }}
        onDelete={
          composing === "new"
            ? null
            : async () => {
                await deleteSimEvent(env!, composing.id);
                await loadEvents();
                if (event === `event:${composing.id}`) setEvent("");
                setComposing(null);
              }
        }
        onClose={() => setComposing(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      {error ? (
        <div className="mx-6 mt-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="px-6 py-6 text-xs text-ink-faint">Reading your twin…</p>
      ) : !snapshot ? null : (
        <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            {/* The timeline is the page's subject, so it sits above the prose
                and the statistics rather than behind an Edit button. It used
                to render only inside the composer, which meant the most
                informative thing here was invisible until you decided to edit
                something — and nothing on the page said it existed. */}
            {!composing && selectedComposed ? (
              <>
                <EventTimeline
                  effects={selectedComposed.effects}
                  targets={targets}
                  horizon={selectedComposed.horizon}
                  focused={null}
                  onFocus={() => setComposing(selectedComposed)}
                  onChangeProfile={(i, profile) => {
                    // Dragging here edits the saved event, so it goes through
                    // the composer rather than writing behind the user's back.
                    // Opening it with the change already applied keeps the drag
                    // from being lost, which is what makes it feel like one
                    // gesture instead of two.
                    setComposing({
                      ...selectedComposed,
                      effects: selectedComposed.effects.map((e, j) =>
                        j === i ? { ...e, profile } : e,
                      ),
                    });
                  }}
                />
                <p className="-mt-2 text-[11px] text-ink-faint">
                  Dragging a bar opens “{selectedComposed.name}” for editing with
                  that change applied.
                </p>
              </>
            ) : null}

            {!composing && !selectedComposed ? (
              <EventLibrary
                events={ownEvents}
                elsewhere={otherWorldEvents}
                worldLabel={
                  twinScenarioId
                    ? (scenarios.find((sc) => sc.id === twinScenarioId)?.name ?? "a scenario")
                    : "the live twin"
                }
                onOpen={(e) => setEvent(`event:${e.id}`)}
                onCreate={() => setComposing("new")}
              />
            ) : null}
            {result ? <Results result={result} /> : null}

            {result && snapshot ? (
              <Card title="The run, played back">
                <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
                  The network step by step. A dot is one facility, placed where it
                  is, sized by what it holds and coloured by the fullest thing it
                  provides — not by an average, which would read a saturated
                  emergency department as a calm hospital.
                </p>
                <ReplayPlayer result={result} snapshot={snapshot} />
              </Card>
            ) : null}

            {result?.datasets?.length ? (
              <Card title="What the run produced">
                <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
                  Synthetic data from this run, at seed 0. Every row is a step —
                  nothing is averaged here, so a reader who wants a mean can take
                  one, and this file cannot have decided which question it is
                  allowed to answer.
                </p>
                <ul className="flex flex-col gap-2">
                  {result.datasets.map((d) => (
                    <li key={d.name} className="flex items-start gap-3">
                      <span className="flex-1">
                        <span className="block text-xs text-ink">{d.label}</span>
                        <span className="block text-[11px] leading-snug text-ink-faint">
                          {d.description}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-ink-ghost">
                          {d.rows.length.toLocaleString("en-CA")} rows ·{" "}
                          {d.columns.join(", ")}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={d.rows.length === 0}
                        onClick={() =>
                          downloadCsv(d, ownEvents.find((e) => `event:${e.id}` === event)?.name ?? "event")
                        }
                        className="rounded-md border border-line px-2.5 py-1 text-[11px] text-ink hover:border-brand hover:text-brand disabled:text-ink-ghost"
                      >
                        {d.rows.length === 0 ? "Nothing to download" : "Download CSV"}
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <Card title="1 · Pick the world to test">
              <select
                value={twinScenarioId}
                onChange={(e) => setTwinScenarioId(e.target.value)}
                className="w-full rounded-md border border-line bg-white px-2.5 py-2 text-xs text-ink focus:border-brand focus:outline-none"
              >
                <option value={LIVE}>Live twin — the network as it stands</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                {twinScenarioId === LIVE
                  ? scenarios.length > 0
                    ? "Pick a scenario instead to test the event against a plan — build the wing first, then flood the district."
                    : "You have no scenarios yet. One is a set of proposed edits to the twin, built in Twin → Scenarios; testing an event against it answers whether the plan actually holds."
                  : "Everything below runs against this scenario's version of the network, not today's."}
              </p>
            </Card>

            <Card title="2 · Pick one of your events">
              {ownEvents.length === 0 ? (
                <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
                  Nothing to run yet. An event is a set of changes to your
                  network, placed in time — a wing closes, beds are marked
                  contaminated, admissions rise, a wing opens.
                </p>
              ) : (
                <div className="mb-3 flex flex-col gap-2">
                  {ownEvents.map((e) => (
                    <div key={e.id} className="flex items-start gap-2">
                      {/* The label is the whole row. As a bare input beside a
                          span, the only target was the 13px circle: clicking
                          the name of the event you wanted did nothing, and the
                          run button stayed greyed out with no way to see why. */}
                      <label className="flex flex-1 cursor-pointer items-start gap-2">
                        <input
                          type="radio"
                          name="event"
                          checked={event === `event:${e.id}`}
                          onChange={() => setEvent(`event:${e.id}`)}
                          className="mt-0.5"
                        />
                        <span className="flex-1">
                          <span className="block text-xs text-ink">{e.name}</span>
                          {/* Clamped: a description carrying its own provenance
                              is worth keeping and would otherwise push the
                              controls under it off the panel. */}
                          <span className="line-clamp-3 block text-[11px] leading-snug text-ink-faint">
                            {e.description ||
                              `${e.effects.length} effect${e.effects.length === 1 ? "" : "s"} over ${e.horizon} steps`}
                          </span>
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setComposing(e)}
                        className="text-[11px] text-ink-faint hover:text-brand"
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setComposing("new")}
                className="rounded-md bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-deep"
              >
                Create an event
              </button>
              {otherWorldEvents.length > 0 ? (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                  {otherWorldEvents.length} other event
                  {otherWorldEvents.length === 1 ? " was" : "s were"} written against a
                  different world and cannot run here — their effects name instances
                  that only exist there.
                </p>
              ) : null}
            </Card>

            <Card title="Data to collect from the run">
              <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
                Downloadable as CSV once the run finishes. Untick what you do not
                need: a trajectory is far larger than the ranking, and every step
                of it crosses the wire.
              </p>
              <div className="flex flex-col gap-2">
                {COLLECTABLE.map((c) => (
                  <label key={c.id} className="flex cursor-pointer gap-2">
                    <input
                      type="checkbox"
                      checked={collect.includes(c.id)}
                      onChange={(ev) =>
                        setCollect((prev) =>
                          ev.target.checked
                            ? [...prev, c.id]
                            : prev.filter((x) => x !== c.id),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs text-ink">{c.label}</span>
                      <span className="block text-[11px] leading-snug text-ink-faint">
                        {c.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Card>

            <Card title="3 · Pick the responses to compare">
              <div className="flex flex-col gap-2">
                {RESPONSES.map((p) => (
                  <label key={p.id} className="flex cursor-pointer gap-2">
                    <input
                      type="checkbox"
                      checked={responses.includes(p.id)}
                      onChange={(ev) =>
                        setResponses((prev) =>
                          ev.target.checked
                            ? [...prev, p.id]
                            : prev.filter((x) => x !== p.id),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs text-ink">{p.label}</span>
                      <span className="block text-[11px] leading-snug text-ink-faint">
                        {p.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {policies.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-line-soft pt-3">
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                    Written here
                  </span>
                  {policies.map((p) => (
                    <div key={p.id} className="flex items-start gap-2">
                      <label className="flex flex-1 cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={chosenPolicies.includes(p.id)}
                          onChange={(ev) =>
                            setChosenPolicies((prev) =>
                              ev.target.checked
                                ? [...prev, p.id]
                                : prev.filter((x) => x !== p.id),
                            )
                          }
                          className="mt-0.5"
                        />
                        <span className="flex-1">
                          <span className="block text-xs text-ink">{p.name}</span>
                          <span className="line-clamp-2 block text-[11px] leading-snug text-ink-faint">
                            {p.description ||
                              `${p.rules.length} règle${p.rules.length === 1 ? "" : "s"}`}
                          </span>
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setWriting(p)}
                        className="text-[11px] text-ink-faint hover:text-brand"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteSimPolicy(env!, p.id);
                          setChosenPolicies((prev) => prev.filter((x) => x !== p.id));
                          await loadPolicies();
                        }}
                        className="text-[11px] text-ink-faint hover:text-danger"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setWriting("new")}
                className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs text-ink-body hover:border-ink-ghost"
              >
                Write a response
              </button>
            </Card>

            {blocking.length > 0 && !noCapacity ? (
              <Card title="4 · Fill in what the twin cannot know">
                <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
                  Numbers that decide the result and that your ontology has not
                  answered. Left at zero the run still completes and tells you
                  nothing. Anything already declared is not asked for again.
                </p>
                {unsizedPops.length > 0 ? (
                  <div className="mb-3 flex flex-col gap-2">
                    <span className="text-[11px] font-medium text-ink">
                      People each site serves
                    </span>
                    {unsizedPops.map((p) => (
                      <label key={p.id} className="flex items-center gap-2">
                        <span className="flex-1 truncate text-[11px] text-ink-faint">
                          {p.name}
                        </span>
                        <input
                          inputMode="numeric"
                          value={sizes[p.id] ?? ""}
                          placeholder="0"
                          onChange={(e) =>
                            setSizes((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className="w-24 rounded-md border border-line bg-white px-2 py-1 text-right text-xs text-ink focus:border-brand focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                {snapshot.edges.length > 0 ? (
                  <label className="flex items-center gap-2">
                    <span className="flex-1 text-[11px] text-ink-faint">
                      Patients one route can carry per step
                    </span>
                    <input
                      inputMode="numeric"
                      value={routeCapacity}
                      onChange={(e) => setRouteCapacity(e.target.value)}
                      className="w-24 rounded-md border border-line bg-white px-2 py-1 text-right text-xs text-ink focus:border-brand focus:outline-none"
                    />
                  </label>
                ) : null}
              </Card>
            ) : null}

            <button
              type="button"
              onClick={run}
              disabled={
              running || !!blockedBecause || responses.length + chosenPolicies.length === 0
            }
              className="rounded-md bg-brand px-3 py-2 text-xs text-white hover:bg-brand-deep disabled:bg-ink-ghost"
            >
              {running ? "Running…" : "Compare responses"}
            </button>
            {blockedBecause ? (
              <p className="-mt-2 text-[11px] leading-snug text-ink-faint">
                {blockedBecause}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Results({ result }: { result: SimComparison }) {
  const columns = ["excess_deaths", "unmet_care", "response_cost"] as const;
  const label: Record<string, string> = {
    excess_deaths: "Deaths",
    unmet_care: "Care not delivered",
    response_cost: "Cost",
  };
  const baseline = result.rows.find((r) => r.policy === "null");

  // Every column the engine scored on, not the three drawn above: the table on
  // screen is an argument and the file is the evidence, and the evidence should
  // not have been narrowed by the argument.
  const allColumns = Array.from(
    result.rows.reduce((set, row) => {
      for (const k of Object.keys(row)) set.add(k);
      return set;
    }, new Set<string>()),
  );

  return (
    <Card title={`Result — ${result.scenario.name}`}>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() =>
            downloadText(
              toCsv(allColumns, result.rows.map((r) => allColumns.map((c) => r[c] ?? ""))),
              `${slug(result.scenario.name)}-ranking.csv`,
              "text/csv",
            )
          }
          className="rounded-md border border-line px-2.5 py-1 text-[11px] text-ink hover:border-brand hover:text-brand"
        >
          Download ranking (CSV)
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
        {result.scenario.description} Run over {result.horizon} steps across{" "}
        {result.facilities} facilities.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-[11px] text-ink-faint">
              <th className="py-1.5 pr-3 font-medium">Response</th>
              {columns.map((c) => (
                <th key={c} className="py-1.5 pr-3 text-right font-medium">
                  {label[c]}
                </th>
              ))}
              <th className="py-1.5 text-right font-medium">vs doing nothing</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => {
              const deaths = Number(row.excess_deaths ?? 0);
              const base = Number(baseline?.excess_deaths ?? 0);
              const delta = base > 0 ? (deaths - base) / base : null;
              return (
                <tr key={String(row.policy)} className="border-b border-line/60">
                  <td className="py-1.5 pr-3 text-ink">
                    {String(row.name || row.policy)}
                    {i === 0 && result.rows.length > 1 ? (
                      <span className="ml-2 rounded bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok">
                        best
                      </span>
                    ) : null}
                  </td>
                  {columns.map((c) => (
                    <td key={c} className="py-1.5 pr-3 text-right tabular-nums text-ink">
                      {Math.round(Number(row[c] ?? 0)).toLocaleString("en-CA")}
                    </td>
                  ))}
                  <td className="py-1.5 text-right tabular-nums">
                    {delta === null || row.policy === "null" ? (
                      <span className="text-ink-ghost">—</span>
                    ) : (
                      <span className={delta < 0 ? "text-ok" : "text-danger"}>
                        {delta > 0 ? "+" : ""}
                        {Math.round(delta * 100)}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Ranked by a score that weighs one death against{" "}
        {Math.round(1 / (result.weights.response_cost || 1)).toLocaleString("en-CA")}{" "}
        dollars of spending. That is a judgement, not a fact — change it and the
        ranking can change with it.
      </p>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="mb-3 text-xs font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}
