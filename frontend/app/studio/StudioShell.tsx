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

import { AlertTriangle, Building2, Search } from "lucide-react";

import {
  getHealth,
  listEnvironments,
  listEnvTypes,
  type EnvObjectType,
  type EnvironmentSummary,
  type EnvironmentType,
  type HealthStatus,
} from "@/lib/platform-api";

import CommandPalette from "./CommandPalette";
import PlatformRail from "./PlatformRail";

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
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [health, setHealth] = useState<HealthStatus | "checking">("checking");
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<string | null>(null);
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
    apiFetch<Identity>("/v1/me")
      .then((me) => {
        if (!cancelled) setIdentity(me);
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

  const currentEnv = useMemo(
    () => environments.find((e) => e.slug === selectedEnv),
    [environments, selectedEnv],
  );

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
      <div className="flex h-screen flex-col bg-white text-[#1c2127]">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[#d3d8de] bg-[#f6f7f9] px-3">
          <Link href="/studio/manager" className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium lowercase tracking-tight">obscyro</span>
          </Link>

          {identity?.organizationName ? (
            <span className="hidden items-center gap-1.5 rounded border border-[#d3d8de] bg-white px-2 py-1 text-[11.5px] text-[#1c2127] sm:inline-flex">
              <Building2 className="h-3.5 w-3.5 text-[#215db0]" />
              {identity.organizationName}
            </span>
          ) : null}

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mx-auto hidden w-[280px] items-center gap-2 rounded border border-[#d3d8de] bg-white px-2.5 py-1 text-[11.5px] text-[#8f99a8] transition-colors hover:border-[#2d72d2] md:flex"
          >
            <Search className="h-3.5 w-3.5" />
            Search or run a command
            <kbd className="ml-auto rounded border border-[#d3d8de] px-1 text-[10px]">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2.5">
            <EnvBadge env={currentEnv} />
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Environment</span>
              <select
                value={selectedEnv ?? ""}
                onChange={(e) => setSelectedEnv(e.target.value || null)}
                disabled={environments.length === 0}
                className="max-w-[200px] rounded border border-[#d3d8de] bg-white px-2 py-1 text-[11.5px] text-[#1c2127] focus:border-[#2d72d2] focus:outline-none disabled:text-[#8f99a8]"
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
              className="rounded px-2 py-1.5 text-[11.5px] text-[#5f6b7c] transition-colors hover:text-[#1c2127]"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <Suspense fallback={<div className="w-14 shrink-0 border-r border-[#d3d8de] bg-[#f6f7f9]" />}>
            <PlatformRail capabilities={identity?.capabilities ?? null} />
          </Suspense>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>

        <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-[#d3d8de] bg-[#f6f7f9] px-3 text-[10.5px] text-[#5f6b7c]">
          <span>{identity?.email ?? "—"}</span>
          {identity?.roles.length ? <span>· {identity.roles[0]}</span> : null}
          <span className="ml-auto">{selectedEnv ?? "no environment"}</span>
          <span>EN · FR</span>
        </footer>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        environments={environments.map((e) => ({ slug: e.slug, name: e.name }))}
        onSelectEnv={(slug) => setSelectedEnv(slug)}
        capabilities={identity?.capabilities ?? null}
      />
    </StudioContext.Provider>
  );
}

/**
 * Persistent environment badge (spec §3.1: "non-negotiable"). Colour-coded so
 * a destructive operation in the wrong environment is hard to do by accident.
 */
function EnvBadge({ env }: { env: EnvironmentSummary | undefined }) {
  if (!env) return null;
  const tone =
    env.type === "operations"
      ? { bg: "bg-[#fdf0e6]", text: "text-[#935610]", border: "border-[#f5c4b3]", label: "PRODUCTION" }
      : env.type === "reference"
        ? { bg: "bg-[#e7f2fd]", text: "text-[#215db0]", border: "border-[#b5d4f4]", label: "REFERENCE" }
        : { bg: "bg-[#e8f4ec]", text: "text-[#1c6e42]", border: "border-[#9fe1cb]", label: "SANDBOX" };
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
