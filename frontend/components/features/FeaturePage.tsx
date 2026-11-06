"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

import DemoRequest from "@/components/landing/DemoRequest";
import HeroReveal from "@/components/landing/HeroReveal";
import ProductTour from "@/components/landing/anim/ProductTour";
import {
  FEATURES,
  FEATURE_HREFS,
  featureHref,
  featureKeys,
  type FeatureSlug,
} from "@/lib/features";
import { useT } from "@/lib/i18n/context";

/**
 * One screen of the product, on a page of its own.
 *
 * Built from the home page's own parts so that it reads as the same site: the
 * same frame playing the same animation, the same panels, the same demo
 * request at the foot. The difference is that the frame stays on one screen
 * and replays it, and the page says in three points what that screen does.
 *
 * The three points are things the screen does today. A feature page is the
 * place a roadmap item most easily passes for a capability, and a buyer who
 * reads one here will ask to see it.
 *
 * The screens follow the order work moves through them — data before
 * pipelines, pipelines before the model, the model before the twin — so the
 * page is numbered and leads to its neighbours.
 */
export default function FeaturePage({ slug }: { slug: FeatureSlug }) {
  const t = useT();
  const i = FEATURES.findIndex((f) => f.slug === slug);
  const feature = FEATURES[i]!;
  const keys = featureKeys(slug);
  const labels = FEATURES.map((f) => t(f.name));
  const prev = i > 0 ? FEATURES[i - 1] : null;
  const next = i < FEATURES.length - 1 ? FEATURES[i + 1] : null;

  return (
    <>
      <section className="pb-20 pt-16 sm:pb-28 sm:pt-24">
        <div className="container max-w-[1120px]">
          <HeroReveal className="mx-auto max-w-[820px] text-center">
            <p className="caption">
              {t("feat.eyebrow")} · {i + 1} / {FEATURES.length}
            </p>
            <h1 className="display-lg mt-4 text-balance">{t(keys.title)}</h1>
            <p className="body-lg mt-5 text-balance">{t(keys.lead)}</p>
          </HeroReveal>

          <HeroReveal delay={0.1} className="mt-12 sm:mt-16">
            <ProductTour labels={labels} only={feature.screen} links={FEATURE_HREFS} />
          </HeroReveal>
        </div>
      </section>

      <section className="pb-20 sm:pb-28">
        <div className="container max-w-[1120px]">
          <ul className="grid gap-5 md:grid-cols-3">
            {keys.points.map((point) => (
              <li key={point.title} className="flex flex-col panel p-7 sm:p-8">
                <h2 className="text-[1.0625rem] font-medium tracking-[-0.004em] text-fg-primary">
                  {t(point.title)}
                </h2>
                <p className="body-md mt-3 text-[0.9375rem]">{t(point.body)}</p>
              </li>
            ))}
          </ul>

          <nav
            aria-label={t("feat.eyebrow")}
            className="mt-16 grid gap-px overflow-hidden border border-border-subtle bg-border-subtle sm:mt-20 sm:grid-cols-2"
          >
            {prev ? (
              <Link
                href={featureHref(prev.slug)}
                className="group flex flex-col gap-1 bg-bg-primary px-6 py-5 transition-colors hover:bg-bg-secondary"
              >
                <span className="caption inline-flex items-center gap-1.5">
                  <ArrowLeft
                    className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
                    aria-hidden
                  />
                  {t("feat.prev")}
                </span>
                <span className="text-[1.0625rem] font-medium text-fg-primary">{t(prev.name)}</span>
              </Link>
            ) : (
              <span className="hidden bg-bg-primary sm:block" aria-hidden />
            )}
            {next ? (
              <Link
                href={featureHref(next.slug)}
                className="group flex flex-col items-end gap-1 bg-bg-primary px-6 py-5 text-right transition-colors hover:bg-bg-secondary"
              >
                <span className="caption inline-flex items-center gap-1.5">
                  {t("feat.next")}
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
                <span className="text-[1.0625rem] font-medium text-fg-primary">{t(next.name)}</span>
              </Link>
            ) : (
              <span className="hidden bg-bg-primary sm:block" aria-hidden />
            )}
          </nav>
        </div>
      </section>

      <DemoRequest />
    </>
  );
}
