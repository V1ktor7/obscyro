"use client";

/**
 * StudioShell — top navigator + shared ontology context for the three Studio
 * tabs (Parser, Manager, Studio Obscyro). Owns session gating, the global
 * environment switcher, health polling, and sign-out so every tab shares one
 * source of truth. Anything created in the Manager (envs, types, instances)
 * becomes visible to the other tabs via `refreshEnvironments` / `bumpOntology`.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { clearSession, clearStoredKey, getSession, getStoredKey } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  getHealth,
  listEnvironments,
  listEnvTypes,
  type EnvObjectType,
  type EnvironmentSummary,
  type EnvironmentType,
  type HealthStatus,
} from "@/lib/platform-api";

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

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error("useStudio must be used inside <StudioShell>");
  }
  return ctx;
}

const TABS: { href: string; label: string; sub: string }[] = [
  { href: "/studio/parser", label: "Ontology Parser", sub: "ingest" },
  { href: "/studio/manager", label: "Ontology Manager", sub: "model" },
  { href: "/studio/workspace", label: "Studio Obscyro", sub: "build" },
  { href: "/studio/command", label: "Live Twin", sub: "twin" },
  { href: "/studio/crisis", label: "Simulation", sub: "sim" },
  { href: "/studio/flux", label: "Data Flux", sub: "flux" },
  { href: "/studio/quality", label: "Data Quality", sub: "dq" },
];

function envTypeBadge(type: EnvironmentType): string {
  if (type === "reference") return "ref";
  if (type === "operations") return "ops";
  return "entity";
}

function HealthPill({ health }: { health: HealthStatus | "checking" }) {
  const map: Record<HealthStatus | "checking", { dot: string; label: string }> = {
    checking: { dot: "bg-gray-300", label: "Checking API…" },
    ok: { dot: "bg-emerald-500", label: "Live — connected to API" },
    degraded: { dot: "bg-amber-500", label: "Degraded — database issue" },
    offline: { dot: "bg-gray-400", label: "Offline — API unreachable" },
  };
  const { dot, label } = map[health];
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] text-gray-500 sm:inline-flex">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

export default function StudioShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [health, setHealth] = useState<HealthStatus | "checking">("checking");
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<string | null>(null);
  const [envTypes, setEnvTypes] = useState<EnvObjectType[]>([]);
  const [ontologyVersion, setOntologyVersion] = useState(0);

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
      setSelectedEnv((cur) => cur ?? envs[0]?.slug ?? null);
    } catch {
      setEnvironments([]);
    }
  }, []);

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

  const showMultipleOrgs = useMemo(
    () => new Set(environments.map((e) => e.organizationId)).size > 1,
    [environments],
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
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
      </div>
    );
  }

  return (
    <StudioContext.Provider value={value}>
      <div className="flex h-screen flex-col bg-white text-gray-900">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-4">
          <div className="flex items-center gap-4">
            <Link href="/studio/parser" className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-semibold lowercase tracking-tight">
                obscyro
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
                studio
              </span>
            </Link>
            <nav className="flex rounded-md border border-gray-200 p-0.5">
              {TABS.map((tab) => {
                const active = pathname?.startsWith(tab.href);
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={cn(
                      "rounded px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? "bg-gray-900 text-white"
                        : "text-gray-500 hover:text-gray-900",
                    )}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
                env
              </span>
              <select
                value={selectedEnv ?? ""}
                onChange={(e) => setSelectedEnv(e.target.value || null)}
                disabled={environments.length === 0}
                className="max-w-[220px] rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-gray-400 focus:outline-none disabled:text-gray-400"
              >
                {environments.length === 0 ? (
                  <option value="">no environments</option>
                ) : (
                  environments.map((env) => (
                    <option key={env.id} value={env.slug}>
                      {showMultipleOrgs ? `${env.organizationName} · ` : ""}
                      {env.name} ({envTypeBadge(env.type)})
                    </option>
                  ))
                )}
              </select>
            </label>
            <HealthPill health={health} />
            <button
              type="button"
              onClick={signOut}
              className="rounded-md px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </StudioContext.Provider>
  );
}
