"use client";

import { useT } from "@/lib/i18n/context";
import Globe from "./anim/Globe";

/**
 * The second pillar, and the claim the globe is there to make.
 *
 * A rotating world behind a health product is usually decoration. Here it
 * carries an argument the engine supports: its mechanics are arithmetic over
 * capacity, occupancy and travel time, and not one of them knows the name of a
 * city or of a disease. The demonstration runs on Montréal because that is
 * where the published data is, not because the model was built for it.
 *
 * The three figures below name what a comparison is scored on. They are axes,
 * not results — a landing page has no room to carry the context a real number
 * would need to be honest.
 */
export default function Optimisation() {
  const t = useT();
  const axes = [
    { k: "optim.axis1.title", b: "optim.axis1.body" },
    { k: "optim.axis2.title", b: "optim.axis2.body" },
    { k: "optim.axis3.title", b: "optim.axis3.body" },
  ] as const;

  return (
    <section className="bg-bg-secondary py-24 sm:py-32">
      <div className="container max-w-[980px]">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="display-lg text-balance">{t("optim.title")}</h2>
          <p className="body-lg mt-5 text-balance">{t("optim.subtitle")}</p>
        </div>

        <div className="mx-auto mt-10 aspect-square w-full max-w-[440px] sm:mt-14">
          <Globe className="h-full w-full" />
        </div>

        <dl className="mt-10 grid gap-8 sm:mt-14 sm:grid-cols-3">
          {axes.map((a) => (
            <div key={a.k} className="rounded-[20px] bg-bg-primary p-6">
              <dt className="text-[1.0625rem] font-medium tracking-[-0.004em] text-fg-primary">
                {t(a.k)}
              </dt>
              <dd className="body-md mt-2 text-[0.9375rem]">{t(a.b)}</dd>
            </div>
          ))}
        </dl>

        <p className="body-md mx-auto mt-10 max-w-[42rem] text-center">
          {t("optim.dominance")}
        </p>
      </div>
    </section>
  );
}
