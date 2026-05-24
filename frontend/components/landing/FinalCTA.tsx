"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";

export default function FinalCTA() {
  const t = useT();
  return (
    <section className="relative overflow-hidden border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="absolute inset-0 -z-10 grid-bg opacity-40" aria-hidden />
      <div className="container">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tighter sm:text-5xl lg:text-6xl">
            {t("finalCta.title")}
          </h2>
          <p className="mt-3 text-pretty text-base text-fg-secondary sm:mt-4 sm:text-lg">
            {t("finalCta.subtitle")}
          </p>
          <div className="mt-7 w-full sm:mt-8 sm:w-auto">
            <Button href="/sign-up" size="lg" width="fullMobile">
              {t("finalCta.cta")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
