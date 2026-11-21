// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AlertFeed } from "@/lib/platform-api";

import type { BoardSignal, CommandBoard } from "../signals-api";

const api = vi.hoisted(() => ({ getCommandBoard: vi.fn(), getSignalDetail: vi.fn(), closeClearedSignals: vi.fn() }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("../signals-api", async (orig) => ({ ...(await orig<typeof import("../signals-api")>()), ...api }));
vi.mock("../StudioShell", () => ({ useStudio: () => ({ selectedEnv: "mtl" }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

import { AlertFeedContext, type AlertFeedValue } from "../AlertFeed";
import ResponseView, { shownOfTotal } from "./ResponseView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  nav.search = "";
});

const STAGES = [
  { id: "st1", workflowId: "w1", seq: 1, key: "detected", name: "Detected", requiresApproval: false, isTerminal: false },
  { id: "st2", workflowId: "w1", seq: 2, key: "closed", name: "Closed", requiresApproval: false, isTerminal: true },
];
const WARD_STAGES = STAGES.map((s) => ({ ...s, id: `x${s.id}`, workflowId: "w2" }));

const signal = (over: Partial<BoardSignal> = {}): BoardSignal => ({
  id: "s1",
  projectId: "p",
  signalTypeId: "t1",
  stageId: "st1",
  subjectKind: "object_instance",
  subjectId: "u1",
  title: "Urgence — Hôpital A — 132 %",
  detail: null,
  severity: "critical",
  properties: {},
  scenarioId: null,
  originKind: "twin_alert",
  dedupeKey: null,
  closedAt: null,
  closedReason: null,
  detectedAt: "2026-11-19T15:00:04.000Z",
  alert: "holds",
  domain: "Emergency",
  signalTypeName: "Overcrowding",
  stageKey: "detected",
  workflowId: "w1",
  ...over,
});

const board = (signals: BoardSignal[]): CommandBoard =>
  ({
    domains: [
      { domain: "Emergency", open: 1, critical: 1 },
      { domain: "Wards", open: 1, critical: 0 },
    ],
    workflows: [
      { id: "w1", organizationId: "o", key: "triage", name: "Triage", description: null, stages: STAGES },
      { id: "w2", organizationId: "o", key: "ward", name: "Ward", description: null, stages: WARD_STAGES },
    ],
    signalTypes: [
      { id: "t1", organizationId: "o", key: "over", name: "Overcrowding", domain: "Emergency", workflowId: "w1", defaultSeverity: "critical", description: null, active: true, alertMetric: "occupancy" },
      { id: "t2", organizationId: "o", key: "beds", name: "Beds closed", domain: "Wards", workflowId: "w2", defaultSeverity: "warn", description: null, active: true, alertMetric: null },
    ],
    total: signals.length,
    view: "active",
    counts: { open: signals.length, active: signals.length, cleared: 0 },
    signals,
  }) as unknown as CommandBoard;

const feed = (open: number, changedAt: string | null): AlertFeed => ({
  at: "2026-11-19T15:00:10.000Z",
  alerts: [],
  counts: { critical: 0, warn: 0, info: 0 },
  omitted: 0,
  signals: { open, changedAt },
  evaluation: { lastAt: null, lastMs: null, everyMs: null },
});

const withFeed = (f: AlertFeed | null): AlertFeedValue => ({ feed: f, status: f ? "live" : "off", fresh: {}, lastOkAtMs: null, refresh: async () => {}, dismiss: () => {} });

function view(f: AlertFeed | null) {
  return (
    <AlertFeedContext.Provider value={withFeed(f)}>
      <ResponseView />
    </AlertFeedContext.Provider>
  );
}

beforeEach(() => {
  api.getSignalDetail.mockResolvedValue({ stages: STAGES, events: [] });
});

describe("the response board follows the signals on its own", () => {
  it("is read again when a signal is raised, without anybody pressing Refresh", async () => {
    api.getCommandBoard.mockResolvedValue(board([signal()]));
    const { rerender } = render(view(feed(1, "2026-11-19T15:00:04.000Z")));
    await screen.findByText("Urgence — Hôpital A — 132 %");
    expect(api.getCommandBoard).toHaveBeenCalledTimes(1);

    // The same reading again: nothing moved, nothing is fetched.
    rerender(view(feed(1, "2026-11-19T15:00:04.000Z")));
    expect(api.getCommandBoard).toHaveBeenCalledTimes(1);

    // A second signal: the feed's count and its last change both move.
    api.getCommandBoard.mockResolvedValue(board([signal(), signal({ id: "s2", title: "Urgence — Hôpital C — 141 %" })]));
    rerender(view(feed(2, "2026-11-19T15:03:00.000Z")));
    expect(await screen.findByText("Urgence — Hôpital C — 141 %")).toBeTruthy();
    expect(api.getCommandBoard).toHaveBeenCalledTimes(2);
    // The button stays, for whoever wants to be sure.
    expect(screen.getByRole("button", { name: /Refresh/ })).toBeTruthy();
  });

  it("still loads once where there is no feed to follow", async () => {
    api.getCommandBoard.mockResolvedValue(board([signal()]));
    render(view(null));
    await screen.findByText("Urgence — Hôpital A — 132 %");
    expect(api.getCommandBoard).toHaveBeenCalledTimes(1);
  });
});

describe("a signal and its unit lead to each other", () => {
  it("opens the signal named in the address, whatever domain it sits in", async () => {
    nav.search = "signal=s9";
    api.getCommandBoard.mockResolvedValue(board([signal(), signal({ id: "s9", title: "6 Ouest — beds closed", domain: "Wards", workflowId: "w2", stageId: "xst1", signalTypeId: "t2", severity: "warn", subjectId: "u6" })]));
    api.getSignalDetail.mockResolvedValue({ stages: WARD_STAGES, events: [] });
    render(view(feed(2, null)));

    await waitFor(() => expect(api.getSignalDetail).toHaveBeenCalledWith("s9"));
    // Its own domain is the one on screen now, not the first of the list.
    const card = await screen.findByRole("button", { name: /6 Ouest — beds closed/ });
    expect(card).toBeTruthy();
    // And from the signal, one click to the unit it is about, in this project.
    const link = await screen.findByRole("link", { name: "Open unit" });
    expect(link.getAttribute("href")).toBe("/studio/live?env=mtl&unit=u6");
  });

  it("offers no unit for a signal that is not about one", async () => {
    nav.search = "signal=s1";
    api.getCommandBoard.mockResolvedValue(board([signal({ subjectKind: "dataset", subjectId: "d1" })]));
    render(view(feed(1, null)));
    await waitFor(() => expect(api.getSignalDetail).toHaveBeenCalledWith("s1"));
    const detail = (await screen.findByText(/détecté il y a/)).closest("div")!;
    expect(within(detail.parentElement!).queryByRole("link", { name: "Open unit" })).toBeNull();
  });
});

describe("a link to a signal older than the board lists", () => {
  const OLD = "a2e6dffc-781b-4e05-aa22-3bdaf343c031";

  it("asks the board for that signal by name, and opens it", async () => {
    nav.search = `signal=${OLD}`;
    // The API puts the named signal on the board although 2,751 newer ones exist.
    api.getCommandBoard.mockResolvedValue({ ...board([signal({ id: OLD, title: "Urgence — Hôpital B — 103 %", subjectId: "u2" }), signal()]), total: 2752 });
    render(view(feed(2752, null)));

    await waitFor(() => expect(api.getCommandBoard).toHaveBeenCalledWith("mtl", { signal: OLD }));
    await waitFor(() => expect(api.getSignalDetail).toHaveBeenCalledWith(OLD));
    const link = await screen.findByRole("link", { name: "Open unit" });
    expect(link.getAttribute("href")).toBe("/studio/live?env=mtl&unit=u2");
    // The board says what it leaves out instead of passing its list for the whole.
    expect(screen.getByText("Showing 2 of 2,752 open signals, most recent first")).toBeTruthy();
    expect(screen.queryByText(/not in this project/)).toBeNull();
  });

  it("keeps asking for it when the board is read again", async () => {
    nav.search = `signal=${OLD}`;
    api.getCommandBoard.mockResolvedValue(board([signal({ id: OLD })]));
    const { rerender } = render(view(feed(1, "2026-11-19T15:00:04.000Z")));
    await waitFor(() => expect(api.getCommandBoard).toHaveBeenCalledTimes(1));
    rerender(view(feed(2, "2026-11-19T15:03:00.000Z")));
    await waitFor(() => expect(api.getCommandBoard).toHaveBeenCalledTimes(2));
    expect(api.getCommandBoard).toHaveBeenLastCalledWith("mtl", { signal: OLD });
  });

  it("says so when the link leads to no signal of this project", async () => {
    nav.search = `signal=${OLD}`;
    api.getCommandBoard.mockResolvedValue(board([signal()]));
    render(view(feed(1, null)));
    expect((await screen.findByRole("status")).textContent).toBe("The signal this link names is not in this project.");
    expect(api.getSignalDetail).not.toHaveBeenCalled();
  });

  it("does not send the API an id it would refuse", async () => {
    nav.search = "signal=not-an-id";
    api.getCommandBoard.mockResolvedValue(board([signal()]));
    render(view(feed(1, null)));
    await screen.findByText("Urgence — Hôpital A — 132 %");
    expect(api.getCommandBoard).toHaveBeenCalledWith("mtl", undefined);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

describe("what the board says it holds", () => {
  it("is the plain count when the list is the whole", () => {
    expect(shownOfTotal(44, 44)).toBe("44 open signals");
    expect(shownOfTotal(0, 0)).toBe("0 open signals");
  });

  it("is the part and the whole when the list was cut", () => {
    expect(shownOfTotal(500, 2752)).toBe("Showing 500 of 2,752 open signals, most recent first");
  });

  it("is the plain count when the API does not say the total", () => {
    expect(shownOfTotal(500, undefined)).toBe("500 open signals");
  });
});

describe("the board shows first what still needs somebody", () => {
  /** The project as measured before this was built: 2,852 open signals for 42 alerts still firing. */
  const arrival = (): CommandBoard => ({
    ...board([signal()]),
    total: 42,
    counts: { open: 2852, active: 42, cleared: 2810 },
  });
  const setApart = (): CommandBoard => ({
    ...board([signal({ id: "s7", title: "Urgence — Hôpital D — 101 %", alert: "cleared" })]),
    domains: [
      { domain: "Emergency", open: 2810, critical: 2810 },
      { domain: "Wards", open: 0, critical: 0 },
    ],
    total: 2810,
    view: "cleared",
    counts: { open: 2852, active: 42, cleared: 2810 },
  });
  const byView = async (_env: string, opts?: { view?: string }) => (opts?.view === "cleared" ? setApart() : arrival());

  it("asks for the active signals on arrival, and counts what it sets apart", async () => {
    api.getCommandBoard.mockResolvedValue(arrival());
    render(view(feed(2852, null)));
    await screen.findByText("Urgence — Hôpital A — 132 %");
    // No view named: the API answers for what the board shows on arrival.
    expect(api.getCommandBoard).toHaveBeenCalledWith("mtl", undefined);
    const active = screen.getByRole("tab", { name: /^Active/ });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.textContent).toBe("Active42");
    // What is set apart is counted on the same line, never hidden.
    expect(screen.getByRole("tab", { name: /^Alert cleared/ }).textContent).toBe("Alert cleared2,810");
    // Nothing is offered to close from here.
    expect(screen.queryByRole("button", { name: /^Close the/ })).toBeNull();
  });

  it("shows the signals whose alert cleared one click away, and says what they are", async () => {
    api.getCommandBoard.mockImplementation(byView);
    render(view(feed(2852, null)));
    await screen.findByText("Urgence — Hôpital A — 132 %");

    fireEvent.click(screen.getByRole("tab", { name: /^Alert cleared/ }));
    expect(await screen.findByText("Urgence — Hôpital D — 101 %")).toBeTruthy();
    expect(api.getCommandBoard).toHaveBeenLastCalledWith("mtl", { view: "cleared" });
    expect(screen.getByText("Showing 1 of 2,810 signals whose alert has cleared, most recent first")).toBeTruthy();
    // Cleared on its own is not fixed, and the screen says so where the batch is offered.
    expect(screen.getByText(/Cleared is not fixed: each one stays open until a person closes it\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close the 2,810 in Emergency…" })).toBeTruthy();
  });

  it("closes them in one go only with a reason, and reports how many closed", async () => {
    api.getCommandBoard.mockImplementation(byView);
    api.closeClearedSignals.mockResolvedValue({ closed: 2809 });
    render(view(feed(2852, null)));
    await screen.findByText("Urgence — Hôpital A — 132 %");
    fireEvent.click(screen.getByRole("tab", { name: /^Alert cleared/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Close the 2,810 in Emergency…" }));

    const dialog = screen.getByRole("dialog", { name: "Close 2,810 signals" });
    // How they will be recorded is said before the click, not after.
    expect(within(dialog).getByText(/recorded as cleared on their own: not as resolved, and not as false positives/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Close 2,810 signals" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(api.closeClearedSignals).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  Cleared on their own over the weekend " } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.closeClearedSignals).toHaveBeenCalledWith("mtl", { reason: "Cleared on their own over the weekend", domain: "Emergency" }),
    );
    // The figure on screen is the one the server closed, not the one the button promised.
    expect(await screen.findByText("2,809 signals closed in Emergency. Each one's log keeps who closed it and why.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backs out of the batch without closing anything", async () => {
    api.getCommandBoard.mockImplementation(byView);
    render(view(feed(2852, null)));
    await screen.findByText("Urgence — Hôpital A — 132 %");
    fireEvent.click(screen.getByRole("tab", { name: /^Alert cleared/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Close the 2,810 in Emergency…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.closeClearedSignals).not.toHaveBeenCalled();
  });

  it("marks a card whose alert was acknowledged or has cleared, and leaves the ordinary one plain", async () => {
    api.getCommandBoard.mockResolvedValue(
      board([
        signal(),
        signal({ id: "s2", title: "Urgence — Hôpital B — 118 %", alert: "acknowledged" }),
        // Somebody took this one up: it stays on the board after its alert cleared.
        signal({ id: "s3", title: "Urgence — Hôpital C — 104 %", alert: "cleared" }),
        signal({ id: "s4", title: "Raised by hand", originKind: "manual", alert: null }),
      ]),
    );
    render(view(feed(4, null)));
    const chips = (title: string) =>
      within(screen.getByRole("button", { name: new RegExp(title) }))
        .queryAllByText(/^(acknowledged|alert cleared)$/)
        .map((e) => e.textContent);
    await screen.findByText("Urgence — Hôpital A — 132 %");
    expect(chips("Hôpital A")).toEqual([]);
    expect(chips("Hôpital B")).toEqual(["acknowledged"]);
    expect(chips("Hôpital C")).toEqual(["alert cleared"]);
    expect(chips("Raised by hand")).toEqual([]);
  });

  it("says on the signal itself what became of its alert", async () => {
    nav.search = "signal=s3";
    api.getCommandBoard.mockResolvedValue(board([signal({ id: "s3", alert: "cleared" })]));
    render(view(feed(1, null)));
    expect(await screen.findByText(/Its alert has cleared: the condition no longer fires\./)).toBeTruthy();
  });

  it("names what it counts in each view", () => {
    expect(shownOfTotal(42, 42, "active")).toBe("42 open signals");
    expect(shownOfTotal(500, 2810, "cleared")).toBe("Showing 500 of 2,810 signals whose alert has cleared, most recent first");
    expect(shownOfTotal(3, 3, "cleared")).toBe("3 signals whose alert has cleared");
  });
});
