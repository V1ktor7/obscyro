"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

type TierId = "free" | "starter" | "pro";

interface TierDef {
  id: TierId;
  features: 4;
  highlight?: boolean;
}

const TIERS: TierDef[] = [
  { id: "free", features: 4 },
  { id: "starter", features: 4, highlight: true },
  { id: "pro", features: 4 },
];

const HIGHLIGHT = TIERS.find((t) => t.highlight)!;
const OTHERS = TIERS.filter((t) => !t.highlight);

export default function Pricing() {
  const t = useT();

  return (
    <section id="pricing" className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
            {t("pricing.eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl">
            {t("pricing.title")}
          </h2>
          <p className="mt-3 text-pretty text-sm text-fg-secondary sm:mt-4 sm:text-base">
            {t("pricing.subtitle")}
          </p>
        </div>

        {/* Desktop (lg+): 3-col grid */}
        <div className="mt-10 hidden gap-5 sm:mt-14 lg:grid lg:grid-cols-3">
          {TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} />
          ))}
        </div>

        {/* Tablette (md-lg): asymétrique — highlight full-width, others 2-col below */}
        <div className="mt-10 hidden gap-5 sm:mt-14 md:flex md:flex-col lg:hidden">
          <TierCard tier={HIGHLIGHT} variant="wide" />
          <div className="grid grid-cols-2 gap-5">
            {OTHERS.map((tier) => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </div>
        </div>

        {/* Mobile (<md): highlight first, then others */}
        <div className="mt-10 flex flex-col gap-5 md:hidden">
          <TierCard tier={HIGHLIGHT} />
          {OTHERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} />
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

function TierCard({
  tier,
  variant = "stack",
}: {
  tier: TierDef;
  variant?: "stack" | "wide";
}) {
  const t = useT();
  const wide = variant === "wide";
  return (
    <div
      className={cn(
        "relative flex rounded-xl border bg-bg-secondary p-5 transition-all sm:p-6 lg:p-7",
        tier.highlight
          ? "border-fg-primary shadow-accent-soft"
          : "border-border-subtle hover:border-fg-secondary/40",
        wide ? "flex-col gap-6 md:flex-row md:items-center" : "flex-col",
      )}
    >
      {tier.highlight ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-1 font-mono text-[0.55rem] uppercase tracking-[0.22em] text-accent-fg sm:text-[0.6rem] sm:tracking-[0.25em]">
          {t("pricing.popular")}
        </div>
      ) : null}

      <div className={cn(wide ? "md:flex-1" : "")}>
        <h3 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
          {t(`pricing.${tier.id}.name` as DictKey)}
        </h3>
        <div className="mt-3 flex items-baseline gap-1 sm:mt-4">
          <span className="text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl">
            {t(`pricing.${tier.id}.price` as DictKey)}
          </span>
          <span className="text-sm text-fg-secondary">
            {t(`pricing.${tier.id}.period` as DictKey)}
          </span>
        </div>
        <p className="mt-3 text-sm text-fg-secondary">
          {t(`pricing.${tier.id}.desc` as DictKey)}
        </p>
      </div>

      <ul
        className={cn(
          "mt-5 space-y-2.5 sm:mt-6",
          wide && "md:mt-0 md:flex-1 md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-2.5 md:space-y-0",
        )}
      >
        {[1, 2, 3, 4].map((i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
            <span>{t(`pricing.${tier.id}.f${i}` as DictKey)}</span>
          </li>
        ))}
      </ul>

      <div className={cn("mt-6 sm:mt-7", wide && "md:ml-6 md:mt-0 md:shrink-0")}>
        <Button
          href="/sign-up"
          variant={tier.highlight ? "primary" : "secondary"}
          width={wide ? "auto" : "full"}
        >
          {t(`pricing.${tier.id}.cta` as DictKey)}
        </Button>
      </div>
    </div>
  );
}
