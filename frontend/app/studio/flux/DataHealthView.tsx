"use client";

/**
 * Data health — the merged Data Flux + Data Quality surface (the tab keeps
 * the name "Data Flux"). One screen: feed rail (channels + ingest sources),
 * stat cards, the selected feed's flow through the quality gate into the
 * ontology, the L1–L6 layer summary, and a unified findings inbox combining
 * flux detections (client heuristics) with quality flags (review/dismiss).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  HeartPulse,
  Inbox,
  Loader2,
  Unplug,
  ShieldCheck,
  Waves,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import {
  listIngestEvents,
  listIngestSources,
  type IngestSource,
} from "@/lib/platform-api";

import { listChannels, type DataChannel } from "../channels-api";
import {
  detectGaps,
  detectRateAnomalies,
  deriveSourceStats,
  type FluxDetection,
  type IngestEventRow,
} from "./flux-detectors";
import {
  LAYER_META,
  listQualityFlags,
  runQualityScan,
  updateQualityFlag,
  type QualityFlag,
} from "../quality-api";
import { useStudio } from "../StudioShell";

type FindingFilter = "all" | "quality" | "flux" | "errors";

interface Feed {
  id: string;
  kind: "channel" | "source";
  name: string;
  status: "flowing" | "warn" | "stalled" | "idle";
  detail: string;
  savedToday: number;
}

const STATUS_DOT: Record<Feed["status"], string> = {
  flowing: "bg-ok",
  warn: "bg-warn",
  stalled: "bg-danger",
  idle: "bg-ink-ghost",
};

export default function DataHealthView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [sources, setSources] = useState<IngestSource[]>([]);
  const [channels, setChannels] = useState<DataChannel[]>([]);
  const [events, setEvents] = useState<IngestEventRow[]>([]);
  const [flags, setFlags] = useState<QualityFlag[]>([]);
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [filter, setFilter] = useState<FindingFilter>("all");
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!env) {
      setSources([]);
      setChannels([]);
      setEvents([]);
      setFlags([]);
      return;
    }
    try {
      const [src, ch, ev, fl] = await Promise.all([
        listIngestSources().catch(() => ({ sources: [] as IngestSource[] })),
        listChannels(env).catch(() => ({ channels: [] as DataChannel[] })),
        listIngestEvents().catch(() => ({ events: [] })),
        listQualityFlags(env, { status: "open" }).catch(() => ({ flags: [] as QualityFlag[] })),
      ]);
      setSources(src.sources);
      setChannels(ch.channels);
      setEvents(
        ev.events.map((e) => ({
          id: e.id,
          sourceId: e.sourceId,
          status: e.status,
          receivedAt: e.receivedAt,
        })),
      );
      setFlags(fl.flags);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [env]);

  useEffect(() => {
    setError(null);
    void load();
    const handle = setInterval(() => void load(), 30_000);
    return () => clearInterval(handle);
  }, [load]);

  const feeds = useMemo<Feed[]>(() => {
    const out: Feed[] = [];
    for (const c of channels) {
      const lastRunAge = c.lastRunAt
        ? (Date.now() - new Date(c.lastRunAt).getTime()) / 60_000
        : null;
      let status: Feed["status"] = "idle";
      if (c.status === "live") {
        status = lastRunAge !== null && lastRunAge < 60 ? "flowing" : "stalled";
      } else if (c.status === "paused") {
        status = "warn";
      }
      out.push({
        id: `channel:${c.slug}`,
        kind: "channel",
        name: c.name,
        status,
        detail:
          c.status === "draft"
            ? "draft"
            : `${c.stats.runsToday} run${c.stats.runsToday === 1 ? "" : "s"} today · ${
                c.stats.flaggedToday > 0 ? `${c.stats.flaggedToday} flagged` : "clean"
              }`,
        savedToday: c.stats.savedToday,
      });
    }
    for (const s of sources) {
      const stats = deriveSourceStats(events, s.id);
      const status: Feed["status"] =
        stats.status === "ok"
          ? "flowing"
          : stats.status === "warn"
            ? "warn"
            : stats.status === "critical"
              ? "stalled"
              : "idle";
      out.push({
        id: `source:${s.id}`,
        kind: "source",
        name: s.name,
        status,
        detail:
          stats.eventsPerMin !== null
            ? `${Math.round(stats.eventsPerMin * 60)}/h`
            : "no recent events",
        savedToday: 0,
      });
    }
    return out;
  }, [channels, sources, events]);

  useEffect(() => {
    setSelectedFeed((cur) => (cur && feeds.some((f) => f.id === cur) ? cur : feeds[0]?.id ?? null));
  }, [feeds]);

  const feed = feeds.find((f) => f.id === selectedFeed) ?? null;

  const detections = useMemo<FluxDetection[]>(() => {
    const heuristic = [...detectGaps(events), ...detectRateAnomalies(events)];
    for (const f of feeds) {
      if (f.status === "stalled") {
        heuristic.push({
          id: `stalled-${f.id}`,
          tier: "heuristic",
          severity: "critical",
          title: `${f.name} feed stalled`,
          detail: f.kind === "channel" ? "live channel with no run in 60 min" : "no recent events",
          at: new Date().toISOString(),
        });
      }
    }
    return heuristic;
  }, [events, feeds]);

  const byLayer = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of flags) m.set(f.layer, (m.get(f.layer) ?? 0) + 1);
    return m;
  }, [flags]);

  const totals = useMemo(() => {
    const flowing = feeds.filter((f) => f.status === "flowing").length;
    const intakePerHour = sources.reduce((sum, s) => {
      const st = deriveSourceStats(events, s.id);
      return sum + (st.eventsPerMin !== null ? st.eventsPerMin * 60 : 0);
    }, 0);
    return {
      flowing,
      feedCount: feeds.length,
      intakePerHour: Math.round(intakePerHour),
      savedToday: channels.reduce((sum, c) => sum + c.stats.savedToday, 0),
      openFindings: flags.length + detections.length,
    };
  }, [feeds, sources, events, channels, flags, detections]);

  async function handleScan() {
    if (!env || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const result = await runQualityScan(env, undefined, { incremental: true });
      setScanInfo(
        `scanned ${result.scannedCount.toLocaleString()} instances · ${result.flagCount} flag${result.flagCount === 1 ? "" : "s"}`,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function handleFlag(id: string, status: "reviewed" | "dismissed") {
    if (!env || updatingId) return;
    setUpdatingId(id);
    try {
      await updateQualityFlag(env, id, status);
      setFlags((cur) => cur.filter((f) => f.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  const shownFlags =
    filter === "flux" ? [] : filter === "errors" ? flags.filter((f) => f.severity === "error") : flags;
  const shownDetections =
    filter === "quality"
      ? []
      : filter === "errors"
        ? detections.filter((d) => d.severity === "critical")
        : detections;

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <p className="max-w-sm text-center text-sm text-ink-muted">
          Sign in and create an API key to monitor data health.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-ok-soft text-ok-ink">
          <HeartPulse className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-semibold text-ink">Data health</span>
        <span className="hidden rounded border border-line px-2 py-0.5 text-[11px] text-ink-body sm:inline">
          {env ?? "no environment"}
        </span>
        <span className="flex-1" />
        {scanInfo ? <span className="text-[11px] text-ink-faint">{scanInfo}</span> : null}
        <button
          type="button"
          disabled={!env || scanning}
          onClick={() => void handleScan()}
          className="flex items-center gap-1 rounded bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Run quality scan
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-b border-danger-line bg-danger-soft px-4 py-1.5 text-[11px] text-danger-ink">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Feed rail */}
        <aside className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
          <div className="px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            Feeds · {feeds.length}
          </div>
          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {feeds.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-ink-faint">
                {env
                  ? "No feeds yet — create channels in Ontology Parser."
                  : "Select an environment."}
              </p>
            ) : (
              feeds.map((f) => {
                const active = f.id === selectedFeed;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFeed(f.id)}
                    className={cn(
                      "rounded px-2 py-1.5 text-left transition-colors",
                      active ? "bg-brand-soft" : "hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[f.status])} />
                      <span
                        className={cn(
                          "truncate text-xs",
                          active ? "font-medium text-brand-deep" : "text-ink",
                        )}
                      >
                        {f.name}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "ml-3 block truncate text-[10px]",
                        f.status === "stalled"
                          ? "text-danger"
                          : active
                            ? "text-brand-deep"
                            : "text-ink-faint",
                      )}
                    >
                      {f.status === "stalled" ? "stalled" : f.detail}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Feeds flowing" value={`${totals.flowing} / ${totals.feedCount}`} />
            <StatCard label="Intake" value={`${totals.intakePerHour}/h`} />
            <StatCard label="Saved today" value={totals.savedToday.toLocaleString()} />
            <StatCard
              label="Open findings"
              value={totals.openFindings.toLocaleString()}
              warn={totals.openFindings > 0}
            />
          </div>

          {/* Live flow for the selected feed */}
          <section>
            <SectionHead icon={Waves} tone="text-brand" title={`Live flow${feed ? ` · ${feed.name}` : ""}`}>
              {flags.length > 0 ? (
                <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn-ink">
                  {flags.length} open flag{flags.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </SectionHead>
            <div className="rounded-md border border-line bg-surface p-3">
              <FlowDiagram feed={feed} openFlags={flags.length} savedToday={totals.savedToday} />
              <p className="mt-1 text-[10.5px] text-ink-faint">
                select a feed in the rail to trace its flow · only quality-passed records reach
                the ontology
              </p>
            </div>
          </section>

          {/* Quality layers */}
          <section>
            <SectionHead icon={ShieldCheck} tone="text-warn-ink" title="Quality layers">
              <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-faint">
                open flags by layer
              </span>
            </SectionHead>
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
              {LAYER_META.map((l) => {
                const count = byLayer.get(l.layer) ?? 0;
                return (
                  <div key={l.layer} className="rounded-md bg-surface px-3 py-2 shadow-[inset_0_0_0_1px_#333333]">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                      L{l.layer} {l.label.split(" ")[0]}
                    </p>
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        count > 0 ? "text-warn-ink" : "text-ink",
                      )}
                    >
                      {count}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Findings */}
          <section>
            <SectionHead icon={Inbox} tone="text-danger" title="Findings">
              <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger-ink">
                {totals.openFindings} open
              </span>
              <span className="ml-auto flex gap-1">
                {(
                  [
                    ["all", "all"],
                    ["quality", "quality"],
                    ["flux", "flux"],
                    ["errors", "errors only"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px]",
                      filter === key
                        ? "bg-brand-soft font-medium text-brand-deep"
                        : "border border-line text-ink-faint hover:text-ink-body",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </SectionHead>
            <div className="flex flex-col gap-2">
              {shownDetections.map((d) => (
                <FindingCard
                  key={d.id}
                  icon={d.severity === "critical" ? Unplug : Activity}
                  tone={d.severity === "critical" ? "danger" : "warn"}
                  title={d.title}
                  severity={d.severity === "critical" ? "error" : d.severity}
                  origin="flux"
                  detail={d.detail}
                />
              ))}
              {shownFlags.map((f) => (
                <FindingCard
                  key={f.id}
                  icon={f.layer === 5 ? Clock : Database}
                  tone={f.severity === "error" ? "danger" : f.severity === "warn" ? "warn" : "info"}
                  title={f.message}
                  severity={f.severity}
                  origin={`quality · L${f.layer}`}
                  detail={`${f.code}${f.observedValue ? ` · observed ${f.observedValue}` : ""}`}
                  busy={updatingId === f.id}
                  onReview={() => void handleFlag(f.id, "reviewed")}
                  onDismiss={() => void handleFlag(f.id, "dismissed")}
                />
              ))}
              {shownDetections.length === 0 && shownFlags.length === 0 ? (
                <p className="rounded-md border border-dashed border-line-strong bg-surface px-4 py-5 text-center text-xs text-ink-faint">
                  No open findings — feeds are flowing and the last scan came back clean.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StatCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2 shadow-[inset_0_0_0_1px_#333333]">
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide",
          warn ? "text-warn-ink" : "text-ink-faint",
        )}
      >
        {label}
      </p>
      <p className={cn("text-base font-semibold", warn ? "text-warn-ink" : "text-ink")}>
        {value}
      </p>
    </div>
  );
}

function SectionHead({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof Waves;
  tone: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className={cn("h-4 w-4", tone)} />
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function FlowDiagram({
  feed,
  openFlags,
  savedToday,
}: {
  feed: Feed | null;
  openFlags: number;
  savedToday: number;
}) {
  const stalled = feed?.status === "stalled";
  return (
    <svg
      viewBox="0 0 600 96"
      className="w-full"
      role="img"
      aria-label="Data flows from the selected feed through the quality gate into the ontology"
    >
      <path
        d="M112,48 H 208"
        fill="none"
        stroke={stalled ? "#fa4d56" : "#4589ff"}
        strokeWidth="1.5"
        strokeDasharray={stalled ? "2 5" : "5 4"}
      />
      <path d="M338,48 H 448" fill="none" stroke="#42be65" strokeWidth="1.5" strokeDasharray="5 4" />
      <path d="M300,30 Q 330,10 388,10" fill="none" stroke="#f1c21b" strokeWidth="1.2" strokeDasharray="2 4" />
      <rect x="8" y="28" width="104" height="40" rx="7" fill={stalled ? "#3b1518" : "#16305f"} />
      <text x="60" y="45" textAnchor="middle" fontSize="10" fill={stalled ? "#ff8389" : "#78a9ff"}>
        {feed ? (feed.name.length > 16 ? `${feed.name.slice(0, 15)}…` : feed.name) : "feed"}
      </text>
      <text x="60" y="58" textAnchor="middle" fontSize="8.5" fill={stalled ? "#ff8389" : "#78a9ff"}>
        {feed ? (stalled ? "stalled" : feed.detail.length > 22 ? `${feed.detail.slice(0, 21)}…` : feed.detail) : ""}
      </text>
      <rect x="208" y="28" width="130" height="40" rx="7" fill="#33290a" />
      <text x="273" y="45" textAnchor="middle" fontSize="10" fill="#fddc69">
        quality gate · L1–L6
      </text>
      <text x="273" y="58" textAnchor="middle" fontSize="8.5" fill="#fddc69">
        {openFlags} held back
      </text>
      <rect x="448" y="28" width="130" height="40" rx="7" fill="#2a1f45" />
      <text x="513" y="45" textAnchor="middle" fontSize="10" fill="#be95ff">
        ontology
      </text>
      <text x="513" y="58" textAnchor="middle" fontSize="8.5" fill="#be95ff">
        {savedToday.toLocaleString()} saved today
      </text>
      <rect x="388" y="2" width="118" height="17" rx="5" fill="#33290a" />
      <text x="447" y="14" textAnchor="middle" fontSize="8.5" fill="#fddc69">
        flags → findings inbox
      </text>
    </svg>
  );
}

function FindingCard({
  icon: Icon,
  tone,
  title,
  severity,
  origin,
  detail,
  busy,
  onReview,
  onDismiss,
}: {
  icon: typeof Activity;
  tone: "danger" | "warn" | "info";
  title: string;
  severity: string;
  origin: string;
  detail: string;
  busy?: boolean;
  onReview?: () => void;
  onDismiss?: () => void;
}) {
  const tones = {
    danger: { box: "bg-danger-soft text-danger", chip: "bg-danger-soft text-danger-ink" },
    warn: { box: "bg-warn-soft text-warn-ink", chip: "bg-warn-soft text-warn-ink" },
    info: { box: "bg-canvas text-ink-faint", chip: "bg-canvas-raised text-ink-muted" },
  }[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border bg-surface px-3 py-2.5",
        tone === "danger" ? "border-danger-line" : "border-line",
      )}
    >
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded", tones.box)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-ink">{title}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", tones.chip)}>
            {severity}
          </span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-faint">
            {origin}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">{detail}</span>
      </span>
      {onReview ? (
        <button
          type="button"
          disabled={busy}
          onClick={onReview}
          className="shrink-0 rounded border border-line px-2.5 py-1 text-[11px] text-ink-body hover:border-ok hover:text-ok-ink disabled:opacity-50"
        >
          review
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="shrink-0 px-1.5 py-1 text-[11px] text-ink-faint hover:text-ink-body disabled:opacity-50"
        >
          dismiss
        </button>
      ) : null}
      {tone === "danger" && !onReview ? (
        <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-danger" />
      ) : null}
    </div>
  );
}
