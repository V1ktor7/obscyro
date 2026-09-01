"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Box,
  Database,
  Map as MapIcon,
  Workflow,
} from "lucide-react";

/**
 * The software, running, in a frame.
 *
 * Abstract line diagrams said what the platform does; they did not show what it
 * is. This does — six screens rebuilt from the Studio's own design tokens
 * (`ink`, `line`, `canvas`, `brand`, the severity scale), inside the same
 * chrome: an icon rail on the left, a header, a working area. Somebody who
 * opens the product afterwards should recognise it.
 *
 * It plays like a video and can be driven by hand. Each screen animates the one
 * thing that screen is for — rows landing, a graph running, a curve crossing a
 * ceiling — rather than fading in as a static picture.
 *
 * The content is illustrative and deliberately thin on figures. Dataset names
 * are the real published files the demonstration reads, because those are
 * public and checkable; the bars carry no axis and the cards carry no
 * measurement, because a marketing frame has no room for the context a real
 * number would need.
 */

const SCREENS = 6;
const DWELL = 5200;

const RAIL = [Database, Workflow, Box, MapIcon, BarChart3, Activity];

export default function ProductTour({
  labels,
  className,
}: {
  labels: string[];
  className?: string;
}) {
  const [step, setStep] = useState(0);
  const [t, setT] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
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
      const p = Math.min(1, elapsed / (DWELL * 0.42));
      setT(p * p * (3 - 2 * p));
      if (elapsed >= DWELL && !held.current) {
        start = now;
        setStep((s) => (s + 1) % SCREENS);
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
      { rootMargin: "100px" },
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
      <div className="overflow-hidden border border-line bg-white">
        {/* Chrome, straight from the Studio: a 56px icon rail and a thin
            header. Recognition is the whole point of the frame. */}
        <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-2.5">
          <span className="text-[0.8125rem] font-medium lowercase tracking-tight text-ink">
            obscyro
          </span>
          <span className="text-[0.75rem] text-ink-faint">/ {labels[step]}</span>
          <span className="ml-auto hidden items-center gap-1.5 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            <span className="text-[0.7rem] text-ink-faint">Live</span>
          </span>
        </div>

        <div className="flex">
          <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3 sm:w-14">
            {RAIL.map((Icon, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pick(i)}
                aria-label={labels[i]}
                aria-current={i === step}
                className={
                  "flex h-8 w-8 items-center justify-center transition-colors sm:h-9 sm:w-9 " +
                  (i === step ? "bg-brand-soft text-brand-deep" : "text-ink-faint hover:text-ink")
                }
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1 bg-canvas p-3 sm:p-4">
            <div className="h-[260px] sm:h-[320px] lg:h-[360px]">
              {step === 0 ? <DataScreen t={t} /> : null}
              {step === 1 ? <PipelineScreen t={t} /> : null}
              {step === 2 ? <OntologyScreen t={t} /> : null}
              {step === 3 ? <TwinScreen t={t} /> : null}
              {step === 4 ? <DashboardScreen t={t} /> : null}
              {step === 5 ? <ResponseScreen t={t} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-px bg-line sm:grid-cols-6">
        {labels.slice(0, SCREENS).map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => pick(i)}
            aria-current={i === step}
            className={
              "bg-bg-primary px-2 py-2.5 text-[0.6875rem] leading-tight transition-colors sm:text-[0.75rem] " +
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

/* ------------------------------------------------------------------ screens */

/** Datasets on the left, the file's rows landing on the right. */
function DataScreen({ t }: { t: number }) {
  const sets = [
    "MSSS — Urgences (horaire)",
    "MSSS — Répertoire M02",
    "INSPQ — Soins intensifs",
    "ASPC — Eaux usées",
  ];
  const rows = 8;
  return (
    <div className="flex h-full gap-3">
      <ul className="hidden w-48 shrink-0 flex-col border border-line bg-white sm:flex">
        {sets.map((s, i) => (
          <li
            key={s}
            className={
              "truncate border-b border-line-faint px-3 py-2 text-[0.6875rem] " +
              (i === 0 ? "bg-brand-soft text-brand-deep" : "text-ink-body")
            }
          >
            {s}
          </li>
        ))}
      </ul>
      <div className="min-w-0 flex-1 border border-line bg-white">
        <div className="flex gap-3 border-b border-line px-3 py-1.5">
          {["Installation", "Civières", "Occupées", "Mise à jour"].map((h) => (
            <span key={h} className="flex-1 truncate text-[0.625rem] font-medium text-ink-muted">
              {h}
            </span>
          ))}
        </div>
        {Array.from({ length: rows }, (_, i) => {
          const on = Math.max(0, Math.min(1, t * rows - i));
          return (
            <div
              key={i}
              className="flex gap-3 border-b border-line-faint px-3 py-1.5"
              style={{ opacity: on, transform: `translateX(${(1 - on) * 10}px)` }}
            >
              {[0, 1, 2, 3].map((c) => (
                <span key={c} className="flex-1">
                  <span
                    className="block h-1.5 bg-ink-ghost"
                    style={{ width: `${45 + ((i * 7 + c * 13) % 45)}%` }}
                  />
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The builder: nodes wired left to right, a run travelling through.
 *
 * Drawn entirely in SVG. It was HTML boxes positioned in percentages over an
 * SVG in a 100x80 space, and the two coordinate systems did not agree — every
 * edge floated away from the node it was supposed to touch, and the last one
 * hung in mid-air. One space, one set of numbers, and the wires land.
 */
function PipelineScreen({ t }: { t: number }) {
  const W = 300;
  const H = 190;
  const BW = 52;
  const BH = 20;
  const nodes = [
    { x: 22, y: 85, label: "Dataset" },
    { x: 100, y: 34, label: "Filter" },
    { x: 100, y: 136, label: "Expand" },
    { x: 178, y: 85, label: "Join" },
    { x: 246, y: 85, label: "Object" },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 4],
  ];
  // Edges leave the right edge of one box and arrive at the left edge of the
  // next, at box mid-height — so a wire always meets a border, never a corner
  // and never empty canvas.
  const out = (i: number) => ({ x: nodes[i]!.x + BW, y: nodes[i]!.y + BH / 2 });
  const into = (i: number) => ({ x: nodes[i]!.x, y: nodes[i]!.y + BH / 2 });

  return (
    <div className="relative h-full border border-line bg-white">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
        {edges.map(([a, b], i) => {
          const on = t * edges.length > i;
          const p0 = out(a);
          const p1 = into(b);
          const mid = (p0.x + p1.x) / 2;
          return (
            <path
              key={i}
              d={`M${p0.x},${p0.y} C${mid},${p0.y} ${mid},${p1.y} ${p1.x},${p1.y}`}
              fill="none"
              stroke={on ? "#2d72d2" : "#d3d8de"}
              strokeWidth={on ? 1.4 : 1}
            />
          );
        })}
        {nodes.map((n, i) => {
          const on = t * nodes.length > i - 0.3;
          return (
            <g key={n.label}>
              <rect
                x={n.x}
                y={n.y}
                width={BW}
                height={BH}
                fill="#fff"
                stroke={on ? "#2d72d2" : "#d3d8de"}
                strokeWidth={1.2}
              />
              <text
                x={n.x + BW / 2}
                y={n.y + BH / 2 + 3.2}
                textAnchor="middle"
                fontSize="9"
                fill={on ? "#1c2127" : "#8f99a8"}
              >
                {n.label}
              </text>
            </g>
          );
        })}
        <text x={10} y={H - 8} fontSize="8" fill="#8f99a8">
          {t > 0.9 ? "Run complete" : "Running…"}
        </text>
      </svg>
    </div>
  );
}

/**
 * Object types, their properties, and the links between them.
 *
 * The first version put three cards in a row and repeated one link name under
 * each, which asserted two things that are not true: that a stretcher serves a
 * territory, and that an installation serves its own stretchers. Both are
 * wrong, and an ontology screen that models the domain incorrectly is worse
 * than no screen at all — it is the one thing on this page a domain expert
 * would read closely.
 *
 * The real shape is one type with two different relations out of it: an
 * installation *contains* stretchers and *serves* a territory. Drawn in SVG so
 * the connectors meet the boxes, for the same reason the pipeline is.
 */
function OntologyScreen({ t }: { t: number }) {
  const W = 300;
  const H = 190;
  const BW = 84;
  const rowH = 13;
  const head = 17;

  const types = [
    { x: 12, y: 74, name: "Installation", props: ["nom", "permis", "rls"] },
    { x: 196, y: 22, name: "CiviereUrgence", props: ["capacite", "occupees"] },
    { x: 196, y: 122, name: "Territoire", props: ["code", "population"] },
  ];
  const links = [
    { from: 0, to: 1, label: "contient" },
    { from: 0, to: 2, label: "dessert" },
  ];
  const boxH = (i: number) => head + types[i]!.props.length * rowH + 6;

  return (
    <div className="h-full border border-line bg-white">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
        {links.map((l, i) => {
          const on = t * links.length > i;
          const a = types[l.from]!;
          const b = types[l.to]!;
          const p0 = { x: a.x + BW, y: a.y + boxH(l.from) / 2 };
          const p1 = { x: b.x, y: b.y + boxH(l.to) / 2 };
          const mid = (p0.x + p1.x) / 2;
          return (
            <g key={l.label} opacity={on ? 1 : 0.25}>
              <path
                d={`M${p0.x},${p0.y} C${mid},${p0.y} ${mid},${p1.y} ${p1.x},${p1.y}`}
                fill="none"
                stroke="#2d72d2"
                strokeWidth={1.2}
              />
              <text
                x={mid}
                y={(p0.y + p1.y) / 2 - 4}
                textAnchor="middle"
                fontSize="7.5"
                fill="#5f6b7c"
              >
                {l.label}
              </text>
            </g>
          );
        })}

        {types.map((ty, i) => {
          const on = t * types.length > i - 0.3;
          return (
            <g key={ty.name} opacity={on ? 1 : 0.25}>
              <rect
                x={ty.x}
                y={ty.y}
                width={BW}
                height={boxH(i)}
                fill="#fff"
                stroke="#d3d8de"
                strokeWidth={1.1}
              />
              <line
                x1={ty.x}
                y1={ty.y + head}
                x2={ty.x + BW}
                y2={ty.y + head}
                stroke="#d3d8de"
                strokeWidth={1.1}
              />
              <text x={ty.x + 7} y={ty.y + 11.5} fontSize="8.5" fill="#1c2127">
                {ty.name}
              </text>
              {ty.props.map((prop, k) => (
                <g key={prop}>
                  <rect
                    x={ty.x + 7}
                    y={ty.y + head + 5 + k * rowH}
                    width={3}
                    height={3}
                    fill="#2d72d2"
                  />
                  <text
                    x={ty.x + 14}
                    y={ty.y + head + 8 + k * rowH}
                    fontSize="7.5"
                    fill="#5f6b7c"
                  >
                    {prop}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The network under load: sites, and how full each is. */
function TwinScreen({ t }: { t: number }) {
  const sites = [
    { x: 22, y: 30, load: 0.94 },
    { x: 48, y: 20, load: 0.62 },
    { x: 68, y: 44, load: 0.81 },
    { x: 34, y: 62, load: 0.45 },
    { x: 78, y: 70, load: 0.7 },
  ];
  return (
    <div className="relative h-full overflow-hidden border border-line bg-canvas-raised">
      <svg viewBox="0 0 100 80" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {[20, 40, 60].map((y) => (
          <line key={y} x1={0} y1={y} x2={100} y2={y} stroke="#eef1f4" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
        ))}
        {[25, 50, 75].map((x) => (
          <line key={x} x1={x} y1={0} x2={x} y2={80} stroke="#eef1f4" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {sites.map((s, i) => {
        const on = Math.max(0, Math.min(1, t * sites.length - i));
        const hot = s.load > 0.8;
        return (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${s.x}%`, top: `${s.y}%`, opacity: on }}
          >
            <span
              className={
                "block rounded-full border-2 " +
                (hot ? "border-danger bg-danger/15" : "border-ink-muted bg-white")
              }
              style={{ width: 10 + s.load * 12, height: 10 + s.load * 12 }}
            />
          </div>
        );
      })}
      <div className="absolute bottom-2 left-3 flex items-center gap-3 text-[0.625rem] text-ink-faint">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border-2 border-danger" /> at capacity
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border-2 border-ink-muted" /> below
        </span>
      </div>
    </div>
  );
}

/** Cards drawn from what the columns actually hold. */
function DashboardScreen({ t }: { t: number }) {
  const bars = [0.82, 0.61, 0.94, 0.47, 0.7, 0.55, 0.88];
  return (
    <div className="grid h-full grid-cols-2 gap-3">
      <div className="flex flex-col border border-line bg-white">
        <div className="border-b border-line px-3 py-1.5 text-[0.6875rem] text-ink">
          Civières par établissement
        </div>
        <div className="flex flex-1 items-end gap-1.5 p-3">
          {bars.map((b, i) => (
            <span
              key={i}
              className="flex-1 bg-brand"
              style={{ height: `${b * 100 * Math.min(1, Math.max(0, t * bars.length - i))}%` }}
            />
          ))}
        </div>
        <div className="border-t border-line-faint px-3 py-1.5 text-[0.5625rem] text-ink-faint">
          120 rows read · 12 with no measure
        </div>
      </div>
      <div className="flex flex-col border border-line bg-white">
        <div className="border-b border-line px-3 py-1.5 text-[0.6875rem] text-ink">
          Admissions, 2020–2023
        </div>
        <svg viewBox="0 0 100 60" className="flex-1" preserveAspectRatio="none">
          <polyline
            points={Array.from({ length: 60 }, (_, i) => {
              const u = i / 59;
              if (u > t) return null;
              const h = Math.exp(-Math.pow((u - 0.55) / 0.18, 2));
              return `${u * 100},${55 - h * 44}`;
            })
              .filter(Boolean)
              .join(" ")}
            fill="none"
            stroke="#2d72d2"
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="border-t border-line-faint px-3 py-1.5 text-[0.5625rem] text-ink-faint">
          1 point in 3 · whole window
        </div>
      </div>
    </div>
  );
}

/** Two protocols, ranked without a blended score. */
function ResponseScreen({ t }: { t: number }) {
  const rows = [
    { name: "Transfer at 90% occupancy", rank: "1", dominated: false },
    { name: "Surge, then transfer", rank: "2", dominated: false },
    { name: "Open 10% everywhere", rank: "—", dominated: true },
  ];
  return (
    <div className="flex h-full flex-col border border-line bg-white">
      <div className="border-b border-line px-3 py-1.5 text-[0.6875rem] text-ink">
        Ranked responses
      </div>
      {rows.map((r, i) => {
        const on = Math.max(0, Math.min(1, t * rows.length - i));
        return (
          <div
            key={r.name}
            className="flex items-center gap-3 border-b border-line-faint px-3 py-3"
            style={{ opacity: on }}
          >
            <span className="w-4 text-[0.6875rem] tabular-nums text-ink-faint">{r.rank}</span>
            <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink">{r.name}</span>
            {r.dominated ? (
              <span className="shrink-0 bg-danger-soft px-2 py-0.5 text-[0.5625rem] text-danger">
                dominated
              </span>
            ) : (
              <span className="flex shrink-0 gap-1">
                {[0, 1, 2].map((k) => (
                  <span key={k} className="h-1.5 w-8 bg-ok/70" />
                ))}
              </span>
            )}
          </div>
        );
      })}
      <p className="mt-auto px-3 py-2 text-[0.5625rem] text-ink-faint">
        Ranked by dominance. No weighted score.
      </p>
    </div>
  );
}
