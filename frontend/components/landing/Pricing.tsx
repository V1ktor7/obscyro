import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

interface Tier {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Build prototypes and explore the API surface.",
    features: [
      "1,000 calls / month",
      "100 req/min rate limit",
      "All endpoints unlocked",
      "Community support",
    ],
    cta: "Start free",
    href: "/dashboard",
  },
  {
    name: "Starter",
    price: "$99",
    period: "/month",
    description: "Ship to your first production users.",
    features: [
      "100,000 calls / month",
      "1,000 req/min rate limit",
      "Email support",
      "Usage analytics dashboard",
    ],
    cta: "Get Starter",
    href: "/dashboard",
    highlight: true,
  },
  {
    name: "Pro",
    price: "$499",
    period: "/month",
    description: "Scale with confidence and SLAs.",
    features: [
      "1,000,000 calls / month",
      "10,000 req/min rate limit",
      "99.9% uptime SLA",
      "Slack-channel support",
    ],
    cta: "Get Pro",
    href: "/dashboard",
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="border-b border-border-subtle py-24">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-fg-secondary">
            Pricing
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tighter sm:text-4xl">
            Simple, predictable, healthcare-friendly.
          </h2>
          <p className="mt-4 text-fg-secondary">
            No per-record fees. No hidden integration costs. Pay for the calls
            you make.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "relative flex flex-col rounded-xl border bg-bg-secondary p-7 transition-all",
                tier.highlight
                  ? "border-fg-primary shadow-accent-soft"
                  : "border-border-subtle hover:border-fg-secondary/40",
              )}
            >
              {tier.highlight ? (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-accent-fg">
                  Most popular
                </div>
              ) : null}
              <h3 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
                {tier.name}
              </h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tighter">
                  {tier.price}
                </span>
                <span className="text-sm text-fg-secondary">{tier.period}</span>
              </div>
              <p className="mt-3 text-sm text-fg-secondary">{tier.description}</p>
              <ul className="mt-6 space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <Button
                  href={tier.href}
                  variant={tier.highlight ? "primary" : "secondary"}
                  className="w-full"
                >
                  {tier.cta}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-fg-secondary">
          Need higher volume, dedicated tenancy, or BAA?{" "}
          <a
            href="mailto:sales@obscyro.com"
            className="font-medium text-fg-primary underline decoration-border-subtle underline-offset-4 transition-colors hover:decoration-fg-primary"
          >
            Enterprise: custom pricing — contact us
          </a>
          .
        </p>
      </div>
    </section>
  );
}
