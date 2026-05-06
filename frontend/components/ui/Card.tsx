import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border-subtle bg-bg-secondary p-6 shadow-sm transition-all hover:border-fg-secondary/40",
        className,
      )}
      {...rest}
    />
  );
}
