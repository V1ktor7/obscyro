"use client";

import { useT } from "@/lib/i18n/context";
import Globe from "./anim/Globe";

/**
 * The second pillar, and the claim the globe is there to make.
 *
 * A rotating world behind a health product is usually decoration. Here it
 * carries an argument the engine actually supports: its mechanics are
 * arithmetic over capacity, occupancy and travel time, and not one of them
 * knows the name of a city or of a disease. The demonstration runs on Montréal
 * because that is where the published data is, not because the model was built
 * for it.
 *
 * The three figures beside it name what a comparison is scored on. They are
 * axes, not results — a landing page has no room to carry the context a real
 * number would need.
 */
export default function Optimisation() {
  const t = useT();

  const axes = [
    { k: "optim.axis1.title", b: "optim.axis1.body" },
    { k: "optim.axis2.title", b: "optim.axis2.body" },
    { k: "optim.axis3.title", b: "optim.axis3.body" },
  ] as const;

  return (
    <section className="relative overflow-hidden border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="relative order-2 lg:order-1">
            <div className="relative mx-auto aspect-square w-full max-w-[460px]">
              <Globe className="absolute inset-0 h-full w-full" />
            </div>
            <p className="mt-2 text-center font-mono text-[0.6rem] uppercase tracking-[0.2em] text-fg-secondary">
              {t("optim.caption")}
            </p>
          </div>

          <div className="order-1 lg:order-2">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
              {t("optim.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl lg:text-5xl">
              {t("optim.title")}
            </h2>
            <p className="mt-4 text-pretty text-sm leading-relaxed text-fg-secondary sm:text-base">
              {t("optim.subtitle")}
            </p>

            <dl className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-3">
              {axes.map((a) => (
                <div key={a.k} className="bg-bg-secondary p-4">
                  <dt className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-primary">
                    {t(a.k)}
                  </dt>
                  <dd className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
                    {t(a.b)}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-5 text-sm leading-relaxed text-fg-secondary">
              {t("optim.dominance")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
