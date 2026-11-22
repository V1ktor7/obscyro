"use client";

/**
 * The twin's price list, where the ontology is managed.
 *
 * Two readings of the same list. The Functions page shows it whole: the cost
 * formulas with what each may name, every price row, and the rows that could
 * not be used. A type's panel shows only the rows that price that type's units.
 *
 * A price is an object of the twin: it is created and corrected under
 * Instances, like any other object. Nothing is edited here, and nothing here
 * knows a price: every amount is in whole cents, read from the twin by the
 * server.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import type { TwinPriceList, TwinPriceRow } from "@/lib/platform-api";

import { amountText, costText, delayText, formulaRows, loadPriceList, placeText, pricesOfType } from "./price-list";

type Read = { state: "loading" } | { state: "failed"; why: string } | { state: "read"; list: TwinPriceList };

function usePriceList(env: string | null): { read: Read; reload: () => void } {
  const [read, setRead] = useState<Read>({ state: "loading" });
  const load = useCallback(
    (fresh: boolean) => {
      if (!env) return;
      let stale = false;
      setRead({ state: "loading" });
      loadPriceList(env, fresh).then(
        (list) => {
          if (!stale) setRead({ state: "read", list });
        },
        (e: unknown) => {
          if (!stale) setRead({ state: "failed", why: e instanceof Error ? e.message : String(e) });
        },
      );
      return () => {
        stale = true;
      };
    },
    [env],
  );
  useEffect(() => load(false), [load]);
  return { read, reload: () => void load(true) };
}

/** A row with no source is a demo price, and says so wherever it is shown. */
function Source({ row }: { row: TwinPriceRow }) {
  return row.demo ? (
    <span
      title="This row names no source. It is a demo price, not what the institution pays."
      className="rounded bg-warn-soft px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-warn-ink"
    >
      demo price
    </span>
  ) : (
    <span className="text-ink-body">{row.source}</span>
  );
}

const TH = "border-b border-line px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint";
const TD = "border-b border-line-soft px-3 py-2 align-top";
const H3 = "text-[12px] font-semibold text-ink";

/** The Functions page: the cost formulas the ontology declares, and the price list they belong to. */
export function PriceListPage({ env }: { env: string | null }) {
  const { read, reload } = usePriceList(env);
  if (!env) return <p className="text-xs text-ink-muted">Open an environment to read its price list.</p>;
  if (read.state === "loading") return <p className="text-xs text-ink-muted">Reading the price list…</p>;
  if (read.state === "failed") {
    return (
      <p role="alert" className="rounded bg-danger-soft px-2 py-1.5 text-xs text-danger-ink">
        The price list could not be read: {read.why}
      </p>
    );
  }
  const { list } = read;
  const formulas = formulaRows(list);
  return (
    <div className="flex max-w-5xl flex-col gap-5 text-xs text-ink-body">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 leading-relaxed text-ink-muted">
          A function is a cost formula: a price written as a calculation in place of an amount. It belongs to a price row of the twin, and it
          is evaluated, never run as code. Prices are objects of the ontology: they are created and corrected under Instances, and a property
          becomes part of the price list when it is bound to a price mechanic on its type. Amounts are whole cents.
        </p>
        <button
          type="button"
          onClick={reload}
          className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-body hover:border-brand"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Read again
        </button>
      </div>

      {list.types.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-ghost bg-surface p-4 leading-relaxed text-ink-muted">
          <p className="font-semibold text-ink">This twin declares no price list.</p>
          <p className="mt-1">
            Nothing has a price until the organisation gives one: no option is costed, and nothing is called free. To declare a price list,
            create an object type under any name, bind one of its properties to “Price list: names the activity this row prices”, and bind the
            others to the amounts, the mode, its delay and the source. Each instance of that type is then one price row.
          </p>
        </div>
      ) : (
        <p className="text-ink-muted">
          Read from {list.types.length === 1 ? "the type" : "the types"}{" "}
          <span className="text-ink-body">{list.types.map((t) => `“${t}”`).join(", ")}</span>: {list.rows.length} price row
          {list.rows.length === 1 ? "" : "s"} in use{list.problems.length ? `, ${list.problems.length} set aside` : ""}.
        </p>
      )}

      {list.types.length ? (
        <section aria-label="Cost formulas" className="flex flex-col gap-2">
          <h3 className={H3}>Cost formulas</h3>
          {formulas.length === 0 ? (
            <p className="text-ink-muted">No price row is priced by a formula: every price here is an amount.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {formulas.map((r) => (
                <li key={r.id} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-ink">{r.activity}</span>
                    <span className="text-ink-muted">
                      mode “{r.mode}” · {placeText(r)} · row of “{r.type}”
                    </span>
                    <Source row={r} />
                  </span>
                  <code className="rounded bg-sunk px-2 py-1 font-mono text-[11.5px] text-ink">{r.formula}</code>
                  <span className="flex flex-wrap items-center gap-1.5 text-ink-muted">
                    It can name
                    {r.canName.map((n) => (
                      <span
                        key={n.name}
                        title={n.of === "row" ? "A number of this price row." : "A quantity of the operation being priced."}
                        className={cn("rounded border px-1.5 py-px font-mono text-[10.5px]", n.of === "row" ? "border-line text-ink-body" : "border-brand-soft text-brand-deep")}
                      >
                        {n.value === null ? n.name : `${n.name} = ${n.value.toLocaleString("en-CA")}`}
                      </span>
                    ))}
                  </span>
                  <span className="text-ink-muted">Gives a cost in cents, rounded once to the whole cent. A name it cannot find gives no price, never a zero.</span>
                </li>
              ))}
            </ul>
          )}
          <p className="leading-relaxed text-ink-faint">
            A formula is written with numbers, + − × ÷, parentheses, and the functions {list.formulas.functions.join(", ")}. It may name the numbers
            of its own price row, and the quantities of the operation it prices: {list.formulas.operation.join(" and ")} for capacity an option
            opens. Capacity is the one operation priced today: a formula for a transfer has nothing to price until a transfer is an option that
            can be tested with a price.
          </p>
        </section>
      ) : null}

      {list.rows.length ? (
        <section aria-label="Price list" className="flex flex-col gap-2">
          <h3 className={H3}>Price list</h3>
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr>
                  <th className={TH}>Activity</th>
                  <th className={TH}>Mode</th>
                  <th className={TH}>Takes</th>
                  <th className={cn(TH, "text-right")}>To open one unit</th>
                  <th className={cn(TH, "text-right")}>One unit, one day</th>
                  <th className={TH}>For</th>
                  <th className={TH}>Source</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id}>
                    <td className={cn(TD, "font-medium text-ink")}>{r.activity}</td>
                    <td className={TD}>{r.mode}</td>
                    <td className={cn(TD, "tabular-nums")}>{delayText(r.leadDays)}</td>
                    {r.formula ? (
                      <td className={cn(TD, "text-ink-muted")} colSpan={2}>
                        By formula, above
                      </td>
                    ) : (
                      <>
                        <td className={cn(TD, "text-right tabular-nums")}>{r.perUnitOpened ? amountText(r.perUnitOpened) : "—"}</td>
                        <td className={cn(TD, "text-right tabular-nums")}>{r.perUnitDay ? amountText(r.perUnitDay) : "—"}</td>
                      </>
                    )}
                    <td className={TD}>{placeText(r)}</td>
                    <td className={TD}>
                      <Source row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="leading-relaxed text-ink-faint">
            A site with a price of its own is priced by it, and not by the price of the whole network. An amount in brackets is the range the row
            declares: a cost is then read three times, low, likely and high. The list says what opening a unit and keeping it open costs; it
            says nothing of what the network costs to run, of staff or of stocks.
          </p>
        </section>
      ) : null}

      {list.problems.length ? (
        <section aria-label="Rows not used" className="flex flex-col gap-2">
          <h3 className={H3}>Rows not used</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-warn-ink">
            {list.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** In a type's panel: the rows of the price list that price this type's units. */
export function TypePrices({ env, typeName }: { env: string; typeName: string }) {
  const { read } = usePriceList(env);
  if (read.state === "loading") return <p className="text-[11px] text-ink-faint">Reading the price list…</p>;
  if (read.state === "failed") return <p className="text-[11px] text-danger-ink">The price list could not be read: {read.why}</p>;
  const { list } = read;
  if (list.types.includes(typeName)) {
    return (
      <p className="text-[11px] leading-snug text-ink-muted">
        This type is a price list: each of its instances is one price row. The rows in use, and those set aside, are under Functions.
      </p>
    );
  }
  if (list.types.length === 0) return <p className="text-[11px] leading-snug text-ink-faint">The twin declares no price list, so a unit of this type has no price.</p>;
  const rows = pricesOfType(list, typeName);
  if (rows.length === 0) {
    return <p className="text-[11px] leading-snug text-ink-faint">The price list holds no price for this type. Opening its units is unpriced, not free.</p>;
  }
  return (
    <ul aria-label={`Prices of ${typeName}`} className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5 rounded-md border border-line-soft px-2 py-1.5 text-[11px] leading-snug text-ink-body">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-semibold text-ink">Mode “{r.mode}”</span>
            <span className="text-ink-muted">
              {delayText(r.leadDays).toLowerCase()} · {r.sites.length ? placeText(r) : "whole network"}
            </span>
          </span>
          <span className="tabular-nums">{costText(r)}</span>
          <span className="text-ink-muted">{r.demo ? <Source row={r} /> : <>Source: {r.source}</>}</span>
        </li>
      ))}
    </ul>
  );
}
