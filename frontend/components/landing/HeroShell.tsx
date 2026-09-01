"use client";

import Link from "next/link";
import { ArrowDown, ChevronRight } from "lucide-react";
import HeroGlobe from "./anim/HeroGlobe";
import ProductTour from "./anim/ProductTour";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";

/**
 * One line, one way forward, and the software underneath.
 *
 * The subtitle is gone. A headline that needs a paragraph under it to be
 * understood is a headline that has not finished being written, and the
 * reference this follows carries none — the claim stands alone over the globe,
 * and the product tour below answers the question it raises.
 */
export default function HeroShell() {
  const t = useT();

  return (
    <section>
      <div className="relative overflow-hidden">
        <HeroGlobe className="pointer-events-none absolute inset-0" />

        {/* A wash rather than a flat scrim: the globe stays visible at the
            edges and clears where the words are. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 44%, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.76) 46%, rgba(255,255,255,0) 78%)",
          }}
          aria-hidden
        />

        <div className="container relative flex min-h-[78vh] max-w-[1000px] flex-col items-center justify-center py-24 text-center sm:py-28">
          <HeroReveal>
            <h1 className="display-xl text-balance">{t("hero.title")}</h1>
            <div className="mt-10 flex justify-center">
              <Link href="#contact" className="pill">
                {t("demo.cta")}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </HeroReveal>

          <div className="mt-16 flex flex-col items-center gap-2 sm:mt-20">
            <ArrowDown className="h-4 w-4 animate-bounce text-fg-secondary" aria-hidden />
            <span className="caption">{t("hero.scroll")}</span>
          </div>
        </div>
      </div>

      <HeroReveal delay={0.12}>
        <div className="container max-w-[1120px] py-20 sm:py-28">
          <ProductTour
            labels={[
              t("tour.1"),
              t("tour.2"),
              t("tour.3"),
              t("tour.4"),
              t("tour.5"),
              t("tour.6"),
            ]}
          />
          <p className="caption mt-4 text-center">{t("cycle.caption")}</p>
        </div>
      </HeroReveal>
    </section>
  );
}
