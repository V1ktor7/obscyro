import {
  ArrowLeftRight,
  BadgeCheck,
  Brain,
  Filter,
  Network,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import CodeBlock from "@/components/ui/CodeBlock";
import FeatureReveal from "./FeatureReveal";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  snippet: string;
  language: "bash" | "json";
}

const FEATURES: Feature[] = [
  {
    icon: BadgeCheck,
    title: "Validate",
    description: "Verify any medical code in milliseconds.",
    language: "bash",
    snippet: `curl -I https://api.obscyro.com/v1/concepts/22298006
HTTP/1.1 200 OK`,
  },
  {
    icon: Wand2,
    title: "Normalize",
    description: "Turn raw clinical text into standard codes.",
    language: "json",
    snippet: `{
  "text": "patient with acute MI",
  "matches": [{"code":"22298006","confidence":0.94}]
}`,
  },
  {
    icon: ArrowLeftRight,
    title: "Translate",
    description: "SNOMED ↔ ICD-10 ↔ RxNorm ↔ LOINC.",
    language: "json",
    snippet: `{
  "from": "snomed", "to": "icd10",
  "translations": [{"source":"22298006","target":"I21.9"}]
}`,
  },
  {
    icon: Network,
    title: "Expand",
    description: "Navigate clinical hierarchies semantically.",
    language: "bash",
    snippet: `GET /v1/concepts/22298006/descendants
=> 247 SNOMED codes`,
  },
  {
    icon: Filter,
    title: "Disambiguate",
    description: "Pick the right code with context.",
    language: "json",
    snippet: `{
  "winner":{"code":"22298006","preferredTerm":"Myocardial infarction"},
  "contextSimilarity": 0.81
}`,
  },
  {
    icon: Brain,
    title: "Reason",
    description: "Detect logical contradictions in clinical data.",
    language: "json",
    snippet: `{
  "contradictions": [
    {"left":"pregnant","right":"hysterectomy"}
  ]
}`,
  },
];

export default function Features() {
  return (
    <section className="border-b border-border-subtle py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-fg-secondary">
            What you can do
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
            Six primitives. Endless integrations.
          </h2>
          <p className="mt-4 text-fg-secondary">
            Compose them like Lego to fix the interoperability layer of your
            product, all in pure HTTP.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <FeatureReveal key={feature.title} index={i}>
              <article className="group flex h-full flex-col rounded-xl border border-border-subtle bg-bg-secondary p-6 transition-all hover:border-fg-secondary/40">
                <div className="flex items-center gap-3">
                  <div className="rounded-md border border-border-subtle bg-bg-tertiary p-2 transition-colors group-hover:border-fg-primary/30">
                    <feature.icon className="h-4 w-4 text-fg-primary" aria-hidden />
                  </div>
                  <h3 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
                    {feature.title}
                  </h3>
                </div>
                <p className="mt-3 text-sm text-fg-secondary">{feature.description}</p>
                <div className="mt-5 flex-1">
                  <CodeBlock
                    code={feature.snippet}
                    language={feature.language}
                    showCopy={false}
                  />
                </div>
              </article>
            </FeatureReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
