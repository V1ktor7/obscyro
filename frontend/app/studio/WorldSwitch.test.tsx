// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import WorldSwitch, { worldHref } from "./WorldSwitch";

afterEach(cleanup);

describe("the Live or Scenario switch at the head of a map", () => {
  it("marks the world one is in, and links to the other on the same project", () => {
    render(<WorldSwitch world="live" env="montreal-donnees-ouvertes" />);
    const group = screen.getByRole("group", { name: "What the map shows" });
    expect(group.textContent).toBe("LiveScenario");
    expect(screen.getByText("Live").getAttribute("aria-current")).toBe("page");
    // The world one is in is not a link: clicking it would go nowhere.
    expect(screen.queryByRole("link", { name: "Live" })).toBeNull();
    expect(screen.getByRole("link", { name: "Scenario" }).getAttribute("href")).toBe("/studio/simulation?env=montreal-donnees-ouvertes");
  });

  it("is the same switch on the scenario map, the other way round", () => {
    render(<WorldSwitch world="scenario" env="mtl" />);
    expect(screen.getByText("Scenario").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Live" }).getAttribute("href")).toBe("/studio/command?env=mtl");
  });

  it("says on the Scenario side that a run is not a forecast", () => {
    render(<WorldSwitch world="live" env="mtl" />);
    expect(screen.getByRole("link", { name: "Scenario" }).getAttribute("title")).toMatch(/A run is not a forecast\./);
  });

  it("keeps to the page when no project is selected", () => {
    expect(worldHref("scenario", null)).toBe("/studio/simulation");
    expect(worldHref("live", "a b")).toBe("/studio/command?env=a%20b");
  });
});
