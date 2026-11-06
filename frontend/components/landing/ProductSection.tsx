"use client";

import ProductTour from "./anim/ProductTour";
import HeroReveal from "./HeroReveal";
import { FEATURES, FEATURE_HREFS } from "@/lib/features";
import { useT } from "@/lib/i18n/context";

/**
 * The software, right after the claim, on a ground of its own.
 *
 * This is the tour that used to sit in front of the globe. It opens the page
 * proper: six screens, each animating the one thing it is for, and under the
 * frame a link to the page of whichever screen is showing — so the way to read
 * more always leads to what is on screen.
 */
export default function ProductSection() {
  const t = useT();
  const labels = FEATURES.map((f) => t(f.name));

  return (
    <section id="features" className="scroll-mt-12 pb-24 pt-10 sm:pb-32 sm:pt-12">
      <div className="container max-w-[1120px]">
        <HeroReveal className="mx-auto max-w-[720px] text-center">
          <h2 className="display-lg text-balance">{t("product.title")}</h2>
          <p className="body-lg mt-5 text-balance">{t("product.subtitle")}</p>
        </HeroReveal>

        <HeroReveal delay={0.1} className="mt-12 sm:mt-16">
          <ProductTour labels={labels} links={FEATURE_HREFS} exploreLabel={t("product.explore")} />
        </HeroReveal>
      </div>
    </section>
  );
}
