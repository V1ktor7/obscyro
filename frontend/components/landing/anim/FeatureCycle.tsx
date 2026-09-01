"use client";

import { useEffect, useRef, useState } from "react";

/**
 * What the software does, drawn one step at a time.
 *
 * Five panels, each a minimal line diagram of something the platform actually
 * has: rows arriving, a pipeline reshaping them, objects and links, a capacity
 * curve run past its ceiling, and two responses compared. It advances on its
 * own and can be driven by hand.
 *
 * Two rules keep it from becoming decoration. Every panel corresponds to a
 * screen that exists — none of this illustrates a roadmap. And colour appears
 * only at the moment something is decided: demand crossing a ceiling, an option
 * being dominated. Everywhere else it is ink on paper, like the mark.
 */

const STEPS = 5;
const DWELL = 4200;

export default function FeatureCycle({
  labels,
  captions,
  className,
}: {
  labels: string[];
  captions: string[];
  className?: string;
}) {
  const [step, setStep] = useState(0);
  const [t, setT] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  // Set when a reader picks a panel, so the carousel stops taking it back.
  const held = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(1);
      return;
    }

    let running = false;
    let start = 0;
    const frame = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start;
      // Eased fill, then a hold, then advance. The hold is most of the cycle:
      // a diagram that is always mid-transition is never actually read.
      const p = Math.min(1, elapsed / (DWELL * 0.45));
      setT(p * p * (3 - 2 * p));
      if (elapsed >= DWELL && !held.current) {
        start = now;
        setStep((s) => (s + 1) % STEPS);
      }
      raf.current = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(
      (entries) => {
        const on = entries.some((e) => e.isIntersecting);
        if (on && !running) {
          running = true;
          raf.current = requestAnimationFrame(frame);
        } else if (!on && running) {
          running = false;
          cancelAnimationFrame(raf.current);
        }
      },
      { rootMargin: "80px" },
    );
    io.observe(host);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, []);

  function pick(i: number) {
    held.current = true;
    setStep(i);
    setT(1);
  }

  return (
    <div ref={hostRef} className={className}>
      <div className="panel overflow-hidden">
        <svg
          viewBox="0 0 620 300"
          className="block h-auto w-full"
          role="img"
          aria-label={labels[step] ?? ""}
        >
          {step === 0 ? <Ingest t={t} /> : null}
          {step === 1 ? <Pipeline t={t} /> : null}
          {step === 2 ? <Ontology t={t} /> : null}
          {step === 3 ? <Surge t={t} /> : null}
          {step === 4 ? <Compare t={t} /> : null}
        </svg>
      </div>

      <p className="caption mt-4 min-h-[2.6em] text-center">{captions[step] ?? ""}</p>

      <div className="mt-3 grid grid-cols-5 gap-px bg-border-subtle">
        {labels.slice(0, STEPS).map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => pick(i)}
            aria-current={i === step}
            className={
              "bg-bg-primary px-2 py-3 text-[0.6875rem] leading-tight transition-colors sm:text-[0.8125rem] " +
              (i === step ? "text-fg-primary" : "text-fg-secondary hover:text-fg-primary")
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const INK = "#1d1d1f";
const HAIR = "rgba(29,29,31,0.16)";
const ACCENT = "#1d6fd4";
const PRESSURE = "#b3261e";

/** Rows arriving from a published file and landing in a table. */
function Ingest({ t }: { t: number }) {
  const rows = 7;
  return (
    <g>
      <rect x={60} y={60} width={150} height={180} fill="none" stroke={HAIR} />
      <rect x={410} y={60} width={150} height={180} fill="none" stroke={INK} strokeWidth={1.4} />
      {Array.from({ length: rows }, (_, i) => {
        const appear = Math.max(0, Math.min(1, t * rows - i));
        const x = 210 + (410 - 210) * appear;
        const y = 78 + i * 24;
        return (
          <g key={i}>
            <line x1={72} y1={y} x2={198} y2={y} stroke={HAIR} />
            {appear > 0 ? (
              <line x1={x - 26} y1={y} x2={x} y2={y} stroke={ACCENT} strokeWidth={1.6} />
            ) : null}
            {appear >= 1 ? (
              <line x1={422} y1={y} x2={548} y2={y} stroke={INK} strokeWidth={1.2} />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** A graph of nodes reshaping rows on the way through. */
function Pipeline({ t }: { t: number }) {
  const nodes: [number, number][] = [
    [110, 150],
    [250, 96],
    [250, 204],
    [390, 150],
    [520, 150],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 4],
  ];
  return (
    <g>
      {edges.map(([a, b], i) => {
        const on = t * edges.length > i;
        const [x1, y1] = nodes[a]!;
        const [x2, y2] = nodes[b]!;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={on ? ACCENT : HAIR}
            strokeWidth={on ? 1.6 : 1}
          />
        );
      })}
      {nodes.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === 4 ? 13 : 10}
          fill="none"
          stroke={INK}
          strokeWidth={i === 4 ? 2.4 : 1.6}
        />
      ))}
    </g>
  );
}

/**
 * Object types and the links between them.
 *
 * This panel used to be three overlapping rings, which is the Audi mark with
 * one wheel missing — a logo nobody on this page wants to evoke. It is now what
 * an ontology screen actually shows: typed boxes, the properties inside them,
 * and the named links that join them.
 */
function Ontology({ t }: { t: number }) {
  const boxes: { x: number; y: number; rows: number }[] = [
    { x: 60, y: 70, rows: 3 },
    { x: 250, y: 40, rows: 4 },
    { x: 250, y: 180, rows: 2 },
    { x: 450, y: 100, rows: 3 },
  ];
  const links: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
  ];
  const W = 110;
  const head = 22;
  const rowH = 17;
  const boxH = (b: { rows: number }) => head + b.rows * rowH + 8;

  return (
    <g>
      {links.map(([a, b], i) => {
        const on = t * links.length > i;
        const A = boxes[a]!;
        const B = boxes[b]!;
        return (
          <line
            key={i}
            x1={A.x + W}
            y1={A.y + boxH(A) / 2}
            x2={B.x}
            y2={B.y + boxH(B) / 2}
            stroke={on ? ACCENT : HAIR}
            strokeWidth={on ? 1.5 : 1}
          />
        );
      })}
      {boxes.map((b, i) => {
        const shown = t * boxes.length > i - 0.4;
        return (
          <g key={i} opacity={shown ? 1 : 0.22}>
            <rect x={b.x} y={b.y} width={W} height={boxH(b)} fill="#fff" stroke={INK} strokeWidth={1.4} />
            <line x1={b.x} y1={b.y + head} x2={b.x + W} y2={b.y + head} stroke={INK} strokeWidth={1.4} />
            <line x1={b.x + 12} y1={b.y + 13} x2={b.x + 62} y2={b.y + 13} stroke={INK} strokeWidth={2.2} />
            {Array.from({ length: b.rows }, (_, r) => (
              <line
                key={r}
                x1={b.x + 12}
                y1={b.y + head + 11 + r * rowH}
                x2={b.x + W - 14 - (r % 2) * 18}
                y2={b.y + head + 11 + r * rowH}
                stroke={HAIR}
                strokeWidth={1.6}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** Demand rising past a fixed ceiling. */
function Surge({ t }: { t: number }) {
  const x0 = 70;
  const x1 = 560;
  const base = 250;
  const ceiling = 120;
  const pts: string[] = [];
  const n = 90;
  const shown = Math.max(2, Math.round(n * t));
  for (let i = 0; i < shown; i++) {
    const u = i / (n - 1);
    const x = x0 + (x1 - x0) * u;
    // One wave, peaking past the ceiling.
    const h = Math.exp(-Math.pow((u - 0.56) / 0.19, 2));
    const y = base - h * 190;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const crossed = pts.some((p) => Number(p.split(",")[1]) < ceiling);
  return (
    <g>
      <line x1={x0} y1={base} x2={x1} y2={base} stroke={HAIR} />
      <line
        x1={x0}
        y1={ceiling}
        x2={x1}
        y2={ceiling}
        stroke={crossed ? PRESSURE : HAIR}
        strokeDasharray="5 5"
        strokeWidth={crossed ? 1.4 : 1}
      />
      <polyline points={pts.join(" ")} fill="none" stroke={INK} strokeWidth={2} />
    </g>
  );
}

/** Two responses, one of them worse on every axis. */
function Compare({ t }: { t: number }) {
  const x0 = 70;
  const x1 = 560;
  const base = 240;
  const curve = (amp: number, shift: number) => {
    const pts: string[] = [];
    const n = 80;
    const shown = Math.max(2, Math.round(n * t));
    for (let i = 0; i < shown; i++) {
      const u = i / (n - 1);
      const x = x0 + (x1 - x0) * u;
      const h = Math.exp(-Math.pow((u - 0.54 + shift) / 0.2, 2));
      pts.push(`${x.toFixed(1)},${(base - h * amp).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  return (
    <g>
      <line x1={x0} y1={base} x2={x1} y2={base} stroke={HAIR} />
      <polyline points={curve(160, 0)} fill="none" stroke={PRESSURE} strokeWidth={2} opacity={0.85} />
      <polyline points={curve(96, 0.02)} fill="none" stroke={INK} strokeWidth={2} />
      {t > 0.9 ? (
        <>
          <circle cx={470} cy={base - 26} r={5} fill="none" stroke={INK} strokeWidth={1.6} />
          <circle cx={470} cy={base - 78} r={5} fill={PRESSURE} opacity={0.85} />
        </>
      ) : null}
    </g>
  );
}
