"use client";

import { ArrowRight, BookOpen, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";

/**
 * Where the pricing table used to be.
 *
 * Nothing is for sale yet, and a page that prints monthly tiers while the
 * product is in test says something untrue about how far along it is. This is a
 * way to reach the people building it, not a funnel: no form, so nothing is
 * collected, nothing is stored, and there is no privacy surface to defend.
 *
 * The mailto carries a subject line so a message does not arrive as "(no
 * subject)", and the list beside it says what is actually useful to include —
 * which is a better filter than any qualifying form field.
 */

const MAILTO =
  "mailto:obscyro-team@obscyro.com" +
  "?subject=" +
  encodeURIComponent("Obscyro — interested");

export default function Contact() {
  const t = useT();

  const points = [t("contact.p1"), t("contact.p2"), t("contact.p3")];

  return (
    <section id="contact" className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
            {t("contact.eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl">
            {t("contact.title")}
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-fg-secondary sm:text-base">
            {t("contact.subtitle")}
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:mt-14 sm:gap-6 md:grid-cols-[1.1fr_1fr]">
          <div className="rounded-xl border border-border-subtle bg-bg-secondary p-5 sm:p-6">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-fg-secondary sm:text-[0.65rem]">
              {t("contact.what")}
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {points.map((point, i) => (
                <li key={point} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 shrink-0 font-mono text-[0.65rem] tabular-nums text-fg-secondary"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm leading-relaxed text-fg-secondary">{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col justify-between gap-5 rounded-xl border border-border-subtle bg-bg-secondary p-5 sm:p-6">
            <div>
              <Button href={MAILTO} size="lg" width="fullMobile">
                <Mail className="h-4 w-4 shrink-0" />
                {t("contact.cta")}
              </Button>
              <p className="mt-3 font-mono text-[0.7rem] leading-relaxed text-fg-secondary">
                obscyro-team@obscyro.com
              </p>
            </div>

            <div className="border-t border-border-subtle pt-4">
              <p className="text-sm leading-relaxed text-fg-secondary">
                {t("contact.orExplore")}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button href="/studio" size="sm" variant="secondary" width="fullMobile">
                  {t("contact.exploreStudio")}
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                </Button>
                <Button href="/docs" size="sm" variant="secondary" width="fullMobile">
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  {t("contact.exploreDocs")}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-[0.7rem] leading-relaxed text-fg-secondary sm:mt-8">
          {t("contact.noSales")}
        </p>
      </div>
    </section>
  );
}
