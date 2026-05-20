"use client";

import {
  ArrowLeftRight,
  BadgeCheck,
  Brain,
  Filter,
  Network,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import StaticCodeBlock from "@/components/ui/StaticCodeBlock";
import FeatureReveal from "./FeatureReveal";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

export interface FeatureSnippet {
  id: "validate" | "normalize" | "translate" | "expand" | "disambiguate" | "reason";
  language: "bash" | "json";
  rawValue: string;
  html: string;
}

const ICONS: Record<FeatureSnippet["id"], LucideIcon> = {
  validate: BadgeCheck,
  normalize: Wand2,
  translate: ArrowLeftRight,
  expand: Network,
  disambiguate: Filter,
  reason: Brain,
};

export default function FeaturesShell({
  snippets,
}: {
  snippets: FeatureSnippet[];
}) {
  const t = useT();

  return (
    <section className="border-b border-border-subtle py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-fg-secondary">
            {t("features.eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
            {t("features.title")}
          </h2>
          <p className="mt-4 text-fg-secondary">{t("features.subtitle")}</p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {snippets.map((snippet, i) => {
            const Icon = ICONS[snippet.id];
            return (
              <FeatureReveal key={snippet.id} index={i}>
                <article className="group flex h-full flex-col rounded-xl border border-border-subtle bg-bg-secondary p-6 transition-all hover:border-fg-secondary/40">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md border border-border-subtle bg-bg-tertiary p-2 transition-colors group-hover:border-fg-primary/30">
                      <Icon className="h-4 w-4 text-fg-primary" aria-hidden />
                    </div>
                    <h3 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
                      {t(`features.${snippet.id}.title` as DictKey)}
                    </h3>
                  </div>
                  <p className="mt-3 text-sm text-fg-secondary">
                    {t(`features.${snippet.id}.desc` as DictKey)}
                  </p>
                  <div className="mt-5 flex-1">
                    <StaticCodeBlock
                      html={snippet.html}
                      rawValue={snippet.rawValue}
                      language={snippet.language}
                      showCopy={false}
                      solidDarkCode
                    />
                  </div>
                </article>
              </FeatureReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
