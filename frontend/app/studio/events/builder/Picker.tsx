"use client";

/**
 * Add a change: everything this twin lets an event touch, searchable. The
 * rows come from the twin itself: its territories, its resources, its object
 * types and the properties they declare. Exposures come from the published
 * coefficients the helper knows.
 */

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SimExport } from "@/lib/platform-api";
import { EXP_GROUPS, EXPOSURES, expHint } from "./exposures";
import { fmt } from "./format";
import { MECHANIC } from "./EffectEditor";
import type { BuilderTwin } from "./twin";
import { BTN_SM, HELP, Rich } from "./ui";

export type Pick =
  | { kind: "incidence" | "volume" }
  | { kind: "capacity"; arg: string }
  | { kind: "object"; arg: [string, string] }
  | { kind: "exposure"; arg: string };

interface RowDef { pick: Pick | null; title: string; hint: string; text: string }

export default function Picker({ tw, snapshot, onPick, onClose }: { tw: BuilderTwin; snapshot: SimExport; onPick: (p: Pick) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const row = (pick: Pick | null, title: string, hint: string, kw = ""): RowDef => ({ pick, title, hint, text: `${title} ${hint} ${kw}`.toLowerCase() });
  const groups: [string, RowDef[]][] = [
    ["Patients arriving", [
      row({ kind: "incidence" }, "More or fewer arrivals, by population", `per 1,000 residents · ${fmt(tw.pops.length)} territories`),
      row({ kind: "volume" }, "A flat number of arrivals", "the same count whatever the population"),
    ]],
    ...EXP_GROUPS.map((g): [string, RowDef[]] => [`Exposure · ${g}`, EXPOSURES.filter((c) => c.group === g).map((c) => row({ kind: "exposure", arg: c.key }, c.short, expHint(c), `${c.agent} ${c.outcome} ${c.kw ?? ""}`))]),
    ["What a site has", [
      ...tw.activities.map((a) => row({ kind: "capacity", arg: a.id }, `Capacity of \`${a.id}\``, `${fmt(a.total)} units at ${fmt(a.sites)} sites`)),
      row({ kind: "capacity", arg: "" }, "Capacity of everything a site has", `${fmt(tw.sites.length)} sites`),
    ]],
    ["Routes between sites", [snapshot.edges?.length
      ? row(null, "Throughput of a route", "Routes are cut or widened from the Network view for now.")
      : row(null, "Throughput of a route", "This twin declares no route between sites, so there is nothing to cut or widen.")]],
    ...tw.types.map((T): [string, RowDef[]] => [`Your objects · ${T.name} · ${fmt(T.n)}`, T.props.map((p) => {
      if (p.mechanic === "scales_incidence") return row(null, `\`${p.key}\``, "Sets the size of a territory. The engine reads it once, when a run starts, so an event cannot change it. Write arrivals instead.");
      const what = p.behaviour === "state" ? "switch between values" : p.behaviour ? `raise, lower or set${p.unit ? " · " + p.unit : ""}` : "can only be set: no behaviour declared";
      return row({ kind: "object", arg: [T.name, p.key] }, `\`${p.key}\``, p.mechanic && MECHANIC[p.mechanic] ? `${what} · ${MECHANIC[p.mechanic]}` : what);
    })]),
  ];
  const needle = q.trim().toLowerCase();
  const shown = groups.map(([title, rows]) => [title, rows.filter((r) => !needle || r.text.includes(needle) || title.toLowerCase().includes(needle))] as const).filter(([, rows]) => rows.length);

  return (
    <div className="rounded-md border border-brand bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 text-ink-faint" />
        <input ref={input} type="search" value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Escape") onClose(); }}
          aria-label="What changes?" placeholder="What changes? Try: arrivals, smoke, ozone, heat, water, status, capacity"
          className="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none" />
        <button type="button" className={BTN_SM} onClick={onClose}>Cancel</button>
      </div>
      <div className="max-h-[360px] overflow-y-auto p-1.5">
        {shown.length ? shown.map(([title, rows]) => (
          <div key={title} className="mb-1.5">
            <h4 className="px-1.5 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">{title}</h4>
            {rows.map((r, k) => r.pick ? (
              <button key={k} type="button" onClick={() => onPick(r.pick!)} className="flex w-full flex-col items-start rounded px-1.5 py-1 text-left hover:bg-brand-soft">
                <b className="text-xs font-medium text-ink"><Rich text={r.title} /></b>
                <span className="text-[11px] text-ink-muted">{r.hint}</span>
              </button>
            ) : (
              <div key={k} className="flex w-full flex-col items-start px-1.5 py-1 opacity-60">
                <b className="text-xs font-medium text-ink-muted"><Rich text={r.title} /></b>
                <span className="text-[11px] text-ink-faint">{r.hint}</span>
              </div>
            ))}
          </div>
        )) : <p className={HELP}>Nothing in this twin matches “{q}”.</p>}
      </div>
    </div>
  );
}
