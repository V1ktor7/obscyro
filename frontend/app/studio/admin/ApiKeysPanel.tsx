"use client";

/**
 * API keys: the keys of the account, and the one this browser uses.
 *
 * The server keeps a fingerprint of a key, never the key itself. So a key is
 * shown in full exactly once, when it is created, and nobody (the server
 * included) can show it again afterwards. The list below gives each key's name
 * and the first characters it starts with, which is all the server has.
 *
 * One key is different: the one this browser signs its requests with. The
 * browser has to hold it to use it, so it can be read here in full, masked
 * until someone asks to see it, with a button that copies it. That is the key
 * to paste into a script or another tool.
 *
 * Nothing on this page sends a key anywhere: showing and copying happen in the
 * browser. Creating and revoking are the two things that reach the server.
 */

import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getStoredKey, setStoredKey } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { createKey, listKeys, revokeKey, type ApiKeySummary } from "@/lib/platform-api";

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";
const BTN =
  "flex h-7 items-center gap-1.5 border border-line-strong bg-surface px-2.5 text-[11.5px] font-semibold text-ink hover:bg-surface-hover disabled:opacity-60";
const BTN_PRIMARY =
  "flex h-7 items-center gap-1.5 bg-brand px-2.5 text-[11.5px] font-semibold text-white hover:bg-brand-deep disabled:opacity-60";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

/** A key with its middle hidden: enough to recognise it, not enough to use it. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 8)}${"•".repeat(16)}${key.slice(-4)}`;
}

/** Whether a key of the account is the one this browser holds. The server only knows how a key starts. */
export function isBrowserKey(key: ApiKeySummary, stored: string | null): boolean {
  return stored !== null && key.prefix.length > 0 && stored.startsWith(key.prefix);
}

/** A button that copies a key, and says whether it did. */
function CopyKey({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      // No clipboard here (an insecure page, a refused permission): say so, and the key can be selected by hand.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <>
      <button type="button" onClick={() => void copy()} className={BTN}>
        {state === "copied" ? <Check className="h-3 w-3 text-ok-ink" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
        {state === "copied" ? "Copied" : label}
      </button>
      {state === "failed" ? (
        <span role="alert" className="text-[11px] text-warn-ink">
          The browser refused to copy. Show the key, select it and copy it by hand.
        </span>
      ) : null}
    </>
  );
}

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The key this browser signs its requests with. Read once the page is in the browser.
  const [stored, setStored] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  // A key just created: its one and only showing.
  const [created, setCreated] = useState<{ name: string; rawKey: string } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setKeys((await listKeys()).keys);
    } catch (e) {
      setError(`The keys could not be read: ${message(e)}`);
    }
  }, []);

  useEffect(() => {
    setStored(getStoredKey());
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const wanted = name.trim();
    if (!wanted || creating) return;
    setCreating(true);
    setError(null);
    try {
      const { key } = await createKey(wanted);
      setCreated({ name: key.name, rawKey: key.rawKey });
      setName("");
      await load();
    } catch (err) {
      setError(`The key was not created: ${message(err)}`);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    setError(null);
    try {
      await revokeKey(id);
      setAsking(null);
      await load();
    } catch (err) {
      setError(`The key was not revoked: ${message(err)}`);
    } finally {
      setRevoking(null);
    }
  }

  function adopt(rawKey: string) {
    setStoredKey(rawKey);
    setStored(rawKey);
    setShown(false);
  }

  const mine = keys?.find((k) => isBrowserKey(k, stored)) ?? null;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      {error ? (
        <p role="alert" className="border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-ink">
          {error}
        </p>
      ) : null}

      <section aria-label="The key this browser uses" className="flex flex-col gap-2.5 border border-line bg-surface p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-brand" aria-hidden="true" />
          <h2 className="text-[13px] font-semibold text-ink">The key this browser uses</h2>
          {mine ? <span className="text-[11.5px] text-ink-muted">· {mine.name}</span> : null}
        </div>
        {stored ? (
          <>
            <code
              aria-label={shown ? "The key, in full" : "The key, masked"}
              className="block select-all break-all border border-line bg-canvas px-3 py-2 font-mono text-[12.5px] text-ink"
            >
              {shown ? stored : maskKey(stored)}
            </code>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-pressed={shown} onClick={() => setShown((s) => !s)} className={BTN}>
                {shown ? <EyeOff className="h-3 w-3" aria-hidden="true" /> : <Eye className="h-3 w-3" aria-hidden="true" />}
                {shown ? "Hide" : "Show"}
              </button>
              <CopyKey value={stored} />
            </div>
            <p className="text-[11px] text-ink-faint">
              This browser keeps the key to sign each request, which is why it can be shown here. It is the only place
              it can be read: the server holds a fingerprint of it, not the key. Anyone who has it can call the API as
              you, so paste it only where it is needed.
            </p>
          </>
        ) : (
          <p className="text-[12px] text-ink-body">
            This browser holds no key. Create one below and choose “Use in this browser”, or sign in again.
          </p>
        )}
      </section>

      {created ? (
        <section aria-label="The key just created" className="flex flex-col gap-2.5 border border-warn-line bg-warn-soft p-4">
          <h2 className="text-[13px] font-semibold text-warn-ink">“{created.name}” was created. This is the only time it is shown.</h2>
          <code className="block select-all break-all border border-warn-line bg-canvas px-3 py-2 font-mono text-[12.5px] text-ink">{created.rawKey}</code>
          <div className="flex flex-wrap items-center gap-2">
            <CopyKey value={created.rawKey} label="Copy the new key" />
            {stored === created.rawKey ? (
              <span className="flex items-center gap-1 text-[11.5px] text-ok-ink">
                <Check className="h-3 w-3" aria-hidden="true" /> This browser now uses it
              </span>
            ) : (
              <button type="button" onClick={() => adopt(created.rawKey)} className={BTN}>
                Use in this browser
              </button>
            )}
            <button type="button" onClick={() => setCreated(null)} className="h-7 px-2 text-[11.5px] text-warn-ink hover:underline">
              I have copied it
            </button>
          </div>
          <p className="text-[11px] text-warn-ink">
            Copy it now. Once this box is closed the key cannot be shown again, unless this browser is the one using it.
          </p>
        </section>
      ) : null}

      <section aria-label="The keys of the account" className="flex flex-col gap-2">
        <span className={LABEL}>Keys of the account{keys ? ` · ${keys.length}` : ""}</span>
        {keys === null && !error ? (
          <p className="flex items-center gap-2 text-[12px] text-ink-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading the keys…
          </p>
        ) : null}
        {keys && keys.length === 0 ? <p className="text-[12px] text-ink-body">No key yet.</p> : null}
        {keys && keys.length > 0 ? (
          <ul className="flex flex-col border border-line">
            {keys.map((k) => {
              const here = isBrowserKey(k, stored);
              return (
                <li key={k.id} className="flex flex-col gap-1.5 border-b border-line-soft bg-surface px-3 py-2 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[12.5px] font-semibold text-ink">{k.name}</span>
                    <code className="font-mono text-[11.5px] text-ink-muted">{k.prefix}…</code>
                    {here ? <span className="bg-brand-soft px-1.5 py-px text-[10px] font-semibold text-brand-deep">used by this browser</span> : null}
                    <span className="ml-auto text-[11px] text-ink-faint">
                      created {day(k.createdAt)} · {k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "never used"}
                    </span>
                    {asking === k.id ? null : (
                      <button type="button" onClick={() => setAsking(k.id)} className="h-6 px-1.5 text-[11.5px] text-danger hover:underline">
                        Revoke
                      </button>
                    )}
                  </div>
                  {asking === k.id ? (
                    <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-body">
                      <span>
                        Revoke “{k.name}”? Whatever uses it stops working at once, and it cannot be undone.
                        {here ? " It is the key this browser uses: the Studio will stop working here until you sign in again." : ""}
                      </span>
                      <button
                        type="button"
                        disabled={revoking !== null}
                        onClick={() => void revoke(k.id)}
                        className={cn(BTN, "border-danger-line text-danger-ink")}
                      >
                        {revoking === k.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                        Revoke the key
                      </button>
                      <button type="button" onClick={() => setAsking(null)} className={BTN}>
                        Keep it
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-[11px] text-ink-faint">
          Only the first characters of a key are kept in the clear, so a key in this list can be recognised but not
          copied. To get one you can paste, create a new key: it is shown once.
        </p>
      </section>

      <form onSubmit={create} className="flex flex-col gap-2">
        <label htmlFor="new-key-name" className={LABEL}>
          Create a key
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="new-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What it is for: “notebook”, “nightly import”…"
            className="h-7 min-w-0 flex-1 border border-line-strong bg-surface px-2 text-[12.5px] text-ink focus:border-brand focus:outline-none"
          />
          <button type="submit" disabled={!name.trim() || creating} className={BTN_PRIMARY}>
            {creating ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Plus className="h-3 w-3" aria-hidden="true" />}
            Create key
          </button>
        </div>
      </form>
    </div>
  );
}
