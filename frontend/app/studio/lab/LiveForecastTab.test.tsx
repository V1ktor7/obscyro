// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LoopView } from "../forecast-loops-api";

const api = vi.hoisted(() => ({
  listForecastLoops: vi.fn(),
  forecastLoopView: vi.fn(),
  createForecastLoop: vi.fn(),
  catchUpForecastLoop: vi.fn(),
  deleteForecastLoop: vi.fn(),
}));
vi.mock("../forecast-loops-api", () => api);
vi.mock("../datasets-api", () => ({
  listDatasets: vi.fn().mockResolvedValue({
    datasets: [
      { id: "adm", name: "INSPQ — Admissions quotidiennes à l'hôpital (Montréal)", columnSchema: [{ name: "date" }, { name: "region" }, { name: "admissions_hopital" }] },
      { id: "pos", name: "INSPQ — Taux de positivité (Montréal)", columnSchema: [{ name: "date" }, { name: "taux_positivite" }] },
    ],
  }),
}));

import LiveForecastTab from "./LiveForecastTab";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const add = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function loopView(): LoopView {
  const start = "2022-01-03";
  const actual: Record<string, number> = {};
  for (let k = -30; k < 60; k++) actual[add(start, k)] = 50 + k;
  const forecasts: LoopView["forecasts"] = [];
  for (let k = 0; k < 40; k++) for (const h of [1, 3, 7, 14, 21]) for (const spec of ["A", "B"]) forecasts.push({ made: add(start, k), h, spec, value: 50 + k + h });
  return {
    loop: {
      id: "l1", projectId: "p", name: "Hospital admissions", datasetId: "adm", datasetName: "", timeColumn: "date", target: "admissions_hopital",
      driver: null, horizons: [1, 3, 7, 14, 21], lags: 14,
      specs: [{ key: "A", label: "Ridge · 14 days", estimator: "ridge", exog: false, params: {} }, { key: "B", label: "Gradient boosting", estimator: "gradient_boosting", exog: false, params: {} }],
      startDate: start, frozenThrough: add(start, 39), status: "live", lastError: null, createdAt: "", updatedAt: "",
    },
    actual, lastDay: add(start, 59), forecasts,
    retrains: [{ on: start, h: 7, spec: "A", mae: 3, points: 600 }],
  };
}

describe("Live forecasts", () => {
  it("offers to start a loop on admissions, driven by positivity, when there is none", async () => {
    api.listForecastLoops.mockResolvedValue({ loops: [] });
    api.createForecastLoop.mockResolvedValue({ ...loopView().loop, status: "replaying", frozenThrough: null });
    api.forecastLoopView.mockResolvedValue({ ...loopView(), forecasts: [] });
    render(<LiveForecastTab env="mtl" onError={vi.fn()} />);
    await screen.findByText("Start a daily forecasting loop");
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Value column" }) as HTMLSelectElement).value).toBe("admissions_hopital"));
    expect((screen.getByRole("combobox", { name: "Driver value column" }) as HTMLSelectElement).value).toBe("taux_positivite");
    fireEvent.click(screen.getByRole("button", { name: /Start the loop/ }));
    await waitFor(() => expect(api.createForecastLoop).toHaveBeenCalled());
    expect(api.createForecastLoop.mock.calls[0]![1]).toMatchObject({
      datasetId: "adm", timeColumn: "date", target: "admissions_hopital", startDate: "2021-09-06",
      driver: { datasetId: "pos", column: "taux_positivite", delay: 1 },
    });
  });

  it("shows the latest morning's five forecasts from the model in force", async () => {
    api.listForecastLoops.mockResolvedValue({ loops: [loopView().loop] });
    api.forecastLoopView.mockResolvedValue(loopView());
    render(<LiveForecastTab env="mtl" onError={vi.fn()} />);
    await screen.findByText("This morning's forecast");
    // Morning 39: value = 50 + 39 + h.
    expect(screen.getByRole("button", { name: /in 7 days/ }).textContent).toContain("96");
    expect(screen.getByText(/Model in force: Ridge · 14 days/)).toBeTruthy();
    expect(screen.getAllByText("pending").length).toBe(5);
  });

  it("deletes a loop only once its name and its frozen forecasts were confirmed", async () => {
    const v = loopView();
    api.listForecastLoops.mockResolvedValueOnce({ loops: [v.loop] }).mockResolvedValue({ loops: [] });
    api.forecastLoopView.mockResolvedValue(v);
    api.deleteForecastLoop.mockResolvedValue({ deleted: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LiveForecastTab env="mtl" onError={vi.fn()} />);
    await screen.findByText("This morning's forecast");
    fireEvent.click(screen.getByRole("button", { name: "Delete this loop" }));
    expect(api.deleteForecastLoop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete this loop" }));
    await waitFor(() => expect(api.deleteForecastLoop).toHaveBeenCalledWith("mtl", "l1"));
    expect(confirm.mock.calls[1]![0]).toContain("“Hospital admissions” and the 400 forecasts it froze");
    await screen.findByText("Start a daily forecasting loop");
  });
});
