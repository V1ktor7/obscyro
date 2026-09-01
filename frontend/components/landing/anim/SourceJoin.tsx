"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Two sources, and the rows they agree on.
 *
 * This replaces a pair of overlapping rings. A two-circle Venn on a brand page
 * is Mastercard, a three-circle one is Audi, and neither is a company this
 * should evoke — but the deeper problem was that a Venn says "these two things
 * share something" without saying what, which is the whole question.
 *
 * So it is drawn as the join it actually is. Rows on the left, rows on the
 * right, and a middle column holding only the ones that matched. Rows with no
 * counterpart stay put and stay grey: they are not lost, they are simply not
 * something two sources can both vouch for. That is the honest picture, and it
 * is also what the pipeline does.
 */

const LEFT = 7;
const RIGHT = 6;
/** Which left row pairs with which right row. The rest go unmatched. */
const PAIRS: [number, number][] = [
  [0, 1],
  [2, 0],
  [3, 3],
  [5, 4],
];

const INK = "#1d1d1f";
const HAIR = "rgba(29,29,31,0.16)";
const ACCENT = "#1d6fd4";

const W = 620;
const H = 300;
const COL = 128;
const ROW = 26;
const TOP = 42;

export default function SourceJoin({ className }: { className?: string }) {
  const [t, setT] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);

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
      // Fill over 2.4s, hold, then start again — long enough to be read.
      const u = ((now - start) / 5200) % 1;
      const p = Math.min(1, u / 0.46);
      setT(p * p * (3 - 2 * p));
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

  const lx = 40;
  const rx = W - 40 - COL;
  const mx = (W - COL) / 2;
  const y = (i: number) => TOP + i * ROW;

  return (
    <div ref={hostRef} className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Rows from two sources; only the ones that match are carried into a third, reconciled column."
      >
        {/* Source columns */}
        {Array.from({ length: LEFT }, (_, i) => (
          <line key={`l${i}`} x1={lx} y1={y(i)} x2={lx + COL} y2={y(i)} stroke={HAIR} strokeWidth={2} />
        ))}
        {Array.from({ length: RIGHT }, (_, i) => (
          <line key={`r${i}`} x1={rx} y1={y(i)} x2={rx + COL} y2={y(i)} stroke={HAIR} strokeWidth={2} />
        ))}

        {/* Matches: two strokes converging on one reconciled row. */}
        {PAIRS.map(([a, b], k) => {
          const on = Math.max(0, Math.min(1, t * PAIRS.length - k));
          if (on <= 0) return null;
          const my = y(k) + 8;
          return (
            <g key={k}>
              <path
                d={`M${lx + COL},${y(a)} C${lx + COL + 60},${y(a)} ${mx - 60},${my} ${mx},${my}`}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.4}
                strokeOpacity={0.55 * on}
              />
              <path
                d={`M${rx},${y(b)} C${rx - 60},${y(b)} ${mx + COL + 60},${my} ${mx + COL},${my}`}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.4}
                strokeOpacity={0.55 * on}
              />
              <line
                x1={mx}
                y1={my}
                x2={mx + COL * on}
                y2={my}
                stroke={INK}
                strokeWidth={2.6}
              />
            </g>
          );
        })}

        {/* The reconciled column is the only framed thing: it is the output. */}
        <rect
          x={mx - 14}
          y={TOP - 12}
          width={COL + 28}
          height={PAIRS.length * ROW + 8}
          fill="none"
          stroke={INK}
          strokeWidth={1.4}
        />
      </svg>
    </div>
  );
}
