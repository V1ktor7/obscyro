"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

import {
  fetchInstanceScore,
  fetchMetrics,
  subscribeMetricsStream,
  type InstanceScore,
  type MetricsSnapshot,
} from "../live-api";
import { useStudio } from "../StudioShell";

function formatFreshness(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export default function LiveView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [whereInput, setWhereInput] = useState("");
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [mode, setMode] = useState<"stream" | "poll" | "idle">("idle");
  const [error, setError] = useState<string | null>(null);

  const [scoreInstanceId, setScoreInstanceId] = useState("");
  const [score, setScore] = useState<InstanceScore | null>(null);
  const [scoring, setScoring] = useState(false);

  const where = whereInput.trim() || undefined;

  useEffect(() => {
    if (!env || !hasKey) {
      setMetrics(null);
      setMode("idle");
      return;
    }

    let pollId: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const startPoll = () => {
      if (pollId) return;
      setMode("poll");
      void fetchMetrics(env, where)
        .then((m) => { if (!stopped) setMetrics(m); })
        .catch((err) => { if (!stopped) setError((err as Error).message); });
      pollId = setInterval(() => {
        void fetchMetrics(env, where)
          .then((m) => { if (!stopped) setMetrics(m); })
          .catch(() => { /* keep last snapshot */ });
      }, 5000);
    };

    setMode("stream");
    setError(null);
    const stopStream = subscribeMetricsStream(
      env,
      where,
      (m) => { if (!stopped) setMetrics(m); },
      startPoll,
    );

    return () => {
      stopped = true;
      stopStream();
      if (pollId) clearInterval(pollId);
    };
  }, [env, hasKey, where]);

  const handleScore = useCallback(async () => {
    if (!env || !scoreInstanceId.trim()) return;
    setScoring(true);
    setError(null);
    try {
      const res = await fetchInstanceScore(env, scoreInstanceId.trim());
      setScore(res);
    } catch (err) {
      setError((err as Error).message);
      setScore(null);
    } finally {
      setScoring(false);
    }
  }, [env, scoreInstanceId]);

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to view live metrics.
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
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
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
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px]",
              mode === "stream"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : mode === "poll"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-gray-200 bg-gray-50 text-gray-400",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                mode === "stream" ? "bg-emerald-500" : mode === "poll" ? "bg-amber-500" : "bg-gray-300",
              )}
            />
            {mode === "stream" ? "Live (stream)" : mode === "poll" ? "Polling (fallback)" : "Connecting…"}
          </span>
        </div>

        {error ? (
          <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}

        {!metrics ? (
          <p className="text-sm text-gray-400">Waiting for metrics…</p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <MetricCard
                label="Total instances"
                value={metrics.totalInstances}
              />
              {metrics.byType.map((t) => (
                <MetricCard
                  key={t.typeName}
                  label={t.typeName}
                  value={t.count}
                  sub={formatFreshness(t.freshnessSeconds)}
                />
              ))}
            </div>

            {metrics.occupancy.length > 0 ? (
              <section>
                <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
                  Occupancy
                </h2>
                <table className="w-full max-w-lg border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-400">
                      <th className="px-2 py-1.5 font-medium">Type</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.occupancy.map((o, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-2 py-1.5 text-gray-700">{o.typeName}</td>
                        <td className="px-2 py-1.5 text-gray-500">{o.value}</td>
                        <td className="px-2 py-1.5 text-gray-700">{o.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </>
        )}
      </div>

      <aside className="w-full shrink-0 border-t border-gray-200 bg-white p-4 lg:w-72 lg:border-l lg:border-t-0">
        <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
          Instance score
        </h2>
        <div className="flex flex-col gap-2">
          <input
            value={scoreInstanceId}
            onChange={(e) => setScoreInstanceId(e.target.value)}
            placeholder="Instance UUID"
            className="rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
          />
          <Button size="sm" onClick={() => void handleScore()} disabled={scoring || !scoreInstanceId.trim()}>
            {scoring ? "Scoring…" : "Score"}
          </Button>
        </div>
        {score ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-gray-500">{score.typeName}</p>
            <p className="text-2xl font-semibold text-gray-900">{score.total}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(score.breakdown).map(([key, pts]) => (
                <Badge key={key} tone="default">
                  {key}: {pts}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <Card className="p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <motion.p
        key={value}
        initial={{ opacity: 0.6, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mt-1 text-xl font-semibold text-gray-900"
      >
        {value}
      </motion.p>
      {sub ? <p className="mt-0.5 text-[10px] text-gray-400">{sub}</p> : null}
    </Card>
  );
}
