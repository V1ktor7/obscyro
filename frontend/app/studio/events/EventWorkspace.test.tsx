// @vitest-environment jsdom

/**
 * The workbench's one irreplaceable gesture: pick a property off your own
 * ontology, and an effect on it exists. Everything else on the screen is an
 * edit to something that gesture created.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SimExport, SimObjectType, SimTarget } from "@/lib/platform-api";
import EventWorkspace from "./EventWorkspace";

afterEach(cleanup);

const p = (key: string, over: Partial<SimObjectType["properties"][number]> = {}) => ({
  key,
  type: "number" as const,
  label: null,
  unit: null,
  min: null,
  max: null,
  behaviour: null,
  mechanic: null,
  ...over,
});

const TARGETS: SimTarget[] = [
  {
    path: "object.property",
    label: "A property of the objects themselves",
    help: "",
    selector: ["object_type", "facility"],
    ops: ["set", "multiply", "add"],
    compose: "baseline",
    minimum: null,
    maximum: null,
    unit: "",
  },
];

function snapshot(): SimExport {
  return {
    environment: "prod",
    scenario_id: null,
    generated_at: "2026-08-18T00:00:00Z",
    facilities: [],
    objects: [
      { id: "l1", type: "Lit", role: "space", properties: {}, at: "u" },
      { id: "l2", type: "Lit", role: "space", properties: {}, at: "u" },
    ],
    object_types: [
      {
        name: "Lit",
        role: "space",
        properties: [
          p("charge", { behaviour: "level", unit: "%" }),
          p("statut", { type: "string", behaviour: "state" }),
          p("inconnu"),
        ],
      },
      { name: "Drone", role: null, properties: [p("autonomie", { behaviour: "level" })] },
    ],
    object_rules: { unavailable_keys: [], unavailable_values: [] },
    populations: [],
    edges: [],
    gaps: [],
  };
}

function workbench(over: Partial<React.ComponentProps<typeof EventWorkspace>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <EventWorkspace
      snapshot={snapshot()}
      targets={TARGETS}
      initial={null}
      twinScenarioId={null}
      onSave={onSave}
      onDelete={null}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return { onSave };
}

describe("the ontology rail", () => {
  it("announces each type with how many instances an effect would reach", () => {
    workbench();
    expect(screen.getByRole("button", { name: "Lit, 2 instances" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drone, 0 instances" })).toBeTruthy();
  });

  it("says on the button itself when a property can only be replaced", () => {
    // Picking a property, filling the inspector and only then learning it
    // cannot be multiplied is three steps of work thrown away.
    workbench();
    expect(
      screen.getByRole("button", { name: /Affect statut on Lit — text — set only/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Affect inconnu on Lit — no behaviour declared/ }),
    ).toBeTruthy();
  });

  it("offers nothing on a type no instance exists for", () => {
    workbench();
    // Collapsed by default — an unreachable type should not compete for the
    // rail's vertical space with the ones an effect can actually land on.
    expect(screen.queryByRole("button", { name: /Affect autonomie/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Drone, 0 instances" }));
    expect(screen.getByText(/would reach nothing/)).toBeTruthy();
    // Still nothing to click: the explanation replaces the properties rather
    // than sitting above them.
    expect(screen.queryByRole("button", { name: /Affect autonomie/ })).toBeNull();
  });
});

describe("picking a property", () => {
  it("creates an effect on it", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: "Affect charge on Lit" }));
    expect(screen.getByLabelText("Effect name")).toBeTruthy();
    expect((screen.getByLabelText("Property to change") as HTMLSelectElement).value).toBe("charge");
  });

  it("starts it on the only operation the declaration permits", () => {
    // Not a preset value: `charge` declares a behaviour, so arithmetic is legal
    // and `multiply` is the one that composes. On a state it would be `set`,
    // because that is the only legal option and a dropdown whose other entries
    // are all refused would be worse.
    workbench();
    fireEvent.click(screen.getByRole("button", { name: "Affect charge on Lit" }));
    expect((screen.getByLabelText("Operation") as HTMLSelectElement).value).toBe("multiply");

    cleanup();
    workbench();
    fireEvent.click(screen.getByRole("button", { name: /Affect statut on Lit/ }));
    expect((screen.getByLabelText("Operation") as HTMLSelectElement).value).toBe("set");
  });

  it("narrows the effect to the type it was picked from", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: "Affect charge on Lit" }));
    // The inspector only offers properties the selected types declare, so a
    // `Drone` property appearing here would mean the selection did not stick.
    const property = screen.getByLabelText("Property to change") as HTMLSelectElement;
    expect(Array.from(property.options).map((o) => o.value)).toEqual([
      "",
      "charge",
      "inconnu",
      "statut",
    ]);
  });

  it("selects the new effect rather than leaving the inspector on the old one", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: "Affect charge on Lit" }));
    fireEvent.click(screen.getByRole("button", { name: /Affect statut on Lit/ }));
    expect((screen.getByLabelText("Property to change") as HTMLSelectElement).value).toBe("statut");
  });

  it("offers a state only the operation it can honour", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: /Affect statut on Lit/ }));
    const op = screen.getByLabelText("Operation") as HTMLSelectElement;
    expect(Array.from(op.options).map((o) => o.value)).toEqual(["set"]);
  });
});

describe("an effect written against a retired quantity", () => {
  // `care.stay_ticks` and its two siblings were the last quantities the engine
  // invented. Events saved against them still load, and what happens next
  // decides whether somebody runs one and believes it.
  const stale = {
    id: "e1",
    name: "Vieille épidémie",
    description: "",
    horizon: 60,
    twinScenarioId: null,
    effects: [
      {
        id: "ca-traine",
        target: "care.stay_ticks",
        select: { acuity: ["critical"] },
        op: "add" as const,
        value: 2,
        property_key: null,
        reach: null,
        profile: { start: 0, end: 20, shape: "step" as const, peak: 1 },
      },
    ],
  };

  it("says so in the inspector instead of showing an empty form", () => {
    workbench({ initial: stale as never });
    expect(screen.getByText(/no longer offers/)).toBeTruthy();
    // The ordinary controls would offer an empty operation list and a value
    // field writing into nothing, which reads as merely broken.
    expect(screen.queryByLabelText("Operation")).toBeNull();
  });

  it("points at where the replacement lives", () => {
    workbench({ initial: stale as never });
    expect(screen.getByText(/declared in your ontology now/)).toBeTruthy();
  });

  it("names it in the validation bar and blocks the save", () => {
    workbench({ initial: stale as never });
    expect(screen.getByText(/does not have/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers to remove it, which is the only fix that is not a guess", () => {
    workbench({ initial: stale as never });
    fireEvent.click(screen.getByRole("button", { name: "Remove this effect" }));
    expect(screen.queryByText(/no longer offers/)).toBeNull();
  });
});

describe("the validation bar", () => {
  it("is on screen from the first render, so it is never a surprise", () => {
    // And an empty event is already a problem: an event with no effects is
    // indistinguishable from a normal day, which is the quietest wrong answer
    // this tool can give.
    workbench();
    expect(screen.getByText(/indistinguishable from a normal day/)).toBeTruthy();
  });

  it("goes quiet once the event says something", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: "Affect charge on Lit" }));
    expect(screen.getByText(/1 effect · nothing inert/)).toBeTruthy();
  });

  it("reports an effect the engine would refuse", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: /Affect inconnu on Lit/ }));
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "multiply" } });
    expect(screen.getByText(/no declared behaviour/)).toBeTruthy();
  });

  it("blocks the save while a problem stands", () => {
    workbench();
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Inondation" } });
    fireEvent.click(screen.getByRole("button", { name: /Affect inconnu on Lit/ }));
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "multiply" } });
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("saves once the event is named and nothing is wrong", async () => {
    const { onSave } = workbench();
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Inondation" } });
    fireEvent.click(screen.getByRole("button", { name: "Affect charge on Lit" }));
    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0]![0].effects[0].property_key).toBe("charge");
  });

  it("refuses to save an unnamed event", () => {
    workbench();
    fireEvent.click(screen.getByRole("button", { name: "Affect charge on Lit" }));
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
