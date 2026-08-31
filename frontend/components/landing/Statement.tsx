"use client";

import { useT } from "@/lib/i18n/context";

/**
 * One sentence, at headline size, on the grey.
 *
 * The page alternates white and a single grey. This is the first switch, and it
 * exists to give the eye somewhere to rest between the opening claim and the
 * detail that follows. The greyed phrase inside marks the half of the sentence
 * that is a method rather than an outcome — the part worth pushing on.
 */
export default function Statement() {
  const t = useT();

  return (
    <section className="bg-bg-secondary py-24 sm:py-32 lg:py-40">
      <div className="container max-w-[980px]">
        <p className="display-lg text-balance">
          {t("statement.lead")}{" "}
          <span className="text-fg-secondary">{t("statement.muted")}</span>{" "}
          {t("statement.tail")}
        </p>
      </div>
    </section>
  );
}
