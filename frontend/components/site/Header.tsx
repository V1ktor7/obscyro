"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { useT } from "@/lib/i18n/context";
import Mark from "@/components/brand/Mark";
import { cn } from "@/lib/cn";

export default function Header() {
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navItems = [
    { label: t("nav.docs"), href: "/docs" },
    { label: t("nav.pricing"), href: "/#contact" },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b transition-all duration-200",
        "border-border-subtle bg-bg-primary/80 backdrop-blur-xl",
        scrolled ? "border-border-subtle" : "border-transparent",
      )}
    >
      <div className="container flex h-12 max-w-[1024px] items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-fg-primary"
          aria-label="Obscyro home"
        >
          <Mark className="h-[1.05rem] w-auto" />
          <span className="text-[0.9375rem] font-medium lowercase tracking-tight">
            obscyro
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1 text-[0.75rem] text-fg-primary/80 transition-opacity hover:opacity-60"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/sign-in"
            className="px-3 py-1 text-[0.75rem] text-fg-primary/80 transition-opacity hover:opacity-60"
          >
            {t("nav.signin")}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden h-7 items-center rounded-full bg-accent px-3.5 text-[0.75rem] font-medium text-accent-fg transition-colors hover:bg-[#1f5fbd] md:inline-flex"
          >
            {t("nav.signin")}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-9 w-9 items-center justify-center text-fg-primary md:hidden"
            aria-label={t("nav.toggleMenu")}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border-subtle bg-bg-primary md:hidden">
          <nav className="container flex flex-col gap-1 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-base text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex items-center gap-2">
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                {t("nav.signin")}
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
