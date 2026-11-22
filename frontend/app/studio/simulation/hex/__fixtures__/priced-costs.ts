import type { CostLedger, LedgerLine, OptionCost } from "../../../analyst-api";

/**
 * Costs as the server gives them when the twin declares a price list, for the
 * tests of the cards that show them. Every amount is in whole cents and every
 * total is the sum of its lines, worked out by hand in the comments.
 */

const line = (over: Partial<LedgerLine> & Pick<LedgerLine, "category" | "cents" | "says" | "price">): LedgerLine => ({
  stamp: 0,
  siteId: "f:lake",
  site: "Lakeshore",
  activity: "lit",
  fromDay: 0,
  toDay: 0,
  units: 40,
  days: 1,
  lowCents: over.cents,
  highCents: over.cents,
  ...over,
});

const RUSH_ROW = { id: "p-rush", type: "Tarif", mode: "rush", ofSite: false, formula: null, values: null, source: null, demo: true };

/**
 * 40 units from day 3 of a 60-day run, mode “rush” (3 days), no source:
 * 40 × 2,500 $ to open = 100,000 $, then 40 × 57 days × 1,250.50 $ = 2,851,140 $.
 */
export const RUSH_LEDGER: CostLedger = {
  lines: [
    line({
      category: "opening",
      fromDay: 3,
      toDay: 3,
      days: 57,
      price: { ...RUSH_ROW, unit: { cents: 250000, low: 250000, high: 250000 } },
      cents: 10_000_000,
      says: "40 units × 2,500 $ to open = 100,000 $",
    }),
    line({
      category: "running",
      fromDay: 3,
      toDay: 59,
      days: 57,
      price: { ...RUSH_ROW, unit: { cents: 125050, low: 125050, high: 125050 } },
      cents: 285_114_000,
      says: "40 units × 57 days × 1,250.50 $ a day = 2,851,140 $",
    }),
  ],
  totalCents: 295_114_000,
  lowCents: 295_114_000,
  highCents: 295_114_000,
  ranged: false,
  byCategory: { opening: 10_000_000, running: 285_114_000, formula: 0 },
  demo: true,
  unpriced: [],
  availability: [{ stamp: 0, site: "Lakeshore", activity: "lit", mode: "rush", leadDays: 3, fromDay: 3 }],
};

export const RUSH_COST: OptionCost = {
  counted: 2_951_140,
  complete: true,
  says: "The price list gives 2,951,140 $ for the capacity this option opens: opening it, then keeping it open for the days of the run. At least one of these prices has no source: it is a demo price.",
  priced: RUSH_LEDGER,
};

/**
 * The same 40 units in mode “normal” (14 days), at Lakeshore's own price, with a
 * source and a range: 40 × 46 days × 800 $ = 1,472,000 $, between 700 $ a day
 * (1,288,000 $) and 1,000 $ a day (1,840,000 $).
 */
export const NORMAL_LEDGER: CostLedger = {
  lines: [
    line({
      category: "running",
      fromDay: 14,
      toDay: 59,
      days: 46,
      price: { id: "p-normal", type: "Tarif", mode: "normal", ofSite: true, unit: { cents: 80000, low: 70000, high: 100000 }, formula: null, values: null, source: "Rate card 2026", demo: false },
      cents: 147_200_000,
      lowCents: 128_800_000,
      highCents: 184_000_000,
      says: "40 units × 46 days × 800 $ a day = 1,472,000 $ (between 1,288,000 $ and 1,840,000 $)",
    }),
  ],
  totalCents: 147_200_000,
  lowCents: 128_800_000,
  highCents: 184_000_000,
  ranged: true,
  byCategory: { opening: 0, running: 147_200_000, formula: 0 },
  demo: false,
  unpriced: [],
  availability: [{ stamp: 0, site: "Lakeshore", activity: "lit", mode: "normal", leadDays: 14, fromDay: 14 }],
};

export const NORMAL_COST: OptionCost = {
  counted: 1_472_000,
  complete: true,
  says: "The price list gives 1,472,000 $, between 1,288,000 $ and 1,840,000 $ for the capacity this option opens: opening it, then keeping it open for the days of the run.",
  priced: NORMAL_LEDGER,
};

/** The twin has a price list, and it holds nothing for what this option opens. */
export const UNPRICED_COST: OptionCost = {
  counted: null,
  complete: false,
  says: "No cost is counted for this run: the twin’s price list prices nothing this option changes. That is unpriced, not free.",
  priced: {
    lines: [],
    totalCents: 0,
    lowCents: 0,
    highCents: 0,
    ranged: false,
    byCategory: { opening: 0, running: 0, formula: 0 },
    demo: false,
    unpriced: [{ stamp: 0, why: "The price list holds no price for civière at Nord." }],
    availability: [],
  },
};

/** A price row whose formula names a value nobody typed: no price, and the reason names what is missing. */
export const MISSING_VALUE_COST: OptionCost = {
  ...UNPRICED_COST,
  priced: {
    ...UNPRICED_COST.priced!,
    unpriced: [
      {
        stamp: 0,
        why: 'The formula of Tarif, standard gives no price: Unknown name "distance_km". This formula can name: places, frais_fixe, prix_par_km, units, days. Functions: abs, sqrt, floor, ceil, round, min, max, sum, mean. The formula is: ceil(units / places) * (frais_fixe + prix_par_km * distance_km)',
      },
    ],
  },
};
