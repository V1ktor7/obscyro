/**
 * Writes `src/services/scenario-run-parity.fixture.json`.
 *
 * The fixture is a small twin, a scenario, five options, and what the real
 * engine answered when the scenario was run as it is and with each of them:
 * one that adds a stamp, one that replaces a choice the scenario holds, one
 * that places a recorded response written by the organisation (a transfer of
 * patients, from a given day, at a declared cost), one that places a response
 * the engine writes itself, and one that places the transfer the analyst's
 * own test writes. The server's test and the page's test both replay it: each
 * must send the engine the recorded requests and read the recorded figures out
 * of its answers. That is how "the server and the page give the same figures"
 * is held.
 *
 * Run by hand, when the engine or the translation of stamps changes:
 *
 *     cd backend
 *     npx tsx scripts/make-scenario-run-fixture.ts
 *
 * It needs Python with the simulation service's requirements installed, since
 * it calls the engine itself (`simulation-service/scripts/engine_once.py`).
 * Then run both test suites: a change on one side only fails the other.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transferRule } from "../src/services/analyst-responses.js";
import type { ScenarioOverride } from "../src/services/scenario-overrides.js";
import { ScenarioRunner, type ScenarioEngine } from "../src/services/scenario-run.js";
import { recordingEngine } from "../src/services/scenario-run-recording.js";
import { stampsOf, type StampBody } from "../src/services/scenario-stamps.js";
import type { SimExport } from "../src/services/twin-export.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.resolve(HERE, "../../simulation-service");
const OUT = path.resolve(HERE, "../src/services/scenario-run-parity.fixture.json");

// --- a twin of three hospitals and three catchments ------------------------

const SITES: { id: string; name: string; at: [number, number]; lit: number; civiere: number }[] = [
  { id: "site:lake", name: "Lakeshore", at: [45.45, -73.83], lit: 20, civiere: 0 },
  { id: "site:north", name: "Nord", at: [45.58, -73.66], lit: 40, civiere: 0 },
  { id: "site:east", name: "Est", at: [45.57, -73.56], lit: 30, civiere: 6 },
  // Stretchers only: the catchment it serves has nowhere to be admitted.
  { id: "site:clinic", name: "Clinique Pointe", at: [45.65, -73.5], lit: 0, civiere: 4 },
];

const prop = (key: string, type: string, behaviour: string, mechanic: string | null = null) => ({
  key,
  type,
  label: null,
  unit: null,
  min: null,
  max: null,
  behaviour,
  mechanic,
});

function twin(): SimExport {
  const objects: SimExport["objects"] = [];
  for (const s of SITES) {
    for (let i = 0; i < s.lit; i++) objects.push({ id: `${s.id}:lit:${i}`, type: "Lit", role: "space", properties: {}, at: s.id });
    for (let i = 0; i < s.civiere; i++) objects.push({ id: `${s.id}:civ:${i}`, type: "Civiere", role: "space", properties: {}, at: s.id });
  }
  const transition = (id: string, properties: Record<string, unknown>) => objects.push({ id, type: "Transition", role: null, properties, at: null });
  transition("t:school", { de: "sain", vers: "malade", taux: 0.12, pousse: "malade", voie: "ecole" });
  transition("t:home", { de: "sain", vers: "malade", taux: 0.09, pousse: "malade", voie: "menage" });
  transition("t:recover", { de: "malade", vers: "gueri", taux: 0.2 });
  transition("t:admit", { de: "malade", vers: "admis", taux: 0.004, devient: "hospitalisation" });
  const protocol = (id: string, properties: Record<string, unknown>) => objects.push({ id, type: "Protocole", role: null, properties, at: null });
  protocol("p:hosp", { gravite: "hospitalisation", ressource: "lit", quantite: 1, duree_sejour: 5, deces_sans_soin: 0 });
  protocol("p:urg", { gravite: "urgence", ressource: "civiere", quantite: 1, duree_sejour: 1, deces_sans_soin: 0 });

  const resource = (activity: string, n: number) => ({ id: activity, category: "space" as const, quantity: n, capacity: n, enables: [activity] });
  return {
    environment: "parity",
    scenario_id: null,
    generated_at: "2026-11-17T00:00:00.000Z",
    facilities: SITES.map((s) => ({
      id: s.id,
      name: s.name,
      location: s.at,
      resources: { ...(s.lit ? { lit: resource("lit", s.lit) } : {}), ...(s.civiere ? { civiere: resource("civiere", s.civiere) } : {}) },
      census: {},
    })),
    objects,
    object_types: [
      { name: "Lit", role: "space", properties: [] },
      { name: "Civiere", role: "space", properties: [] },
      {
        name: "Transition",
        role: null,
        properties: [
          prop("de", "string", "state", "leaves_state"),
          prop("vers", "string", "state", "enters_state"),
          prop("taux", "number", "level", "transition_rate"),
          prop("pousse", "string", "state", "driven_by_state"),
          prop("voie", "string", "state", "couples_along"),
          prop("devient", "string", "state", "produces_demand"),
        ],
      },
      {
        name: "Protocole",
        role: null,
        properties: [
          prop("gravite", "string", "state", "serves_severity"),
          prop("ressource", "string", "state", "consumes_activity"),
          prop("quantite", "number", "level", "consumes_amount"),
          prop("duree_sejour", "number", "level", "occupies_for"),
          prop("deces_sans_soin", "number", "level", "dies_without"),
        ],
      },
    ],
    object_rules: { unavailable_keys: [], unavailable_values: [] },
    populations: [
      { id: "pop:west", name: "Ouest-de-l'Île", size: 30_000, served_by: ["site:lake"], couples: { ecole: 1.4, menage: 1 } },
      { id: "pop:centre", name: "Centre", size: 60_000, served_by: ["site:north", "site:east"], couples: { ecole: 1.2, menage: 1 } },
      // Its only site has no bed: its patients wait where no site's list shows them.
      { id: "pop:far", name: "Pointe", size: 8_000, served_by: ["site:clinic"], couples: { ecole: 1, menage: 1 } },
    ],
    // Roads a patient can be sent down. Nobody takes one unless a response says so:
    // with the do-nothing response these change nothing.
    edges: [
      { source: "site:lake", target: "site:north", kind: "transfer", capacity: 0, via: "transfert_vers" },
      { source: "site:north", target: "site:lake", kind: "transfer", capacity: 0, via: "transfert_vers" },
      { source: "site:north", target: "site:east", kind: "transfer", capacity: 0, via: "transfert_vers" },
      { source: "site:east", target: "site:north", kind: "transfer", capacity: 0, via: "transfert_vers" },
    ],
    gaps: [],
    structure: [],
  } as unknown as SimExport;
}

// --- a scenario, and an option on top of it --------------------------------

const SCENARIO = { id: "0d0f1a52-6b1e-4a53-9d0b-2f3f6c1a7e10", name: "Parity" };

let seq = 0;
function stamp(id: string, body: StampBody, start: number, days: number): ScenarioOverride {
  const key = `stamp:${id}`;
  return {
    id,
    scenarioId: SCENARIO.id,
    seq: ++seq,
    targetType: "param",
    targetId: null,
    targetLocalKey: key,
    op: "set_param",
    payload: { key, value: body },
    effectiveOffsetHours: start * 24,
    durationHours: days * 24,
    note: null,
  };
}

const HORIZON = 30;
const ACTIVITY = "lit";

const OVERRIDES: ScenarioOverride[] = [
  stamp("11111111-0000-4000-8000-000000000001", { kind: "occupancy", activity: "lit", share: 0.6 }, 0, HORIZON),
  stamp("11111111-0000-4000-8000-000000000002", { kind: "immunity", share: 0.3 }, 0, HORIZON),
  stamp("11111111-0000-4000-8000-000000000003", { kind: "variant", factor: 1.4 }, 0, HORIZON),
  stamp("11111111-0000-4000-8000-000000000004", { kind: "seed", at: { lat: 45.45, lon: -73.83 }, population: "pop:west", count: 300 }, 2, 1),
  stamp("11111111-0000-4000-8000-000000000005", { kind: "seed", at: { lat: 45.58, lon: -73.66 }, population: "pop:centre", count: 400 }, 2, 1),
  stamp("11111111-0000-4000-8000-000000000006", { kind: "seed", at: { lat: 45.5, lon: -73.5 }, population: "pop:far", count: 60 }, 2, 1),
  stamp("11111111-0000-4000-8000-000000000007", { kind: "heat", acuity: "urgence", perThousand: 0.08 }, 10, 4),
  stamp(
    "11111111-0000-4000-8000-000000000008",
    {
      kind: "measure",
      label: "Schools closed",
      layers: [
        { layer: "ecole", factor: 0 },
        { layer: "menage", factor: 1.27 },
      ],
      at: null,
      radiusKm: null,
      populations: ["pop:centre"],
    },
    8,
    10,
  ),
  stamp("11111111-0000-4000-8000-000000000009", { kind: "capacity", facility: "site:north", activity: "lit", amount: 5 }, 8, HORIZON - 8),
];

/** The option, as its stamps would be once a person adds them to the scenario. */
const OPTION = {
  label: "Open 6 beds at Lakeshore from day 5",
  overrides: [stamp("22222222-0000-4000-8000-000000000001", { kind: "capacity", facility: "site:lake", activity: "lit", amount: 6 }, 5, HORIZON - 5)],
};

/**
 * An option that replaces a choice of the scenario: three beds at Nord from
 * day 6, where the scenario opens five from day 8. Once a person adds it, the
 * recipe holds the new stamp and no longer the old one.
 */
const REPLACEMENT = {
  label: "Open 3 beds at Nord from day 6 instead of 5 from day 8",
  retired: ["11111111-0000-4000-8000-000000000009"],
  overrides: [stamp("33333333-0000-4000-8000-000000000001", { kind: "capacity", facility: "site:north", activity: "lit", amount: 3 }, 6, HORIZON - 6)],
};

/**
 * An option that places a recorded response, as the organisation's library
 * holds one: when somebody waits at Lakeshore and Nord has a free bed, send up
 * to four of them there, at a declared cost each time. Placed on day 12, so
 * its rule, written to fire at every step, is made to start that day.
 */
const RESPONSE = {
  label: "Send Lakeshore's queue to Nord from day 12",
  overrides: [
    stamp(
      "44444444-0000-4000-8000-000000000001",
      {
        kind: "response",
        name: "Send Lakeshore's queue to Nord",
        source: "stored",
        ref: "44444444-0000-4000-8000-0000000000aa",
        rules: [
          {
            id: "lake-to-north",
            trigger: { when: "every_tick", start: 0, end: null },
            condition: {
              all_of: [
                { compare: { left: { fn: "backlog", facility: "site:lake" }, op: ">", right: 0.5 } },
                { compare: { left: { fn: "available", facility: "site:north", activity: "lit" }, op: ">", right: 0 } },
              ],
            },
            action: { kind: "transfer", source: "site:lake", target: "site:north", amount: 4, friction: { delay: 0, cost: 500, effectiveness: 1 } },
            priority: 10,
          },
        ],
      },
      12,
      HORIZON - 12,
    ),
  ],
};

/** An option that places a response the engine writes itself from the network: no rules travel, only its name. */
const BUILT_IN = {
  label: "Transfer when full",
  overrides: [
    stamp("55555555-0000-4000-8000-000000000001", { kind: "response", name: "Transfer when full", source: "built-in", ref: "load-balance", rules: [] }, 0, HORIZON),
  ],
};

/**
 * A transfer as the analyst's test writes one (`transferRule`): up to four of
 * the patients waiting for a bed at Lakeshore sent to Nord each day from day
 * 12, when Nord has a bed free. It declares no cost, so none is counted.
 */
const TRANSFER = {
  label: "Send up to 4 waiting patients a day from Lakeshore to Nord from day 12",
  overrides: [
    stamp(
      "66666666-0000-4000-8000-000000000001",
      {
        kind: "response",
        name: "Transfer from Lakeshore to Nord",
        source: "written",
        ref: "",
        rules: [transferRule({ id: "transfer-1", source: "site:lake", target: "site:north", activity: ACTIVITY, acuity: "hospitalisation", perDay: 4, fromDay: 12 })],
      },
      12,
      HORIZON - 12,
    ),
  ],
};

// --- the real engine --------------------------------------------------------

function engineOnce<T>(route: string, body: unknown): T {
  const out = execFileSync("python", ["scripts/engine_once.py"], {
    cwd: SIM,
    input: JSON.stringify({ path: route, body }),
    maxBuffer: 256 * 1024 * 1024,
    encoding: "utf8",
  });
  return JSON.parse(out) as T;
}

const engine: ScenarioEngine = {
  spread: async (payload) => engineOnce("/events/spread", payload),
  compare: async (payload) => engineOnce("/events/compare", payload),
};

const RAN_AT = "2026-11-17T12:00:00.000Z";

async function main() {
  const system = twin();
  const world = { reality: system, system, scenario: SCENARIO, horizon: HORIZON, activity: ACTIVITY };
  const now = () => new Date(RAN_AT);

  const base = recordingEngine(engine);
  const asItIs = await new ScenarioRunner(base, world, now).digest(stampsOf(OVERRIDES));

  // A fresh runner, so every call the page would make is recorded.
  const withOption = recordingEngine(engine);
  const both = [...OVERRIDES, ...OPTION.overrides];
  const optionDigest = await new ScenarioRunner(withOption, world, now).digest(stampsOf(both));

  // The recipe as the page leaves it after a replacement: the new stamp in, the old one out.
  const withReplacement = recordingEngine(engine);
  const replaced = [...OVERRIDES.filter((o) => !REPLACEMENT.retired.includes(o.id)), ...REPLACEMENT.overrides];
  const replacementDigest = await new ScenarioRunner(withReplacement, world, now).digest(stampsOf(replaced));

  // A recorded response placed in the scenario: the full run follows it, the events-only run does not.
  const recordResponse = async (option: { label: string; overrides: ScenarioOverride[] }) => {
    const rec = recordingEngine(engine);
    const overrides = [...OVERRIDES, ...option.overrides];
    const runner = new ScenarioRunner(rec, world, now);
    const digest = await runner.digest(stampsOf(overrides));
    // The pass an option's column is read from, for what the response cost: the same request, so nothing more is recorded.
    const cost = (await new ScenarioRunner(recordingEngine(engine), world, now).full(stampsOf(overrides))).cost;
    return { label: option.label, added: option.overrides, overrides, calls: rec.calls, digest, cost };
  };
  const withResponse = await recordResponse(RESPONSE);
  const withBuiltIn = await recordResponse(BUILT_IN);
  const withTransfer = await recordResponse(TRANSFER);

  const fixture = {
    about:
      "A recording of the real engine, replayed by backend/src/services/scenario-run.unit.test.ts and by " +
      "frontend/app/studio/simulation/hex/run-parity.test.ts. Written by backend/scripts/make-scenario-run-fixture.ts; do not edit by hand.",
    twin: system,
    scenario: SCENARIO,
    horizon: HORIZON,
    activity: ACTIVITY,
    ranAt: RAN_AT,
    asItIs: { overrides: OVERRIDES, calls: base.calls, digest: asItIs },
    withOption: { label: OPTION.label, added: OPTION.overrides, overrides: both, calls: withOption.calls, digest: optionDigest },
    withReplacement: {
      label: REPLACEMENT.label,
      retired: REPLACEMENT.retired,
      added: REPLACEMENT.overrides,
      overrides: replaced,
      calls: withReplacement.calls,
      digest: replacementDigest,
    },
    withResponse,
    withBuiltIn,
    withTransfer,
  };
  writeFileSync(OUT, `${JSON.stringify(fixture)}\n`);

  const line = (d: typeof asItIs) => ({
    peak: Math.max(...d.full.island.map((x) => x ?? 0)),
    sitesWithQueue: `${d.full.sitesWithQueue}/${d.full.sitesWithActivity}`,
    waitingDays: d.full.waitingDays,
    firstQueueDay: d.full.firstQueueDay,
    stranded: d.full.strandedWaitingDays,
    eventsWaitingDays: d.events.waitingDays,
  });
  console.log("as it is   ", line(asItIs));
  console.log("with option", line(optionDigest));
  console.log("replacement", line(replacementDigest));
  console.log("response   ", line(withResponse.digest), "cost", withResponse.cost);
  console.log("built-in   ", line(withBuiltIn.digest), "cost", withBuiltIn.cost);
  console.log("transfer   ", line(withTransfer.digest), "cost", withTransfer.cost);
  console.log(
    `${base.calls.length} + ${withOption.calls.length} + ${withReplacement.calls.length} + ${withResponse.calls.length} + ${withBuiltIn.calls.length} + ${withTransfer.calls.length} engine calls recorded -> ${path.relative(process.cwd(), OUT)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
