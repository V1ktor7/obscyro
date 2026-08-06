import { describe, expect, it } from "vitest";

import { signalTypeForMetric, type SignalType } from "./signals-api";

// ---------------------------------------------------------------------------
// This mirrors an inner join in the backend's alert bridge:
//
//   JOIN signal_type st ON st.alert_metric = a.metric AND st.active
//
// Both halves have to agree, because the failure is silent: an alert whose
// metric nothing claims opens on the unit and never becomes a signal. No error,
// no log, no row — the twin turns red and the response board stays empty. A
// network ran an emergency ward at 100% occupancy for days that way.
// ---------------------------------------------------------------------------

function type(over: Partial<SignalType>): SignalType {
  return {
    id: "st-1",
    organizationId: "org-1",
    key: "occupancy",
    name: "Occupation élevée",
    domain: "Flux patient",
    workflowId: "wf-1",
    defaultSeverity: "critical",
    description: null,
    active: true,
    alertMetric: "occupancy",
    ...over,
  };
}

describe("signalTypeForMetric", () => {
  it("finds the type that claims the metric", () => {
    const found = signalTypeForMetric([type({})], "occupancy");
    expect(found?.name).toBe("Occupation élevée");
  });

  it("an inactive type does not count — the join requires active", () => {
    expect(signalTypeForMetric([type({ active: false })], "occupancy")).toBeNull();
  });

  it("a type wired to another metric does not count", () => {
    expect(signalTypeForMetric([type({ alertMetric: "freshnessSeconds" })], "occupancy")).toBeNull();
  });

  it("a type wired to nothing does not count", () => {
    // Most signal types are raised by hand and carry no metric at all.
    expect(signalTypeForMetric([type({ alertMetric: null })], "occupancy")).toBeNull();
  });

  it("matching is exact — a label is not a key", () => {
    // The rule stores `occupancy`; naming the metric by its label silently
    // matches nothing, which is the mistake the picker exists to prevent.
    expect(signalTypeForMetric([type({})], "Occupancy")).toBeNull();
    expect(signalTypeForMetric([type({})], "occupancy ")).toBeNull();
  });

  it("no metric selected reaches nobody, rather than matching the first type", () => {
    expect(signalTypeForMetric([type({})], "")).toBeNull();
  });

  it("an empty configuration reaches nobody", () => {
    expect(signalTypeForMetric([], "occupancy")).toBeNull();
  });
});
