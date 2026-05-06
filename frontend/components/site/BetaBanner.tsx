export default function BetaBanner() {
  return (
    <div className="w-full border-b border-amber-500/30 bg-amber-500/10 text-fg-primary">
      <div className="container flex items-center justify-center gap-2 py-1.5 text-center">
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden />
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em]">
          <span className="font-semibold text-amber-600 dark:text-amber-400">Beta</span>
          <span className="mx-2 text-fg-secondary">·</span>
          <span className="text-fg-secondary">
            Obscyro is in active test phase. Endpoints, schemas, and pricing may change without notice.
          </span>
        </p>
      </div>
    </div>
  );
}
