"use client";

import { ArrowDown } from "lucide-react";
import DataFlow from "./anim/DataFlow";
import HeroReveal from "./HeroReveal";
import { useT } from "@/lib/i18n/context";
import type { DictKey } from "@/lib/i18n/dictionary";

/**
 * A full-height opening: the network moving, and one sentence over it.
 *
 * The reference this follows fills the first screen with a single cinematic
 * frame and one line of display type, and puts everything else below a scroll
 * cue. That format only works if the frame is worth the screen it takes, so the
 * frame here is the product's own chain — five columns of nodes, packets
 * crossing them left to right — rather than stock footage.
 *
 * The scrim is doing real work. Display type over a moving field is unreadable
 * without one, and a flat overlay would grey the animation out everywhere; this
 * is darkest through the middle band where the words sit and clears at the
 * edges where the graph is the only thing to see.
 */

const STAGES: DictKey[] = [
  "hero.chain.1.label",
  "hero.chain.2.label",
  "hero.chain.3.label",
  "hero.chain.4.label",
  "hero.chain.5.label",
];

export default function HeroShell() {
  const t = useT();

  return (
    <section className="relative flex min-h-[calc(100svh-3.5rem)] flex-col overflow-hidden border-b border-border-subtle">
      <div className="absolute inset-0" aria-hidden>
        <DataFlow className="h-full w-full" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,9,12,0.55) 0%, rgba(8,9,12,0.88) 42%, rgba(8,9,12,0.88) 62%, rgba(8,9,12,0.55) 100%)",
          }}
        />
      </div>

      <div className="relative flex flex-1 items-center">
        <div className="container">
          <HeroReveal className="mx-auto max-w-5xl text-center">
            <h1 className="text-balance text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.04em] text-fg-primary sm:text-6xl lg:text-7xl xl:text-[5.25rem]">
              {t("hero.title")}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-fg-secondary sm:mt-8 sm:text-lg">
              {t("hero.subtitle")}
            </p>
          </HeroReveal>
        </div>
      </div>

      <div className="relative">
        <ol className="grid grid-cols-5 border-t border-border-subtle backdrop-blur-[2px]">
          {STAGES.map((key, i) => (
            <li
              key={key}
              className={
                "px-2 py-3 text-center font-mono text-[0.5rem] uppercase tracking-[0.14em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.24em]" +
                (i > 0 ? " border-l border-border-subtle" : "")
              }
            >
              {t(key)}
            </li>
          ))}
        </ol>
        <div className="flex justify-center py-5">
          <ArrowDown className="h-4 w-4 animate-bounce text-fg-secondary" aria-hidden />
        </div>
      </div>
    </section>
  );
}
