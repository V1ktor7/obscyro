// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyst = vi.hoisted(() => ({ askAnalyst: vi.fn() }));
vi.mock("./analyst-api", async (orig) => ({ ...(await orig<typeof import("./analyst-api")>()), ...analyst }));

const where = vi.hoisted(() => ({ path: "/studio/live" }));
vi.mock("next/navigation", () => ({ usePathname: () => where.path }));

import { AnalystDock, AnalystFocusProvider, pageOf, useAnalystFocus, useOpenAnalyst, type PageFocus } from "./AnalystDock";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  where.path = "/studio/live";
  analyst.askAnalyst.mockResolvedValue(undefined);
});

/** A page that has something selected. */
function Page({ focus }: { focus: PageFocus }) {
  useAnalystFocus(focus);
  return null;
}

const shell = (focus: PageFocus = {}, env: string | null = "mtl") => (
  <AnalystFocusProvider>
    <Page focus={focus} />
    <AnalystDock env={env} />
  </AnalystFocusProvider>
);

describe("the analyst in the shell", () => {
  it("is one click away, and asks with the page and what is selected on it", async () => {
    render(shell({ unitId: "11111111-1111-4111-8111-111111111111" }));

    // Closed until asked for: nothing is built, nothing is fetched.
    expect(screen.queryByRole("dialog", { name: "Analyst" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Analyst" }));
    const panel = screen.getByRole("dialog", { name: "Analyst" });
    expect(within(panel).getByText(/Asked from this page, with the unit you selected/)).toBeTruthy();

    // A question about the selected unit is offered, beside the one about the whole project.
    fireEvent.click(within(panel).getByRole("button", { name: "What do this unit's live figures show, and how old are they?" }));
    await waitFor(() => expect(analyst.askAnalyst).toHaveBeenCalledTimes(1));
    expect(analyst.askAnalyst.mock.calls[0]![0]).toBe("mtl");
    expect(analyst.askAnalyst.mock.calls[0]![1]).toEqual({
      question: "What do this unit's live figures show, and how old are they?",
      scenarioId: null,
      looking: "reality",
      run: null,
      focus: { page: "live", unitId: "11111111-1111-4111-8111-111111111111" },
    });
  });

  it("offers only the project's question when nothing is selected", () => {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Analyst" }));
    const panel = screen.getByRole("dialog", { name: "Analyst" });
    expect(within(panel).getByRole("button", { name: "What is open right now, and where?" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /this unit/ })).toBeNull();
    expect(within(panel).getByText(/Asked from this page\. It reads the network as it stands now\./)).toBeTruthy();
  });

  it("keeps what was asked when it is closed and opened again", async () => {
    render(shell());
    const toggle = screen.getByRole("button", { name: "Analyst" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "What is open right now, and where?" }));
    await waitFor(() => expect(analyst.askAnalyst).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Close the analyst" }));
    expect(screen.queryByRole("dialog", { name: "Analyst" })).toBeNull();
    fireEvent.click(toggle);
    // The question asked is still on the panel: reopening did not start it over.
    expect(within(screen.getByRole("dialog", { name: "Analyst" })).getAllByText("What is open right now, and where?").length).toBeGreaterThan(0);
    expect(analyst.askAnalyst).toHaveBeenCalledTimes(1);
  });

  it("stays out of the pages that hold the analyst themselves, and of a Studio with no project", () => {
    where.path = "/studio/simulation";
    const a = render(shell());
    expect(screen.queryByRole("button", { name: "Analyst" })).toBeNull();
    a.unmount();

    where.path = "/studio/situation";
    const b = render(shell());
    expect(screen.queryByRole("button", { name: "Analyst" })).toBeNull();
    b.unmount();

    // The network map has its own Analyst panel, under the inspector.
    where.path = "/studio/command";
    const c = render(shell());
    expect(screen.queryByRole("button", { name: "Analyst" })).toBeNull();
    c.unmount();

    where.path = "/studio/response";
    render(shell({}, null));
    expect(screen.queryByRole("button", { name: "Analyst" })).toBeNull();
  });

  it("opens when a page asks for it, with what that page has selected", () => {
    function Sheet() {
      useAnalystFocus({ unitId: "11111111-1111-4111-8111-111111111111" });
      const ask = useOpenAnalyst();
      return ask ? (
        <button type="button" onClick={ask}>
          Ask the analyst
        </button>
      ) : null;
    }
    render(
      <AnalystFocusProvider>
        <Sheet />
        <AnalystDock env="mtl" />
      </AnalystFocusProvider>,
    );

    expect(screen.queryByRole("dialog", { name: "Analyst" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask the analyst" }));
    const panel = screen.getByRole("dialog", { name: "Analyst" });
    expect(within(panel).getByText(/Asked from this page, with the unit you selected/)).toBeTruthy();

    // Closed, then asked for again: it opens again.
    fireEvent.click(screen.getByRole("button", { name: "Close the analyst" }));
    expect(screen.queryByRole("dialog", { name: "Analyst" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ask the analyst" }));
    expect(screen.getByRole("dialog", { name: "Analyst" })).toBeTruthy();
  });

  it("gives a page nothing to open outside the shell", () => {
    function Sheet() {
      return <p>{useOpenAnalyst() ? "can ask" : "no analyst here"}</p>;
    }
    render(<Sheet />);
    expect(screen.getByText("no analyst here")).toBeTruthy();
  });

  it("names a page by its address", () => {
    expect(pageOf("/studio/live")).toBe("live");
    expect(pageOf("/studio/response/extra")).toBe("response");
    expect(pageOf("/studio")).toBe("");
  });
});
