import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Parameters({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="not-prose my-8">
      <h4 className="mb-3 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-fg-secondary">
        {title ?? "Parameters"}
      </h4>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-secondary">
        <ul className="divide-y divide-border-subtle">{children}</ul>
      </div>
    </div>
  );
}

export function Param({
  name,
  type,
  required,
  defaultValue,
  children,
}: {
  name: string;
  type: string;
  required?: boolean;
  defaultValue?: string;
  children?: ReactNode;
}) {
  return (
    <li className="grid gap-2 px-5 py-4 md:grid-cols-[auto_1fr] md:gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-sm font-semibold text-fg-primary">{name}</code>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.15em] text-fg-secondary">
          {type}
        </span>
        <span
          className={cn(
            "font-mono text-[0.6rem] uppercase tracking-[0.18em]",
            required ? "text-rose-500" : "text-fg-secondary/70",
          )}
        >
          {required ? "required" : "optional"}
        </span>
        {defaultValue ? (
          <span className="font-mono text-[0.7rem] text-fg-secondary">
            default: <code className="text-fg-primary">{defaultValue}</code>
          </span>
        ) : null}
      </div>
      <div className="text-sm leading-relaxed text-fg-secondary [&_code]:font-mono [&_code]:text-xs [&_code]:text-fg-primary">
        {children}
      </div>
    </li>
  );
}
