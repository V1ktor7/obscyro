import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:opacity-90 shadow-accent-soft",
  secondary:
    "bg-bg-tertiary text-fg-primary border border-border-subtle hover:bg-bg-secondary",
  ghost:
    "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 ring-focus disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  className?: string;
}

type AsButton = BaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsLink = BaseProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, AsButton | AsLink>(
  function Button({ variant = "primary", size = "md", className, ...rest }, ref) {
    const cls = cn(BASE, VARIANT[variant], SIZE[size], className);
    if ("href" in rest && rest.href) {
      const { href, ...anchorRest } = rest;
      const isExternal = href.startsWith("http") || href.startsWith("mailto:");
      if (isExternal) {
        return (
          <a
            ref={ref as React.Ref<HTMLAnchorElement>}
            href={href}
            className={cls}
            {...anchorRest}
          />
        );
      }
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={cls}
          {...(anchorRest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        />
      );
    }
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cls}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      />
    );
  },
);
