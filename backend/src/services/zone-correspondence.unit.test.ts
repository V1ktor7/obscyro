import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reallocate,
  weightsFromArea,
  weightsFromPopulation,
  type Overlap,
} from "./zone-correspondence.js";

/** One plant split evenly between two territories. */
const SPLIT: Overlap[] = [
  { source: "plant:jp", target: "rls:0643", weight: 0.5, basis: "population" },
  { source: "plant:jp", target: "rls:0653", weight: 0.5, basis: "population" },
];

describe("moving a signal onto the health network's boundaries", () => {
  it("splits a count into the parts each territory holds", () => {
    // Extensive: 800 cases from a sewershed straddling two RLS are 400 each.
    const out = reallocate({ "plant:jp": 800 }, SPLIT, "extensive");
    assert.equal(out.byTarget.get("rls:0643"), 400);
    assert.equal(out.byTarget.get("rls:0653"), 400);
  });

  it("does not split a concentration, it carries it", () => {
    // Intensive: both halves of the sewershed have the same copies per litre.
    // Halving it would say each territory measured 250 when neither did.
    const out = reallocate({ "plant:jp": 500 }, SPLIT, "intensive");
    assert.equal(out.byTarget.get("rls:0643"), 500);
    assert.equal(out.byTarget.get("rls:0653"), 500);
  });

  it("averages two intensities rather than adding them", () => {
    // Two plants each reporting 500 copies per litre do not make 1000. This is
    // the error the `quantity` argument exists to make impossible.
    const two: Overlap[] = [
      { source: "a", target: "rls:0643", weight: 1 },
      { source: "b", target: "rls:0643", weight: 1 },
    ];
    const out = reallocate({ a: 400, b: 600 }, two, "intensive");
    assert.equal(out.byTarget.get("rls:0643"), 500);
  });

  it("adds two counts", () => {
    const two: Overlap[] = [
      { source: "a", target: "rls:0643", weight: 1 },
      { source: "b", target: "rls:0643", weight: 1 },
    ];
    assert.equal(reallocate({ a: 400, b: 600 }, two, "extensive").byTarget.get("rls:0643"), 1000);
  });

  it("weights an average by how much of each source belongs there", () => {
    // A plant covering most of the territory should dominate its mean.
    const mixed: Overlap[] = [
      { source: "big", target: "t", weight: 0.9 },
      { source: "small", target: "t", weight: 0.1 },
    ];
    const out = reallocate({ big: 100, small: 1100 }, mixed, "intensive");
    assert.equal(out.byTarget.get("t"), 200);
  });

  it("names a zone that reaches no territory instead of losing it", () => {
    // A plant nobody mapped simply vanishes, and the territory then reads as
    // quiet when the truth is that nothing was ever pointed at it.
    const out = reallocate({ "plant:jp": 500, "plant:orphan": 900 }, SPLIT, "intensive");
    assert.deepEqual(out.unmapped, ["plant:orphan"]);
  });

  it("reports weights that do not add up without correcting them", () => {
    // Over one multiplies a signal measured once; under one loses part of it.
    // Which is the mistake depends on whether the map was meant to be
    // complete, and only the author knows that.
    const partial: Overlap[] = [{ source: "a", target: "t", weight: 0.6 }];
    const out = reallocate({ a: 100 }, partial, "extensive");
    assert.deepEqual(out.unbalanced, [{ source: "a", total: 0.6 }]);
    assert.equal(out.byTarget.get("t"), 60);
  });

  it("says nothing about a zone that reported nothing", () => {
    // Null is not zero here either: an unsampled week is not a clean week.
    const out = reallocate({ "plant:jp": null }, SPLIT, "intensive");
    assert.equal(out.byTarget.size, 0);
    assert.deepEqual(out.unmapped, []);
  });

  it("ignores a declared overlap of zero rather than dividing by it", () => {
    const none: Overlap[] = [{ source: "a", target: "t", weight: 0 }];
    const out = reallocate({ a: 100 }, none, "intensive");
    assert.equal(out.byTarget.size, 0);
    assert.deepEqual(out.unmapped, ["a"]);
  });
});

describe("where the weights come from", () => {
  it("normalises head counts into shares", () => {
    const w = weightsFromPopulation([
      { source: "plant", target: "a", people: 30000 },
      { source: "plant", target: "b", people: 70000 },
    ]);
    assert.deepEqual(w.map((x) => x.weight), [0.3, 0.7]);
    assert.equal(w[0]!.basis, "population");
  });

  it("stamps an area weight as an area weight", () => {
    // Over a city, land and people are distributed very differently. A signal
    // that comes from people, weighted by hectares, is wrong in a direction
    // nobody can guess from looking at the number.
    const w = weightsFromArea([
      { source: "plant", target: "a", area: 30 },
      { source: "plant", target: "b", area: 70 },
    ]);
    assert.equal(w[0]!.basis, "area");
    assert.equal(w[1]!.weight, 0.7);
  });

  it("leaves out a piece holding nobody", () => {
    const w = weightsFromPopulation([
      { source: "plant", target: "a", people: 100 },
      { source: "plant", target: "empty", people: 0 },
    ]);
    assert.equal(w.length, 1);
    assert.equal(w[0]!.weight, 1);
  });

  it("returns nothing rather than dividing by zero for an empty zone", () => {
    assert.deepEqual(weightsFromPopulation([{ source: "p", target: "a", people: 0 }]), []);
  });
});
