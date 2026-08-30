"use client";

import { useT } from "@/lib/i18n/context";

/**
 * One sentence, at the size of a headline, on an inverted ground.
 *
 * The page is dark end to end, so this section flips to light instead of
 * arriving as another dark panel. The break is the point: a reader who has
 * scrolled past a full-screen hero needs somewhere for the eye to reset before
 * the detail starts.
 *
 * The greyed phrase is not decoration either. It marks the half of the claim
 * that is a method rather than an outcome — the part a careful reader should
 * push on.
 */
export default function Statement() {
  const t = useT();

  return (
    <section className="border-b border-border-subtle bg-[#f4f5f7] py-16 text-[#0d1014] sm:py-24 lg:py-32">
      <div className="container">
        <p className="max-w-5xl text-balance text-[1.75rem] font-semibold leading-[1.14] tracking-[-0.035em] sm:text-[2.6rem] lg:text-[3.4rem]">
          {t("statement.lead")}{" "}
          <span className="text-[#9aa1ac]">{t("statement.muted")}</span>{" "}
          {t("statement.tail")}
        </p>
      </div>
    </section>
  );
}
