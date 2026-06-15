"use client";

import { useT } from "@/lib/i18n/context";

type Layer = {
  label: string;
  title: string;
  body: string;
};

export default function Architecture() {
  const t = useT();

  const layers: Layer[] = [
    {
      label: t("arch.layer1.label"),
      title: t("arch.layer1.title"),
      body: t("arch.layer1.body"),
    },
    {
      label: t("arch.layer2.label"),
      title: t("arch.layer2.title"),
      body: t("arch.layer2.body"),
    },
    {
      label: t("arch.layer3.label"),
      title: t("arch.layer3.title"),
      body: t("arch.layer3.body"),
    },
    {
      label: t("arch.layer4.label"),
      title: t("arch.layer4.title"),
      body: t("arch.layer4.body"),
    },
  ];

  return (
    <section className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
            {t("arch.eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl">
            {t("arch.title")}
          </h2>
          <p className="mt-4 text-balance text-sm leading-relaxed text-fg-secondary sm:text-base">
            {t("arch.subtitle")}
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl sm:mt-14">
          <div className="flex flex-col gap-2.5">
            {layers.map((layer, i) => (
              <div key={layer.label} className="flex flex-col items-center gap-2.5">
                <div className="w-full rounded-xl border border-border-subtle bg-bg-secondary p-4 transition-colors hover:border-fg-secondary/40 sm:p-5">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <span className="mt-0.5 shrink-0 font-mono text-[0.65rem] tabular-nums text-fg-secondary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.2em]">
                        {layer.label}
                      </div>
                      <h3 className="mt-1.5 text-base font-semibold tracking-tight sm:text-lg">
                        {layer.title}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary">
                        {layer.body}
                      </p>
                    </div>
                  </div>
                </div>
                {i < layers.length - 1 ? (
                  <span aria-hidden className="h-4 w-px bg-border-subtle" />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
