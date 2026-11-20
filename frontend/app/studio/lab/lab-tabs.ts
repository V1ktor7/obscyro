/**
 * The lab's tabs, and how the address names one.
 *
 * The lab has no row of tabs of its own. The Studio's navigation lists them
 * above the page (`platform-nav.ts`, section "models"), each as a link to
 * `/studio/lab?tab=…`, and the page shows the one the address names. So a tab
 * that is here and not there is a tab nothing leads to: `lab-tabs.test.ts`
 * holds the two lists together.
 *
 * Kept apart from the page so it can be read and tested without it.
 */

export type LabTab = "models" | "notebook" | "forecast" | "live" | "causality" | "train" | "compare" | "feed";

export const LAB_TABS: readonly LabTab[] = [
  "models",
  "notebook",
  "forecast",
  "live",
  "causality",
  "train",
  "compare",
  "feed",
];

/** The tab an address names. Models when it names none, or one that does not exist. */
export function labTabFrom(value: string | null): LabTab {
  return value && (LAB_TABS as readonly string[]).includes(value) ? (value as LabTab) : "models";
}
