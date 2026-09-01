"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import FeatureCycle from "./anim/FeatureCycle";
import HeroGlobe from "./anim/HeroGlobe";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";

/**
 * The globe is the ground, the headline stands on it, and the product tour sits
 * below.
 *
 * The globe is held well back and the type carries a soft white wash behind it:
 * a background that competes with the headline is a background that failed. On
 * load, two rings close into the mark over the globe and then fade to a
 * watermark — the one orchestrated moment on the page.
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
              "radial-gradient(ellipse 62% 54% at 50% 46%, rgba(255,255,255,0.93) 0%, rgba(255,255,255,0.74) 46%, rgba(255,255,255,0) 78%)",
          }}
          aria-hidden
        />

        <div className="container relative max-w-[980px] py-24 text-center sm:py-32 lg:py-40">
          <HeroReveal>
            <h1 className="display-xl text-balance">{t("hero.title")}</h1>
            <p className="body-lg mx-auto mt-5 max-w-[40rem] text-balance sm:mt-6">
              {t("hero.subtitle")}
            </p>
            {/* One way in, and it goes through a conversation. The Studio
                holds a network's operating picture; there is no version of
                this page on which a stranger should reach it in one click. */}
            <div className="mt-8 flex justify-center sm:mt-10">
              <Link href="#contact" className="pill">
                {t("demo.cta")}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </HeroReveal>
        </div>
      </div>

      <HeroReveal delay={0.15}>
        <div className="container max-w-[1120px] pb-20 sm:pb-28">
          <FeatureCycle
            labels={[t("cycle.1"), t("cycle.2"), t("cycle.3"), t("cycle.4"), t("cycle.5")]}
            captions={[
              t("cycle.1.note"),
              t("cycle.2.note"),
              t("cycle.3.note"),
              t("cycle.4.note"),
              t("cycle.5.note"),
            ]}
          />
        </div>
      </HeroReveal>
    </section>
  );
}
