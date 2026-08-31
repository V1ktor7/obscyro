"use client";

import { useEffect, useRef } from "react";

/**
 * One animation loop, shared by every canvas on the page.
 *
 * Three things this handles that are easy to leave out and expensive to leave
 * out:
 *
 * - **Device pixel ratio.** A canvas sized in CSS pixels renders blurry on
 *   every laptop made in the last decade. The backing store is scaled and the
 *   context pre-transformed, so the draw code can think in CSS pixels.
 * - **Off-screen pause.** Three animated canvases all painting at 60fps while
 *   two of them are far below the fold is a fan spinning up for nothing. Each
 *   scene runs only while it is on screen.
 * - **Reduced motion.** `prefers-reduced-motion` is honoured by drawing a
 *   single settled frame rather than by hiding the graphic, so the reader still
 *   gets the picture and not an empty box.
 */

export interface SceneContext {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels, not backing-store pixels. */
  width: number;
  height: number;
  /** Seconds since the scene started. Frozen for reduced motion. */
  time: number;
  /** True when the reader asked for reduced motion. */
  still: boolean;
}

export function useCanvasScene(
  draw: (scene: SceneContext) => void,
  /** A settled `time` to draw once when motion is reduced. */
  stillTime = 6,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Kept in a ref so a re-render with a new closure does not restart the loop.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let start = 0;
    let visible = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      drawRef.current({ ctx, width, height, time, still: reduce });
    };

    const frame = (now: number) => {
      if (!start) start = now;
      paint((now - start) / 1000);
      raf = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (raf || reduce) return;
      raf = requestAnimationFrame(frame);
    };
    const stopLoop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro = new ResizeObserver(() => {
      resize();
      // Repaint immediately: without this a resize leaves a blank canvas until
      // the next frame, and for a still scene there is no next frame.
      if (reduce || !visible) paint(stillTime);
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) startLoop();
        else stopLoop();
      },
      { rootMargin: "120px" },
    );
    io.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else if (visible) startLoop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    paint(stillTime);

    return () => {
      stopLoop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stillTime]);

  return canvasRef;
}

/**
 * Shared palette.
 *
 * Ink on paper, and one blue. The earlier version glowed on near-black with two
 * accents, which is the register of a screensaver rather than of an instrument.
 * Thin dark lines on a light ground read as a drawing somebody made on purpose,
 * and they survive being printed or projected — which is where a diagram in
 * this sector actually ends up.
 */
export const SCENE = {
  hairline: "rgba(29,29,31,0.10)",
  faint: "rgba(29,29,31,0.06)",
  ink: "rgba(29,29,31,0.55)",
  /** Data in motion, and the only colour any of these scenes uses. */
  flow: "#2d72d2",
} as const;
