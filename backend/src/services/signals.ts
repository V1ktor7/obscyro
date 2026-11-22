import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";

// ---------------------------------------------------------------------------
// Signals — the kinetic half of the ontology.
//
// The ontology says what things are. This says what happens about them. A
// signal is something that demands a follow-up: it moves through a workflow
// until it closes, and every step leaves a record of who decided what.
//
// Nothing here is hardcoded per domain. Workflows, their stages and the signal
// types that use them are rows, defined per organization. The engine only knows
// how to advance, approve, close and dismiss — never what "6 Ouest" or
// "rupture de stock" mean.
// ---------------------------------------------------------------------------

export type Severity = "info" | "warn" | "critical";

export interface WorkflowStage {
  id: string;
  workflowId: string;
  seq: number;
  key: string;
  name: string;
  requiresApproval: boolean;
  isTerminal: boolean;
}

export interface Workflow {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  stages: WorkflowStage[];
}

export interface SignalType {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  domain: string;
  workflowId: string;
  defaultSeverity: Severity;
  description: string | null;
  active: boolean;
  /** Twin-alert metric this type consumes. Null = not fed by alerts. */
  alertMetric: string | null;
}

/**
 * What became of the alert a signal came from.
 *
 *   holds         the alert is open: the condition still fires
 *   acknowledged  somebody acknowledged the alert, and the condition still fires
 *   cleared       the evaluator saw the condition stop firing
 */
export type AlertState = "holds" | "acknowledged" | "cleared";

export interface Signal {
  id: string;
  projectId: string;
  signalTypeId: string;
  stageId: string;
  subjectKind: string;
  subjectId: string | null;
  title: string;
  detail: string | null;
  severity: Severity;
  properties: Record<string, unknown>;
  scenarioId: string | null;
  originKind: string;
  dedupeKey: string | null;
  closedAt: string | null;
  closedReason: string | null;
  detectedAt: string;
  /** Null for a signal no alert raised, and for one whose alert is no longer on file. */
  alert: AlertState | null;
}

export interface SignalEvent {
  id: string;
  signalId: string;
  seq: number;
  kind: string;
  fromStageId: string | null;
  toStageId: string | null;
  actorUserId: string | null;
  note: string | null;
  createdAt: string;
}

// --- workflows ---------------------------------------------------------------

export async function listWorkflows(db: DbClient, organizationId: string): Promise<Workflow[]> {
  const { rows: wf } = await db.query<{
    id: string;
    organization_id: string;
    key: string;
    name: string;
    description: string | null;
  }>(
    `SELECT id, organization_id, key, name, description
       FROM app.workflow WHERE organization_id = $1 ORDER BY name ASC`,
    [organizationId],
  );
  if (wf.length === 0) return [];

  const { rows: st } = await db.query<{
    id: string;
    workflow_id: string;
    seq: number;
    key: string;
    name: string;
    requires_approval: boolean;
    is_terminal: boolean;
  }>(
    `SELECT id, workflow_id, seq, key, name, requires_approval, is_terminal
       FROM app.workflow_stage WHERE workflow_id = ANY($1::uuid[]) ORDER BY seq ASC`,
    [wf.map((w) => w.id)],
  );

  return wf.map((w) => ({
    id: w.id,
    organizationId: w.organization_id,
    key: w.key,
    name: w.name,
    description: w.description,
    stages: st
      .filter((s) => s.workflow_id === w.id)
      .map((s) => ({
        id: s.id,
        workflowId: s.workflow_id,
        seq: s.seq,
        key: s.key,
        name: s.name,
        requiresApproval: s.requires_approval,
        isTerminal: s.is_terminal,
      })),
  }));
}

/**
 * Create a workflow and its stages together.
 *
 * A workflow without stages is unusable and a stage list edited piecemeal can
 * leave a signal pointing at a stage that no longer exists, so they are written
 * as one unit.
 */
export async function createWorkflow(
  db: DbClient,
  input: {
    organizationId: string;
    key: string;
    name: string;
    description?: string | null;
    stages: { key: string; name: string; requiresApproval?: boolean; isTerminal?: boolean }[];
  },
): Promise<Workflow> {
  if (input.stages.length < 2) {
    throw BadRequest("WORKFLOW_TOO_SHORT", "A workflow needs at least a first and a last stage.");
  }
  if (!input.stages.some((s) => s.isTerminal)) {
    throw BadRequest(
      "WORKFLOW_NO_TERMINAL",
      "At least one stage has to close the signal, otherwise nothing ever leaves the board.",
    );
  }
  const keys = new Set(input.stages.map((s) => s.key));
  if (keys.size !== input.stages.length) {
    throw BadRequest("WORKFLOW_DUPLICATE_STAGE", "Two stages share the same key.");
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.workflow (organization_id, key, name, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, key) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
     RETURNING id`,
    [input.organizationId, input.key, input.name, input.description ?? null],
  );
  const workflowId = rows[0]!.id;

  for (let i = 0; i < input.stages.length; i++) {
    const s = input.stages[i]!;
    await db.query(
      `INSERT INTO app.workflow_stage (workflow_id, seq, key, name, requires_approval, is_terminal)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workflow_id, key) DO UPDATE
          SET seq = EXCLUDED.seq, name = EXCLUDED.name,
              requires_approval = EXCLUDED.requires_approval,
              is_terminal = EXCLUDED.is_terminal`,
      [workflowId, i, s.key, s.name, s.requiresApproval ?? false, s.isTerminal ?? false],
    );
  }

  const all = await listWorkflows(db, input.organizationId);
  return all.find((w) => w.id === workflowId)!;
}

// --- signal types -------------------------------------------------------------

export async function listSignalTypes(db: DbClient, organizationId: string): Promise<SignalType[]> {
  const { rows } = await db.query<{
    id: string;
    organization_id: string;
    key: string;
    name: string;
    domain: string;
    workflow_id: string;
    default_severity: Severity;
    description: string | null;
    active: boolean;
    alert_metric: string | null;
  }>(
    `SELECT id, organization_id, key, name, domain, workflow_id, default_severity,
            description, active, alert_metric
       FROM app.signal_type WHERE organization_id = $1 ORDER BY domain ASC, name ASC`,
    [organizationId],
  );
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    key: r.key,
    name: r.name,
    domain: r.domain,
    workflowId: r.workflow_id,
    defaultSeverity: r.default_severity,
    description: r.description,
    active: r.active,
    alertMetric: r.alert_metric,
  }));
}

export async function createSignalType(
  db: DbClient,
  input: {
    organizationId: string;
    key: string;
    name: string;
    domain: string;
    workflowId: string;
    defaultSeverity?: Severity;
    description?: string | null;
    alertMetric?: string | null;
  },
): Promise<SignalType> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.signal_type
            (organization_id, key, name, domain, workflow_id, default_severity,
             description, alert_metric)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (organization_id, key) DO UPDATE
        SET name = EXCLUDED.name, domain = EXCLUDED.domain,
            workflow_id = EXCLUDED.workflow_id,
            alert_metric = EXCLUDED.alert_metric, updated_at = NOW()
     RETURNING id`,
    [
      input.organizationId,
      input.key,
      input.name,
      input.domain,
      input.workflowId,
      input.defaultSeverity ?? "warn",
      input.description ?? null,
      input.alertMetric ?? null,
    ],
  );
  const types = await listSignalTypes(db, input.organizationId);
  return types.find((t) => t.id === rows[0]!.id)!;
}

/**
 * Point a signal type at a twin metric, or unhook it.
 *
 * This is the join the alert bridge makes — `st.alert_metric = a.metric` — and
 * until now nothing in the product could set it. A threshold could be defined
 * on a metric no signal type claimed, and the alert reached nobody in silence:
 * the rule looked configured, the twin turned red, the board stayed empty.
 *
 * Only one active type may claim a metric, so a collision is a real decision —
 * which of the two should carry it — and comes back as a conflict rather than
 * quietly stealing the wiring from the other.
 */
export async function setSignalTypeAlertMetric(
  db: DbClient,
  organizationId: string,
  key: string,
  alertMetric: string | null,
  /**
   * Take the metric from whichever type holds it.
   *
   * Off by default, so wiring blind comes back as a conflict naming the holder.
   * The alert-rule panel sets it when the user is looking at that name on
   * screen and asks to raise it as something else: stealing is fine when you
   * can see what you are stealing from.
   */
  reassign = false,
): Promise<SignalType> {
  if (reassign && alertMetric) {
    await db.query(
      `UPDATE app.signal_type SET alert_metric = NULL, updated_at = NOW()
        WHERE organization_id = $1 AND alert_metric = $2 AND key <> $3 AND active`,
      [organizationId, alertMetric, key],
    );
  }
  let rows: { id: string }[];
  try {
    ({ rows } = await db.query<{ id: string }>(
      `UPDATE app.signal_type SET alert_metric = $3, updated_at = NOW()
        WHERE organization_id = $1 AND key = $2 AND active
        RETURNING id`,
      [organizationId, key, alertMetric],
    ));
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== "23505") throw err;
    const taken = (await listSignalTypes(db, organizationId)).find(
      (t) => t.active && t.alertMetric === alertMetric,
    );
    throw Conflict(
      "ALERT_METRIC_TAKEN",
      `"${taken?.name ?? "Another signal type"}" already carries ${alertMetric}. ` +
        "Unhook it first — a metric can only raise one kind of signal.",
    );
  }
  if (rows.length === 0) {
    throw NotFound("SIGNAL_TYPE_NOT_FOUND", `No active signal type with key "${key}".`);
  }
  const types = await listSignalTypes(db, organizationId);
  return types.find((t) => t.id === rows[0]!.id)!;
}

/**
 * Rename a domain across every signal type that carries it.
 *
 * A domain is not a row anywhere — it is whatever string the signal types in it
 * agree on. So renaming one is an update across those types, and a domain with
 * no types simply stops existing. That is the point of leaving it free text:
 * an institution that organises itself around "Bloc opératoire" should not have
 * to wait for us to add an enum value.
 */
export async function renameSignalDomain(
  db: DbClient,
  organizationId: string,
  from: string,
  to: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE app.signal_type SET domain = $3, updated_at = NOW()
      WHERE organization_id = $1 AND domain = $2`,
    [organizationId, from, to],
  );
  return rowCount ?? 0;
}

// --- signals ------------------------------------------------------------------

/**
 * The status of the alert a signal came from, read with the signal.
 *
 * `signal` is the table itself: every statement below reads `app.signal`
 * without an alias, so this fragment and {@link SET_APART} can name it.
 */
const ALERT_STATUS = `(SELECT a.status FROM app.twin_alert a
          WHERE signal.origin_kind = 'twin_alert' AND a.id = signal.origin_id)`;

const S_COLUMNS = `id, project_id, signal_type_id, stage_id, subject_kind, subject_id, title,
         detail, severity, properties, scenario_id, origin_kind, dedupe_key,
         closed_at, closed_reason, detected_at, ${ALERT_STATUS} AS alert_status`;

const S_SELECT = `
  SELECT ${S_COLUMNS}
    FROM app.signal`;

/**
 * A signal the board sets apart: an alert raised it, that alert has cleared,
 * and nobody has acted on it.
 *
 * Both halves matter. An alert that cleared on its own is not a problem
 * somebody fixed, so its signal is never closed for the person: it is put
 * aside, counted, and a person closes it. And a signal somebody has taken up
 * (moved, decided on, annotated) stays on the board they left it on, even
 * after its alert clears: that is work in progress, not noise.
 *
 * "Acted on" is read from the trail: any line a person wrote, or any line
 * that is not the detection or a note. The bridge's own note that the alert
 * cleared is a system note, and does not count.
 */
const SET_APART = `(signal.origin_kind = 'twin_alert'
     AND EXISTS (SELECT 1 FROM app.twin_alert a
                  WHERE a.id = signal.origin_id AND a.status = 'resolved')
     AND NOT EXISTS (SELECT 1 FROM app.signal_event e
                      WHERE e.signal_id = signal.id
                        AND (e.actor_user_id IS NOT NULL OR e.kind NOT IN ('detected', 'noted'))))`;

const ALERT_STATE: Record<string, AlertState> = {
  open: "holds",
  ack: "acknowledged",
  resolved: "cleared",
};

interface SignalDbRow {
  id: string;
  project_id: string;
  signal_type_id: string;
  stage_id: string;
  subject_kind: string;
  subject_id: string | null;
  title: string;
  detail: string | null;
  severity: Severity;
  properties: Record<string, unknown>;
  scenario_id: string | null;
  origin_kind: string;
  dedupe_key: string | null;
  closed_at: Date | null;
  closed_reason: string | null;
  detected_at: Date;
  alert_status?: string | null;
}

function outSignal(r: SignalDbRow): Signal {
  return {
    id: r.id,
    projectId: r.project_id,
    signalTypeId: r.signal_type_id,
    stageId: r.stage_id,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    title: r.title,
    detail: r.detail,
    severity: r.severity,
    properties: r.properties ?? {},
    scenarioId: r.scenario_id,
    originKind: r.origin_kind,
    dedupeKey: r.dedupe_key,
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    closedReason: r.closed_reason,
    detectedAt: r.detected_at.toISOString(),
    alert: (r.alert_status && ALERT_STATE[r.alert_status]) || null,
  };
}

/** A board lists the most recent signals only. What it leaves out is counted, never hidden. */
export const SIGNAL_LIST_LIMIT = 500;

/**
 * Which pile of signals a list is about.
 *
 *   active   what the board shows on arrival: everything it does not set apart
 *   cleared  what it sets apart: raised by an alert that has since cleared, and
 *            that nobody has acted on
 *
 * Left out, a list is about both.
 */
export type SignalView = "active" | "cleared";

export interface SignalListOptions {
  includeClosed?: boolean;
  scenarioId?: string | null;
  view?: SignalView;
  /**
   * One signal to list whatever its age, and whether or not it is closed: the
   * one a link names. A unit over its threshold for weeks has a signal older
   * than the most recent {@link SIGNAL_LIST_LIMIT}, and the alert that links to
   * it is still open.
   */
  also?: string;
}

/** Which signals a list is about: one project, reality or one scenario. */
function signalScope(projectId: string, opts?: SignalListOptions): { where: string; params: unknown[] } {
  const params: unknown[] = [projectId];
  let where = `project_id = $1`;
  if (opts?.scenarioId === null) where += ` AND scenario_id IS NULL`;
  else if (opts?.scenarioId) {
    params.push(opts.scenarioId);
    where += ` AND scenario_id = $${params.length}`;
  }
  return { where, params };
}

function viewClause(view: SignalView | undefined): string {
  if (view === "cleared") return ` AND ${SET_APART}`;
  if (view === "active") return ` AND NOT ${SET_APART}`;
  return "";
}

export async function listSignals(
  db: DbClient,
  projectId: string,
  opts?: SignalListOptions,
): Promise<Signal[]> {
  const { where, params } = signalScope(projectId, opts);
  const open = opts?.includeClosed ? "" : ` AND closed_at IS NULL`;
  const { rows } = await db.query<SignalDbRow>(
    `${S_SELECT} WHERE ${where}${open}${viewClause(opts?.view)} ORDER BY detected_at DESC LIMIT ${SIGNAL_LIST_LIMIT}`,
    params,
  );
  const listed = rows.map(outSignal);
  if (opts?.also && !listed.some((s) => s.id === opts.also)) {
    // Same project, same scenario scope: a link cannot pull in a signal the
    // list itself would never have held. The view is not part of that scope:
    // a link to a signal the board has set apart still opens it.
    const { rows: one } = await db.query<SignalDbRow>(
      `${S_SELECT} WHERE ${where} AND id = $${params.length + 1}`,
      [...params, opts.also],
    );
    if (one[0]) listed.unshift(outSignal(one[0]));
  }
  return listed;
}

/** How many signals {@link listSignals} is choosing from, before its limit. */
export async function countSignals(
  db: DbClient,
  projectId: string,
  opts?: Omit<SignalListOptions, "also">,
): Promise<number> {
  const { where, params } = signalScope(projectId, opts);
  const open = opts?.includeClosed ? "" : ` AND closed_at IS NULL`;
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.signal WHERE ${where}${open}${viewClause(opts?.view)}`,
    params,
  );
  return rows[0]?.n ?? 0;
}

export interface OpenSignalCounts {
  /** Every open signal of the project, reality or one scenario. */
  open: number;
  /** Those the board shows on arrival. */
  active: number;
  /** Those it sets apart: their alert cleared and nobody acted on them. */
  cleared: number;
}

/**
 * The open signals, counted whole: what the board shows on arrival and what it
 * sets apart. A board that puts 2,800 signals aside has to say so in a figure.
 */
export async function countOpenSignals(
  db: DbClient,
  projectId: string,
  opts?: Pick<SignalListOptions, "scenarioId">,
): Promise<OpenSignalCounts> {
  const { where, params } = signalScope(projectId, opts);
  const { rows } = await db.query<{ open: number; cleared: number }>(
    `SELECT count(*)::int AS open, (count(*) FILTER (WHERE ${SET_APART}))::int AS cleared
       FROM app.signal WHERE ${where} AND closed_at IS NULL`,
    params,
  );
  const open = rows[0]?.open ?? 0;
  const cleared = rows[0]?.cleared ?? 0;
  return { open, active: open - cleared, cleared };
}

/**
 * Open signals by type, counted in the database over all of them.
 *
 * The board's counters by domain were counted on the list, which stops at
 * {@link SIGNAL_LIST_LIMIT}: past that many signals they were wrong, and said
 * 500 where there were 2,852.
 */
export async function countOpenByType(
  db: DbClient,
  projectId: string,
  opts?: Pick<SignalListOptions, "scenarioId" | "view">,
): Promise<{ signalTypeId: string; open: number; critical: number }[]> {
  const { where, params } = signalScope(projectId, opts);
  const { rows } = await db.query<{ signal_type_id: string; open: number; critical: number }>(
    `SELECT signal_type_id, count(*)::int AS open,
            (count(*) FILTER (WHERE severity = 'critical'))::int AS critical
       FROM app.signal WHERE ${where} AND closed_at IS NULL${viewClause(opts?.view)}
      GROUP BY signal_type_id`,
    params,
  );
  return rows.map((r) => ({ signalTypeId: r.signal_type_id, open: r.open, critical: r.critical }));
}

/**
 * The board's counters by domain, from the counts by signal type.
 *
 * A domain is the string its signal types share, so the database counts by
 * type and the sum is made here. Every domain is listed, with zeros: a domain
 * with nothing open is still a place a signal can be raised in.
 */
export function domainCounters(
  signalTypes: { id: string; domain: string }[],
  byType: { signalTypeId: string; open: number; critical: number }[],
): { domain: string; open: number; critical: number }[] {
  const domainOf = new Map(signalTypes.map((t) => [t.id, t.domain]));
  const byDomain = new Map<string, { open: number; critical: number }>();
  for (const t of signalTypes) {
    if (!byDomain.has(t.domain)) byDomain.set(t.domain, { open: 0, critical: 0 });
  }
  for (const c of byType) {
    const domain = domainOf.get(c.signalTypeId);
    if (domain === undefined) continue;
    const d = byDomain.get(domain)!;
    d.open += c.open;
    d.critical += c.critical;
  }
  return Array.from(byDomain, ([domain, v]) => ({ domain, ...v })).sort(
    (a, b) => b.critical - a.critical || b.open - a.open || a.domain.localeCompare(b.domain),
  );
}

export async function getSignal(db: DbClient, id: string): Promise<Signal> {
  const { rows } = await db.query<SignalDbRow>(`${S_SELECT} WHERE id = $1`, [id]);
  if (!rows[0]) throw NotFound("SIGNAL_NOT_FOUND", "Signal not found.");
  return outSignal(rows[0]);
}

/** The first stage of a signal type's workflow — where a new signal lands. */
async function firstStage(db: DbClient, signalTypeId: string): Promise<WorkflowStage> {
  const { rows } = await db.query<{
    id: string;
    workflow_id: string;
    seq: number;
    key: string;
    name: string;
    requires_approval: boolean;
    is_terminal: boolean;
  }>(
    `SELECT s.id, s.workflow_id, s.seq, s.key, s.name, s.requires_approval, s.is_terminal
       FROM app.workflow_stage s
       JOIN app.signal_type t ON t.workflow_id = s.workflow_id
      WHERE t.id = $1
      ORDER BY s.seq ASC LIMIT 1`,
    [signalTypeId],
  );
  if (!rows[0]) {
    throw BadRequest("WORKFLOW_EMPTY", "This signal type's workflow has no stages.");
  }
  const r = rows[0];
  return {
    id: r.id,
    workflowId: r.workflow_id,
    seq: r.seq,
    key: r.key,
    name: r.name,
    requiresApproval: r.requires_approval,
    isTerminal: r.is_terminal,
  };
}

export async function raiseSignal(
  db: DbClient,
  input: {
    projectId: string;
    signalTypeId: string;
    title: string;
    detail?: string | null;
    severity?: Severity;
    subjectKind?: string;
    subjectId?: string | null;
    properties?: Record<string, unknown>;
    scenarioId?: string | null;
    originKind?: string;
    originId?: string | null;
    dedupeKey?: string | null;
    actorUserId?: string | null;
  },
): Promise<{ signal: Signal; created: boolean }> {
  const stage = await firstStage(db, input.signalTypeId);

  // A rule that fires every tick must not produce a signal every tick. With a
  // dedupe key the existing open signal is returned untouched rather than a
  // duplicate raised beside it.
  if (input.dedupeKey) {
    const { rows } = await db.query<SignalDbRow>(
      `${S_SELECT} WHERE project_id = $1 AND signal_type_id = $2
                     AND dedupe_key = $3 AND closed_at IS NULL LIMIT 1`,
      [input.projectId, input.signalTypeId, input.dedupeKey],
    );
    if (rows[0]) return { signal: outSignal(rows[0]), created: false };
  }

  const { rows } = await db.query<SignalDbRow>(
    `INSERT INTO app.signal
            (project_id, signal_type_id, stage_id, subject_kind, subject_id, title, detail,
             severity, properties, scenario_id, origin_kind, origin_id, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
     RETURNING ${S_COLUMNS}`,
    [
      input.projectId,
      input.signalTypeId,
      stage.id,
      input.subjectKind ?? "none",
      input.subjectId ?? null,
      input.title,
      input.detail ?? null,
      input.severity ?? "warn",
      JSON.stringify(input.properties ?? {}),
      input.scenarioId ?? null,
      input.originKind ?? "manual",
      input.originId ?? null,
      input.dedupeKey ?? null,
    ],
  );
  const signal = outSignal(rows[0]!);
  await appendEvent(db, signal.id, {
    kind: "detected",
    toStageId: stage.id,
    actorUserId: input.actorUserId ?? null,
  });
  return { signal, created: true };
}

async function appendEvent(
  db: DbClient,
  signalId: string,
  e: {
    kind: string;
    fromStageId?: string | null;
    toStageId?: string | null;
    actorUserId?: string | null;
    note?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { rows } = await db.query<{ next: number }>(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM app.signal_event WHERE signal_id = $1`,
    [signalId],
  );
  await db.query(
    `INSERT INTO app.signal_event
            (signal_id, seq, kind, from_stage_id, to_stage_id, actor_user_id, note, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      signalId,
      rows[0]!.next,
      e.kind,
      e.fromStageId ?? null,
      e.toStageId ?? null,
      e.actorUserId ?? null,
      e.note ?? null,
      JSON.stringify(e.payload ?? {}),
    ],
  );
}

export async function listSignalEvents(db: DbClient, signalId: string): Promise<SignalEvent[]> {
  const { rows } = await db.query<{
    id: string;
    signal_id: string;
    seq: number;
    kind: string;
    from_stage_id: string | null;
    to_stage_id: string | null;
    actor_user_id: string | null;
    note: string | null;
    created_at: Date;
  }>(
    `SELECT id, signal_id, seq, kind, from_stage_id, to_stage_id, actor_user_id, note, created_at
       FROM app.signal_event WHERE signal_id = $1 ORDER BY seq ASC`,
    [signalId],
  );
  return rows.map((r) => ({
    id: r.id,
    signalId: r.signal_id,
    seq: r.seq,
    kind: r.kind,
    fromStageId: r.from_stage_id,
    toStageId: r.to_stage_id,
    actorUserId: r.actor_user_id,
    note: r.note,
    createdAt: r.created_at.toISOString(),
  }));
}

/** The stages of the workflow this signal is on, in order. */
export async function stagesForSignal(db: DbClient, signalId: string): Promise<WorkflowStage[]> {
  const { rows } = await db.query<{
    id: string;
    workflow_id: string;
    seq: number;
    key: string;
    name: string;
    requires_approval: boolean;
    is_terminal: boolean;
  }>(
    `SELECT ws.id, ws.workflow_id, ws.seq, ws.key, ws.name, ws.requires_approval, ws.is_terminal
       FROM app.workflow_stage ws
       JOIN app.signal_type t ON t.workflow_id = ws.workflow_id
       JOIN app.signal s ON s.signal_type_id = t.id
      WHERE s.id = $1
      ORDER BY ws.seq ASC`,
    [signalId],
  );
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflow_id,
    seq: r.seq,
    key: r.key,
    name: r.name,
    requiresApproval: r.requires_approval,
    isTerminal: r.is_terminal,
  }));
}

export type MoveDirection = "forward" | "back";

/**
 * The stage a signal would enter if it moved forward, or the reason it cannot.
 *
 * Asked before anything is written by a caller that writes more than the move
 * (engaging a prepared response records a decision first): the trail is
 * append-only, so a refusal has to come before the first line, not after it.
 */
export async function stageAhead(db: DbClient, signalId: string): Promise<{ signal: Signal; next: WorkflowStage }> {
  const signal = await getSignal(db, signalId);
  if (signal.closedAt) {
    throw Conflict("SIGNAL_CLOSED", "This signal is closed. Reopen it before moving it.");
  }
  const stages = await stagesForSignal(db, signalId);
  const idx = stages.findIndex((s) => s.id === signal.stageId);
  if (idx < 0) throw BadRequest("STAGE_MISSING", "This signal's stage is not on its workflow.");
  const next = stages[idx + 1];
  if (!next) throw BadRequest("NO_SUCH_STAGE", "This signal is already at the last stage.");
  return { signal, next };
}

/**
 * Write on a signal's trail that an option was taken: who, which response, and
 * the decision that records what was expected of it.
 */
export async function recordOptionTaken(
  db: DbClient,
  signalId: string,
  opts: { actorUserId: string; fromStageId: string; note: string; payload: Record<string, unknown> },
): Promise<void> {
  await appendEvent(db, signalId, {
    kind: "option_taken",
    fromStageId: opts.fromStageId,
    actorUserId: opts.actorUserId,
    note: opts.note,
    payload: opts.payload,
  });
}

/**
 * Move a signal one stage.
 *
 * A stage marked requiresApproval cannot be entered without someone named
 * standing behind it — that is the whole point of marking it. Reaching a
 * terminal stage closes the signal.
 */
export async function moveSignal(
  db: DbClient,
  signalId: string,
  direction: MoveDirection,
  opts: { actorUserId: string; note?: string | null; reason?: string | null },
): Promise<Signal> {
  const signal = await getSignal(db, signalId);
  if (signal.closedAt) {
    throw Conflict("SIGNAL_CLOSED", "This signal is closed. Reopen it before moving it.");
  }
  const stages = await stagesForSignal(db, signalId);
  const idx = stages.findIndex((s) => s.id === signal.stageId);
  if (idx < 0) throw BadRequest("STAGE_MISSING", "This signal's stage is not on its workflow.");

  const next = direction === "forward" ? stages[idx + 1] : stages[idx - 1];
  if (!next) {
    throw BadRequest(
      "NO_SUCH_STAGE",
      direction === "forward"
        ? "This signal is already at the last stage."
        : "This signal is already at the first stage.",
    );
  }

  if (next.requiresApproval && direction === "forward" && !opts.actorUserId) {
    throw BadRequest(
      "APPROVAL_REQUIRED",
      `Entering "${next.name}" requires an approval, so it cannot be advanced anonymously.`,
    );
  }

  const closing = next.isTerminal && direction === "forward";
  await db.query(
    `UPDATE app.signal
        SET stage_id = $2,
            closed_at = ${closing ? "NOW()" : "NULL"},
            closed_reason = ${closing ? "$3" : "NULL"},
            updated_at = NOW()
      WHERE id = $1`,
    closing ? [signalId, next.id, opts.reason ?? next.name] : [signalId, next.id],
  );

  await appendEvent(db, signalId, {
    kind: next.requiresApproval && direction === "forward" ? "approved" : direction === "forward" ? "advanced" : "reverted",
    fromStageId: signal.stageId,
    toStageId: next.id,
    actorUserId: opts.actorUserId,
    note: opts.note ?? null,
  });
  if (closing) {
    await appendEvent(db, signalId, {
      kind: "closed",
      toStageId: next.id,
      actorUserId: opts.actorUserId,
      note: opts.reason ?? null,
    });
  }

  return getSignal(db, signalId);
}

/**
 * Close a signal as a false positive.
 *
 * Kept distinct from a normal close on purpose. Alert fatigue is the known way
 * clinical decision support fails, and you cannot measure a false-positive rate
 * if "resolved" and "should never have fired" are the same outcome.
 */
export async function dismissSignal(
  db: DbClient,
  signalId: string,
  opts: { actorUserId: string; reason: string },
): Promise<Signal> {
  if (!opts.reason?.trim()) {
    throw BadRequest("REASON_REQUIRED", "Dismissing a signal needs a reason — that is the record.");
  }
  const signal = await getSignal(db, signalId);
  if (signal.closedAt) throw Conflict("SIGNAL_CLOSED", "This signal is already closed.");

  await db.query(
    `UPDATE app.signal
        SET closed_at = NOW(), closed_reason = $2, updated_at = NOW()
      WHERE id = $1`,
    [signalId, `${FALSE_POSITIVE_PREFIX}${opts.reason.trim()}`],
  );
  await appendEvent(db, signalId, {
    kind: "dismissed",
    fromStageId: signal.stageId,
    actorUserId: opts.actorUserId,
    note: opts.reason.trim(),
  });
  return getSignal(db, signalId);
}

/** How a dismissed signal says it closed. */
export const FALSE_POSITIVE_PREFIX = "false positive: ";

/** What became of the signals one alert rule raised. */
export interface RuleOutcome {
  ruleId: string;
  /** Every signal an alert of this rule raised. */
  raised: number;
  open: number;
  closed: number;
  /** Closed by a person as "should not have fired". */
  falsePositives: number;
  /** Closed in a batch after their alert cleared on its own, with nobody having acted. */
  clearedOnOwn: number;
}

/**
 * What became of the signals each alert rule raised, in one project.
 *
 * Alert fatigue is how decision support fails: a rule that mostly raises
 * signals somebody dismisses teaches people to stop reading. The share of
 * false positives is only readable because a dismissal, a batch close and a
 * resolution close three different ways.
 *
 * Counted on signals that still name their alert's rule: a rule that was
 * deleted keeps its alerts but they no longer say which rule raised them.
 */
export async function ruleOutcomes(db: DbClient, projectId: string): Promise<RuleOutcome[]> {
  const { rows } = await db.query<{ rule_id: string; raised: number; open: number; closed: number; false_positives: number; cleared_on_own: number }>(
    `SELECT a.rule_id,
            count(*)::int AS raised,
            (count(*) FILTER (WHERE s.closed_at IS NULL))::int AS open,
            (count(*) FILTER (WHERE s.closed_at IS NOT NULL))::int AS closed,
            (count(*) FILTER (WHERE s.closed_at IS NOT NULL AND s.closed_reason LIKE $2))::int AS false_positives,
            (count(*) FILTER (WHERE s.closed_at IS NOT NULL AND s.closed_reason LIKE $3))::int AS cleared_on_own
       FROM app.signal s
       JOIN app.twin_alert a ON a.id = s.origin_id
      WHERE s.project_id = $1 AND s.origin_kind = 'twin_alert' AND a.rule_id IS NOT NULL
      GROUP BY a.rule_id`,
    [projectId, `${FALSE_POSITIVE_PREFIX}%`, `${CLEARED_CLOSE_PREFIX}%`],
  );
  return rows.map((r) => ({
    ruleId: r.rule_id,
    raised: r.raised,
    open: r.open,
    closed: r.closed,
    falsePositives: r.false_positives,
    clearedOnOwn: r.cleared_on_own,
  }));
}

/** How a signal closed in a batch says it closed: neither resolved, nor a false positive. */
export const CLEARED_CLOSE_PREFIX = "alert cleared: ";

/**
 * Close, in one go, the signals the board has set apart.
 *
 * A third way to close, kept distinct from the two others on purpose. A
 * signal that reached its last stage was handled; a dismissed one should never
 * have fired; these were real, cleared on their own, and nobody had to act.
 * Mixing them would make all three rates unknowable.
 *
 * A person does this, with a reason, and each signal's own trail keeps who and
 * why: the batch is one click, not one anonymous sweep.
 *
 * One statement, so it closes all of them or none. A signal somebody takes up
 * between the count on screen and the click is no longer set apart, and stays
 * open.
 */
export async function closeClearedSignals(
  db: DbClient,
  projectId: string,
  opts: {
    actorUserId: string;
    reason: string;
    scenarioId?: string | null;
    /** Only the signals of these types: the domain on screen. Left out, every type. */
    signalTypeIds?: string[];
  },
): Promise<number> {
  const reason = opts.reason?.trim();
  if (!reason) {
    throw BadRequest("REASON_REQUIRED", "Closing these signals needs a reason: it is what each signal's log keeps.");
  }
  if (!opts.actorUserId) {
    throw BadRequest("ACTOR_REQUIRED", "Signals are closed by a person, and the log names them.");
  }
  if (opts.signalTypeIds && opts.signalTypeIds.length === 0) return 0;

  const { where, params } = signalScope(projectId, { scenarioId: opts.scenarioId });
  let types = "";
  if (opts.signalTypeIds) {
    params.push(opts.signalTypeIds);
    types = ` AND signal_type_id = ANY($${params.length}::uuid[])`;
  }
  const at = params.length;
  params.push(
    `${CLEARED_CLOSE_PREFIX}${reason}`,
    opts.actorUserId,
    reason,
    JSON.stringify({ reason: "alert_cleared", batch: true }),
  );

  try {
    const { rows } = await db.query<{ n: number }>(
      `WITH target AS (
         SELECT id, stage_id FROM app.signal
          WHERE ${where} AND closed_at IS NULL AND ${SET_APART}${types}
            FOR UPDATE
       ), shut AS (
         UPDATE app.signal s
            SET closed_at = NOW(), closed_reason = $${at + 1}, updated_at = NOW()
           FROM target t
          WHERE s.id = t.id
         RETURNING s.id, t.stage_id
       ), trail AS (
         INSERT INTO app.signal_event (signal_id, seq, kind, from_stage_id, actor_user_id, note, payload)
         SELECT shut.id,
                COALESCE((SELECT MAX(e.seq) FROM app.signal_event e WHERE e.signal_id = shut.id), 0) + 1,
                'closed', shut.stage_id, $${at + 2}, $${at + 3}, $${at + 4}::jsonb
           FROM shut
         RETURNING signal_id
       )
       SELECT count(*)::int AS n FROM trail`,
      params,
    );
    return rows[0]?.n ?? 0;
  } catch (err: unknown) {
    // Another line was written on one of these trails at the same instant.
    // Nothing was closed: a signal is never closed without its line.
    if ((err as { code?: string }).code !== "23505") throw err;
    throw Conflict(
      "SIGNALS_CHANGED",
      "One of these signals changed while they were being closed. Nothing was closed: try again.",
    );
  }
}
