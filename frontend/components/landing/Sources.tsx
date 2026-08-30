"use client";

import { useT } from "@/lib/i18n/context";

/**
 * What the demonstration actually runs on.
 *
 * The reference puts customer quotes here. Obscyro has no customers to quote,
 * and a landing page carrying invented praise is the one thing that would make
 * every other claim on it worthless — so this row holds the published files the
 * Studio really reads instead. Same rhythm, and it can be checked: every one of
 * these is a public dataset with a publisher and a period.
 *
 * The corner cut is borrowed. It is the only ornament on the page, and it earns
 * its place by marking these as documents rather than panels.
 */

const CARDS = [
  { org: "sources.c1.org", body: "sources.c1.body", meta: "sources.c1.meta" },
  { org: "sources.c2.org", body: "sources.c2.body", meta: "sources.c2.meta" },
  { org: "sources.c3.org", body: "sources.c3.body", meta: "sources.c3.meta" },
  { org: "sources.c4.org", body: "sources.c4.body", meta: "sources.c4.meta" },
] as const;

export default function Sources() {
  const t = useT();

  return (
    <section className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          {t("sources.title")}
        </h2>
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-fg-secondary sm:text-base">
          {t("sources.subtitle")}
        </p>

        <ul className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((c) => (
            <li
              key={c.org}
              className="flex flex-col justify-between bg-bg-secondary p-5 sm:p-6"
              style={{
                // The cut corner, drawn rather than faked with a rotated square
                // so it survives any background behind the card.
                clipPath:
                  "polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%)",
              }}
            >
              <p className="font-mono text-[0.6rem] uppercase leading-relaxed tracking-[0.16em] text-fg-secondary">
                {t(c.org)}
              </p>
              <p className="mt-8 text-sm leading-relaxed text-fg-primary">{t(c.body)}</p>
              <p className="mt-4 font-mono text-[0.65rem] text-fg-secondary">{t(c.meta)}</p>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs leading-relaxed text-fg-secondary">
          {t("sources.note")}
        </p>
      </div>
    </section>
  );
}
