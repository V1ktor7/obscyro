import assert from "node:assert/strict";
import { test } from "node:test";

import { CalcError, evaluate } from "./analyst-calc.js";
import { formatCents, ledgerOf, linesOf, type PricedChange } from "./cost-ledger.js";
import { catalogueOf, fold, modesFor, priceFor, priceListOf, type PriceCatalogue } from "./price-catalogue.js";
import { PRICE_MECHANICS } from "./property-schema.js";
import { bindsAnyMechanic, type SimExport } from "./twin-export.js";

// ---------------------------------------------------------------------------
// Prices, formulas and the ledger.
//
// What is held here: a price is whatever the institution declared and nothing
// else; an amount is whole cents, from the row to the total; and where there is
// no price there is no figure, never a zero.
// ---------------------------------------------------------------------------

type Twin = Pick<SimExport, "objects" | "object_types">;
const prop = (key: string, mechanic: string | null = null) => ({ key, type: "number", label: null, unit: null, min: null, max: null, behaviour: null, mechanic }) as unknown as Twin["object_types"][number]["properties"][number];

/** A price list as an institution would declare it, in its own words: nothing here is a name the platform knows. */
const TARIF = {
  name: "Tarif",
  role: null,
  properties: [
    prop("activite", "prices_activity"),
    prop("par_jour", "price_per_unit_day"),
    prop("par_jour_bas", "price_per_unit_day_low"),
    prop("par_jour_haut", "price_per_unit_day_high"),
    prop("ouverture", "price_per_unit_opened"),
    prop("ouverture_bas", "price_per_unit_opened_low"),
    prop("ouverture_haut", "price_per_unit_opened_high"),
    prop("mode", "price_mode"),
    prop("delai_jours", "price_lead_days"),
    prop("source", "price_source"),
    prop("formule", "price_formula"),
    prop("note"),
  ],
} as Twin["object_types"][number];

const row = (id: string, properties: Record<string, unknown>, sites?: string[]) =>
  ({ id, type: "Tarif", role: null, properties, at: null, ...(sites ? { priced_at: sites } : {}) }) as Twin["objects"][number];
const twin = (...objects: Twin["objects"]): Twin => ({ objects, object_types: [TARIF] });

// Amounts are whole cents: 1,250.50 $ a day is 125050.
const NORMAL = row("p-normal", { activite: "Lits de soins intensifs", par_jour: 125050, ouverture: 250000, mode: "normal", delai_jours: 14, source: "Grille tarifaire 2026, p. 12" });
const RUSH = row("p-rush", { activite: "Lits de soins intensifs", par_jour: 210000, ouverture: 600000, mode: "accéléré", delai_jours: 3 });

const change = (over: Partial<PricedChange> = {}): PricedChange => ({ stamp: 0, siteId: "f1", siteName: "Hôpital du Lakeshore", activity: "Lits de soins intensifs", units: 60, start: 14, days: 16, mode: "normal", ...over });

// --- the price list -------------------------------------------------------------

test("a twin that declares no price has no price", () => {
  assert.deepEqual(catalogueOf({ objects: [NORMAL], object_types: [] }), { entries: [], problems: [] });
  // A type that binds nothing of a price list is not one, whatever it is called.
  const named = { ...TARIF, name: "Prices", properties: [prop("activity"), prop("price")] } as Twin["object_types"][number];
  assert.deepEqual(catalogueOf({ objects: [{ ...row("x", { activity: "Beds", price: 100 }), type: "Prices" }], object_types: [named] }).entries, []);
});

test("a price list is not a care model: declaring what a bed costs does not say what an admission does", () => {
  assert.equal(bindsAnyMechanic([TARIF]), false);
  assert.equal(bindsAnyMechanic([TARIF, { properties: [{ mechanic: "serves_severity" }] }]), true);
  assert.equal(PRICE_MECHANICS.has("prices_activity"), true);
  assert.equal(PRICE_MECHANICS.has("serves_severity"), false);
});

test("a price row is read as the institution declared it, in whole cents", () => {
  const { entries, problems } = catalogueOf(twin(NORMAL, RUSH));
  assert.deepEqual(problems, []);
  // Fastest first.
  assert.deepEqual(entries.map((e) => [e.mode, e.leadDays]), [["accéléré", 3], ["normal", 14]]);
  const normal = entries[1]!;
  assert.deepEqual(
    { ...normal, values: undefined },
    {
      id: "p-normal",
      type: "Tarif",
      activity: "Lits de soins intensifs",
      mode: "normal",
      leadDays: 14,
      // No range declared: the low and the high are the price itself.
      perUnitDay: { cents: 125050, low: 125050, high: 125050 },
      perUnitOpened: { cents: 250000, low: 250000, high: 250000 },
      formula: null,
      values: undefined,
      // Linked to no site: it prices the whole network.
      sites: [],
      source: "Grille tarifaire 2026, p. 12",
    },
  );
  // No source: a demo price, and it says so wherever it is used.
  assert.equal(entries[0]!.source, null);
});

test("a row with one way of doing things names no mode and takes no time", () => {
  const { entries } = catalogueOf(twin(row("p", { activite: "Civières", par_jour: 40000 })));
  assert.deepEqual([entries[0]!.mode, entries[0]!.leadDays, entries[0]!.perUnitOpened], ["standard", 0, null]);
});

test("an amount is whole cents: one that is not is refused, never rounded", () => {
  const { entries, problems } = catalogueOf(twin(row("dollars", { activite: "Lits", par_jour: 1250.5 }), row("negative", { activite: "Civières", ouverture: -5 })));
  assert.deepEqual(entries, []);
  assert.deepEqual(problems, [
    "Tarif “Lits”: the price for a unit kept open a day is not a whole number of cents (1250.5): an amount is written in cents, 125050 for 1,250.50 $. It is not used.",
    "Tarif “Civières”: the price for opening a unit is negative (-5). It is not used.",
  ]);
});

test("a row that cannot be a price is said, not dropped in silence, and never becomes a zero", () => {
  const { entries, problems } = catalogueOf(
    twin(
      // A form in progress: no activity yet. Skipped without a word, like a half-filled care protocol.
      row("empty", { par_jour: 1000 }),
      row("nothing", { activite: "Lits", mode: "normal" }),
      row("half-day", { activite: "Respirateurs", par_jour: 500, delai_jours: 2.5 }),
    ),
  );
  assert.deepEqual(entries, []);
  assert.deepEqual(problems, [
    "Tarif “Lits”, normal: it declares no amount and no formula, so it prices nothing.",
    "Tarif “Respirateurs”: the days its mode takes must be a whole number of days, zero or more (2.5). It is not used.",
  ]);
});

test("two rows for one activity, one mode and one place are both set aside: the ledger reads one price", () => {
  const twice = row("p-normal-2", { activite: "lits de soins intensifs", par_jour: 90000, mode: "Normal" });
  const { entries, problems } = catalogueOf(twin(NORMAL, twice, RUSH));
  assert.deepEqual(entries.map((e) => e.id), ["p-rush"]);
  assert.deepEqual(problems, [
    "Two rows price “Lits de soins intensifs” in mode “normal”. Neither is used until one is removed or given another mode.",
    "Two rows price “lits de soins intensifs” in mode “Normal”. Neither is used until one is removed or given another mode.",
  ]);
  // The same mode for the network and for one site is not a contradiction: the site has its own price.
  const own = row("p-site", { activite: "Lits de soins intensifs", par_jour: 150000, mode: "normal" }, ["f1"]);
  assert.deepEqual(catalogueOf(twin(NORMAL, own)).problems, []);
});

// --- a price of its own for a site -----------------------------------------------------

const LAKESHORE = row("p-lakeshore", { activite: "Lits de soins intensifs", par_jour: 150000, mode: "normal", delai_jours: 10, source: "Entente locale" }, ["f1"]);
const WITH_SITE = catalogueOf(twin(NORMAL, RUSH, LAKESHORE));

test("a row linked to a site prices that site, and comes before the row that prices the network", () => {
  const here = priceFor(WITH_SITE, "Lits de soins intensifs", "normal", "f1");
  assert.ok(here.priced === true && here.entry.id === "p-lakeshore");
  // Elsewhere, the network's price.
  const elsewhere = priceFor(WITH_SITE, "Lits de soins intensifs", "normal", "f2");
  assert.ok(elsewhere.priced === true && elsewhere.entry.id === "p-normal");
  // A site with its own prices is priced by them and only them: the rush mode of the network is not offered there.
  assert.deepEqual(modesFor(WITH_SITE, "Lits de soins intensifs", "f1").map((e) => e.id), ["p-lakeshore"]);
  assert.deepEqual(priceFor(WITH_SITE, "Lits de soins intensifs", "accéléré", "f1"), {
    priced: null,
    why: "The price list has no mode “accéléré” for Lits de soins intensifs. Its modes are: “normal” (10 days).",
  });
  // The ledger says which price it used, and that it was the site's own.
  const ledger = ledgerOf([change({ start: 10, days: 20 })], WITH_SITE);
  assert.deepEqual(ledger.lines.map((l) => [l.price.id, l.price.ofSite, l.cents]), [["p-lakeshore", true, 60 * 20 * 150000]]);
  assert.equal(ledgerOf([change({ siteId: "f2", siteName: "Hôpital de Verdun" })], WITH_SITE).lines[0]!.price.ofSite, false);
});

test("a row linked only to another site prices nothing here", () => {
  const only = catalogueOf(twin(LAKESHORE));
  assert.deepEqual(priceFor(only, "Lits de soins intensifs", null, "f2"), { priced: false });
  assert.deepEqual(ledgerOf([change({ siteId: "f2", siteName: "Hôpital de Verdun", mode: null })], only).unpriced, [
    { stamp: 0, why: "The price list holds no price for Lits de soins intensifs at Hôpital de Verdun." },
  ]);
});

// --- which price a change uses ------------------------------------------------------

const BOTH = catalogueOf(twin(NORMAL, RUSH));

test("the mode has to be named when the list has several: nobody chooses fast or cheap for the person", () => {
  assert.deepEqual(priceFor(BOTH, "Lits de soins intensifs", null), {
    priced: null,
    why: "The price list prices Lits de soins intensifs in 2 modes: “accéléré” (3 days), “normal” (14 days). Say which one this change uses (mode).",
  });
  // Named without regard to capitals or accents.
  const rush = priceFor(BOTH, "lits de soins intensifs", "Accelere");
  assert.ok(rush.priced === true && rush.entry.id === "p-rush");
  assert.deepEqual(priceFor(BOTH, "Lits de soins intensifs", "express"), {
    priced: null,
    why: "The price list has no mode “express” for Lits de soins intensifs. Its modes are: “accéléré” (3 days), “normal” (14 days).",
  });
});

test("with one mode that row is the price, and an activity the list does not hold is unpriced", () => {
  const one = catalogueOf(twin(row("p", { activite: "Civières", par_jour: 40000 })));
  const hit = priceFor(one, "Civières", undefined);
  assert.ok(hit.priced === true && hit.entry.leadDays === 0);
  assert.deepEqual(priceFor(one, "Lits de soins intensifs", null), { priced: false });
  assert.deepEqual(modesFor(one, "Lits de soins intensifs"), []);
});

// --- the ledger -------------------------------------------------------------------------

test("the total is the calculation made by hand, and each line goes back to its change and to its price", () => {
  // 60 units opened on day 14 of a 30-day run, in the normal mode: open 16 days.
  //   opening   60 × 2,500.00 $           =   150,000.00 $
  //   running   60 × 16 days × 1,250.50 $ = 1,200,480.00 $
  //   total                                 1,350,480.00 $
  const ledger = ledgerOf([change()], BOTH);
  assert.equal(ledger.totalCents, 135048000);
  assert.deepEqual(ledger.byCategory, { opening: 15000000, running: 120048000, formula: 0 });
  assert.equal(ledger.totalCents, ledger.lines.reduce((n, l) => n + l.cents, 0), "a total is the sum of its lines");
  assert.deepEqual(
    ledger.lines.map((l) => [l.stamp, l.category, l.fromDay, l.toDay, l.units, l.days, l.cents, l.price.id, l.price.unit?.cents, l.says]),
    [
      [0, "opening", 14, 14, 60, 16, 15000000, "p-normal", 250000, "60 units × 2,500 $ to open = 150,000 $"],
      [0, "running", 14, 29, 60, 16, 120048000, "p-normal", 125050, "60 units × 16 days × 1,250.50 $ a day = 1,200,480 $"],
    ],
  );
  // The price used is on the line: which row, which mode, where it comes from.
  assert.deepEqual(ledger.lines[0]!.price, {
    id: "p-normal",
    type: "Tarif",
    mode: "normal",
    ofSite: false,
    unit: { cents: 250000, low: 250000, high: 250000 },
    formula: null,
    values: null,
    source: "Grille tarifaire 2026, p. 12",
    demo: false,
  });
  assert.deepEqual([ledger.lines[0]!.site, ledger.lines[0]!.siteId, ledger.lines[0]!.activity], ["Hôpital du Lakeshore", "f1", "Lits de soins intensifs"]);
  assert.deepEqual([ledger.demo, ledger.ranged, ledger.lowCents, ledger.highCents], [false, false, 135048000, 135048000]);
  assert.deepEqual(ledger.unpriced, []);
  assert.deepEqual(ledger.availability, [{ stamp: 0, site: "Hôpital du Lakeshore", activity: "Lits de soins intensifs", mode: "normal", leadDays: 14, fromDay: 14 }]);
});

test("faster costs more, and the ledger shows both sides of it", () => {
  // The same 60 units, in the rush mode: open on day 3, so 27 days.
  //   opening   60 × 6,000 $           =   360,000 $
  //   running   60 × 27 days × 2,100 $ = 3,402,000 $
  const rush = ledgerOf([change({ mode: "accéléré", start: 3, days: 27 })], BOTH);
  assert.equal(rush.totalCents, 376200000);
  assert.deepEqual(rush.availability.map((a) => [a.mode, a.leadDays, a.fromDay]), [["accéléré", 3, 3]]);
  // A price with no source is a demo price, on its lines and on every total that contains one.
  assert.equal(rush.lines.every((l) => l.price.demo), true);
  assert.equal(rush.demo, true);
  const mixed = ledgerOf([change(), change({ stamp: 1, mode: "accéléré", start: 3, days: 27 })], BOTH);
  assert.equal(mixed.demo, true);
  assert.equal(mixed.totalCents, 135048000 + 376200000);
});

test("a price that is a range is read three times, low, likely and high, and never drawn at random", () => {
  // 1,000 $ a day, between 800 $ and 1,400 $; 2,000 $ to open, up to 3,000 $ (no low end: the price itself).
  const ranged = catalogueOf(twin(row("p", { activite: "Lits", par_jour: 100000, par_jour_bas: 80000, par_jour_haut: 140000, ouverture: 200000, ouverture_haut: 300000 })));
  assert.deepEqual(ranged.problems, []);
  assert.deepEqual(ranged.entries[0]!.perUnitDay, { cents: 100000, low: 80000, high: 140000 });
  assert.deepEqual(ranged.entries[0]!.perUnitOpened, { cents: 200000, low: 200000, high: 300000 });

  // 10 units for 5 days.
  //   likely  10 × 2,000 + 10 × 5 × 1,000 = 20,000 + 50,000 = 70,000 $
  //   low     10 × 2,000 + 10 × 5 ×   800 = 20,000 + 40,000 = 60,000 $
  //   high    10 × 3,000 + 10 × 5 × 1,400 = 30,000 + 70,000 = 100,000 $
  const ledger = ledgerOf([change({ activity: "Lits", units: 10, start: 0, days: 5, mode: null })], ranged);
  assert.deepEqual([ledger.totalCents, ledger.lowCents, ledger.highCents, ledger.ranged], [7000000, 6000000, 10000000, true]);
  assert.deepEqual(ledger.lines.map((l) => [l.cents, l.lowCents, l.highCents]), [[2000000, 2000000, 3000000], [5000000, 4000000, 7000000]]);
  assert.equal(ledger.lines[1]!.says, "10 units × 5 days × 1,000 $ a day = 50,000 $ (between 40,000 $ and 70,000 $)");
  // The same inputs give the same three figures, every time.
  assert.deepEqual(ledgerOf([change({ activity: "Lits", units: 10, start: 0, days: 5, mode: null })], ranged), ledger);
});

test("a range that contradicts its own price is refused, not reordered", () => {
  const { entries, problems } = catalogueOf(
    twin(
      row("a", { activite: "Lits", par_jour: 100000, par_jour_bas: 120000 }),
      row("b", { activite: "Civières", par_jour: 100000, par_jour_haut: 90000 }),
      row("c", { activite: "Respirateurs", par_jour_bas: 100, par_jour_haut: 300 }),
    ),
  );
  assert.deepEqual(entries, []);
  assert.deepEqual(problems, [
    "Tarif “Lits”: the low end for a unit kept open a day (120000) is above its price (100000). It is not used.",
    "Tarif “Civières”: the high end for a unit kept open a day (90000) is below its price (100000). It is not used.",
    "Tarif “Respirateurs”: it gives a low or a high end for a unit kept open a day and no price between them. It is not used.",
  ]);
});

test("a sum is whole cents from the row to the total", () => {
  // 0.10 $ × 3 units × 7 days is 2.10 $. Counted in dollars, floating point gives 2.1000000000000005.
  const dime = catalogueOf(twin(row("p", { activite: "Masques", par_jour: 10 })));
  const ledger = ledgerOf([change({ activity: "Masques", units: 3, days: 7, mode: null })], dime);
  assert.equal(ledger.totalCents, 210);
  assert.equal(ledger.lines.every((l) => Number.isInteger(l.cents) && Number.isInteger(l.lowCents) && Number.isInteger(l.highCents)), true);
  assert.equal(ledger.lines[0]!.says, "3 units × 7 days × 0.10 $ a day = 2.10 $");
});

test("what the list does not price has no line and says why: never a zero", () => {
  const ledger = ledgerOf([change({ stamp: 0, units: -20 }), change({ stamp: 1, activity: "Civières" }), change({ stamp: 2, mode: null })], BOTH);
  assert.deepEqual(ledger.lines, []);
  assert.equal(ledger.totalCents, 0);
  assert.deepEqual(ledger.unpriced, [
    { stamp: 0, why: "Closing units at Hôpital du Lakeshore is not priced: the price list says what opening and keeping a unit costs, not what closing one saves." },
    { stamp: 1, why: "The price list holds no price for Civières at Hôpital du Lakeshore." },
    // The ledger does not choose a mode for anybody.
    { stamp: 2, why: "The price list prices Lits de soins intensifs in 2 modes: “accéléré” (3 days), “normal” (14 days). Say which one this change uses (mode)." },
  ]);
  assert.deepEqual(ledger.availability, []);
});

test("an empty price list prices nothing and changes nothing", () => {
  const none: PriceCatalogue = { entries: [], problems: [] };
  assert.deepEqual(ledgerOf([], none), { lines: [], totalCents: 0, lowCents: 0, highCents: 0, ranged: false, byCategory: { opening: 0, running: 0, formula: 0 }, demo: false, unpriced: [], availability: [] });
  assert.deepEqual(ledgerOf([change()], none).unpriced, [{ stamp: 0, why: "The price list holds no price for Lits de soins intensifs at Hôpital du Lakeshore." }]);
});

// --- cost formulas ---------------------------------------------------------------------------

/** An ambulance, priced by a formula: a fee per trip plus so much a kilometre. In cents, like every amount. */
const AMBULANCE = row("p-amb", {
  activite: "Transferts en ambulance",
  formule: "ceil(units / places) * (frais_fixe + prix_par_km * distance_km)",
  places: 4,
  frais_fixe: 35000,
  prix_par_km: 425,
  distance_km: 32,
  source: "Entente de transport 2026",
});

test("a cost formula gives the amount calculated by hand, and the line shows the formula with its values", () => {
  // 10 patients, 4 to a trip: 3 trips. Each trip: 350.00 $ + 4.25 $ × 32 km = 486.00 $. Three trips: 1,458.00 $.
  const cat = catalogueOf(twin(AMBULANCE));
  assert.deepEqual(cat.problems, []);
  assert.deepEqual([cat.entries[0]!.formula, cat.entries[0]!.perUnitDay, cat.entries[0]!.perUnitOpened], ["ceil(units / places) * (frais_fixe + prix_par_km * distance_km)", null, null]);

  const ledger = ledgerOf([change({ activity: "Transferts en ambulance", units: 10, start: 2, days: 1, mode: null })], cat);
  assert.equal(ledger.totalCents, 145800);
  const line = ledger.lines[0]!;
  assert.deepEqual([line.category, line.cents, line.lowCents, line.highCents, line.price.unit], ["formula", 145800, 145800, 145800, null]);
  // Why it costs that, so that a person can redo it.
  assert.equal(line.price.formula, "ceil(units / places) * (frais_fixe + prix_par_km * distance_km)");
  assert.deepEqual(line.price.values, { units: 10, places: 4, frais_fixe: 35000, prix_par_km: 425, distance_km: 32 });
  assert.equal(
    line.says,
    "ceil(units / places) * (frais_fixe + prix_par_km * distance_km), with units = 10, places = 4, frais_fixe = 35000, prix_par_km = 425, distance_km = 32 = 145,800 cents, 1,458 $",
  );
  assert.deepEqual(ledger.byCategory, { opening: 0, running: 0, formula: 145800 });
});

test("a formula that names a value the row does not have gives no price, and says which one", () => {
  // The distance was never typed.
  const { distance_km: _gone, ...without } = AMBULANCE.properties as Record<string, unknown>;
  const cat = catalogueOf(twin(row("p-amb", without)));
  const ledger = ledgerOf([change({ activity: "Transferts en ambulance", units: 10, mode: null })], cat);
  assert.deepEqual(ledger.lines, []);
  assert.equal(ledger.totalCents, 0);
  assert.equal(ledger.unpriced.length, 1);
  assert.match(ledger.unpriced[0]!.why, /^The formula of Tarif, standard gives no price: Unknown name "distance_km"\. This formula can name: /);
  assert.match(ledger.unpriced[0]!.why, /places, frais_fixe, prix_par_km, units, days/);
});

test("a formula whose result is not a price gives none", () => {
  const cat = (formule: string) => catalogueOf(twin(row("p", { activite: "Lits", formule, base: 10000 })));
  const c = change({ activity: "Lits", units: 5, mode: null });
  const negative = linesOf(c, cat("base - 100000").entries[0]!);
  assert.ok("why" in negative && /gives a negative amount \(-90000\), which is not a price/.test(negative.why));
  const divided = linesOf(c, cat("base / (units - 5)").entries[0]!);
  assert.ok("why" in divided && /gives no price: Division by zero\./.test(divided.why));
  // A formula's result is in cents, rounded once to the whole cent: 1000 / 3 is 333 cents.
  const third = linesOf(c, cat("1000 / 3").entries[0]!);
  assert.ok("lines" in third && third.lines[0]!.cents === 333);
});

test("a formula is arithmetic with named values, never code", () => {
  const got = evaluate("ceil(units / places) * (fee + per_km * km_2)", { units: 10, places: 4, fee: 35000, per_km: 425, km_2: 32 });
  assert.equal(got.value, 145800);
  // What stood for each name is kept: the trace of the evaluation.
  assert.deepEqual(got.used, { units: 10, places: 4, fee: 35000, per_km: 425, km_2: 32 });
  // A name that was not handed is an error, never a zero.
  assert.throws(() => evaluate("units * price", { units: 3 }), (e: unknown) => e instanceof CalcError && /Unknown name "price"\. This formula can name: units\./.test(e.message));
  // A name with no value is refused too.
  assert.throws(() => evaluate("units * price", { units: 3, price: Number.NaN }), /"price" has no value/);
  // A function is still a function, and nothing else is reachable.
  assert.equal(evaluate("max(units, 5)", { units: 3 }).value, 5);
  assert.throws(() => evaluate("max", { units: 3 }), /"max" is a function: write max\(…\)/);
  assert.throws(() => evaluate("constructor(1)", { units: 3 }), /Unknown name "constructor"/);
  assert.throws(() => evaluate("units.toString", { units: 3 }), /Unexpected "\."/);
  // Without names, the analyst's calculator is what it was.
  assert.throws(() => evaluate("units * 2"), /Unknown function "units"\. Available: /);
  assert.throws(() => evaluate("constructor(1)"), /Unknown function "constructor"/);
  assert.deepEqual(evaluate("2 + 3 * 4").used, {});
});

test("an amount reads as a person writes it", () => {
  assert.equal(formatCents(135048000), "1,350,480 $");
  assert.equal(formatCents(125050), "1,250.50 $");
  assert.equal(formatCents(10), "0.10 $");
  assert.equal(formatCents(0), "0 $");
});

// --- the price list, as the ontology shows it -----------------------------------------

test("an activity is found whether it is written as the type's name or as the engine writes it", () => {
  // A type called "Soins intensifs" travels to the engine as soins_intensifs; a price row names it either way.
  assert.equal(fold("Soins intensifs"), fold("soins_intensifs"));
  assert.equal(fold("  Lits  de  Soins Intensifs "), "lits_de_soins_intensifs");
  const cat = catalogueOf(twin(row("p", { activite: "Soins intensifs", par_jour: 90000 })));
  assert.equal(priceFor(cat, "soins_intensifs", null).priced, true);
  // Another activity is still another activity.
  assert.equal(priceFor(cat, "soins", null).priced, false);
});

test("the price list is shown whole: every row, where it applies, what its formula may name, and what was set aside", () => {
  const system = {
    object_types: [TARIF],
    objects: [
      NORMAL,
      RUSH,
      row("p-lake", { activite: "Lits de soins intensifs", par_jour: 100000, par_jour_haut: 130000, mode: "normal", source: "Entente locale" }, ["f1"]),
      row("p-amb", { activite: "Transferts en ambulance", formule: "ceil(units / places) * frais_fixe", places: 4, frais_fixe: 35000, units: 99 }),
      row("bad", { activite: "Civières", par_jour: 12.5 }),
    ],
    facilities: [{ id: "f1", name: "Hôpital du Lakeshore" }],
  } as unknown as Parameters<typeof priceListOf>[0];
  const list = priceListOf(system);
  assert.deepEqual(list.types, ["Tarif"]);
  assert.deepEqual(
    list.rows.map((r) => [r.id, r.mode, r.leadDays, r.demo, r.sites.map((x) => x.name)]),
    [
      ["p-lake", "normal", 0, false, ["Hôpital du Lakeshore"]],
      ["p-rush", "accéléré", 3, true, []],
      ["p-normal", "normal", 14, false, []],
      ["p-amb", "standard", 0, true, []],
    ],
  );
  // Amounts as held: whole cents, with their ends.
  assert.deepEqual(list.rows[0]!.perUnitDay, { cents: 100000, low: 100000, high: 130000 });
  assert.equal(list.rows[0]!.perUnitOpened, null);
  // A formula may name the row's own numbers, and the quantities of the operation, which a row's number does not shadow.
  assert.deepEqual(list.rows[3]!.canName, [
    { name: "places", value: 4, of: "row" },
    { name: "frais_fixe", value: 35000, of: "row" },
    { name: "units", value: null, of: "operation" },
    { name: "days", value: null, of: "operation" },
  ]);
  assert.deepEqual(list.rows[0]!.canName, []);
  // The row that is not a whole number of cents is not used, and said.
  assert.equal(list.problems.length, 1);
  assert.match(list.problems[0]!, /^Tarif “Civières”: the price for a unit kept open a day is not a whole number of cents \(12\.5\)/);
});

test("a twin with no price list shows none", () => {
  assert.deepEqual(priceListOf({ object_types: [], objects: [NORMAL], facilities: [] } as unknown as Parameters<typeof priceListOf>[0]), {
    types: [],
    rows: [],
    problems: [],
    // What a formula can be written with does not depend on the twin.
    formulas: { functions: ["abs", "sqrt", "floor", "ceil", "round", "min", "max", "sum", "mean"], operation: ["units", "days"] },
  });
});
