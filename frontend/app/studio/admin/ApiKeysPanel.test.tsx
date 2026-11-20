// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeySummary } from "@/lib/platform-api";

const api = vi.hoisted(() => ({ listKeys: vi.fn(), createKey: vi.fn(), revokeKey: vi.fn() }));
vi.mock("@/lib/platform-api", async (orig) => ({ ...(await orig<typeof import("@/lib/platform-api")>()), ...api }));

const store = vi.hoisted(() => ({ key: null as string | null, getStoredKey: vi.fn(), setStoredKey: vi.fn() }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  getStoredKey: store.getStoredKey,
  setStoredKey: store.setStoredKey,
}));

import ApiKeysPanel, { isBrowserKey, maskKey } from "./ApiKeysPanel";

// Made-up strings in the shape of a key. None of them opens anything.
const MINE = `obs_demo_${"a".repeat(20)}wxyz`;
const NEW = `obs_demo_${"b".repeat(20)}1234`;

const key = (over: Partial<ApiKeySummary> = {}): ApiKeySummary => ({
  id: "k1",
  prefix: MINE.slice(0, 12),
  name: "Laptop",
  plan: "free",
  monthlyQuota: 1000,
  createdAt: "2026-11-01T12:00:00.000Z",
  lastUsedAt: "2026-11-20T12:00:00.000Z",
  ...over,
});

const OTHER = key({ id: "k2", prefix: "obs_demo_zzz", name: "Nightly import", lastUsedAt: null });

const clipboard = { writeText: vi.fn() };

beforeEach(() => {
  store.key = MINE;
  store.getStoredKey.mockImplementation(() => store.key);
  store.setStoredKey.mockImplementation((k: string) => {
    store.key = k;
  });
  api.listKeys.mockResolvedValue({ keys: [key(), OTHER] });
  clipboard.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a key, masked", () => {
  it("keeps enough to recognise it and hides the rest", () => {
    expect(maskKey(MINE)).toBe(`obs_demo${"•".repeat(16)}wxyz`);
    expect(maskKey(MINE)).not.toContain("a".repeat(5));
    // Too short to show any of it.
    expect(maskKey("abc")).toBe("•••");
  });

  it("is this browser's when it starts the way the server says that key starts", () => {
    expect(isBrowserKey(key(), MINE)).toBe(true);
    expect(isBrowserKey(OTHER, MINE)).toBe(false);
    expect(isBrowserKey(key(), null)).toBe(false);
    // A key with no known beginning matches nothing.
    expect(isBrowserKey(key({ prefix: "" }), MINE)).toBe(false);
  });
});

describe("the API keys page", () => {
  it("shows the key this browser uses masked, and in full only when asked", async () => {
    render(<ApiKeysPanel />);
    const mine = await screen.findByRole("region", { name: "The key this browser uses" });
    await within(mine).findByText("· Laptop");
    expect(within(mine).getByLabelText("The key, masked").textContent).toBe(maskKey(MINE));
    expect(mine.textContent).not.toContain(MINE);

    fireEvent.click(within(mine).getByRole("button", { name: "Show" }));
    expect(within(mine).getByLabelText("The key, in full").textContent).toBe(MINE);
    fireEvent.click(within(mine).getByRole("button", { name: "Hide" }));
    expect(mine.textContent).not.toContain(MINE);
  });

  it("copies the whole key, masked or not, and says that it did", async () => {
    render(<ApiKeysPanel />);
    const mine = await screen.findByRole("region", { name: "The key this browser uses" });
    fireEvent.click(within(mine).getByRole("button", { name: "Copy" }));
    await within(mine).findByRole("button", { name: "Copied" });
    expect(clipboard.writeText).toHaveBeenCalledWith(MINE);
  });

  it("says so when the browser refuses to copy, rather than pretending", async () => {
    clipboard.writeText.mockRejectedValue(new Error("denied"));
    render(<ApiKeysPanel />);
    const mine = await screen.findByRole("region", { name: "The key this browser uses" });
    fireEvent.click(within(mine).getByRole("button", { name: "Copy" }));
    expect((await within(mine).findByRole("alert")).textContent).toMatch(/refused to copy/);
    expect(within(mine).queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("lists every key by its name and its first characters, and marks the one this browser uses", async () => {
    render(<ApiKeysPanel />);
    const list = await screen.findByRole("region", { name: "The keys of the account" });
    const rows = await within(list).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Laptop");
    expect(rows[0]!.textContent).toContain(`${MINE.slice(0, 12)}…`);
    expect(rows[0]!.textContent).toContain("used by this browser");
    expect(rows[1]!.textContent).toContain("Nightly import");
    expect(rows[1]!.textContent).toContain("never used");
    expect(rows[1]!.textContent).not.toContain("used by this browser");
    // What the server does not have, the list cannot show.
    expect(list.textContent).not.toContain(MINE);
  });

  it("says that this browser holds no key when it holds none", async () => {
    store.key = null;
    render(<ApiKeysPanel />);
    const mine = await screen.findByRole("region", { name: "The key this browser uses" });
    expect(within(mine).getByText(/This browser holds no key/)).toBeTruthy();
    expect(within(mine).queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("creates a key, shows it once to be copied, and changes the browser's key only on a click", async () => {
    api.createKey.mockResolvedValue({ key: { id: "k3", rawKey: NEW, prefix: NEW.slice(0, 12), name: "Notebook" } });
    render(<ApiKeysPanel />);
    await screen.findByRole("region", { name: "The keys of the account" });
    // No name, no key.
    expect((screen.getByRole("button", { name: "Create key" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Create a key"), { target: { value: "  Notebook " } });
    api.listKeys.mockResolvedValue({ keys: [key(), OTHER, key({ id: "k3", prefix: NEW.slice(0, 12), name: "Notebook", lastUsedAt: null })] });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    const fresh = await screen.findByRole("region", { name: "The key just created" });
    expect(api.createKey).toHaveBeenCalledWith("Notebook");
    expect(fresh.textContent).toContain(NEW);
    expect(fresh.textContent).toMatch(/only time it is shown/);
    fireEvent.click(within(fresh).getByRole("button", { name: "Copy the new key" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(NEW));
    // The list was read again, and the browser still uses the key it had.
    expect(await screen.findAllByRole("listitem")).toHaveLength(3);
    expect(store.setStoredKey).not.toHaveBeenCalled();

    fireEvent.click(within(fresh).getByRole("button", { name: "Use in this browser" }));
    expect(store.setStoredKey).toHaveBeenCalledWith(NEW);
    expect(within(fresh).getByText("This browser now uses it")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "The key this browser uses" })).getByLabelText("The key, masked").textContent).toBe(maskKey(NEW));

    // Closed, it is gone from the page.
    fireEvent.click(within(fresh).getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByRole("region", { name: "The key just created" })).toBeNull();
  });

  it("asks in the page before revoking, and revokes only on the second click", async () => {
    api.revokeKey.mockResolvedValue({ ok: true });
    render(<ApiKeysPanel />);
    const rows = await screen.findAllByRole("listitem");
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Revoke" }));
    expect(api.revokeKey).not.toHaveBeenCalled();
    expect(rows[1]!.textContent).toMatch(/Revoke “Nightly import”\? Whatever uses it stops working at once/);
    // Changing one's mind costs nothing.
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Keep it" }));
    expect(api.revokeKey).not.toHaveBeenCalled();

    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Revoke" }));
    api.listKeys.mockResolvedValue({ keys: [key()] });
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Revoke the key" }));
    await waitFor(() => expect(api.revokeKey).toHaveBeenCalledWith("k2"));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
  });

  it("warns that revoking the browser's own key stops the Studio here", async () => {
    render(<ApiKeysPanel />);
    const rows = await screen.findAllByRole("listitem");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Revoke" }));
    expect(rows[0]!.textContent).toMatch(/It is the key this browser uses: the Studio will stop working here/);
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Revoke" }));
  });

  it("says why when the keys cannot be read, created or revoked", async () => {
    api.listKeys.mockRejectedValueOnce(new Error("offline"));
    render(<ApiKeysPanel />);
    expect((await screen.findByRole("alert")).textContent).toBe("The keys could not be read: offline");
    cleanup();

    api.createKey.mockRejectedValue(new Error("quota reached"));
    render(<ApiKeysPanel />);
    await screen.findAllByRole("listitem");
    fireEvent.change(screen.getByLabelText("Create a key"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The key was not created: quota reached"));
    expect(screen.queryByRole("region", { name: "The key just created" })).toBeNull();
  });
});
