// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import CardChart from "./CardChart";
import type { Card } from "../dashboards-api";

/**
 * What a card admits about itself.
 *
 * All three of these were live on real government data before they were caught:
 * a bar chart of the thirty largest hospitals out of a hundred and twenty that
 * announced "30 catégories", a card silently dropping the twelve rows that read
 * "pas d'information disponible", and a curve whose axis started at 1900 with
 * nothing saying so. None of them fails. They just read as something other than
 * what they are.
 */

afterEach(cleanup);

const card = (over: Partial<Card> = {}): Card => ({
  id: "c1",
  dashboardId: "d1",
  position: 0,
  title: "Civières",
  kind: "bar",
  sourceKind: "dataset",
  sourceId: "s1",
  sourceName: "MSSS — Situation horaire à l'urgence (Montréal)",
  config: { x: "Nom_installation", y: "civieres", agg: "max" },
  data: {
    points: Array.from({ length: 30 }, (_, i) => ({ label: `Hôpital ${i}`, value: 50 - i })),
    rows: [],
    columns: [],
    rowsRead: 120,
    rowsSkipped: 12,
    categoriesHidden: 90,
    sampledEvery: 1,
    sites: [],
    sitesUnread: 0,
    sitesUnplaced: 0,
    band: [],
    predicted: [],
    real: [],
    overlap: 0,
    meanGap: null,
    worstGap: null,
    note: null,
    error: null,
  },
  ...over,
});

describe("what a bar card says about what it left out", () => {
  it("says how many categories are outside the chart", () => {
    render(<CardChart card={card()} />);
    expect(screen.getByText(/90 de plus hors du graphique/)).toBeTruthy();
  });

  it("says it is showing the highest ones, not all of them", () => {
    // "30 catégories" reads as the size of the network. It was not.
    const { container } = render(<CardChart card={card()} />);
    expect(container.textContent).toMatch(/les 30 plus élevées sur 120/);
  });

  it("says plainly how many categories there are when none are hidden", () => {
    const { container } = render(
      <CardChart card={card({ data: { ...card().data, categoriesHidden: 0 } })} />,
    );
    expect(container.textContent).toMatch(/30 catégories/);
    expect(container.textContent).not.toMatch(/plus élevées/);
  });

  it("names the rows that carried no measure", () => {
    render(<CardChart card={card()} />);
    expect(screen.getByText(/12 sans mesure/)).toBeTruthy();
  });

  it("stays quiet when nothing was dropped", () => {
    render(
      <CardChart
        card={card({ data: { ...card().data, rowsSkipped: 0, categoriesHidden: 0 } })}
      />,
    );
    expect(screen.queryByText(/sans mesure/)).toBeNull();
    expect(screen.queryByText(/hors du graphique/)).toBeNull();
  });
});

describe("what a broken card says", () => {
  it("names the missing column instead of drawing a blank frame", () => {
    render(
      <CardChart
        card={card({
          data: { ...card().data, error: "Colonne absente du jeu de donnees : civieres_en_service" },
        })}
      />,
    );
    expect(screen.getByText(/civieres_en_service/)).toBeTruthy();
  });

  it("drops the row count when it could not read anything", () => {
    // "120 lignes lues" under an error message is a contradiction.
    render(<CardChart card={card({ data: { ...card().data, error: "cassé" } })} />);
    expect(screen.queryByText(/lignes lues/)).toBeNull();
  });
});

describe("a curve longer than the card is wide", () => {
  it("says it is drawing one point in three, over the whole window", () => {
    // Taking the first five hundred days of a three-year series would end the
    // curve in mid-2021 with nothing saying the rest exists.
    render(
      <CardChart
        card={card({
          kind: "line",
          data: { ...card().data, categoriesHidden: 0, sampledEvery: 3 },
        })}
      />,
    );
    expect(screen.getByText(/1 point sur 3/)).toBeTruthy();
  });

  it("stays quiet when every point is drawn", () => {
    render(<CardChart card={card({ kind: "line", data: { ...card().data, sampledEvery: 1 } })} />);
    expect(screen.queryByText(/1 point sur/)).toBeNull();
  });
});

describe("a curve that does not start at zero", () => {
  it("writes the floor on the chart", () => {
    const { container } = render(
      <CardChart
        card={card({
          kind: "line",
          data: {
            ...card().data,
            categoriesHidden: 0,
            points: [
              { label: "2020-01-01", value: 1900 },
              { label: "2020-01-02", value: 1990 },
            ],
          },
        })}
      />,
    );
    // Without this the shape of the curve implies a movement from nothing.
    expect(container.textContent).toMatch(/axe tronqué/);
  });
});

// ---------------------------------------------------------------------------
// The twin, a run, and a model

describe("a simulated trajectory", () => {
  const series = () =>
    card({
      kind: "series",
      sourceKind: "simulation",
      title: "Infectieux",
      data: {
        ...card().data,
        points: [
          { label: "J0", value: 4 },
          { label: "J1", value: 9 },
          { label: "J2", value: 14 },
        ],
        band: [
          { label: "J0", low: 2, high: 7 },
          { label: "J1", low: 5, high: 15 },
          { label: "J2", low: 8, high: 22 },
        ],
        categoriesHidden: 0,
        rowsSkipped: 0,
        note: "Médiane des exécutions, avec l'intervalle p5 à p95.",
      },
    });

  it("draws the spread, not only the median", () => {
    // Ten stochastic runs shown as one line is a claim the engine never makes.
    const { container } = render(<CardChart card={series()} />);
    const filled = Array.from(container.querySelectorAll("path")).filter(
      (p) => p.getAttribute("fill") && p.getAttribute("fill") !== "none",
    );
    expect(filled.length).toBe(1);
    expect(filled[0]!.getAttribute("d")!.endsWith("Z")).toBe(true);
  });

  it("prints the sentence the reader sent with it", () => {
    render(<CardChart card={series()} />);
    expect(screen.getByText(/intervalle p5 à p95/)).toBeTruthy();
  });
});

describe("a prediction against what happened", () => {
  const compare = (over: Partial<ReturnType<typeof card>["data"]> = {}) =>
    card({
      kind: "compare",
      sourceKind: "model",
      title: "Prévu contre réel",
      data: {
        ...card().data,
        points: [],
        categoriesHidden: 0,
        rowsSkipped: 0,
        real: [
          { label: "2026-03-01", value: 10 },
          { label: "2026-03-02", value: 12 },
        ],
        predicted: [
          { label: "2026-03-03", value: 14 },
          { label: "2026-03-04", value: 15 },
        ],
        overlap: 0,
        ...over,
      },
    });

  it("says plainly when the two curves never meet", () => {
    // Two lines on one axis invite a comparison. Where there is none to make,
    // the card has to say so rather than let the picture imply one.
    render(<CardChart card={compare()} />);
    expect(screen.getByText("aucun jour comparable")).toBeTruthy();
  });

  it("never joins the last observation to the first prediction", () => {
    // A single line across the gap claims readings on the days between.
    const { container } = render(<CardChart card={compare()} />);
    const strokes = Array.from(container.querySelectorAll("path")).filter(
      (p) => p.getAttribute("fill") === "none",
    );
    for (const p of strokes) {
      expect((p.getAttribute("d") ?? "").match(/M/g) ?? []).toHaveLength(1);
    }
  });

  it("names the worst day when the two do overlap", () => {
    render(
      <CardChart
        card={compare({
          predicted: [
            { label: "2026-03-01", value: 10 },
            { label: "2026-03-02", value: 40 },
          ],
          overlap: 2,
          meanGap: 15,
          worstGap: { label: "2026-03-02", predicted: 40, observed: 12 },
        })}
      />,
    );
    expect(screen.getByText(/pire jour/)).toBeTruthy();
    expect(screen.getByText(/2 jours comparables/)).toBeTruthy();
  });
});

describe("what a map card admits", () => {
  it("counts the sites it had no reading for", () => {
    // Drawn at the bottom of the ramp they read as empty hospitals; dropped,
    // the network looks smaller than it is.
    render(
      <CardChart
        card={card({
          kind: "map",
          sourceKind: "twin",
          data: { ...card().data, categoriesHidden: 0, rowsSkipped: 0, sitesUnread: 16 },
        })}
      />,
    );
    expect(screen.getByText(/16 sites sans lecture/)).toBeTruthy();
  });

  it("counts the sites it could not place at all", () => {
    render(
      <CardChart
        card={card({
          kind: "map",
          sourceKind: "twin",
          data: { ...card().data, categoriesHidden: 0, rowsSkipped: 0, sitesUnplaced: 3 },
        })}
      />,
    );
    expect(screen.getByText(/3 sans coordonnées/)).toBeTruthy();
  });
});
