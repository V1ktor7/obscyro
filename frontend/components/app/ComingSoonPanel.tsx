"use client";

import { Clock } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

export default function ComingSoonPanel({
  eyebrowKey,
  bodyKey,
}: {
  eyebrowKey: DictKey;
  bodyKey: DictKey;
}) {
  const t = useT();
  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em]">
          {t(eyebrowKey)}
        </p>
        <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tighter sm:text-3xl lg:text-4xl">
          {t("app.comingSoon.title")}
        </h1>
      </header>
      <div className="flex items-start gap-3 rounded-xl border border-border-subtle bg-bg-secondary p-5 sm:p-6">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-fg-secondary" aria-hidden />
        <p className="text-sm text-fg-secondary">{t(bodyKey)}</p>
      </div>
    </div>
  );
}
