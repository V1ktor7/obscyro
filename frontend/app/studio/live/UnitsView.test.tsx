// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TwinTreeSnapshot, TwinUnitDetail, TwinUnitNode } from "@/lib/platform-api";

const api = vi.hoisted(() => ({
  fetchTwinTree: vi.fn(),
  fetchTwinUnit: vi.fn(),
  listTwinMetrics: vi.fn(),
  listTwinAlertRules: vi.fn(),
  subscribeTwinStream: vi.fn(),
  ackTwinAlert: vi.fn(),
  seedTwinDemo: vi.fn(),
}));
vi.mock("@/lib/platform-api", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-api")>()), ...api }));

const shell = vi.hoisted(() => ({ refreshAlerts: vi.fn(), search: "" }));
vi.mock("../StudioShell", () => ({
  useStudio: () => ({
    hasKey: true,
    selectedEnv: "mtl",
    environments: [{ slug: "mtl", name: "Montréal", type: "operations" }],
    bumpOntology: () => {},
    setSelectedEnv: () => {},
  }),
}));
vi.mock("../AlertFeed", () => ({ useAlertFeed: () => ({ refresh: shell.refreshAlerts }) }));
vi.mock("../AnalystDock", () => ({ useAnalystFocus: () => {}, useOpenAnalyst: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(shell.search) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import UnitsView from "./UnitsView";

function node(id: string, name: string, value: number | null, alerts = 0): TwinUnitNode {
  return {
    id,
    name,
    kind: "org",
    code: id,
    parentId: null,
    metrics: {
      unitId: id,
      instanceCountByType: {},
      values: value === null ? {} : { stretchers: value },
      occupancyPct: null,
      numericMeans: {},
      freshnessSeconds: null,
      freshnessBasis: "empty",
      fetchedAgeSeconds: null,
      linkedInstanceCount: 0,
    },
    worstAlertSeverity: alerts > 0 ? "critical" : null,
    openAlertCount: alerts,
  };
}

const snapshot = (at: string, suroit: number): TwinTreeSnapshot => ({
  computedAt: at,
  nodes: [node("suroit", "HÔPITAL DU SUROÎT", suroit, 1), node("verdun", "Hôpital de Verdun", 62)],
  edges: [],
  roots: ["suroit", "verdun"],
});

const detail = (unitId: string, message: string | null): TwinUnitDetail => ({
  metrics: {
    unitId,
    instanceCountByType: { CiviereUrgence: 32 },
    values: {},
    occupancyPct: null,
    numericMeans: {},
    freshnessSeconds: 3360,
    freshnessBasis: "observed",
    fetchedAgeSeconds: 60,
    linkedInstanceCount: 33,
  },
  alerts: message
    ? [{ id: "alert-1", unitInstanceId: unitId, ruleId: "r1", severity: "critical", metric: "stretchers", value: 150, message, recommendation: "", status: "open" }]
    : [],
  exchanges: [],
  recommendations: [],
});

/** The stream the page subscribed to: the test plays the server. */
const stream: { onData?: (snap: TwinTreeSnapshot) => void; onError?: () => void; stop: ReturnType<typeof vi.fn> } = { stop: vi.fn() };

const chip = () => screen.getByText(/^(Connecting|Live stream|Polling)$/).textContent;
const row = (id: string) => document.getElementById(`unit-row-${id}`)!;

beforeEach(() => {
  shell.search = "";
  localStorage.clear();
  api.fetchTwinTree.mockResolvedValue(snapshot("t1", 150));
  api.listTwinMetrics.mockResolvedValue({ metrics: [{ id: "m1", key: "stretchers", label: "Stretcher occupancy", unit: "percent" }] });
  api.listTwinAlertRules.mockResolvedValue({ rules: [{ id: "r1", metric: "stretchers", op: ">", threshold: 100, unitKind: null }] });
  api.fetchTwinUnit.mockImplementation(async (_env: string, id: string) =>
    detail(id, id === "suroit" ? "HÔPITAL DU SUROÎT — civières occupées à 150 % de la capacité" : null),
  );
  api.ackTwinAlert.mockResolvedValue(undefined);
  api.subscribeTwinStream.mockImplementation((_env: string, onData: (s: TwinTreeSnapshot) => void, onError: () => void) => {
    stream.onData = onData;
    stream.onError = onError;
    return stream.stop;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Units page, reading the twin", () => {
  it("says the stream is live only once it has delivered something", async () => {
    render(<UnitsView />);
    // The first reading is on screen, and the stream has been asked for: not live yet.
    await waitFor(() => expect(within(row("suroit")).getByText("150%")).toBeTruthy());
    expect(api.subscribeTwinStream).toHaveBeenCalledTimes(1);
    expect(chip()).toBe("Connecting");

    act(() => stream.onData!(snapshot("t2", 163)));
    expect(chip()).toBe("Live stream");
    expect(within(row("suroit")).getByText("163%")).toBeTruthy();
  });

  it("says it is polling when the stream gives up", async () => {
    const { unmount } = render(<UnitsView />);
    await waitFor(() => expect(row("suroit")).toBeTruthy());
    act(() => stream.onError!());
    expect(chip()).toBe("Polling");
    // Leaving the page stops the stream and the polling.
    unmount();
    expect(stream.stop).toHaveBeenCalledTimes(1);
  });

  it("colours the list from the alert rules, and ranks on the organisation's measure", async () => {
    render(<UnitsView />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /1 in alert · over the threshold/ })).toBeTruthy());
    expect((screen.getByRole("combobox", { name: /^Measure/ }) as HTMLSelectElement).value).toBe("stretchers");
  });

  it("selects the unit a link names and reads it", async () => {
    shell.search = "unit=suroit";
    render(<UnitsView />);
    const sheet = screen.getByRole("complementary", { name: "Selected unit" });
    await waitFor(() => expect(within(sheet).getByText(/civières occupées à 150 %/)).toBeTruthy());
    expect(api.fetchTwinUnit).toHaveBeenCalledWith("mtl", "suroit");
    expect(row("suroit").getAttribute("aria-current")).toBe("true");
    expect(within(sheet).getByRole("link", { name: "Open the situation" }).getAttribute("href")).toContain("unit=suroit");
  });

  it("never shows one unit's alerts under another's name", async () => {
    shell.search = "unit=suroit";
    render(<UnitsView />);
    const sheet = screen.getByRole("complementary", { name: "Selected unit" });
    await waitFor(() => expect(within(sheet).getByText(/civières occupées à 150 %/)).toBeTruthy());

    // The next unit's reading is slow: its sheet says so, and the previous unit's alert is gone at once.
    let arrive: (d: TwinUnitDetail) => void = () => {};
    api.fetchTwinUnit.mockImplementation(() => new Promise<TwinUnitDetail>((resolve) => { arrive = resolve; }));
    fireEvent.click(row("verdun"));
    expect(within(sheet).getByRole("heading", { name: "Hôpital de Verdun" })).toBeTruthy();
    expect(within(sheet).getByText("Reading this unit…")).toBeTruthy();
    expect(within(sheet).queryByText(/civières occupées/)).toBeNull();

    await act(async () => arrive(detail("verdun", null)));
    expect(within(sheet).getByText("None.")).toBeTruthy();
  });

  it("acknowledges an alert, then reads the unit, the tree and the alert feed again", async () => {
    shell.search = "unit=suroit";
    render(<UnitsView />);
    const sheet = screen.getByRole("complementary", { name: "Selected unit" });
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Acknowledge" })).toBeTruthy());
    const treeReads = api.fetchTwinTree.mock.calls.length;

    fireEvent.click(within(sheet).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(shell.refreshAlerts).toHaveBeenCalledTimes(1));
    expect(api.ackTwinAlert).toHaveBeenCalledWith("mtl", "alert-1");
    expect(api.fetchTwinTree.mock.calls.length).toBe(treeReads + 1);
  });
});
