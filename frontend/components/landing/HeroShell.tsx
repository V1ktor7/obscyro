"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import DataFlow from "./anim/DataFlow";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

/**
 * A centred headline, a line of grey, two ways forward, and the product below.
 *
 * The previous version filled the first screen with a dark field and set the
 * type over it. That reads as atmosphere; this reads as a claim. The animation
 * still opens the page, but it sits under the words in a frame of its own,
 * where it can be looked at rather than looked through.
 *
 * Nothing here is monospaced and nothing is letter-spaced open. Those two
 * habits, more than any colour, were what made the earlier page look assembled
 * from parts.
 */

const STAGES: DictKey[] = [
  "hero.chain.1.label",
  "hero.chain.2.label",
  "hero.chain.3.label",
  "hero.chain.4.label",
  "hero.chain.5.label",
];

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
          <figure className="overflow-hidden rounded-[28px] bg-bg-secondary">
            <div className="h-[240px] sm:h-[340px] lg:h-[420px]">
              <DataFlow className="h-full w-full" />
            </div>
            <figcaption>
              <ol className="grid grid-cols-5 border-t border-border-subtle/60">
                {STAGES.map((key, i) => (
                  <li
                    key={key}
                    className={
                      "px-2 py-3.5 text-center text-[0.6875rem] text-fg-secondary sm:text-[0.8125rem]" +
                      (i > 0 ? " border-l border-border-subtle/60" : "")
                    }
                  >
                    {t(key)}
                  </li>
                ))}
              </ol>
            </figcaption>
          </figure>
          <p className="caption mt-4 text-center">{t("hero.chain.caption")}</p>
        </div>
      </HeroReveal>
    </section>
  );
}
