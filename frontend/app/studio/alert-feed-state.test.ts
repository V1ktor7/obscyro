import { describe, expect, it } from "vitest";

import type { AlertFeed, FeedAlert } from "@/lib/platform-api";

import {
  EMPTY_FEED,
  NEW_FOR_MS,
  STALE_AFTER_MS,
  absorb,
  ago,
  asTwinAlerts,
  duration,
  expire,
  feedStatus,
  freshAlerts,
  signalHref,
  unitHref,
} from "./alert-feed-state";

const alert = (over: Partial<FeedAlert> = {}): FeedAlert => ({
  id: "a1",
  unitId: "u1",
  unitName: "Urgence — Hôpital A",
  severity: "critical",
  metric: "occupancy",
  value: 132,
  message: "Urgence — Hôpital A — 132 %",
  openedAt: "2026-11-19T15:00:04.000Z",
  observedAt: "2026-11-19T14:00:00.000Z",
  writtenAt: "2026-11-19T15:00:01.000Z",
  signalId: "s1",
  ...over,
});

const feed = (alerts: FeedAlert[], at = "2026-11-19T15:00:10.000Z"): AlertFeed => ({
  at,
  alerts,
  counts: { critical: alerts.filter((a) => a.severity === "critical").length, warn: alerts.filter((a) => a.severity === "warn").length, info: 0 },
  omitted: 0,
  signals: { open: alerts.length, changedAt: null },
  evaluation: { lastAt: at, lastMs: 180, everyMs: 5180 },
});

const T0 = 1_000_000;

describe("what counts as a new alert", () => {
  it("announces nothing on the first reading: those alerts were open before anybody looked", () => {
    const state = absorb(EMPTY_FEED, feed([alert(), alert({ id: "a2" })]), T0);
    expect(state.fresh).toEqual({});
    expect(state.lastOkAtMs).toBe(T0);
  });

  it("announces an alert that is in this reading and was not in the one before", () => {
    const first = absorb(EMPTY_FEED, feed([alert()]), T0);
    const opened = alert({ id: "a2", openedAt: "2026-11-19T15:00:11.000Z" });
    const second = absorb(first, feed([opened, alert()], "2026-11-19T15:00:13.000Z"), T0 + 3000);
    // On this screen two seconds after it opened, by the server's clock on both ends.
    expect(second.fresh).toEqual({ a2: { atMs: T0 + 3000, lagMs: 2000 } });
    expect(freshAlerts(second).map((a) => a.id)).toEqual(["a2"]);
  });

  it("keeps announcing it across readings, until it closes or two minutes have passed", () => {
    const first = absorb(EMPTY_FEED, feed([alert()]), T0);
    const opened = alert({ id: "a2", openedAt: "2026-11-19T15:00:11.000Z" });
    const second = absorb(first, feed([opened, alert()], "2026-11-19T15:00:13.000Z"), T0 + 3000);
    const third = absorb(second, feed([opened, alert()], "2026-11-19T15:00:16.000Z"), T0 + 6000);
    expect(third.fresh.a2).toEqual({ atMs: T0 + 3000, lagMs: 2000 });

    expect(expire(third, T0 + 3000 + NEW_FOR_MS - 1).fresh.a2).toBeDefined();
    expect(expire(third, T0 + 3000 + NEW_FOR_MS).fresh).toEqual({});
    // Resolved or acknowledged: it leaves the list, and the announcement with it.
    expect(absorb(third, feed([alert()], "2026-11-19T15:00:19.000Z"), T0 + 9000).fresh).toEqual({});
  });

  it("does not call news an old alert that only now enters the list", () => {
    const first = absorb(EMPTY_FEED, feed([alert()]), T0);
    const old = alert({ id: "a9", openedAt: "2026-11-19T12:00:00.000Z" });
    expect(absorb(first, feed([alert(), old]), T0 + 3000).fresh).toEqual({});
  });

  it("puts the worst new alert first, then the newest", () => {
    const first = absorb(EMPTY_FEED, feed([]), T0);
    const second = absorb(
      first,
      feed(
        [
          alert({ id: "w", severity: "warn", openedAt: "2026-11-19T15:00:09.000Z" }),
          alert({ id: "c1", openedAt: "2026-11-19T15:00:07.000Z" }),
          alert({ id: "c2", openedAt: "2026-11-19T15:00:08.000Z" }),
        ],
        "2026-11-19T15:00:10.000Z",
      ),
      T0 + 3000,
    );
    expect(freshAlerts(second).map((a) => a.id)).toEqual(["c2", "c1", "w"]);
  });
});

describe("whether what is on screen can be read as now", () => {
  it("is off without a project, loading before the first reading, live after it", () => {
    expect(feedStatus(EMPTY_FEED, T0, false)).toBe("off");
    expect(feedStatus(EMPTY_FEED, T0, true)).toBe("loading");
    expect(feedStatus(absorb(EMPTY_FEED, feed([]), T0), T0 + 3000, true)).toBe("live");
  });

  it("turns stale when readings stop: silence is not calm", () => {
    const state = absorb(EMPTY_FEED, feed([alert()]), T0);
    expect(feedStatus(state, T0 + STALE_AFTER_MS, true)).toBe("live");
    expect(feedStatus(state, T0 + STALE_AFTER_MS + 1, true)).toBe("stale");
    // The last list is still there to read, marked as old.
    expect(state.feed!.alerts).toHaveLength(1);
  });
});

describe("how an age is said", () => {
  it("counts on the server's clock, in the unit a person would use", () => {
    const now = "2026-11-19T15:00:10.000Z";
    expect(ago("2026-11-19T15:00:08.000Z", now)).toBe("just now");
    expect(ago("2026-11-19T14:59:28.000Z", now)).toBe("42 s ago");
    expect(ago("2026-11-19T14:23:10.000Z", now)).toBe("37 min ago");
    expect(ago("2026-11-19T12:00:10.000Z", now)).toBe("3 h ago");
    expect(ago("2026-11-16T15:00:10.000Z", now)).toBe("3 d ago");
    expect(duration(0)).toBe("0 s");
    expect(duration(5180)).toBe("5 s");
  });

  it("says nothing rather than something false when the time is unknown", () => {
    expect(ago(null, "2026-11-19T15:00:10.000Z")).toBeNull();
    expect(ago("not a date", "2026-11-19T15:00:10.000Z")).toBeNull();
  });
});

describe("where an alert leads", () => {
  it("opens its unit and its signal, in the project it belongs to", () => {
    expect(unitHref("u-1", "mtl")).toBe("/studio/live?env=mtl&unit=u-1");
    expect(signalHref("s-1", "mtl")).toBe("/studio/response?env=mtl&signal=s-1");
    expect(unitHref("u-1", null)).toBe("/studio/live?unit=u-1");
  });
});

describe("the feed's alerts, as the twin pages draw them", () => {
  it("keeps the unit, the severity, the value and both times", () => {
    expect(asTwinAlerts(feed([alert()]))).toEqual([
      {
        id: "a1",
        unitInstanceId: "u1",
        ruleId: null,
        severity: "critical",
        metric: "occupancy",
        value: 132,
        message: "Urgence — Hôpital A — 132 %",
        recommendation: "",
        status: "open",
        observedAt: "2026-11-19T14:00:00.000Z",
        writtenAt: "2026-11-19T15:00:01.000Z",
        createdAt: "2026-11-19T15:00:04.000Z",
      },
    ]);
    expect(asTwinAlerts(null)).toEqual([]);
  });
});
