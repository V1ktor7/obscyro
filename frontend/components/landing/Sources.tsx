"use client";

import { useT } from "@/lib/i18n/context";

/**
 * What the demonstration actually runs on.
 *
 * The obvious thing to put here is customer praise. Obscyro has none to quote,
 * and a page carrying invented endorsements would make every other claim on it
 * worthless — so this row holds the published files the Studio really reads.
 * Each has a publisher and a period, so a reader can go and check.
 *
 * The note underneath is the strongest thing on the page and it is an admission:
 * one of these arrived broken, the platform caught it, and it was fixed.
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
    <section className="py-24 sm:py-32">
      <div className="container max-w-[1120px]">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="display-lg text-balance">{t("sources.title")}</h2>
          <p className="body-lg mt-5 text-balance">{t("sources.subtitle")}</p>
        </div>

        <ul className="mt-14 grid gap-5 sm:mt-20 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((c) => (
            <li
              key={c.org}
              className="flex flex-col panel p-7"
            >
              <p className="text-[0.9375rem] font-medium tracking-[-0.004em] text-fg-primary">
                {t(c.org)}
              </p>
              <p className="body-md mt-4 flex-1 text-[0.9375rem]">{t(c.body)}</p>
              <p className="caption mt-6">{t(c.meta)}</p>
            </li>
          ))}
        </ul>

        <p className="body-md mx-auto mt-10 max-w-[46rem] text-center">
          {t("sources.note")}
        </p>
      </div>
    </section>
  );
}
