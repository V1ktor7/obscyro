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

import type { TwinUnitDetail } from "@/lib/platform-api";

import UnitSheet from "./UnitSheet";
import { buildRows, type Measure, type UnitRow } from "./units-list";

afterEach(cleanup);

const STRETCHERS: Measure = { key: "stretchers", label: "Stretcher occupancy", unit: "percent" };

function unit(value: number | null, more: { alerts?: number; children?: number } = {}): UnitRow {
  const row = buildRows(
    [
      {
        id: "suroit",
        name: "HÔPITAL DU SUROÎT",
        kind: "org",
        code: "SUR",
        parentId: null,
        metrics: {
          unitId: "suroit",
          instanceCountByType: {},
          values: value === null ? {} : { stretchers: value },
          occupancyPct: null,
          numericMeans: {},
          freshnessSeconds: null,
          freshnessBasis: "empty",
          fetchedAgeSeconds: null,
          linkedInstanceCount: 0,
        },
        worstAlertSeverity: more.alerts ? "critical" : null,
        openAlertCount: more.alerts ?? 0,
      },
    ],
    STRETCHERS,
    [{ metric: "stretchers", op: ">", threshold: 100 }],
  )[0]!;
  return { ...row, children: more.children ?? 0 };
}

function detail(over: Partial<TwinUnitDetail> = {}, basis: TwinUnitDetail["metrics"]["freshnessBasis"] = "observed"): TwinUnitDetail {
  return {
    metrics: {
      unitId: "suroit",
      instanceCountByType: { CiviereUrgence: 32, ReleveUrgence: 1 },
      values: { stretchers: 150 },
      occupancyPct: null,
      numericMeans: {},
      freshnessSeconds: basis === "observed" || basis === "partial" ? 3360 : null,
      freshnessBasis: basis,
      fetchedAgeSeconds: 60,
      linkedInstanceCount: 33,
    },
    alerts: [],
    exchanges: [],
    recommendations: [],
    ...over,
  };
}

const ALERT = {
  id: "alert-1",
  unitInstanceId: "suroit",
  ruleId: "rule-1",
  severity: "critical" as const,
  metric: "stretchers",
  value: 150,
  message: "HÔPITAL DU SUROÎT — civières occupées à 150 % de la capacité",
  recommendation: "",
  status: "open" as const,
};

function sheet(props: Partial<Parameters<typeof UnitSheet>[0]> = {}) {
  const all = {
    unit: unit(150, { alerts: 1 }),
    measure: STRETCHERS,
    scale: { min: 0, max: 240 },
    detail: detail({ alerts: [ALERT] }),
    others: [],
    situationHref: (alertId?: string) => `/studio/situation?unit=suroit${alertId ? `&alert=${alertId}` : ""}`,
    onAck: vi.fn(),
    onAsk: vi.fn(),
    ...props,
  };
  return { props: all, ...render(<UnitSheet {...all} />) };
}

describe("the sheet of a unit", () => {
  it("waits for a unit to be selected", () => {
    sheet({ unit: null, detail: null });
    expect(screen.getByText("Select a unit to read it here.")).toBeTruthy();
  });

  it("says when a link names a unit this project does not have", () => {
    sheet({ unit: null, detail: null, missing: true });
    expect(screen.getByText(/The unit this link names is not in this project/)).toBeTruthy();
  });

  it("gives the value, where it stands against its threshold, and the rule in words", () => {
    sheet();
    expect(screen.getByRole("heading", { name: "HÔPITAL DU SUROÎT" })).toBeTruthy();
    expect(screen.getByText("Over the threshold")).toBeTruthy();
    expect(screen.getByText("150%")).toBeTruthy();
    expect(screen.getByText(/Stretcher occupancy/)).toBeTruthy();
    expect(screen.getByText(/alert when over 100%/)).toBeTruthy();
  });

  it("shows the age of the unit's oldest source and what the unit holds", () => {
    sheet();
    expect(screen.getByText("Oldest source")).toBeTruthy();
    expect(screen.getByText("56m ago")).toBeTruthy();
    expect(screen.getByText("33")).toBeTruthy();
    expect(screen.getByText("CiviereUrgence")).toBeTruthy();
    expect(screen.getByText("32")).toBeTruthy();
    expect(screen.getByText("None. This unit is only connected by the hierarchy.")).toBeTruthy();
  });

  it("says why an age is a floor or unknown, in the text", () => {
    const first = sheet({ detail: detail({}, "partial") });
    expect(screen.getByText("≥ 56m ago")).toBeTruthy();
    expect(screen.getByText(/At least this old/)).toBeTruthy();
    first.unmount();

    sheet({ detail: detail({}, "undeclared") });
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.getByText(/no property on this type is declared as carrying the time of the reading/)).toBeTruthy();
  });

  it("gives the value shown its own age, which is not always the unit's", () => {
    // The unit also carries an air quality station read two hours ago; its
    // stretcher occupancy comes from a census fourteen minutes old.
    const base = detail();
    sheet({
      detail: {
        ...base,
        metrics: { ...base.metrics, freshnessSeconds: 7140, valueAges: { stretchers: { seconds: 840, basis: "observed" } } },
      },
    });
    expect(screen.getByText("This value was read 14m ago")).toBeTruthy();
    // The unit as a whole keeps its own answer, under its own name.
    expect(screen.getByText("Oldest source").nextElementSibling?.textContent).toBe("2h ago");
  });

  it("says why the age of the value shown is a floor or unknown, in the text", () => {
    const base = detail();
    const withAge = (seconds: number | null, basis: TwinUnitDetail["metrics"]["freshnessBasis"]) =>
      sheet({ detail: { ...base, metrics: { ...base.metrics, valueAges: { stretchers: { seconds, basis } } } } });

    const floor = withAge(7200, "partial");
    expect(screen.getByText("This value was read ≥ 2h ago")).toBeTruthy();
    expect(screen.getByText("At least this old — one of the sources this measure reads published no readable time.")).toBeTruthy();
    floor.unmount();

    withAge(null, "undeclared");
    expect(screen.getByText("The age of this value is unknown")).toBeTruthy();
    expect(screen.getByText(/no property of what this measure reads is declared as carrying the time of the reading/)).toBeTruthy();
  });

  it("says nothing of the age of a value the twin did not date", () => {
    // An older API, or a built-in measure: no sentence rather than the unit's age under another name.
    sheet();
    expect(screen.queryByText(/This value was read/)).toBeNull();
    expect(screen.queryByText(/The age of this value/)).toBeNull();
  });

  it("gives each alert the age of its own value, counted on the server's clock", () => {
    const at = "2026-11-19T17:00:00.000Z";
    const first = sheet({
      detail: detail({
        at,
        alerts: [
          { ...ALERT, observedAt: "2026-11-19T16:46:00.000Z", observedBasis: "observed" },
          { ...ALERT, id: "alert-2", message: "Air quality above 50", observedAt: "2026-11-19T15:00:00.000Z", observedBasis: "partial" },
          { ...ALERT, id: "alert-3", message: "Wastewater load above 1", observedAt: null, observedBasis: "undeclared" },
        ],
      }),
    });
    const box = (message: string) => within(screen.getByText(message).parentElement!);
    // The words of the banner, for the same alert.
    expect(box(ALERT.message).getByText("value read 14 min ago")).toBeTruthy();
    // A floor is said as a floor, and an unknown as unknown, each with its reason in the text.
    expect(box("Air quality above 50").getByText("value read at least 2 h ago")).toBeTruthy();
    expect(
      box("Air quality above 50").getByText("At least this old — one of the sources this measure reads published no readable time."),
    ).toBeTruthy();
    expect(box("Wastewater load above 1").getByText("age of the value unknown")).toBeTruthy();
    expect(box("Wastewater load above 1").getByText(/^Unknown — no property of what this measure reads is declared/)).toBeTruthy();
    first.unmount();

    // An answer that came without the server's clock says nothing, rather than count on this computer's.
    sheet({ detail: detail({ alerts: [{ ...ALERT, observedAt: "2026-11-19T16:46:00.000Z", observedBasis: "observed" }] }) });
    expect(screen.queryByText(/value read/)).toBeNull();
  });

  it("opens the situation of an alert, and acknowledges it", () => {
    const { props } = sheet();
    const box = screen.getByText(ALERT.message).parentElement!;
    expect(within(box).getByText("critical")).toBeTruthy();
    expect(within(box).getByRole("link", { name: "Open the situation" }).getAttribute("href")).toBe(
      "/studio/situation?unit=suroit&alert=alert-1",
    );
    fireEvent.click(within(box).getByRole("button", { name: "Acknowledge" }));
    expect(props.onAck).toHaveBeenCalledWith("alert-1");
    // One way to the situation is enough: the alert's.
    expect(screen.getAllByRole("link", { name: "Open the situation" })).toHaveLength(1);
  });

  it("still leads to the situation of a unit with no alert", () => {
    sheet({ unit: unit(62), detail: detail() });
    expect(screen.getByText("None.")).toBeTruthy();
    expect(screen.getByText("Under the threshold")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the situation" }).getAttribute("href")).toBe("/studio/situation?unit=suroit");
  });

  it("asks the analyst about this unit, where there is an analyst to ask", () => {
    const { props, unmount } = sheet();
    fireEvent.click(screen.getByRole("button", { name: "Ask the analyst" }));
    expect(props.onAsk).toHaveBeenCalledTimes(1);
    unmount();

    sheet({ onAsk: null });
    expect(screen.queryByRole("button", { name: "Ask the analyst" })).toBeNull();
  });

  it("does not invent a value for a unit that reports none, and shows what else it reports", () => {
    sheet({
      unit: unit(null),
      detail: detail(),
      others: [{ key: "air", label: "Air quality index", text: "19.0", about: ["PM2.5"] }],
    });
    expect(screen.getByText("No value for this measure")).toBeTruthy();
    expect(screen.queryByText(/alert when/)).toBeNull();
    expect(screen.getByText("Air quality index · PM2.5")).toBeTruthy();
    expect(screen.getByText("19.0")).toBeTruthy();
  });

  it("says that the value of a unit with units under it counts them", () => {
    sheet({ unit: unit(82, { children: 59 }), detail: detail() });
    expect(screen.getByText(/org · 59 under it/)).toBeTruthy();
    expect(screen.getByText("Counts this unit and everything under it.")).toBeTruthy();
  });

  it("names exchanges and recommendations when the unit has them", () => {
    sheet({
      detail: detail({
        exchanges: [{ linkType: "transfers_to", direction: "out", otherUnitId: "x", otherUnitName: "Hôpital Anna-Laberge", count: 4 }],
        recommendations: ["Vérifier les congés en attente."],
      }),
    });
    expect(screen.getByText("→ Hôpital Anna-Laberge · transfers_to")).toBeTruthy();
    expect(screen.getByText("Vérifier les congés en attente.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recommendation" })).toBeTruthy();
  });

  it("shows the name and the value at once, and says the rest is being read", () => {
    sheet({ detail: null });
    expect(screen.getByRole("heading", { name: "HÔPITAL DU SUROÎT" })).toBeTruthy();
    expect(screen.getByText("150%")).toBeTruthy();
    expect(screen.getByText("Reading this unit…")).toBeTruthy();
    expect(screen.queryByText("Open alert")).toBeNull();
  });
});
