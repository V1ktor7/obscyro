// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepared = vi.hoisted(() => ({ keepPrepared: vi.fn() }));
vi.mock("../../prepared-api", async (orig) => ({ ...(await orig<typeof import("../../prepared-api")>()), ...prepared }));

const signals = vi.hoisted(() => ({ listSignalTypes: vi.fn() }));
vi.mock("../../signals-api", async (orig) => ({ ...(await orig<typeof import("../../signals-api")>()), ...signals }));

import KeepPrepared from "./KeepPrepared";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const kind = (id: string, name: string, domain: string, active = true) => ({
  id,
  organizationId: "o1",
  key: name.toLowerCase(),
  name,
  domain,
  workflowId: "w1",
  defaultSeverity: "warn" as const,
  description: null,
  active,
  alertMetric: null,
});

beforeEach(() => {
  signals.listSignalTypes.mockResolvedValue([kind("k1", "Occupation élevée", "Flux patient"), kind("k2", "Rupture de stock", "Approvisionnement"), kind("k3", "Ancien", "Flux patient", false)]);
});

const OPEN = "Keep as a prepared response for…";

describe("keeping a tested option as a prepared response", () => {
  it("names the test and the kind of signal, and sends no figure", async () => {
    prepared.keepPrepared.mockResolvedValue({ id: "r1", signalType: "Rupture de stock" });
    render(<KeepPrepared env="mtl" exchangeId="x1" step="s2" label="Open 60 beds at Lakeshore" current />);

    // Nothing is read until somebody asks to keep.
    expect(signals.listSignalTypes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    const pick = (await screen.findByLabelText("Kind of signal")) as HTMLSelectElement;
    // The kinds in use, by domain; a retired kind is not offered.
    expect(Array.from(pick.options).map((o) => o.textContent)).toEqual(["Flux patient · Occupation élevée", "Approvisionnement · Rupture de stock"]);

    fireEvent.change(pick, { target: { value: "k2" } });
    fireEvent.change(screen.getByLabelText("Who can approve it"), { target: { value: " Director of logistics " } });
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    await waitFor(() => expect(prepared.keepPrepared).toHaveBeenCalledTimes(1));
    expect(prepared.keepPrepared).toHaveBeenCalledWith("mtl", { exchangeId: "x1", step: "s2", signalTypeId: "k2", approver: "Director of logistics" });
    expect(await screen.findByText(/Kept as a prepared response for “Rupture de stock”\. A signal of that kind will show it on its situation card, with the figures of this test\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
  });

  it("cannot keep a test that was not journalled, or one the scenario has moved away from", () => {
    const a = render(<KeepPrepared env="mtl" exchangeId={null} step="s2" label="Open 60 beds" current />);
    const untraced = screen.getByRole("button", { name: OPEN }) as HTMLButtonElement;
    expect(untraced.disabled).toBe(true);
    expect(untraced.title).toMatch(/was not journalled/);
    a.unmount();

    render(<KeepPrepared env="mtl" exchangeId="x1" step="s2" label="Open 60 beds" current={false} />);
    const moved = screen.getByRole("button", { name: OPEN }) as HTMLButtonElement;
    expect(moved.disabled).toBe(true);
    expect(moved.title).toMatch(/The scenario changed since these tests: the figures are those of another scenario/);
  });

  it("says when the server refuses, and when the organisation has no kind of signal", async () => {
    prepared.keepPrepared.mockRejectedValue(new Error("Step s2 is not an option the engine tested in this exchange."));
    const a = render(<KeepPrepared env="mtl" exchangeId="x1" step="s2" label="Open 60 beds" current />);
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    await screen.findByLabelText("Kind of signal");
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect((await screen.findByRole("alert")).textContent).toBe("“Open 60 beds” was not kept: Step s2 is not an option the engine tested in this exchange.");
    a.unmount();

    signals.listSignalTypes.mockResolvedValue([]);
    render(<KeepPrepared env="mtl" exchangeId="x1" step="s2" label="Open 60 beds" current />);
    fireEvent.click(screen.getByRole("button", { name: OPEN }));
    expect(await screen.findByText(/No kind of signal is defined for this organisation/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Keep" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
