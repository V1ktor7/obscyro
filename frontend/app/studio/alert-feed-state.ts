/**
 * What every page knows about the open alerts, and how it is kept.
 *
 * One reading for the whole studio, made by the shell every few seconds
 * (`AlertFeed.tsx`), in place of a clock per page. This file is the part of it
 * that can be reasoned about without a browser: what counts as a new alert,
 * when the reading is too old to be trusted, and how an age is said.
 */

import type { AlertFeed, FeedAlert, TwinAlert } from "@/lib/platform-api";

import { explainFreshness } from "./twin-ui";

/** How often the feed is read. With the server evaluating every five seconds, an alert is on screen within eight. */
export const POLL_MS = 3_000;

/** Past this without a reading, what is on screen is no longer "now", and the banner says so. */
export const STALE_AFTER_MS = 15_000;

/** How long an alert that opened while somebody was watching stays announced. */
export const NEW_FOR_MS = 120_000;

/** An alert first seen after this screen started watching. */
export interface FirstSight {
  /** This computer's clock when the alert first appeared here. */
  atMs: number;
  /**
   * How long after it opened it was on this screen, by the server's clock on
   * both ends: the part of the delay that is the screen's.
   */
  lagMs: number;
}

export interface FeedState {
  feed: AlertFeed | null;
  /** This computer's clock at the last reading that worked. */
  lastOkAtMs: number | null;
  /** Alerts that opened while this screen was watching, by id. */
  fresh: Record<string, FirstSight>;
}

export const EMPTY_FEED: FeedState = { feed: null, lastOkAtMs: null, fresh: {} };

/**
 * A new reading, taken in.
 *
 * An alert is new when it is in this reading, was not in the one before, and
 * opened since that one. The first reading announces nothing: those alerts
 * were open before anybody looked, and a screen that shouts forty old alerts
 * on arrival teaches people to ignore it.
 *
 * "Since the reading before", not "in the last two minutes": a screen that
 * stopped reading for a quarter of an hour (a computer asleep, a tab the
 * browser froze, a network that dropped) announces on its first reading back
 * what opened while it was not looking. The count in the pill moving from 44
 * to 45 with no word about which one is the silence this banner exists to end.
 */
export function absorb(prev: FeedState, feed: AlertFeed, nowMs: number): FeedState {
  const fresh: Record<string, FirstSight> = {};
  const open = new Set(feed.alerts.map((a) => a.id));
  for (const [id, seen] of Object.entries(prev.fresh)) {
    // Announced until it closes or the announcement has had its time.
    if (open.has(id) && nowMs - seen.atMs < NEW_FOR_MS) fresh[id] = seen;
  }
  if (prev.feed) {
    const known = new Set(prev.feed.alerts.map((a) => a.id));
    const serverNow = Date.parse(feed.at);
    // The server's clock at the reading before, with room for an alert whose
    // row was being written while that reading was made.
    const openedSince = Date.parse(prev.feed.at) - NEW_FOR_MS;
    for (const a of feed.alerts) {
      if (known.has(a.id) || fresh[a.id]) continue;
      const openedMs = Date.parse(a.openedAt);
      // An alert that was already open at the reading before and only now
      // enters the list (the list was full, a filter moved) is not news. A
      // time that cannot be read announces nothing rather than everything.
      if (!(openedMs > openedSince)) continue;
      fresh[a.id] = { atMs: nowMs, lagMs: Math.max(0, serverNow - openedMs) };
    }
  }
  return { feed, lastOkAtMs: nowMs, fresh };
}

/** The same state with the announcements that have had their time taken out. */
export function expire(state: FeedState, nowMs: number): FeedState {
  const fresh = Object.fromEntries(Object.entries(state.fresh).filter(([, s]) => nowMs - s.atMs < NEW_FOR_MS));
  return Object.keys(fresh).length === Object.keys(state.fresh).length ? state : { ...state, fresh };
}

export type FeedStatus = "off" | "loading" | "live" | "stale";

/**
 * Can what is on screen be read as "now"?
 *
 * `stale` is the state worth a sentence: the alerts shown are the last ones
 * read, and an alert that opened since is not there. Silence is not calm.
 */
export function feedStatus(state: FeedState, nowMs: number, enabled: boolean): FeedStatus {
  if (!enabled) return "off";
  if (state.lastOkAtMs === null) return "loading";
  return nowMs - state.lastOkAtMs > STALE_AFTER_MS ? "stale" : "live";
}

/** A duration the way a person says it: "12 s", "4 min", "3 h", "2 d". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** How long ago something happened, counted on the server's clock. */
export function ago(iso: string | null, serverNowIso: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(serverNowIso) - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return ms < 5_000 ? "just now" : `${duration(ms)} ago`;
}

/**
 * How old an alert's value is, said with what the age rests on.
 *
 * Acting fast on an old value is the real danger, so the age never claims more
 * than the twin knows. A floor is said as a floor ("at least 2 h ago"): one of
 * the unit's sources published no time, and the others may be hiding an older
 * reading. An unknown age stays unknown, and `why` carries the reason in the
 * twin's own words, the same sentence the unit's card shows.
 */
export function valueAge(
  a: Pick<FeedAlert, "observedAt" | "observedBasis">,
  serverNowIso: string,
): { text: string; why: string | null } {
  const basis = a.observedBasis ?? null;
  const why = basis && basis !== "observed" ? explainFreshness(basis) : null;
  if (!a.observedAt) return { text: "age of the value unknown", why };
  const ms = Date.parse(serverNowIso) - Date.parse(a.observedAt);
  if (!Number.isFinite(ms)) return { text: "age of the value unknown", why };
  if (basis === "partial") return { text: `value read at least ${duration(ms)} ago`, why };
  return { text: `value read ${ago(a.observedAt, serverNowIso)}`, why };
}

/** The newest alerts that opened while this screen was watching, worst first. */
export function freshAlerts(state: FeedState): FeedAlert[] {
  const rank = { critical: 0, warn: 1, info: 2 } as const;
  return (state.feed?.alerts ?? [])
    .filter((a) => state.fresh[a.id])
    .sort((a, b) => rank[a.severity] - rank[b.severity] || Date.parse(b.openedAt) - Date.parse(a.openedAt));
}

/** The address parameters that open a unit or a signal. Read by the pages that receive the link. */
export const UNIT_PARAM = "unit";
export const SIGNAL_PARAM = "signal";

const link = (path: string, env: string | null, key: string, id: string): string => {
  const q = new URLSearchParams();
  // The project travels in the address: a link to a unit of one project must
  // not open on whichever project this browser looked at last.
  if (env) q.set("env", env);
  q.set(key, id);
  return `${path}?${q.toString()}`;
};

/** Where an alert's unit opens: the units page, with that unit's detail. */
export const unitHref = (unitId: string, env: string | null): string => link("/studio/live", env, UNIT_PARAM, unitId);

/** Where an alert's signal opens: the response board, on that signal. */
export const signalHref = (signalId: string, env: string | null): string => link("/studio/response", env, SIGNAL_PARAM, signalId);

/**
 * The feed's alerts in the shape the twin pages already draw.
 *
 * Those pages each kept their own list on their own clock. They read this one
 * now, so a ward cannot be red on one page and absent from the next.
 */
export function asTwinAlerts(feed: AlertFeed | null): TwinAlert[] {
  return (feed?.alerts ?? []).map((a) => ({
    id: a.id,
    unitInstanceId: a.unitId,
    ruleId: null,
    severity: a.severity,
    metric: a.metric,
    value: a.value,
    message: a.message,
    recommendation: "",
    status: "open",
    observedAt: a.observedAt,
    writtenAt: a.writtenAt,
    createdAt: a.openedAt,
  }));
}
