"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { SimComparison, SimExport } from "@/lib/platform-api";

import { downloadPng, downloadSvg, downloadText, slug, toCsv } from "./download";
import {
  BAND_COLOUR,
  bandOf,
  framesFor,
  project,
  type FacilitiesTable,
} from "./replay-frames";

/**
 * The run, played back.
 *
 * Drawn as a plain projection rather than on the real basemap. Ninety-one
 * frames of two hundred markers is a scrubber, and a scrubber has to answer the
 * slider inside a frame — moving Mapbox markers cannot, and a basemap adds
 * nothing to a question that is entirely about which dots are red.
 *
 * A dot is one facility: placed where it is, sized by what it holds, coloured
 * by the worst thing it provides. The ring around it is the queue, because a
 * full site with nobody waiting and a full site with forty people in the
 * corridor are different emergencies and read identically otherwise.
 */
export default function ReplayPlayer({
  result,
  snapshot,
}: {
  result: SimComparison;
  snapshot: SimExport;
}) {
  const table = result.datasets?.find((d) => d.name === "facilities") as
    | FacilitiesTable
    | undefined;
  const options = useMemo(
    () => result.rows.map((r) => ({ id: String(r.policy), name: String(r.name) })),
    [result],
  );
  const [policy, setPolicy] = useState(options[0]?.id ?? "");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(6);

  const frames = useMemo(
    () => (table ? framesFor(table, policy, result.horizon) : []),
    [table, policy, result.horizon],
  );

  const W = 720;
  const H = 380;
  const at = useMemo(
    () => project(snapshot.facilities.map((f) => ({ id: f.id, location: f.location })), W, H),
    [snapshot],
  );
  const size = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of snapshot.facilities) {
      const cap = Object.values(f.resources).reduce((n, r) => n + r.capacity, 0);
      // Square root: a 500-bed hospital is not twenty-five times the dot of a
      // 20-bed one, it is five times, which is what the eye reads as area.
      m.set(f.id, Math.max(2.5, Math.sqrt(cap) * 0.55));
    }
    return m;
  }, [snapshot]);

  const mapRef = useRef<SVGSVGElement | null>(null);
  const curveRef = useRef<SVGSVGElement | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function grab(
    ref: React.RefObject<SVGSVGElement | null>,
    kind: "png" | "svg",
    what: string,
  ) {
    const el = ref.current;
    if (!el) return;
    const base = `${slug(result.scenario.name)}-${what}-${policy}`;
    try {
      setSaveError(null);
      if (kind === "svg") downloadSvg(el, `${base}.svg`);
      else await downloadPng(el, `${base}.png`);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  }

  const raf = useRef<number | null>(null);
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
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  if (!table) {
    return (
      <p className="text-[11px] leading-relaxed text-ink-faint">
        Tick “one row per step and facility” before running, and the run plays back
        here.
      </p>
    );
  }

  const frame = frames[Math.min(step, frames.length - 1)];
  const peak = Math.max(1, ...frames.map((f) => f.waiting));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Response to replay"
          value={policy}
          onChange={(e) => {
            setPolicy(e.target.value);
            setPlaying(false);
          }}
          className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (step >= frames.length - 1) setStep(0);
            setPlaying((p) => !p);
          }}
          className="rounded-md bg-brand px-3 py-1 text-xs text-white hover:bg-brand-deep"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <select
          aria-label="Speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
        >
          {[2, 6, 15, 30].map((s) => (
            <option key={s} value={s}>
              {s} steps/s
            </option>
          ))}
        </select>
        <span className="text-xs tabular-nums text-ink-faint">
          step {frame?.step ?? 0} of {Math.max(0, frames.length - 1)}
        </span>
      </div>

      <input
        type="range"
        aria-label="Time step"
        min={0}
        max={Math.max(0, frames.length - 1)}
        value={step}
        onChange={(e) => {
          setStep(Number(e.target.value));
          setPlaying(false);
        }}
        className="w-full accent-brand"
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Waiting" value={Math.round(frame?.waiting ?? 0)} />
        <Stat label="Facilities full" value={frame?.full ?? 0} />
        <Stat label="On the map" value={frame?.facilities.length ?? 0} />
      </div>

      <svg
        ref={mapRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg border border-line bg-canvas"
        role="img"
        aria-label={`The network at step ${frame?.step ?? 0}`}
      >
        {(frame?.facilities ?? []).map((f) => {
          const p = at.get(f.id);
          if (!p) return null;
          const r = size.get(f.id) ?? 3;
          const band = bandOf(f.worst);
          return (
            <g key={f.id}>
              {f.waiting > 0 ? (
                <circle
                  cx={p[0]}
                  cy={p[1]}
                  r={r + 2 + Math.min(9, Math.sqrt(f.waiting))}
                  fill="none"
                  stroke={BAND_COLOUR.strained}
                  strokeOpacity={0.35}
                  strokeWidth={1.2}
                />
              ) : null}
              <circle cx={p[0]} cy={p[1]} r={r} fill={BAND_COLOUR[band]} fillOpacity={0.85}>
                <title>
                  {`${f.name} — ${Math.round(f.worst * 100)}% of ${f.activity}` +
                    (f.waiting > 0 ? ` · ${Math.round(f.waiting)} waiting` : "")}
                </title>
              </circle>
            </g>
          );
        })}
      </svg>

      {/* The queue over the whole run, with the cursor on it: the map says
          where, this says when, and neither answers the other's question. */}
      <svg
        ref={curveRef}
        viewBox={`0 0 ${W} 70`}
        className="w-full"
        role="img"
        aria-label="Queue over time"
      >
        <polyline
          fill="none"
          stroke={BAND_COLOUR.strained}
          strokeWidth={1.6}
          points={frames
            .map((f, i) => `${(i / Math.max(1, frames.length - 1)) * W},${66 - (f.waiting / peak) * 60}`)
            .join(" ")}
        />
        <line
          x1={(step / Math.max(1, frames.length - 1)) * W}
          y1={0}
          x2={(step / Math.max(1, frames.length - 1)) * W}
          y2={70}
          stroke="#8f99a8"
          strokeWidth={1}
        />
      </svg>

      {/* One picture is the step you are looking at, the other is the whole run.
          Both leave as they are on screen: a file that quietly renders something
          else than what was read is worse than no export at all. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <span className="text-[11px] uppercase tracking-wide text-ink-faint">Download</span>
        <button
          type="button"
          onClick={() => void grab(mapRef, "png", `step-${frame?.step ?? 0}`)}
          className="rounded-md border border-line bg-white px-2.5 py-1 text-[11px] text-ink-body hover:border-ink-ghost"
        >
          Map, this step (PNG)
        </button>
        <button
          type="button"
          onClick={() => void grab(mapRef, "svg", `step-${frame?.step ?? 0}`)}
          className="rounded-md border border-line bg-white px-2.5 py-1 text-[11px] text-ink-body hover:border-ink-ghost"
        >
          SVG
        </button>
        <button
          type="button"
          onClick={() => void grab(curveRef, "png", "queue")}
          className="rounded-md border border-line bg-white px-2.5 py-1 text-[11px] text-ink-body hover:border-ink-ghost"
        >
          Queue curve (PNG)
        </button>
        <button
          type="button"
          onClick={() =>
            downloadText(
              toCsv(
                ["step", "waiting", "facilities_full", "facilities_on_map"],
                frames.map((f) => [f.step, Math.round(f.waiting), f.full, f.facilities.length]),
              ),
              `${slug(result.scenario.name)}-queue-${policy}.csv`,
              "text/csv",
            )
          }
          className="rounded-md border border-line bg-white px-2.5 py-1 text-[11px] text-ink-body hover:border-ink-ghost"
        >
          Queue as CSV
        </button>
      </div>
      {saveError ? <p className="text-[11px] text-danger">{saveError}</p> : null}

      <div className="flex flex-wrap gap-3 text-[11px] text-ink-faint">
        {(["quiet", "busy", "strained", "full"] as const).map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: BAND_COLOUR[b] }}
            />
            {b === "full" ? "full" : b === "strained" ? "≥ 90%" : b === "busy" ? "≥ 60%" : "< 60%"}
          </span>
        ))}
        <span>The ring around a dot is how many are waiting there.</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-lg tabular-nums text-ink">{value.toLocaleString("en-CA")}</div>
      <div className="text-[11px] text-ink-faint">{label}</div>
    </div>
  );
}
