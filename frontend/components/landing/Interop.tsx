"use client";

import { useT } from "@/lib/i18n/context";
import InteropRings from "./anim/InteropRings";

/**
 * The first pillar, shown on the mark itself.
 *
 * The rings drift apart and back together; when they meet, the lens between
 * them lights and the modelled objects on the right resolve. The copy beside it
 * says what the lens is: not a merge, not a copy, but the part two sources
 * agree on — which is the only part a decision can rest on.
 */
export default function Interop() {
  const t = useT();

  const notes = [
    { k: "interop.note1.title", b: "interop.note1.body" },
    { k: "interop.note2.title", b: "interop.note2.body" },
  ] as const;

  return (
    <section className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
              {t("interop.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl lg:text-5xl">
              {t("interop.title")}
            </h2>
            <p className="mt-4 text-pretty text-sm leading-relaxed text-fg-secondary sm:text-base">
              {t("interop.subtitle")}
            </p>

            <dl className="mt-8 flex flex-col gap-5">
              {notes.map((n) => (
                <div key={n.k} className="border-l border-border-subtle pl-4">
                  <dt className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-fg-primary">
                    {t(n.k)}
                  </dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-fg-secondary">
                    {t(n.b)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 sm:p-8">
            <InteropRings />
            <p className="mt-4 border-t border-border-subtle pt-3 text-center font-mono text-[0.6rem] uppercase tracking-[0.2em] text-fg-secondary">
              {t("interop.caption")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
