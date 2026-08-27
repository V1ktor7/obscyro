import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A site that is itself a unit contributes itself.
 *
 * Two shapes of twin are both legitimate. One separates the building from the
 * service running inside it — a placement link says which units stand where,
 * and a site's contributing units are read off that link. The other has no such
 * separation: the installation carries its own coordinates and is the unit.
 *
 * The second shape returned an empty list, and everything that joins a run back
 * to the map joins through it. The replay counters climbed while all 312 sites
 * stayed grey, because no facility in the result could be matched to anything
 * on screen.
 */

/** The one line of the site assembly this is about, lifted out to be testable. */
function contributingUnits(
  siteId: string,
  place: { contributingUnits: { id: string; name: string }[] } | undefined,
  node: { name: string } | undefined,
): { id: string; name: string }[] {
  return place?.contributingUnits ?? (node ? [{ id: siteId, name: node.name }] : []);
}

describe("what a site on the map stands for", () => {
  it("reads the placement when the twin declares one", () => {
    const out = contributingUnits(
      "batiment-1",
      { contributingUnits: [{ id: "urgence", name: "Urgence" }, { id: "chirurgie", name: "Chirurgie" }] },
      { name: "Hôpital Notre-Dame" },
    );
    assert.deepEqual(out.map((u) => u.id), ["urgence", "chirurgie"]);
  });

  it("falls back to itself when the installation is the unit", () => {
    // No placement link to read: the installation carries its own coordinates.
    // Returning nothing here is what left every site grey through a whole run.
    const out = contributingUnits("hopital-verdun", undefined, { name: "Hôpital de Verdun" });
    assert.deepEqual(out, [{ id: "hopital-verdun", name: "Hôpital de Verdun" }]);
  });

  it("says nothing about a site with no unit behind it at all", () => {
    // A drawn point that is in no tree is not secretly a hospital.
    assert.deepEqual(contributingUnits("point-dessine", undefined, undefined), []);
  });

  it("prefers an explicit empty placement over the fallback", () => {
    // A building declared to hold nothing holds nothing. Substituting itself
    // would make an empty shell report the numbers of a hospital.
    assert.deepEqual(
      contributingUnits("coquille", { contributingUnits: [] }, { name: "Pavillon vide" }),
      [],
    );
  });
});
