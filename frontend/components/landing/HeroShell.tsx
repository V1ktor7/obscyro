"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import FeatureCycle from "./anim/FeatureCycle";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";
/**
 * A centred headline, two ways forward, and the software underneath.
 *
 * The panel below the copy used to be an abstract field of moving dots. It has
 * been replaced by the product tour: five diagrams of screens that exist, which
 * a reader can also step through by hand. An animation that is only atmosphere
 * asks for attention without returning any.
 */


export default function HeroShell() {
  const t = useT();

  return (
    <section className="overflow-hidden pb-20 pt-16 sm:pb-28 sm:pt-24">
      <div className="container max-w-[980px] text-center">
        <HeroReveal>
          <h1 className="display-xl text-balance">{t("hero.title")}</h1>
          <p className="body-lg mx-auto mt-5 max-w-[42rem] text-balance sm:mt-6">
            {t("hero.subtitle")}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:mt-10 sm:flex-row sm:gap-8">
            <Link href="#contact" className="pill">
              {t("demo.cta")}
            </Link>
            <Link href="/studio" className="link-cta">
              {t("hero.cta.studio")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </HeroReveal>
      </div>

      <HeroReveal delay={0.15}>
        <div className="container mt-14 max-w-[1120px] sm:mt-20">
          <FeatureCycle
            labels={[t("cycle.1"), t("cycle.2"), t("cycle.3"), t("cycle.4"), t("cycle.5")]}
          />
          <p className="caption mt-4 text-center">{t("cycle.caption")}</p>
        </div>
      </HeroReveal>
    </section>
  );
}
