// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * What a forecast screen must not let somebody believe.
 *
 * Three of these are about claims rather than crashes: a classifier cannot
 * forecast a quantity, a model that reads columns nobody knows the future of
 * cannot be extended past the data, and an average MASE hides the window where
 * the model fell apart — which is usually the most recent one.
 */

const api = vi.hoisted(() => ({
  listDatasets: vi.fn(),
  listEstimators: vi.fn(),
  listLabModels: vi.fn(),
  trainForecast: vi.fn(),
  runForecast: vi.fn(),
}));

vi.mock("../datasets-api", () => ({ listDatasets: api.listDatasets }));
vi.mock("../lab-models-api", () => api);

import ForecastTab from "./ForecastTab";

const DATASETS = {
  datasets: [
    {
      id: "d1",
      name: "MSSS — Urgences",
      rowCount: 1075,
      columnSchema: [
        { name: "date", type: "string" },
        { name: "admissions", type: "number" },
        { name: "meteo", type: "number" },
      ],
    },
    {
      id: "d2",
      name: "INSPQ — Eaux usées",
      rowCount: 210,
      columnSchema: [
        { name: "jour", type: "string" },
        { name: "charge", type: "number" },
      ],
    },
  ],
};

const ESTIMATORS = {
  estimators: [
    { key: "ridge", label: "Ridge", task: "regression", params: { alpha: 1 } },
    { key: "random_forest", label: "Forêt aléatoire", task: "regression", params: {} },
    { key: "logistic", label: "Logistique", task: "classification", params: {} },
  ],
};

const model = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  kind: "timeseries",
  projectId: "p",
  name: "Admissions 7j",
  datasetId: "d1",
  datasetName: "MSSS — Urgences",
  task: "regression",
  estimator: "ridge",
  params: {},
  target: "admissions",
  features: ["admissions"],
  numericFeatures: [],
  categoricalFeatures: [],
  split: "chronological",
  testSize: 0.25,
  timeColumn: "date",
  metrics: { mase: 0.62, mae: 3.1, rmse: 4.4, naive_mae: 5.0 },
  baseline: { mae: 5.0, mase: 1 },
  importances: [],
  warnings: [],
  classes: [],
  nTrain: 1000,
  nTest: 4,
  droppedRows: 7,
  timeLags: 7,
  horizon: 1,
  exog: [] as string[],
  folds: [
    { origin: "2026-03-01", nTrain: 500, nTest: 100, mae: 2.9, rmse: 4, naiveMae: 5, mase: 0.58 },
    { origin: "2026-06-01", nTrain: 600, nTest: 100, mae: 6.2, rmse: 8, naiveMae: 5, mase: 1.24 },
  ],
  createdAt: "2026-09-04T00:00:00.000Z",
  ...over,
});

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  api.listDatasets.mockResolvedValue(DATASETS);
  api.listEstimators.mockResolvedValue(ESTIMATORS);
  api.listLabModels.mockResolvedValue({ models: [] });
});

const fitButton = () =>
  screen.getByRole("button", { name: /Évaluer et entraîner/ }) as HTMLButtonElement;

async function setUpSeries(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText(/Jeu de données/), [
    screen.getByRole("option", { name: /MSSS/ }),
  ]);
  await user.selectOptions(screen.getByLabelText(/Colonne de temps/), "date");
  await user.selectOptions(screen.getByLabelText(/Série à prévoir/), "admissions");
  await user.type(screen.getByLabelText(/Nom du modèle/), "essai");
}

describe("what can be asked of a forecast", () => {
  it("offers no classifier — a class is not a quantity to forecast", async () => {
    render(<ForecastTab env="e" onError={() => {}} />);
    await waitFor(() => expect(api.listEstimators).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: /Logistique/ })).toBeNull(),
    );
    expect(screen.getByRole("option", { name: /Ridge/ })).toBeTruthy();
  });

  it("will not forecast the time column against itself", async () => {
    const user = userEvent.setup();
    render(<ForecastTab env="e" onError={() => {}} />);
    await user.selectOptions(await screen.findByLabelText(/Jeu de données/), [
      screen.getByRole("option", { name: /MSSS/ }),
    ]);
    await user.selectOptions(screen.getByLabelText(/Colonne de temps/), "date");
    const targets = screen.getByLabelText(/Série à prévoir/) as HTMLSelectElement;
    expect(Array.from(targets.options).map((o) => o.value)).not.toContain("date");
  });

  it("refuses to fit until a series and a name are chosen", async () => {
    const user = userEvent.setup();
    render(<ForecastTab env="e" onError={() => {}} />);
    await screen.findByLabelText(/Jeu de données/);
    expect(fitButton().disabled).toBe(true);
    await setUpSeries(user);
    await waitFor(() => expect(fitButton().disabled).toBe(false));
  });

  it("forgets the columns of the previous table", async () => {
    // Carrying them over sends a fit against columns that are not there.
    const user = userEvent.setup();
    render(<ForecastTab env="e" onError={() => {}} />);
    await setUpSeries(user);
    await user.selectOptions(screen.getByLabelText(/Jeu de données/), [
      screen.getByRole("option", { name: /INSPQ/ }),
    ]);
    expect((screen.getByLabelText(/Colonne de temps/) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(/Série à prévoir/) as HTMLSelectElement).value).toBe("");
  });

  it("sends the lags, the horizon and the explanatory columns it was given", async () => {
    const user = userEvent.setup();
    api.trainForecast.mockResolvedValue(model());
    render(<ForecastTab env="e" onError={() => {}} />);
    await setUpSeries(user);
    await user.click(screen.getByRole("checkbox", { name: "meteo" }));
    await user.click(fitButton());

    await waitFor(() => expect(api.trainForecast).toHaveBeenCalled());
    expect(api.trainForecast.mock.calls[0]![1]).toMatchObject({
      datasetId: "d1",
      timeColumn: "date",
      target: "admissions",
      estimator: "ridge",
      lags: 7,
      horizon: 1,
      exog: ["meteo"],
    });
  });
});

describe("what the result is allowed to claim", () => {
  it("shows every window it scored, not only their average", async () => {
    // A model good on three origins and bad on the fourth has an average that
    // hides the fourth, and the fourth is usually the most recent.
    const user = userEvent.setup();
    api.trainForecast.mockResolvedValue(model());
    render(<ForecastTab env="e" onError={() => {}} />);
    await setUpSeries(user);
    await user.click(fitButton());

    await screen.findByText("2026-03-01");
    expect(screen.getByText("2026-06-01")).toBeTruthy();
    expect(screen.getByText("1.24")).toBeTruthy();
  });

  it("reads the naive forecast beside the error, not on its own", async () => {
    const user = userEvent.setup();
    api.trainForecast.mockResolvedValue(model());
    render(<ForecastTab env="e" onError={() => {}} />);
    await setUpSeries(user);
    await user.click(fitButton());

    await screen.findByText("0.62");
    expect(screen.getByText(/naïve : 5/)).toBeTruthy();
  });

  it("passes the service's warnings through untouched", async () => {
    const user = userEvent.setup();
    api.trainForecast.mockResolvedValue(
      model({
        metrics: { mase: 1.4, mae: 7, rmse: 9, naive_mae: 5 },
        warnings: ["Le modèle ne bat pas la prévision naïve — répéter la dernière valeur."],
      }),
    );
    render(<ForecastTab env="e" onError={() => {}} />);
    await setUpSeries(user);
    await user.click(fitButton());

    await screen.findByText(/ne bat pas la prévision naïve/);
  });

  it("will not extend a series that depends on columns nobody knows the future of", async () => {
    // Holding the exogenous inputs constant would produce a curve that looks
    // like a forecast and is a guess about the weather.
    const user = userEvent.setup();
    api.trainForecast.mockResolvedValue(model({ exog: ["meteo"] }));
    render(<ForecastTab env="e" onError={() => {}} />);
    await setUpSeries(user);
    await user.click(fitButton());

    const extend = await screen.findByRole("button", { name: /Prolonger la série/ });
    expect((extend as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the compounding-error note attached to the curve it belongs to", async () => {
    const user = userEvent.setup();
    api.trainForecast.mockResolvedValue(model());
    api.runForecast.mockResolvedValue({
      points: [
        { step: 1, t: "2026-09-05", value: 41 },
        { step: 2, t: "2026-09-06", value: 43 },
      ],
      note: "Chaque pas est calculé à partir du précédent : l'erreur s'accumule.",
    });
    render(<ForecastTab env="e" onError={() => {}} />);
    await setUpSeries(user);
    await user.click(fitButton());
    await user.click(await screen.findByRole("button", { name: /Prolonger la série/ }));

    await screen.findByText(/l'erreur s'accumule/);
    expect(api.runForecast).toHaveBeenCalledWith("f1", 14);
  });
});
