// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TwinAlert, TwinUnitHistory } from "@/lib/platform-api";

import type { Investigated } from "../analyst-api";
import NetworkTimeline, { type TimelineSeries } from "./NetworkTimeline";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = new Date("2026-11-24T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const history = (values: [number, number | null][]): TwinUnitHistory => ({
  at: NOW.toISOString(),
  unitId: "u1",
  metric: "occupancy",
  hours: 72,
  since: hoursAgo(44),
  readings: values.map(([h, value]) => ({ value, observedAt: hoursAgo(h), observedBasis: "observed" as never, recordedAt: hoursAgo(h) })),
  cut: false,
  everySeconds: 300,
});
const series = (over: Partial<TimelineSeries> = {}): TimelineSeries => ({
  unitName: "CHUM",
  label: "Stretcher occupancy",
  unit: "percent",
  threshold: 100,
  state: "read",
  history: history([[40, 94], [30, 118], [20, 141], [6, 124]]),
  ...over,
});
const ALERT = { id: "a1", unitInstanceId: "u1", ruleId: "r1", severity: "critical", metric: "occupancy", value: 124, message: "CHUM over capacity", recommendation: "", status: "open", createdAt: hoursAgo(30) } as TwinAlert;

const investigation = (): Investigated => ({
  unit: { id: "u1", name: "CHUM" },
  metric: "occupancy",
  from: hoursAgo(72),
  to: NOW.toISOString(),
  zone: "UTC",
  series: { readings: 4, valued: 4, low: 94, high: 141, firstDay: day(hoursAgo(40)), since: hoursAgo(44), cut: false },
  line: { ruleId: "r1", op: ">", threshold: 100, severity: "critical" },
  episodes: [{ id: "e1", startsAt: hoursAgo(30), endsAt: null, startDay: day(hoursAgo(30)), endDay: day(NOW.toISOString()), peak: 141, peakAt: hoursAgo(20), readings: 3, sharedWith: [] }],
  neighbours: [],
  calendar: [],
  compared: [
    { ref: "c1", from: "candidate", title: "Ice storm warning", startsOn: day(hoursAgo(40)), endsOn: null, episode: "e1", leadDays: 1, before: null, after: null, delta: null, doubts: [] },
    { ref: "h:ev1", from: "calendar", title: "Clinic closed", startsOn: day(hoursAgo(10)), endsOn: null, episode: "e1", leadDays: -1, before: null, after: null, delta: null, doubts: [{ kind: "starts_after", days: 1 }] },
    { ref: "c2", from: "candidate", title: "Undated notice", startsOn: null, endsOn: null, episode: null, leadDays: null, before: null, after: null, delta: null, doubts: [{ kind: "no_date" }] },
  ],
  limits: [],
});

function timeline(props: Partial<Parameters<typeof NetworkTimeline>[0]> = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const all = { alerts: [ALERT], feedEvents: [], windowHours: 72, onWindow: vi.fn(), open: true, onOpen: vi.fn(), series: null, investigation: null, ...props };
  return { ...render(<NetworkTimeline {...all} />), props: all };
}

describe("the timeline under the network map", () => {
  it("is folded to its counts until it is opened, and its window is the page's", () => {
    const { props } = timeline({ open: false });
    expect(screen.getByText("1 alerts · 0 feed events in window")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Event timeline/ }));
    expect(props.onOpen).toHaveBeenCalledWith(true);
    // The same spans as the investigation: one window for both.
    fireEvent.click(screen.getByRole("button", { name: "30 d" }));
    expect(props.onWindow).toHaveBeenCalledWith(720);
    expect(screen.getByRole("button", { name: "72 h" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("asks for a site when none is selected, and draws the two lanes it always had", () => {
    timeline();
    expect(screen.getByRole("img", { name: "Timeline lanes for alerts and feed events" })).toBeTruthy();
    expect(screen.getByText("Select a site that counts one unit to see its series here.")).toBeTruthy();
    expect(screen.getByText("CHUM over capacity")).toBeTruthy();
  });

  it("draws the series of the selected unit, with its range and its alert threshold", () => {
    const { container } = timeline({ series: series() });
    expect(screen.getByRole("img", { name: "Timeline: alerts, feed events, and Stretcher occupancy at CHUM over the last 72 h" })).toBeTruthy();
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(screen.getByText("Alert threshold: 100%")).toBeTruthy();
    expect(screen.getByText(/Stretcher occupancy at CHUM: lowest 94%, highest 141% over the last 72 h\. Each value holds until the next reading\./)).toBeTruthy();
    // No investigation on screen: no band, no mark, and nothing said about them.
    expect(screen.queryByText(/Bands are the episodes/)).toBeNull();
    expect(screen.queryByText(/Episode 1/)).toBeNull();
  });

  it("says where the series stands while it is read, when it cannot be, and when nothing was kept", () => {
    timeline({ series: series({ state: "reading", history: null }) });
    expect(screen.getByText("Reading the series the twin kept…")).toBeTruthy();
    cleanup();
    timeline({ series: series({ state: "failed", history: null }) });
    expect(screen.getByText("The series could not be read.")).toBeTruthy();
    cleanup();
    timeline({ series: series({ history: { ...history([]), since: null } }) });
    expect(screen.getByText("No reading of Stretcher occupancy has been kept at CHUM yet.")).toBeTruthy();
    cleanup();
    timeline({ series: series({ history: history([]) }) });
    expect(screen.getByText("No reading of Stretcher occupancy was kept at CHUM over the last 72 h.")).toBeTruthy();
  });

  it("says the threshold is not drawn when it is far from what was read", () => {
    timeline({ series: series({ history: history([[40, 20], [10, 30]]) }) });
    expect(screen.queryByText("Alert threshold: 100%")).toBeNull();
    expect(screen.getByText(/The alert threshold \(100%\) is far from what was read, and is not drawn\./)).toBeTruthy();
  });

  it("draws what an investigation found: its episodes as bands, its events as marks, and says they are only close in time", () => {
    timeline({ series: series(), investigation: investigation() });
    expect(screen.getByText("Episode 1: the measure beyond its alert threshold")).toBeTruthy();
    expect(screen.getByText(new RegExp(`Ice storm warning · ${day(hoursAgo(40))} · candidate`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`Clinic closed · ${day(hoursAgo(10))} · in the calendar`))).toBeTruthy();
    // An event without a date is not placed.
    expect(screen.queryByText(/Undated notice/)).toBeNull();
    expect(screen.getByText(/A dashed mark is a candidate, a solid one is in the calendar, each at the day its source dates it: close in time, and nothing more\./)).toBeTruthy();
    expect(screen.getByText(/3 events of the investigation/)).toBeTruthy();
  });
});
