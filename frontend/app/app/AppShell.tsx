"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CreditCard,
  Key,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";

import { useT } from "@/lib/i18n/context";
import {
  clearSession,
  clearStoredKey,
  fetchMe,
  getSession,
  getStoredKey,
  type MeResult,
} from "@/lib/auth";
import { cn } from "@/lib/cn";

type AppContextValue = {
  me: MeResult | null;
  refresh: () => Promise<void>;
};

import { createContext, useContext } from "react";

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used inside <AppShell>");
  }
  return ctx;
}

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

export default function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "redirecting">(
    "loading",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  async function load() {
    // Gate on the frontend-only session, not an API key. Backend auth comes later.
    if (!getSession()) {
      setStatus("redirecting");
      router.replace("/sign-in");
      return;
    }
    // Best-effort: hydrate `me` from a stored API key if one exists (so console
    // pages that read it work once the backend is wired). Absence is fine.
    const stored = getStoredKey();
    if (stored) {
      try {
        const data = await fetchMe(stored);
        setMe(data);
      } catch {
        clearStoredKey();
        setMe(null);
      }
    } else {
      setMe(null);
    }
    setStatus("ready");
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll + Escape close while drawer is open
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  if (status === "loading" || status === "redirecting") {
    return (
      <div className="container py-24 text-center">
        <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-bg-tertiary" />
      </div>
    );
  }

  function signOut() {
    clearSession();
    clearStoredKey();
    router.replace("/");
  }

  const navItems: NavItem[] = [
    { href: "/app", label: t("app.nav.overview"), icon: LayoutDashboard },
    { href: "/app/keys", label: t("app.nav.keys"), icon: Key },
    { href: "/app/usage", label: t("app.nav.usage"), icon: LineChart },
    { href: "/app/billing", label: t("app.nav.billing"), icon: CreditCard },
    { href: "/app/settings", label: t("app.nav.settings"), icon: Settings },
  ];

  const firstName = me?.user?.name ? me.user.name.split(" ")[0] : "";

  return (
    <AppContext.Provider value={{ me, refresh: load }}>
      <div className="border-t border-border-subtle">
        <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* Desktop sidebar */}
          <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] flex-col border-r border-border-subtle bg-bg-secondary px-4 py-6 lg:flex">
            <div className="mb-6 flex items-center gap-2 px-2">
              <ShieldCheck className="h-4 w-4 text-fg-secondary" aria-hidden />
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                {t("app.welcome")}
                {firstName ? `, ${firstName}` : ""}
              </span>
            </div>
            <DesktopNav navItems={navItems} pathname={pathname} />
            <div className="mt-auto pt-6">
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                {t("app.signOut")}
              </button>
            </div>
          </aside>

          <div className="min-w-0">
            {/* Mobile/tablet top-bar */}
            <div className="sticky top-14 z-30 flex h-12 items-center justify-between gap-3 border-b border-border-subtle bg-bg-primary/90 px-4 backdrop-blur sm:top-16 sm:h-14 lg:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-fg-secondary" aria-hidden />
                <span className="truncate font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                  {t("app.welcome")}
                  {firstName ? `, ${firstName}` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label={t("app.openMenu")}
                aria-expanded={drawerOpen}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border-subtle bg-bg-secondary px-3 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
              >
                <Menu className="h-4 w-4" aria-hidden />
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em]">
                  {t("app.menu")}
                </span>
              </button>
            </div>

            {/* Mobile/tablet drawer */}
            {drawerOpen ? (
              <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
                <button
                  type="button"
                  aria-label={t("app.closeMenu")}
                  onClick={() => setDrawerOpen(false)}
                  className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                />
                <aside className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-l border-border-subtle bg-bg-primary shadow-xl">
                  <div className="flex h-14 items-center justify-between border-b border-border-subtle px-4">
                    <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                      {t("app.menu")}
                    </span>
                    <button
                      ref={closeBtnRef}
                      type="button"
                      onClick={() => setDrawerOpen(false)}
                      aria-label={t("app.closeMenu")}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <nav className="flex-1 overflow-y-auto px-3 py-4">
                    <ul className="space-y-0.5">
                      {navItems.map((item) => {
                        const Icon = item.icon;
                        const active = pathname === item.href;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={() => setDrawerOpen(false)}
                              className={cn(
                                "flex items-center gap-3 rounded-md px-3 py-3 text-base transition-colors",
                                active
                                  ? "bg-bg-tertiary font-medium text-fg-primary"
                                  : "text-fg-secondary hover:bg-bg-tertiary/60 hover:text-fg-primary",
                              )}
                            >
                              <Icon className="h-4 w-4" aria-hidden />
                              <span>{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>
                  <div className="border-t border-border-subtle px-3 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerOpen(false);
                        signOut();
                      }}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-base text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                    >
                      <LogOut className="h-4 w-4" aria-hidden />
                      {t("app.signOut")}
                    </button>
                  </div>
                </aside>
              </div>
            ) : null}

            <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-12">{children}</div>
          </div>
        </div>
      </div>
    </AppContext.Provider>
  );
}

function DesktopNav({
  navItems,
  pathname,
}: {
  navItems: NavItem[];
  pathname: string;
}) {
  return (
    <nav className="space-y-0.5">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-bg-tertiary font-medium text-fg-primary"
                : "text-fg-secondary hover:bg-bg-tertiary/60 hover:text-fg-primary",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
