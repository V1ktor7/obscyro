import { describe, expect, it } from "vitest";

import { resolveEnv, urlWithEnv } from "./env-persist";

// ---------------------------------------------------------------------------
// The rule these pin: a link decides where you land, your browser remembers
// between visits, and the API's first environment is only ever a last resort.
//
// Before this, there was no rule — every reload picked available[0], which is
// how a network ended up with its datasets in one environment and its twin in
// another without anything on screen saying so.
// ---------------------------------------------------------------------------

const AVAILABLE = [
  { slug: "chum-lab" },
  { slug: "chum-operations" },
  { slug: "sandbox" },
];

describe("resolveEnv", () => {
  it("a link wins over what the browser remembers", () => {
    expect(resolveEnv("chum-operations", "chum-lab", AVAILABLE)).toBe("chum-operations");
  });

  it("without a link, the browser's memory wins over the default", () => {
    expect(resolveEnv(null, "chum-operations", AVAILABLE)).toBe("chum-operations");
  });

  it("with neither, the first environment is the fallback", () => {
    expect(resolveEnv(null, null, AVAILABLE)).toBe("chum-lab");
  });

  it("a slug that no longer exists falls through instead of selecting nothing", () => {
    // A deleted environment, or a link pasted from another organization. An
    // empty selection renders every view as if the account had no data.
    expect(resolveEnv("deleted-env", "chum-operations", AVAILABLE)).toBe("chum-operations");
    expect(resolveEnv("deleted-env", "also-gone", AVAILABLE)).toBe("chum-lab");
  });

  it("no environments at all resolves to nothing, not to a guess", () => {
    expect(resolveEnv("chum-lab", "chum-lab", [])).toBeNull();
  });
});

describe("urlWithEnv", () => {
  it("adds the environment without dropping the other parameters", () => {
    const url = urlWithEnv("/studio/manager", "?view=schema", "chum-operations");
    expect(url).toBe("/studio/manager?view=schema&env=chum-operations");
  });

  it("replaces an environment already in the URL", () => {
    const url = urlWithEnv("/studio/live", "?env=chum-lab", "chum-operations");
    expect(url).toBe("/studio/live?env=chum-operations");
  });

  it("works on a bare path", () => {
    expect(urlWithEnv("/studio/response", "", "sandbox")).toBe(
      "/studio/response?env=sandbox",
    );
  });
});
