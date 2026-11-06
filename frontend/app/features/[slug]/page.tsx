import type { Metadata } from "next";
import { notFound } from "next/navigation";

import FeaturePage from "@/components/features/FeaturePage";
import { FEATURES, featureKeys, findFeature } from "@/lib/features";
import { DEFAULT_LOCALE, dict } from "@/lib/i18n/dictionary";

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

/** Only the six screens; any other address is a page that does not exist. */
export const dynamicParams = false;

export function generateMetadata({ params }: Props): Metadata {
  const feature = findFeature(params.slug);
  if (!feature) return {};
  const text = dict[DEFAULT_LOCALE];
  const keys = featureKeys(feature.slug);
  return {
    title: text[feature.name],
    description: text[keys.lead],
    alternates: { canonical: `/features/${feature.slug}` },
  };
}

export default function Page({ params }: Props) {
  const feature = findFeature(params.slug);
  if (!feature) notFound();
  return <FeaturePage slug={feature.slug} />;
}
