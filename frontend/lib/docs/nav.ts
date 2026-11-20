export interface DocLink {
  title: string;
  slug: string[];
  badge?: "new";
}

export interface DocSection {
  title: string;
  items: DocLink[];
}

export const DOC_NAV: DocSection[] = [
  {
    // The repository's own documentation, copied from `docs/` by
    // scripts/sync-docs.mjs: one page per part of the product, and the dated
    // journal of what changed. In French, as it is written.
    title: "Produit",
    items: [
      { title: "La boucle de décision", slug: ["product", "decision-loop"] },
      { title: "La page Scenarios", slug: ["product", "scenarios-page"] },
      { title: "L'analyste", slug: ["product", "analyst"] },
      { title: "Les algorithmes", slug: ["product", "algorithms"] },
      { title: "Journal des changements", slug: ["product", "changelog"] },
    ],
  },
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", slug: ["getting-started", "introduction"] },
      { title: "Authentication", slug: ["getting-started", "authentication"] },
      { title: "Quickstart", slug: ["getting-started", "quickstart"] },
      { title: "Errors", slug: ["getting-started", "errors"] },
      { title: "Rate limits", slug: ["getting-started", "rate-limits"] },
    ],
  },
  {
    title: "Core API",
    items: [
      { title: "/v1/concepts/{code}", slug: ["api", "concepts"] },
      { title: "/v1/normalize", slug: ["api", "normalize"] },
      { title: "/v1/concepts/{code}/descendants", slug: ["api", "descendants"] },
      { title: "/v1/translate", slug: ["api", "translate"] },
      { title: "/v1/concepts/{code}/synonyms", slug: ["api", "synonyms"] },
      { title: "/v1/normalize-batch", slug: ["api", "normalize-batch"] },
      { title: "/v1/disambiguate", slug: ["api", "disambiguate"] },
      { title: "/v1/extract/concepts", slug: ["api", "extract-concepts"], badge: "new" },
      { title: "/v1/extract/contexts", slug: ["api", "extract-contexts"], badge: "new" },
    ],
  },
  {
    title: "Standards",
    items: [
      { title: "SNOMED CT", slug: ["standards", "snomed"] },
      { title: "ICD-10", slug: ["standards", "icd10"] },
      { title: "FHIR", slug: ["standards", "fhir"] },
      { title: "HL7", slug: ["standards", "hl7"] },
    ],
  },
  {
    title: "Resources",
    items: [{ title: "Status", slug: ["resources", "status"] }],
  },
];

export function flattenNav(): DocLink[] {
  return DOC_NAV.flatMap((s) => s.items);
}

export function findNavItem(slug: string[]): DocLink | undefined {
  return flattenNav().find(
    (item) =>
      item.slug.length === slug.length &&
      item.slug.every((s, i) => s === slug[i]),
  );
}

export function getAdjacent(slug: string[]): { prev?: DocLink; next?: DocLink } {
  const flat = flattenNav();
  const idx = flat.findIndex(
    (item) =>
      item.slug.length === slug.length &&
      item.slug.every((s, i) => s === slug[i]),
  );
  if (idx === -1) return {};
  return {
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
  };
}

/** /docs opens on the product: what it does comes before how to call its API. */
export const DOCS_DEFAULT_SLUG = ["product", "decision-loop"];
