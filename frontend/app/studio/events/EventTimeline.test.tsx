// @vitest-environment jsdom

/**
 * These exist because a build proves a component compiles, not that dragging a
 * bar writes the field it claims to. Everything below is the interaction, not
 * the render: what the user does, and what the event ends up saying.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SimEffect, SimTarget, TemporalProfile } from "@/lib/platform-api";
import EventTimeline from "./EventTimeline";

afterEach(cleanup);

const CAPACITY: SimTarget = {
  path: "resource.capacity",
  label: "Capacity of a resource",
  help: "",
  selector: ["facility"],
  ops: ["multiply", "set", "add"],
  compose: "baseline",
  minimum: 0,
  maximum: null,
  unit: "units",
};

const STAY: SimTarget = {
  path: "care.stay_ticks",
  label: "Length of stay",
  help: "",
  selector: ["acuity"],
  ops: ["add"],
  compose: "baseline",
  minimum: 1,
  maximum: null,
  unit: "steps",
};

function effect(over: Partial<SimEffect> = {}): SimEffect {
  return {
    id: "flood",
    target: CAPACITY.path,
    select: {},
    op: "set",
    value: 0,
    profile: { start: 10, end: 20, shape: "step", peak: 1 },
    ...over,
  };
}

/**
 * jsdom gives every element a zero-size rect, so a drag computed from
 * `getBoundingClientRect` would always resolve to step 0 and every test would
 * pass while proving nothing.
 */
function withTrackWidth(width: number) {
  const spy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ left: 0, width, top: 0, height: 32, right: width, bottom: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  return () => spy.mockRestore();
}

function renderTimeline(effects: SimEffect[], horizon = 60) {
  const onChangeProfile = vi.fn();
  const onFocus = vi.fn();
  render(
    <EventTimeline
      effects={effects}
      targets={[CAPACITY, STAY]}
      horizon={horizon}
      focused={null}
      onFocus={onFocus}
      onChangeProfile={onChangeProfile}
    />,
  );
  return { onChangeProfile, onFocus };
}

function lastProfile(fn: ReturnType<typeof vi.fn>): TemporalProfile {
  return fn.mock.calls[fn.mock.calls.length - 1]![1] as TemporalProfile;
}

describe("dragging", () => {
  it("writes the start when the left handle is dragged", () => {
    const restore = withTrackWidth(600);
    const { onChangeProfile } = renderTimeline([effect()]);

    fireEvent.pointerDown(screen.getAllByTestId("handle-left")[0]!);
    fireEvent.pointerMove(window, { clientX: 50 });
    fireEvent.pointerUp(window);

    // 50 of 600 across a horizon of 60 is step 5.
    expect(lastProfile(onChangeProfile).start).toBe(5);
    expect(lastProfile(onChangeProfile).end).toBe(20);
    restore();
  });

  it("writes the end when the right handle is dragged", () => {
    const restore = withTrackWidth(600);
    const { onChangeProfile } = renderTimeline([effect()]);

    fireEvent.pointerDown(screen.getAllByTestId("handle-right")[0]!);
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);

    expect(lastProfile(onChangeProfile).end).toBe(40);
    expect(lastProfile(onChangeProfile).start).toBe(10);
    restore();
  });

  it("keeps following the pointer after it leaves the bar", () => {
    // The classic timeline bug: tracking stops at the element boundary, the bar
    // sticks where the cursor exited, and the value written is not the one the
    // user released on.
    const restore = withTrackWidth(600);
    const { onChangeProfile } = renderTimeline([effect()]);

    fireEvent.pointerDown(screen.getByTestId("bar-0"));
    fireEvent.pointerMove(window, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 450 });
    fireEvent.pointerUp(window);

    expect(lastProfile(onChangeProfile).start).toBe(45);
    restore();
  });

  it("stops writing once the pointer is released", () => {
    const restore = withTrackWidth(600);
    const { onChangeProfile } = renderTimeline([effect()]);

    fireEvent.pointerDown(screen.getByTestId("bar-0"));
    fireEvent.pointerMove(window, { clientX: 100 });
    fireEvent.pointerUp(window);
    const after = onChangeProfile.mock.calls.length;
    fireEvent.pointerMove(window, { clientX: 500 });

    expect(onChangeProfile.mock.calls.length).toBe(after);
    restore();
  });
});

describe("keyboard", () => {
  it("moves a bar with the arrow keys", () => {
    const { onChangeProfile } = renderTimeline([effect()]);
    fireEvent.keyDown(screen.getByTestId("bar-0"), { key: "ArrowRight" });
    expect(lastProfile(onChangeProfile).start).toBe(11);
  });

  it("moves the end with Alt held", () => {
    const { onChangeProfile } = renderTimeline([effect()]);
    fireEvent.keyDown(screen.getByTestId("bar-0"), { key: "ArrowRight", altKey: true });
    expect(lastProfile(onChangeProfile).end).toBe(21);
    expect(lastProfile(onChangeProfile).start).toBe(10);
  });

  it("takes bigger steps with Shift", () => {
    const { onChangeProfile } = renderTimeline([effect()]);
    fireEvent.keyDown(screen.getByTestId("bar-0"), { key: "ArrowLeft", shiftKey: true });
    expect(lastProfile(onChangeProfile).start).toBe(5);
  });

  it("gives every bar a tab stop", () => {
    // Without this the timeline becomes the only way to reach an action, and
    // the feature stops existing for anyone not using a pointer.
    renderTimeline([effect({ id: "a" }), effect({ id: "b" })]);
    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(2);
    for (const bar of bars) expect(bar).toHaveProperty("tabIndex", 0);
  });
});

describe("what it says out loud", () => {
  it("describes an effect without needing the picture", () => {
    renderTimeline([effect()]);
    const label = screen.getByTestId("bar-0").getAttribute("aria-label")!;
    expect(label).toContain("Capacity of a resource");
    expect(label).toContain("from step 10 to step 20");
    expect(label).toContain("No overlap");
  });

  it("names the effects it overlaps rather than only hatching them", () => {
    // Hatching alone would put the composition rule behind a visual cue, and
    // the overlap is exactly what people ask about once bars are visible.
    renderTimeline([
      effect({ id: "flood" }),
      effect({ id: "staff-sickness", profile: { start: 15, end: 30, shape: "ramp", peak: 1 } }),
    ]);
    expect(screen.getByTestId("bar-0").getAttribute("aria-label")).toContain(
      "Overlaps with staff-sickness",
    );
  });

  it("does not call it an overlap when the quantities differ", () => {
    renderTimeline([
      effect({ id: "flood" }),
      effect({ id: "lingering", target: STAY.path, op: "add", value: 2 }),
    ]);
    expect(screen.getByTestId("bar-0").getAttribute("aria-label")).toContain("No overlap");
  });

  it("says an open-ended effect runs to the end of the run", () => {
    renderTimeline([effect({ profile: { start: 4, end: null, shape: "step", peak: 1 } })]);
    expect(screen.getByTestId("bar-0").getAttribute("aria-label")).toContain(
      "to the end of the run",
    );
  });
});
