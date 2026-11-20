"use client";

/**
 * StudioShell — the global platform shell (spec Part 3.1): top bar, icon rail
 * with contextual sub-navigation, persistent environment badge, command
 * palette, and status bar. Owns session gating, the environment switcher,
 * health polling, identity/capabilities, and sign-out so every section shares
 * one source of truth. Anything created in one section becomes visible to the
 * others via `refreshEnvironments` / `bumpOntology`.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch, clearSession, clearStoredKey, getSession, getStoredKey } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { Suspense } from "react";

import {
  ENV_PARAM,
  readStoredEnv,
  resolveEnv,
  urlWithEnv,
  writeStoredEnv,
} from "./env-persist";

import { AlertTriangle, Building2, ChevronDown, Search } from "lucide-react";

import {
  getHealth,
  listEnvironments,
  listEnvTypes,
  type EnvObjectType,
  type EnvironmentSummary,
  type HealthStatus,
} from "@/lib/platform-api";

import { AlertPill, AlertStrip } from "./AlertBanner";
import { AlertFeedProvider } from "./AlertFeed";
import { AnalystDock, AnalystFocusProvider } from "./AnalystDock";
import CommandPalette from "./CommandPalette";
import PlatformRail, { SectionTabs } from "./PlatformRail";

type StudioContextValue = {
  hasKey: boolean;
  health: HealthStatus | "checking";
  environments: EnvironmentSummary[];
  selectedEnv: string | null;
  setSelectedEnv: (slug: string | null) => void;
  refreshEnvironments: () => Promise<void>;
  envTypes: EnvObjectType[];
  refreshTypes: () => Promise<void>;
  /** Bumped whenever ontology data (types/instances/links) is mutated. */
  ontologyVersion: number;
  bumpOntology: () => void;
  signOut: () => void;
};

/** Shape of GET /v1/me — identity plus capability strings for the rail. */
interface Identity {
  userId: string;
  email: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  roles: string[];
  capabilities: string[];
  dutyConflicts: [string, string][];
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error("useStudio must be used inside <StudioShell>");
  }
  return ctx;
}

function HealthPill({ health }: { health: HealthStatus | "checking" }) {
  const map: Record<HealthStatus | "checking", { dot: string; label: string }> = {
    checking: { dot: "bg-ink-ghost", label: "Checking API…" },
    ok: { dot: "bg-ok", label: "Live — connected to API" },
    degraded: { dot: "bg-warn", label: "Degraded — database issue" },
    offline: { dot: "bg-ink-ghost", label: "Offline — API unreachable" },
  };
  const { dot, label } = map[health];
  return (
    <span className="hidden items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-muted lg:inline-flex">
      <span className={cn("h-2 w-2 rounded-full", dot, health === "ok" && "shadow-[0_0_0_3px_rgb(var(--s-ok)/0.18)]")} />
      {label}
    </span>
  );
}

export default function StudioShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [health, setHealth] = useState<HealthStatus | "checking">("checking");
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [selectedEnv, setSelectedEnvState] = useState<string | null>(null);

  /**
   * Selecting an environment writes it to the URL and to storage.
   *
   * The URL so the page can be shared, bookmarked and reloaded; storage so the
   * next visit opens where you left off. Replacing rather than pushing keeps
   * the back button meaning "the previous page", not "the previous
   * environment".
   */
  const setSelectedEnv = useCallback((slug: string | null) => {
    setSelectedEnvState(slug);
    writeStoredEnv(slug);
    if (slug && typeof window !== "undefined") {
      const { pathname, search } = window.location;
      router.replace(urlWithEnv(pathname, search, slug), { scroll: false });
    }
  }, [router]);
  const [envTypes, setEnvTypes] = useState<EnvObjectType[]>([]);
  const [ontologyVersion, setOntologyVersion] = useState(0);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Identity drives role-filtered navigation. Server-side checks are the real
  // access control; this only decides what the rail shows.
  useEffect(() => {
    if (!hasKey) {
      setIdentity(null);
      return;
    }
    let cancelled = false;
    apiFetch<Partial<Identity>>("/v1/identity")
      .then((me) => {
        if (cancelled) return;
        // Normalize: a shape mismatch must degrade the rail, never crash the
        // whole studio. Missing capabilities => show everything and let the
        // server reject what the role cannot reach.
        setIdentity({
          userId: me.userId ?? "",
          email: me.email ?? "",
          name: me.name ?? "",
          organizationId: me.organizationId ?? null,
          organizationName: me.organizationName ?? null,
          roles: Array.isArray(me.roles) ? me.roles : [],
          capabilities: Array.isArray(me.capabilities) ? me.capabilities : [],
          dutyConflicts: Array.isArray(me.dutyConflicts) ? me.dutyConflicts : [],
        });
      })
      .catch(() => {
        if (!cancelled) setIdentity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasKey]);

  // Command palette: Cmd/Ctrl+K anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refreshTypes = useCallback(async () => {
    if (!getStoredKey() || !selectedEnv) {
      setEnvTypes([]);
      return;
    }
    try {
      const { types } = await listEnvTypes(selectedEnv);
      setEnvTypes(types);
    } catch {
      setEnvTypes([]);
    }
  }, [selectedEnv]);

  const bumpOntology = useCallback(() => {
    setOntologyVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/sign-in");
      return;
    }
    setHasKey(Boolean(getStoredKey()));
    setReady(true);
  }, [router]);

  // Health probe (poll /v1/health).
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function probe() {
      const status = await getHealth();
      if (!cancelled) setHealth(status);
    }
    void probe();
    const handle = setInterval(probe, 15000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [ready]);

  const refreshEnvironments = useCallback(async () => {
    if (!getStoredKey()) {
      setEnvironments([]);
      return;
    }
    try {
      const { environments: envs } = await listEnvironments();
      setEnvironments(envs);
      setSelectedEnvState((cur) => {
        if (cur && envs.some((e) => e.slug === cur)) return cur;
        // First resolution of the session: the URL wins, then what this browser
        // remembers, then the API's first environment as a last resort.
        const fromUrl =
          typeof window === "undefined"
            ? null
            : new URLSearchParams(window.location.search).get(ENV_PARAM);
        const resolved = resolveEnv(fromUrl, readStoredEnv(), envs);
        if (resolved) {
          writeStoredEnv(resolved);
          if (typeof window !== "undefined" && fromUrl !== resolved) {
            const { pathname, search } = window.location;
            router.replace(urlWithEnv(pathname, search, resolved), { scroll: false });
          }
        }
        return resolved;
      });
    } catch {
      setEnvironments([]);
    }
  }, [router]);

  useEffect(() => {
    if (ready) void refreshEnvironments();
  }, [ready, refreshEnvironments]);

  useEffect(() => {
    void refreshTypes();
  }, [refreshTypes, ontologyVersion]);

  const signOut = useCallback(() => {
    clearSession();
    clearStoredKey();
    router.replace("/");
  }, [router]);

  const currentEnv = useMemo(
    () => environments.find((e) => e.slug === selectedEnv),
    [environments, selectedEnv],
  );

  const value = useMemo<StudioContextValue>(
    () => ({
      hasKey,
      health,
      environments,
      selectedEnv,
      setSelectedEnv,
      refreshEnvironments,
      envTypes,
      refreshTypes,
      ontologyVersion,
      bumpOntology,
      signOut,
    }),
    [
      hasKey,
      health,
      environments,
      selectedEnv,
      // Was the raw useState setter, which React treats as stable and exempt.
      // It writes the URL and storage now, so it is a useCallback and belongs
      // here: without it, consumers would keep a stale one if router changed.
      setSelectedEnv,
      refreshEnvironments,
      envTypes,
      refreshTypes,
      ontologyVersion,
      bumpOntology,
      signOut,
    ],
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="h-8 w-8 animate-pulse rounded-full bg-line" />
      </div>
    );
  }

  return (
    <StudioContext.Provider value={value}>
     {/*
       The open alerts are read here, once, for every page under the shell: an
       alert must reach whoever is in the studio, whatever page they are on.
     */}
     <AlertFeedProvider env={selectedEnv} enabled={hasKey}>
      {/*
        The colours, the type and the square corners all come from the theme
        (`:root` in globals.css). The shell is the ground: panels sit one step
        lighter on it.
      */}
      <div className="flex h-screen flex-col bg-canvas text-ink">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4">
          <Link href="/studio/home" className="flex items-baseline gap-1.5 whitespace-nowrap text-[16px] tracking-tight">
            <span className="font-semibold text-ink">Obscyro</span>
            <span className="font-light text-ink-faint">Studio</span>
          </Link>

          {identity?.organizationName ? (
            <>
              <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
              <span className="hidden items-center gap-2 whitespace-nowrap text-[13px] text-ink-muted sm:inline-flex">
                <Building2 className="h-4 w-4" />
                {identity.organizationName}
              </span>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mx-auto hidden h-8 w-[320px] items-center gap-2.5 border-b border-line-strong bg-surface px-3 text-[13px] text-ink-faint transition-colors hover:bg-surface-hover md:flex"
          >
            <Search className="h-4 w-4" />
            Search or run a command
            <kbd className="ml-auto border border-line-strong px-1 font-mono text-[11px]">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-3">
            <AlertPill env={selectedEnv} />
            <EnvBadge env={currentEnv} />
            {currentEnv ? (
              <span className="hidden items-center gap-1.5 text-[11.5px] sm:flex">
                <Link href="/studio/home" className="text-ink-muted hover:text-ink">
                  Home
                </Link>
                <span className="text-ink-faint">/</span>
                <EnvSwitcher
                  environments={environments}
                  current={currentEnv}
                  onSelect={setSelectedEnv}
                />
              </span>
            ) : (
              <Link href="/studio/home" className="text-[11.5px] text-brand-deep hover:underline">
                Choose a project
              </Link>
            )}
            <HealthPill health={health} />
            <button
              type="button"
              onClick={signOut}
              className="h-8 whitespace-nowrap px-2 text-[12px] text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </header>

        <AlertStrip env={selectedEnv} />

        <div className="flex min-h-0 flex-1">
          <Suspense fallback={<div className="w-14 shrink-0 border-r border-line bg-canvas" />}>
            <PlatformRail capabilities={identity?.capabilities?.length ? identity.capabilities : null} />
          </Suspense>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Suspense fallback={<div className="h-11 shrink-0 border-b border-line bg-canvas" />}>
              <SectionTabs />
            </Suspense>
            {/* A page says what is selected on it; the analyst below hears it. */}
            <AnalystFocusProvider>
              {children}
              <AnalystDock env={selectedEnv} />
            </AnalystFocusProvider>
          </div>
        </div>

        <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-canvas px-4 text-[11px] text-ink-faint">
          <span>{identity?.email ?? "—"}</span>
          {identity?.roles?.length ? <span>· {identity.roles[0]}</span> : null}
          <span className="ml-auto">{selectedEnv ?? "no environment"}</span>
          <span>EN · FR</span>
        </footer>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        environments={environments.map((e) => ({ slug: e.slug, name: e.name }))}
        onSelectEnv={(slug) => setSelectedEnv(slug)}
        capabilities={identity?.capabilities?.length ? identity.capabilities : null}
      />
     </AlertFeedProvider>
    </StudioContext.Provider>
  );
}

/**
 * Persistent environment badge (spec §3.1: "non-negotiable"). Colour-coded so
 * a destructive operation in the wrong environment is hard to do by accident.
 */
/**
 * The environment name, as a control rather than a label.
 *
 * It was plain text, and the command palette was the only way to change
 * environments — which nobody discovers. A native select is deliberate here:
 * it is keyboard-reachable, it works on a phone, and it shows the type beside
 * each name so switching from a reference environment to a production one is a
 * decision rather than an accident.
 */
function EnvSwitcher({
  environments,
  current,
  onSelect,
}: {
  environments: EnvironmentSummary[];
  current: EnvironmentSummary;
  onSelect: (slug: string) => void;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        value={current.slug}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Environment"
        title="Switch environment"
        className="cursor-pointer appearance-none rounded border border-transparent bg-transparent py-0.5 pl-1 pr-5 text-[11.5px] font-medium text-ink hover:border-line hover:bg-surface-hover focus:border-brand focus:outline-none"
      >
        {environments.map((e) => (
          <option key={e.slug} value={e.slug}>
            {e.name} · {e.type}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 h-3 w-3 text-ink-faint" />
    </span>
  );
}

function EnvBadge({ env }: { env: EnvironmentSummary | undefined }) {
  if (!env) return null;
  const tone =
    env.type === "operations"
      ? { bg: "bg-warn-soft", text: "text-warn-ink", border: "border-warn-line", label: "PRODUCTION" }
      : env.type === "reference"
        ? { bg: "bg-brand-soft", text: "text-brand-deep", border: "border-brand-line", label: "REFERENCE" }
        : { bg: "bg-ok-soft", text: "text-ok-ink", border: "border-ok-line", label: "SANDBOX" };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium tracking-[0.04em]",
        tone.bg,
        tone.text,
        tone.border,
      )}
      title={`${env.name} · ${env.type}`}
    >
      <AlertTriangle className="h-3 w-3" />
      {tone.label}
    </span>
  );
}
