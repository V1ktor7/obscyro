// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AlertFeed, FeedAlert } from "@/lib/platform-api";

const api = vi.hoisted(() => ({ fetchAlertFeed: vi.fn() }));
vi.mock("@/lib/platform-api", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-api")>()), ...api }));

import { AlertPill, AlertStrip } from "./AlertBanner";
import { AlertFeedContext, AlertFeedProvider, type AlertFeedValue } from "./AlertFeed";
import { POLL_MS, STALE_AFTER_MS } from "./alert-feed-state";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const alert = (over: Partial<FeedAlert> = {}): FeedAlert => ({
  id: "a1",
  unitId: "u1",
  unitName: "Urgence — Hôpital A",
  severity: "critical",
  metric: "occupancy",
  value: 132,
  message: "Urgence — Hôpital A — 132 %",
  openedAt: "2026-11-19T14:56:10.000Z",
  observedAt: "2026-11-19T14:23:10.000Z",
  writtenAt: "2026-11-19T14:56:07.000Z",
  signalId: "s1",
  ...over,
});

const feed = (alerts: FeedAlert[], over: Partial<AlertFeed> = {}): AlertFeed => ({
  at: "2026-11-19T15:00:10.000Z",
  alerts,
  counts: {
    critical: alerts.filter((a) => a.severity === "critical").length,
    warn: alerts.filter((a) => a.severity === "warn").length,
    info: alerts.filter((a) => a.severity === "info").length,
  },
  omitted: 0,
  signals: { open: alerts.length, changedAt: null },
  evaluation: { lastAt: "2026-11-19T15:00:07.000Z", lastMs: 180, everyMs: 5180 },
  ...over,
});

const value = (over: Partial<AlertFeedValue> = {}): AlertFeedValue => ({
  feed: feed([alert()]),
  status: "live",
  fresh: {},
  lastOkAtMs: Date.now(),
  refresh: async () => {},
  dismiss: vi.fn(),
  ...over,
});

function shell(v: AlertFeedValue) {
  return render(
    <AlertFeedContext.Provider value={v}>
      <AlertPill env="mtl" />
      <AlertStrip env="mtl" />
    </AlertFeedContext.Provider>,
  );
}

describe("the standing summary of open alerts", () => {
  it("says how many are open, and lists each with its unit, its ages and where it leads", () => {
    shell(value({ feed: feed([alert(), alert({ id: "a2", severity: "warn", message: "CHSLD B — 96 %", unitId: "u2", observedAt: null, signalId: null })]) }));
    const pill = screen.getByRole("button", { name: "Open alerts: 1 critical, 1 warning" });
    fireEvent.click(pill);

    const list = screen.getByRole("dialog", { name: "Open alerts" });
    expect(within(list).getByText(/2 open alerts/)).toBeTruthy();
    // When the thresholds were last checked: "nothing is wrong" is not "nobody has looked".
    expect(within(list).getByText(/Thresholds checked just now, every 5 s\./)).toBeTruthy();
    expect(within(list).getByText(/never a person/)).toBeTruthy();

    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Urgence — Hôpital A — 132 %")).toBeTruthy();
    // Open for four minutes, on a value that is thirty-seven minutes old: two different facts.
    expect(within(rows[0]!).getByText("opened 4 min ago · value read 37 min ago")).toBeTruthy();
    expect(within(rows[0]!).getByRole("link", { name: "Open unit" }).getAttribute("href")).toBe("/studio/live?env=mtl&unit=u1");
    // The card first: it carries the alert, its unit and its signal, so it still reads the unit once the alert has cleared.
    expect(within(rows[0]!).getByRole("link", { name: "Situation" }).getAttribute("href")).toBe("/studio/situation?env=mtl&alert=a1&unit=u1&signal=s1");
    expect(within(rows[0]!).getByRole("link", { name: "Signal" }).getAttribute("href")).toBe("/studio/response?env=mtl&signal=s1");

    // A source that publishes no time: the age is unknown, and said so. No signal: no link to one.
    expect(within(rows[1]!).getByText("opened 4 min ago · age of the value unknown")).toBeTruthy();
    expect(within(rows[1]!).queryByRole("link", { name: "Signal" })).toBeNull();
  });

  it("says a floor as a floor, and gives the reason an age is unknown", () => {
    shell(
      value({
        feed: feed([
          alert({ observedAt: "2026-11-19T13:00:10.000Z", observedBasis: "partial" }),
          alert({ id: "a2", message: "Urgence — Hôpital C — 111 %", unitId: "u3", observedAt: null, observedBasis: "undeclared" }),
        ]),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open alerts: 2 critical" }));
    const rows = within(screen.getByRole("dialog", { name: "Open alerts" })).getAllByRole("listitem");

    // The qualifier is in the text, where it is read; the reason is one hover away.
    const floor = within(rows[0]!).getByText("opened 4 min ago · value read at least 2 h ago");
    expect(floor.getAttribute("title")).toMatch(/^At least this old/);
    const unknown = within(rows[1]!).getByText("opened 4 min ago · age of the value unknown");
    expect(unknown.getAttribute("title")).toMatch(/no property of what this measure reads is declared/);
  });

  it("is not shown at all for a calm project whose feed works", () => {
    shell(value({ feed: feed([]) }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when the list has stopped updating, alerts or not", () => {
    shell(value({ feed: feed([]), status: "stale", lastOkAtMs: Date.now() - 40_000 }));
    fireEvent.click(screen.getByRole("button", { name: "Open alerts: none, not updating" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Not updated for 40 s\. This is the last list that could be read: an alert that opened since\s+is not in it\./);
  });

  it("counts what the list leaves out", () => {
    shell(value({ feed: feed([alert()], { counts: { critical: 240, warn: 0, info: 0 }, omitted: 239 }) }));
    fireEvent.click(screen.getByRole("button", { name: "Open alerts: 240 critical" }));
    expect(screen.getByText(/239 more open, not listed here/)).toBeTruthy();
  });

  it("closes on Escape", () => {
    shell(value());
    fireEvent.click(screen.getByRole("button", { name: /Open alerts/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the interruption for an alert that just opened", () => {
  it("is silent for alerts that were already open", () => {
    shell(value());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/New ·/)).toBeNull();
  });

  it("announces a new critical alert with a way to its unit, and how late this screen was", () => {
    const opened = alert({ id: "a2", message: "Urgence — Hôpital C — 141 %", unitId: "u3", openedAt: "2026-11-19T15:00:08.000Z", signalId: null });
    const v = value({ feed: feed([opened, alert()]), fresh: { a2: { atMs: Date.now(), lagMs: 2000 } } });
    shell(v);

    // Interrupts a screen reader: it is critical.
    const strip = screen.getByRole("alert");
    expect(within(strip).getByText("New · Critical")).toBeTruthy();
    expect(within(strip).getByText("Urgence — Hôpital C — 141 %")).toBeTruthy();
    expect(within(strip).getByRole("link", { name: "Open unit" }).getAttribute("href")).toBe("/studio/live?env=mtl&unit=u3");

    expect(screen.getByRole("button", { name: /Open alerts: 2 critical/ }).textContent).toMatch(/1 new/);
    fireEvent.click(screen.getByRole("button", { name: /Open alerts/ }));
    expect(screen.getByText(/on this screen 2 s after it opened/)).toBeTruthy();

    // Dismissing stops the announcement here. It does nothing to the alert.
    fireEvent.click(within(strip).getByRole("button", { name: "Stop announcing: Urgence — Hôpital C — 141 %" }));
    expect(v.dismiss).toHaveBeenCalledWith("a2");
  });

  it("lets a warning wait its turn instead of interrupting", () => {
    const w = alert({ id: "w1", severity: "warn", message: "CHSLD B — 96 %" });
    shell(value({ feed: feed([w]), fresh: { w1: { atMs: Date.now(), lagMs: 1000 } } }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getByRole("status")).getByText("New · Warning")).toBeTruthy();
  });

  it("shows two at a time and says how many more there are", () => {
    const news = ["n1", "n2", "n3", "n4"].map((id) => alert({ id, message: `Unit ${id}`, openedAt: "2026-11-19T15:00:08.000Z" }));
    shell(value({ feed: feed(news), fresh: Object.fromEntries(news.map((a) => [a.id, { atMs: Date.now(), lagMs: 500 }])) }));
    expect(within(screen.getByRole("alert")).getAllByRole("link", { name: "Open unit" })).toHaveLength(2);
    expect(screen.getByText("and 2 more new alerts, in the list at the top right.")).toBeTruthy();
  });
});

describe("one reading for the whole studio", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T15:00:10.000Z"));
  });

  const mount = () =>
    render(
      <AlertFeedProvider env="mtl" enabled>
        <AlertPill env="mtl" />
        <AlertStrip env="mtl" />
      </AlertFeedProvider>,
    );
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("reads the feed every three seconds and announces what opened in between", async () => {
    api.fetchAlertFeed.mockResolvedValueOnce(feed([alert()]));
    mount();
    await tick(0);
    expect(api.fetchAlertFeed).toHaveBeenCalledWith("mtl");
    expect(screen.getByRole("button", { name: "Open alerts: 1 critical" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    const opened = alert({ id: "a2", message: "Urgence — Hôpital C — 141 %", openedAt: "2026-11-19T15:00:11.000Z" });
    api.fetchAlertFeed.mockResolvedValue(feed([opened, alert()], { at: "2026-11-19T15:00:13.000Z" }));
    await tick(POLL_MS);
    expect(api.fetchAlertFeed).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole("alert")).getByText("Urgence — Hôpital C — 141 %")).toBeTruthy();
  });

  it("keeps the last list and marks it old when the feed stops answering", async () => {
    api.fetchAlertFeed.mockResolvedValueOnce(feed([alert()]));
    mount();
    await tick(0);
    api.fetchAlertFeed.mockRejectedValue(new Error("network"));
    await tick(STALE_AFTER_MS + POLL_MS);
    // Still one critical alert on screen — and no pretence that it is current.
    expect(screen.getByRole("button", { name: "Open alerts: 1 critical, not updating" })).toBeTruthy();
  });

  it("reads nothing without a project", async () => {
    render(
      <AlertFeedProvider env={null} enabled>
        <AlertPill env={null} />
      </AlertFeedProvider>,
    );
    await tick(POLL_MS * 2);
    expect(api.fetchAlertFeed).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
