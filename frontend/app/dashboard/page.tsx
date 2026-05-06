import type { Metadata } from "next";
import { Mail, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Obscyro dashboard — coming soon. Email us for early access.",
};

const SUPPORT_EMAIL = "me@example.com";

export default function DashboardPage() {
  return (
    <section className="container flex min-h-[calc(100vh-12rem)] items-center py-16">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          <Sparkles className="h-3 w-3" aria-hidden />
          <span className="font-semibold text-amber-600 dark:text-amber-400">Beta</span>
          <span>· Test phase</span>
        </div>
        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tighter sm:text-5xl">
          Dashboard coming soon.
        </h1>
        <p className="mt-5 text-pretty text-lg text-fg-secondary">
          The full self-serve experience — sign up, mint API keys, watch usage
          live, manage billing — lands shortly. In the meantime, we mint keys
          by hand for early users.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button href={`mailto:${SUPPORT_EMAIL}?subject=Obscyro%20early%20access`} size="lg">
            <Mail className="h-4 w-4" />
            Email {SUPPORT_EMAIL}
          </Button>
          <Button href="/docs" size="lg" variant="secondary">
            Browse the docs
          </Button>
        </div>
        <p className="mt-12 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          Test-phase status: backend live · docs live · dashboard in progress
        </p>
      </div>
    </section>
  );
}
