"use client";

/**
 * What the analyst can use.
 *
 * The analyst holds no fact about the network: everything it says comes from a
 * tool. Until now the list of those tools was nowhere on screen, and a person
 * learned what the analyst could read by opening the trace of an answer.
 *
 * This lists them, grouped by what they read, each with a sentence, what it is
 * given, and where it comes from: written in the code, or declared in this
 * project. A tool the project switched off is shown as off, because "it could
 * and was told not to" is not the same as "it cannot".
 *
 * It reads and shows. Switching a tool off is done under Ontology, Action
 * types, and a project declares its own reading tools under Ontology,
 * Functions; nothing here writes.
 */

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError } from "@/lib/auth";
import { cn } from "@/lib/cn";

import { fetchAnalystTools, type AnalystToolLine } from "../../analyst-api";
import { LABEL } from "./analyst-parts";

const DOES: Record<string, { label: string; className: string }> = {
  reads: { label: "Reads", className: "bg-ok-soft text-ok-ink" },
  computes: { label: "Computes", className: "bg-ok-soft text-ok-ink" },
  runs: { label: "Runs the engine", className: "bg-scenario-soft text-scenario" },
  searches: { label: "Searches", className: "bg-brand-soft text-brand-deep" },
};
const WHERE: Record<string, string> = { ask: "Ask", options: "Options", events: "Event finder", investigate: "Investigate" };

/** The tools under their headings, in the order the first tool of each heading arrives. */
export function grouped(tools: readonly AnalystToolLine[]): { group: string; tools: AnalystToolLine[] }[] {
  const out: { group: string; tools: AnalystToolLine[] }[] = [];
  for (const t of tools) {
    const held = out.find((g) => g.group === t.group);
    if (held) held.tools.push(t);
    else out.push({ group: t.group, tools: [t] });
  }
  return out;
}

export default function ToolsTab({
  env,
  offeredIn,
  wide = false,
  refresh = 0,
}: {
  env: string;
  /** The exchanges of the panel this tab sits in: a tool offered in none of them is said to be elsewhere. */
  offeredIn?: AnalystToolLine["where"];
  /** On a page of its own rather than in a panel on a map. */
  wide?: boolean;
  /** Read the list again when this changes: a tool was declared or switched beside it. */
  refresh?: number;
}) {
  const [tools, setTools] = useState<AnalystToolLine[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setProblem(null);
    fetchAnalystTools(env).then(
      (r) => live && setTools(r.tools),
      (e: unknown) => live && setProblem(e instanceof ApiError ? e.message : "The list could not be read. Check the connection and open the tab again."),
    );
    return () => {
      live = false;
    };
  }, [env, refresh]);

  if (problem) {
    return (
      <p role="alert" className="m-3 rounded bg-danger-soft px-2 py-1.5 text-[12px] text-danger-ink">
        {problem}
      </p>
    );
  }
  if (!tools) return <p className="p-3 text-[12px] text-ink-muted">Reading what the analyst can use…</p>;

  const off = tools.filter((t) => !t.on).length;
  const declared = tools.filter((t) => t.origin === "project").length;

  return (
    <div className={cn("flex flex-col gap-3", wide ? "max-w-5xl text-xs" : "p-3")}>
      <p className={cn("leading-snug text-ink-muted", wide ? "text-xs" : "text-[11.5px]")}>
        The analyst knows nothing of this network until a tool reads it. These are its tools: {tools.length} in all
        {declared ? `, ${declared} declared in this project` : ""}
        {off ? `, ${off} switched off in this project` : ""}. A figure no tool returned is taken out of its answers.
      </p>

      {grouped(tools).map((g) => (
        <section key={g.group} aria-label={g.group} className="flex flex-col gap-1">
          <span className={LABEL}>{g.group}</span>
          <ul className="flex flex-col gap-1">
            {g.tools.map((t) => {
              const does = DOES[t.does] ?? DOES.reads!;
              const here = !offeredIn || t.where.some((w) => offeredIn.includes(w));
              const isOpen = open === t.name;
              return (
                <li key={t.name} aria-label={t.name} className={cn("rounded-md border", isOpen ? "border-brand bg-surface" : "border-line-soft bg-canvas-raised", !t.on && "opacity-70")}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : t.name)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-2 py-1.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <code className="text-[11.5px] font-semibold text-ink">{t.name}</code>
                        <span className={cn("rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wide", does.className)}>{does.label}</span>
                        {t.origin === "project" ? (
                          <span className="rounded bg-brand-soft px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-brand-deep">Declared here</span>
                        ) : null}
                        {!t.on ? <span className="rounded bg-warn-soft px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-warn-ink">Switched off</span> : null}
                      </span>
                      <span className="block text-[11.5px] leading-snug text-ink-body">{t.reads}</span>
                      {!here ? (
                        <span className="block text-[10.5px] text-ink-faint">Not offered in this panel: it is used in {t.where.map((w) => WHERE[w] ?? w).join(" and ")}.</span>
                      ) : null}
                    </span>
                    <ChevronRight className={cn("mt-0.5 h-3 w-3 shrink-0 text-ink-muted transition-transform", isOpen && "rotate-90")} aria-hidden="true" />
                  </button>
                  {isOpen ? (
                    <div className="flex flex-col gap-1.5 border-t border-line-soft px-2 py-2 text-[11.5px]">
                      <p className="text-ink-muted">
                        Offered in {t.where.map((w) => WHERE[w] ?? w).join(", ")}. {t.origin === "code" ? "Written in the code, and tested there." : "Declared in this project, from the Studio."}
                      </p>
                      {t.inputs.length ? (
                        <>
                          <span className={LABEL}>What it is given</span>
                          <ul className="flex flex-col gap-1">
                            {t.inputs.map((i) => (
                              <li key={i.name}>
                                <code className="font-semibold text-ink">{i.name}</code>
                                <span className="text-ink-faint">
                                  {" "}
                                  · {i.kind}
                                  {i.required ? " · required" : ""}
                                </span>
                                {i.says ? <span className="block leading-snug text-ink-muted">{i.says}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="text-ink-muted">It is given nothing: it reads what is open.</p>
                      )}
                      {/* A tool of the code that cannot be switched is always on; a declared one has its switch elsewhere. */}
                      {t.why ? <p className="text-ink-faint">{t.origin === "project" ? t.why : `Always on. ${t.why}`}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="flex flex-col gap-1">
        <span className={LABEL}>What it never does</span>
        <ul className={cn("flex list-disc flex-col gap-0.5 pl-4 text-ink-body", wide ? "text-xs" : "text-[11.5px]")}>
          <li>It writes nothing: an option, an event or a decision exists when a person clicks.</li>
          <li>It does not compute in its head: a derived figure comes from the calculation tool.</li>
          <li>It reads counts and capacities, never anything about a person.</li>
        </ul>
      </div>

      <p className={cn("leading-snug text-ink-faint", wide ? "text-[11px]" : "text-[10.5px]")}>
        A tool is switched off for this project under Ontology, Action types. What the analyst may propose is set there too. A reading tool
        of the project&apos;s own is declared under Ontology, Functions.
      </p>
    </div>
  );
}
