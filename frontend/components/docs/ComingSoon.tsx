import { Construction } from "lucide-react";

export default function ComingSoon({ message }: { message?: string }) {
  return (
    <div className="not-prose my-8 flex items-start gap-4 rounded-xl border border-dashed border-border-subtle bg-bg-secondary p-6">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-tertiary">
        <Construction className="h-4 w-4 text-fg-secondary" aria-hidden />
      </div>
      <div>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          Coming soon
        </p>
        <p className="mt-1 text-sm text-fg-primary">
          {message ??
            "This page is in active development. The endpoint exists in the API; full reference documentation is being written."}
        </p>
      </div>
    </div>
  );
}
