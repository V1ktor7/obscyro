import { FUNCTION_NAMES } from "./analyst-calc.js";
import type { Mechanic } from "./property-schema.js";
import type { SimExport } from "./twin-export.js";

/**
 * The price list, read from the twin.
 *
 * Money is data the institution declares, like its care model: a type, under
 * whatever name it likes, whose properties are bound to the price mechanics
 * (`property-schema.ts`). One instance is one row: what a unit of an activity
 * costs to open and to keep open for a day, in one mode, with the days that
 * mode takes and where the price comes from.
 *
 * Nothing here is a price of ours. No amount is written in this code, no type
 * is recognised by its name, and a twin that declares no price has no price:
 * the catalogue is then empty and everything that reads it says so.
 *
 * Amounts are whole cents, as they are declared and as they are held: a sum is
 * never a floating-point number. An amount that is not a whole number of cents
 * is refused rather than rounded, because rounding a price is changing it.
 *
 * A price may be a range. Each amount can carry a low and a high end beside
 * it; a total is then read three times, low, likely and high, and never drawn
 * at random.
 *
 * A row linked to a site prices that site, and comes before the row that
 * prices the whole network.
 *
 * It is read from the export, so it is read through the same world as
 * everything else: a scenario that changes a price row with `set_property`
 * ("what if agency staff cost 20% more?") changes the catalogue of that
 * scenario, with nothing more to build.
 */

/** The name a row with no mode is listed under. A price list with one way of doing things names none. */
export const DEFAULT_MODE = "standard";

/** An amount in whole cents, with its low and high ends. Without a declared range the three are the same. */
export interface Amount {
  cents: number;
  low: number;
  high: number;
}

export interface PriceEntry {
  /** The price row's own id in the twin. */
  id: string;
  /** The type it is an instance of, as the institution named it. */
  type: string;
  /** The activity whose units it prices, as the twin names it. */
  activity: string;
  /** The mode this row is for; `DEFAULT_MODE` when the row names none. */
  mode: string;
  /** Days this mode takes before the units are available. Zero when the row declares none. */
  leadDays: number;
  /** One unit kept open one day; null when the row declares none. */
  perUnitDay: Amount | null;
  /** One unit opened, once; null when the row declares none. */
  perUnitOpened: Amount | null;
  /** A formula for the cost in cents, in place of the amounts; null when the row declares none. */
  formula: string | null;
  /** The row's own numbers, by lower-case property key: what its formula may name. */
  values: Record<string, number>;
  /** The sites this row prices, by unit id. Empty: the whole network. */
  sites: string[];
  /** Where the price comes from; null when the row does not say, which makes it a demo price. */
  source: string | null;
}

export interface PriceCatalogue {
  entries: PriceEntry[];
  /** Rows that could not be read as a price, each said in a sentence. They are not priced, and not silently dropped. */
  problems: string[];
}

type Bound = Partial<Record<Mechanic, string>>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const number = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Compared without regard to capitals, accents, surrounding space, or whether
 * words are held apart by a space or an underscore.
 *
 * An activity is a type's name as the engine writes it: "Soins intensifs"
 * travels as `soins_intensifs`. A person filling a price row writes the name
 * they know, so the two have to meet.
 */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "_");

/**
 * One amount of a row, with its range, or why it cannot be used.
 *
 * `null` when the row declares none. A low end above the price, or a high end
 * below it, is a row that contradicts itself: it is refused, not reordered.
 */
function amountOf(what: string, cents: unknown, low: unknown, high: unknown): Amount | null | { why: string } {
  const c = number(cents);
  const lo = number(low);
  const hi = number(high);
  if (c === null) {
    return lo !== null || hi !== null ? { why: `it gives a low or a high end for ${what} and no price between them` } : null;
  }
  for (const [name, v] of [["price", c], ["low end", lo], ["high end", hi]] as const) {
    if (v === null) continue;
    if (v < 0) return { why: `the ${name} for ${what} is negative (${v})` };
    if (!Number.isInteger(v)) return { why: `the ${name} for ${what} is not a whole number of cents (${v}): an amount is written in cents, 125050 for 1,250.50 $` };
  }
  if (lo !== null && lo > c) return { why: `the low end for ${what} (${lo}) is above its price (${c})` };
  if (hi !== null && hi < c) return { why: `the high end for ${what} (${hi}) is below its price (${c})` };
  return { cents: c, low: lo ?? c, high: hi ?? c };
}

/** The price rows the twin declares. Empty when no type binds `prices_activity`. */
export function catalogueOf(system: Pick<SimExport, "objects" | "object_types">): PriceCatalogue {
  // mechanic -> property key, per type. The schema is the only place property names are read.
  const bound = new Map<string, Bound>();
  for (const t of system.object_types) {
    const b: Bound = {};
    for (const p of t.properties) if (p.mechanic && !(p.mechanic in b)) b[p.mechanic] = p.key;
    if (b.prices_activity) bound.set(t.name, b);
  }
  const read: PriceEntry[] = [];
  const problems: string[] = [];
  if (bound.size === 0) return { entries: read, problems };

  for (const o of system.objects) {
    const b = bound.get(o.type);
    if (!b) continue;
    const at = (m: Mechanic) => (b[m] ? o.properties[b[m]!] : undefined);
    const activity = text(at("prices_activity"));
    // A row that names no activity prices nothing. Skipped, like a half-filled care protocol: a form in progress.
    if (!activity) continue;
    const mode = text(at("price_mode")) ?? DEFAULT_MODE;
    const sites = [...(o.priced_at ?? [])].sort();
    const row = `${o.type} “${activity}”${mode === DEFAULT_MODE ? "" : `, ${mode}`}${sites.length ? ", for one site" : ""}`;
    const refuse = (why: string) => void problems.push(`${row}: ${why}. It is not used.`);

    const perDay = amountOf("a unit kept open a day", at("price_per_unit_day"), at("price_per_unit_day_low"), at("price_per_unit_day_high"));
    if (perDay && "why" in perDay) {
      refuse(perDay.why);
      continue;
    }
    const perOpened = amountOf("opening a unit", at("price_per_unit_opened"), at("price_per_unit_opened_low"), at("price_per_unit_opened_high"));
    if (perOpened && "why" in perOpened) {
      refuse(perOpened.why);
      continue;
    }
    const formula = text(at("price_formula"));
    const lead = number(at("price_lead_days"));
    if (lead !== null && (lead < 0 || !Number.isInteger(lead))) {
      refuse(`the days its mode takes must be a whole number of days, zero or more (${lead})`);
      continue;
    }
    if (perDay === null && perOpened === null && !formula) {
      problems.push(`${row}: it declares no amount and no formula, so it prices nothing.`);
      continue;
    }
    // What a formula may name besides the operation's own quantities: every number the row carries.
    const values: Record<string, number> = {};
    for (const [key, v] of Object.entries(o.properties)) {
      if (typeof v === "number" && Number.isFinite(v)) values[key.toLowerCase()] = v;
    }
    read.push({
      id: o.id,
      type: o.type,
      activity,
      mode,
      leadDays: lead ?? 0,
      // A formula stands in place of the amounts: a row is priced one way.
      perUnitDay: formula ? null : perDay,
      perUnitOpened: formula ? null : perOpened,
      formula,
      values,
      sites,
      source: text(at("price_source")),
    });
  }

  // Two rows for one activity, one mode and one place: the ledger reads one price, and picking one would hide the other.
  const places = (e: PriceEntry) => (e.sites.length ? e.sites : [""]);
  const count = new Map<string, number>();
  for (const e of read) for (const s of places(e)) count.set(`${fold(e.activity)}\u0000${fold(e.mode)}\u0000${s}`, (count.get(`${fold(e.activity)}\u0000${fold(e.mode)}\u0000${s}`) ?? 0) + 1);
  const entries = read.filter((e) => {
    const twice = places(e).some((s) => (count.get(`${fold(e.activity)}\u0000${fold(e.mode)}\u0000${s}`) ?? 0) > 1);
    if (twice) {
      problems.push(
        `Two rows price “${e.activity}” in mode “${e.mode}”${e.sites.length ? " for the same site" : ""}. Neither is used until one is removed or given another mode.`,
      );
    }
    return !twice;
  });
  entries.sort((a, b) => a.activity.localeCompare(b.activity) || a.leadDays - b.leadDays || a.mode.localeCompare(b.mode) || a.id.localeCompare(b.id));
  return { entries, problems: [...new Set(problems)] };
}

/**
 * The rows that price an activity at a site, fastest first.
 *
 * The rows linked to that site when there are any, and only they: a site with
 * its own prices is priced by them. Otherwise the rows that price the whole
 * network. A row linked to another site prices nothing here.
 */
export function modesFor(catalogue: PriceCatalogue, activity: string, siteId: string | null = null): PriceEntry[] {
  const rows = catalogue.entries.filter((e) => fold(e.activity) === fold(activity));
  const own = siteId ? rows.filter((e) => e.sites.includes(siteId)) : [];
  const tier = own.length ? own : rows.filter((e) => e.sites.length === 0);
  return tier.sort((a, b) => a.leadDays - b.leadDays || a.mode.localeCompare(b.mode));
}

export type PriceChoice =
  /** The catalogue holds no price for this activity here: the change is unpriced, and carries no mode. */
  | { priced: false }
  | { priced: true; entry: PriceEntry }
  /** A mode has to be named, or the one named is not in the catalogue. `why` says what can be asked. */
  | { priced: null; why: string };

const modeLine = (e: PriceEntry) => `“${e.mode}” (${e.leadDays === 0 ? "available at once" : `${e.leadDays} day${e.leadDays === 1 ? "" : "s"}`})`;

/**
 * The price row for an activity at a site, in a mode.
 *
 * With one mode in the catalogue, that is the row whatever is asked or left
 * out. With several, the mode has to be named: choosing the cheap one or the
 * fast one for somebody would be deciding what the comparison is about.
 */
export function priceFor(catalogue: PriceCatalogue, activity: string, mode: string | null | undefined, siteId: string | null = null): PriceChoice {
  const modes = modesFor(catalogue, activity, siteId);
  if (modes.length === 0) return { priced: false };
  if (mode) {
    const hit = modes.find((e) => fold(e.mode) === fold(mode));
    if (hit) return { priced: true, entry: hit };
    return { priced: null, why: `The price list has no mode “${mode}” for ${activity}. Its modes are: ${modes.map(modeLine).join(", ")}.` };
  }
  if (modes.length === 1) return { priced: true, entry: modes[0]! };
  return { priced: null, why: `The price list prices ${activity} in ${modes.length} modes: ${modes.map(modeLine).join(", ")}. Say which one this change uses (mode).` };
}

/**
 * The quantities of an operation a cost formula may name, by kind of operation.
 *
 * A fixed list. Capacity an option opens is the one operation priced today, so
 * it is the only kind here; a transfer will bring its own (`patients`,
 * `distance_km`) the day a transfer is an operation the ledger prices.
 */
export const OPERATION_NAMES = { capacity: ["units", "days"] } as const;

export interface PriceListRow {
  id: string;
  type: string;
  activity: string;
  mode: string;
  leadDays: number;
  perUnitOpened: Amount | null;
  perUnitDay: Amount | null;
  /** A formula for the cost in cents, in place of the amounts. */
  formula: string | null;
  /**
   * What the formula may name: the row's own numbers with their values, then
   * the quantities of the operation, which have a value only when a change is
   * priced. Empty for a row priced by amounts.
   */
  canName: { name: string; value: number | null; of: "row" | "operation" }[];
  /** The sites the row prices. Empty: the whole network. */
  sites: { id: string; name: string }[];
  source: string | null;
  /** True when the row names no source. */
  demo: boolean;
}

/** The price list as a person reads it in the ontology: every row, where it applies, and the rows that could not be used. */
export interface PriceList {
  /** The types whose properties are bound to the price mechanics, as the organisation named them. Empty: no price list is declared. */
  types: string[];
  rows: PriceListRow[];
  problems: string[];
  /** What any cost formula can be written with: the functions it may call, and the quantities of the operation it may name. */
  formulas: { functions: string[]; operation: string[] };
}

export function priceListOf(system: Pick<SimExport, "objects" | "object_types" | "facilities">): PriceList {
  const cat = catalogueOf(system);
  const siteName = new Map(system.facilities.map((f) => [f.id, f.name]));
  const operation = new Set<string>(OPERATION_NAMES.capacity);
  return {
    types: system.object_types.filter((t) => t.properties.some((p) => p.mechanic === "prices_activity")).map((t) => t.name).sort(),
    rows: cat.entries.map((e) => ({
      id: e.id,
      type: e.type,
      activity: e.activity,
      mode: e.mode,
      leadDays: e.leadDays,
      perUnitOpened: e.perUnitOpened,
      perUnitDay: e.perUnitDay,
      formula: e.formula,
      canName: e.formula
        ? [
            // A row's number called like a quantity of the operation is shadowed by it: listed once, as the operation's.
            ...Object.entries(e.values)
              .filter(([name]) => !operation.has(name))
              .map(([name, value]) => ({ name, value, of: "row" as const })),
            ...OPERATION_NAMES.capacity.map((name) => ({ name, value: null, of: "operation" as const })),
          ]
        : [],
      sites: e.sites.map((id) => ({ id, name: siteName.get(id) ?? id })),
      source: e.source,
      demo: e.source === null,
    })),
    problems: cat.problems,
    formulas: { functions: [...FUNCTION_NAMES], operation: [...OPERATION_NAMES.capacity] },
  };
}
