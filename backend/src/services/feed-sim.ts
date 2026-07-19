import type { Pool } from "pg";

import type { DbClient } from "../lib/db.js";

// ---------------------------------------------------------------------------
// Server-side feed simulator: generates realistic healthcare objects and
// POSTs them to channel webhooks. A single scheduler loop runs inside the
// API process, so streams keep feeding while no browser is open and resume
// after restarts (state lives in app.feed_stream).
// ---------------------------------------------------------------------------

export interface FeedStreamConfig {
  targetMode: "channel" | "url";
  channelSlug: string;
  url: string;
  templateMode: "template" | "dataset";
  templateKind: string;
  template: string;
  datasets: { name: string; rows: Record<string, string>[] }[];
  datasetLoop: boolean;
  ratePerSec: number;
  diurnal: boolean;
  weekendDipPct: number;
  maxCount: number;
  abnormalPct: number;
  malformedPct: number;
  duplicatePct: number;
  poolSize: number;
}

export const TEMPLATE_LIBRARY: Record<string, { label: string; template: string }> = {
  admission: {
    label: "Admission note",
    template: `{
  "mrn": "{{patient.mrn}}",
  "text": "Patient de {{patient.age}} ans admis pour {{complaint}}. ATCD: {{history}}. {{finding}}.",
  "site": "{{site}}",
  "recorded_at": "{{now}}"
}`,
  },
  lab: {
    label: "Lab result",
    template: `{
  "mrn": "{{patient.mrn}}",
  "test": "{{lab.code}}",
  "value": {{lab.value}},
  "unit": "{{lab.unit}}",
  "site": "{{site}}",
  "collected_at": "{{now}}"
}`,
  },
  shipment: {
    label: "Supply shipment",
    template: `{
  "shipment_id": "SHP-{{seq}}",
  "item": "{{supply.item}}",
  "quantity": {{supply.qty}},
  "from": "Fournisseur central",
  "to": "{{site}}",
  "eta_hours": {{supply.eta}},
  "sent_at": "{{now}}"
}`,
  },
  transfer: {
    label: "Patient transfer",
    template: `{
  "mrn": "{{patient.mrn}}",
  "from_site": "{{site}}",
  "to_site": "{{site2}}",
  "reason": "{{complaint}}",
  "requested_at": "{{now}}"
}`,
  },
  adt: {
    label: "ADT event",
    template: `{
  "mrn": "{{patient.mrn}}",
  "event": "{{adt.event}}",
  "ward": "{{adt.ward}}",
  "site": "{{site}}",
  "at": "{{now}}"
}`,
  },
};

const LAB_PANEL = [
  { code: "TROPO-I", unit: "ng/L", min: 2, max: 40, abnormalMax: 400 },
  { code: "GLU-F", unit: "mmol/L", min: 3.9, max: 6.1, abnormalMax: 22 },
  { code: "CREAT", unit: "µmol/L", min: 60, max: 110, abnormalMax: 480 },
  { code: "HB", unit: "g/L", min: 120, max: 165, abnormalMax: 60 },
  { code: "K", unit: "mmol/L", min: 3.5, max: 5.1, abnormalMax: 7.4 },
];

const COMPLAINTS = ["douleur thoracique", "dyspnée", "douleur abdominale", "céphalée", "fièvre", "chute"];
const HISTORY = ["diabète type 2", "HTA", "MPOC", "fibrillation auriculaire", "aucun"];
const FINDINGS = [
  "ECG sans anomalie aiguë",
  "sus-décalage ST — IDM probable",
  "saturation 91% à l'air ambiant",
  "examen neurologique normal",
];
const SUPPLIES = ["O2 bottles", "IV kits", "PPE masks", "insuline", "antibiotiques"];
const ADT_EVENTS = ["admit", "transfer", "discharge"];
const WARDS = ["ED", "Ward B", "ICU", "Cardio"];
const FALLBACK_SITES = ["CHUM", "Hôpital Nord", "Clinique Est"];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function mrnFor(index: number): string {
  return `${10 + (index % 90)}-${String(1000 + ((index * 7919) % 9000)).padStart(4, "0")}`;
}

export interface GeneratedObject {
  body: string;
  note: "abnormal" | "malformed" | null;
}

export function generateObject(
  config: FeedStreamConfig,
  seq: number,
  sites: string[],
  datasetRow?: Record<string, string>,
): GeneratedObject {
  const abnormal = Math.random() * 100 < config.abnormalPct;
  const lab = pick(LAB_PANEL);
  const labValue = abnormal
    ? Number(rand(lab.max * 1.5, lab.abnormalMax).toFixed(1))
    : Number(rand(lab.min, lab.max).toFixed(1));
  const sitePool = sites.length > 0 ? sites : FALLBACK_SITES;
  const site = pick(sitePool);
  const others = sitePool.filter((s) => s !== site);
  const site2 = others.length > 0 ? pick(others) : "Hôpital Nord";

  const vars: Record<string, string> = {
    "patient.mrn": mrnFor(Math.floor(Math.random() * Math.max(config.poolSize, 1))),
    "patient.age": String(Math.floor(rand(18, 96))),
    "patient.sex": pick(["F", "M"]),
    "lab.code": lab.code,
    "lab.value": String(labValue),
    "lab.unit": lab.unit,
    site,
    site2,
    now: new Date().toISOString(),
    seq: String(seq),
    complaint: pick(COMPLAINTS),
    history: pick(HISTORY),
    finding: abnormal ? "sus-décalage ST — IDM probable" : pick(FINDINGS),
    "supply.item": pick(SUPPLIES),
    "supply.qty": String(Math.floor(rand(5, 200))),
    "supply.eta": String(Math.floor(rand(1, 24))),
    "adt.event": pick(ADT_EVENTS),
    "adt.ward": pick(WARDS),
  };
  if (datasetRow) {
    for (const [k, v] of Object.entries(datasetRow)) vars[`row.${k}`] = v;
  }

  let body: string;
  if (config.templateMode === "dataset" && datasetRow) {
    body = JSON.stringify(datasetRow);
  } else {
    body = config.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) =>
      vars[key] !== undefined ? vars[key]! : `{{${key}}}`,
    );
  }

  let note: GeneratedObject["note"] = abnormal ? "abnormal" : null;
  if (Math.random() * 100 < config.malformedPct) {
    note = "malformed";
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const keys = Object.keys(parsed);
      if (keys.length > 1) delete parsed[pick(keys)];
      body = JSON.stringify(parsed);
    } catch {
      body = body.slice(0, Math.max(4, Math.floor(body.length * 0.6)));
    }
  }

  return { body, note };
}

/** Rate multiplier: day/night curve (peak 10h–18h) and weekend dip. */
export function rhythmFactor(config: FeedStreamConfig, date: Date): number {
  let factor = 1;
  if (config.diurnal) {
    const h = date.getHours() + date.getMinutes() / 60;
    factor *= 0.35 + 0.65 * Math.max(0, Math.sin(((h - 4) / 20) * Math.PI));
  }
  const day = date.getDay();
  if ((day === 0 || day === 6) && config.weekendDipPct > 0) {
    factor *= 1 - config.weekendDipPct / 100;
  }
  return factor;
}

function publicBase(): string {
  const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  return base.replace(/\/$/, "");
}

/** Resolve the POST target for a stream (channel webhook or raw URL). */
export async function resolveStreamUrl(
  db: DbClient,
  environmentId: string,
  config: FeedStreamConfig,
): Promise<string | null> {
  if (config.targetMode === "url") return config.url.trim() || null;
  if (!config.channelSlug) return null;
  const { rows } = await db.query<{ webhook_token: string | null }>(
    `SELECT s.webhook_token
       FROM app.data_channel c
       LEFT JOIN app.ingest_sources s ON s.id = c.source_id
      WHERE c.environment_id = $1 AND c.slug = $2`,
    [environmentId, config.channelSlug],
  );
  const token = rows[0]?.webhook_token;
  return token ? `${publicBase()}/v1/webhooks/${token}` : null;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const TICK_MS = 1000;
const MAX_SENDS_PER_STREAM_PER_TICK = 10;
const MAX_SENDS_PER_TICK = 50;
const SEND_LOG_KEEP = 200;

interface StreamRuntime {
  acc: number;
  lastBody: string | null;
}

const runtimes = new Map<string, StreamRuntime>();
let schedulerStarted = false;

interface FeedStreamRow {
  id: string;
  environment_id: string;
  name: string;
  config: FeedStreamConfig;
  sent_count: string;
  dataset_index: number;
  surge_until: Date | null;
  surge_factor: number;
  stall_until: Date | null;
}

async function siteNames(db: DbClient, environmentId: string): Promise<string[]> {
  const { rows } = await db.query<{ properties: Record<string, unknown> }>(
    `SELECT oi.properties
       FROM app.ontology_object_instances oi
       JOIN app.ontology_object_types t ON t.id = oi.object_type_id
      WHERE t.environment_id = $1 AND t.nature = 'physical'
      LIMIT 20`,
    [environmentId],
  );
  return rows
    .map((r) => (typeof r.properties?.name === "string" ? (r.properties.name as string) : null))
    .filter((n): n is string => n !== null && n.trim() !== "");
}

async function tickStream(db: DbClient, stream: FeedStreamRow, budget: number): Promise<number> {
  const config = stream.config;
  if (!config || typeof config !== "object" || !config.ratePerSec) return 0;

  const now = Date.now();
  if (stream.stall_until && stream.stall_until.getTime() > now) return 0;
  const surge =
    stream.surge_until && stream.surge_until.getTime() > now ? stream.surge_factor || 1 : 1;

  let rt = runtimes.get(stream.id);
  if (!rt) {
    rt = { acc: 0, lastBody: null };
    runtimes.set(stream.id, rt);
  }

  rt.acc += Math.min(config.ratePerSec, 20) * rhythmFactor(config, new Date()) * surge * (TICK_MS / 1000);
  let toSend = Math.min(Math.floor(rt.acc), MAX_SENDS_PER_STREAM_PER_TICK, budget);
  rt.acc -= Math.floor(rt.acc);
  if (toSend <= 0) return 0;

  const sentTotal = Number(stream.sent_count);
  if (config.maxCount > 0 && sentTotal >= config.maxCount) {
    await db.query(`UPDATE app.feed_stream SET status = 'paused', updated_at = NOW() WHERE id = $1`, [
      stream.id,
    ]);
    return 0;
  }

  const url = await resolveStreamUrl(db, stream.environment_id, config);
  if (!url) {
    await db.query(
      `UPDATE app.feed_stream SET status = 'paused', last_error = 'no webhook target', updated_at = NOW() WHERE id = $1`,
      [stream.id],
    );
    return 0;
  }

  const sites = await siteNames(db, stream.environment_id);
  const datasetRows =
    config.templateMode === "dataset" ? config.datasets.flatMap((d) => d.rows) : [];
  let datasetIndex = stream.dataset_index;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < toSend; i++) {
    let body: string;
    let note: string | null;

    const isDup = rt.lastBody !== null && Math.random() * 100 < config.duplicatePct;
    if (isDup) {
      body = rt.lastBody!;
      note = "duplicate";
    } else if (config.templateMode === "dataset") {
      if (datasetRows.length === 0) {
        await db.query(
          `UPDATE app.feed_stream SET status = 'paused', last_error = 'no dataset rows', updated_at = NOW() WHERE id = $1`,
          [stream.id],
        );
        break;
      }
      if (datasetIndex >= datasetRows.length) {
        if (config.datasetLoop) {
          datasetIndex = 0;
        } else {
          await db.query(
            `UPDATE app.feed_stream SET status = 'paused', last_error = 'dataset finished', dataset_index = $2, updated_at = NOW() WHERE id = $1`,
            [stream.id, datasetIndex],
          );
          break;
        }
      }
      const gen = generateObject(config, sentTotal + sent + 1, sites, datasetRows[datasetIndex]);
      datasetIndex += 1;
      body = gen.body;
      note = gen.note;
    } else {
      const gen = generateObject(config, sentTotal + sent + 1, sites);
      body = gen.body;
      note = gen.note;
    }

    rt.lastBody = body;
    let statusCode: number | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = res.status;
      if (res.ok) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }

    let payload: unknown = body;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = { raw: body };
    }
    await db.query(
      `INSERT INTO app.feed_stream_send (stream_id, payload, status_code, note)
       VALUES ($1, $2::jsonb, $3, $4)`,
      [stream.id, JSON.stringify(payload), statusCode, note],
    );
  }

  await db.query(
    `UPDATE app.feed_stream
        SET sent_count = sent_count + $2,
            failed_count = failed_count + $3,
            dataset_index = $4,
            last_sent_at = CASE WHEN $2 > 0 THEN NOW() ELSE last_sent_at END,
            last_error = CASE WHEN $3 > 0 AND $2 = 0 THEN 'sends failing' ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1`,
    [stream.id, sent, failed, datasetIndex],
  );
  await db.query(
    `DELETE FROM app.feed_stream_send
      WHERE stream_id = $1
        AND id NOT IN (
          SELECT id FROM app.feed_stream_send
           WHERE stream_id = $1 ORDER BY created_at DESC LIMIT ${SEND_LOG_KEEP}
        )`,
    [stream.id],
  );
  return sent + failed;
}

/** Start the feed scheduler. Call once after the server begins listening. */
export function startFeedScheduler(pool: Pool, log: { info: (msg: string) => void; error: (obj: unknown, msg?: string) => void }): void {
  if (schedulerStarted) return;
  if (process.env.FEED_SIM_DISABLED === "1") {
    log.info("feed-sim scheduler disabled (FEED_SIM_DISABLED=1)");
    return;
  }
  schedulerStarted = true;
  log.info("feed-sim scheduler started");

  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      try {
        const { rows } = await pool.query<FeedStreamRow>(
          `SELECT id, environment_id, name, config, sent_count, dataset_index,
                  surge_until, surge_factor, stall_until
             FROM app.feed_stream
            WHERE status = 'running'
            ORDER BY created_at ASC
            LIMIT 50`,
        );
        let budget = MAX_SENDS_PER_TICK;
        for (const stream of rows) {
          if (budget <= 0) break;
          try {
            budget -= await tickStream(pool, stream, budget);
          } catch (err) {
            log.error(err, `feed-sim stream ${stream.id} tick failed`);
          }
        }
        // Drop runtimes for streams that no longer run.
        const active = new Set(rows.map((r) => r.id));
        for (const id of runtimes.keys()) {
          if (!active.has(id)) runtimes.delete(id);
        }
      } catch (err) {
        log.error(err, "feed-sim scheduler tick failed");
      } finally {
        ticking = false;
      }
    })();
  }, TICK_MS);
}
