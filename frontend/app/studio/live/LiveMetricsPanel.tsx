"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import { StatusChip } from "../StatusChip";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

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
    <div className="flex min-h-0 flex-col border-t border-line lg:border-l lg:border-t-0">
      <div className="border-b border-line-faint px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">
          Live metrics
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={whereInput}
            onChange={(e) => setWhereInput(e.target.value)}
            placeholder="where: key=value"
            className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-[11px] focus:border-brand focus:outline-none"
          />
          <StatusChip
            tone={mode === "stream" ? "ok" : mode === "poll" ? "warn" : "neutral"}
            dot={mode === "stream" ? "bg-ok" : mode === "poll" ? "bg-warn" : "bg-ink-ghost"}
          >
            {mode === "stream" ? "Live stream" : mode === "poll" ? "Polling" : "Connecting"}
          </StatusChip>
        </div>

        {error ? (
          <p className="mb-2 rounded border border-danger/40 bg-danger-soft px-2 py-1 text-[11px] text-danger-ink">
            {error}
          </p>
        ) : null}

        {!metrics ? (
          <p className="text-[11px] text-ink-faint">Waiting for metrics…</p>
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
                  <tr className="text-ink-faint">
                    <th className="py-1">Type</th>
                    <th>Status</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.occupancy.slice(0, 6).map((o, i) => (
                    <tr key={i} className="border-t border-line-faint text-ink-muted">
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

        <div className="mt-4 border-t border-line-faint pt-3">
          <p className="mb-2 text-[9px] uppercase tracking-wide text-ink-faint">
            Instance score
          </p>
          <input
            value={scoreInstanceId}
            onChange={(e) => setScoreInstanceId(e.target.value)}
            placeholder="Instance UUID"
            className="mb-2 w-full rounded border border-line px-2 py-1 text-[11px] focus:border-brand focus:outline-none"
          />
          <Button size="sm" className="w-full" onClick={() => void handleScore()} disabled={scoring}>
            {scoring ? "Scoring…" : "Score"}
          </Button>
          {score ? (
            <div className="mt-2">
              <p className="text-lg font-semibold text-ink">{score.total}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(score.breakdown).map(([k, v]) => (
                  <StatusChip key={k} tone="neutral">
                    {k}: {v}
                  </StatusChip>
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
      <p className="text-[9px] uppercase tracking-wide text-ink-faint">{label}</p>
      <motion.p
        key={value}
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 1 }}
        className="text-base font-semibold text-ink"
      >
        {value}
      </motion.p>
      {sub ? <p className="text-[9px] text-ink-faint">{sub}</p> : null}
    </Card>
  );
}
