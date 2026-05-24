"use client";

import { ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n/context";

export default function ProblemSolution() {
  const t = useT();

  const pains = [
    { title: t("problem.pain1.title"), body: t("problem.pain1.body") },
    { title: t("problem.pain2.title"), body: t("problem.pain2.body") },
    { title: t("problem.pain3.title"), body: t("problem.pain3.body") },
  ];

  return (
    <section className="border-b border-border-subtle py-14 sm:py-20 lg:py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
            {t("problem.eyebrow")}
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl lg:text-5xl">
            {t("problem.title")}
          </h2>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-14 sm:gap-6 md:grid-cols-3">
          {pains.map((p) => (
            <div
              key={p.title}
              className="rounded-xl border border-border-subtle bg-bg-secondary p-5 sm:p-6"
            >
              <h3 className="text-lg font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-fg-secondary">{p.body}</p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-14 max-w-4xl sm:mt-20">
          <p className="text-center font-mono text-[0.6rem] uppercase tracking-[0.25em] text-fg-secondary sm:text-[0.65rem] sm:tracking-[0.3em]">
            {t("problem.diagramEyebrow")}
          </p>
          <div className="mt-6 grid items-stretch gap-3 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <PipelineNode
              label={t("problem.node.in")}
              examples={['"pt with acute MI"', "SNOMED 22298006", "ICD-10: I21.9"]}
            />
            <Arrow />
            <PipelineNode
              accent
              label={t("problem.node.api")}
              examples={[
                "normalize · translate · expand",
                "validate · disambiguate",
              ]}
            />
            <Arrow />
            <PipelineNode
              label={t("problem.node.out")}
              examples={["SNOMED 22298006", "ICD-10 I21.9", "preferredTerm + hierarchy"]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PipelineNode({
  label,
  examples,
  accent,
}: {
  label: string;
  examples: string[];
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl border border-fg-primary bg-fg-primary p-4 text-bg-primary shadow-accent-soft sm:p-5"
          : "rounded-xl border border-border-subtle bg-bg-secondary p-4 sm:p-5"
      }
    >
      <div
        className={
          "font-mono text-[0.6rem] uppercase tracking-[0.18em] sm:text-[0.65rem] sm:tracking-[0.2em] " +
          (accent ? "text-bg-primary/70" : "text-fg-secondary")
        }
      >
        {label}
      </div>
      {/* Mobile (<sm): horizontal scroll badges to avoid ugly wrap */}
      <div className="thin-scrollbar mt-3 flex gap-2 overflow-x-auto sm:hidden">
        {examples.map((e) => (
          <span
            key={e}
            className={
              "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[0.7rem] " +
              (accent
                ? "border-bg-primary/30 bg-bg-primary/10 text-bg-primary"
                : "border-border-subtle bg-bg-primary text-fg-primary")
            }
          >
            {e}
          </span>
        ))}
      </div>
      {/* sm+: stacked list, fits the column */}
      <ul
        className={
          "mt-3 hidden space-y-1.5 font-mono text-xs sm:block " +
          (accent ? "text-bg-primary" : "text-fg-primary")
        }
      >
        {examples.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-fg-secondary">
      <ArrowRight className="h-5 w-5 rotate-90 md:rotate-0" />
    </div>
  );
}
