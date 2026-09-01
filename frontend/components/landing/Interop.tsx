"use client";

import { useT } from "@/lib/i18n/context";
import InteropRings from "./anim/InteropRings";

/**
 * The first pillar, shown on the mark itself.
 *
 * The rings drift apart and back together; when they meet, the region between
 * them fills and the modelled objects resolve. The copy above says what that
 * region is — not a merge and not a copy, but the part two sources agree on,
 * which is the only part a decision can rest on.
 */
export default function Interop() {
  const t = useT();
  const notes = [
    { k: "interop.note1.title", b: "interop.note1.body" },
    { k: "interop.note2.title", b: "interop.note2.body" },
  ] as const;

  return (
    <section className="py-24 sm:py-32">
      <div className="container max-w-[980px]">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="display-lg text-balance">{t("interop.title")}</h2>
          <p className="body-lg mt-5 text-balance">{t("interop.subtitle")}</p>
        </div>

        <div className="mt-14 panel px-5 py-10 sm:mt-16 sm:px-12 sm:py-14">
          <InteropRings />
        </div>

        <dl className="mt-14 grid gap-10 sm:mt-16 sm:grid-cols-2 sm:gap-12">
          {notes.map((n) => (
            <div key={n.k}>
              <dt className="text-[1.0625rem] font-medium tracking-[-0.004em] text-fg-primary">
                {t(n.k)}
              </dt>
              <dd className="body-md mt-3">{t(n.b)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
