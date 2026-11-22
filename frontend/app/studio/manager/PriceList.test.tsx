// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TwinPriceList, TwinPriceRow } from "@/lib/platform-api";

const api = vi.hoisted(() => ({ fetchTwinPrices: vi.fn() }));
vi.mock("@/lib/platform-api", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-api")>()), ...api }));

import { PriceListPage, TypePrices } from "./PriceList";
import { amountText, costText, delayText, foldName, forgetPriceLists, loadPriceList, pricesOfType } from "./price-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  forgetPriceLists();
});

const row = (over: Partial<TwinPriceRow> = {}): TwinPriceRow => ({
  id: "p-normal",
  type: "Tarif",
  activity: "Soins intensifs",
  mode: "normal",
  leadDays: 14,
  perUnitOpened: { cents: 250000, low: 250000, high: 250000 },
  perUnitDay: { cents: 125050, low: 125050, high: 125050 },
  formula: null,
  canName: [],
  sites: [],
  source: "Grille tarifaire 2026, p. 12",
  demo: false,
  ...over,
});

const RUSH = row({ id: "p-rush", mode: "accéléré", leadDays: 3, perUnitOpened: { cents: 600000, low: 600000, high: 600000 }, perUnitDay: { cents: 210000, low: 210000, high: 210000 }, source: null, demo: true });
const LOCAL = row({ id: "p-lake", leadDays: 0, perUnitOpened: null, perUnitDay: { cents: 100000, low: 100000, high: 130000 }, sites: [{ id: "f1", name: "Hôpital du Lakeshore" }], source: "Entente locale" });
const AMBULANCE = row({
  id: "p-amb",
  activity: "Transferts en ambulance",
  mode: "standard",
  leadDays: 0,
  perUnitOpened: null,
  perUnitDay: null,
  formula: "ceil(units / places) * (frais_fixe + prix_par_km * distance_km)",
  canName: [
    { name: "places", value: 4, of: "row" },
    { name: "frais_fixe", value: 35000, of: "row" },
    { name: "units", value: null, of: "operation" },
    { name: "days", value: null, of: "operation" },
  ],
  source: null,
  demo: true,
});

const FORMULAS = { functions: ["abs", "sqrt", "floor", "ceil", "round", "min", "max", "sum", "mean"], operation: ["units", "days"] };
const LIST: TwinPriceList = {
  types: ["Tarif"],
  rows: [LOCAL, RUSH, row(), AMBULANCE],
  problems: ["Tarif “Civières”: the price for a unit kept open a day is not a whole number of cents (12.5): an amount is written in cents, 125050 for 1,250.50 $. It is not used."],
  formulas: FORMULAS,
};
const NONE: TwinPriceList = { types: [], rows: [], problems: [], formulas: FORMULAS };

describe("reading a price row", () => {
  it("finds a type's prices whether the row names the type or the activity the engine writes", () => {
    expect(foldName("Soins Intensifs")).toBe(foldName("soins_intensifs"));
    expect(foldName("  Unité de  soins ")).toBe("unite_de_soins");
    expect(pricesOfType(LIST, "soins intensifs").map((r) => r.id)).toEqual(["p-lake", "p-rush", "p-normal"]);
    expect(pricesOfType(LIST, "Soins")).toEqual([]);
  });

  it("writes an amount held in cents, with its range when the row declares one", () => {
    expect(amountText({ cents: 125050, low: 125050, high: 125050 })).toBe("1,250.50 $");
    expect(amountText({ cents: 100000, low: 100000, high: 130000 })).toBe("1,000 $ (1,000 $ to 1,300 $)");
    expect(costText(row())).toBe("2,500 $ to open a unit, 1,250.50 $ a unit a day");
    expect(costText(AMBULANCE)).toBe("by formula: ceil(units / places) * (frais_fixe + prix_par_km * distance_km)");
  });

  it("does not turn a delay nobody declared into a promise", () => {
    expect(delayText(0)).toBe("No delay declared");
    expect([delayText(1), delayText(14)]).toEqual(["1 day", "14 days"]);
  });

  it("reads the list once for the page and the panels opened after it, and again when asked", async () => {
    api.fetchTwinPrices.mockResolvedValue(LIST);
    await Promise.all([loadPriceList("env"), loadPriceList("env")]);
    expect(api.fetchTwinPrices).toHaveBeenCalledTimes(1);
    await loadPriceList("env", true);
    expect(api.fetchTwinPrices).toHaveBeenCalledTimes(2);
    // Another environment is another price list.
    await loadPriceList("other");
    expect(api.fetchTwinPrices).toHaveBeenLastCalledWith("other");
  });

  it("does not keep a read that failed", async () => {
    api.fetchTwinPrices.mockRejectedValueOnce(new Error("down")).mockResolvedValue(LIST);
    await expect(loadPriceList("env")).rejects.toThrow("down");
    await expect(loadPriceList("env")).resolves.toBe(LIST);
  });
});

describe("the Functions page", () => {
  it("shows each cost formula with what it may name, and the price list it belongs to", async () => {
    api.fetchTwinPrices.mockResolvedValue(LIST);
    render(<PriceListPage env="env" />);

    const formulas = await screen.findByRole("region", { name: "Cost formulas" });
    expect(within(formulas).getByText("ceil(units / places) * (frais_fixe + prix_par_km * distance_km)")).toBeTruthy();
    // The row's own numbers with their values, then the quantities of the operation.
    expect(within(formulas).getByText("places = 4")).toBeTruthy();
    expect(within(formulas).getByText("frais_fixe = 35,000")).toBeTruthy();
    expect(within(formulas).getByText("units")).toBeTruthy();
    expect(within(formulas).getByText("days")).toBeTruthy();
    expect(within(formulas).getByText("demo price")).toBeTruthy();
    // What a formula can be written with is the server's list, not the page's.
    expect(within(formulas).getByText(/and the functions abs, sqrt, floor, ceil, round, min, max, sum, mean\./)).toBeTruthy();
    expect(within(formulas).getByText(/units and days for capacity an option\s+opens/)).toBeTruthy();

    const table = within(screen.getByRole("region", { name: "Price list" })).getAllByRole("row");
    expect(table.map((r) => Array.from(r.querySelectorAll("th,td")).map((c) => c.textContent))).toEqual([
      ["Activity", "Mode", "Takes", "To open one unit", "One unit, one day", "For", "Source"],
      ["Soins intensifs", "normal", "No delay declared", "—", "1,000 $ (1,000 $ to 1,300 $)", "Hôpital du Lakeshore", "Entente locale"],
      ["Soins intensifs", "accéléré", "3 days", "6,000 $", "2,100 $", "Whole network", "demo price"],
      ["Soins intensifs", "normal", "14 days", "2,500 $", "1,250.50 $", "Whole network", "Grille tarifaire 2026, p. 12"],
      ["Transferts en ambulance", "standard", "No delay declared", "By formula, above", "Whole network", "demo price"],
    ]);

    // A row that could not be read is said, not dropped.
    expect(within(screen.getByRole("region", { name: "Rows not used" })).getByText(/is not a whole number of cents \(12\.5\)/)).toBeTruthy();
    expect(screen.getByText(/4 price rows in use, 1 set aside\./)).toBeTruthy();
  });

  it("says so when the twin declares no price list, and how one is declared", async () => {
    api.fetchTwinPrices.mockResolvedValue(NONE);
    render(<PriceListPage env="env" />);
    expect(await screen.findByText("This twin declares no price list.")).toBeTruthy();
    expect(screen.getByText(/no option is costed, and nothing is called free/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Price list" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Cost formulas" })).toBeNull();
  });

  it("reads the list again on demand", async () => {
    api.fetchTwinPrices.mockResolvedValueOnce(NONE).mockResolvedValue(LIST);
    render(<PriceListPage env="env" />);
    await screen.findByText("This twin declares no price list.");
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(await screen.findByRole("region", { name: "Price list" })).toBeTruthy();
    expect(api.fetchTwinPrices).toHaveBeenCalledTimes(2);
  });

  it("says when the list could not be read", async () => {
    api.fetchTwinPrices.mockRejectedValue(new Error("The twin could not be read."));
    render(<PriceListPage env="env" />);
    expect((await screen.findByRole("alert")).textContent).toBe("The price list could not be read: The twin could not be read.");
  });
});

describe("the prices of a type, in its panel", () => {
  it("lists the rows that price its units: mode, delay, where, what, and from what source", async () => {
    api.fetchTwinPrices.mockResolvedValue(LIST);
    render(<TypePrices env="env" typeName="Soins intensifs" />);
    const rows = within(await screen.findByRole("list", { name: "Prices of Soins intensifs" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Mode “normal”no delay declared · Hôpital du Lakeshore1,000 $ (1,000 $ to 1,300 $) a unit a daySource: Entente locale",
      "Mode “accéléré”3 days · whole network6,000 $ to open a unit, 2,100 $ a unit a daydemo price",
      "Mode “normal”14 days · whole network2,500 $ to open a unit, 1,250.50 $ a unit a daySource: Grille tarifaire 2026, p. 12",
    ]);
  });

  it("says a type nothing prices is unpriced, not free", async () => {
    api.fetchTwinPrices.mockResolvedValue(LIST);
    render(<TypePrices env="env" typeName="Civière" />);
    expect(await screen.findByText("The price list holds no price for this type. Opening its units is unpriced, not free.")).toBeTruthy();
  });

  it("says so when the twin declares no price list at all", async () => {
    api.fetchTwinPrices.mockResolvedValue(NONE);
    render(<TypePrices env="env" typeName="Soins intensifs" />);
    await waitFor(() => expect(screen.getByText("The twin declares no price list, so a unit of this type has no price.")).toBeTruthy());
  });

  it("points a price list type to where its rows are shown", async () => {
    api.fetchTwinPrices.mockResolvedValue(LIST);
    render(<TypePrices env="env" typeName="Tarif" />);
    expect(await screen.findByText(/This type is a price list: each of its instances is one price row\./)).toBeTruthy();
  });
});
