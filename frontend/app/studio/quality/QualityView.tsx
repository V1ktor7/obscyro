"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusChip, type ChipTone } from "../StatusChip";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

import {
  LAYER_META,
  listQualityFlags,
  runQualityScan,
  updateQualityFlag,
  type QualityFlag,
  type ScanSummary,
} from "../quality-api";
import { useStudio } from "../StudioShell";

function severityTone(severity: QualityFlag["severity"]): ChipTone {
  if (severity === "error") return "danger";
  if (severity === "warn") return "warn";
  return "neutral";
}

export default function QualityView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [whereInput, setWhereInput] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"all" | QualityFlag["severity"]>("all");
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [flags, setFlags] = useState<QualityFlag[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loadingFlags, setLoadingFlags] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const where = whereInput.trim() || undefined;

  const loadFlags = useCallback(async () => {
    if (!env) return;
    setLoadingFlags(true);
    try {
      const { flags: f } = await listQualityFlags(env, {
        status: "open",
        severity: severityFilter === "all" ? undefined : severityFilter,
      });
      setFlags(f);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingFlags(false);
    }
  }, [env, severityFilter]);

  useEffect(() => {
    if (env && hasKey) void loadFlags();
    else setFlags([]);
  }, [env, hasKey, loadFlags]);

  async function handleScan() {
    if (!env) return;
    setScanning(true);
    setError(null);
    try {
      const { summary: s } = await runQualityScan(env, where);
      setSummary(s);
      await loadFlags();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function handleFlagAction(flagId: string, status: "reviewed" | "dismissed") {
    if (!env) return;
    setUpdatingId(flagId);
    setError(null);
    try {
      await updateQualityFlag(env, flagId, status);
      await loadFlags();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <p className="max-w-sm text-center text-sm text-ink-muted">
          Sign in and create an API key to run data-quality scans.
        </p>
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <p className="text-sm text-ink-muted">Select an environment in the header.</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-1 items-center gap-2 min-w-[200px]">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
              where
            </span>
            <input
              value={whereInput}
              onChange={(e) => setWhereInput(e.target.value)}
              placeholder="key=value, key2=value2"
              className="flex-1 rounded-md border border-line px-2 py-1 text-xs focus:border-line-strong focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
              severity
            </span>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
              className="rounded-md border border-line px-2 py-1 text-xs focus:border-line-strong focus:outline-none"
            >
              <option value="all">All</option>
              <option value="error">Error</option>
              <option value="warn">Warn</option>
              <option value="info">Info</option>
            </select>
          </label>
          <Button onClick={() => void handleScan()} disabled={scanning}>
            {scanning ? "Scanning…" : "Run scan"}
          </Button>
        </div>

        {error ? (
          <p className="rounded border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-ink">
            {error}
          </p>
        ) : null}

        <section>
          <h2 className="mb-3 text-[10px] uppercase tracking-wide text-ink-faint">
            Quality layers
          </h2>
          <div className="space-y-2">
            {LAYER_META.map((layer) => {
              const count = summary?.byLayer[String(layer.layer)] ?? 0;
              return (
                <div
                  key={layer.layer}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                    layer.disabled
                      ? "border-line-soft bg-canvas-raised opacity-60"
                      : count > 0
                        ? "border-warn-line bg-warn-soft/50"
                        : "border-line bg-surface",
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] text-white">
                    {layer.layer}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink">{layer.label}</p>
                    <p className="text-[10px] text-ink-faint">{layer.description}</p>
                  </div>
                  {layer.disabled ? (
                    <StatusChip tone="neutral">disabled</StatusChip>
                  ) : (
                    <span className="text-sm font-semibold text-ink-body">{count}</span>
                  )}
                </div>
              );
            })}
          </div>
          {summary ? (
            <p className="mt-2 text-[11px] text-ink-faint">
              {summary.flagCount} flag{summary.flagCount !== 1 ? "s" : ""} total
              {summary.bySeverity.error
                ? ` · ${summary.bySeverity.error} error`
                : ""}
              {summary.bySeverity.warn ? ` · ${summary.bySeverity.warn} warn` : ""}
              {summary.bySeverity.info ? ` · ${summary.bySeverity.info} info` : ""}
            </p>
          ) : null}
        </section>

        <section>
          <h2 className="mb-2 text-[10px] uppercase tracking-wide text-ink-faint">
            Open flags
          </h2>
          {loadingFlags ? (
            <p className="text-sm text-ink-faint">Loading flags…</p>
          ) : flags.length === 0 ? (
            <p className="text-sm text-ink-faint">No open flags. Run a scan to detect issues.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-line">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-canvas-raised text-[10px] uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-1.5 font-medium">Instance</th>
                    <th className="px-2 py-1.5 font-medium">Layer</th>
                    <th className="px-2 py-1.5 font-medium">Severity</th>
                    <th className="px-2 py-1.5 font-medium">Message</th>
                    <th className="px-2 py-1.5 font-medium">Observed</th>
                    <th className="px-2 py-1.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => (
                    <tr key={f.id} className="border-b border-line-soft hover:bg-surface-hover">
                      <td className="px-2 py-1.5 text-[10px] text-ink-muted">
                        {f.instanceId.slice(0, 8)}…
                      </td>
                      <td className="px-2 py-1.5 text-ink-muted">L{f.layer}</td>
                      <td className="px-2 py-1.5">
                        <StatusChip tone={severityTone(f.severity)}>{f.severity}</StatusChip>
                      </td>
                      <td className="max-w-[200px] truncate px-2 py-1.5 text-ink-body">
                        {f.message}
                      </td>
                      <td className="max-w-[120px] truncate px-2 py-1.5 text-ink-faint">
                        {f.observedValue ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={updatingId === f.id}
                            onClick={() => void handleFlagAction(f.id, "reviewed")}
                            className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:border-line-strong disabled:opacity-50"
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            disabled={updatingId === f.id}
                            onClick={() => void handleFlagAction(f.id, "dismissed")}
                            className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted hover:border-line-strong disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
