import { ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import CodeBlock from "@/components/ui/CodeBlock";
import HeroReveal from "./HeroReveal";

const CURL_EXAMPLE = `curl -X POST https://api.obscyro.com/v1/normalize \\
  -H "Authorization: Bearer obs_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "patient presented with acute MI",
    "limit": 3
  }'`;

const RESPONSE_EXAMPLE = `{
  "matches": [
    {
      "code": "22298006",
      "term": "Myocardial infarction",
      "conceptName": "Myocardial infarction",
      "confidence": 0.94,
      "matchType": "fts"
    }
  ]
}`;

export default function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border-subtle">
      <div className="absolute inset-0 -z-10 grid-bg opacity-50" aria-hidden />
      <div className="container py-20 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <HeroReveal>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              <span className="font-semibold text-amber-600 dark:text-amber-400">Beta</span>
              <span>· Test phase — feedback welcome at me@example.com</span>
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-tighter text-fg-primary sm:text-5xl lg:text-6xl">
              Health data, finally fluent.
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-fg-secondary">
              One API for SNOMED, ICD-10, RxNorm, LOINC, FHIR, and HL7. Stop
              translating. Start building.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/dashboard" size="lg">
                Get API Key
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="/docs" size="lg" variant="secondary">
                <BookOpen className="h-4 w-4" />
                Read the docs
              </Button>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-6 max-w-md">
              {[
                { label: "Concepts", value: "470K+" },
                { label: "Mappings", value: "1.2M" },
                { label: "p95 latency", value: "< 80ms" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                    {stat.label}
                  </dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold tracking-tight text-fg-primary">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </HeroReveal>

          <HeroReveal delay={0.15}>
            <div className="space-y-3">
              <CodeBlock
                code={CURL_EXAMPLE}
                language="bash"
                filename="POST /v1/normalize"
              />
              <div className="flex items-center justify-center">
                <div className="rounded-full border border-border-subtle bg-bg-secondary px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                  ↓ response
                </div>
              </div>
              <CodeBlock code={RESPONSE_EXAMPLE} language="json" filename="200 OK" />
            </div>
          </HeroReveal>
        </div>
      </div>
    </section>
  );
}
