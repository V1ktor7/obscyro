import type { DictKey } from "@/lib/i18n/dictionary";

/**
 * The six screens of the product, in the order work moves through them.
 *
 * One list for the tour on the home page, the page each screen has of its own,
 * and the footer, so a screen cannot be renamed in one place and not the
 * others. `screen` is the tour's index for it: the page shows the same
 * animation the home page plays, which is what makes the two recognisably the
 * same thing.
 */
export const FEATURES = [
  { slug: "data", screen: 0, name: "tour.1" },
  { slug: "pipelines", screen: 1, name: "tour.2" },
  { slug: "ontology", screen: 2, name: "tour.3" },
  { slug: "twin", screen: 3, name: "tour.4" },
  { slug: "dashboards", screen: 4, name: "tour.5" },
  { slug: "responses", screen: 5, name: "tour.6" },
] as const satisfies readonly { slug: string; screen: number; name: DictKey }[];

export type FeatureSlug = (typeof FEATURES)[number]["slug"];

export const featureHref = (slug: FeatureSlug) => `/features/${slug}`;

export const FEATURE_HREFS = FEATURES.map((f) => featureHref(f.slug));

export function findFeature(slug: string) {
  return FEATURES.find((f) => f.slug === slug);
}

/** The keys a feature page reads, built from the slug so all six stay alike. */
export function featureKeys(slug: FeatureSlug) {
  const k = (s: string) => `feat.${slug}.${s}` as DictKey;
  return {
    title: k("title"),
    lead: k("lead"),
    points: [1, 2, 3].map((n) => ({ title: k(`p${n}.title`), body: k(`p${n}.body`) })),
  };
}
