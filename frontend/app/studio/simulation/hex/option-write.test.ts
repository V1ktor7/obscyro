import { describe, expect, it } from "vitest";

import type { ProposedOption, RetiredChoice } from "../../analyst-api";

import { takesOut, writeOption, type OptionWriter } from "./option-write";
import type { Stamp } from "./stamps";

/** A recipe that keeps what was done to it, in order. */
function recipe(held: string[]) {
  const done: string[] = [];
  const ids = [...held];
  let next = 0;
  const writer: OptionWriter = {
    held: async () => {
      done.push("read");
      return [...ids];
    },
    add: async (stamp, note) => {
      const s = stamp as Stamp & { kind: "capacity" };
      done.push(`add ${s.amount > 0 ? "+" : ""}${s.amount} from day ${s.start} (${note})`);
      ids.push(`new-${++next}`);
    },
    remove: async (id) => {
      if (!ids.includes(id)) throw new Error(`no stamp ${id}`);
      done.push(`remove ${id}`);
      ids.splice(ids.indexOf(id), 1);
    },
    title: (stamp) => `${(stamp as Stamp & { kind: "capacity" }).amount} beds`,
  };
  return { writer, done, ids };
}

const beds = (amount: number, start: number) => ({ body: { kind: "capacity", facility: "f:lake", activity: "lit", amount }, start, days: 60 - start });
const sixty: RetiredChoice = { id: "st-60", stamp: beds(60, 10), text: "+60 lit at Lakeshore from day 10", replacedBy: 0 };

const option = (over: Partial<ProposedOption>): ProposedOption =>
  ({
    step: "s2",
    label: "40 beds at Lakeshore instead of 60",
    stamps: [beds(40, 10)],
    figures: {},
    sites: [],
    basis: [],
    arrivals: {},
    notes: [],
    mechanism: "",
    notTested: [],
    ...over,
  }) as unknown as ProposedOption;

describe("a tested option written into the scenario", () => {
  it("only adds when the option only adds, without reading the recipe first", async () => {
    const r = recipe(["st-60"]);
    await writeOption(option({ label: "6 more beds", stamps: [beds(6, 5)] }), r.writer);
    expect(r.done).toEqual(["add +6 from day 5 (6 beds · from the tested option “6 more beds”)"]);
    expect(r.ids).toEqual(["st-60", "new-1"]);
  });

  it("replaces a choice with one stamp: the new one written, then the old one out", async () => {
    const r = recipe(["st-seed", "st-60"]);
    await writeOption(option({ retires: [sixty] }), r.writer);
    expect(r.done).toEqual(["read", "add +40 from day 10 (40 beds · from the tested option “40 beds at Lakeshore instead of 60”)", "remove st-60"]);
    // One stamp for the beds, where stacking a correction would have left two.
    expect(r.ids).toEqual(["st-seed", "new-1"]);
  });

  it("removes a choice the option takes out without replacing it", async () => {
    const r = recipe(["st-60", "st-school"]);
    const school: RetiredChoice = { id: "st-school", stamp: { body: { kind: "measure" }, start: 8, days: 10 }, text: "Schools closed in Centre, days 8 to 17", replacedBy: null };
    await writeOption(option({ label: "Without the school closure", stamps: [], retires: [school] }), r.writer);
    expect(r.done).toEqual(["read", "remove st-school"]);
    expect(r.ids).toEqual(["st-60"]);
  });

  it("does all three in one option, each old stamp leaving after what replaces it", async () => {
    const r = recipe(["st-60", "st-school"]);
    await writeOption(
      option({
        label: "Mixed",
        // An addition, then the stamp that takes the place of the sixty beds.
        stamps: [beds(6, 5), beds(40, 17)],
        retires: [
          { ...sixty, replacedBy: 1 },
          { id: "st-school", stamp: { body: { kind: "measure" }, start: 8, days: 10 }, text: "Schools closed", replacedBy: null },
        ],
      }),
      r.writer,
    );
    expect(r.done.map((d) => d.replace(/ \(.*$/, ""))).toEqual(["read", "add +6 from day 5", "add +40 from day 17", "remove st-60", "remove st-school"]);
    expect(r.ids).toEqual(["new-1", "new-2"]);
  });

  it("writes nothing when a stamp it takes out is no longer in the scenario, and says which", async () => {
    // Somebody edited the sixty beds after the test: the stamp has another id now.
    const r = recipe(["st-seed", "st-60-edited"]);
    await expect(writeOption(option({ retires: [sixty] }), r.writer)).rejects.toThrow(
      "the scenario no longer holds “+60 lit at Lakeshore from day 10”, which this option replaces. Nothing was written. State the objective again to test against the scenario as it is now.",
    );
    expect(r.done).toEqual(["read"]);
    expect(r.ids).toEqual(["st-seed", "st-60-edited"]);

    // The same for a removal, in its own word.
    const gone = recipe([]);
    await expect(writeOption(option({ stamps: [], retires: [{ ...sixty, replacedBy: null }] }), gone.writer)).rejects.toThrow(/which this option removes\. Nothing was written/);
    expect(gone.done).toEqual(["read"]);
  });

  it("knows an option that takes something out from one that only adds", () => {
    expect(takesOut(option({}))).toBe(false);
    expect(takesOut(option({ retires: [] }))).toBe(false);
    expect(takesOut(option({ retires: [sixty] }))).toBe(true);
  });
});
