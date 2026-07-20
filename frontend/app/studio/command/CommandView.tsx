"use client";

/**
 * Twin Command view — command-center layout for the live digital twin:
 * command strip, KPI strip, ontology tree rail, graph/grid canvas,
 * unit inspector, and a bottom alert-timeline ribbon. Modeled on
 * design/twin-command-view.html, adapted to the light Studio theme.
 * All data comes from the real twin endpoints (tree + SSE stream,
 * unit detail, open alerts).
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Search } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  ackTwinAlert,
  fetchTwinTree,
  fetchTwinUnit,
  listTwinAlerts,
  seedTwinDemo,
  subscribeTwinStream,
  type TwinAlert,
  type TwinTreeSnapshot,
  type TwinUnitDetail,
  type TwinUnitNode,
} from "@/lib/platform-api";

import {
  LiveDot,
  SEV_HEX,
  severityHex,
  timeAgo,
  useElementWidth,
} from "../command-ui";
import { useStudio } from "../StudioShell";
import {
  loadTwinPreferences,
  saveTwinPreferences,
} from "../twin-preferences";
import {
  DISPLAY_METRIC_OPTIONS,
  formatFreshness,
  formatTwinMetric,
} from "../twin-ui";
import {
  Chip,
  GaugeArc,
  KpiCell,
  MicroLabel,
  ModeToggle,
  PanelHead,
  occFillColor,
} from "./command-blueprint";
import CommandTree from "./CommandTree";
import CommandTreemap from "./CommandTreemap";
import { kindIcon } from "./twin-hierarchy";

const HIST_CAP = 40;

function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = kindIcon(kind);
  return <Icon className={className} />;
}

export default function CommandView() {
  const { hasKey, selectedEnv, environments, bumpOntology } = useStudio();
  const env = selectedEnv;

  const envMeta = useMemo(
    () => environments.find((e) => e.slug === env),
    [environments, env],
  );
  const isOperations = envMeta?.type === "operations";

  const [snapshot, setSnapshot] = useState<TwinTreeSnapshot | null>(null);
  const [streamMode, setStreamMode] = useState<"stream" | "poll" | "idle">(
    "idle",
  );
  const [alerts, setAlerts] = useState<TwinAlert[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitDetail, setUnitDetail] = useState<TwinUnitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [displayMetric, setDisplayMetric] = useState("occupancyPct");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"treemap" | "tree" | "grid">("treemap");

  // Avg-occupancy KPI history (client ring buffer).
  const [avgHist, setAvgHist] = useState<number[]>([]);
  const lastComputedAt = useRef<string | null>(null);

  useEffect(() => {
    if (!env) return;
    const prefs = loadTwinPreferences(env);
    setDisplayMetric(prefs.displayMetric);
    setKindFilter(prefs.kindFilter);
    setAvgHist([]);
    setSelectedUnitId(null);
    lastComputedAt.current = null;
  }, [env]);

  const applySnapshot = useCallback(
    (snap: TwinTreeSnapshot) => {
      setSnapshot(snap);
      if (!env) return;
      if (lastComputedAt.current !== snap.computedAt) {
        lastComputedAt.current = snap.computedAt;
        const occNodes = snap.nodes.filter(
          (n) => n.metrics.occupancyPct != null,
        );
        if (occNodes.length) {
          const avg =
            occNodes.reduce((s, n) => s + (n.metrics.occupancyPct ?? 0), 0) /
            occNodes.length;
          setAvgHist((cur) => [...cur, avg].slice(-HIST_CAP));
        }
      }
    },
    [env],
  );

  const refreshAlerts = useCallback(async () => {
    if (!env) return;
    try {
      const { alerts: list } = await listTwinAlerts(env, { limit: 100 });
      setAlerts(list);
    } catch {
      /* keep last */
    }
  }, [env]);

  // Twin stream with poll fallback.
  useEffect(() => {
    if (!env || !hasKey || !isOperations) {
      setSnapshot(null);
      setStreamMode("idle");
      setAlerts([]);
      return;
    }
    let pollId: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    void fetchTwinTree(env)
      .then((snap) => {
        if (!stopped) applySnapshot(snap);
      })
      .catch((err) => {
        if (!stopped) setError((err as Error).message);
      });

    const startPoll = () => {
      if (pollId) return;
      setStreamMode("poll");
      pollId = setInterval(() => {
        void fetchTwinTree(env)
          .then((snap) => {
            if (!stopped) applySnapshot(snap);
          })
          .catch(() => {
            /* keep last */
          });
      }, 5000);
    };

    setStreamMode("stream");
    const stop = subscribeTwinStream(
      env,
      (snap) => {
        if (!stopped) applySnapshot(snap);
      },
      startPoll,
    );

    return () => {
      stopped = true;
      stop();
      if (pollId) clearInterval(pollId);
    };
  }, [env, hasKey, isOperations, applySnapshot]);

  // Alerts poll (10s).
  useEffect(() => {
    if (!env || !hasKey || !isOperations) return;
    void refreshAlerts();
    const id = setInterval(() => void refreshAlerts(), 10000);
    return () => clearInterval(id);
  }, [env, hasKey, isOperations, refreshAlerts]);

  // Unit detail on selection / snapshot change.
  useEffect(() => {
    if (!env || !selectedUnitId || !isOperations) {
      setUnitDetail(null);
      return;
    }
    setDetailLoading(true);
    void fetchTwinUnit(env, selectedUnitId)
      .then(setUnitDetail)
      .catch((err) => setError((err as Error).message))
      .finally(() => setDetailLoading(false));
  }, [env, selectedUnitId, isOperations, snapshot?.computedAt]);

  const handleMetricChange = (key: string) => {
    setDisplayMetric(key);
    if (env) saveTwinPreferences(env, { displayMetric: key, kindFilter });
  };

  const handleKindFilterChange = (value: string | null) => {
    setKindFilter(value);
    if (env) saveTwinPreferences(env, { displayMetric, kindFilter: value });
  };

  async function handleSeedDemo() {
    if (!env) return;
    setSeeding(true);
    setError(null);
    try {
      await seedTwinDemo(env);
      bumpOntology();
      applySnapshot(await fetchTwinTree(env));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  }

  async function handleAck(alertId: string) {
    if (!env) return;
    try {
      await ackTwinAlert(env, alertId);
      if (selectedUnitId) {
        setUnitDetail(await fetchTwinUnit(env, selectedUnitId));
      }
      applySnapshot(await fetchTwinTree(env));
      await refreshAlerts();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // ---------------- KPI derivations (roots only — avoids double counting) ---
  const kpis = useMemo(() => {
    if (!snapshot) return null;
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
    const roots = snapshot.roots
      .map((id) => byId.get(id))
      .filter((n): n is TwinUnitNode => Boolean(n));
    const occNodes = snapshot.nodes.filter(
      (n) => n.metrics.occupancyPct != null,
    );
    const avgOcc = occNodes.length
      ? occNodes.reduce((s, n) => s + (n.metrics.occupancyPct ?? 0), 0) /
        occNodes.length
      : null;
    const critAlerts = alerts.filter((a) => a.severity === "critical").length;
    const warnAlerts = alerts.filter((a) => a.severity === "warn").length;
    const critUnits = snapshot.nodes.filter(
      (n) => n.worstAlertSeverity === "critical",
    ).length;
    const beds = roots.reduce(
      (s, n) => s + (n.metrics.instanceCountByType["Bed"] ?? 0),
      0,
    );
    const patients = roots.reduce(
      (s, n) => s + (n.metrics.instanceCountByType["Patient"] ?? 0),
      0,
    );
    const freshVals = snapshot.nodes
      .map((n) => n.metrics.freshnessSeconds)
      .filter((v): v is number => v != null);
    const worstFresh = freshVals.length ? Math.max(...freshVals) : null;
    const linked = roots.reduce(
      (s, n) => s + n.metrics.linkedInstanceCount,
      0,
    );
    return {
      avgOcc,
      openAlerts: alerts.length,
      critAlerts,
      warnAlerts,
      critUnits,
      bedsFree: Math.max(0, beds - patients),
      beds,
      worstFresh,
      linked,
      unitCount: snapshot.nodes.length,
      occCount: occNodes.length,
    };
  }, [snapshot, alerts]);

  const kinds = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(new Set(snapshot.nodes.map((n) => n.kind)));
  }, [snapshot]);

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-[#5f6b7c]">
          Sign in and create an API key to view the live digital twin.
        </p>
      </div>
    );
  }
  if (!env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-[#5f6b7c]">
          Select an environment in the header.
        </p>
      </div>
    );
  }
  if (!isOperations) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white p-6">
        <Card className="max-w-md p-6 text-center">
          <p className="text-sm text-[#5f6b7c]">
            Twin Command requires an <strong>operations</strong> environment.
            Switch env type in Ontology Manager, or seed a demo skeleton here.
          </p>
          <Button
            className="mt-4"
            onClick={() => void handleSeedDemo()}
            disabled={seeding}
          >
            {seeding ? "Seeding…" : "Seed CHUM demo"}
          </Button>
          {error ? (
            <p className="mt-2 text-xs text-rose-600">{error}</p>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* ---- Command strip ---- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d3d8de] bg-[#f6f7f9]/60 px-3 py-1.5">
        <Chip>
          ENV <b className="font-semibold text-[#1c2127]">{env}</b> ·{" "}
          {envMeta?.type}
        </Chip>
        <Chip>
          <LiveDot mode={streamMode === "idle" ? "idle" : streamMode} />
          {streamMode === "stream"
            ? "STREAM"
            : streamMode === "poll"
              ? "POLLING"
              : "…"}
        </Chip>
        <span className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8f99a8]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search units…"
            className="w-56 rounded border border-[#d3d8de] bg-white py-1 pl-7 pr-2 text-xs text-[#1c2127] placeholder:text-[#8f99a8] focus:border-[#2d72d2] focus:outline-none"
          />
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded border border-[#d3d8de] bg-white">
            <span className="bg-[#e7f2fd] px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-[#215db0]">
              Live
            </span>
            <Link
              href="/studio/lab"
              className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-[#5f6b7c] hover:text-[#1c2127]"
            >
              Model Lab
            </Link>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleSeedDemo()}
            disabled={seeding}
          >
            {seeding ? "Seeding…" : "Seed demo"}
          </Button>
          <span className="text-[10px] text-[#8f99a8]">
            {snapshot
              ? `computed ${new Date(snapshot.computedAt).toLocaleTimeString("en-CA", { hour12: false })}`
              : ""}
          </span>
        </div>
      </div>

      {error ? (
        <p className="mx-3 mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      {/* ---- KPI strip ---- */}
      {kpis ? (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[#d3d8de] bg-[#f6f7f9] px-3 py-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCell
            label="Avg occupancy"
            value={kpis.avgOcc != null ? `${Math.round(kpis.avgOcc)}%` : "—"}
            sub={`across ${kpis.occCount} units`}
            tone={
              kpis.avgOcc != null && kpis.avgOcc > 90
                ? "crit"
                : kpis.avgOcc != null && kpis.avgOcc > 80
                  ? "warn"
                  : "default"
            }
            spark={avgHist}
          />
          <KpiCell
            label="Open alerts"
            value={String(kpis.openAlerts)}
            sub={`${kpis.critAlerts} critical · ${kpis.warnAlerts} warn`}
            tone={
              kpis.critAlerts > 0
                ? "crit"
                : kpis.openAlerts > 0
                  ? "warn"
                  : "default"
            }
          />
          <KpiCell
            label="Critical units"
            value={String(kpis.critUnits)}
            sub={`of ${kpis.unitCount} org units`}
            tone={kpis.critUnits > 0 ? "crit" : "default"}
          />
          <KpiCell
            label="Beds available"
            value={String(kpis.bedsFree)}
            sub={`of ${kpis.beds} beds`}
          />
          <KpiCell
            label="Data freshness"
            value={
              kpis.worstFresh != null
                ? formatFreshness(kpis.worstFresh).replace(" ago", "")
                : "—"
            }
            sub="worst unit lag"
            tone={
              kpis.worstFresh != null && kpis.worstFresh > 3600
                ? "warn"
                : "default"
            }
          />
          <KpiCell
            label="Linked instances"
            value={String(kpis.linked)}
            sub="patients · beds · findings"
          />
        </div>
      ) : null}

      {/* ---- Main 3-column zone ---- */}
      <div className="flex min-h-0 flex-1">
        {/* Left: ontology tree */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-[#d3d8de] bg-white">
          <PanelHead
            title="Ontology · OrgUnits"
            right={
              <MicroLabel>{snapshot?.nodes.length ?? 0} units</MicroLabel>
            }
          />
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-[#e5e8eb] px-2 py-1.5">
            <KindChip
              label="All"
              active={kindFilter == null}
              onClick={() => handleKindFilterChange(null)}
            />
            {kinds.map((k) => (
              <KindChip
                key={k}
                label={k}
                active={kindFilter === k}
                onClick={() => handleKindFilterChange(k)}
              />
            ))}
          </div>
          <TreeRail
            snapshot={snapshot}
            kindFilter={kindFilter}
            search={search}
            selectedUnitId={selectedUnitId}
            onSelect={setSelectedUnitId}
          />
        </aside>

        {/* Center: treemap / tree / grid */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f6f7f9]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[#d3d8de] bg-white px-3 py-2">
            <ModeToggle
              value={view}
              options={
                [
                  { value: "treemap", label: "Treemap" },
                  { value: "tree", label: "Tree" },
                  { value: "grid", label: "Grid" },
                ] as const
              }
              onChange={setView}
            />
            <select
              value={displayMetric}
              onChange={(e) => handleMetricChange(e.target.value)}
              className="ml-auto rounded border border-[#d3d8de] bg-white px-2 py-1 text-[11px] text-[#5f6b7c] focus:border-[#2d72d2] focus:outline-none"
            >
              {DISPLAY_METRIC_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {view === "treemap" ? (
            <CommandTreemap
              snapshot={snapshot}
              selectedUnitId={selectedUnitId}
              displayMetric={displayMetric}
              kindFilter={kindFilter}
              search={search}
              onSelectUnit={setSelectedUnitId}
            />
          ) : view === "tree" ? (
            <CommandTree
              snapshot={snapshot}
              selectedUnitId={selectedUnitId}
              displayMetric={displayMetric}
              kindFilter={kindFilter}
              search={search}
              onSelectUnit={setSelectedUnitId}
            />
          ) : (
            <GridTable
              snapshot={snapshot}
              kindFilter={kindFilter}
              search={search}
              selectedUnitId={selectedUnitId}
              onSelect={setSelectedUnitId}
            />
          )}
        </main>

        {/* Right: inspector */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-[#d3d8de] bg-white">
          {selectedUnitId ? (
            <InspectorPanel
              unitId={selectedUnitId}
              node={snapshot?.nodes.find((n) => n.id === selectedUnitId)}
              detail={unitDetail}
              loading={detailLoading}
              onAck={(id) => void handleAck(id)}
              onClose={() => setSelectedUnitId(null)}
            />
          ) : (
            <p className="px-6 py-12 text-center text-xs leading-relaxed text-[#8f99a8]">
              Select a unit on the treemap,
              <br />
              tree, or grid to inspect
              <br />
              metrics · alerts · recommendations
            </p>
          )}
        </aside>
      </div>

      {/* ---- Bottom ribbon: alert timeline ---- */}
      <AlertRibbon alerts={alerts} snapshot={snapshot} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function KindChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
        active
          ? "border-[#b5d4f4] bg-[#e7f2fd] text-[#215db0]"
          : "border-[#d3d8de] text-[#5f6b7c] hover:text-[#1c2127]",
      )}
    >
      {label}
    </button>
  );
}

function TreeRail({
  snapshot,
  kindFilter,
  search,
  selectedUnitId,
  onSelect,
}: {
  snapshot: TwinTreeSnapshot | null;
  kindFilter: string | null;
  search: string;
  selectedUnitId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = useMemo(() => {
    if (!snapshot) return [];
    const children = new Map<string, string[]>();
    for (const n of snapshot.nodes) children.set(n.id, []);
    for (const e of snapshot.edges) children.get(e.fromId)?.push(e.toId);
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
    const out: { node: TwinUnitNode; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      const node = byId.get(id);
      if (!node) return;
      out.push({ node, depth });
      for (const c of children.get(id) ?? []) walk(c, depth + 1);
    };
    for (const r of snapshot.roots) walk(r, 0);
    // Orphans (defensive): nodes not reachable from roots.
    const seen = new Set(out.map((r) => r.node.id));
    for (const n of snapshot.nodes) {
      if (!seen.has(n.id)) out.push({ node: n, depth: 0 });
    }
    return out;
  }, [snapshot]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(({ node }) => {
    if (kindFilter && node.kind !== kindFilter) return false;
    if (q && !node.name.toLowerCase().includes(q)) return false;
    return true;
  });

  if (!snapshot) {
    return <p className="px-3 py-4 text-[11px] text-[#8f99a8]">Loading…</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      {visible.map(({ node, depth }) => {
        const occ = node.metrics.occupancyPct;
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node.id)}
            className={cn(
              "mx-1.5 flex items-center gap-2 rounded py-1.5 pr-2 text-left transition-colors",
              selectedUnitId === node.id
                ? "bg-[#e7f2fd]"
                : "hover:bg-[#f6f7f9]",
            )}
            style={{ paddingLeft: 8 + depth * 12, width: "calc(100% - 12px)" }}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: severityHex(node.worstAlertSeverity) }}
            />
            <KindIcon kind={node.kind} className="h-3.5 w-3.5 shrink-0 text-[#8f99a8]" />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                selectedUnitId === node.id
                  ? "font-medium text-[#215db0]"
                  : "text-[#1c2127]",
              )}
            >
              {node.name}
            </span>
            <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-[#8f99a8]">
              {node.kind.slice(0, 4)}
            </span>
            {occ != null ? (
              <span className="relative h-1.5 w-9 shrink-0 rounded bg-[#e5e8eb]">
                <span
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${Math.min(100, Math.max(0, occ))}%`,
                    background: occFillColor(occ),
                  }}
                />
              </span>
            ) : null}
          </button>
        );
      })}
      {visible.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-[#8f99a8]">No matching units.</p>
      ) : null}
    </div>
  );
}

function GridTable({
  snapshot,
  kindFilter,
  search,
  selectedUnitId,
  onSelect,
}: {
  snapshot: TwinTreeSnapshot | null;
  kindFilter: string | null;
  search: string;
  selectedUnitId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<"occ" | "name" | "linked" | "alerts">(
    "occ",
  );
  if (!snapshot) {
    return <p className="px-4 py-12 text-xs text-[#8f99a8]">Loading…</p>;
  }
  const q = search.trim().toLowerCase();
  const rows = snapshot.nodes
    .filter((n) => !kindFilter || n.kind === kindFilter)
    .filter((n) => !q || n.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "linked")
        return b.metrics.linkedInstanceCount - a.metrics.linkedInstanceCount;
      if (sortKey === "alerts") return b.openAlertCount - a.openAlertCount;
      return (b.metrics.occupancyPct ?? -1) - (a.metrics.occupancyPct ?? -1);
    });

  const th = (label: string, key?: typeof sortKey) => (
    <th
      className={cn(
        "sticky top-0 border-b border-[#d3d8de] bg-white px-2.5 py-2 text-left text-[9px] font-medium uppercase tracking-wide text-[#8f99a8]",
        key && "cursor-pointer hover:text-[#5f6b7c]",
      )}
      onClick={key ? () => setSortKey(key) : undefined}
    >
      {label}
      {key && sortKey === key ? " ↓" : ""}
    </th>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-12">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {th("")}
            {th("Unit", "name")}
            {th("Kind")}
            {th("Occupancy", "occ")}
            {th("Patients")}
            {th("Beds")}
            {th("Linked", "linked")}
            {th("Freshness")}
            {th("Alerts", "alerts")}
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => {
            const occ = n.metrics.occupancyPct;
            return (
              <tr
                key={n.id}
                onClick={() => onSelect(n.id)}
                className={cn(
                  "cursor-pointer border-b border-[#e5e8eb]",
                  selectedUnitId === n.id
                    ? "bg-[#e7f2fd]"
                    : "hover:bg-[#f6f7f9]",
                )}
              >
                <td className="px-2.5 py-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: severityHex(n.worstAlertSeverity) }}
                  />
                </td>
                <td className="px-2.5 py-1.5 text-[#1c2127]">{n.name}</td>
                <td className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-[#8f99a8]">
                  {n.kind}
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-[#5f6b7c]">
                  {occ != null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="relative inline-block h-1.5 w-14 rounded bg-[#e5e8eb] align-middle">
                        <span
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${Math.min(100, Math.max(0, occ))}%`,
                            background: occFillColor(occ),
                          }}
                        />
                      </span>
                      {Math.round(occ)}%
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-[#5f6b7c]">
                  {formatTwinMetric(n.metrics, "count:Patient")}
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-[#5f6b7c]">
                  {formatTwinMetric(n.metrics, "count:Bed")}
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-[#5f6b7c]">
                  {n.metrics.linkedInstanceCount}
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-[#5f6b7c]">
                  {formatTwinMetric(n.metrics, "freshnessSeconds")}
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-[#5f6b7c]">
                  {n.openAlertCount || ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InspectorPanel({
  unitId,
  node,
  detail,
  loading,
  onAck,
  onClose,
}: {
  unitId: string;
  node: TwinUnitNode | undefined;
  detail: TwinUnitDetail | null;
  loading: boolean;
  onAck: (alertId: string) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="border-b border-[#d3d8de] px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#e7f2fd] text-[#215db0]">
              <KindIcon kind={node?.kind ?? "org"} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#1c2127]">
                {node?.name ?? "Unit"}
              </p>
              <p className="mt-0.5 text-[10px] text-[#8f99a8]">
                <span className="font-mono">{unitId.slice(0, 8)}…</span>
                {node?.kind ? ` · ${node.kind}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[#d3d8de] px-2 py-0.5 text-[9px] font-medium uppercase text-[#5f6b7c] hover:bg-[#f6f7f9]"
          >
            ✕
          </button>
        </div>
        {loading || !detail ? (
          <p className="mt-3 text-[11px] text-[#8f99a8]">Loading…</p>
        ) : (
          <div className="mt-2 flex items-center gap-3">
            <GaugeArc pct={detail.metrics.occupancyPct} />
            <div className="grid flex-1 grid-cols-2 gap-2">
              <div className="rounded border border-[#d3d8de] bg-[#f6f7f9]/60 px-2 py-1.5">
                <MicroLabel>Linked</MicroLabel>
                <p className="text-sm font-semibold text-[#1c2127]">
                  {detail.metrics.linkedInstanceCount}
                </p>
              </div>
              <div className="rounded border border-[#d3d8de] bg-[#f6f7f9]/60 px-2 py-1.5">
                <MicroLabel>Freshness</MicroLabel>
                <p className="text-sm font-semibold text-[#1c2127]">
                  {formatFreshness(detail.metrics.freshnessSeconds).replace(
                    " ago",
                    "",
                  )}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {detail ? (
        <>
          {Object.keys(detail.metrics.instanceCountByType).length > 0 ? (
            <div className="border-b border-[#d3d8de] px-3.5 py-3">
              <MicroLabel>Instances by type</MicroLabel>
              <div className="mt-1.5">
                {Object.entries(detail.metrics.instanceCountByType).map(
                  ([t, c]) => (
                    <div
                      key={t}
                      className="flex justify-between border-b border-dotted border-[#e5e8eb] py-0.5 text-[11px] text-[#5f6b7c]"
                    >
                      <span>{t}</span>
                      <b className="text-[#1c2127]">{c}</b>
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : null}

          <div className="border-b border-[#d3d8de] px-3.5 py-3">
            <MicroLabel>Open alerts ({detail.alerts.length})</MicroLabel>
            {detail.alerts.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-[#8f99a8]">
                None — nominal
              </p>
            ) : (
              detail.alerts.map((a) => (
                <div
                  key={a.id}
                  className="mt-2 rounded border border-[#d3d8de] bg-[#f6f7f9]/50 px-2.5 py-2"
                  style={{
                    borderLeft: `3px solid ${SEV_HEX[a.severity]}`,
                  }}
                >
                  <p className="text-[11px] leading-snug text-[#5f6b7c]">
                    {a.message}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[9px] text-[#8f99a8]">
                      {a.metric} = {a.value}
                      {a.createdAt ? ` · ${timeAgo(a.createdAt)}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => onAck(a.id)}
                      className="rounded border border-[#d3d8de] px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[#215db0] hover:bg-[#e7f2fd]"
                    >
                      Ack
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {detail.recommendations.length > 0 ? (
            <div className="px-3.5 py-3">
              <MicroLabel>Recommendations</MicroLabel>
              <div className="mt-1">
                {detail.recommendations.map((r, i) => (
                  <p
                    key={i}
                    className="relative py-1 pl-4 text-[11px] leading-snug text-[#5f6b7c]"
                  >
                    <span className="absolute left-0 text-[#215db0]">
                      →
                    </span>
                    {r}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AlertRibbon({
  alerts,
  snapshot,
}: {
  alerts: TwinAlert[];
  snapshot: TwinTreeSnapshot | null;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const h = 72;
  const windowMin = 15;
  const now = Date.now();

  const unitNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of snapshot?.nodes ?? []) m.set(n.id, n.name);
    return m;
  }, [snapshot]);

  const events = alerts
    .filter((a) => a.createdAt)
    .map((a) => ({
      ...a,
      minAgo: (now - new Date(a.createdAt as string).getTime()) / 60000,
    }))
    .filter((a) => a.minAgo >= 0 && a.minAgo <= windowMin);

  const x = (minAgo: number) =>
    20 + ((windowMin - minAgo) / windowMin) * Math.max(0, width - 40);

  return (
    <footer className="flex h-24 shrink-0 flex-col border-t border-[#d3d8de] bg-[#f6f7f9]/40">
      <PanelHead
        title={`Alert timeline · last ${windowMin} min`}
        right={
          <span className="flex gap-3 text-[9px] font-medium tracking-wide text-[#8f99a8]">
            {(["critical", "warn", "info"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <i
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: SEV_HEX[s] }}
                />
                {s.toUpperCase()}
              </span>
            ))}
          </span>
        }
        className="border-b-0"
      />
      <div ref={ref} className="min-h-0 flex-1">
        {width > 0 ? (
          <svg width={width} height={h}>
            <line
              x1={20}
              y1={h / 2}
              x2={width - 20}
              y2={h / 2}
              stroke="#e5e8eb"
            />
            {[15, 10, 5, 0].map((m) => (
              <g key={m}>
                <line
                  x1={x(m)}
                  y1={h / 2 - 4}
                  x2={x(m)}
                  y2={h / 2 + 4}
                  stroke="#d3d8de"
                />
                <text
                  x={x(m)}
                  y={h - 6}
                  textAnchor="middle"
                  className="fill-[#8f99a8] text-[8px]"
                >
                  {m === 0 ? "now" : `-${m}m`}
                </text>
              </g>
            ))}
            {events.map((e) => (
              <g key={e.id}>
                <circle
                  cx={x(e.minAgo)}
                  cy={h / 2}
                  r={5}
                  fill={SEV_HEX[e.severity]}
                  opacity={0.9}
                >
                  <title>
                    {`${unitNames.get(e.unitInstanceId) ?? e.unitInstanceId.slice(0, 8)} — ${e.message}`}
                  </title>
                </circle>
                <circle
                  cx={x(e.minAgo)}
                  cy={h / 2}
                  r={9}
                  fill="none"
                  stroke={SEV_HEX[e.severity]}
                  opacity={0.3}
                />
              </g>
            ))}
            {events.length === 0 ? (
              <text
                x={width / 2}
                y={h / 2 - 10}
                textAnchor="middle"
                className="fill-[#8f99a8] text-[10px]"
              >
                No alerts in the last {windowMin} minutes
              </text>
            ) : null}
          </svg>
        ) : null}
      </div>
    </footer>
  );
}
