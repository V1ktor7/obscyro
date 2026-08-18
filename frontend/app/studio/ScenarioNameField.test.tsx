// @vitest-environment jsdom

/**
 * This replaced a `window.prompt`, which is the whole point: a browser that
 * suppresses dialogs returns null from prompt without showing anything, so the
 * button appeared dead and explained nothing. These pin that the replacement is
 * reachable by keyboard and cannot submit nothing.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ScenarioNameField from "./ScenarioNameField";

afterEach(cleanup);

function field(props: Partial<React.ComponentProps<typeof ScenarioNameField>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(<ScenarioNameField onSubmit={onSubmit} onCancel={onCancel} {...props} />);
  return { onSubmit, onCancel, input: screen.getByLabelText("Scenario name") };
}

describe("ScenarioNameField", () => {
  it("is a real field on the page, not a dialog that can be suppressed", () => {
    const { input } = field();
    expect(input).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("submits what was typed", () => {
    const { onSubmit, input } = field();
    fireEvent.change(input, { target: { value: "Fermeture aile est" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith("Fermeture aile est");
  });

  it("submits on Enter, because a one-field form should not need the mouse", () => {
    const { onSubmit, input } = field();
    fireEvent.change(input, { target: { value: "Inondation" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Inondation");
  });

  it("cancels on Escape", () => {
    const { onCancel, input } = field();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("refuses to create a scenario with no name", () => {
    // A blank name produces a row in the picker that says nothing, and there is
    // no way to tell two of them apart afterwards.
    const { input } = field();
    fireEvent.change(input, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("starts from the existing name when renaming", () => {
    const { input } = field({ initial: "simulation de scenario", action: "Rename" });
    expect((input as HTMLInputElement).value).toBe("simulation de scenario");
    expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
  });

  it("does not let a second submit through while one is in flight", () => {
    const { input } = field({ busy: true, initial: "x" });
    expect(input).toBeTruthy();
    expect((screen.getByRole("button", { name: "…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
