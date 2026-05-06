import { ArrowRight } from "lucide-react";

const PAINS = [
  {
    title: "Different systems, same data, different codes",
    body:
      "Hospitals use SNOMED. Insurers use ICD-10. Labs use LOINC. Pharmacies use RxNorm. Every integration becomes a translation problem.",
  },
  {
    title: "Manual mapping costs $300K+ per integration",
    body:
      "Hand-curated cross-walks burn six-figure budgets and months of clinical-informaticist time before a single record flows.",
  },
  {
    title: "Built once, breaks at every standards update",
    body:
      "Yearly SNOMED, ICD-10, and FHIR releases ship breaking changes. Static mappings rot the moment you stop maintaining them.",
  },
] as const;

export default function ProblemSolution() {
  return (
    <section className="border-b border-border-subtle py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-fg-secondary">
            The interop tax
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
            Healthcare data doesn&apos;t speak one language.
          </h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {PAINS.map((p) => (
            <div
              key={p.title}
              className="rounded-xl border border-border-subtle bg-bg-secondary p-6"
            >
              <h3 className="text-lg font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
                {p.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-20 mx-auto max-w-4xl">
          <p className="text-center font-mono text-[0.65rem] uppercase tracking-[0.3em] text-fg-secondary">
            Obscyro in one diagram
          </p>
          <div className="mt-6 grid items-stretch gap-3 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
            <PipelineNode label="Raw clinical input" examples={["“pt with acute MI”", "ICD-10: I21.9", "LOINC 718-7"]} />
            <Arrow />
            <PipelineNode
              accent
              label="Obscyro API"
              examples={["normalize · translate · expand", "validate · disambiguate · reason"]}
            />
            <Arrow />
            <PipelineNode label="Normalized output" examples={["SNOMED 22298006", "FHIR Condition", "ICD-10 + RxNorm"]} />
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
          ? "rounded-xl border border-fg-primary bg-fg-primary p-5 text-bg-primary shadow-accent-soft"
          : "rounded-xl border border-border-subtle bg-bg-secondary p-5"
      }
    >
      <div
        className={
          "font-mono text-[0.65rem] uppercase tracking-[0.2em] " +
          (accent ? "text-bg-primary/70" : "text-fg-secondary")
        }
      >
        {label}
      </div>
      <ul className={"mt-3 space-y-1.5 font-mono text-xs " + (accent ? "text-bg-primary" : "text-fg-primary")}>
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
