import { createHash } from "node:crypto";

import type { DbClient } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import type { DecisionExpected } from "./decisions.js";
import { figuresOf, type OptionFigures, type OptionStamp, type RetiredChoice } from "./analyst-options.js";
import { duration } from "./live-reading.js";
import { listPreparedResponses, scenarioMark, type PreparedResponse } from "./prepared-responses.js";
import { getOverlayScenario, listOverrides, type ScenarioOverride } from "./scenario-overrides.js";
import { ScenarioRunner, type EngineTiming, type PassDigest, type ScenarioEngine } from "./scenario-run.js";
import { isChoice, stampsOf, type Stamp } from "./scenario-stamps.js";
import { buildTwinExport, type SimExport } from "./twin-export.js";

/**
 * A prepared response, tested again on the network as it is.
 *
 * A response was tested in calm time, the day it was kept. That test does not
 * say what the response would give today. So when a signal opens on a kind that
 * has prepared responses, each is run through the engine again, on the twin as
 * it stands, without anyone asking and without any language model: a retest is
 * passes of the engine and nothing else.
 *
 * Four things are bounded here, because a pass takes about thirty seconds and
 * alerts arrive in waves:
 *
 * - one run at a time per project: retests queue;
 * - no run when nothing changed: a retest is skipped when the state it would
 *   run on has the mark of the last one that finished (`stateMark`);
 * - no pile-up: a response already queued or running is not queued again, one
 *   tested in the last minute is left alone, and signals of one kind that open
 *   together ask for one batch;
 * - a limit: past `RETEST_TIMEOUT_MS` the retest is abandoned, and says so.
 *
 * And one thing is never done: a retest that is running, abandoned or failed
 * is not shown as a result. The card then keeps the last test it knows, and
 * says which one it is.
 */

/** Past this, a retest is abandoned. Two passes take about a minute on the Montréal twin. */
export const RETEST_TIMEOUT_MS = 180_000;
/** A response tested this recently is not tested again because another signal opened. */
export const MIN_GAP_MS = 60_000;
/** A retest left queued or running for longer than this belongs to a server that stopped. */
export const ORPHAN_AFTER_MS = RETEST_TIMEOUT_MS + 120_000;
/** How long a retest is called a test "on the current state". Past it, the card says the state it ran on is an earlier one. */
export const CURRENT_FOR_MS = 15 * 60_000;

export type RetestStatus = "queued" | "running" | "done" | "unchanged" | "abandoned" | "failed";

/** The two runs a retest makes: the scenario as it stands, and the same with the response. */
export interface RetestFigures {
  asItIs: OptionFigures;
  withOption: OptionFigures;
}

// ---------------------------------------------------------------------------
// The state a retest runs on.
// ---------------------------------------------------------------------------

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
};

/**
 * A mark of everything a retest's result depends on: the twin as the engine is
 * sent it (sites and what they hold, catchments, routes, the declared model),
 * the scenario's choices, the days and the activity.
 *
 * Two states with the same mark would give the same run, so the second is not
 * made. When it was read does not count: the same twin read a minute later is
 * the same twin.
 */
export function stateMark(system: SimExport, overrides: ReadonlyArray<ScenarioOverride>, horizon: number, activity: string): string {
  const byId = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Everything the engine is sent, in an order that does not depend on how the
  // rows came back. The gaps and the notes on structure are derived from the rest.
  const twin = canonical({
    facilities: byId(system.facilities),
    objects: byId(system.objects),
    populations: byId(system.populations).map((p) => ({ ...p, served_by: [...p.served_by].sort() })),
    edges: system.edges.map((e) => canonical(e)).sort(),
    object_types: system.object_types.map((t) => canonical(t)).sort(),
    object_rules: system.object_rules,
  });
  return createHash("sha256").update(`${twin}\n${scenarioMark(overrides)}\n${horizon}\n${activity}`).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// One retest.
// ---------------------------------------------------------------------------

/** A retest that cannot be made as the response was tested. The message is what the card says. */
export class RetestRefused extends Error {}

/** The engine did not answer within the limit. */
export class RetestTimedOut extends Error {}

const sameStamp = (s: Stamp, o: OptionStamp): boolean => {
  const { id: _id, start, days, ...body } = s;
  return start === o.start && days === o.days && canonical(body) === canonical(o.body);
};

/**
 * The scenario's stamps a response takes out, as they are named today.
 *
 * The response remembers the choices it replaced or removed by what they were,
 * not only by the row that held them: a choice deleted and written again has a
 * new id and is the same choice. One that is no longer in the scenario at all
 * cannot be taken out of it, and running the response on top of what replaced
 * it would be another option's test passed off as this one's.
 */
export function retiredNow(stamps: readonly Stamp[], retires: readonly RetiredChoice[]): Set<string> {
  const taken = new Set<string>();
  for (const r of retires) {
    const hit = stamps.find((s) => isChoice(s) && !taken.has(s.id) && sameStamp(s, r.stamp));
    if (!hit) {
      throw new RetestRefused(`The scenario no longer holds “${r.text}”, which this response ${r.replacedBy === null ? "removes" : "replaces"}. It cannot be tested again as it was.`);
    }
    taken.add(hit.id);
  }
  return taken;
}

/** The stamps a response writes, as the engine reads them. */
export const optionStampsOf = (response: Pick<PreparedResponse, "id" | "optionStamps">): Stamp[] =>
  response.optionStamps.map((o, i) => ({ ...o.body, id: `retest-${response.id}-${i + 1}`, start: o.start, days: o.days }) as Stamp);

export interface Bench {
  asItIs(): Promise<PassDigest>;
}

/**
 * The scenario as it stands, run once and kept: every response of a batch is
 * set beside the same pass. Three responses are four passes, not six.
 */
export function benchOf(runner: ScenarioRunner, stamps: Stamp[]): Bench {
  let kept: Promise<PassDigest> | null = null;
  return {
    asItIs() {
      if (!kept) {
        const attempt = runner.full(stamps);
        kept = attempt;
        // A pass that failed is asked again by the next response, not remembered.
        attempt.catch(() => {
          if (kept === attempt) kept = null;
        });
      }
      return kept;
    },
  };
}

/** One response through the engine, on the scenario as it is now. */
export async function retestOne(
  runner: ScenarioRunner,
  bench: Bench,
  stamps: Stamp[],
  response: Pick<PreparedResponse, "id" | "optionStamps" | "expected">,
): Promise<RetestFigures> {
  // Refused before the engine is asked anything.
  const retired = retiredNow(stamps, response.expected.retires ?? []);
  const asItIs = await bench.asItIs();
  const tested = await runner.full(ScenarioRunner.withOption(stamps, optionStampsOf(response), retired));
  return { asItIs: figuresOf(asItIs.figures), withOption: figuresOf(tested.figures) };
}

// ---------------------------------------------------------------------------
// What the card says of a response's retests.
// ---------------------------------------------------------------------------

export interface RetestRow {
  id: string;
  preparedResponseId: string;
  status: RetestStatus;
  stateMark: string | null;
  sameAs: string | null;
  figures: RetestFigures | null;
  reason: string | null;
  totalMs: number | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface LiveTest {
  /**
   * `tested`: a retest gave figures, and they are what the card shows.
   * `testing`: one is queued or running; the card shows the last test it knows meanwhile.
   * `none`: no retest ever gave figures; the card shows the test kept in calm time.
   */
  state: "tested" | "testing" | "none";
  /** One line, for the card. */
  says: string;
  /** The figures of the latest retest that finished, when there is one. */
  figures: RetestFigures | null;
  /** When that retest ran. */
  testedAt: string | null;
  /** True while those figures can be called figures of the current state: run, or found unchanged, less than `CURRENT_FOR_MS` ago. */
  current: boolean;
  /** How long that retest took, in seconds: a measure, shown as such. */
  seconds: number | null;
  /** Why the latest attempt gave nothing, when it is more recent than any result. */
  problem: string | null;
}

/**
 * What a response's retests come to, from its rows, newest first.
 *
 * A row left queued or running by a server that stopped is read as abandoned:
 * nothing is running, and "being tested" for ever would be untrue.
 */
export function liveTest(rows: readonly RetestRow[], now: Date): LiveTest {
  const since = (iso: string) => Math.max(0, now.getTime() - Date.parse(iso));
  const ago = (iso: string) => `${duration(since(iso))} ago`;
  const endOf = (r: RetestRow) => r.finishedAt ?? r.requestedAt;
  const waits = (r: RetestRow) => r.status === "queued" || r.status === "running";
  const orphan = (r: RetestRow) => waits(r) && since(r.requestedAt) > ORPHAN_AFTER_MS;

  const latest = rows[0] ?? null;
  // The latest retest that holds figures, and the last time the state was found to be the one it ran on.
  const result = rows.find((r) => r.status === "done" && r.figures) ?? null;
  const recheck = result ? (rows.find((r) => r.status === "unchanged" && r.sameAs === result.id) ?? null) : null;
  const sureAt = result ? (recheck ? endOf(recheck) : endOf(result)) : null;
  const current = sureAt !== null && since(sureAt) <= CURRENT_FOR_MS;
  const base = {
    figures: result?.figures ?? null,
    testedAt: result ? endOf(result) : null,
    current,
    seconds: result?.totalMs != null ? Math.round(result.totalMs / 1000) : null,
  };
  const tested = !result
    ? null
    : !current
      ? `Tested on the network as it was ${ago(sureAt!)}; it has not been tested since.`
      : recheck
        ? `Tested on the current state: the run is ${duration(since(endOf(result)))} old, and the state had not changed ${ago(endOf(recheck))}.`
        : `Tested on the current state ${ago(endOf(result))}.`;
  const shown = result ? `What is shown is its last test, on the network as it was ${ago(sureAt!)}.` : "What is shown is the test kept in calm time.";

  if (latest && waits(latest) && !orphan(latest)) {
    const doing =
      latest.status === "running"
        ? `Being tested on the current state, started ${ago(latest.startedAt ?? latest.requestedAt)}.`
        : "Waiting its turn to be tested on the current state.";
    return { state: "testing", says: `${doing} ${shown}`, problem: null, ...base, current: false };
  }

  const failed = latest && latest !== result && latest !== recheck && (latest.status === "abandoned" || latest.status === "failed" || orphan(latest)) ? latest : null;
  const problem = !failed
    ? null
    : orphan(failed)
      ? `The test asked for ${ago(failed.requestedAt)} never finished: the server stopped before it did.`
      : `The test on the current state ${failed.status === "abandoned" ? "was abandoned" : "could not be made"} ${ago(endOf(failed))}: ${failed.reason ?? "no reason was recorded."}`;

  if (result && tested) {
    // A failure after the last result: the result is no longer known to be of the current state.
    return problem ? { state: "tested", says: `${problem} ${shown}`, problem, ...base, current: false } : { state: "tested", says: tested, problem: null, ...base };
  }
  return { state: "none", says: problem ? `${problem} ${shown}` : `Not tested on the current state. ${shown}`, problem, ...base };
}

/**
 * What a decision records as expected when a response is engaged: the figures
 * of the test it was kept from, and beside them the retest the card showed,
 * with its date. A retest that gave nothing adds nothing.
 */
export function expectedOnEngage(expected: DecisionExpected, live: LiveTest): DecisionExpected {
  if (!live.figures || !live.testedAt) return expected;
  return { ...expected, retested: { testedAt: live.testedAt, current: live.current, ...live.figures } };
}

// ---------------------------------------------------------------------------
// Where retests are kept.
// ---------------------------------------------------------------------------

/** A scenario as it is now, and the twin read through it. */
export interface WorldNow {
  reality: SimExport;
  system: SimExport;
  scenario: { id: string; name: string };
  overrides: ScenarioOverride[];
}

export interface Finished {
  mark?: string | null;
  sameAs?: string | null;
  figures?: RetestFigures | null;
  reason?: string | null;
  timing?: { twinMs: number; engine: EngineTiming[]; totalMs: number } | null;
}

/** What the queue reads and writes. The database in the server; a list in a test. */
export interface RetestStore {
  responses(projectId: string, signalTypeId: string): Promise<PreparedResponse[]>;
  /** True when the response is already queued or running, or was tested a moment ago. */
  settled(responseId: string): Promise<boolean>;
  queue(row: { responseId: string; projectId: string; signalId: string }): Promise<string>;
  /** The response's latest retest that gave figures. */
  lastDone(responseId: string): Promise<{ id: string; stateMark: string | null } | null>;
  start(testId: string, mark: string): Promise<void>;
  finish(testId: string, status: RetestStatus, fields?: Finished): Promise<void>;
  /** Null when the scenario is gone, or is not this project's. */
  world(projectId: string, scenarioId: string): Promise<WorldNow | null>;
}

interface Row {
  id: string;
  prepared_response_id: string;
  status: RetestStatus;
  state_mark: string | null;
  same_as: string | null;
  figures: RetestFigures | null;
  reason: string | null;
  timing: { totalMs?: number } | null;
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const out = (r: Row): RetestRow => ({
  id: r.id,
  preparedResponseId: r.prepared_response_id,
  status: r.status,
  stateMark: r.state_mark,
  sameAs: r.same_as,
  figures: r.figures,
  reason: r.reason,
  totalMs: r.timing?.totalMs ?? null,
  requestedAt: r.requested_at.toISOString(),
  startedAt: r.started_at ? r.started_at.toISOString() : null,
  finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
});

/** How many retests of a response a card reads back: enough to find what the latest ones came to. */
const KEPT_PER_RESPONSE = 12;

/**
 * The latest retests of some responses, newest first, by response. The latest
 * one that gave figures is always among them, however many found the state
 * unchanged since.
 */
export async function retestsOf(db: DbClient, responseIds: string[]): Promise<Map<string, RetestRow[]>> {
  const by = new Map<string, RetestRow[]>();
  if (responseIds.length === 0) return by;
  const { rows } = await db.query<Row>(
    `SELECT id, prepared_response_id, status, state_mark, same_as, figures, reason, timing, requested_at, started_at, finished_at
       FROM (SELECT t.*,
                    row_number() OVER (PARTITION BY prepared_response_id ORDER BY requested_at DESC) AS n,
                    row_number() OVER (PARTITION BY prepared_response_id, status ORDER BY requested_at DESC) AS n_of_status
               FROM app.prepared_response_test t
              WHERE prepared_response_id = ANY($1::uuid[])) t
      WHERE n <= $2 OR (status = 'done' AND n_of_status = 1)
      ORDER BY requested_at DESC`,
    [responseIds, KEPT_PER_RESPONSE],
  );
  for (const r of rows) by.set(r.prepared_response_id, [...(by.get(r.prepared_response_id) ?? []), out(r)]);
  return by;
}

export function sqlStore(db: DbClient): RetestStore {
  return {
    responses: (projectId, signalTypeId) => listPreparedResponses(db, projectId, signalTypeId),
    async settled(responseId) {
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.prepared_response_test
          WHERE prepared_response_id = $1
            AND ((status IN ('queued', 'running') AND requested_at > NOW() - ($2::double precision * INTERVAL '1 millisecond'))
              OR (status IN ('done', 'unchanged') AND finished_at > NOW() - ($3::double precision * INTERVAL '1 millisecond')))`,
        [responseId, ORPHAN_AFTER_MS, MIN_GAP_MS],
      );
      return (rows[0]?.n ?? 0) > 0;
    },
    async queue({ responseId, projectId, signalId }) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO app.prepared_response_test (prepared_response_id, project_id, signal_id, status)
         VALUES ($1, $2, $3, 'queued') RETURNING id`,
        [responseId, projectId, signalId],
      );
      return rows[0]!.id;
    },
    async lastDone(responseId) {
      const { rows } = await db.query<{ id: string; state_mark: string | null }>(
        `SELECT id, state_mark FROM app.prepared_response_test
          WHERE prepared_response_id = $1 AND status = 'done'
          ORDER BY finished_at DESC LIMIT 1`,
        [responseId],
      );
      return rows[0] ? { id: rows[0].id, stateMark: rows[0].state_mark } : null;
    },
    async start(testId, mark) {
      await db.query(`UPDATE app.prepared_response_test SET status = 'running', started_at = NOW(), state_mark = $2 WHERE id = $1`, [testId, mark]);
    },
    async finish(testId, status, fields = {}) {
      await db.query(
        `UPDATE app.prepared_response_test
            SET status = $2, finished_at = NOW(), state_mark = COALESCE($3, state_mark), same_as = $4,
                figures = $5::jsonb, reason = $6, timing = $7::jsonb
          WHERE id = $1`,
        [
          testId,
          status,
          fields.mark ?? null,
          fields.sameAs ?? null,
          fields.figures ? JSON.stringify(fields.figures) : null,
          fields.reason ?? null,
          fields.timing ? JSON.stringify(fields.timing) : null,
        ],
      );
    },
    async world(projectId, scenarioId) {
      const scenario = await getOverlayScenario(db, scenarioId).catch((err) => {
        if (err instanceof AppError && err.code === "SCENARIO_NOT_FOUND") return null;
        throw err;
      });
      if (!scenario || scenario.projectId !== projectId) return null;
      const { rows } = await db.query<{ slug: string }>(`SELECT slug FROM app.project WHERE id = $1`, [projectId]);
      if (!rows[0]) return null;
      const [reality, system, overrides] = await Promise.all([
        buildTwinExport(db, projectId, rows[0].slug),
        buildTwinExport(db, projectId, rows[0].slug, { scenarioId: scenario.id, atOffsetHours: 0 }),
        listOverrides(db, scenario.id),
      ]);
      return { reality, system, scenario: { id: scenario.id, name: scenario.name }, overrides };
    },
  };
}

// ---------------------------------------------------------------------------
// The queue: one run at a time per project.
// ---------------------------------------------------------------------------

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };

/**
 * What went wrong, in a sentence a person can read on the card.
 *
 * `engineDown` says the engine itself is not answering: the responses queued
 * behind this one are then not tried, each would only wait for the same silence.
 */
export function failureOf(err: unknown, limitMs: number = RETEST_TIMEOUT_MS): { status: "abandoned" | "failed"; reason: string; engineDown: boolean } {
  if (err instanceof RetestRefused) return { status: "abandoned", reason: err.message, engineDown: false };
  if (err instanceof RetestTimedOut) {
    return { status: "abandoned", reason: `The engine had not answered after ${duration(limitMs)}, so the test was abandoned.`, engineDown: true };
  }
  if (err instanceof AppError && (err.code === "SIM_UNAVAILABLE" || err.code === "SIM_TIMEOUT")) {
    return { status: "failed", reason: "The simulation engine could not be reached.", engineDown: true };
  }
  if (err instanceof AppError && err.code === "SIM_REFUSED") return { status: "failed", reason: `The engine refused this run: ${err.message}`, engineDown: false };
  return { status: "failed", reason: "The test stopped on an error of ours before giving a result.", engineDown: false };
}

const NOT_TRIED = "The engine did not answer for the response tested just before this one, so this one was not tried.";

const within = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RetestTimedOut()), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

type Queued = { response: PreparedResponse; testId: string };
type Close = (q: Queued, status: RetestStatus, fields?: Finished) => Promise<void>;

export class Retests {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly waiting = new Map<string, Promise<void>>();

  constructor(
    private readonly store: RetestStore,
    private readonly engine: ScenarioEngine,
    private readonly log: Log,
    private readonly limitMs: number = RETEST_TIMEOUT_MS,
  ) {}

  /**
   * A signal opened: test again the responses prepared for its kind.
   *
   * The promise is for whoever wants to wait (a test); the server does not.
   * It never rejects.
   */
  request(signal: { id: string; projectId: string; signalTypeId: string }): Promise<void> {
    const key = `${signal.projectId}|${signal.signalTypeId}`;
    // Signals of one kind opening together: the batch already waiting will test the same responses.
    const already = this.waiting.get(key);
    if (already) return already;
    const work = (this.chains.get(signal.projectId) ?? Promise.resolve()).then(() => {
      this.waiting.delete(key);
      return this.batch(signal);
    });
    this.waiting.set(key, work);
    // A batch closes its own failures; this is so that nothing can ever stop the ones behind it.
    this.chains.set(
      signal.projectId,
      work.catch(() => undefined),
    );
    return work;
  }

  private async batch(signal: { id: string; projectId: string; signalTypeId: string }): Promise<void> {
    const open = new Map<string, Queued>();
    const close: Close = async (q, status, fields) => {
      open.delete(q.testId);
      await this.store.finish(q.testId, status, fields);
    };
    try {
      for (const response of await this.store.responses(signal.projectId, signal.signalTypeId)) {
        if (await this.store.settled(response.id)) continue;
        const testId = await this.store.queue({ responseId: response.id, projectId: signal.projectId, signalId: signal.id });
        open.set(testId, { response, testId });
      }
      // One scenario is read once for all the responses tested on it.
      const groups = new Map<string, Queued[]>();
      for (const q of open.values()) {
        const key = `${q.response.scenarioId ?? "gone"}|${q.response.expected.horizon}|${q.response.expected.activity}`;
        groups.set(key, [...(groups.get(key) ?? []), q]);
      }
      let down = false;
      for (const group of groups.values()) {
        if (down) for (const q of group) await close(q, "failed", { reason: NOT_TRIED });
        else down = await this.group(signal.projectId, group, close);
      }
    } catch (err) {
      this.log.warn({ err, signalId: signal.id }, "retests: a batch stopped");
      const f = failureOf(err, this.limitMs);
      for (const q of [...open.values()]) await close(q, f.status, { reason: f.reason }).catch(() => undefined);
    }
  }

  /** The responses of one scenario, one after another. True when the engine stopped answering. */
  private async group(projectId: string, group: Queued[], close: Close): Promise<boolean> {
    const first = group[0]!.response;
    const giveUp = async (reason: string) => {
      for (const q of group) await close(q, "abandoned", { reason });
      return false;
    };
    const readAt = Date.now();
    const now = first.scenarioId ? await this.store.world(projectId, first.scenarioId) : null;
    if (!now) return giveUp(`The scenario it was tested on (“${first.scenarioName}”) no longer exists, so it cannot be tested again.`);
    const twinMs = Date.now() - readAt;

    const { horizon, activity } = first.expected;
    const runner = new ScenarioRunner(this.engine, { reality: now.reality, system: now.system, scenario: now.scenario, horizon, activity });
    if (!runner.ctx.activities.includes(activity)) return giveUp(`No site provides “${activity}” any more, so there is nothing to read a run on.`);
    const stamps = stampsOf(now.overrides);
    const bench = benchOf(runner, stamps);
    const mark = stateMark(now.system, now.overrides, horizon, activity);

    let down = false;
    for (const q of group) {
      if (down) {
        await close(q, "failed", { mark, reason: NOT_TRIED });
        continue;
      }
      // The state its last test ran on: the run would give the same figures.
      const last = await this.store.lastDone(q.response.id);
      if (last && last.stateMark === mark) {
        await close(q, "unchanged", { mark, sameAs: last.id });
        continue;
      }
      await this.store.start(q.testId, mark);
      const started = Date.now();
      const calls = runner.timings.length;
      const timing = () => ({ twinMs, engine: runner.timings.slice(calls), totalMs: Date.now() - started });
      try {
        const figures = await within(retestOne(runner, bench, stamps, q.response), this.limitMs);
        await close(q, "done", { mark, figures, timing: timing() });
      } catch (err) {
        const f = failureOf(err, this.limitMs);
        if (f.status === "failed") this.log.warn({ err, responseId: q.response.id }, "retest failed");
        await close(q, f.status, { mark, reason: f.reason, timing: timing() });
        down = f.engineDown;
      }
    }
    return down;
  }
}

let running: Retests | null = null;

/**
 * Switch retests on for this process. Without it `requestRetests` does nothing,
 * which is what a test of anything else wants.
 *
 * Rows left queued or running by the process before this one are closed: the
 * queue lives in memory, so nothing will ever run them.
 */
export async function startRetests(pool: { query: unknown }, engine: ScenarioEngine, log: Log): Promise<void> {
  if (running) return;
  const db = pool as DbClient;
  running = new Retests(sqlStore(db), engine, log);
  try {
    await db.query(
      `UPDATE app.prepared_response_test
          SET status = 'abandoned', finished_at = NOW(), reason = 'The server restarted before this test finished.'
        WHERE status IN ('queued', 'running')`,
    );
  } catch (err) {
    log.warn({ err }, "retests: could not close the tests left by the previous process");
  }
  log.info({ timeoutMs: RETEST_TIMEOUT_MS }, "prepared-response retests started");
}

/**
 * A signal opened: test again the responses prepared for its kind.
 *
 * Returns at once; the tests run behind, one at a time for the project. It
 * never throws and never waits on the engine, so raising a signal, reading its
 * card and engaging a response do not depend on it.
 */
export function requestRetests(signal: { id: string; projectId: string; signalTypeId: string }): void {
  void running?.request(signal);
}

/** For tests: forget the process's queue. */
export function stopRetests(): void {
  running = null;
}
