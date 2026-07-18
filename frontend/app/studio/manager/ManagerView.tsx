"use client";

/**
 * Ontology Manager — construct and edit an ontology from A-Z:
 *  - create/edit/delete object types and their property schema
 *  - define relationships (link types) between object types
 *  - browse, create, edit, link, and delete instances of each type
 *  - a visual schema graph (object types as boxes, link types as edges)
 *
 * Every mutation calls `bumpOntology()` (and `refreshEnvironments()` for env
 * changes) on the shared StudioContext so the Parser "Save to ontology" node
 * and the Studio "Ontology source" node immediately see new types/instances.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Activity,
  ArrowRight,
  BedDouble,
  Box,
  Braces,
  ChevronDown,
  ChevronsUpDown,
  Compass,
  Eraser,
  FlaskConical,
  GitFork,
  GitPullRequest,
  HeartPulse,
  History,
  LayoutGrid,
  Link2,
  Pill,
  Plus,
  Rows3,
  Search,
  Settings,
  Sigma,
  Star,
  Stethoscope,
  Table2,
  User,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import {
  createEnvironment,
  createEnvLink,
  createEnvLinkType,
  createEnvObject,
  createEnvType,
  deleteEnvLink,
  deleteEnvLinkType,
  deleteEnvObject,
  deleteEnvType,
  getEnvObject,
  getOntologySummary,
  importEnvironment,
  listEnvObjects,
  listEnvTypes,
  updateEnvObject,
  updateEnvType,
  type EnvInstance,
  type EnvLinkEdge,
  type EnvLinkType,
  type EnvObjectType,
  type EnvironmentType,
  type EnvTypeSummary,
  type LinkCardinality,
  type ObjectNature,
  type OntologySummary,
  type PropertyDefinition,
  type PropertyType,
} from "@/lib/platform-api";
import {
  loadFavorites,
  loadRecents,
  pushRecent,
  toggleFavorite,
} from "./manager-prefs";
import {
  clearSchemaLayout,
  loadSchemaLayout,
  mergeLayoutPositions,
  saveSchemaLayout,
  type SchemaLayout,
} from "../manager-layout-persist";
import { listQualityFlags, type QualityFlag } from "../quality-api";
import SchemaGraphCanvas from "./SchemaGraphCanvas";
import { useStudio } from "../StudioShell";

type View =
  | "discover"
  | "schema"
  | "instances"
  | "objectTypes"
  | "properties"
  | "linkTypes"
  | "actionTypes"
  | "typeGroups"
  | "valueSets"
  | "functions"
  | "proposals"
  | "history"
  | "health"
  | "cleanup"
  | "config";

// Foundry-style visual identity per object type: icon by clinical keyword,
// tint deterministic on the type name so it is stable across sessions.
const TYPE_ICONS: [RegExp, LucideIcon][] = [
  [/patient|person|subject/i, User],
  [/practitioner|clinician|doctor|provider|nurse|staff/i, Stethoscope],
  [/medication|drug|substance|prescription|dose/i, Pill],
  [/lab|specimen|sample|observation|result|test/i, FlaskConical],
  [/ward|bed|room|unit|site|location|facility/i, BedDouble],
  [/finding|diagnosis|condition|disease|symptom|encounter|visit/i, Activity],
];

const TYPE_TINTS = [
  { bg: "bg-[#e7f2fd]", text: "text-[#215db0]", bgHex: "#e7f2fd", fgHex: "#215db0" },
  { bg: "bg-[#e8f4ec]", text: "text-[#1c6e42]", bgHex: "#e8f4ec", fgHex: "#1c6e42" },
  { bg: "bg-[#fdf0e6]", text: "text-[#935610]", bgHex: "#fdf0e6", fgHex: "#935610" },
  { bg: "bg-[#f2ebfb]", text: "text-[#6b3fa0]", bgHex: "#f2ebfb", fgHex: "#6b3fa0" },
  { bg: "bg-[#fceaef]", text: "text-[#a82255]", bgHex: "#fceaef", fgHex: "#a82255" },
  { bg: "bg-[#e9f5f4]", text: "text-[#0f6b68]", bgHex: "#e9f5f4", fgHex: "#0f6b68" },
];

function typeVisual(name: string): { Icon: LucideIcon; tint: (typeof TYPE_TINTS)[number] } {
  const Icon = TYPE_ICONS.find(([re]) => re.test(name))?.[1] ?? Box;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return { Icon, tint: TYPE_TINTS[Math.abs(hash) % TYPE_TINTS.length] };
}

// A "type group" is a connected component of the schema graph (object types
// joined by link types), named after its highest-traffic member — the closest
// real analogue to Foundry's curated type groups without new schema.
interface TypeGroup {
  name: string;
  members: string[];
  links: EnvLinkType[];
}

function computeTypeGroups(
  types: EnvObjectType[],
  linkTypes: EnvLinkType[],
  summary: OntologySummary | null,
): TypeGroup[] {
  const parent = new Map<string, string>();
  for (const t of types) parent.set(t.name, t.name);
  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  }
  for (const lt of linkTypes) {
    if (!parent.has(lt.fromType) || !parent.has(lt.toType)) continue;
    const a = find(lt.fromType);
    const b = find(lt.toType);
    if (a !== b) parent.set(a, b);
  }
  const components = new Map<string, string[]>();
  for (const t of types) {
    const root = find(t.name);
    const list = components.get(root);
    if (list) list.push(t.name);
    else components.set(root, [t.name]);
  }
  const instanceCount = new Map(
    summary?.types.map((s) => [s.name, s.instanceCount] as const) ?? [],
  );
  return Array.from(components.values())
    .filter((members) => members.length >= 2)
    .map((members) => {
      const anchor = [...members].sort(
        (a, b) => (instanceCount.get(b) ?? 0) - (instanceCount.get(a) ?? 0),
      )[0];
      const memberSet = new Set(members);
      return {
        name: anchor,
        members,
        links: linkTypes.filter(
          (lt) => memberSet.has(lt.fromType) && memberSet.has(lt.toType),
        ),
      };
    })
    .sort((a, b) => b.members.length - a.members.length);
}

const PROPERTY_TYPES: PropertyType[] = ["string", "number", "boolean", "object", "array"];
const CARDINALITIES: LinkCardinality[] = [
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
];

function instanceLabel(inst: EnvInstance): string {
  const p = inst.properties;
  return (
    (p.span as string) ||
    (p.display as string) ||
    (p.label as string) ||
    (p.identifier as string) ||
    (p.snomed_code as string) ||
    inst.id.slice(0, 8)
  );
}

const ENV_TYPE_HELP: Record<EnvironmentType, string> = {
  reference: "Shared catalogs (substances, codes) — starts empty.",
  entity: "Clinical sites — seeds Patient, ClinicalFinding, has_finding.",
  operations: "Supply chain / logistics — starts empty.",
};

export default function ManagerView() {
  const {
    hasKey,
    selectedEnv,
    setSelectedEnv,
    environments,
    refreshEnvironments,
    ontologyVersion,
    bumpOntology,
  } = useStudio();

  const [view, setView] = useState<View>("discover");
  const [types, setTypes] = useState<EnvObjectType[]>([]);
  const [linkTypes, setLinkTypes] = useState<EnvLinkType[]>([]);
  const [summary, setSummary] = useState<OntologySummary | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [healthFlags, setHealthFlags] = useState<QualityFlag[]>([]);
  const [recentObjects, setRecentObjects] = useState<EnvInstance[]>([]);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [objects, setObjects] = useState<EnvInstance[]>([]);
  const [flagCounts, setFlagCounts] = useState<Map<string, number>>(new Map());
  const [whereInput, setWhereInput] = useState("");
  const [detail, setDetail] = useState<{ object: EnvInstance; links: EnvLinkEdge[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLayout, setSavedLayout] = useState<SchemaLayout>({});
  const [placementMode, setPlacementMode] = useState(false);
  const [pendingTypePos, setPendingTypePos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [linkPrefill, setLinkPrefill] = useState<{
    fromType: string;
    toType: string;
  } | null>(null);
  const saveLayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const env = selectedEnv;

  // Editor panels
  const [panel, setPanel] = useState<"none" | "newType" | "newLinkType" | "newInstance">(
    "none",
  );

  useEffect(() => {
    if (!env) {
      setSavedLayout({});
      return;
    }
    setSavedLayout(loadSchemaLayout(env));
  }, [env]);

  const debouncedSaveLayout = useCallback(
    (layout: SchemaLayout) => {
      if (!env) return;
      if (saveLayoutTimerRef.current) clearTimeout(saveLayoutTimerRef.current);
      saveLayoutTimerRef.current = setTimeout(() => {
        saveSchemaLayout(env, layout);
      }, 500);
    },
    [env],
  );

  const handlePositionChange = useCallback(
    (typeName: string, pos: { x: number; y: number }) => {
      setSavedLayout((prev) => {
        const next = { ...prev, [typeName]: pos };
        debouncedSaveLayout(next);
        return next;
      });
    },
    [debouncedSaveLayout],
  );

  function resetLayout() {
    if (!env) return;
    clearSchemaLayout(env);
    setSavedLayout({});
  }

  function openCreateTypeAt(pos: { x: number; y: number }) {
    setPendingTypePos(pos);
    setPlacementMode(false);
    setDetail(null);
    setPanel("newType");
  }

  function handleCanvasConnect(fromType: string, toType: string) {
    if (fromType === toType) {
      setError("Cannot link a type to itself.");
      return;
    }
    setLinkPrefill({ fromType, toType });
    setPanel("newLinkType");
  }

  const loadTypes = useCallback(async () => {
    if (!env) {
      setTypes([]);
      setLinkTypes([]);
      setSummary(null);
      return;
    }
    try {
      const { types: t, linkTypes: lt } = await listEnvTypes(env);
      setTypes(t);
      setLinkTypes(lt);
      setSelectedType((cur) => cur ?? t[0]?.name ?? null);
      setSummary(await getOntologySummary(env).catch(() => null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [env]);

  useEffect(() => {
    setDetail(null);
    void loadTypes();
  }, [loadTypes, ontologyVersion]);

  useEffect(() => {
    setFavorites(env ? loadFavorites(env) : []);
    setRecents(env ? loadRecents(env) : []);
  }, [env]);

  // Cmd/Ctrl+K focuses the manager search from anywhere in the view.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("discover");
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openType = useCallback(
    (name: string, target: View = "instances") => {
      setSelectedType(name);
      setDetail(null);
      setPanel("none");
      setView(target);
      if (env) setRecents(pushRecent(env, name));
    },
    [env],
  );

  const handleToggleFavorite = useCallback(
    (name: string) => {
      if (env) setFavorites(toggleFavorite(env, name));
    },
    [env],
  );

  const typeGroups = useMemo(
    () => computeTypeGroups(types, linkTypes, summary),
    [types, linkTypes, summary],
  );

  const groupByType = useMemo(() => {
    const m = new Map<string, TypeGroup>();
    for (const g of typeGroups) for (const member of g.members) m.set(member, g);
    return m;
  }, [typeGroups]);

  const envInfo = useMemo(
    () => environments.find((e) => e.slug === env) ?? null,
    [environments, env],
  );

  // Lazy-load data for the health and history pages when they open.
  useEffect(() => {
    if (view !== "health" || !env) return;
    listQualityFlags(env, { status: "open" })
      .then(({ flags }) => setHealthFlags(flags))
      .catch((err) => setError((err as Error).message));
  }, [view, env, ontologyVersion]);

  useEffect(() => {
    if (view !== "history" || !env) return;
    listEnvObjects(env, { limit: 50 })
      .then(({ objects }) => setRecentObjects(objects))
      .catch((err) => setError((err as Error).message));
  }, [view, env, ontologyVersion]);

  const loadObjects = useCallback(async () => {
    if (!env || !selectedType) {
      setObjects([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { objects: o } = await listEnvObjects(env, {
        type: selectedType,
        where: whereInput.trim() || undefined,
        limit: 100,
      });
      setObjects(o);
      const { flags } = await listQualityFlags(env, { status: "open" }).catch(() => ({
        flags: [],
      }));
      const counts = new Map<string, number>();
      for (const f of flags) {
        counts.set(f.instanceId, (counts.get(f.instanceId) ?? 0) + 1);
      }
      setFlagCounts(counts);
    } catch (err) {
      setError((err as Error).message);
      setObjects([]);
    } finally {
      setLoading(false);
    }
  }, [env, selectedType, whereInput]);

  useEffect(() => {
    if (view === "instances") void loadObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, env, selectedType, ontologyVersion]);

  async function openInstance(id: string) {
    if (!env) return;
    try {
      setDetail(await getEnvObject(env, id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function notifyChanged() {
    bumpOntology();
  }

  const selectedTypeDef = useMemo(
    () => types.find((t) => t.name === selectedType) ?? null,
    [types, selectedType],
  );

  const positions = useMemo(
    () => mergeLayoutPositions(types.map((t) => t.name), savedLayout),
    [types, savedLayout],
  );

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to model ontology environments.
        </p>
      </div>
    );
  }

  const totals = summary?.totals;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f7f9]">
      {/* Top bar — title, global search, primary action */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#d3d8de] bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[#e7f2fd] text-[#2d72d2]">
            <Box className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13px] font-semibold text-[#1c2127]">
            Ontology management
          </span>
        </div>
        <div className="flex flex-1 justify-center">
          <div className="flex w-full max-w-md items-center gap-2 rounded border border-[#d3d8de] bg-[#f6f7f9] px-2.5 py-1.5 focus-within:border-[#2d72d2]">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#5f6b7c]" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setView("discover");
              }}
              placeholder="Search object types by name or description…"
              className="w-full bg-transparent text-xs text-[#1c2127] placeholder:text-[#8f99a8] focus:outline-none"
            />
            <kbd className="shrink-0 rounded border border-[#d3d8de] bg-white px-1 text-[10px] text-[#5f6b7c]">
              ⌘K
            </kbd>
          </div>
        </div>
        <span className="hidden items-center gap-1.5 rounded border border-[#d3d8de] px-2 py-1 text-[11px] text-[#404854] md:flex">
          <GitFork className="h-3 w-3 text-[#5f6b7c]" />
          {env ?? "no environment"}
        </span>
        <div className="relative">
          <button
            type="button"
            disabled={!env}
            onClick={() => setNewMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
          >
            <Plus className="h-3.5 w-3.5" />
            New
            <ChevronDown className="h-3 w-3" />
          </button>
          {newMenuOpen ? (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setNewMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-[#d3d8de] bg-white py-1 shadow-lg">
                {(
                  [
                    ["Object type", () => setPanel("newType"), true],
                    ["Link type", () => setPanel("newLinkType"), types.length >= 1],
                    ["Instance", () => setPanel("newInstance"), Boolean(selectedTypeDef)],
                    ["Environment", () => setView("config"), true],
                  ] as const
                ).map(([label, action, enabled]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={!enabled}
                    onClick={() => {
                      setNewMenuOpen(false);
                      action();
                    }}
                    className="block w-full px-3 py-1.5 text-left text-xs text-[#404854] hover:bg-[#f6f7f9] disabled:text-[#c5cbd3]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail — environment switcher, navigation, resources */}
        <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-[#d3d8de] bg-white">
          <div className="relative border-b border-[#e5e8eb]">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-semibold text-[#1c2127]">
                  {envInfo?.name ?? env ?? "No environment"}
                </p>
                <p className="truncate text-[11px] text-[#8f99a8]">
                  {envInfo
                    ? `${envInfo.organizationName} · ${envInfo.type}`
                    : "Select an environment"}
                </p>
              </div>
              <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-[#8f99a8]" />
            </div>
            <select
              value={env ?? ""}
              onChange={(e) => setSelectedEnv(e.target.value || null)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Switch environment"
            >
              {environments.length === 0 ? (
                <option value="">No environments</option>
              ) : (
                environments.map((e) => (
                  <option key={e.id} value={e.slug}>
                    {e.name} ({e.organizationName})
                  </option>
                ))
              )}
            </select>
          </div>

          <nav className="flex flex-col gap-0.5 p-2">
            <RailItem
              icon={Compass}
              label="Discover"
              active={view === "discover"}
              onClick={() => setView("discover")}
            />
            <RailItem
              icon={GitFork}
              label="Schema graph"
              active={view === "schema"}
              onClick={() => setView("schema")}
            />
            <RailItem
              icon={Table2}
              label="Instances"
              active={view === "instances"}
              onClick={() => setView("instances")}
            />
            <RailItem
              icon={GitPullRequest}
              label="Proposals"
              active={view === "proposals"}
              onClick={() => setView("proposals")}
            />
            <RailItem
              icon={History}
              label="History"
              active={view === "history"}
              onClick={() => setView("history")}
            />
          </nav>

          <div className="px-4 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
            Resources
          </div>
          <nav className="flex flex-col gap-0.5 px-2 pb-2">
            <RailItem
              icon={Box}
              label="Object types"
              count={totals?.objectTypes ?? types.length}
              active={view === "objectTypes"}
              onClick={() => setView("objectTypes")}
            />
            <RailItem
              icon={Rows3}
              label="Properties"
              count={totals?.properties}
              active={view === "properties"}
              onClick={() => setView("properties")}
            />
            <RailItem
              icon={Link2}
              label="Link types"
              count={totals?.linkTypes ?? linkTypes.length}
              active={view === "linkTypes"}
              onClick={() => setView("linkTypes")}
            />
            <RailItem
              icon={Zap}
              label="Action types"
              active={view === "actionTypes"}
              onClick={() => setView("actionTypes")}
            />
            <RailItem
              icon={LayoutGrid}
              label="Type groups"
              count={typeGroups.length}
              active={view === "typeGroups"}
              onClick={() => setView("typeGroups")}
            />
            <RailItem
              icon={Braces}
              label="Value sets"
              active={view === "valueSets"}
              onClick={() => setView("valueSets")}
            />
            <RailItem
              icon={Sigma}
              label="Functions"
              active={view === "functions"}
              onClick={() => setView("functions")}
            />
          </nav>

          <div className="px-4 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
            Maintenance
          </div>
          <nav className="flex flex-col gap-0.5 px-2 pb-2">
            <RailItem
              icon={HeartPulse}
              label="Health issues"
              count={totals?.openFlags ?? 0}
              danger={(totals?.openFlags ?? 0) > 0}
              active={view === "health"}
              onClick={() => setView("health")}
            />
            <RailItem
              icon={Eraser}
              label="Cleanup"
              active={view === "cleanup"}
              onClick={() => setView("cleanup")}
            />
          </nav>

          <div className="mt-auto border-t border-[#e5e8eb] p-2">
            <RailItem
              icon={Settings}
              label="Ontology configuration"
              active={view === "config"}
              onClick={() => setView("config")}
            />
          </div>
        </aside>

        {/* Center — discover / schema / instances */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {view === "schema" || view === "instances" ? (
        <div className="flex items-center justify-between border-b border-[#d3d8de] px-4 py-2">
          <div className="flex rounded-md border border-[#d3d8de] p-0.5">
            {(["schema", "instances"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
                  view === v ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          {view === "instances" ? (
            <div className="flex items-center gap-1.5">
              <input
                value={whereInput}
                onChange={(e) => setWhereInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadObjects();
                }}
                placeholder="where: assertion:affirmed,subject:patient"
                className="w-72 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-[11px] text-gray-800 focus:border-gray-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void loadObjects()}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Refresh
              </button>
              <button
                type="button"
                disabled={!selectedType}
                onClick={() => setPanel("newInstance")}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
              >
                + Instance
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] text-gray-400 lg:inline">
                Drag boxes · drag ports to link · double-click to add type
              </span>
              <button
                type="button"
                disabled={!env}
                onClick={() => setPlacementMode((v) => !v)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs transition-colors",
                  placementMode
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                )}
              >
                + Type
              </button>
              <button
                type="button"
                disabled={!env || types.length === 0}
                onClick={resetLayout}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:text-gray-300"
              >
                Reset layout
              </button>
            </div>
          )}
        </div>
        ) : null}

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-700">
            {error}
          </div>
        ) : null}

        {view === "discover" ? (
          <DiscoverView
            summary={summary}
            favorites={favorites}
            recents={recents}
            search={search}
            hasEnv={Boolean(env)}
            typeGroups={typeGroups}
            groupByType={groupByType}
            onOpenType={openType}
            onToggleFavorite={handleToggleFavorite}
            onNewType={() => setPanel("newType")}
            onNavigate={setView}
          />
        ) : view === "schema" ? (
          <SchemaGraphCanvas
            types={types}
            linkTypes={linkTypes}
            positions={positions}
            selectedType={selectedType}
            placementMode={placementMode}
            onSelectType={(name) => {
              setSelectedType(name);
              setDetail(null);
              setPanel("none");
            }}
            onPositionChange={handlePositionChange}
            onConnect={handleCanvasConnect}
            onCanvasDoubleClick={openCreateTypeAt}
            onCanvasClickPlace={openCreateTypeAt}
          />
        ) : view === "instances" ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : objects.length === 0 ? (
              <p className="text-sm text-gray-400">
                No instances{selectedType ? ` of ${selectedType}` : ""}
                {whereInput.trim() ? " match this filter." : " yet."}
              </p>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="px-2 py-1.5 font-medium">Label</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium">Updated</th>
                    <th className="px-2 py-1.5 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {objects.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => openInstance(o.id)}
                      className={cn(
                        "cursor-pointer border-b border-gray-100 hover:bg-gray-50",
                        detail?.object.id === o.id ? "bg-indigo-50" : "",
                      )}
                    >
                      <td className="px-2 py-1.5 font-medium text-gray-800">
                        <span className="inline-flex items-center gap-1.5">
                          {instanceLabel(o)}
                          {(flagCounts.get(o.id) ?? 0) > 0 ? (
                            <Badge tone="warning">{flagCounts.get(o.id)}</Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">{o.typeName}</td>
                      <td className="px-2 py-1.5 text-gray-400">
                        {new Date(o.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-gray-400">
                        {(o.provenance.source as string) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <ResourcePages
            view={view}
            env={env}
            envInfo={envInfo}
            environments={environments}
            summary={summary}
            types={types}
            linkTypes={linkTypes}
            typeGroups={typeGroups}
            healthFlags={healthFlags}
            recentObjects={recentObjects}
            onOpenType={openType}
            onOpenInstance={(id) => void openInstance(id)}
            onNewLinkType={() => setPanel("newLinkType")}
            onDeleteLinkType={async (name) => {
              if (!env) return;
              try {
                await deleteEnvLinkType(env, name);
                await loadTypes();
                notifyChanged();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
            onEnvCreated={async (slug) => {
              await refreshEnvironments();
              setSelectedEnv(slug);
              bumpOntology();
            }}
            onImported={() => bumpOntology()}
            onError={setError}
          />
        )}
      </div>

      {/* Right inspector — context-dependent editor */}
      {panel === "newType" ? (
        <TypeEditorPanel
          mode="create"
          onClose={() => {
            setPanel("none");
            setPendingTypePos(null);
          }}
          onSubmit={async (name, description, schema, nature) => {
            if (!env) return;
            await createEnvType(env, { name, description, nature, propertySchema: schema });
            if (pendingTypePos) {
              const next = { ...savedLayout, [name]: pendingTypePos };
              setSavedLayout(next);
              saveSchemaLayout(env, next);
              setPendingTypePos(null);
            }
            await loadTypes();
            setSelectedType(name);
            notifyChanged();
            setPanel("none");
          }}
          onError={setError}
        />
      ) : panel === "newLinkType" ? (
        <LinkTypeEditorPanel
          types={types}
          initialFrom={linkPrefill?.fromType}
          initialTo={linkPrefill?.toType}
          onClose={() => {
            setPanel("none");
            setLinkPrefill(null);
          }}
          onSubmit={async (name, fromType, toType, cardinality) => {
            if (!env) return;
            await createEnvLinkType(env, { name, fromType, toType, cardinality });
            await loadTypes();
            notifyChanged();
            setPanel("none");
            setLinkPrefill(null);
          }}
          onError={setError}
        />
      ) : panel === "newInstance" && selectedTypeDef ? (
        <InstanceEditorPanel
          typeDef={selectedTypeDef}
          onClose={() => setPanel("none")}
          onSubmit={async (properties) => {
            if (!env) return;
            await createEnvObject(env, { type: selectedTypeDef.name, properties });
            await loadObjects();
            notifyChanged();
            setPanel("none");
          }}
          onError={setError}
        />
      ) : detail ? (
        <InstanceDetailPanel
          env={env!}
          detail={detail}
          types={types}
          linkTypes={linkTypes}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            await loadObjects();
            await openInstance(detail.object.id);
            notifyChanged();
          }}
          onDeleted={async () => {
            setDetail(null);
            await loadObjects();
            notifyChanged();
          }}
          onError={setError}
        />
      ) : selectedTypeDef &&
        (view === "schema" || view === "instances" || view === "objectTypes") ? (
        <TypeEditorPanel
          key={selectedTypeDef.id}
          mode="edit"
          initial={selectedTypeDef}
          onClose={() => setSelectedType(null)}
          onSubmit={async (_name, description, schema, nature) => {
            if (!env) return;
            await updateEnvType(env, selectedTypeDef.name, {
              description,
              nature,
              propertySchema: schema,
            });
            await loadTypes();
            notifyChanged();
          }}
          onDelete={async () => {
            if (!env) return;
            await deleteEnvType(env, selectedTypeDef.name);
            setSelectedType(null);
            await loadTypes();
            notifyChanged();
          }}
          onError={setError}
        />
      ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left rail item
// ---------------------------------------------------------------------------

function RailItem({
  icon: Icon,
  label,
  count,
  danger,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
        active
          ? "bg-[#e7f2fd] font-medium text-[#215db0]"
          : "text-[#404854] hover:bg-[#f6f7f9]",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[#2d72d2]" : "text-[#8f99a8]")} />
      <span className="truncate">{label}</span>
      {count !== undefined ? (
        <span
          className={cn(
            "ml-auto shrink-0 rounded px-1.5 text-[10px]",
            danger ? "bg-rose-50 text-rose-700" : "bg-[#f6f7f9] text-[#5f6b7c]",
          )}
        >
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Discover — Foundry-style landing page of object type cards
// ---------------------------------------------------------------------------

function TypeCard({
  stat,
  favorite,
  group,
  onOpen,
  onToggleFavorite,
}: {
  stat: EnvTypeSummary;
  favorite: boolean;
  group?: TypeGroup;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const { Icon, tint } = typeVisual(stat.name);
  const groupTint = group ? typeVisual(group.name).tint : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2 rounded-md border border-[#d3d8de] bg-white p-3 text-left transition-colors hover:border-[#2d72d2]"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            tint.bg,
            tint.text,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-[#1c2127]">
            {stat.name}
          </span>
          <span className="block text-[11px] text-[#5f6b7c]">
            {stat.instanceCount.toLocaleString()} object{stat.instanceCount === 1 ? "" : "s"}
          </span>
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite();
            }
          }}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          className="ml-auto shrink-0 p-0.5"
        >
          <Star
            className={cn(
              "h-3.5 w-3.5",
              favorite ? "fill-amber-400 text-amber-400" : "text-[#c5cbd3] hover:text-[#8f99a8]",
            )}
          />
        </span>
      </div>
      <div className="text-[11px] text-[#5f6b7c]">
        {stat.dependents} dependent{stat.dependents === 1 ? "" : "s"} · {stat.propertyCount}{" "}
        propert{stat.propertyCount === 1 ? "y" : "ies"}
      </div>
      {group && groupTint ? (
        <span
          className={cn(
            "inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
            groupTint.bg,
            groupTint.text,
          )}
        >
          {group.name} · {group.members.length}
        </span>
      ) : null}
      {stat.description ? (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-[#404854]">
          {stat.description}
        </p>
      ) : null}
    </button>
  );
}

// Mini schema-graph thumbnail for a type group (up to 5 members).
function GroupThumb({ group }: { group: TypeGroup }) {
  const slots: [number, number][] = [
    [22, 10],
    [82, 10],
    [10, 38],
    [55, 38],
    [100, 38],
  ];
  const shown = group.members.slice(0, slots.length);
  const pos = new Map(shown.map((name, i) => [name, slots[i]] as const));
  const boxW = 26;
  const boxH = 13;
  return (
    <svg viewBox="0 0 136 60" className="w-full" role="img" aria-label={`${group.name} group schema preview`}>
      {group.links.map((lt, i) => {
        const a = pos.get(lt.fromType);
        const b = pos.get(lt.toType);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a[0] + boxW / 2}
            y1={a[1] + boxH / 2}
            x2={b[0] + boxW / 2}
            y2={b[1] + boxH / 2}
            stroke="#c5cbd3"
            strokeWidth="1"
          />
        );
      })}
      {shown.map((name) => {
        const p = pos.get(name)!;
        const { tint } = typeVisual(name);
        return (
          <rect
            key={name}
            x={p[0]}
            y={p[1]}
            width={boxW}
            height={boxH}
            rx="3"
            fill={tint.bgHex}
            stroke={tint.fgHex}
            strokeWidth="0.75"
          />
        );
      })}
    </svg>
  );
}

function DiscoverSection({
  title,
  count,
  onSeeAll,
  children,
}: {
  title: string;
  count: number;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-[#1c2127]">{title}</h3>
        <span className="rounded bg-[#eef1f4] px-1.5 text-[10px] text-[#5f6b7c]">{count}</span>
        {onSeeAll ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="ml-auto flex items-center gap-1 text-[11px] text-[#2d72d2] hover:underline"
          >
            See all
            <ArrowRight className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function DiscoverView({
  summary,
  favorites,
  recents,
  search,
  hasEnv,
  typeGroups,
  groupByType,
  onOpenType,
  onToggleFavorite,
  onNewType,
  onNavigate,
}: {
  summary: OntologySummary | null;
  favorites: string[];
  recents: string[];
  search: string;
  hasEnv: boolean;
  typeGroups: TypeGroup[];
  groupByType: Map<string, TypeGroup>;
  onOpenType: (name: string, target?: View) => void;
  onToggleFavorite: (name: string) => void;
  onNewType: () => void;
  onNavigate: (view: View) => void;
}) {
  const allTypes = summary?.types ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? allTypes.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      )
    : allTypes;

  const byName = new Map(allTypes.map((t) => [t.name, t]));
  const favoriteStats = favorites
    .map((n) => byName.get(n))
    .filter((t): t is EnvTypeSummary => Boolean(t));
  const recentStats = recents
    .map((n) => byName.get(n))
    .filter((t): t is EnvTypeSummary => Boolean(t));

  if (!hasEnv) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#f6f7f9]">
        <p className="max-w-sm text-center text-sm text-[#5f6b7c]">
          Select or create an environment in the left rail to start modeling.
        </p>
      </div>
    );
  }

  const card = (stat: EnvTypeSummary) => (
    <TypeCard
      key={stat.id}
      stat={stat}
      favorite={favorites.includes(stat.name)}
      group={groupByType.get(stat.name)}
      onOpen={() => onOpenType(stat.name)}
      onToggleFavorite={() => onToggleFavorite(stat.name)}
    />
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#f6f7f9] p-4">
      <div className="flex flex-col gap-5">
        {q ? (
          <DiscoverSection title="Search results" count={filtered.length}>
            {filtered.map(card)}
          </DiscoverSection>
        ) : (
          <>
            {recentStats.length > 0 ? (
              <DiscoverSection
                title="Recently viewed object types"
                count={recentStats.length}
                onSeeAll={() => onNavigate("objectTypes")}
              >
                {recentStats.slice(0, 3).map(card)}
              </DiscoverSection>
            ) : null}
            {favoriteStats.length > 0 ? (
              <DiscoverSection
                title="Favorite object types"
                count={favoriteStats.length}
                onSeeAll={() => onNavigate("objectTypes")}
              >
                {favoriteStats.slice(0, 3).map(card)}
              </DiscoverSection>
            ) : null}
            {typeGroups.length > 0 ? (
              <DiscoverSection
                title="Type groups"
                count={typeGroups.length}
                onSeeAll={() => onNavigate("typeGroups")}
              >
                {typeGroups.slice(0, 3).map((g) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => onNavigate("typeGroups")}
                    className="flex flex-col items-center gap-1.5 rounded-md border border-[#d3d8de] bg-white p-3 transition-colors hover:border-[#2d72d2]"
                  >
                    <GroupThumb group={g} />
                    <span className="text-xs font-medium text-[#1c2127]">{g.name}</span>
                    <span className="text-[10px] text-[#8f99a8]">
                      {g.members.length} types · {g.links.length} links
                    </span>
                  </button>
                ))}
              </DiscoverSection>
            ) : null}
            <DiscoverSection
              title="All object types"
              count={allTypes.length}
              onSeeAll={() => onNavigate("objectTypes")}
            >
              {allTypes.map(card)}
            </DiscoverSection>
          </>
        )}
        {allTypes.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-[#c5cbd3] bg-white p-6">
            <p className="text-sm font-medium text-[#1c2127]">Start your ontology</p>
            <p className="text-xs text-[#5f6b7c]">
              Define your first clinical object type — Patient, Encounter, Medication — then
              link them in the schema graph.
            </p>
            <button
              type="button"
              onClick={onNewType}
              className="mt-1 flex items-center gap-1 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0]"
            >
              <Plus className="h-3.5 w-3.5" />
              New object type
            </button>
          </div>
        ) : q && filtered.length === 0 ? (
          <p className="text-xs text-[#5f6b7c]">No object types match “{search.trim()}”.</p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource pages — sidebar destinations other than discover/schema/instances
// ---------------------------------------------------------------------------

function PageShell({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#f6f7f9] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-[#1c2127]">{title}</h2>
        {count !== undefined ? (
          <span className="rounded bg-[#eef1f4] px-1.5 text-[10px] text-[#5f6b7c]">
            {count.toLocaleString()}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function PlaceholderPage({
  title,
  icon: Icon,
  body,
}: {
  title: string;
  icon: LucideIcon;
  body: string;
}) {
  return (
    <PageShell title={title}>
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-[#c5cbd3] bg-white p-6">
        <Icon className="h-5 w-5 text-[#8f99a8]" />
        <p className="text-xs leading-relaxed text-[#5f6b7c]">{body}</p>
      </div>
    </PageShell>
  );
}

const RESOURCE_TABLE = "w-full border-collapse rounded-md text-left text-xs";
const RESOURCE_TH =
  "border-b border-[#d3d8de] px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-[#8f99a8]";
const RESOURCE_TD = "border-b border-[#e5e8eb] px-3 py-2";

function ResourcePages({
  view,
  env,
  envInfo,
  environments,
  summary,
  types,
  linkTypes,
  typeGroups,
  healthFlags,
  recentObjects,
  onOpenType,
  onOpenInstance,
  onNewLinkType,
  onDeleteLinkType,
  onEnvCreated,
  onImported,
  onError,
}: {
  view: View;
  env: string | null;
  envInfo: { name: string; slug: string; type: string; organizationName: string } | null;
  environments: { id: string; name: string; slug: string; organizationName: string }[];
  summary: OntologySummary | null;
  types: EnvObjectType[];
  linkTypes: EnvLinkType[];
  typeGroups: TypeGroup[];
  healthFlags: QualityFlag[];
  recentObjects: EnvInstance[];
  onOpenType: (name: string, target?: View) => void;
  onOpenInstance: (id: string) => void;
  onNewLinkType: () => void;
  onDeleteLinkType: (name: string) => Promise<void>;
  onEnvCreated: (slug: string) => Promise<void>;
  onImported: () => void;
  onError: (msg: string) => void;
}) {
  const [importFrom, setImportFrom] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  async function handleImport() {
    if (!env || !importFrom || importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await importEnvironment(env, importFrom);
      setImportResult(
        `Imported ${res.types} types, ${res.instances.toLocaleString()} instances, ${res.linkTypes} link types, ${res.links.toLocaleString()} links.`,
      );
      onImported();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }
  if (view === "objectTypes") {
    const stats = summary?.types ?? [];
    return (
      <PageShell title="Object types" count={stats.length}>
        <div className="overflow-hidden rounded-md border border-[#d3d8de] bg-white">
          <table className={RESOURCE_TABLE}>
            <thead>
              <tr>
                <th className={RESOURCE_TH}>Name</th>
                <th className={RESOURCE_TH}>Description</th>
                <th className={RESOURCE_TH}>Properties</th>
                <th className={RESOURCE_TH}>Objects</th>
                <th className={RESOURCE_TH}>Dependents</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const { Icon, tint } = typeVisual(s.name);
                return (
                  <tr
                    key={s.id}
                    onClick={() => onOpenType(s.name)}
                    className="cursor-pointer text-[#404854] hover:bg-[#f6f7f9]"
                  >
                    <td className={cn(RESOURCE_TD, "font-medium text-[#1c2127]")}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                            tint.bg,
                            tint.text,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        {s.name}
                      </span>
                    </td>
                    <td className={cn(RESOURCE_TD, "max-w-xs truncate text-[#5f6b7c]")}>
                      {s.description ?? "—"}
                    </td>
                    <td className={RESOURCE_TD}>{s.propertyCount}</td>
                    <td className={RESOURCE_TD}>{s.instanceCount.toLocaleString()}</td>
                    <td className={RESOURCE_TD}>{s.dependents}</td>
                  </tr>
                );
              })}
              {stats.length === 0 ? (
                <tr>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")} colSpan={5}>
                    No object types yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageShell>
    );
  }

  if (view === "properties") {
    const rows = types.flatMap((t) =>
      t.propertySchema.map((p) => ({ type: t.name, key: p.key, kind: p.type, label: p.label })),
    );
    return (
      <PageShell title="Properties" count={rows.length}>
        <div className="overflow-hidden rounded-md border border-[#d3d8de] bg-white">
          <table className={RESOURCE_TABLE}>
            <thead>
              <tr>
                <th className={RESOURCE_TH}>Property</th>
                <th className={RESOURCE_TH}>Type</th>
                <th className={RESOURCE_TH}>Object type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.type}.${r.key}.${i}`}
                  onClick={() => onOpenType(r.type)}
                  className="cursor-pointer text-[#404854] hover:bg-[#f6f7f9]"
                >
                  <td className={cn(RESOURCE_TD, "font-medium text-[#1c2127]")}>
                    {r.label ?? r.key}
                    {r.label ? (
                      <span className="ml-1.5 font-normal text-[#8f99a8]">({r.key})</span>
                    ) : null}
                  </td>
                  <td className={cn(RESOURCE_TD, "font-mono text-[11px]")}>{r.kind}</td>
                  <td className={RESOURCE_TD}>{r.type}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")} colSpan={3}>
                    No properties defined yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageShell>
    );
  }

  if (view === "linkTypes") {
    return (
      <PageShell title="Link types" count={linkTypes.length}>
        <div className="mb-2">
          <button
            type="button"
            onClick={onNewLinkType}
            className="flex items-center gap-1 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0]"
          >
            <Plus className="h-3.5 w-3.5" />
            New link type
          </button>
        </div>
        <div className="overflow-hidden rounded-md border border-[#d3d8de] bg-white">
          <table className={RESOURCE_TABLE}>
            <thead>
              <tr>
                <th className={RESOURCE_TH}>Name</th>
                <th className={RESOURCE_TH}>From</th>
                <th className={RESOURCE_TH}>To</th>
                <th className={RESOURCE_TH}>Cardinality</th>
                <th className={RESOURCE_TH}></th>
              </tr>
            </thead>
            <tbody>
              {linkTypes.map((lt) => (
                <tr key={lt.id} className="text-[#404854] hover:bg-[#f6f7f9]">
                  <td className={cn(RESOURCE_TD, "font-medium text-[#1c2127]")}>{lt.name}</td>
                  <td className={RESOURCE_TD}>{lt.fromType}</td>
                  <td className={RESOURCE_TD}>{lt.toType}</td>
                  <td className={cn(RESOURCE_TD, "font-mono text-[11px]")}>{lt.cardinality}</td>
                  <td className={cn(RESOURCE_TD, "text-right")}>
                    <button
                      type="button"
                      onClick={() => void onDeleteLinkType(lt.name)}
                      className="text-[10px] text-[#8f99a8] hover:text-rose-600"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {linkTypes.length === 0 ? (
                <tr>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")} colSpan={5}>
                    No link types yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageShell>
    );
  }

  if (view === "typeGroups") {
    return (
      <PageShell title="Type groups" count={typeGroups.length}>
        {typeGroups.length === 0 ? (
          <p className="text-xs text-[#8f99a8]">
            Groups appear once object types are connected by link types.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {typeGroups.map((g) => (
              <div
                key={g.name}
                className="flex flex-col gap-2 rounded-md border border-[#d3d8de] bg-white p-3"
              >
                <GroupThumb group={g} />
                <p className="text-xs font-semibold text-[#1c2127]">{g.name}</p>
                <div className="flex flex-wrap gap-1">
                  {g.members.map((m) => {
                    const { tint } = typeVisual(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onOpenType(m)}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          tint.bg,
                          tint.text,
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageShell>
    );
  }

  if (view === "health") {
    return (
      <PageShell title="Health issues" count={healthFlags.length}>
        <div className="overflow-hidden rounded-md border border-[#d3d8de] bg-white">
          <table className={RESOURCE_TABLE}>
            <thead>
              <tr>
                <th className={RESOURCE_TH}>Severity</th>
                <th className={RESOURCE_TH}>Code</th>
                <th className={RESOURCE_TH}>Message</th>
                <th className={RESOURCE_TH}>Layer</th>
                <th className={RESOURCE_TH}>Created</th>
              </tr>
            </thead>
            <tbody>
              {healthFlags.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => onOpenInstance(f.instanceId)}
                  className="cursor-pointer text-[#404854] hover:bg-[#f6f7f9]"
                >
                  <td className={RESOURCE_TD}>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        f.severity === "error"
                          ? "bg-rose-50 text-rose-700"
                          : f.severity === "warn"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-[#eef1f4] text-[#5f6b7c]",
                      )}
                    >
                      {f.severity}
                    </span>
                  </td>
                  <td className={cn(RESOURCE_TD, "font-mono text-[11px]")}>{f.code}</td>
                  <td className={cn(RESOURCE_TD, "max-w-sm truncate")}>{f.message}</td>
                  <td className={RESOURCE_TD}>{f.layer}</td>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")}>
                    {new Date(f.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {healthFlags.length === 0 ? (
                <tr>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")} colSpan={5}>
                    No open health issues. Run a quality scan from Data Quality to check.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageShell>
    );
  }

  if (view === "history") {
    return (
      <PageShell title="History" count={recentObjects.length}>
        <p className="mb-2 text-[11px] text-[#8f99a8]">
          Most recently created instances in this environment.
        </p>
        <div className="overflow-hidden rounded-md border border-[#d3d8de] bg-white">
          <table className={RESOURCE_TABLE}>
            <thead>
              <tr>
                <th className={RESOURCE_TH}>Label</th>
                <th className={RESOURCE_TH}>Type</th>
                <th className={RESOURCE_TH}>Created</th>
                <th className={RESOURCE_TH}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {recentObjects.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => onOpenInstance(o.id)}
                  className="cursor-pointer text-[#404854] hover:bg-[#f6f7f9]"
                >
                  <td className={cn(RESOURCE_TD, "font-medium text-[#1c2127]")}>
                    {instanceLabel(o)}
                  </td>
                  <td className={RESOURCE_TD}>{o.typeName}</td>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")}>
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")}>
                    {new Date(o.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {recentObjects.length === 0 ? (
                <tr>
                  <td className={cn(RESOURCE_TD, "text-[#8f99a8]")} colSpan={4}>
                    No activity yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageShell>
    );
  }

  if (view === "cleanup") {
    const stats = summary?.types ?? [];
    const empty = stats.filter((s) => s.instanceCount === 0);
    const undocumented = stats.filter((s) => !s.description);
    return (
      <PageShell title="Cleanup">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-[#d3d8de] bg-white p-3">
            <p className="mb-1 text-xs font-semibold text-[#1c2127]">
              Object types without instances ({empty.length})
            </p>
            {empty.length === 0 ? (
              <p className="text-[11px] text-[#8f99a8]">None — every type has data.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {empty.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onOpenType(s.name)}
                    className="rounded border border-[#d3d8de] px-1.5 py-0.5 text-[10px] text-[#404854] hover:border-[#2d72d2]"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-md border border-[#d3d8de] bg-white p-3">
            <p className="mb-1 text-xs font-semibold text-[#1c2127]">
              Object types missing a description ({undocumented.length})
            </p>
            {undocumented.length === 0 ? (
              <p className="text-[11px] text-[#8f99a8]">None — everything is documented.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {undocumented.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onOpenType(s.name)}
                    className="rounded border border-[#d3d8de] px-1.5 py-0.5 text-[10px] text-[#404854] hover:border-[#2d72d2]"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageShell>
    );
  }

  if (view === "config") {
    return (
      <PageShell title="Ontology configuration">
        <div className="flex max-w-md flex-col gap-4">
          {envInfo ? (
            <div className="rounded-md border border-[#d3d8de] bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-[#1c2127]">Current environment</p>
              <table className="w-full text-xs text-[#404854]">
                <tbody>
                  <tr>
                    <td className="py-0.5 text-[#8f99a8]">Name</td>
                    <td className="py-0.5 text-right font-medium">{envInfo.name}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 text-[#8f99a8]">Slug</td>
                    <td className="py-0.5 text-right font-mono text-[11px]">{envInfo.slug}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 text-[#8f99a8]">Type</td>
                    <td className="py-0.5 text-right">{envInfo.type}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 text-[#8f99a8]">Organization</td>
                    <td className="py-0.5 text-right">{envInfo.organizationName}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="rounded-md border border-[#d3d8de] bg-white p-3">
            <p className="mb-1 text-xs font-semibold text-[#1c2127]">
              Import from another environment
            </p>
            <p className="mb-2 text-[10.5px] leading-relaxed text-[#8f99a8]">
              Copies types, instances, and links into this environment — use it to
              consolidate domain-split environments into one world environment. The source
              is left untouched.
            </p>
            <div className="flex items-center gap-2">
              <select
                value={importFrom}
                onChange={(e) => setImportFrom(e.target.value)}
                className="min-w-0 flex-1 rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1.5 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none"
              >
                <option value="">choose a source environment…</option>
                {environments
                  .filter((e) => e.slug !== env)
                  .map((e) => (
                    <option key={e.id} value={e.slug}>
                      {e.name} ({e.organizationName})
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!importFrom || importing}
                onClick={() => void handleImport()}
                className="shrink-0 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
            {importResult ? (
              <p className="mt-2 text-[11px] text-emerald-700">{importResult}</p>
            ) : null}
          </div>
          <div className="rounded-md border border-[#d3d8de] bg-white">
            <EnvironmentCreator onCreated={onEnvCreated} onError={onError} />
          </div>
        </div>
      </PageShell>
    );
  }

  if (view === "proposals") {
    return (
      <PlaceholderPage
        title="Proposals"
        icon={GitPullRequest}
        body={`Schema change proposals will be reviewable here before they apply to ${env ?? "the environment"} — propose, discuss, and merge object type and link type changes with an approval trail.`}
      />
    );
  }
  if (view === "actionTypes") {
    return (
      <PlaceholderPage
        title="Action types"
        icon={Zap}
        body="Reusable actions over the ontology — extract, normalize, translate, and simulation triggers — will be catalogued here. Today these run from Studio pipelines."
      />
    );
  }
  if (view === "valueSets") {
    return (
      <PlaceholderPage
        title="Value sets"
        icon={Braces}
        body="SNOMED-bound value sets — e.g. restrict a property to descendants of a clinical finding — will be managed here, enforced by the transitive-closure hierarchy."
      />
    );
  }
  return (
    <PlaceholderPage
      title="Functions"
      icon={Sigma}
      body="Derived metrics and data-quality functions over ontology instances will live here. Today, rules run from the Data Quality workspace."
    />
  );
}

// ---------------------------------------------------------------------------
// Environment creator
// ---------------------------------------------------------------------------

function EnvironmentCreator({
  onCreated,
  onError,
}: {
  onCreated: (slug: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<EnvironmentType>("entity");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const env = await createEnvironment({ name: name.trim(), type });
      setName("");
      await onCreated(env.slug);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-gray-100 p-3">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
        New environment
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="e.g. Site A Clinical"
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EnvironmentType)}
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
        >
          <option value="reference">Reference</option>
          <option value="entity">Entity</option>
          <option value="operations">Operations</option>
        </select>
        <p className="text-[10px] leading-relaxed text-gray-400">{ENV_TYPE_HELP[type]}</p>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="w-full rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Add environment
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property rows editor (shared by create/edit object type)
// ---------------------------------------------------------------------------

function PropertyRowsEditor({
  rows,
  onChange,
}: {
  rows: PropertyDefinition[];
  onChange: (rows: PropertyDefinition[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            value={row.key}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, key: e.target.value };
              onChange(next);
            }}
            placeholder="key"
            className="min-w-0 flex-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[11px] text-gray-800 focus:border-gray-400 focus:outline-none"
          />
          <select
            value={row.type}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, type: e.target.value as PropertyType };
              onChange(next);
            }}
            className="rounded border border-gray-200 bg-gray-50 px-1 py-1 text-[11px] text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="rounded px-1 text-gray-400 hover:text-rose-600"
            aria-label="Remove property"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", type: "string" }])}
        className="self-start rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-gray-400"
      >
        + Property
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Object-type editor panel (create + edit)
// ---------------------------------------------------------------------------

function TypeEditorPanel({
  mode,
  initial,
  onClose,
  onSubmit,
  onDelete,
  onError,
}: {
  mode: "create" | "edit";
  initial?: EnvObjectType;
  onClose: () => void;
  onSubmit: (
    name: string,
    description: string,
    schema: PropertyDefinition[],
    nature: ObjectNature | null,
  ) => Promise<void>;
  onDelete?: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [nature, setNature] = useState<ObjectNature | "">(initial?.nature ?? "");
  const [rows, setRows] = useState<PropertyDefinition[]>(
    (initial?.propertySchema as PropertyDefinition[]) ?? [],
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (mode === "create" && !name.trim()) {
      onError("Object type name is required.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(
        name.trim(),
        description.trim(),
        rows.filter((r) => r.key.trim()).map((r) => ({ ...r, key: r.key.trim() })),
        nature === "" ? null : nature,
      );
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader
        title={mode === "create" ? "New object type" : `Edit ${initial?.name}`}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto p-4">
        <Labelled label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={mode === "edit"}
            placeholder="e.g. Specimen"
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none disabled:text-gray-400"
          />
        </Labelled>
        <Labelled label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          />
        </Labelled>
        <Labelled label="Nature">
          <select
            value={nature}
            onChange={(e) => setNature(e.target.value as ObjectNature | "")}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            <option value="">Unspecified</option>
            <option value="physical">Physical — real-world extent, twin anchor (lat/lng)</option>
            <option value="conceptual">Conceptual — grouping/classifier, no footprint</option>
          </select>
        </Labelled>
        <Labelled label="Properties">
          <PropertyRowsEditor rows={rows} onChange={setRows} />
        </Labelled>
      </div>
      <div className="flex items-center gap-2 border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          {mode === "create" ? "Create type" : "Save changes"}
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await onDelete();
              } catch (err) {
                onError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 hover:bg-rose-100"
          >
            Delete
          </button>
        ) : null}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Link-type editor panel
// ---------------------------------------------------------------------------

function LinkTypeEditorPanel({
  types,
  initialFrom,
  initialTo,
  onClose,
  onSubmit,
  onError,
}: {
  types: EnvObjectType[];
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
  onSubmit: (
    name: string,
    fromType: string,
    toType: string,
    cardinality: LinkCardinality,
  ) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [fromType, setFromType] = useState(initialFrom ?? types[0]?.name ?? "");
  const [toType, setToType] = useState(initialTo ?? types[0]?.name ?? "");
  const [cardinality, setCardinality] = useState<LinkCardinality>("many_to_many");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialFrom) setFromType(initialFrom);
    if (initialTo) setToType(initialTo);
  }, [initialFrom, initialTo]);

  async function save() {
    if (busy) return;
    if (!name.trim() || !fromType || !toType) {
      onError("Name, from, and to are required.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name.trim(), fromType, toType, cardinality);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader title="New relationship" onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <Labelled label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. collected_from"
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          />
        </Labelled>
        <Labelled label="From type">
          <select
            value={fromType}
            onChange={(e) => setFromType(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {types.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="To type">
          <select
            value={toType}
            onChange={(e) => setToType(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {types.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Cardinality">
          <select
            value={cardinality}
            onChange={(e) => setCardinality(e.target.value as LinkCardinality)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {CARDINALITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Create relationship
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Instance create panel (form derived from property schema)
// ---------------------------------------------------------------------------

function coerceValue(type: PropertyType, raw: string): unknown {
  if (raw === "") return type === "string" ? "" : null;
  if (type === "number") return Number(raw);
  if (type === "boolean") return raw === "true";
  if (type === "object" || type === "array") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function InstanceEditorPanel({
  typeDef,
  initial,
  onClose,
  onSubmit,
  onError,
}: {
  typeDef: EnvObjectType;
  initial?: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (properties: Record<string, unknown>) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const p of typeDef.propertySchema) {
      const cur = initial?.[p.key];
      v[p.key] =
        cur == null
          ? ""
          : typeof cur === "object"
            ? JSON.stringify(cur)
            : String(cur);
    }
    return v;
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const properties: Record<string, unknown> = {};
      for (const p of typeDef.propertySchema) {
        properties[p.key] = coerceValue(p.type as PropertyType, values[p.key] ?? "");
      }
      await onSubmit(properties);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader
        title={initial ? `Edit ${typeDef.name}` : `New ${typeDef.name}`}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto p-4">
        {typeDef.propertySchema.length === 0 ? (
          <p className="text-[11px] text-gray-400">
            This type has no properties. Add some in the type editor first.
          </p>
        ) : (
          typeDef.propertySchema.map((p) => (
            <Labelled key={p.key} label={`${p.label ?? p.key} · ${p.type}`}>
              {p.type === "boolean" ? (
                <select
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                  className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
                >
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={p.type === "number" ? "number" : "text"}
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                  placeholder={p.type === "object" || p.type === "array" ? "JSON" : ""}
                  className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
                />
              )}
            </Labelled>
          ))
        )}
      </div>
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          {initial ? "Save changes" : "Create instance"}
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Instance detail panel (view/edit properties, links, delete)
// ---------------------------------------------------------------------------

function InstanceDetailPanel({
  env,
  detail,
  types,
  linkTypes,
  onClose,
  onChanged,
  onDeleted,
  onError,
}: {
  env: string;
  detail: { object: EnvInstance; links: EnvLinkEdge[] };
  types: EnvObjectType[];
  linkTypes: EnvLinkType[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const { object, links } = detail;
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const typeDef = types.find((t) => t.name === object.typeName) ?? null;

  if (editing && typeDef) {
    return (
      <InstanceEditorPanel
        typeDef={typeDef}
        initial={object.properties}
        onClose={() => setEditing(false)}
        onSubmit={async (properties) => {
          await updateEnvObject(env, object.id, { properties });
          setEditing(false);
          await onChanged();
        }}
        onError={onError}
      />
    );
  }

  if (linking) {
    return (
      <LinkInstancePanel
        env={env}
        fromInstance={object}
        linkTypes={linkTypes}
        onClose={() => setLinking(false)}
        onLinked={async () => {
          setLinking(false);
          await onChanged();
        }}
        onError={onError}
      />
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader title={instanceLabel(object)} onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <SectionLabel>Properties</SectionLabel>
        <dl className="mb-4 space-y-1">
          {Object.entries(object.properties).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 text-[11px]">
              <dt className="text-gray-400">{k}</dt>
              <dd className="max-w-[60%] truncate text-right font-medium text-gray-700">
                {v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mb-4 flex items-center justify-between">
          <SectionLabel>Linked objects</SectionLabel>
          <button
            type="button"
            onClick={() => setLinking(true)}
            disabled={linkTypes.length === 0}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-gray-400 disabled:text-gray-300"
          >
            + Link
          </button>
        </div>
        {links.length === 0 ? (
          <p className="text-[11px] text-gray-400">No links.</p>
        ) : (
          <ul className="space-y-1.5">
            {links.map((l) => (
              <li
                key={l.id}
                className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">
                    {(l.otherProperties.span as string) ||
                      (l.otherProperties.label as string) ||
                      l.otherType}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await deleteEnvLink(env, l.id);
                        await onChanged();
                      } catch (err) {
                        onError((err as Error).message);
                      }
                    }}
                    className="text-[10px] text-gray-400 hover:text-rose-600"
                  >
                    unlink
                  </button>
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                  {l.direction === "out" ? "→" : "←"} {l.linkType} · {l.otherType}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={!typeDef}
          className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await deleteEnvObject(env, object.id);
              await onDeleted();
            } catch (err) {
              onError((err as Error).message);
            }
          }}
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 hover:bg-rose-100"
        >
          Delete
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Link instance panel (connect this instance to another)
// ---------------------------------------------------------------------------

function LinkInstancePanel({
  env,
  fromInstance,
  linkTypes,
  onClose,
  onLinked,
  onError,
}: {
  env: string;
  fromInstance: EnvInstance;
  linkTypes: EnvLinkType[];
  onClose: () => void;
  onLinked: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [linkType, setLinkType] = useState(linkTypes[0]?.name ?? "");
  const [candidates, setCandidates] = useState<EnvInstance[]>([]);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedLinkType = linkTypes.find((lt) => lt.name === linkType) ?? null;

  useEffect(() => {
    if (!selectedLinkType) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    void listEnvObjects(env, { type: selectedLinkType.toType, limit: 100 })
      .then(({ objects }) => {
        if (!cancelled) setCandidates(objects.filter((o) => o.id !== fromInstance.id));
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [env, selectedLinkType, fromInstance.id]);

  async function save() {
    if (busy || !linkType || !targetId) {
      if (!targetId) onError("Pick a target instance.");
      return;
    }
    setBusy(true);
    try {
      await createEnvLink(env, { linkType, fromId: fromInstance.id, toId: targetId });
      await onLinked();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader title="Create link" onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <Labelled label="Relationship">
          <select
            value={linkType}
            onChange={(e) => {
              setLinkType(e.target.value);
              setTargetId("");
            }}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {linkTypes.map((lt) => (
              <option key={lt.id} value={lt.name}>
                {lt.name} ({lt.fromType} → {lt.toType})
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Target instance">
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            <option value="">Select…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {instanceLabel(c)}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Create link
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Small shared UI
// ---------------------------------------------------------------------------

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <span className="truncate text-sm font-medium text-gray-800">{title}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
      {children}
    </span>
  );
}
