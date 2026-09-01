"use client";

import { useEffect, useRef, useState } from "react";
import { SCENE } from "./palette";

/**
 * Interoperability, animated on the mark itself.
 *
 * The identity is two rings of equal radius offset until they overlap, and that
 * is already the diagram: two bodies of data that are not the same shape,
 * meeting in a region that belongs to both. So this does not invent a second
 * visual language — it moves the logo.
 *
 * Geometry stays in the SVG; the labels are HTML beside it. Two reasons, both
 * learned the hard way here: text inside the viewBox scaled down to six pixels
 * on a phone, and labels anchored to a moving ring ran off the left edge at
 * full spread and were silently clipped. Out here they are responsive, they are
 * selectable, and they cannot be cropped by a coordinate system.
 *
 * The rings keep the artwork's proportions — stroke is 0.351 of the radius,
 * centres separated by 0.667 of it — so this reads as the logo moving rather
 * than as a diagram that resembles it.
 */

const R = 82;
const STROKE = R * 0.3508;
const SPREAD = R * 0.6668;
const CX = 300;
const CY = 150;

const SOURCES = ["CSV · Windows-1252", "REST · hourly", "HL7 v2", "GeoJSON"];
const OBJECTS = ["Installation", "Civière", "Territoire", "Transfert"];

export default function InteropRings({ className }: { className?: string }) {
  const [t, setT] = useState(1);
  const raf = useRef(0);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Settled closed: the reader still sees the overlap, which is the point.
      setT(1);
      return;
    }

    let running = false;
    let start = 0;
    const frame = (now: number) => {
      if (!start) start = now;
      // 9 s round trip, cosine-eased so it rests at both ends instead of sliding.
      const phase = (((now - start) / 9000) % 1) * Math.PI * 2;
      setT((1 - Math.cos(phase)) / 2);
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

  const gap = SPREAD * (0.35 + 1.9 * (1 - t));
  const cxA = CX - gap / 2;
  const cxB = CX + gap / 2;
  const lens = Math.max(0, Math.min(1, (R * 2 - (cxB - cxA)) / (R * 1.25)));

  return (
    <div ref={hostRef} className={className}>
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] sm:gap-3">
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 sm:flex-col sm:items-end sm:gap-1.5">
          {SOURCES.map((s) => (
            <li
              key={s}
              className="text-[0.8125rem] leading-relaxed text-fg-secondary sm:text-right"
            >
              {s}
            </li>
          ))}
        </ul>

        <svg
          viewBox="150 20 300 260"
          className="h-auto w-full"
          role="img"
          aria-label="Two rings of published data drifting apart and back together; where they overlap, a lit region marks what both sources agree on."
        >
          <defs>
            {/* The lens is the intersection of the two discs, so it is drawn as
                one disc clipped by the other rather than faked with an ellipse. */}
            <clipPath id="obs-interop-lens">
              <circle cx={cxA} cy={CY} r={R + STROKE / 2} />
            </clipPath>
          </defs>

          <circle
            cx={cxB}
            cy={CY}
            r={R + STROKE / 2}
            fill={SCENE.flow}
            fillOpacity={0.16 * lens}
            clipPath="url(#obs-interop-lens)"
          />

          <circle
            cx={cxA}
            cy={CY}
            r={R}
            fill="none"
            stroke={SCENE.flow}
            strokeWidth={STROKE}
            strokeOpacity={0.65}
          />
          <circle
            cx={cxB}
            cy={CY}
            r={R}
            fill="none"
            stroke="#1d1d1f"
            strokeWidth={STROKE}
            strokeOpacity={0.72 * (0.5 + 0.5 * lens)}
          />
        </svg>

        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 sm:flex-col sm:items-start sm:gap-1.5">
          {OBJECTS.map((o) => (
            <li
              key={o}
              className="text-[0.8125rem] leading-relaxed transition-colors"
              style={{ color: `rgba(45,114,210,${0.4 + 0.6 * lens})` }}
            >
              {o}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
