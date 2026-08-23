"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  listSimEvents,
  listSimPolicies,
  runSimulation,
  type SimComparison,
  type SimEvent,
  type SimPolicy,
} from "@/lib/platform-api";

import { framesFor, type FacilitiesTable, type Frame } from "../events/replay-frames";

/**
 * Running an event and watching it on the real map.
 *
 * The comparison already existed on the events screen, and reading a ranking is
 * not the same act as watching a network fill up. This panel is the second act:
 * pick what happened, pick the response, then move a cursor and see which
 * hospitals go red and where the queue builds — on the basemap, inside the
 * territories, beside the explorer that decides what is visible.
 *
 * It hands the current frame upward rather than drawing anything. The map owns
 * its own layers; a panel that reached into them would be a second thing that
 * knows how a site is drawn.
 */
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
  const [response, setResponse] = useState("null");
  const [result, setResult] = useState<SimComparison | null>(null);
  const [running, setRunning] = useState(false);
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
        setEventId((prev) => prev || (e.events[0] ? e.events[0].id : ""));
      } catch {
        if (!off) setError("Could not read your events.");
      }
    })();
    return () => {
      off = true;
    };
  }, [env]);

  const frames = useMemo(() => {
    if (!result) return [];
    const table = result.datasets?.find((d) => d.name === "facilities") as
      | FacilitiesTable
      | undefined;
    return table ? framesFor(table, response, result.horizon) : [];
  }, [result, response]);

  // The map is told what to draw; it never reaches in here for it.
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

  const run = useCallback(async () => {
    if (!env || !eventId || running) return;
    setRunning(true);
    setError(null);
    setPlaying(false);
    try {
      const out = await runSimulation(env, {
        eventId,
        policies: response === "null" ? ["null"] : [],
        policyIds: response === "null" ? [] : [response],
        // Named so the beds occupied when the feed was read are patients who
        // leave, not a hospital that reads full for the whole run.
        censusAcuity: "urgence",
        routeCapacity: 20,
        twinScenarioId: twinScenarioId ?? undefined,
        collect: ["facilities"],
      });
      setResult(out);
      setStep(0);
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [env, eventId, response, running, twinScenarioId]);

  const frame = frames[Math.min(step, Math.max(0, frames.length - 1))];
  const last = Math.max(0, frames.length - 1);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-faint">
          Event
        </span>
        <select
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            setResult(null);
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

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-faint">
          Response
        </span>
        <select
          value={response}
          onChange={(e) => {
            setResponse(e.target.value);
            setPlaying(false);
          }}
          aria-label="Response to replay"
          className="w-full rounded border border-line px-2 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
        >
          <option value="null">Do nothing</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={() => void run()}
        disabled={!eventId || running}
        className="rounded-md bg-brand px-3 py-1.5 text-[11px] text-white hover:bg-brand-deep disabled:bg-ink-ghost"
      >
        {running ? "Running…" : result ? "Run again" : "Run"}
      </button>

      {error ? <p className="text-[11px] leading-snug text-danger">{error}</p> : null}

      {frames.length > 0 ? (
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

          <p className="text-[10px] leading-snug text-ink-faint">
            A dot is coloured by the fullest thing that facility provides. The ring
            around it is how many are waiting there.
          </p>
        </div>
      ) : result ? (
        <p className="text-[11px] leading-snug text-ink-faint">
          The run returned no per-facility trajectory, so there is nothing to play.
        </p>
      ) : null}
    </div>
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
