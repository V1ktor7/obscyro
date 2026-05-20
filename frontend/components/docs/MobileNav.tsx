"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import Sidebar from "./Sidebar";
import { useT } from "@/lib/i18n/context";

export default function MobileNav() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <div className="sticky top-16 z-30 flex items-center gap-2 border-b border-border-subtle bg-bg-primary/90 px-4 py-2 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("docs.openMenu")}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-secondary px-3 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
        >
          <Menu className="h-4 w-4" aria-hidden />
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em]">
            {t("docs.menu")}
          </span>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={t("docs.closeMenu")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-border-subtle bg-bg-primary shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border-subtle px-4">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                {t("docs.menu")}
              </span>
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("docs.closeMenu")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4">
              <Sidebar />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
