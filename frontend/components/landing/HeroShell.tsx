"use client";

import { ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Mark from "@/components/brand/Mark";
import HeroReveal from "./HeroReveal";
import DataFlow from "./anim/DataFlow";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

/**
 * The hero opens on the network moving, not on a curl call.
 *
 * The canvas behind the copy is the product's own chain — five columns of
 * nodes, packets travelling left to right, a node lighting up when a record
 * lands on it. It sits at low contrast and is masked away from the headline, so
 * it reads as the ground the words stand on rather than as something competing
 * with them.
 *
 * The stage names are printed under it. Without them the graphic is an
 * attractive abstraction; with them it is a claim about what the software does,
 * which is the only reason to animate anything on a page like this.
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

  const stats = [
    { label: t("hero.stat.edition"), value: t("hero.stat.editionValue") },
    { label: t("hero.stat.translate"), value: t("hero.stat.translateValue") },
    { label: t("hero.stat.phase"), value: t("hero.stat.phaseValue") },
  ];

  return (
    <section className="relative overflow-hidden border-b border-border-subtle">
      <div className="absolute inset-0 -z-10 grid-bg opacity-[0.35]" aria-hidden />

      <div className="container relative py-14 sm:py-20 lg:py-24">
        <HeroReveal className="w-full">
          <div className="flex items-center gap-3">
            <Mark className="h-7 w-auto text-fg-primary sm:h-8" />
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.3em] text-fg-secondary">
              {t("hero.pill.beta")}
            </span>
          </div>

          <h1 className="mt-7 max-w-4xl text-balance text-[2.25rem] font-semibold leading-[1.03] tracking-[-0.035em] text-fg-primary sm:text-6xl lg:text-7xl">
            {t("hero.title")}
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-fg-secondary sm:mt-6 sm:text-lg">
            {t("hero.subtitle")}
          </p>

          <div className="mt-8 flex w-full min-w-0 flex-col gap-3 sm:flex-row">
            <Button href="/studio" size="lg" width="fullMobile">
              {t("hero.cta.studio")}
              <ArrowRight className="h-4 w-4 shrink-0" />
            </Button>
            <Button href="/docs" size="lg" variant="secondary" width="fullMobile">
              <BookOpen className="h-4 w-4 shrink-0" />
              {t("hero.cta.docs")}
            </Button>
          </div>
        </HeroReveal>

        <HeroReveal delay={0.18} className="mt-12 w-full sm:mt-16">
          <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-bg-secondary">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-fg-secondary">
                {t("hero.chain.title")}
              </span>
              <span className="hidden font-mono text-[0.6rem] uppercase tracking-[0.22em] text-fg-secondary sm:block">
                {t("hero.chain.caption")}
              </span>
            </div>

            <div className="relative h-[210px] sm:h-[280px] lg:h-[340px]">
              <DataFlow className="absolute inset-0 h-full w-full" />
            </div>

            <ol className="grid grid-cols-5 border-t border-border-subtle">
              {STAGES.map((key, i) => (
                <li
                  key={key}
                  className={
                    "px-2 py-2.5 text-center font-mono text-[0.55rem] uppercase tracking-[0.14em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em]" +
                    (i > 0 ? " border-l border-border-subtle" : "")
                  }
                >
                  {t(key)}
                </li>
              ))}
            </ol>
          </div>
        </HeroReveal>

        <dl className="mt-10 grid max-w-3xl grid-cols-3 gap-4 sm:gap-8">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="font-mono text-[0.5rem] uppercase leading-tight tracking-[0.16em] text-fg-secondary sm:text-[0.62rem] sm:tracking-[0.22em]">
                {stat.label}
              </dt>
              <dd className="mt-1.5 font-mono text-base font-semibold tracking-tight text-fg-primary sm:text-xl">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
