"use client";

import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

/**
 * The four layers, as a numbered list with the name at display size.
 *
 * This is the reference's product-list pattern: a short description held left
 * at body size, an index in the gutter, and the name set large enough to be
 * read across a room. It suits four layers far better than four equal cards
 * did, because these are ordered — connect before model, model before run, run
 * before decide — and a numbered list says that where a grid cannot.
 *
 * The indices are real information rather than styling. Skipping a layer is not
 * possible: a twin with nothing modelled has nothing to run.
 */

interface Layer {
  index: string;
  name: DictKey;
  body: DictKey;
}

const LAYERS: Layer[] = [
  { index: "/0.1", name: "arch.layer1.label", body: "arch.layer1.body" },
  { index: "/0.2", name: "arch.layer2.label", body: "arch.layer2.body" },
  { index: "/0.3", name: "arch.layer3.label", body: "arch.layer3.body" },
  { index: "/0.4", name: "arch.layer4.label", body: "arch.layer4.body" },
];

export default function Capabilities() {
  const t = useT();

  return (
    <section className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          {t("arch.title")}
        </h2>
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-fg-secondary sm:text-base">
          {t("arch.subtitle")}
        </p>

        <ol className="mt-10 sm:mt-14">
          {LAYERS.map((layer) => (
            <li
              key={layer.index}
              className="group grid items-center gap-3 border-t border-border-subtle py-8 sm:gap-8 sm:py-12 md:grid-cols-[minmax(0,20rem)_1fr] lg:py-16"
            >
              <div>
                <p className="max-w-xs text-sm leading-relaxed text-fg-secondary">
                  {t(layer.body)}
                </p>
                <p className="mt-6 font-mono text-[0.7rem] tabular-nums text-fg-secondary/70">
                  {layer.index}
                </p>
              </div>
              <p className="text-[2.75rem] font-semibold leading-none tracking-[-0.045em] text-fg-primary transition-colors sm:text-[4.5rem] lg:text-[6rem]">
                {t(layer.name)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
