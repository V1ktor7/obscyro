"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n/context";

/**
 * What is sold, in two parts, and how to get it.
 *
 * The page described the product well and never said what a network could
 * buy, or how — the contact section said it was not for sale. This is the
 * answer: the two layers the product is made of, each with what it contains
 * today, and the one way in.
 *
 * Every line below is something the platform does now. A list of offerings is
 * where roadmap items slip in as if they had shipped, and a buyer reads it as a
 * commitment.
 *
 * The two layers depend on each other, and the note under them says so:
 * decision support runs on what interoperability has connected. Presenting
 * them as two independent purchases would promise a twin with nothing to read.
 * Hence an ordered list — the first comes first.
 *
 * No price. Pricing is on request, and the page says that in a sentence rather
 * than hiding it behind a button labelled "Pricing".
 */
const LAYERS = [
  {
    eyebrow: "offer.a.eyebrow",
    title: "offer.a.title",
    body: "offer.a.body",
    items: ["offer.a.i1", "offer.a.i2", "offer.a.i3", "offer.a.i4"],
  },
  {
    eyebrow: "offer.b.eyebrow",
    title: "offer.b.title",
    body: "offer.b.body",
    items: ["offer.b.i1", "offer.b.i2", "offer.b.i3", "offer.b.i4"],
  },
] as const;

export default function Offer() {
  const t = useT();

  return (
    <section id="offer" className="scroll-mt-16 py-24 sm:py-32">
      <div className="container max-w-[1120px]">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="display-lg text-balance">{t("offer.title")}</h2>
          <p className="body-lg mt-5 text-balance">{t("offer.subtitle")}</p>
        </div>

        <ol className="mt-14 grid gap-5 sm:mt-20 lg:grid-cols-2">
          {LAYERS.map((layer) => (
            <li key={layer.eyebrow} className="flex flex-col panel p-7 sm:p-9">
              <p className="caption">{t(layer.eyebrow)}</p>
              <h3 className="mt-4 text-balance text-[1.375rem] font-medium leading-snug tracking-[-0.012em] text-fg-primary">
                {t(layer.title)}
              </h3>
              <p className="body-md mt-4 text-[0.9375rem]">{t(layer.body)}</p>
              <ul className="mt-7 flex flex-col gap-3 border-t border-border-subtle pt-6">
                {layer.items.map((item) => (
                  <li key={item} className="flex gap-3 text-[0.9375rem] text-fg-primary">
                    <span
                      className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                      aria-hidden
                    />
                    <span>{t(item)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-10 max-w-[46rem] text-center">
          <p className="body-md">{t("offer.dependency")}</p>
          <p className="mt-6 text-[1.0625rem] font-medium text-fg-primary">
            {t("offer.pricing")}
          </p>
          <Link href="#contact" className="pill mt-7 inline-flex">
            {t("demo.cta")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
