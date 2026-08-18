// @vitest-environment jsdom

/**
 * Deleting a project is the one action in the product with no undo and nothing
 * exported behind it. These pin the guards: what it says goes, and what it
 * takes to make it go.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeleteProjectDialog } from "./HomeView";

afterEach(cleanup);

const PROJECT = {
  id: "p1",
  slug: "chum-operations",
  name: "chum_operations",
  kind: "operations",
  objectTypeCount: 3,
  instanceCount: 200,
  datasetCount: 1,
  liveChannelCount: 0,
  lastActivityAt: null,
};

const CONTENTS = {
  name: "chum_operations",
  slug: "chum-operations",
  objectTypes: 3,
  instances: 4102,
  links: 87,
  datasets: 1,
  scenarios: 2,
  events: 0,
};

function dialog(
  contents: typeof CONTENTS | null = CONTENTS,
  busy = false,
  countsError: string | null = null,
) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DeleteProjectDialog
      project={PROJECT}
      contents={contents}
      countsError={countsError}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe("what it says", () => {
  it("names the counts rather than asking whether you are sure", () => {
    // "Are you sure?" is answered yes by reflex. Four thousand instances is
    // read.
    dialog();
    expect(screen.getByText("4,102")).toBeTruthy();
    expect(screen.getByText("87")).toBeTruthy();
  });

  it("names what the project card does not — links, scenarios, saved events", () => {
    dialog();
    expect(screen.getByText(/links/)).toBeTruthy();
    expect(screen.getByText(/scenarios/)).toBeTruthy();
  });

  it("leaves out what the project does not hold", () => {
    // A row saying "0 saved events" is noise that pushes the real numbers off
    // the first glance.
    dialog();
    expect(screen.queryByText(/saved event/)).toBeNull();
  });

  it("says plainly that an empty project loses nothing", () => {
    dialog({ ...CONTENTS, objectTypes: 0, instances: 0, links: 0, datasets: 0, scenarios: 0, events: 0 });
    expect(screen.getByText(/This project is empty/)).toBeTruthy();
  });

  it("says there is no undo, because there is not", () => {
    dialog();
    expect(screen.getByText(/no undo/)).toBeTruthy();
  });
});

describe("when the counts could not be read", () => {
  // The counts are a courtesy; the delete is the function. Making the delete
  // unavailable because a *count* failed is what turned the trash icon into a
  // button that did nothing and explained nothing.
  it("still offers the delete", () => {
    const { onConfirm } = dialog(null, false, "Could not count (HTTP 404: Not Found).");
    fireEvent.change(screen.getByLabelText("Type the project name to confirm"), {
      target: { value: "chum_operations" },
    });
    const button = screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("says why, with the status, rather than staying silent", () => {
    dialog(null, false, "Could not count (HTTP 404: Not Found).");
    expect(screen.getByText(/HTTP 404/)).toBeTruthy();
  });

  it("does not claim the project is empty when it simply could not look", () => {
    // The dangerous confusion: "nothing is lost" next to a project holding
    // four thousand instances.
    dialog(null, false, "boom");
    expect(screen.queryByText(/This project is empty/)).toBeNull();
  });
});

describe("what it takes", () => {
  it("refuses until the name is typed exactly", () => {
    const { onConfirm } = dialog();
    const button = screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Type the project name to confirm"), {
      target: { value: "chum" },
    });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Type the project name to confirm"), {
      target: { value: "chum_operations" },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("cancels on Escape, so the way out is not only a button", () => {
    const { onCancel } = dialog();
    fireEvent.keyDown(screen.getByLabelText("Type the project name to confirm"), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not fire on Enter until the name matches", () => {
    const { onConfirm } = dialog();
    const input = screen.getByLabelText("Type the project name to confirm");
    fireEvent.change(input, { target: { value: "chum" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "chum_operations" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalled();
  });

  it("cannot be fired twice while the first delete is in flight", () => {
    dialog(CONTENTS, true);
    fireEvent.change(screen.getByLabelText("Type the project name to confirm"), {
      target: { value: "chum_operations" },
    });
    expect((screen.getByRole("button", { name: "Deleting…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
