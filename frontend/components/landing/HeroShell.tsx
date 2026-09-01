"use client";

import Link from "next/link";
import { ArrowDown, ChevronRight } from "lucide-react";
import HeroGlobe from "./anim/HeroGlobe";
import ProductTour from "./anim/ProductTour";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";

/**
 * One composition: the claim, and the software making it.
 *
 * The tour used to sit in its own section below, separated by a band of white,
 * which read as two unrelated things stacked. It belongs here — the headline
 * raises a question and the frame under it answers, inside the same screen, the
 * way a hero video does on the sites this follows.
 *
 * The globe runs behind the whole section rather than behind the words alone.
 * The wash is concentrated at the top where the type is; lower down the frame
 * is opaque and sits on the globe cleanly, so the ground stays continuous
 * without anything having to fight for legibility.
 *
 * No subtitle. A headline that needs a paragraph under it to be understood is
 * a headline that has not finished being written.
 */
export default function HeroShell() {
  const t = useT();

  return (
    <section className="relative overflow-hidden">
      <HeroGlobe className="pointer-events-none absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 62% 38% at 50% 20%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.78) 48%, rgba(255,255,255,0.35) 78%, rgba(255,255,255,0.6) 100%)",
        }}
        aria-hidden
      />

      <div className="container relative max-w-[1120px] pb-16 pt-20 sm:pb-20 sm:pt-24">
        <HeroReveal className="mx-auto max-w-[1000px] text-center">
          <h1 className="display-xl text-balance">{t("hero.title")}</h1>
          <div className="mt-8 flex justify-center sm:mt-10">
            <Link href="#contact" className="pill">
              {t("demo.cta")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </HeroReveal>

        <HeroReveal delay={0.12} className="mt-12 sm:mt-16">
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
        </HeroReveal>

        <div className="mt-14 flex flex-col items-center gap-2">
          <ArrowDown className="h-4 w-4 animate-bounce text-fg-secondary" aria-hidden />
          <span className="caption">{t("hero.scroll")}</span>
        </div>
      </div>
    </section>
  );
}
