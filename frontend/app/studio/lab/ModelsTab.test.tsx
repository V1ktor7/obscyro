// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The gates on a fit.
 *
 * None of these stop the software working; each stops it producing a number
 * somebody would believe. A target sitting among its own features scores
 * perfectly and predicts nothing; a chronological split with no time column is
 * not chronological; column choices carried over from another table are choices
 * about columns that are not there.
 */

const api = vi.hoisted(() => ({
  listDatasets: vi.fn(),
  listEstimators: vi.fn(),
  listLabModels: vi.fn(),
  trainLabModel: vi.fn(),
  deleteLabModel: vi.fn(),
  predictWithModel: vi.fn(),
  runCell: vi.fn(),
  liftOverBaseline: vi.fn(() => 0.42),
}));

vi.mock("../datasets-api", () => ({ listDatasets: api.listDatasets }));
vi.mock("../lab-models-api", () => api);

import ModelsTab from "./ModelsTab";

const DATASETS = {
  datasets: [
    {
      id: "d1",
      name: "MSSS — Urgences",
      rowCount: 120,
      columnSchema: [
        { name: "date", type: "string" },
        { name: "capacite", type: "number" },
        { name: "occupees", type: "number" },
      ],
    },
    {
      id: "d2",
      name: "INSPQ — Soins intensifs",
      rowCount: 1075,
      columnSchema: [{ name: "admissions", type: "number" }],
    },
  ],
};

const ESTIMATORS = {
  estimators: [
    { key: "ridge", label: "Ridge", task: "regression", params: { alpha: 1.0 }, note: "n" },
    { key: "logistic", label: "Logistique", task: "classification", params: {} },
  ],
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  api.listDatasets.mockResolvedValue(DATASETS);
  api.listEstimators.mockResolvedValue(ESTIMATORS);
  api.listLabModels.mockResolvedValue({ models: [] });
  api.liftOverBaseline.mockReturnValue(0.42);
});

const fitButton = () => screen.getByRole("button", { name: /Entraîner/ }) as HTMLButtonElement;

async function pickDataset(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.selectOptions(await screen.findByLabelText(/Jeu de données/), [
    screen.getByRole("option", { name: label }),
  ]);
}

describe("what has to be chosen before a fit can run", () => {
  it("refuses to fit with nothing chosen", async () => {
    render(<ModelsTab env="e" onError={() => {}} />);
    await screen.findByLabelText(/Jeu de données/);
    expect(fitButton().disabled).toBe(true);
  });

  it("still refuses once a table is chosen but no target is", async () => {
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await pickDataset(user, /MSSS/);
    expect(fitButton().disabled).toBe(true);
  });

  it("accepts once table, target, a feature and a name are set", async () => {
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await pickDataset(user, /MSSS/);
    await user.selectOptions(screen.getByLabelText(/Cible/), "occupees");
    await user.click(screen.getByRole("checkbox", { name: /capacite/ }));
    await user.type(screen.getByLabelText(/Nom du modèle/), "essai");
    await waitFor(() => expect(fitButton().disabled).toBe(false));
  });
});

describe("the target and the features", () => {
  it("drops the target out of the feature list", async () => {
    // A model that can see its own answer scores perfectly and predicts
    // nothing. The backend refuses it; the UI should never offer it.
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await pickDataset(user, /MSSS/);
    await user.selectOptions(screen.getByLabelText(/Cible/), "occupees");
    expect(screen.queryByRole("checkbox", { name: /^occupees$/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /capacite/ })).toBeTruthy();
  });

  it("unticks a feature that later becomes the target", async () => {
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await pickDataset(user, /MSSS/);
    await user.click(screen.getByRole("checkbox", { name: /occupees/ }));
    await user.selectOptions(screen.getByLabelText(/Cible/), "occupees");
    await user.type(screen.getByLabelText(/Nom du modèle/), "essai");
    // The only feature was taken as the target, so there is nothing left to fit on.
    await waitFor(() => expect(fitButton().disabled).toBe(true));
  });

  it("forgets the columns of the previous table", async () => {
    // Carrying them over submits a fit against columns that are not there.
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await pickDataset(user, /MSSS/);
    await user.selectOptions(screen.getByLabelText(/Cible/), "occupees");
    await user.click(screen.getByRole("checkbox", { name: /capacite/ }));
    await pickDataset(user, /INSPQ/);
    expect((screen.getByLabelText(/Cible/) as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(/Variables explicatives \(0\)/)).toBeTruthy();
  });
});

describe("the split", () => {
  it("will not fit chronologically without a time column", async () => {
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await pickDataset(user, /MSSS/);
    await user.selectOptions(screen.getByLabelText(/Cible/), "occupees");
    await user.click(screen.getByRole("checkbox", { name: /capacite/ }));
    await user.type(screen.getByLabelText(/Nom du modèle/), "essai");
    await user.selectOptions(screen.getByLabelText(/Comment séparer/), "chronological");
    await waitFor(() => expect(fitButton().disabled).toBe(true));

    await user.selectOptions(screen.getByLabelText(/Colonne de temps/), "date");
    await waitFor(() => expect(fitButton().disabled).toBe(false));
  });

  it("sends the split and the time column it was given", async () => {
    const user = userEvent.setup();
    api.trainLabModel.mockResolvedValue({
      id: "m1", name: "essai", task: "regression", estimator: "ridge",
      metrics: { r2: 0.9 }, baseline: { r2: 0.1 }, importances: [], warnings: [],
      classes: [], nTrain: 90, nTest: 30, droppedRows: 0, features: ["capacite"],
      numericFeatures: [], categoricalFeatures: [], split: "chronological",
      testSize: 0.25, timeColumn: "date", target: "occupees", params: {},
      datasetId: "d1", datasetName: "x", projectId: "p", timeLags: null, horizon: null, exog: [], folds: [], kind: "tabular", createdAt: "2026-09-04",
    });
    render(<ModelsTab env="e" onError={() => {}} />);
    await pickDataset(user, /MSSS/);
    await user.selectOptions(screen.getByLabelText(/Cible/), "occupees");
    await user.click(screen.getByRole("checkbox", { name: /capacite/ }));
    await user.type(screen.getByLabelText(/Nom du modèle/), "essai");
    await user.selectOptions(screen.getByLabelText(/Comment séparer/), "chronological");
    await user.selectOptions(screen.getByLabelText(/Colonne de temps/), "date");
    await user.click(fitButton());

    await waitFor(() => expect(api.trainLabModel).toHaveBeenCalled());
    expect(api.trainLabModel.mock.calls[0]![1]).toMatchObject({
      split: "chronological",
      timeColumn: "date",
      target: "occupees",
      features: ["capacite"],
    });
  });
});

describe("what the result says", () => {
  it("puts the baseline beside every metric", async () => {
    api.listLabModels.mockResolvedValue({
      models: [
        {
          id: "m1", name: "déjà là", task: "regression", estimator: "ridge",
          metrics: { r2: 0.87 }, baseline: { r2: 0.11 }, importances: [],
          warnings: [], classes: [], nTrain: 90, nTest: 30, droppedRows: 4,
          features: [], numericFeatures: [], categoricalFeatures: [],
          split: "random", testSize: 0.25, timeColumn: null, target: "occupees",
          params: {}, datasetId: "d1", datasetName: "x", projectId: "p",
          timeLags: null, horizon: null, exog: [], folds: [], kind: "tabular", createdAt: "2026-09-04",
        },
      ],
    });
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await user.click(await screen.findByText("déjà là"));
    expect(screen.getByText(/ligne de base : 0.11/)).toBeTruthy();
    expect(screen.getByText(/4 lignes écartées/)).toBeTruthy();
  });

  it("shows a warning above the numbers it invalidates", async () => {
    api.listLabModels.mockResolvedValue({
      models: [
        {
          id: "m1", name: "plat", task: "regression", estimator: "ridge",
          metrics: { r2: 0.02 }, baseline: { r2: 0.01 }, importances: [],
          warnings: ["Le modèle ne fait pas mieux que prédire la moyenne."],
          classes: [], nTrain: 90, nTest: 30, droppedRows: 0, features: [],
          numericFeatures: [], categoricalFeatures: [], split: "random",
          testSize: 0.25, timeColumn: null, target: "occupees", params: {},
          datasetId: "d1", datasetName: "x", projectId: "p",
          timeLags: null, horizon: null, exog: [], folds: [], kind: "tabular", createdAt: "2026-09-04",
        },
      ],
    });
    const user = userEvent.setup();
    render(<ModelsTab env="e" onError={() => {}} />);
    await user.click(await screen.findByText("plat"));
    expect(screen.getByText(/pas mieux que prédire la moyenne/)).toBeTruthy();
  });
});
