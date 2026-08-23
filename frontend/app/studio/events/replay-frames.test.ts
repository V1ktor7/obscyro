import { describe, expect, it } from "vitest";

import { FULL, bandOf, framesFor, project, type FacilitiesTable } from "./replay-frames";

const TABLE: FacilitiesTable = {
  columns: ["policy", "step", "facility_id", "facility", "activity", "occupancy", "waiting"],
  rows: [
    // A hospital whose acute beds are full and whose long-stay wing is empty.
    ["null", 0, "h", "HÔPITAL NOTRE-DAME", "litsantephysique", 1, 40],
    ["null", 0, "h", "HÔPITAL NOTRE-DAME", "lithebergementpermanent", 0.02, 0],
    ["null", 0, "c", "CHSLD ANGUS", "lithebergementpermanent", 0.5, 0],
    ["null", 1, "h", "HÔPITAL NOTRE-DAME", "litsantephysique", 0.4, 0],
    // Another response, same steps. It must not leak into the first.
    ["load-balance", 0, "h", "HÔPITAL NOTRE-DAME", "litsantephysique", 0.3, 0],
  ],
};

describe("frames", () => {
  it("reduces a facility to its worst activity", () => {
    // The defect this exists to avoid: averaged over the category, Notre-Dame
    // reads 6% while its acute ward turns people away.
    const f = framesFor(TABLE, "null", 2)[0]!;
    const nd = f.facilities.find((x) => x.id === "h")!;
    expect(nd.worst).toBe(1);
    expect(nd.activity).toBe("litsantephysique");
  });

  it("adds the queue across everything a facility provides", () => {
    // A dot says how many people are waiting there, not how many are waiting
    // for one of the things it offers.
    const f = framesFor(TABLE, "null", 2)[0]!;
    expect(f.facilities.find((x) => x.id === "h")!.waiting).toBe(40);
    expect(f.waiting).toBe(40);
  });

  it("counts what was full", () => {
    expect(framesFor(TABLE, "null", 2)[0]!.full).toBe(1);
    expect(framesFor(TABLE, "null", 2)[1]!.full).toBe(0);
  });

  it("keeps one response out of another", () => {
    const f = framesFor(TABLE, "load-balance", 1)[0]!;
    expect(f.facilities).toHaveLength(1);
    expect(f.facilities[0]!.worst).toBe(0.3);
  });

  it("still produces a frame for a step with no rows", () => {
    // Skipping it makes the slider jump a day, and the reader is then scrubbing
    // a timeline whose length does not match the run.
    const f = framesFor(TABLE, "null", 5);
    expect(f).toHaveLength(5);
    expect(f[4]!.facilities).toEqual([]);
  });

  it("returns nothing rather than guessing when a column is missing", () => {
    expect(framesFor({ columns: ["policy", "step"], rows: [] }, "null", 3)).toEqual([]);
  });
});

describe("bands", () => {
  it("says full only at capacity", () => {
    expect(bandOf(1)).toBe("plein");
    expect(bandOf(FULL)).toBe("plein");
    expect(bandOf(0.95)).toBe("tendu");
    expect(bandOf(0.7)).toBe("charge");
    expect(bandOf(0.1)).toBe("calme");
  });
});

describe("placing the sites", () => {
  const pts = [
    { id: "a", location: [45.4, -73.9] as [number, number] },
    { id: "b", location: [45.7, -73.5] as [number, number] },
    { id: "nowhere", location: null },
  ];

  it("puts north above south and west left of east", () => {
    const p = project(pts, 400, 300);
    const [ax, ay] = p.get("a")!;
    const [bx, by] = p.get("b")!;
    expect(ay).toBeGreaterThan(by);
    expect(ax).toBeLessThan(bx);
  });

  it("leaves out what has no coordinates rather than piling it at the origin", () => {
    expect(project(pts, 400, 300).has("nowhere")).toBe(false);
  });

  it("keeps everything inside the frame", () => {
    for (const [x, y] of Array.from(project(pts, 400, 300).values())) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(300);
    }
  });

  it("survives a twin where nothing is placed", () => {
    expect(project([{ id: "a", location: null }], 400, 300).size).toBe(0);
  });
});
