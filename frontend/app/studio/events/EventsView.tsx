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
  runSimulation,
  saveSimEvent,
  type SimComparison,
  type SimEvent,
  type SimExport,
  type SimGap,
  type SimTarget,
  type ScenarioSummary,
} from "@/lib/platform-api";
import { useStudio } from "../StudioShell";
import EventComposer from "./EventComposer";

/** Sentinel for "no scenario" so the select has a real value to hold. */
const LIVE = "";

const ROLE_LABEL: Record<string, string> = {
  space: "Space",
  staff: "Staff",
  stuff: "Supplies",
  systems: "Systems",
  demand: "Demand",
};

const EVENTS = [
  {
    id: "pandemic",
    label: "Pandemic wave",
    hint: "Respiratory cases surge across every population, with staff falling sick behind the curve.",
  },
  {
    id: "flood",
    label: "Flood",
    hint: "One site loses all capacity and its routes are cut, while trauma arrives everywhere.",
  },
  {
    id: "cyberattack",
    label: "Cyberattack",
    hint: "Systems degrade network-wide. Nothing else is touched — whatever follows travels through the cascade.",
  },
];

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

/** Gaps that make a result meaningless rather than merely narrower. */
const BLOCKING: SimGap["code"][] = ["POPULATION_WITHOUT_SIZE", "ROUTE_WITHOUT_CAPACITY"];

export default function ResilienceView() {
  const { selectedEnv: env } = useStudio();
  const [snapshot, setSnapshot] = useState<SimExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [event, setEvent] = useState("pandemic");
  const [responses, setResponses] = useState<string[]>([
    "null",
    "load-balance",
    "surge-and-balance",
  ]);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [routeCapacity, setRouteCapacity] = useState("10");
  const [result, setResult] = useState<SimComparison | null>(null);
  const [running, setRunning] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [twinScenarioId, setTwinScenarioId] = useState<string>(LIVE);
  const [composed, setComposed] = useState<SimEvent[]>([]);
  const [targets, setTargets] = useState<SimTarget[]>([]);
  const [composing, setComposing] = useState<SimEvent | "new" | null>(null);

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

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

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

  const totals = useMemo(() => {
    const byRole: Record<string, number> = {};
    let census = 0;
    for (const f of snapshot?.facilities ?? []) {
      for (const r of Object.values(f.resources)) {
        byRole[r.category] = (byRole[r.category] ?? 0) + r.capacity;
      }
      census += Object.values(f.census).reduce((a, b) => a + b, 0);
    }
    return { byRole, census };
  }, [snapshot]);

  // An event's effects name instances by id, so one written against a scenario
  // means nothing on the live twin. Splitting them here rather than letting the
  // server refuse keeps the unusable ones out of the radio group instead of
  // offering a choice that always fails.
  const world = twinScenarioId || null;
  const ownEvents = composed.filter((e) => (e.twinScenarioId ?? null) === world);
  const otherWorldEvents = composed.filter((e) => (e.twinScenarioId ?? null) !== world);

  const blocking = (snapshot?.gaps ?? []).filter((g) => BLOCKING.includes(g.code));
  const advisory = (snapshot?.gaps ?? []).filter((g) => !BLOCKING.includes(g.code));
  const noCapacity = Object.keys(totals.byRole).length === 0;

  const sized = (snapshot?.populations ?? []).filter((p) => Number(sizes[p.id] ?? "0") > 0);
  // Each hole has to be filled by hand, so the button says which one is still
  // open rather than sitting greyed out with no explanation.
  const blockedBecause = noCapacity
    ? "No object type carries capacity yet — set a resilience role on your types first."
    : sized.length === 0
      ? "Enter how many people at least one site serves."
      : snapshot && snapshot.edges.length > 0 && Number(routeCapacity) <= 0
        ? "Enter how many patients a route can carry, or no transfer can complete."
        : null;

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
      // A composed event is picked as `event:<uuid>`; anything else is one of
      // the shipped template names.
      const composedId = event.startsWith("event:") ? event.slice(6) : null;
      setResult(
        await runSimulation(env, {
          ...(composedId ? { eventId: composedId } : { scenario: event }),
          policies: responses,
          populationSizes,
          routeCapacity: Number(routeCapacity) || 0,
          twinScenarioId: twinScenarioId || undefined,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <header className="border-b border-line bg-white px-6 py-4">
        <h1 className="text-sm font-medium text-ink">Resilience</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-faint">
          Put your network through an event that has not happened, and find out
          which response comes out ahead. Same question every time: if this hits,
          what does it cost, and does acting beat standing still?
        </p>
      </header>

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
            {composing ? (
              <EventComposer
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
                        if (event === `event:${composing.id}`) setEvent("pandemic");
                        setComposing(null);
                      }
                }
                onClose={() => setComposing(null)}
              />
            ) : null}

            {result || composing ? null : <HowItWorks />}

            <Card title="What the engine reads from your twin">
              {/* Echoed from the payload, not from the picker: the point is to
                  show which world the server actually read, so a scenario that
                  silently fell back to live is visible rather than assumed. */}
              <p className="mb-3 text-[11px] text-ink-faint">
                Read from{" "}
                <strong className="font-medium text-ink">
                  {snapshot.scenario_id
                    ? (scenarios.find((s) => s.id === snapshot.scenario_id)?.name ??
                      "a scenario")
                    : "the live twin"}
                </strong>
                .
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Facilities" value={snapshot.facilities.length} />
                <Stat label="Routes between them" value={snapshot.edges.length} />
                <Stat label="Catchments" value={snapshot.populations.length} />
                <Stat label="Patients already in" value={Math.round(totals.census)} />
              </div>
              {noCapacity ? (
                <p className="mt-4 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs leading-relaxed text-ink">
                  No object type declares a resilience role, so nothing in your
                  twin carries capacity. A run like this would turn nobody away,
                  kill nobody, and rank every response as a tie — a clean table
                  that means nothing. Open{" "}
                  <strong className="font-medium">Ontology → Manager</strong>,
                  edit the type that represents your beds, and set its role to
                  Space.
                </p>
              ) : (
                <>
                  <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
                    Capacity by role, totalled across every facility. These come
                    from the roles you set on your object types — not from any
                    name the engine recognises.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(totals.byRole).map(([role, cap]) => (
                      <span
                        key={role}
                        className="rounded-md border border-line bg-canvas px-2 py-1 text-[11px] text-ink"
                      >
                        {ROLE_LABEL[role] ?? role} · {Math.round(cap)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {advisory.length > 0 ? (
              <Card title="What your ontology does not say">
                <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
                  Listed rather than guessed. A twin records what exists; these
                  are the things it has no way to know.
                </p>
                <ul className="flex flex-col gap-3">
                  {advisory.map((g) => (
                    <li key={g.code} className="text-xs leading-relaxed text-ink-faint">
                      {g.message}
                      {g.subjects.length > 0 ? (
                        <span className="mt-1 block text-[11px] text-ink-ghost">
                          {g.subjects.slice(0, 8).join(", ")}
                          {g.subjects.length > 8 ? ` +${g.subjects.length - 8} more` : ""}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {result ? <Results result={result} /> : null}
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

            <Card title="2 · Pick an event">
              <div className="flex flex-col gap-2">
                {EVENTS.map((e) => (
                  <label key={e.id} className="flex cursor-pointer gap-2">
                    <input
                      type="radio"
                      name="event"
                      checked={event === e.id}
                      onChange={() => setEvent(e.id)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs text-ink">{e.label}</span>
                      <span className="block text-[11px] leading-snug text-ink-faint">
                        {e.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-2 text-[11px] text-ink-faint">
                  {ownEvents.length > 0
                    ? "Your own events"
                    : "The three above are generic — they aim themselves at whatever network they are given. Compose one to say something specific about yours."}
                </p>
                <div className="flex flex-col gap-2">
                  {ownEvents.map((e) => (
                    <div key={e.id} className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="event"
                        checked={event === `event:${e.id}`}
                        onChange={() => setEvent(`event:${e.id}`)}
                        className="mt-0.5"
                      />
                      <span className="flex-1">
                        <span className="block text-xs text-ink">{e.name}</span>
                        <span className="block text-[11px] leading-snug text-ink-faint">
                          {e.description ||
                            `${e.effects.length} effect${e.effects.length === 1 ? "" : "s"} over ${e.horizon} steps`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setComposing(e)}
                        className="text-[11px] text-ink-faint hover:text-brand"
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setComposing("new")}
                    className="self-start rounded-md border border-line px-2.5 py-1 text-[11px] text-ink hover:border-brand hover:text-brand"
                  >
                    Compose an event
                  </button>
                </div>
                {otherWorldEvents.length > 0 ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                    {otherWorldEvents.length} other event
                    {otherWorldEvents.length === 1 ? " was" : "s were"} composed against a
                    different world and cannot run here — their effects name instances
                    that only exist there.
                  </p>
                ) : null}
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
            </Card>

            {blocking.length > 0 && !noCapacity ? (
              <Card title="4 · Fill in what the twin cannot know">
                <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
                  Two numbers that decide the result and that no ontology holds.
                  Left at zero the run still completes and tells you nothing.
                </p>
                {snapshot.populations.length > 0 ? (
                  <div className="mb-3 flex flex-col gap-2">
                    <span className="text-[11px] font-medium text-ink">
                      People each site serves
                    </span>
                    {snapshot.populations.map((p) => (
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
              disabled={running || !!blockedBecause || responses.length === 0}
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

/**
 * Shown until the first result, then it gets out of the way.
 *
 * Present because the screen is not self-evident: nothing else in the platform
 * asks you to choose a disaster, and without this the three panels on the right
 * read as unrelated settings.
 */
function HowItWorks() {
  const steps = [
    {
      title: "Your twin becomes a network",
      body: "Every unit turns into a facility, and whatever is attached to it becomes capacity — beds, staff, equipment — according to the resilience role you set on each object type. Relationships that are not structural become the routes between facilities.",
    },
    {
      title: "An event perturbs it",
      body: "Not modelled by what it is called, but by what it does: demand rises somewhere, a resource falls somewhere, a connection breaks somewhere. A pandemic and a flood are the same three verbs with different numbers, which is why one engine handles both.",
    },
    {
      title: "Each response is scored against doing nothing",
      body: "A response is a set of rules — transfer when full, add capacity when short. The engine runs the event forward step by step, applies the rules, and counts what it cost: lives, care not delivered, money. Doing nothing is always in the table so you can see whether acting helped at all.",
    },
  ];
  return (
    <Card title="What this screen does">
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] tabular-nums text-ink-faint">
              {i + 1}
            </span>
            <span>
              <span className="block text-xs text-ink">{s.title}</span>
              <span className="block text-[11px] leading-relaxed text-ink-faint">
                {s.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
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

  return (
    <Card title={`Result — ${result.scenario.name}`}>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2">
      <div className="text-lg tabular-nums text-ink">{value.toLocaleString("en-CA")}</div>
      <div className="text-[11px] text-ink-faint">{label}</div>
    </div>
  );
}
