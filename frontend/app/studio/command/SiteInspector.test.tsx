// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import type { TwinMetric, TwinNetworkSite, TwinUnitDetail } from "@/lib/platform-api";

import SiteInspector, { type UnitReading } from "./SiteInspector";

afterEach(cleanup);

// 18:00 in Montréal on 22 November; the census of 17:45 is fifteen minutes old.
const AT = "2026-11-22T23:00:00.000Z";
const MTL = "America/Toronto";
const census = (key: string, label: string, unit: TwinMetric["unit"], agg: TwinMetric["numerator"]["agg"] = "sum"): TwinMetric => ({
  id: key,
  organizationId: "org",
  key,
  label,
  objectType: "OrgUnit",
  unit,
  numerator: { ofType: "ReleveUrgence", agg, property: key },
  active: true,
});
const OCCUPANCY: TwinMetric = { ...census("occupancy", "Occupation des civières", "percent"), denominator: { ofType: "ReleveUrgence", agg: "sum", property: "f" } };
const DEFS: TwinMetric[] = [
  OCCUPANCY,
  census("present", "People in the emergency room", "count"),
  census("waiting", "Waiting to see a doctor", "count"),
  census("stay", "Average stay, walk-in patients", "hours", "only"),
];

function site(over: Partial<TwinNetworkSite["metrics"]> = {}, units = 1): TwinNetworkSite {
  return {
    id: "site-1",
    name: "HÔPITAL GÉNÉRAL JUIF",
    kind: "Installation",
    code: "51248250",
    parentId: null,
    objectType: "OrgUnit",
    latitude: 45.49,
    longitude: -73.63,
    worstAlertSeverity: "critical",
    openAlertCount: 1,
    contributingUnits: Array.from({ length: units }, (_, i) => ({ id: `u${i + 1}`, name: i === 0 ? "HÔPITAL GÉNÉRAL JUIF" : `Unit ${i + 1}` })),
    metrics: {
      unitId: "site-1",
      instanceCountByType: { ReleveUrgence: 1 },
      values: { occupancy: 209.43, present: 136, waiting: 35, stay: 5.99 },
      occupancyPct: 209.43,
      numericMeans: {},
      freshnessSeconds: 900,
      freshnessBasis: "observed",
      valueAges: {
        occupancy: { seconds: 900, basis: "observed" },
        present: { seconds: 900, basis: "observed" },
        waiting: { seconds: 900, basis: "observed" },
        stay: { seconds: 900, basis: "observed", period: "previous_day", zone: MTL },
      },
      fetchedAgeSeconds: 2,
      linkedInstanceCount: 572,
      ...over,
    },
  } as TwinNetworkSite;
}

const detail = (): TwinUnitDetail => ({
  at: AT,
  metrics: site().metrics,
  trends: {
    at: AT,
    changes: {
      occupancy: { previous: { value: 203.8, at: "2026-11-22T21:45:00.000Z", atIs: "observed" }, delta: 5.63 },
      present: { previous: { value: 130, at: "2026-11-22T21:45:00.000Z", atIs: "observed" }, delta: 6 },
      waiting: { previous: { value: 35, at: "2026-11-22T21:45:00.000Z", atIs: "observed" }, delta: 0 },
      stay: { previous: { value: 6.4, at: "2026-11-22T04:45:00.000Z", atIs: "observed" }, delta: -0.41 },
    },
    means: { stay: { mean: 6.2, days: 12, from: "2026-11-11", to: "2026-11-22", window: 30 } },
  },
  typeNotes: { ReleveUrgence: "Source : MSSS, Console provinciale des urgences, CC-BY 4.0. Diffusé 45 minutes après l'heure du relevé." },
  alerts: [],
  exchanges: [],
  recommendations: [],
});

const READ: UnitReading = { state: "read", detail: detail(), history: { state: "reading" } };

function inspector(props: Partial<Parameters<typeof SiteInspector>[0]> = {}) {
  const all = {
    site: site(),
    metricDefs: DEFS,
    badgeMetric: "occupancy",
    rules: [{ metric: "occupancy", op: ">" as const, threshold: 100 }],
    alerts: [
      { id: "a1", unitInstanceId: "u1", ruleId: "r1", severity: "critical" as const, metric: "occupancy", value: 209.43, message: "HÔPITAL GÉNÉRAL JUIF — civières occupées à 209.43 % de la capacité", recommendation: "", status: "open" as const },
    ],
    flows: [],
    area: null,
    reading: READ,
    onClose: vi.fn(),
    onEditLocation: vi.fn(),
    onDrillIn: vi.fn(),
    ...props,
  };
  return { props: all, ...render(<SiteInspector {...all} />) };
}

describe("the inspector of a site on the network map", () => {
  it("leads with the open alert, then the measure the map paints", () => {
    inspector();
    const text = document.body.textContent ?? "";
    // The panel grew: the alert must not end up under everything else.
    expect(text.indexOf("civières occupées à 209.43 %")).toBeLessThan(text.indexOf("alert when over 100%"));
    expect(screen.getByText("209%")).toBeTruthy();
    expect(screen.getByText("This value was read 15m ago")).toBeTruthy();
    expect(screen.getByText(/^Up 6 pts since the reading of \d{2}:45\.$/)).toBeTruthy();
  });

  it("lists what the site reports with each change, and says the hour once", () => {
    inspector();
    const block = screen.getByRole("button", { name: /Also reports/ }).parentElement!;
    expect(within(block).getByText("136")).toBeTruthy();
    expect(within(block).getByText("▲ 6")).toBeTruthy();
    expect(within(block).getByText("no change")).toBeTruthy();
    expect(within(block).getByText(/^Change since the reading of \d{2}:45\.$/)).toBeTruthy();
    // A figure of the day before is not in the list of the hour.
    expect(within(block).queryByText("5 h 59")).toBeNull();
  });

  it("keeps yesterday's figures apart, with the mean and the days it rests on", () => {
    inspector();
    const block = screen.getByRole("button", { name: /Yesterday/ }).parentElement!;
    expect(within(block).getByText("5 h 59")).toBeTruthy();
    expect(within(block).getByText("average over 12 days kept")).toBeTruthy();
    expect(within(block).getByText("6 h 12")).toBeTruthy();
    expect(within(block).getByText(/not of the last hour/)).toBeTruthy();
  });

  it("prints where the figures come from, in the organisation's words", () => {
    inspector();
    expect(screen.getByText(/CC-BY 4\.0/)).toBeTruthy();
  });

  it("shows the values and no change while the unit's history is being read, or cannot be", () => {
    inspector({ reading: { state: "reading", detail: null, history: { state: "reading" } } });
    expect(screen.getByText("136")).toBeTruthy();
    expect(screen.queryByText(/since the reading/)).toBeNull();
    cleanup();
    inspector({ reading: { state: "failed", detail: null, history: { state: "failed" } } });
    expect(screen.getByText(/could not be read\. The values above are the reading now/)).toBeTruthy();
  });

  it("says that a site counting several units has no single history to read", () => {
    inspector({ site: site({}, 3), reading: { state: "several", detail: null, history: null } });
    expect(screen.getByText(/kept unit by unit, and this site counts 3/)).toBeTruthy();
    expect(screen.queryByText(/since the reading/)).toBeNull();
  });

  it("says why a figure is withheld instead of showing a dash", () => {
    inspector({
      site: site({ values: { occupancy: 150, present: 226, waiting: 60, stay: null }, withheld: { stay: { reason: "several", count: 2 } } }),
      reading: { state: "several", detail: null, history: null },
    });
    expect(screen.getByText(/2 units under this one each publish their own average/)).toBeTruthy();
  });

  it("folds to its title, and closes", () => {
    const { props } = inspector();
    fireEvent.click(screen.getByRole("button", { name: "Fold the inspector" }));
    expect(screen.queryByText("Open unit canvas")).toBeNull();
    expect(screen.getByText("HÔPITAL GÉNÉRAL JUIF")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unfold the inspector" }));
    expect(screen.getByText("Open unit canvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("is folded by the page when the page says so, and tells it when the person unfolds it", () => {
    const onFolded = vi.fn();
    inspector({ folded: true, onFolded });
    // Folded from outside: the title stays, the body is gone.
    expect(screen.getByText("HÔPITAL GÉNÉRAL JUIF")).toBeTruthy();
    expect(screen.queryByText("Open unit canvas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unfold the inspector" }));
    expect(onFolded).toHaveBeenCalledWith(false);
  });

  it("keeps the other readings folded until asked", () => {
    inspector();
    expect(screen.queryByText("Linked instances")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Other readings/ }));
    expect(screen.getByText("572")).toBeTruthy();
  });
});

describe("the age of each figure in the inspector", () => {
  it("is said once for the figures of the hour, and under each figure of the day before", () => {
    inspector();
    const hourly = screen.getByRole("button", { name: /Also reports/ }).parentElement!;
    expect(within(hourly).getByText("Values read 15m ago.")).toBeTruthy();
    const daily = screen.getByRole("button", { name: /Yesterday/ }).parentElement!;
    expect(within(daily).getByText("published 15m ago")).toBeTruthy();
  });
});
