"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  CreditCard,
  Key,
  LayoutDashboard,
  LineChart,
  LogOut,
  Settings,
  ShieldCheck,
} from "lucide-react";

import { useT } from "@/lib/i18n/context";
import { clearStoredKey, fetchMe, getStoredKey, type MeResult } from "@/lib/auth";
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

export default function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "redirecting">(
    "loading",
  );

  async function load() {
    const stored = getStoredKey();
    if (!stored) {
      setStatus("redirecting");
      router.replace("/sign-in");
      return;
    }
    try {
      const data = await fetchMe(stored);
      setMe(data);
      setStatus("ready");
    } catch {
      clearStoredKey();
      setStatus("redirecting");
      router.replace("/sign-in");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading" || status === "redirecting") {
    return (
      <div className="container py-24 text-center">
        <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-bg-tertiary" />
      </div>
    );
  }

  function signOut() {
    clearStoredKey();
    router.replace("/");
  }

  const navItems = [
    { href: "/app", label: t("app.nav.overview"), icon: LayoutDashboard },
    { href: "/app/keys", label: t("app.nav.keys"), icon: Key },
    { href: "/app/usage", label: t("app.nav.usage"), icon: LineChart },
    { href: "/app/billing", label: t("app.nav.billing"), icon: CreditCard },
    { href: "/app/settings", label: t("app.nav.settings"), icon: Settings },
  ] as const;

  return (
    <AppContext.Provider value={{ me, refresh: load }}>
      <div className="border-t border-border-subtle">
        <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] flex-col border-r border-border-subtle bg-bg-secondary px-4 py-6 lg:flex">
            <div className="mb-6 flex items-center gap-2 px-2">
              <ShieldCheck className="h-4 w-4 text-fg-secondary" aria-hidden />
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                {t("app.welcome")}
                {me?.user?.name ? `, ${me.user.name.split(" ")[0]}` : ""}
              </span>
            </div>
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

          <div className="min-w-0 px-6 py-8 lg:px-10 lg:py-12">
            <div className="lg:hidden">
              <nav className="thin-scrollbar mb-6 -mx-2 flex gap-1 overflow-x-auto px-2 pb-2">
                {navItems.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors",
                        active
                          ? "bg-bg-tertiary font-medium text-fg-primary"
                          : "text-fg-secondary hover:bg-bg-tertiary/60 hover:text-fg-primary",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                <button
                  type="button"
                  onClick={signOut}
                  className="ml-auto shrink-0 rounded-md px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                >
                  {t("app.signOut")}
                </button>
              </nav>
            </div>
            {children}
          </div>
        </div>
      </div>
    </AppContext.Provider>
  );
}
