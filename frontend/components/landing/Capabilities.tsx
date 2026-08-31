"use client";

import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

/**
 * Four layers, four cards.
 *
 * They are ordered — connect before model, model before run, run before decide
 * — so the cards are numbered. A twin with nothing modelled has nothing to run,
 * and a grid of equal tiles would hide that.
 *
 * The number is small and grey rather than set as a display element. It is
 * there for the reader who wonders whether the order matters, not as a
 * structural flourish.
 */

interface Layer {
  n: string;
  name: DictKey;
  title: DictKey;
  body: DictKey;
}

const LAYERS: Layer[] = [
  { n: "1", name: "arch.layer1.label", title: "arch.layer1.title", body: "arch.layer1.body" },
  { n: "2", name: "arch.layer2.label", title: "arch.layer2.title", body: "arch.layer2.body" },
  { n: "3", name: "arch.layer3.label", title: "arch.layer3.title", body: "arch.layer3.body" },
  { n: "4", name: "arch.layer4.label", title: "arch.layer4.title", body: "arch.layer4.body" },
];

export default function Capabilities() {
  const t = useT();

  return (
    <section className="py-24 sm:py-32">
      <div className="container max-w-[1120px]">
        <div className="mx-auto max-w-[720px] text-center">
          <h2 className="display-lg text-balance">{t("arch.title")}</h2>
          <p className="body-lg mt-5 text-balance">{t("arch.subtitle")}</p>
        </div>

        <ol className="mt-14 grid gap-5 sm:mt-20 sm:grid-cols-2">
          {LAYERS.map((layer) => (
            <li key={layer.n} className="rounded-[24px] bg-bg-secondary p-8 sm:p-10">
              <p className="caption">{layer.n}</p>
              <h3 className="display-md mt-5">{t(layer.name)}</h3>
              <p className="mt-2 text-[1.0625rem] font-medium tracking-[-0.004em] text-fg-primary">
                {t(layer.title)}
              </p>
              <p className="body-md mt-4">{t(layer.body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
