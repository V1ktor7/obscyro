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

const S_SELECT = `
  SELECT id, project_id, signal_type_id, stage_id, subject_kind, subject_id, title,
         detail, severity, properties, scenario_id, origin_kind, dedupe_key,
         closed_at, closed_reason, detected_at
    FROM app.signal`;

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
  };
}

export async function listSignals(
  db: DbClient,
  projectId: string,
  opts?: { includeClosed?: boolean; scenarioId?: string | null },
): Promise<Signal[]> {
  const params: unknown[] = [projectId];
  let sql = `${S_SELECT} WHERE project_id = $1`;
  if (!opts?.includeClosed) sql += ` AND closed_at IS NULL`;
  if (opts?.scenarioId === null) sql += ` AND scenario_id IS NULL`;
  else if (opts?.scenarioId) {
    params.push(opts.scenarioId);
    sql += ` AND scenario_id = $${params.length}`;
  }
  sql += ` ORDER BY detected_at DESC LIMIT 500`;
  const { rows } = await db.query<SignalDbRow>(sql, params);
  return rows.map(outSignal);
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
     RETURNING id, project_id, signal_type_id, stage_id, subject_kind, subject_id, title,
               detail, severity, properties, scenario_id, origin_kind, dedupe_key,
               closed_at, closed_reason, detected_at`,
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
    [signalId, `false positive: ${opts.reason.trim()}`],
  );
  await appendEvent(db, signalId, {
    kind: "dismissed",
    fromStageId: signal.stageId,
    actorUserId: opts.actorUserId,
    note: opts.reason.trim(),
  });
  return getSignal(db, signalId);
}
