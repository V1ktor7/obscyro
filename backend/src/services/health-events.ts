import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";
import { DOORS, type CandidatePassage, type Door } from "./analyst-events.js";

/**
 * The calendar of events: what was happening around the network, taken from
 * official sources and accepted by a person.
 *
 * The analyst proposes candidates (`analyst-events.ts`); this is where one
 * becomes an event. Two rules keep the calendar honest:
 *
 * - nothing enters without a click. There is no route that records a
 *   candidate as "proposed" or "rejected": accepting inserts a row, rejecting
 *   calls nothing, and an event exists only as an accepted row;
 * - the browser names a candidate and sends the dates the person validated —
 *   the one thing a person is asked to correct. The title, the place, the
 *   link and the quoted passage are copied here, by the server, from its own
 *   journal of the search (`app.analyst_exchange`). A candidate the search did
 *   not deliver cannot be accepted.
 */

export interface HealthEvent {
  id: string;
  title: string;
  place: string;
  door: Door;
  /** The dates the person validated, YYYY-MM-DD. `endsOn` null: one day, or no stated end. */
  startsOn: string;
  endsOn: string | null;
  /** What the analyst proposed, kept beside what was validated. */
  proposedStartsOn: string | null;
  proposedEndsOn: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
  /** The short quoted passage. */
  passage: string;
  /** Every passage the candidate rested on. */
  sources: CandidatePassage[];
  proposedByAnalyst: boolean;
  exchangeId: string | null;
  candidate: string | null;
  /** Who accepted it, by name; null when the account is gone. */
  validatedBy: string | null;
  validatedAt: string;
}

export type HealthEventDraft = Pick<
  HealthEvent,
  "title" | "place" | "door" | "startsOn" | "endsOn" | "proposedStartsOn" | "proposedEndsOn" | "sourceUrl" | "sourceTitle" | "passage" | "sources" | "candidate"
>;

/** A journalled exchange, as much of it as an acceptance reads. */
export interface JournalledSearch {
  kind: string;
  status: string;
  answer: unknown;
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const journalledCandidate = z.object({
  id: z.string(),
  title: z.string().min(1),
  startDate: isoDay.nullable(),
  endDate: isoDay.nullable(),
  place: z.string().min(1),
  door: z.enum(DOORS),
  url: z.string().min(1),
  sourceTitle: z.string(),
  quote: z.string().min(1),
  passages: z.array(z.object({ step: z.string(), url: z.string(), title: z.string(), text: z.string() })),
});
const journalledProposal = z.object({ candidates: z.array(journalledCandidate) });

const realDay = (iso: string): boolean => {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/**
 * The event an exchange supports for one of its candidates, on the dates the
 * person validated.
 *
 * Everything but the dates is read from the journal.
 */
export function eventFromExchange(exchange: JournalledSearch, candidateId: string, dates: { startsOn: string; endsOn: string | null }): HealthEventDraft {
  // A search and an investigation deliver the same candidates: an investigation is a search with the series beside it.
  if ((exchange.kind !== "events" && exchange.kind !== "investigation") || exchange.status !== "answered") {
    throw BadRequest("NOT_AN_EVENTS_EXCHANGE", "An event is accepted from a search that delivered candidates. This exchange is not one.");
  }
  const proposal = journalledProposal.safeParse(exchange.answer);
  if (!proposal.success) {
    throw BadRequest("EXCHANGE_UNREADABLE", "The journalled search cannot be read as candidate events, so nothing can be accepted from it.");
  }
  const c = proposal.data.candidates.find((x) => x.id === candidateId);
  if (!c) {
    throw BadRequest("NOT_A_CANDIDATE", `"${candidateId}" is not a candidate this search delivered. Only a delivered candidate can be accepted.`);
  }
  if (!realDay(dates.startsOn) || (dates.endsOn !== null && !realDay(dates.endsOn))) {
    throw BadRequest("EVENT_DATES_INVALID", "A date is not a day of the calendar. Write it as YYYY-MM-DD.");
  }
  if (dates.endsOn !== null && dates.endsOn < dates.startsOn) {
    throw BadRequest("EVENT_DATES_INVALID", "The event ends before it starts. Correct the dates.");
  }
  return {
    title: c.title,
    place: c.place,
    door: c.door,
    startsOn: dates.startsOn,
    endsOn: dates.endsOn,
    proposedStartsOn: c.startDate,
    proposedEndsOn: c.endDate,
    sourceUrl: c.url,
    sourceTitle: c.sourceTitle || null,
    passage: c.quote,
    sources: c.passages,
    candidate: c.id,
  };
}

interface EventDbRow {
  id: string;
  title: string;
  place: string;
  door: Door;
  starts_on: string;
  ends_on: string | null;
  proposed_starts_on: string | null;
  proposed_ends_on: string | null;
  source_url: string;
  source_title: string | null;
  passage: string;
  sources: CandidatePassage[];
  proposed_by_analyst: boolean;
  exchange_id: string | null;
  candidate: string | null;
  validated_by_name: string | null;
  validated_at: Date;
}

// Dates leave the database as text: a DATE read as a JavaScript Date lands on
// local midnight and can come back a day early.
const SELECT = `
  SELECT e.id, e.title, e.place, e.door,
         to_char(e.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(e.ends_on, 'YYYY-MM-DD') AS ends_on,
         to_char(e.proposed_starts_on, 'YYYY-MM-DD') AS proposed_starts_on,
         to_char(e.proposed_ends_on, 'YYYY-MM-DD') AS proposed_ends_on,
         e.source_url, e.source_title, e.passage, e.sources, e.proposed_by_analyst, e.exchange_id, e.candidate,
         u.name AS validated_by_name, e.validated_at
    FROM app.health_event e
    LEFT JOIN app.users u ON u.id = e.validated_by`;

function outEvent(r: EventDbRow): HealthEvent {
  return {
    id: r.id,
    title: r.title,
    place: r.place,
    door: r.door,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    proposedStartsOn: r.proposed_starts_on,
    proposedEndsOn: r.proposed_ends_on,
    sourceUrl: r.source_url,
    sourceTitle: r.source_title,
    passage: r.passage,
    sources: r.sources,
    proposedByAnalyst: r.proposed_by_analyst,
    exchangeId: r.exchange_id,
    candidate: r.candidate,
    validatedBy: r.validated_by_name,
    validatedAt: r.validated_at.toISOString(),
  };
}

/** The search an event is being accepted from, when it belongs to the project. */
export async function exchangeForEvent(db: DbClient, projectId: string, exchangeId: string): Promise<JournalledSearch> {
  const { rows } = await db.query<{ kind: string; status: string; answer: unknown }>(
    `SELECT kind, status, answer FROM app.analyst_exchange WHERE id = $1 AND project_id = $2`,
    [exchangeId, projectId],
  );
  const r = rows[0];
  if (!r) throw NotFound("EXCHANGE_NOT_FOUND", "That search is not in this project's journal. Search again, then accept the event.");
  return r;
}

export async function insertHealthEvent(
  db: DbClient,
  row: { projectId: string; exchangeId: string; userId: string; draft: HealthEventDraft },
): Promise<HealthEvent> {
  const d = row.draft;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.health_event
            (project_id, title, place, door, starts_on, ends_on, proposed_starts_on, proposed_ends_on,
             source_url, source_title, passage, sources, proposed_by_analyst, exchange_id, candidate, validated_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::date, $8::date, $9, $10, $11, $12::jsonb, TRUE, $13, $14, $15)
     ON CONFLICT (exchange_id, candidate) WHERE exchange_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      row.projectId,
      d.title,
      d.place,
      d.door,
      d.startsOn,
      d.endsOn,
      d.proposedStartsOn,
      d.proposedEndsOn,
      d.sourceUrl,
      d.sourceTitle,
      d.passage,
      JSON.stringify(d.sources),
      row.exchangeId,
      d.candidate,
      row.userId,
    ],
  );
  if (!rows[0]) throw Conflict("EVENT_ALREADY_ACCEPTED", "This candidate is already in the calendar.");
  return getHealthEvent(db, row.projectId, rows[0].id);
}

/** The project's events that touch a period, earliest first. Both ends are optional. */
export async function listHealthEvents(
  db: DbClient,
  projectId: string,
  window: { from?: string | null; to?: string | null } = {},
  limit = 500,
): Promise<HealthEvent[]> {
  const { rows } = await db.query<EventDbRow>(
    `${SELECT}
      WHERE e.project_id = $1
        AND ($2::date IS NULL OR COALESCE(e.ends_on, e.starts_on) >= $2::date)
        AND ($3::date IS NULL OR e.starts_on <= $3::date)
      ORDER BY e.starts_on, e.validated_at
      LIMIT $4`,
    [projectId, window.from ?? null, window.to ?? null, limit],
  );
  return rows.map(outEvent);
}

export async function getHealthEvent(db: DbClient, projectId: string, id: string): Promise<HealthEvent> {
  const { rows } = await db.query<EventDbRow>(`${SELECT} WHERE e.project_id = $1 AND e.id = $2`, [projectId, id]);
  if (!rows[0]) throw NotFound("EVENT_NOT_FOUND", "Event not found.");
  return outEvent(rows[0]);
}

/** Takes an event out of the calendar: a person's click, like the one that put it there. */
export async function deleteHealthEvent(db: DbClient, projectId: string, id: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM app.health_event WHERE project_id = $1 AND id = $2 RETURNING id`, [projectId, id]);
  if (!rows[0]) throw NotFound("EVENT_NOT_FOUND", "Event not found.");
}
