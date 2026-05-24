"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { useT } from "@/lib/i18n/context";
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
    { label: t("nav.pricing"), href: "/#pricing" },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b transition-all duration-200",
        scrolled
          ? "border-border-subtle bg-bg-primary/80 backdrop-blur"
          : "border-transparent bg-bg-primary/0",
      )}
    >
      <div className="container flex h-14 items-center justify-between gap-4 sm:h-16">
        <Link
          href="/"
          className="font-mono text-base font-semibold lowercase tracking-tight text-fg-primary md:text-lg"
          aria-label="Obscyro home"
        >
          obscyro
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/sign-in"
            className="rounded-md px-3 py-1.5 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
          >
            {t("nav.signin")}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/sign-up"
            className="hidden h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 md:inline-flex"
          >
            {t("nav.getKey")}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-primary hover:bg-bg-tertiary md:hidden"
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
            <Link
              href="/sign-in"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-3 text-base text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            >
              {t("nav.signin")}
            </Link>
            <div className="mt-3 flex items-center gap-2">
              <Link
                href="/sign-up"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
              >
                {t("nav.getKey")}
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
