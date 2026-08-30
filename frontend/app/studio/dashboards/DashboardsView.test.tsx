// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The two destructive moments on this screen.
 *
 * Both used to be native dialogs. `window.prompt` and `window.confirm` cannot
 * be styled, cannot say what they are about to destroy, and are the one part of
 * a screen that cannot be shown to anybody — which for a tool whose whole claim
 * is "everything is reachable from the interface" is the wrong place to stop.
 */

const api = vi.hoisted(() => ({
  listDashboards: vi.fn(),
  readDashboard: vi.fn(),
  createDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  listChartable: vi.fn(),
  addCard: vi.fn(),
  deleteCard: vi.fn(),
  moveCard: vi.fn(),
}));

vi.mock("../dashboards-api", () => api);
vi.mock("../StudioShell", () => ({
  useStudio: () => ({ hasKey: true, selectedEnv: "montreal" }),
}));

import DashboardsView from "./DashboardsView";

const BOARD = {
  id: "11111111-1111-1111-1111-111111111111",
  projectId: "p",
  name: "Urgences",
  description: "",
  cardCount: 3,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

// Auto-cleanup only happens with `globals: true`, which this project does not
// set. Without it each render stacks on the last and every query finds two.
afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  api.listDashboards.mockResolvedValue({ dashboards: [] });
  api.readDashboard.mockResolvedValue({ dashboard: BOARD, cards: [] });
  api.listChartable.mockResolvedValue({ datasets: [] });
});

describe("naming a new dashboard", () => {
  it("asks in the page, not in a browser dialog", async () => {
    const prompt = vi.spyOn(window, "prompt");
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("Nouveau tableau de bord"));
    expect(await screen.findByLabelText("Nom du tableau de bord")).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("creates the board with what was typed", async () => {
    api.createDashboard.mockResolvedValue({ ...BOARD, name: "Capacité", cardCount: 0 });
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("Nouveau tableau de bord"));
    await user.type(await screen.findByLabelText("Nom du tableau de bord"), "Capacité");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    await waitFor(() =>
      expect(api.createDashboard).toHaveBeenCalledWith("montreal", { name: "Capacité" }),
    );
  });

  it("refuses to create one with a blank name", async () => {
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("Nouveau tableau de bord"));
    await user.type(await screen.findByLabelText("Nom du tableau de bord"), "   ");
    expect((screen.getByRole("button", { name: "Créer" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("closes the field on Escape without creating anything", async () => {
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByTitle("Nouveau tableau de bord"));
    await user.type(await screen.findByLabelText("Nom du tableau de bord"), "x{Escape}");

    await waitFor(() => expect(screen.queryByLabelText("Nom du tableau de bord")).toBeNull());
    expect(api.createDashboard).not.toHaveBeenCalled();
  });
});

describe("deleting a dashboard", () => {
  beforeEach(() => {
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
  });

  it("does not delete on the first click", async () => {
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByRole("button", { name: "Supprimer" }));
    expect(api.deleteDashboard).not.toHaveBeenCalled();
  });

  it("names what it is about to destroy", async () => {
    // A native confirm cannot do this, which is the whole reason it went.
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByRole("button", { name: "Supprimer" }));
    // The board's name also sits in the rail, so the assertion is on the
    // button: it is the button that has to say what it destroys.
    const confirm = await screen.findByRole("button", { name: /Supprimer «/ });
    expect(confirm.textContent).toMatch(/Urgences/);
    expect(confirm.textContent).toMatch(/3 cartes/);
  });

  it("deletes on the second click", async () => {
    api.deleteDashboard.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DashboardsView />);

    await user.click(await screen.findByRole("button", { name: "Supprimer" }));
    await user.click(await screen.findByRole("button", { name: /Supprimer «/ }));

    await waitFor(() => expect(api.deleteDashboard).toHaveBeenCalledWith(BOARD.id));
  });
});

describe("what the empty board says", () => {
  it("points at the picker rather than showing a blank page", async () => {
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
    render(<DashboardsView />);
    expect(await screen.findByText(/Ce tableau de bord est vide/)).toBeTruthy();
  });

  it("says the values are read now, not stored", async () => {
    // The claim the whole design rests on, made on the screen itself.
    api.listDashboards.mockResolvedValue({ dashboards: [BOARD] });
    render(<DashboardsView />);
    expect(await screen.findByText(/lues maintenant/)).toBeTruthy();
  });
});
