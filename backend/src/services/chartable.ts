/**
 * What a table can honestly be drawn as.
 *
 * The picker in front of this is the whole point of the feature: rather than
 * offering twelve chart types and letting somebody discover that ten of them
 * produce nonsense on their data, the platform reads the columns and offers
 * only the ones the data can actually support — and says why.
 *
 * The declared schema is not enough to do that. A dataset's columns are typed
 * `string | number | boolean | object` and nothing more, so a date arrives as a
 * string and a permit number arrives as a number. Both would be mis-drawn by a
 * picker that trusted the declaration: the date would become a category with
 * ninety values, and the permit number would be offered as a quantity to sum.
 * So the values are read, not just the types.
 */

export interface ColumnSpec {
  name: string;
  type: "string" | "number" | "boolean" | "object";
}

export type ColumnRole = "time" | "quantity" | "category" | "identifier" | "unusable";

export interface ColumnFit {
  name: string;
  role: ColumnRole;
  /** How many of the sampled rows carried a usable value. */
  filled: number;
  /** Distinct values seen, capped at the sample size. */
  distinct: number;
  /** Said in the picker, so a choice can be argued with. */
  reason: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function looksLikeDate(v: string): boolean {
  // Anchored on the ISO shape rather than handed to Date.parse, which accepts
  // "2" and "Dec" and would turn a column of small integers into a timeline.
  return ISO_DATE.test(v.trim()) && !Number.isNaN(Date.parse(v.trim().slice(0, 10)));
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read each column's role from what is actually in it.
 *
 * `sample` is a preview, not the whole table: a few hundred rows settle every
 * question here, and reading a million to decide whether a column is a date
 * would make opening the picker slower than drawing the chart.
 */
export function readColumns(
  columns: readonly ColumnSpec[],
  sample: ReadonlyArray<Record<string, unknown>>,
): ColumnFit[] {
  return columns.map((c) => {
    const raw = sample.map((r) => r[c.name]).filter((v) => v !== null && v !== undefined && v !== "");
    const seen = new Set(raw.map((v) => String(v)));
    const filled = raw.length;
    const distinct = seen.size;

    if (filled === 0) {
      return { name: c.name, role: "unusable", filled, distinct, reason: "aucune valeur dans l'aperçu" };
    }

    const dates = raw.filter((v) => typeof v === "string" && looksLikeDate(v)).length;
    if (dates / filled > 0.8) {
      return { name: c.name, role: "time", filled, distinct, reason: "des dates" };
    }

    const nums = raw.map(asNumber).filter((n): n is number => n !== null);
    if (nums.length / filled > 0.8) {
      // Identifiers wear a shape measurements do not: whole, never repeating,
      // and all the same width at six digits or more. A permit number is
      // 51236297 — eight digits, every row different. Bed counts are 15 to 54,
      // also whole and also all different in a short sample, which is why "all
      // distinct" alone is not the test: it demoted a real measurement and left
      // an imported file unchartable.
      //
      // The width is what carries it. A quantity that ranges over anything
      // meaningful changes digit count as it goes; a code is issued at a fixed
      // width and stays there.
      const whole = nums.every((n) => Number.isInteger(n) && n >= 0);
      const widths = new Set(nums.map((n) => String(n).length));
      const uniformWide = widths.size === 1 && [...widths][0]! >= 6;
      if (whole && uniformWide && new Set(nums).size === nums.length && nums.length >= 4) {
        return {
          name: c.name,
          role: "identifier",
          filled,
          distinct,
          reason: "des entiers tous différents — un identifiant, pas une mesure",
        };
      }
      return { name: c.name, role: "quantity", filled, distinct, reason: "des nombres" };
    }

    return {
      name: c.name,
      role: "category",
      filled,
      distinct,
      reason: `du texte, ${distinct} valeur${distinct > 1 ? "s" : ""} distincte${distinct > 1 ? "s" : ""}`,
    };
  });
}

export type CardKind = "line" | "bar" | "number" | "table";

export interface ChartOffer {
  kind: CardKind;
  label: string;
  /** Pre-filled with the best candidate, so a card is one click away. */
  x: string | null;
  y: string | null;
  /** Shown under the option. A picker that cannot say why is a guess. */
  why: string;
}

/** Above this a bar chart is a wall of ticks nobody can read. */
const BAR_CATEGORY_CAP = 30;

/**
 * The charts these columns support, best first.
 *
 * Only what the data can carry. An offer that would draw something misleading
 * is left out rather than shown disabled, for the same reason the navigation
 * rail hides what a role cannot reach: a disabled option still teaches the
 * reader that the thing is possible here.
 */
export function offersFor(fits: readonly ColumnFit[]): ChartOffer[] {
  const time = fits.filter((f) => f.role === "time");
  const qty = fits.filter((f) => f.role === "quantity");
  const cat = fits.filter((f) => f.role === "category" && f.distinct <= BAR_CATEGORY_CAP);

  const offers: ChartOffer[] = [];

  if (time.length && qty.length) {
    offers.push({
      kind: "line",
      label: "Courbe dans le temps",
      x: time[0]!.name,
      y: qty[0]!.name,
      why: `${qty[0]!.name} suivi par ${time[0]!.name}`,
    });
  }

  if (cat.length && qty.length) {
    offers.push({
      kind: "bar",
      label: "Barres par catégorie",
      x: cat[0]!.name,
      y: qty[0]!.name,
      why: `${qty[0]!.name} par ${cat[0]!.name} — ${cat[0]!.distinct} barres`,
    });
  }

  if (qty.length) {
    offers.push({
      kind: "number",
      label: "Chiffre unique",
      x: null,
      y: qty[0]!.name,
      why: `la somme, la moyenne ou le maximum de ${qty[0]!.name}`,
    });
  }

  // Always last and always available: a table asks nothing of the data, and it
  // is the honest fallback when nothing else fits.
  offers.push({
    kind: "table",
    label: "Table",
    x: null,
    y: null,
    why: "les lignes telles quelles",
  });

  return offers;
}

/**
 * Why nothing better than a table was offered.
 *
 * An empty picker is a dead end. Naming the reason turns it into a next step —
 * usually "this column is text where you expected numbers", which is a data
 * problem worth knowing about rather than a limitation of the chart tool.
 */
export function whyNoChart(fits: readonly ColumnFit[]): string | null {
  if (fits.some((f) => f.role === "quantity")) return null;
  const ids = fits.filter((f) => f.role === "identifier");
  if (ids.length) {
    return (
      `Aucune colonne ne porte de mesure. ${ids.map((f) => f.name).join(", ")} ` +
      `ressemble${ids.length > 1 ? "nt" : ""} à des identifiants : des entiers tous ` +
      `différents, qu'additionner ne voudrait rien dire.`
    );
  }
  if (fits.every((f) => f.role === "unusable")) {
    return "L'aperçu est vide — le jeu de données n'a pas encore de lignes.";
  }
  return "Aucune colonne ne contient de nombres, donc il n'y a rien à mesurer.";
}
