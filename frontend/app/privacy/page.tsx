import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Obscyro handles your data.",
};

export default function PrivacyPage() {
  return (
    <div className="container max-w-2xl py-14 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tighter sm:text-4xl">Privacy</h1>
      <p className="mt-2 text-sm text-fg-secondary">Last updated: November 2026</p>

      <div className="prose-obscyro mt-10 space-y-8 text-sm leading-relaxed text-fg-secondary">
        <section>
          <h2 className="text-lg font-semibold text-fg-primary">What we collect</h2>
          <p className="mt-3">
            For each person given access, we store their name, email and organisation, and the
            account details needed to issue and manage their API keys. We store a SHA-256 hash
            of each API key, not the key itself.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Demonstration requests</h2>
          <p className="mt-3">
            The demonstration form on this site sends nothing to our servers. It composes an
            email in your own mail client, and we receive only what you choose to send.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">API usage</h2>
          <p className="mt-3">
            We log API requests per key (endpoint, status code, duration) to report usage and to
            improve the service. Request bodies are not retained for analytics by default.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-fg-primary">Clinical use</h2>
          <p className="mt-3">
            Obscyro is not a medical device. Do not use it for clinical decisions without
            independent verification.
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
      </div>
    </div>
  );
}
