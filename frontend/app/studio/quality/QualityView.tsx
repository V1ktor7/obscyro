"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
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

function severityTone(severity: QualityFlag["severity"]): "danger" | "warning" | "default" {
  if (severity === "error") return "danger";
  if (severity === "warn") return "warning";
  return "default";
}

export default function QualityView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [whereInput, setWhereInput] = useState("");
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
      const { flags: f } = await listQualityFlags(env, { status: "open" });
      setFlags(f);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingFlags(false);
    }
  }, [env]);

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
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to run data-quality scans.
        </p>
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-gray-500">Select an environment in the header.</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-1 items-center gap-2 min-w-[200px]">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
              where
            </span>
            <input
              value={whereInput}
              onChange={(e) => setWhereInput(e.target.value)}
              placeholder="key=value, key2=value2"
              className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs focus:border-gray-400 focus:outline-none"
            />
          </label>
          <Button onClick={() => void handleScan()} disabled={scanning}>
            {scanning ? "Scanning…" : "Run scan"}
          </Button>
        </div>

        {error ? (
          <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}

        <section>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
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
                      ? "border-gray-100 bg-gray-50 opacity-60"
                      : count > 0
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-gray-200 bg-white",
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 font-mono text-[10px] text-white">
                    {layer.layer}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800">{layer.label}</p>
                    <p className="text-[10px] text-gray-400">{layer.description}</p>
                  </div>
                  {layer.disabled ? (
                    <Badge tone="default">disabled</Badge>
                  ) : (
                    <span className="font-mono text-sm font-semibold text-gray-700">{count}</span>
                  )}
                </div>
              );
            })}
          </div>
          {summary ? (
            <p className="mt-2 text-[11px] text-gray-400">
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
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
            Open flags
          </h2>
          {loadingFlags ? (
            <p className="text-sm text-gray-400">Loading flags…</p>
          ) : flags.length === 0 ? (
            <p className="text-sm text-gray-400">No open flags. Run a scan to detect issues.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400">
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
                    <tr key={f.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-2 py-1.5 font-mono text-[10px] text-gray-600">
                        {f.instanceId.slice(0, 8)}…
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">L{f.layer}</td>
                      <td className="px-2 py-1.5">
                        <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                      </td>
                      <td className="max-w-[200px] truncate px-2 py-1.5 text-gray-700">
                        {f.message}
                      </td>
                      <td className="max-w-[120px] truncate px-2 py-1.5 text-gray-400">
                        {f.observedValue ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={updatingId === f.id}
                            onClick={() => void handleFlagAction(f.id, "reviewed")}
                            className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:border-gray-400 disabled:opacity-50"
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            disabled={updatingId === f.id}
                            onClick={() => void handleFlagAction(f.id, "dismissed")}
                            className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:border-gray-400 disabled:opacity-50"
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
