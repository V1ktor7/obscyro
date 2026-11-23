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

import type { TwinReading, TwinUnitDetail, TwinUnitHistory } from "@/lib/platform-api";

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

describe("what the twin kept of the value shown", () => {
  const AT = "2026-11-22T12:00:00.000Z";
  const ago = (hours: number) => new Date(Date.parse(AT) - hours * 3_600_000).toISOString();
  const reading = (hoursAgo: number, value: number | null): TwinReading => ({
    value,
    observedAt: value === null ? null : ago(hoursAgo),
    observedBasis: value === null ? null : "observed",
    recordedAt: ago(hoursAgo),
  });
  const kept = (readings: TwinReading[], over: Partial<TwinUnitHistory> = {}): TwinUnitHistory => ({
    at: AT,
    unitId: "suroit",
    metric: "stretchers",
    hours: 48,
    since: readings.length ? readings[0]!.recordedAt : null,
    readings,
    cut: false,
    everySeconds: 300,
    ...over,
  });

  it("draws the readings, with the lowest and the highest written like the value above", () => {
    sheet({ history: { state: "read", history: kept([reading(40, 96), reading(20, 143), reading(2, 150)], { since: ago(300) }) } });
    const title = screen.getByRole("heading", { name: "History · last 48 h" });
    const block = title.parentElement!;
    const drawing = within(block).getByRole("img");
    // The drawing says in words what it shows, for whoever cannot see it.
    expect(drawing.getAttribute("aria-label")).toBe("Stretcher occupancy over the last 48 h: 3 readings · lowest 96% · highest 150%");
    expect(drawing.querySelectorAll("polyline")).toHaveLength(1);
    expect(within(block).getByText("3 readings · lowest 96% · highest 150%")).toBeTruthy();
    // Where the history starts is on the sheet: nothing earlier was kept.
    expect(within(block).getByText("The first reading of this value was kept 13 d ago. Nothing earlier is known.")).toBeTruthy();
    expect(within(block).getByText("Each value holds until the next reading. The twin is read every 5 min.")).toBeTruthy();
  });

  it("breaks the line where the measure had no value", () => {
    sheet({ history: { state: "read", history: kept([reading(40, 96), reading(30, null), reading(2, 150)]) } });
    expect(screen.getByRole("img").querySelectorAll("polyline")).toHaveLength(2);
  });

  it("says that nothing was kept yet instead of drawing an empty chart", () => {
    sheet({ history: { state: "read", history: kept([]) } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/No reading of this value has been kept yet\. The twin writes its measures down every 5 min/)).toBeTruthy();
  });

  it("says that a built-in count is not kept over time", () => {
    sheet({ history: { state: "not_kept" } });
    expect(screen.getByText("This count is computed on the spot and is not kept over time. The measures your organisation defined are.")).toBeTruthy();
  });

  it("says when the history is being read, and when it could not be", () => {
    const { rerender, props } = sheet({ history: { state: "reading" } });
    expect(screen.getByText("Reading what was kept…")).toBeTruthy();
    rerender(<UnitSheet {...props} history={{ state: "failed" }} />);
    // The value above is still the reading now: a history that fails takes nothing else with it.
    expect(screen.getByText("The history of this value could not be read. The value above is the reading now.")).toBeTruthy();
    expect(screen.getByText("150%")).toBeTruthy();
  });

  it("shows no history block where nothing reads one", () => {
    sheet();
    expect(screen.queryByRole("heading", { name: /^History/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What moved, what is usual, what is withheld, and where it comes from.
// ---------------------------------------------------------------------------

const STAY: Measure = { key: "stay", label: "Average stay, walk-in patients", unit: "hours" };
const AT = "2026-11-22T23:00:00.000Z";

function stayUnit(value: number | null): UnitRow {
  const row = unit(value === null ? null : 150);
  return { ...row, value, text: value === null ? "no value" : "5 h 59", band: value === null ? "absent" : "unbanded", rule: null };
}

describe("beside a value, what the twin kept of it", () => {
  it("says how far the value moved since the reading before, and from which hour", () => {
    sheet({
      detail: detail({
        at: AT,
        trends: { at: AT, changes: { stretchers: { previous: { value: 144, at: "2026-11-22T21:45:00.000Z", atIs: "observed" }, delta: 6 } }, means: {} },
      }),
    });
    expect(screen.getByText(/^Up 6 pts since the reading of \d{2}:45\.$/)).toBeTruthy();
  });

  it("writes that nothing was kept before, instead of a change", () => {
    sheet({ detail: detail({ at: AT, trends: { at: AT, changes: { stretchers: { previous: null, delta: null } }, means: {} } }) });
    expect(screen.getByText("No earlier reading of this value was kept: nothing to compare it with.")).toBeTruthy();
  });

  it("says nothing about a change when the history could not be read", () => {
    sheet({ detail: detail({ at: AT, trends: null }) });
    expect(screen.queryByText(/since the reading/)).toBeNull();
    // The reading now is still there.
    expect(screen.getByText("Linked objects")).toBeTruthy();
  });

  it("never gives a figure of the day before the age of the last hour", () => {
    const d = detail({
      at: AT,
      trends: { at: AT, changes: {}, means: { stay: { mean: 6.2, days: 12, from: "2026-11-11", to: "2026-11-22", window: 30 } } },
    });
    d.metrics.values = { stay: 5.99 };
    d.metrics.valueAges = { stay: { seconds: 900, basis: "observed", period: "previous_day", zone: "America/Toronto" } };
    sheet({ unit: stayUnit(5.99), measure: STAY, detail: d });
    expect(screen.getByText("Yesterday's average, published 15m ago")).toBeTruthy();
    expect(screen.queryByText(/This value was read/)).toBeNull();
    // The mean says how many days it rests on.
    expect(screen.getByText(/Average over 12 days kept:/).textContent).toContain("6 h 12");
  });

  it("says why a measure with something to read shows no value", () => {
    const d = detail({ at: AT });
    d.metrics.values = { stay: null };
    d.metrics.withheld = { stay: { reason: "several", count: 2 } };
    sheet({ unit: stayUnit(null), measure: STAY, detail: d });
    expect(screen.getByText(/2 units under this one each publish their own average/)).toBeTruthy();
  });

  it("lists what else the unit reports with each change, and says the hour once", () => {
    sheet({
      others: [
        { key: "present", label: "People in the emergency room", text: "136", about: [], change: { text: "▲ 6", since: "16:45", says: "Up 6 since the reading of 16:45." } },
        { key: "waiting", label: "Waiting to see a doctor", text: "35", about: [], change: { text: "no change", since: "16:45", says: "No change since the reading of 16:45." } },
        { key: "stay", label: "Average stay, walk-in patients", text: "5 h 59", about: [], daily: true, change: { text: "▼ 0 h 25", since: "21 Nov 23:45", says: "Down 0 h 25 since the reading of 21 Nov 23:45." }, mean: { text: "6 h 12", label: "average over 12 days kept" } },
        { key: "stretcher_stay", label: "Average stay, stretcher patients", text: null, about: [], withheld: "Its source published no figure in the latest reading." },
      ],
    });
    const block = screen.getByRole("heading", { name: "Also reports" }).parentElement!;
    expect(within(block).getByText("▲ 6")).toBeTruthy();
    expect(within(block).getByText("no change")).toBeTruthy();
    // Counted from another hour: it carries its own.
    expect(within(block).getByText("▼ 0 h 25 · 21 Nov 23:45")).toBeTruthy();
    expect(within(block).getByText("yesterday · average over 12 days kept 6 h 12")).toBeTruthy();
    expect(within(block).getByText("Change since the reading of 16:45.")).toBeTruthy();
    // A withheld measure keeps its line, with the reason and no figure.
    expect(within(block).getByText("no value")).toBeTruthy();
    expect(within(block).getByText("Its source published no figure in the latest reading.")).toBeTruthy();
  });

  it("prints where the figures come from, in the organisation's own words", () => {
    sheet({ notes: [{ type: "ReleveUrgence", text: "Source : MSSS, Console provinciale des urgences, CC-BY 4.0. Diffusé 45 minutes après l'heure du relevé." }] });
    const block = screen.getByRole("heading", { name: "About these figures" }).parentElement!;
    expect(within(block).getByText(/CC-BY 4\.0/)).toBeTruthy();
    cleanup();
    // Nothing written on the type: no block, rather than an empty one.
    sheet({ notes: [] });
    expect(screen.queryByRole("heading", { name: "About these figures" })).toBeNull();
  });
});

describe("the age of what else a unit reports", () => {
  it("is said once for the list, and on the line of a value read at another hour", () => {
    sheet({
      others: [
        { key: "present", label: "People in the emergency room", text: "136", about: [], age: "read 27m ago" },
        { key: "waiting", label: "Waiting to see a doctor", text: "35", about: [], age: "read 27m ago" },
        { key: "iqa", label: "Air quality index", text: "14.0", about: ["O3"], age: "read 2h ago" },
        { key: "stay", label: "Average stay, walk-in patients", text: "5 h 59", about: [], daily: true, age: "published 27m ago" },
      ],
    });
    const block = screen.getByRole("heading", { name: "Also reports" }).parentElement!;
    expect(within(block).getByText("Values read 27m ago.")).toBeTruthy();
    // The value from another source carries its own age; the two that share the list's do not repeat it.
    expect(within(block).getByText("read 2h ago")).toBeTruthy();
    expect(within(block).queryByText("read 27m ago")).toBeNull();
    // A figure of the day before says when it was published.
    expect(within(block).getByText("yesterday, published 27m ago")).toBeTruthy();
  });
});
