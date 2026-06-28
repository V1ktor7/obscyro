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
import { formatFreshness } from "../twin-ui";

type LiveMetricsPanelProps = {
  env: string;
  hasKey: boolean;
};

export default function LiveMetricsPanel({ env, hasKey }: LiveMetricsPanelProps) {
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
          .catch(() => { /* keep last */ });
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

  return (
    <div className="flex min-h-0 flex-col border-t border-gray-200 lg:border-l lg:border-t-0">
      <div className="border-b border-gray-100 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
          Live metrics
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
            placeholder="where: key=value"
            className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
          />
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px]",
              mode === "stream"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : mode === "poll"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-gray-200 text-gray-400",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                mode === "stream" ? "bg-emerald-500" : mode === "poll" ? "bg-amber-500" : "bg-gray-300",
              )}
            />
            {mode === "stream" ? "metrics stream" : mode === "poll" ? "polling" : "…"}
          </span>
        </div>

        {error ? (
          <p className="mb-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {error}
          </p>
        ) : null}

        {!metrics ? (
          <p className="text-[11px] text-gray-400">Waiting for metrics…</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <MetricCard label="Total" value={metrics.totalInstances} />
              {metrics.byType.slice(0, 4).map((t) => (
                <MetricCard
                  key={t.typeName}
                  label={t.typeName}
                  value={t.count}
                  sub={formatFreshness(t.freshnessSeconds)}
                />
              ))}
            </div>
            {metrics.occupancy.length > 0 ? (
              <table className="mb-3 w-full text-left text-[10px]">
                <thead>
                  <tr className="text-gray-400">
                    <th className="py-1">Type</th>
                    <th>Status</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.occupancy.slice(0, 6).map((o, i) => (
                    <tr key={i} className="border-t border-gray-50 text-gray-600">
                      <td className="py-1">{o.typeName}</td>
                      <td>{o.value}</td>
                      <td>{o.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )}

        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-wide text-gray-400">
            Instance score
          </p>
          <input
            value={scoreInstanceId}
            onChange={(e) => setScoreInstanceId(e.target.value)}
            placeholder="Instance UUID"
            className="mb-2 w-full rounded border border-gray-200 px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
          />
          <Button size="sm" className="w-full" onClick={() => void handleScore()} disabled={scoring}>
            {scoring ? "Scoring…" : "Score"}
          </Button>
          {score ? (
            <div className="mt-2">
              <p className="text-lg font-semibold text-gray-900">{score.total}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(score.breakdown).map(([k, v]) => (
                  <Badge key={k} tone="default">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
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
    <Card className="p-2">
      <p className="text-[9px] uppercase tracking-wide text-gray-400">{label}</p>
      <motion.p
        key={value}
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 1 }}
        className="text-base font-semibold text-gray-900"
      >
        {value}
      </motion.p>
      {sub ? <p className="text-[9px] text-gray-400">{sub}</p> : null}
    </Card>
  );
}
