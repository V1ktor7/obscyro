import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for Obscyro.",
};

export default function TermsPage() {
  return (
    <div className="container max-w-2xl py-14 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">Terms of use</h1>
      <p className="mt-2 text-sm text-fg-secondary">Last updated: November 2026</p>

      <div className="prose-obscyro mt-10 space-y-8 text-sm leading-relaxed text-fg-secondary">
        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Access</h2>
          <p className="mt-3">
            Obscyro is provided to organisations under an agreement with each of them. Pricing
            is quoted on request. Where an organisation&apos;s signed agreement says something
            different from this page, the agreement applies.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Decision support, not clinical advice</h2>
          <p className="mt-3">
            Obscyro is a decision-support tool for the operation of health networks. It is not a
            medical device, and its outputs do not replace the judgement of qualified health
            professionals. Do not use them as the sole basis for a clinical decision.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Availability and accuracy</h2>
          <p className="mt-3">
            Unless a signed agreement provides otherwise, Obscyro is provided without a guarantee
            of availability or of accuracy. Results depend on the data it is given, and the
            platform shows where each figure comes from so that it can be checked.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Acceptable use</h2>
          <p className="mt-3">
            You are responsible for complying with applicable laws, and with the terms of any
            terminology licence that covers your use of SNOMED CT or other coded data.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">API keys</h2>
          <p className="mt-3">
            Keep your API keys secret. You are responsible for requests made with your keys.
            Contact us to rotate or revoke one.
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
      </div>
    </div>
  );
}
