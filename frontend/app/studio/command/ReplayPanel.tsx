"use client";

import { useCallback, useEffect, useState } from "react";

import {
  listSimEvents,
  listSimPolicies,
  runReportProblem,
  runSimulation,
  type SimEvent,
  type SimPolicy,
} from "@/lib/platform-api";

import { framesFor, type FacilitiesTable, type Frame } from "../events/replay-frames";
import {
  demandFactorOf,
  divergenceProblem,
  divergesAt,
  rulesFromStep,
  withDemandFactor,
  type StepPoint,
} from "./branch";

/**
 * Running an event on the real map, and asking what a different day would have
 * looked like.
 *
 * The comparison already existed on the events screen, and reading a ranking is
 * not the same act as watching a network fill up. This is the second act: pick
 * what happened, watch it, then stop on a day and ask "what if we had acted
 * here" — which runs the same event with a response made to start at that step,
 * and keeps both lines.
 *
 * There is no pause and no checkpoint. The engine is deterministic and a rule
 * that is not yet eligible does nothing, so the shared past is identical by
 * construction. It is checked anyway, on the data that came back, because an
 * invariant nobody re-checks is a belief.
 *
 * The panel hands the current frame upward rather than drawing anything: the
 * map owns its layers, and a panel that reached into them would be a second
 * thing that knows how a facility is drawn.
 */

interface Run {
  readonly id: string;
  readonly label: string;
  /** 0 for the trunk; the step it was taken at for a branch. */
  readonly fromStep: number;
  readonly frames: Frame[];
}

export default function ReplayPanel({
  env,
  twinScenarioId,
  onFrame,
}: {
  env: string | null;
  twinScenarioId: string | null;
  onFrame: (frame: Frame | null) => void;
}) {
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [policies, setPolicies] = useState<SimPolicy[]>([]);
  const [eventId, setEventId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [showing, setShowing] = useState("");
  const [branchWith, setBranchWith] = useState("");
  // Overridden per branch rather than edited on the stored response, because a
  // strength that cannot be pinned down is one you run at several values. The
  // December package fitted somewhere between 0.95 and 0.97 a day on Montréal's
  // own wave, and lifting it three weeks later produced no rebound at all.
  const [strength, setStrength] = useState("");
  const [busy, setBusy] = useState<null | "trunk" | "branch">(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(6);

  useEffect(() => {
    if (!env) return;
    let off = false;
    void (async () => {
      try {
        const [e, p] = await Promise.all([listSimEvents(env), listSimPolicies(env)]);
        if (off) return;
        setEvents(e.events);
        setPolicies(p.policies);
        setEventId((prev) => prev || (e.events[0]?.id ?? ""));
        setBranchWith((prev) => prev || (p.policies[0]?.id ?? ""));
      } catch {
        if (!off) setError("Could not read your events.");
      }
    })();
    return () => {
      off = true;
    };
  }, [env]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const current = runs.find((r) => r.id === showing) ?? runs[0] ?? null;
  const frames = current?.frames ?? [];
  const trunk = runs[0] ?? null;

  useEffect(() => {
    onFrame(frames.length ? (frames[Math.min(step, frames.length - 1)] ?? null) : null);
  }, [frames, step, onFrame]);
  useEffect(() => () => onFrame(null), [onFrame]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s + 1 >= frames.length) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 1000 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, frames.length]);

  const go = useCallback(
    async (kind: "trunk" | "branch") => {
      if (!env || !eventId || busy) return;
      const policy = kind === "branch" ? policies.find((p) => p.id === branchWith) : undefined;
      if (kind === "branch" && !policy) return;
      setBusy(kind);
      setError(null);
      setPlaying(false);
      try {
        const out = await runSimulation(env, {
          eventId,
          policies: kind === "trunk" ? ["null"] : [],
          customPolicies:
            kind === "branch" && policy
              ? [
                  {
                    id: "branch",
                    name: policy.name,
                    // The delta: the same rules, made to start where the reader
                    // is looking. A stored response carries timing written when
                    // nobody knew which day would matter.
                    rules: rulesFromStep(
                      Number(strength) > 0
                        ? withDemandFactor(policy.rules, Number(strength))
                        : policy.rules,
                      step,
                    ),
                  },
                ]
              : [],
          censusAcuity: "urgence",
          routeCapacity: 20,
          twinScenarioId: twinScenarioId ?? undefined,
          collect: ["facilities"],
        });
        const wrong = runReportProblem(out);
        if (wrong) throw new Error(wrong);

        const table = out.datasets?.find((d) => d.name === "facilities") as
          | FacilitiesTable
          | undefined;
        if (!table) throw new Error("The run returned no per-facility trajectory to play.");
        const built = framesFor(table, kind === "trunk" ? "null" : "branch", out.horizon);

        if (kind === "trunk") {
          const run: Run = { id: "trunk", label: "Do nothing", fromStep: 0, frames: built };
          setRuns([run]);
          setShowing("trunk");
          setStep(0);
          return;
        }

        const clash = divergenceProblem(points(trunk?.frames ?? []), points(built), step);
        if (clash) throw new Error(clash);
        const id = `b${runs.length}`;
        setRuns((prev) => [
          ...prev,
          {
            id,
            label:
              `${policy!.name}, from ${step}` +
              (Number(strength) > 0 ? ` at ×${strength}` : ""),
            fromStep: step,
            frames: built,
          },
        ]);
        setShowing(id);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [env, eventId, busy, policies, branchWith, step, twinScenarioId, runs.length, trunk],
  );

  const frame = frames[Math.min(step, Math.max(0, frames.length - 1))];
  const last = Math.max(0, frames.length - 1);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-faint">Event</span>
        <select
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            setRuns([]);
          }}
          aria-label="Event to replay"
          className="w-full rounded border border-line px-2 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
        >
          {events.length === 0 ? <option value="">No events yet</option> : null}
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => void go("trunk")}
        disabled={!eventId || !!busy}
        className="rounded-md bg-brand px-3 py-1.5 text-[11px] text-white hover:bg-brand-deep disabled:bg-ink-ghost"
      >
        {busy === "trunk" ? `Running… ${elapsed}s` : runs.length ? "Start over" : "Run"}
      </button>
      {busy ? (
        <p className="text-[10px] leading-snug text-ink-faint">About thirty seconds.</p>
      ) : null}
      {error ? <p className="text-[11px] leading-snug text-danger">{error}</p> : null}

      {frames.length > 0 ? (
        <>
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (step >= last) setStep(0);
                  setPlaying((p) => !p);
                }}
                className="rounded border border-line px-2 py-1 text-[11px] text-ink-body hover:border-ink-ghost"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Speed"
                className="rounded border border-line px-1.5 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
              >
                {[2, 6, 15, 30].map((s) => (
                  <option key={s} value={s}>
                    {s}/s
                  </option>
                ))}
              </select>
              <span className="ml-auto text-[11px] tabular-nums text-ink-faint">
                step {frame?.step ?? 0} of {last}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={last}
              value={step}
              aria-label="Time step"
              onChange={(e) => {
                setStep(Number(e.target.value));
                setPlaying(false);
              }}
              className="w-full accent-brand"
            />

            <div className="grid grid-cols-2 gap-2">
              <Stat label="Waiting" value={Math.round(frame?.waiting ?? 0)} />
              <Stat label="Full" value={frame?.full ?? 0} />
            </div>
          </div>

          {/* Every line that came out of this event, the trunk first. A branch
              is frozen once taken: asking again makes another one rather than
              rewriting this, so two lines on the chart never come from
              assumptions that have since moved. */}
          {runs.length > 1 ? (
            <div className="flex flex-col gap-1 border-t border-line pt-3">
              <span className="text-[10px] uppercase tracking-wide text-ink-faint">Lines</span>
              {runs.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="run"
                    checked={showing === r.id}
                    onChange={() => setShowing(r.id)}
                    className="mt-0.5"
                  />
                  <span className="flex-1 text-[11px] leading-snug text-ink">{r.label}</span>
                </label>
              ))}
              <QueueChart runs={runs} showing={current?.id ?? ""} step={step} />
              {current && trunk && current.id !== trunk.id ? (
                <Verdict trunk={trunk} branch={current} />
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-[10px] uppercase tracking-wide text-ink-faint">
              What if, from step {step}
            </span>
            <select
              value={branchWith}
              onChange={(e) => setBranchWith(e.target.value)}
              aria-label="Response to branch with"
              className="w-full rounded border border-line px-2 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
            >
              {policies.length === 0 ? (
                <option value="">Write a response on the Events screen first</option>
              ) : null}
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {(() => {
              const stored = demandFactorOf(
                policies.find((p) => p.id === branchWith)?.rules ?? [],
              );
              if (stored === null) return null;
              return (
                <label className="flex items-center gap-2">
                  <span className="flex-1 text-[10px] leading-snug text-ink-faint">
                    Strength, per step
                  </span>
                  <input
                    inputMode="decimal"
                    aria-label="Strength per step"
                    value={strength}
                    placeholder={String(stored)}
                    onChange={(e) => setStrength(e.target.value)}
                    className="w-20 rounded border border-line px-2 py-1 text-right text-[11px] text-ink focus:border-brand focus:outline-none"
                  />
                </label>
              );
            })()}
            <button
              type="button"
              onClick={() => void go("branch")}
              disabled={!branchWith || !!busy}
              className="rounded-md border border-brand px-3 py-1.5 text-[11px] text-brand hover:bg-brand hover:text-white disabled:border-line disabled:text-ink-ghost"
            >
              {busy === "branch" ? `Running… ${elapsed}s` : "Branch here"}
            </button>
            <p className="text-[10px] leading-snug text-ink-faint">
              The response is made to start at this step. Everything before it is the
              same run, which is why the two lines share a past.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function points(frames: readonly Frame[]): StepPoint[] {
  return frames.map((f) => ({ step: f.step, waiting: f.waiting, full: f.full }));
}

function Verdict({ trunk, branch }: { trunk: Run; branch: Run }) {
  const at = divergesAt(points(trunk.frames), points(branch.frames));
  const total = (r: Run) => r.frames.reduce((n, f) => n + f.waiting, 0);
  const saved = total(trunk) - total(branch);
  if (at === null) {
    // A response that changes nothing is a real answer, and has to read as one
    // rather than as a run that failed.
    return (
      <p className="mt-1 text-[11px] leading-snug text-ink-faint">
        Identical to doing nothing. This response would not have changed the run.
      </p>
    );
  }
  return (
    <p className="mt-1 text-[11px] leading-snug text-ink-body">
      Parts from the trunk at step {at}.{" "}
      {saved > 0
        ? `${Math.round(saved).toLocaleString("en-CA")} fewer patient-days waiting.`
        : `${Math.round(-saved).toLocaleString("en-CA")} more patient-days waiting.`}
    </p>
  );
}

const LINE = ["#215db0", "#c23030", "#1d9e75", "#8f5cc4", "#d9822b"];

function QueueChart({ runs, showing, step }: { runs: Run[]; showing: string; step: number }) {
  const W = 240;
  const H = 64;
  const n = Math.max(...runs.map((r) => r.frames.length), 1);
  const peak = Math.max(1, ...runs.flatMap((r) => r.frames.map((f) => f.waiting)));
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - 4 - (v / peak) * (H - 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Queue by line">
      {runs.map((r, i) => (
        <polyline
          key={r.id}
          fill="none"
          stroke={LINE[i % LINE.length]}
          strokeWidth={r.id === showing ? 1.8 : 1}
          strokeOpacity={r.id === showing ? 1 : 0.45}
          points={r.frames.map((f, j) => `${x(j)},${y(f.waiting)}`).join(" ")}
        />
      ))}
      <line x1={x(step)} y1={0} x2={x(step)} y2={H} stroke="#8f99a8" strokeWidth={1} />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-white px-2 py-1.5">
      <div className="text-sm tabular-nums text-ink">{value.toLocaleString("en-CA")}</div>
      <div className="text-[10px] text-ink-faint">{label}</div>
    </div>
  );
}
