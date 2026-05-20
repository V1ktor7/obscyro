"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

interface TierDef {
  id: "free" | "starter" | "pro";
  features: 4;
  highlight?: boolean;
}

const TIERS: TierDef[] = [
  { id: "free", features: 4 },
  { id: "starter", features: 4, highlight: true },
  { id: "pro", features: 4 },
];

export default function Pricing() {
  const t = useT();

  return (
    <section id="pricing" className="border-b border-border-subtle py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-fg-secondary">
            {t("pricing.eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
            {t("pricing.title")}
          </h2>
          <p className="mt-4 text-fg-secondary">{t("pricing.subtitle")}</p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-xl border bg-bg-secondary p-7 transition-all",
                tier.highlight
                  ? "border-fg-primary shadow-accent-soft"
                  : "border-border-subtle hover:border-fg-secondary/40",
              )}
            >
              {tier.highlight ? (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-accent-fg">
                  {t("pricing.popular")}
                </div>
              ) : null}
              <h3 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
                {t(`pricing.${tier.id}.name` as DictKey)}
              </h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tighter">
                  {t(`pricing.${tier.id}.price` as DictKey)}
                </span>
                <span className="text-sm text-fg-secondary">
                  {t(`pricing.${tier.id}.period` as DictKey)}
                </span>
              </div>
              <p className="mt-3 text-sm text-fg-secondary">
                {t(`pricing.${tier.id}.desc` as DictKey)}
              </p>
              <ul className="mt-6 space-y-2.5">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{t(`pricing.${tier.id}.f${i}` as DictKey)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <Button
                  href="/sign-up"
                  variant={tier.highlight ? "primary" : "secondary"}
                  className="w-full"
                >
                  {t(`pricing.${tier.id}.cta` as DictKey)}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-fg-secondary">
          {t("pricing.enterprise")}{" "}
          <a
            href="mailto:obscyro-team@obscyro.com"
            className="font-medium text-fg-primary underline decoration-border-subtle underline-offset-4 transition-colors hover:decoration-fg-primary"
          >
            {t("pricing.enterpriseCta")}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
