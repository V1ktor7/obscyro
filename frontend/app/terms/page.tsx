import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for Obscyro during the public test phase.",
};

export default function TermsPage() {
  return (
    <div className="container max-w-2xl py-14 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">Terms of use</h1>
      <p className="mt-2 text-sm text-fg-secondary">Last updated: May 2026 · Public test phase</p>

      <div className="prose-obscyro mt-10 space-y-8 text-sm leading-relaxed text-fg-secondary">
        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Test phase</h2>
          <p className="mt-3">
            Obscyro is offered in a public test phase only. There is no uptime, accuracy, or
            support SLA. Endpoints, response schemas, pricing, and quotas may change without
            notice.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Acceptable use</h2>
          <p className="mt-3">
            You may use the API to build and evaluate integrations. Do not use Obscyro outputs
            as the sole basis for clinical decisions. You are responsible for complying with
            applicable laws and with the terms of any terminology licenses that apply to your
            use of SNOMED CT or other coded data.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">API keys</h2>
          <p className="mt-3">
            Keep your API key secret. You are responsible for requests made with your key.
            Contact us to revoke a compromised key. Self-serve rotation in the dashboard is
            coming soon.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Plans and billing</h2>
          <p className="mt-3">
            Only the Free plan is available during the test phase. Paid tiers shown on the
            site are preview pricing and are not yet purchasable.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Contact</h2>
          <p className="mt-3">
            Questions:{" "}
            <a
              href="mailto:obscyro-team@obscyro.com"
              className="text-fg-primary underline decoration-border-subtle underline-offset-4"
            >
              obscyro-team@obscyro.com
            </a>
            .
          </p>
        </section>

        <p className="text-xs text-fg-secondary">
          This page is a beta-phase summary, not a full legal agreement. Formal terms will be
          published before general availability.
        </p>
      </div>
    </div>
  );
}
