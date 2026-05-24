"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  BadgeCheck,
  ChevronDown,
  Filter,
  Network,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import StaticCodeBlock from "@/components/ui/StaticCodeBlock";
import FeatureReveal from "./FeatureReveal";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/cn";

export interface FeatureSnippet {
  id: "validate" | "normalize" | "translate" | "expand" | "disambiguate";
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
};

export default function FeaturesShell({
  snippets,
}: {
  snippets: FeatureSnippet[];
}) {
  const t = useT();

  return (
    <section className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
            {t("features.eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl">
            {t("features.title")}
          </h2>
          <p className="mt-3 text-pretty text-sm text-fg-secondary sm:mt-4 sm:text-base">
            {t("features.subtitle")}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-14 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
          {snippets.map((snippet, i) => (
            <FeatureReveal key={snippet.id} index={i}>
              <FeatureCard snippet={snippet} />
            </FeatureReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ snippet }: { snippet: FeatureSnippet }) {
  const t = useT();
  const Icon = ICONS[snippet.id];
  const [open, setOpen] = useState(false);

  return (
    <article className="group flex h-full flex-col rounded-xl border border-border-subtle bg-bg-secondary p-5 transition-all hover:border-fg-secondary/40 sm:p-6">
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

      {/* md+: code block always visible */}
      <div className="mt-5 hidden flex-1 md:block">
        <StaticCodeBlock
          html={snippet.html}
          rawValue={snippet.rawValue}
          language={snippet.language}
          showCopy={false}
          solidDarkCode
        />
      </div>

      {/* mobile: collapsible to avoid a wall of scroll */}
      <div className="mt-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-primary px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary transition-colors hover:text-fg-primary"
        >
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
            aria-hidden
          />
          {open ? t("features.hideExample") : t("features.showExample")}
        </button>
        {open ? (
          <div className="mt-3">
            <StaticCodeBlock
              html={snippet.html}
              rawValue={snippet.rawValue}
              language={snippet.language}
              showCopy={false}
              solidDarkCode
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
