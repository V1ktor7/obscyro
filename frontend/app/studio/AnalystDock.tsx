"use client";

/**
 * The analyst, from every page of the Studio.
 *
 * It used to exist only on the scenario map. An alert arrives on the Units
 * page or the Response board, and asking about it meant changing page and
 * finding the context again by hand. The dock is in the shell, so the question
 * is one click away wherever the alert is read, and it goes with what the
 * person has in front of them: the page, and the unit or the signal they have
 * selected (`useAnalystFocus`).
 *
 * Three pages do without it, because they already hold the analyst where the
 * work is: the scenario map, whose panel also has the scenario, the run and
 * the options; the situation card, where it sits under the figures; and the
 * network map, whose Analyst panel also investigates the series of the unit
 * selected on it.
 *
 * It only reads. What it is told about the page is ids: the server looks the
 * names up itself.
 */

import { MessageSquareText, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { AskTab } from "./simulation/hex/AnalystPanel";

/** What a page says the person has selected. */
export interface PageFocus {
  unitId?: string;
  signalId?: string;
}

const FocusContext = createContext<{
  focus: PageFocus;
  setFocus: (f: PageFocus) => void;
  /** How many times a page has asked for the analyst. */
  asked: number;
  ask: () => void;
} | null>(null);

export function AnalystFocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocusState] = useState<PageFocus>({});
  const [asked, setAsked] = useState(0);
  const setFocus = useCallback((f: PageFocus) => {
    // The same selection again is not a change: a page re-rendering must not re-render the shell.
    setFocusState((cur) => (cur.unitId === f.unitId && cur.signalId === f.signalId ? cur : f));
  }, []);
  const ask = useCallback(() => setAsked((n) => n + 1), []);
  const value = useMemo(() => ({ focus, setFocus, asked, ask }), [focus, setFocus, asked, ask]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/**
 * A page opens the analyst itself: the "Ask the analyst" of a unit's sheet.
 * The question still goes with what the page has selected. Null outside the
 * shell, where there is no analyst to open.
 */
export function useOpenAnalyst(): (() => void) | null {
  return useContext(FocusContext)?.ask ?? null;
}

/**
 * A page tells the analyst what the person has selected. Forgotten when the
 * page leaves, so a question asked elsewhere does not carry a unit nobody is
 * looking at any more.
 */
export function useAnalystFocus(focus: PageFocus): void {
  const setFocus = useContext(FocusContext)?.setFocus;
  const { unitId, signalId } = focus;
  useEffect(() => {
    if (!setFocus) return;
    setFocus({ unitId, signalId });
    return () => setFocus({});
  }, [setFocus, unitId, signalId]);
}

/** The pages that hold the analyst themselves. */
const OWN_ANALYST = new Set(["simulation", "situation", "command"]);

/** The Studio page an address is on: "/studio/live" is "live". */
export function pageOf(pathname: string): string {
  return pathname.split("/")[2] ?? "";
}

export function AnalystDock({ env }: { env: string | null }) {
  const page = pageOf(usePathname() ?? "");
  const shared = useContext(FocusContext);
  const focus = shared?.focus ?? {};
  const asked = shared?.asked ?? 0;
  const [open, setOpen] = useState(false);
  // Built the first time it is opened and kept after, so an answer is still there when the panel is reopened.
  const [built, setBuilt] = useState(false);
  const [off, setOff] = useState(false);

  // A page asked for it: open, as the button below would.
  useEffect(() => {
    if (asked === 0) return;
    setBuilt(true);
    setOpen(true);
  }, [asked]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!env || !/^[a-z][a-z-]{0,30}$/.test(page) || OWN_ANALYST.has(page)) return null;

  const carried = [focus.unitId ? "the unit you selected" : "", focus.signalId ? "the signal you opened" : ""].filter(Boolean);
  const hints = [
    "What is open right now, and where?",
    ...(focus.unitId ? ["What do this unit's live figures show, and how old are they?"] : []),
    ...(focus.signalId ? ["Where does this signal stand, and what is open at its unit?"] : []),
  ];

  return (
    <div className="pointer-events-none fixed bottom-8 right-4 z-40 flex flex-col items-end gap-2">
      {built ? (
        <div
          role="dialog"
          aria-label="Analyst"
          hidden={!open}
          // The `hidden` attribute alone does not hide it: a display class on the same element wins over it,
          // and the panel stayed on screen, over the page, after its cross was clicked.
          className={cn(
            "pointer-events-auto max-h-[72vh] w-[430px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-line bg-surface shadow-lg",
            open ? "flex" : "hidden",
          )}
        >
          <div className="flex items-start gap-2 border-b border-line-soft px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-ink">Analyst</p>
              <p className="text-[11px] text-ink-muted">
                Asked from this page{carried.length ? `, with ${carried.join(" and ")}` : ""}. It reads the network as it stands now.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the analyst"
              className="rounded p-0.5 text-ink-faint hover:bg-surface-hover hover:text-ink-body"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto">
            {off ? (
              <p className="p-3 text-[12px] text-ink-body">
                The analyst is not switched on for this server. An administrator has to set its key on the API service.
              </p>
            ) : (
              <AskTab
                env={env}
                scenario={null}
                run={null}
                live
                siteName={() => null}
                onFocusSite={() => {}}
                onOff={() => setOff(true)}
                focus={{ page, ...focus }}
                hints={hints}
              />
            )}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setBuilt(true);
          setOpen((o) => !o);
        }}
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold shadow-sm",
          open ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-surface text-ink hover:border-brand hover:bg-brand-soft",
        )}
      >
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /> Analyst
      </button>
    </div>
  );
}
