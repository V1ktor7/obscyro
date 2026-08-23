"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { SimComparison, SimExport } from "@/lib/platform-api";

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
        Coche « une ligne par pas et par installation » avant de lancer, et la course
        se rejoue ici.
      </p>
    );
  }

  const frame = frames[Math.min(step, frames.length - 1)];
  const peak = Math.max(1, ...frames.map((f) => f.waiting));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Réponse à rejouer"
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
          {playing ? "Pause" : "Jouer"}
        </button>
        <select
          aria-label="Vitesse"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
        >
          {[2, 6, 15, 30].map((s) => (
            <option key={s} value={s}>
              {s} pas/s
            </option>
          ))}
        </select>
        <span className="text-xs tabular-nums text-ink-faint">
          pas {frame?.step ?? 0} / {Math.max(0, frames.length - 1)}
        </span>
      </div>

      <input
        type="range"
        aria-label="Pas de temps"
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
        <Stat label="En attente" value={Math.round(frame?.waiting ?? 0)} />
        <Stat label="Installations pleines" value={frame?.full ?? 0} />
        <Stat label="Sur la carte" value={frame?.facilities.length ?? 0} />
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg border border-line bg-canvas"
        role="img"
        aria-label={`Le réseau au pas ${frame?.step ?? 0}`}
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
                  stroke={BAND_COLOUR.tendu}
                  strokeOpacity={0.35}
                  strokeWidth={1.2}
                />
              ) : null}
              <circle cx={p[0]} cy={p[1]} r={r} fill={BAND_COLOUR[band]} fillOpacity={0.85}>
                <title>
                  {`${f.name} — ${Math.round(f.worst * 100)}% de ${f.activity}` +
                    (f.waiting > 0 ? ` · ${Math.round(f.waiting)} en attente` : "")}
                </title>
              </circle>
            </g>
          );
        })}
      </svg>

      {/* The queue over the whole run, with the cursor on it: the map says
          where, this says when, and neither answers the other's question. */}
      <svg viewBox={`0 0 ${W} 70`} className="w-full" role="img" aria-label="File d'attente dans le temps">
        <polyline
          fill="none"
          stroke={BAND_COLOUR.tendu}
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

      <div className="flex flex-wrap gap-3 text-[11px] text-ink-faint">
        {(["calme", "charge", "tendu", "plein"] as const).map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: BAND_COLOUR[b] }}
            />
            {b === "plein" ? "plein" : b === "tendu" ? "≥ 90 %" : b === "charge" ? "≥ 60 %" : "< 60 %"}
          </span>
        ))}
        <span>Le cercle autour d&rsquo;un point est le nombre en attente.</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-lg tabular-nums text-ink">{value.toLocaleString("fr-CA")}</div>
      <div className="text-[11px] text-ink-faint">{label}</div>
    </div>
  );
}
