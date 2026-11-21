import { createHash } from "node:crypto";

import type { DbClient } from "../lib/db.js";
import { NotFound } from "../lib/errors.js";
import type { DecisionDraft, DecisionExpected, SourceStep } from "./decisions.js";
import type { LiveTest } from "./response-retest.js";
import { duration } from "./live-reading.js";
import type { ScenarioOverride } from "./scenario-overrides.js";

/**
 * Prepared responses: what was tested in calm time for a kind of signal, ready
 * to be engaged when a signal of that kind is raised.
 *
 * In an emergency nobody builds a scenario; they apply what was prepared. So
 * the work is done before: an option the engine really tested (the Options tab)
 * is kept for a kind of signal, with the figures of its test, the date of that
 * test and the state it ran on. The situation card of a signal of that kind
 * shows it, and one click engages it.
 *
 * Three things hold, and the code below is where they hold:
 *
 * - only a tested option can be kept. Like a decision, a prepared response is
 *   copied by the server from the journalled exchange; nothing with a figure in
 *   it comes from the browser, so an untested response cannot pass for a
 *   tested one;
 * - "it worked once" is not enough. A response carries the date of its test and
 *   a mark of the scenario it ran on, and says when that test no longer speaks
 *   of the present: the scenario is gone, it has changed, or the test is old;
 * - nothing is ranked. Prepared responses are listed in the order they were
 *   kept; which one to engage is the person's call.
 */

/** A test older than this is said to be old. A statement about the date, not about the response. */
export const OLD_AFTER_DAYS = 30;

export interface PreparedResponse extends DecisionDraft {
  id: string;
  projectId: string;
  signalTypeId: string;
  /** The kind of signal it is prepared for, by name. */
  signalType: string;
  label: string;
  /** Who may approve it, in words: a role, never an account. */
  approver: string | null;
  exchangeId: string | null;
  scenarioId: string | null;
  scenarioName: string;
  scenarioMark: string | null;
  /** When the engine ran the test. */
  testedAt: string;
  keptBy: string | null;
  keptAt: string;
}

// ---------------------------------------------------------------------------
// What state a test ran on, and whether it still speaks of the present.
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
 * A mark of what a scenario holds: its edits, whatever order they were made in
 * and whatever row holds them.
 *
 * Two scenarios with the same choices have the same mark; a choice added,
 * removed or changed gives another. It is what tells, later, that a response
 * was tested on a scenario that is no longer the one on screen.
 */
export function scenarioMark(overrides: ReadonlyArray<Pick<ScenarioOverride, "targetType" | "targetId" | "targetLocalKey" | "op" | "payload" | "effectiveOffsetHours" | "durationHours">>): string {
  const lines = overrides
    .map((o) =>
      canonical({
        t: o.targetType,
        id: o.targetId,
        key: o.targetLocalKey,
        op: o.op,
        payload: o.payload,
        at: o.effectiveOffsetHours,
        for: o.durationHours,
      }),
    )
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

/** The scenario a response was tested on, as it is now. */
export interface ScenarioNow {
  exists: boolean;
  mark: string | null;
}

export interface TestStanding {
  testedAt: string;
  /** How long ago the test ran, the way the screens say a duration. */
  age: string;
  /** True when the test no longer speaks of the present, for any of the reasons below. */
  stale: boolean;
  /** Why, in sentences a person can read before engaging. Empty when nothing is known against the test. */
  reasons: string[];
}

/**
 * Whether a response's test still speaks of the present.
 *
 * Three things can be known without running anything, and each is said: the
 * scenario it ran on no longer exists; that scenario's choices have changed
 * since the response was kept; the test is more than `OLD_AFTER_DAYS` old. None
 * of them says the response is wrong. They say what the figures are figures of.
 */
export function standingOf(r: Pick<PreparedResponse, "testedAt" | "scenarioMark" | "scenarioName">, scenario: ScenarioNow, now: Date): TestStanding {
  const ms = Math.max(0, now.getTime() - Date.parse(r.testedAt));
  const reasons: string[] = [];
  if (!scenario.exists) {
    reasons.push(`The scenario it was tested on (“${r.scenarioName}”) no longer exists, so the test cannot be run again as it was.`);
  } else if (r.scenarioMark && scenario.mark && r.scenarioMark !== scenario.mark) {
    reasons.push(`The scenario it was tested on (“${r.scenarioName}”) has changed since: these figures are those of the scenario as it was.`);
  }
  if (ms > OLD_AFTER_DAYS * 86_400_000) {
    reasons.push(`The test is ${duration(ms)} old. The network it ran on may not be the network now.`);
  }
  return { testedAt: r.testedAt, age: duration(ms), stale: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// On the situation card.
// ---------------------------------------------------------------------------

/** A prepared response as the card shows it: what it changes, what its test gave, and what that test is worth now. */
export interface ResponseOnCard {
  id: string;
  label: string;
  approver: string | null;
  objective: string;
  /** What it does to the scenario, in the words the test's record wrote. */
  changes: string[];
  mechanism: string;
  horizon: number;
  activity: string;
  /** The run with the response, and the same run without it. */
  withIt: DecisionExpected["withOption"];
  without: DecisionExpected["asItIs"];
  /** What the run rests on, counted by level of evidence. */
  evidence: { measured: number; published: number; assumption: number };
  notTested: string[];
  scenarioName: string;
  standing: TestStanding;
  /**
   * What the engine made of it on the network as it is, when a signal of its
   * kind last opened: figures that take the place of the kept test's on the
   * card, a test still running, or why there is none (`response-retest.ts`).
   */
  live: LiveTest;
  keptBy: string | null;
  keptAt: string;
}

/** What an option does, in one line each. Older records hold no `changes`: their stamps are then what the option's own basis says. */
function changesOf(expected: DecisionExpected): string[] {
  const said = (expected.changes ?? []).map((c) =>
    c.does === "replaces" ? `Replaces ${c.was} with ${c.now}` : c.does === "removes" ? `Removes ${c.was}` : `Adds ${c.now}`,
  );
  if (said.length > 0) return said;
  return expected.basis.filter((b) => b.from === "option").map((b) => b.element);
}

export function onCard(r: PreparedResponse, scenario: ScenarioNow, now: Date, live: LiveTest): ResponseOnCard {
  const count = (level: "measured" | "published" | "assumption") => r.expected.basis.filter((b) => b.evidence === level).length;
  return {
    id: r.id,
    label: r.label,
    approver: r.approver,
    objective: r.objective,
    changes: changesOf(r.expected),
    mechanism: r.expected.mechanism,
    horizon: r.expected.horizon,
    activity: r.expected.activity,
    withIt: r.expected.withOption,
    without: r.expected.asItIs,
    evidence: { measured: count("measured"), published: count("published"), assumption: count("assumption") },
    notTested: r.expected.notTested,
    scenarioName: r.scenarioName,
    standing: standingOf(r, scenario, now),
    live,
    keptBy: r.keptBy,
    keptAt: r.keptAt,
  };
}

// ---------------------------------------------------------------------------
// Stored.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  project_id: string;
  signal_type_id: string;
  signal_type_name: string;
  label: string;
  approver: string | null;
  exchange_id: string | null;
  option_step: string;
  scenario_id: string | null;
  scenario_name: string;
  scenario_mark: string | null;
  objective: string;
  option_stamps: DecisionDraft["optionStamps"];
  expected: DecisionExpected;
  source_steps: SourceStep[];
  tested_at: Date;
  kept_by_name: string | null;
  kept_at: Date;
}

const SELECT = `
  SELECT r.id, r.project_id, r.signal_type_id, t.name AS signal_type_name, r.label, r.approver, r.exchange_id,
         r.option_step, r.scenario_id, r.scenario_name, r.scenario_mark, r.objective, r.option_stamps, r.expected,
         r.source_steps, r.tested_at, u.name AS kept_by_name, r.kept_at
    FROM app.prepared_response r
    JOIN app.signal_type t ON t.id = r.signal_type_id
    LEFT JOIN app.users u ON u.id = r.kept_by`;

function out(r: Row): PreparedResponse {
  return {
    id: r.id,
    projectId: r.project_id,
    signalTypeId: r.signal_type_id,
    signalType: r.signal_type_name,
    label: r.label,
    approver: r.approver,
    exchangeId: r.exchange_id,
    optionStep: r.option_step,
    // The option as the test named it; the label is what the person called the response.
    optionLabel: r.label,
    scenarioId: r.scenario_id,
    scenarioName: r.scenario_name,
    scenarioMark: r.scenario_mark,
    objective: r.objective,
    optionStamps: r.option_stamps,
    expected: r.expected,
    sourceSteps: r.source_steps,
    testedAt: r.tested_at.toISOString(),
    keptBy: r.kept_by_name,
    keptAt: r.kept_at.toISOString(),
  };
}

export async function insertPreparedResponse(
  db: DbClient,
  row: {
    projectId: string;
    signalTypeId: string;
    label: string;
    approver: string | null;
    exchangeId: string;
    scenarioId: string | null;
    scenarioName: string;
    scenarioMark: string | null;
    testedAt: Date;
    userId: string;
    draft: DecisionDraft;
  },
): Promise<PreparedResponse> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.prepared_response
            (project_id, signal_type_id, label, approver, exchange_id, option_step, scenario_id, scenario_name,
             scenario_mark, objective, option_stamps, expected, source_steps, tested_at, kept_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15)
     RETURNING id`,
    [
      row.projectId,
      row.signalTypeId,
      row.label,
      row.approver,
      row.exchangeId,
      row.draft.optionStep,
      row.scenarioId,
      row.scenarioName,
      row.scenarioMark,
      row.draft.objective,
      JSON.stringify(row.draft.optionStamps),
      JSON.stringify(row.draft.expected),
      JSON.stringify(row.draft.sourceSteps),
      row.testedAt,
      row.userId,
    ],
  );
  return getPreparedResponse(db, row.projectId, rows[0]!.id);
}

/** The responses prepared in a project, for one kind of signal or for all, in the order they were kept. Never ranked. */
export async function listPreparedResponses(db: DbClient, projectId: string, signalTypeId: string | null = null): Promise<PreparedResponse[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE r.project_id = $1 AND r.retired_at IS NULL AND ($2::uuid IS NULL OR r.signal_type_id = $2::uuid) ORDER BY r.kept_at ASC`,
    [projectId, signalTypeId],
  );
  return rows.map(out);
}

export async function getPreparedResponse(db: DbClient, projectId: string, id: string): Promise<PreparedResponse> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE r.project_id = $1 AND r.id = $2 AND r.retired_at IS NULL`, [projectId, id]);
  if (!rows[0]) throw NotFound("RESPONSE_NOT_FOUND", "That prepared response is not in this project, or it was retired.");
  return out(rows[0]);
}

/** Retired, not erased: a decision may refer to it. */
export async function retirePreparedResponse(db: DbClient, projectId: string, id: string): Promise<void> {
  const { rowCount } = await db.query(`UPDATE app.prepared_response SET retired_at = NOW() WHERE project_id = $1 AND id = $2 AND retired_at IS NULL`, [
    projectId,
    id,
  ]);
  if (!rowCount) throw NotFound("RESPONSE_NOT_FOUND", "That prepared response is not in this project, or it was already retired.");
}

/** The scenarios some responses were tested on, as they stand now. One reading for a whole card. */
export async function scenariosNow(db: DbClient, projectId: string, responses: ReadonlyArray<Pick<PreparedResponse, "scenarioId">>): Promise<Map<string, ScenarioNow>> {
  const ids = [...new Set(responses.map((r) => r.scenarioId).filter((id): id is string => id !== null))];
  const now = new Map<string, ScenarioNow>();
  if (ids.length === 0) return now;
  const [{ rows: scenarios }, { rows: edits }] = await Promise.all([
    db.query<{ id: string }>(`SELECT id FROM app.scenario WHERE project_id = $1 AND id = ANY($2::uuid[])`, [projectId, ids]),
    db.query<{
      scenario_id: string;
      target_type: ScenarioOverride["targetType"];
      target_id: string | null;
      target_local_key: string | null;
      op: ScenarioOverride["op"];
      payload: Record<string, unknown>;
      effective_offset_hours: number;
      duration_hours: number | null;
    }>(
      `SELECT scenario_id, target_type, target_id, target_local_key, op, payload, effective_offset_hours, duration_hours
         FROM app.scenario_override WHERE scenario_id = ANY($1::uuid[])`,
      [ids],
    ),
  ]);
  const alive = new Set(scenarios.map((s) => s.id));
  for (const id of ids) {
    if (!alive.has(id)) {
      now.set(id, { exists: false, mark: null });
      continue;
    }
    const held = edits
      .filter((e) => e.scenario_id === id)
      .map((e) => ({
        targetType: e.target_type,
        targetId: e.target_id,
        targetLocalKey: e.target_local_key,
        op: e.op,
        payload: e.payload,
        effectiveOffsetHours: e.effective_offset_hours,
        durationHours: e.duration_hours,
      }));
    now.set(id, { exists: true, mark: scenarioMark(held) });
  }
  return now;
}

/** The scenario of one response, as it stands now. A response whose scenario id was lost is tested on a scenario that no longer exists. */
export const scenarioOf = (now: ReadonlyMap<string, ScenarioNow>, r: Pick<PreparedResponse, "scenarioId">): ScenarioNow =>
  (r.scenarioId ? now.get(r.scenarioId) : undefined) ?? { exists: false, mark: null };
