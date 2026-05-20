"use client";

import { useLocale } from "@/lib/i18n/context";
import { LOCALES } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/cn";

export default function LangToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-border-subtle bg-bg-secondary p-0.5 font-mono text-[0.65rem] uppercase tracking-[0.2em]",
        className,
      )}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-full items-center rounded px-2 transition-colors",
              active
                ? "bg-accent text-accent-fg"
                : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
