import { money } from "@/lib/money";
import { fetchTwinPrices, type TwinPriceAmount, type TwinPriceList, type TwinPriceRow } from "@/lib/platform-api";

/**
 * The twin's price list, as the ontology manager reads it.
 *
 * Nothing here knows a price. Every row, amount and reason comes from the
 * server, which reads them from the twin; this only finds the rows of a type
 * and writes an amount the way a person reads it.
 */

/**
 * A name as the server compares it: no capitals, no accents, words joined by
 * one underscore. A type called "Soins intensifs" is the activity
 * `soins_intensifs`, and a price row may name it either way.
 */
export const foldName = (s: string): string =>
  s
    .normalize("NFD")
    // The combining marks an accent decomposes into.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "_");

/** The rows that price a type's units: those whose activity is the type's name. Fastest mode first, as the server lists them. */
export function pricesOfType(list: TwinPriceList, typeName: string): TwinPriceRow[] {
  return list.rows.filter((r) => foldName(r.activity) === foldName(typeName));
}

/** An amount with its range: "1,250.50 $", or "800 $ (700 $ to 1,000 $)". */
export function amountText(a: TwinPriceAmount): string {
  return a.low === a.cents && a.high === a.cents ? money(a.cents) : `${money(a.cents)} (${money(a.low)} to ${money(a.high)})`;
}

/** The days a mode takes. Zero is a row that declares none, which is not the same as a promise of no delay. */
export const delayText = (days: number): string => (days === 0 ? "No delay declared" : `${days} day${days === 1 ? "" : "s"}`);

/** Where a row applies. */
export const placeText = (row: TwinPriceRow): string => (row.sites.length ? row.sites.map((s) => s.name).join(", ") : "Whole network");

/** What a row costs, in the words of a narrow panel: its amounts, or its formula. */
export function costText(row: TwinPriceRow): string {
  if (row.formula) return `by formula: ${row.formula}`;
  return [row.perUnitOpened ? `${amountText(row.perUnitOpened)} to open a unit` : null, row.perUnitDay ? `${amountText(row.perUnitDay)} a unit a day` : null]
    .filter(Boolean)
    .join(", ");
}

/** The rows priced by a formula. */
export const formulaRows = (list: TwinPriceList): TwinPriceRow[] => list.rows.filter((r) => r.formula !== null);

// One read serves the page and every type panel opened in the next minute: the
// price list is read through the whole twin, which is not a small read.
const KEEP_MS = 60_000;
const held = new Map<string, { at: number; list: Promise<TwinPriceList> }>();

/** The price list of an environment. `fresh` reads it again whatever is held. */
export function loadPriceList(env: string, fresh = false): Promise<TwinPriceList> {
  const hit = held.get(env);
  if (!fresh && hit && Date.now() - hit.at < KEEP_MS) return hit.list;
  const list = fetchTwinPrices(env);
  held.set(env, { at: Date.now(), list });
  // A read that failed is not kept: the next one asks again.
  list.catch(() => {
    if (held.get(env)?.list === list) held.delete(env);
  });
  return list;
}

/** Forget what is held, when the ontology changed under it. */
export function forgetPriceLists(): void {
  held.clear();
}
