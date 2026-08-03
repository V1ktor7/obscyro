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
        <p className="max-w-sm text-center text-sm text-ink-muted">
          Sign in and create an API key to view live metrics.
        </p>
      </div>
    );
  }

  if (!env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-ink-muted">Select an environment in the header.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex flex-1 items-center gap-2 min-w-[200px]">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">
              where
            </span>
            <input
              value={whereInput}
              onChange={(e) => setWhereInput(e.target.value)}
              placeholder="key=value, key2=value2"
              className="flex-1 rounded-md border border-line px-2 py-1 text-xs focus:border-brand focus:outline-none"
            />
          </label>
          <StatusChip
            tone={mode === "stream" ? "ok" : mode === "poll" ? "warn" : "neutral"}
            dot={mode === "stream" ? "bg-ok" : mode === "poll" ? "bg-warn" : "bg-ink-ghost"}
          >
            {mode === "stream" ? "Live stream" : mode === "poll" ? "Polling" : "Connecting"}
          </StatusChip>
        </div>

        {error ? (
          <p className="mb-3 rounded border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger-ink">
            {error}
          </p>
        ) : null}

        {!metrics ? (
          <p className="text-sm text-ink-faint">Waiting for metrics…</p>
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
                <h2 className="mb-2 text-[10px] uppercase tracking-wide text-ink-faint">
                  Occupancy
                </h2>
                <table className="w-full max-w-lg border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-faint">
                      <th className="px-2 py-1.5 font-medium">Type</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.occupancy.map((o, i) => (
                      <tr key={i} className="border-b border-line-faint">
                        <td className="px-2 py-1.5 text-ink-body">{o.typeName}</td>
                        <td className="px-2 py-1.5 text-ink-muted">{o.value}</td>
                        <td className="px-2 py-1.5 text-ink-body">{o.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </>
        )}
      </div>

      <aside className="w-full shrink-0 border-t border-line bg-white p-4 lg:w-72 lg:border-l lg:border-t-0">
        <h2 className="mb-3 text-[10px] uppercase tracking-wide text-ink-faint">
          Instance score
        </h2>
        <div className="flex flex-col gap-2">
          <input
            value={scoreInstanceId}
            onChange={(e) => setScoreInstanceId(e.target.value)}
            placeholder="Instance UUID"
            className="rounded border border-line px-2 py-1.5 text-xs focus:border-brand focus:outline-none"
          />
          <Button size="sm" onClick={() => void handleScore()} disabled={scoring || !scoreInstanceId.trim()}>
            {scoring ? "Scoring…" : "Score"}
          </Button>
        </div>
        {score ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-ink-muted">{score.typeName}</p>
            <p className="text-2xl font-semibold text-ink">{score.total}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(score.breakdown).map(([key, pts]) => (
                <StatusChip key={key} tone="neutral">
                  {key}: {pts}
                </StatusChip>
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
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
      <motion.p
        key={value}
        initial={{ opacity: 0.6, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mt-1 text-xl font-semibold text-ink"
      >
        {value}
      </motion.p>
      {sub ? <p className="mt-0.5 text-[10px] text-ink-faint">{sub}</p> : null}
    </Card>
  );
}
