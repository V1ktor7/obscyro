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
