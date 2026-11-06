"use client";

import Link from "next/link";
import { ArrowDown, ChevronRight } from "lucide-react";
import HeroGlobe from "./anim/HeroGlobe";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";

/**
 * The claim, over the globe, and nothing else.
 *
 * The product tour used to sit in this section, in front of the globe. The
 * globe's whole performance — the orbit, the drop onto a city, the climb back
 * — happened behind an opaque frame, and what showed of it was a grey rim
 * around a screenshot. So the two are separated: the globe gets the first
 * screen to itself, and the tour opens the next section on a plain ground.
 *
 * The separation is made soft rather than drawn. The wash dissolves into the
 * page colour at the bottom, so the globe fades out where the tour's section
 * begins and the two still read as one opening, not as two blocks stacked.
 *
 * No subtitle. A headline that needs a paragraph under it to be understood is
 * a headline that is not finished yet.
 */
export default function HeroShell() {
  const t = useT();

  return (
    <section className="relative flex min-h-[calc(100svh-3rem)] flex-col overflow-hidden">
      <HeroGlobe className="pointer-events-none absolute inset-0" />
      {/* Clear behind the words, transparent around them so the globe reads,
          and the page colour again at the foot so the next section is joined
          rather than butted against it. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 58% 34% at 50% 46%, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.72) 46%, rgba(255,255,255,0.18) 78%, rgba(255,255,255,0) 100%)," +
            "linear-gradient(to bottom, rgba(255,255,255,0) 72%, rgba(255,255,255,1) 100%)",
        }}
        aria-hidden
      />

      <div className="container relative flex max-w-[1120px] flex-1 flex-col items-center justify-center py-20 sm:py-24">
        <HeroReveal className="mx-auto max-w-[1000px] text-center">
          <h1 className="display-xl text-balance">{t("hero.title")}</h1>
          <div className="mt-8 flex justify-center sm:mt-10">
            <Link href="#contact" className="pill">
              {t("demo.cta")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </HeroReveal>
      </div>

      <a
        href="#features"
        className="relative mx-auto mb-8 flex flex-col items-center gap-2 text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowDown className="h-4 w-4 animate-bounce" aria-hidden />
        <span className="caption">{t("hero.scroll")}</span>
      </a>
    </section>
  );
}
