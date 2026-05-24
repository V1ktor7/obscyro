import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Obscyro handles your data during the public test phase.",
};

export default function PrivacyPage() {
  return (
    <div className="container max-w-2xl py-14 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">Privacy</h1>
      <p className="mt-2 text-sm text-fg-secondary">Last updated: May 2026 · Public test phase</p>

      <div className="prose-obscyro mt-10 space-y-8 text-sm leading-relaxed text-fg-secondary">
        <section>
          <h2 className="text-lg font-semibold text-fg-primary">What we collect</h2>
          <p className="mt-3">
            When you sign up, we store your name, email, optional company, use case, and
            account metadata needed to mint and manage your API key. We store a SHA-256 hash
            of your API key, not the raw key.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">API usage</h2>
          <p className="mt-3">
            We log API requests per key (endpoint, status code, duration) for usage visibility
            and product improvement. Request bodies are not retained for analytics by default.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Clinical use</h2>
          <p className="mt-3">
            Obscyro is in public test with no accuracy or uptime SLA. Do not use the service
            for clinical decisions without independent verification. Obscyro is not a medical
            device.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Contact</h2>
          <p className="mt-3">
            Questions or deletion requests:{" "}
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
          This page is a beta-phase summary, not a full legal privacy policy. A comprehensive
          policy will be published before general availability.
        </p>
      </div>
    </div>
  );
}
