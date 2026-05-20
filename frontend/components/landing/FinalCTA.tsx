"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n/context";

export default function FinalCTA() {
  const t = useT();
  return (
    <section className="relative overflow-hidden border-b border-border-subtle py-24">
      <div className="absolute inset-0 -z-10 grid-bg opacity-40" aria-hidden />
      <div className="container">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <h2 className="text-balance text-4xl font-semibold tracking-tighter sm:text-5xl">
            {t("finalCta.title")}
          </h2>
          <p className="mt-4 text-pretty text-lg text-fg-secondary">
            {t("finalCta.subtitle")}
          </p>
          <div className="mt-8">
            <Button href="/sign-up" size="lg">
              {t("finalCta.cta")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
