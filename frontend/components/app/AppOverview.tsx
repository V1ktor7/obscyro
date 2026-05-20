"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, KeyRound, LineChart } from "lucide-react";

import TestPhaseNotice from "@/components/site/TestPhaseNotice";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/cn";

const cards = [
  {
    href: "/app/keys",
    titleKey: "app.overview.card.keys.title" as const,
    descKey: "app.overview.card.keys.desc" as const,
    icon: KeyRound,
  },
  {
    href: "/app/usage",
    titleKey: "app.overview.card.usage.title" as const,
    descKey: "app.overview.card.usage.desc" as const,
    icon: LineChart,
  },
  {
    href: "/docs",
    titleKey: "app.overview.card.docs.title" as const,
    descKey: "app.overview.card.docs.desc" as const,
    icon: BookOpen,
  },
];

export default function AppOverview() {
  const t = useT();

  return (
    <div className="space-y-10">
      <header>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          {t("app.overview.eyebrow")}
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
          {t("app.overview.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-fg-secondary">{t("app.overview.subtitle")}</p>
      </header>

      <TestPhaseNotice variant="panel" />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, titleKey, descKey, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "group flex flex-col rounded-xl border border-border-subtle bg-bg-secondary p-5 transition-colors",
              "hover:border-fg-primary/15 hover:bg-bg-tertiary/60",
            )}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-bg-primary">
                <Icon className="h-4 w-4 text-fg-secondary" aria-hidden />
              </span>
              <ArrowUpRight
                className="h-4 w-4 shrink-0 text-fg-secondary opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
                aria-hidden
              />
            </div>
            <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-fg-primary">
              {t(titleKey)}
            </h2>
            <p className="mt-2 text-sm text-fg-secondary">{t(descKey)}</p>
          </Link>
        ))}
      </section>

      <section className="rounded-xl border border-border-subtle border-dashed bg-bg-secondary/50 p-6">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          {t("app.overview.quickStart.eyebrow")}
        </p>
        <div className="mt-4 space-y-3 font-mono text-[0.75rem] leading-relaxed text-fg-primary">
          <p>{t("app.overview.quickStart.line1")}</p>
          <p className="text-fg-secondary">{t("app.overview.quickStart.line2")}</p>
        </div>
      </section>
    </div>
  );
}
