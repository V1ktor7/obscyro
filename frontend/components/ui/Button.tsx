import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";
/**
 * Width of the button.
 * - "auto": intrinsic width (default).
 * - "full": full-width on every breakpoint.
 * - "fullMobile": full-width below `sm`, intrinsic from `sm` up. Convenient for mobile-only full-width CTAs.
 */
type Width = "auto" | "full" | "fullMobile";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:opacity-90 shadow-accent-soft",
  secondary:
    "bg-bg-tertiary text-fg-primary border border-border-subtle hover:bg-bg-secondary",
  ghost:
    "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary",
};

// Mobile gets larger touch-friendly heights (≥40 / ≥44 px) while desktop keeps
// the original visual rhythm (32 / 40 / 48 px). `sm:` here means viewport ≥640.
const SIZE: Record<Size, string> = {
  sm: "h-10 sm:h-8 px-3 text-xs",
  md: "h-11 sm:h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const WIDTH: Record<Width, string> = {
  auto: "",
  full: "w-full",
  fullMobile: "w-full sm:w-auto",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 ring-focus disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  width?: Width;
  className?: string;
}

type AsButton = BaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsLink = BaseProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, AsButton | AsLink>(
  function Button(
    { variant = "primary", size = "md", width = "auto", className, ...rest },
    ref,
  ) {
    const cls = cn(BASE, VARIANT[variant], SIZE[size], WIDTH[width], className);
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
