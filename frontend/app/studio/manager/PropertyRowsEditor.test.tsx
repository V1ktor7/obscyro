// @vitest-environment jsdom

/**
 * A schema declaration is now the thing that decides whether an event can act
 * on a property at all, so the editor has to be right about more than layout:
 * what it writes into the row, what it clears when the type changes, and what
 * it refuses to let pass silently.
 *
 * These are the interactions, not the render.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PropertyDefinition } from "@/lib/property-schema";
import { PropertyRowsEditor } from "./ManagerView";

afterEach(cleanup);

/** Render, and hand back the rows as they stand after the last change. */
function editor(rows: PropertyDefinition[]) {
  const onChange = vi.fn();
  render(<PropertyRowsEditor rows={rows} onChange={onChange} />);
  return {
    onChange,
    last: () => onChange.mock.calls.at(-1)?.[0] as PropertyDefinition[] | undefined,
  };
}

function expand(key: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Show what ${key} means`) }));
}

describe("the collapsed row", () => {
  it("says a number has no behaviour, rather than looking settled", () => {
    // This is the state every property in the ontology is in today, and it is
    // the state that stops an effect from existing. Silence would read as fine.
    editor([{ key: "lits", type: "number" }]);
    expect(screen.getByText("no behaviour")).toBeTruthy();
  });

  it("summarises a declared quantity without expanding anything", () => {
    editor([
      { key: "lits", type: "number", behaviour: "level", unit: "lits", bounds: { min: 0, max: null } },
    ]);
    expect(screen.getByText("level · lits · ≥ 0")).toBeTruthy();
  });

  it("stays quiet about a string, whose state was never a choice", () => {
    editor([{ key: "statut", type: "string" }]);
    expect(screen.queryByText("no behaviour")).toBeNull();
  });
});

describe("declaring a behaviour", () => {
  it("offers all four on a number and only state on a string", () => {
    const { unmount } = render(
      <PropertyRowsEditor rows={[{ key: "lits", type: "number" }]} onChange={vi.fn()} />,
    );
    expand("lits");
    const numeric = screen.getByLabelText("Behaviour of lits") as HTMLSelectElement;
    expect(Array.from(numeric.options).map((o) => o.value)).toEqual([
      "",
      "level",
      "rate",
      "stock",
      "state",
    ]);
    unmount();

    render(<PropertyRowsEditor rows={[{ key: "statut", type: "string" }]} onChange={vi.fn()} />);
    expand("statut");
    const text = screen.getByLabelText("Behaviour of statut") as HTMLSelectElement;
    expect(Array.from(text.options).map((o) => o.value)).toEqual(["", "state"]);
  });

  it("writes the choice into the row", () => {
    const { last } = editor([{ key: "attente", type: "number" }]);
    expand("attente");
    fireEvent.change(screen.getByLabelText("Behaviour of attente"), { target: { value: "stock" } });
    expect(last()?.[0]?.behaviour).toBe("stock");
  });

  it("explains the choice as a consequence, not a definition", () => {
    editor([{ key: "attente", type: "number", behaviour: "stock" }]);
    expand("attente");
    expect(screen.getByText(/no prior value at this address to halve/)).toBeTruthy();
  });

  it("clears the declaration when the author takes it back", () => {
    const { last } = editor([{ key: "lits", type: "number", behaviour: "level" }]);
    expand("lits");
    fireEvent.change(screen.getByLabelText("Behaviour of lits"), { target: { value: "" } });
    expect(last()?.[0]?.behaviour).toBeUndefined();
  });
});

describe("bounds", () => {
  it("treats an empty field as no bound, not as zero", () => {
    // Parsing "" as 0 would floor every value at zero and look like a decision
    // somebody made.
    const { last } = editor([{ key: "lits", type: "number", bounds: { min: 0, max: 10 } }]);
    expand("lits");
    fireEvent.change(screen.getByLabelText("Minimum of lits"), { target: { value: "" } });
    expect(last()?.[0]?.bounds).toEqual({ min: null, max: 10 });
  });

  it("drops the bounds object entirely once both ends are gone", () => {
    const { last } = editor([{ key: "lits", type: "number", bounds: { min: 3, max: null } }]);
    expand("lits");
    fireEvent.change(screen.getByLabelText("Minimum of lits"), { target: { value: "" } });
    expect(last()?.[0]?.bounds).toBeNull();
  });

  it("ignores a keystroke that is not a number rather than writing NaN", () => {
    const { onChange } = editor([{ key: "lits", type: "number" }]);
    expand("lits");
    fireEvent.change(screen.getByLabelText("Maximum of lits"), { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers no unit or bounds on a type that cannot carry them", () => {
    editor([{ key: "statut", type: "string" }]);
    expand("statut");
    expect(screen.queryByLabelText("Unit of statut")).toBeNull();
    expect(screen.queryByLabelText("Minimum of statut")).toBeNull();
  });
});

describe("binding a mechanic", () => {
  it("offers a number only the mechanics that take a quantity", () => {
    // Offering `serves_severity` here would produce a care model keyed by "3",
    // which runs and matches nothing.
    editor([{ key: "duree", type: "number", behaviour: "level" }]);
    expand("duree");
    const select = screen.getByLabelText("What duree feeds the engine") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "",
      "occupies_for",
      "dies_without",
      "consumes_amount",
    ]);
  });

  it("offers text only the mechanics the engine matches on", () => {
    editor([{ key: "gravite", type: "string" }]);
    expand("gravite");
    const select = screen.getByLabelText("What gravite feeds the engine") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "",
      "serves_severity",
      "consumes_activity",
    ]);
  });

  it("defaults to feeding nothing, because most properties are just data", () => {
    editor([{ key: "duree", type: "number" }]);
    expand("duree");
    expect((screen.getByLabelText("What duree feeds the engine") as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("writes the binding into the row", () => {
    const { last } = editor([{ key: "duree", type: "number", behaviour: "level" }]);
    expand("duree");
    fireEvent.change(screen.getByLabelText("What duree feeds the engine"), {
      target: { value: "occupies_for" },
    });
    expect(last()?.[0]?.mechanic).toBe("occupies_for");
  });

  it("names the same mechanic bound twice", () => {
    editor([
      { key: "duree", type: "number", behaviour: "level", mechanic: "occupies_for" },
      { key: "sejour", type: "number", behaviour: "level", mechanic: "occupies_for" },
    ]);
    expect(screen.getByRole("alert").textContent).toMatch(/already bound to occupies_for/);
  });
});

describe("changing the type", () => {
  it("clears what the new type cannot carry", () => {
    // Otherwise the unit stays behind and only surfaces as a refused save, with
    // the field that caused it now hidden.
    const { last } = editor([
      { key: "lits", type: "number", behaviour: "level", unit: "lits", bounds: { min: 0, max: 9 } },
    ]);
    fireEvent.change(screen.getByLabelText("Property 1 type"), { target: { value: "string" } });
    const row = last()?.[0];
    expect(row?.unit).toBeUndefined();
    expect(row?.bounds).toBeUndefined();
    expect(row?.behaviour).toBeUndefined();
  });
});

describe("problems", () => {
  it("names a duplicate key, which no single row can see", () => {
    editor([
      { key: "statut", type: "string" },
      { key: "statut", type: "string" },
    ]);
    expect(screen.getByRole("alert").textContent).toMatch(/declared twice/);
  });

  it("reports a contradiction inline, beside the row that carries it", () => {
    editor([
      { key: "lits", type: "number" },
      { key: "statut", type: "string", unit: "kg" },
    ]);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toMatch(/unit measures/);
  });

  it("stays quiet on a schema with nothing wrong with it", () => {
    editor([{ key: "lits", type: "number", behaviour: "level" }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("adding and removing", () => {
  it("opens the new row, because a blank row has nothing to read", () => {
    const rows: PropertyDefinition[] = [{ key: "lits", type: "number" }];
    const onChange = vi.fn();
    const { rerender } = render(<PropertyRowsEditor rows={rows} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Property" }));
    rerender(<PropertyRowsEditor rows={onChange.mock.calls[0]![0]} onChange={onChange} />);
    expect(screen.getByLabelText("Behaviour of this property")).toBeTruthy();
  });

  it("removes the row it was asked to remove", () => {
    const { last } = editor([
      { key: "lits", type: "number" },
      { key: "statut", type: "string" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove lits" }));
    expect(last()?.map((r) => r.key)).toEqual(["statut"]);
  });
});
