"use client";

import { useEffect, useRef } from "react";

import "mapbox-gl/dist/mapbox-gl.css";

/**
 * The hero: a turning globe, the operations drawn over it, and an opening
 * sequence that closes on the mark.
 *
 * Three layers, in order. The Mapbox globe sits at low opacity so the headline
 * stays the first thing read — a background that competes with the words is a
 * background that failed. A canvas over it draws what the software is for:
 * links between institutions with traffic moving along them, and sites whose
 * ring thickens as they fill. And on load, two rings sweep in, settle into the
 * exact geometry of the logo, and fade back to a watermark.
 *
 * **Nothing here is real operational data.** The sites are world cities and the
 * pressure on them is a fixed pattern chosen to make the picture legible. A
 * ministry's actual occupancy belongs behind the sign-in, and a marketing page
 * showing a live network would be publishing it to anyone who scrolled. No
 * figure and no institution name appears, so nothing here can be misread as a
 * measurement.
 */

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const STYLE = "mapbox://styles/mapbox/light-v11";

const INK = "29,29,31";
const FLOW = "29,111,212";
const PRESSURE = "179,38,30";

/** Illustrative sites. `load` is a fixed pattern, not a measurement. */
const SITES: { lng: number; lat: number; load: number }[] = [
  { lng: -73.57, lat: 45.5, load: 0.94 },
  { lng: -71.21, lat: 46.81, load: 0.61 },
  { lng: -79.38, lat: 43.65, load: 0.78 },
  { lng: -123.12, lat: 49.28, load: 0.44 },
  { lng: -74.0, lat: 40.71, load: 0.88 },
  { lng: -0.12, lat: 51.5, load: 0.72 },
  { lng: 2.35, lat: 48.85, load: 0.53 },
  { lng: 13.4, lat: 52.52, load: 0.66 },
  { lng: 18.06, lat: 59.33, load: 0.31 },
  { lng: 151.2, lat: -33.86, load: 0.58 },
  { lng: 139.69, lat: 35.68, load: 0.83 },
  { lng: 103.82, lat: 1.35, load: 0.49 },
  { lng: -46.63, lat: -23.55, load: 0.7 },
  { lng: 28.04, lat: -26.2, load: 0.4 },
  { lng: -99.13, lat: 19.43, load: 0.76 },
];

const LINKS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 4],
  [2, 3],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [10, 11],
  [11, 9],
  [12, 13],
  [14, 4],
];

/** Logo geometry: equal radii, centres apart by 0.667 r, stroke 0.34 r. */
const LOGO_GAP = 0.667;
const LOGO_STROKE = 0.34;
/** Seconds. Rings converge, hold, then settle to a watermark. */
const INTRO = { converge: 2.1, hold: 0.9, fade: 1.1 };

type LngLat = { lng: number; lat: number };

function rad(d: number) {
  return (d * Math.PI) / 180;
}

/** Great-circle interpolation, so a link follows the sphere. */
function along(a: LngLat, b: LngLat, t: number): LngLat {
  const φ1 = rad(a.lat);
  const λ1 = rad(a.lng);
  const φ2 = rad(b.lat);
  const λ2 = rad(b.lng);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
      ),
    );
  if (d < 1e-9) return a;
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return {
    lat: (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI,
    lng: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

/**
 * Whether a point is on the near face.
 *
 * `map.project` happily returns screen coordinates for the far side of the
 * globe, so without this every link is drawn twice — once correctly and once
 * mirrored through the planet.
 */
function nearSide(centre: LngLat, p: LngLat) {
  const c = Math.sin(rad(centre.lat)) * Math.sin(rad(p.lat)) +
    Math.cos(rad(centre.lat)) * Math.cos(rad(p.lat)) * Math.cos(rad(p.lng - centre.lng));
  return c > 0.12;
}

export default function HeroGlobe({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /*
   * One effect, no state.
   *
   * Mapbox is an imperative library with its own lifecycle, and every attempt
   * to mirror that lifecycle into React state produced a different race: a ref
   * that could not wake an effect, a `style.load` that had already fired by the
   * time a listener was attached, a readiness flag reset by StrictMode's second
   * mount. Each one left the same symptom — a mounted, correctly sized,
   * permanently blank globe, with a green build and an empty console.
   *
   * So nothing here re-renders. The map is created once, the frame loop starts
   * immediately and reads the map through a local variable, and the basemap's
   * fade-in is written straight to the node's style. React owns the two
   * elements; this effect owns everything inside them.
   */
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!TOKEN || !host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let disposed = false;
    let map: import("mapbox-gl").Map | null = null;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    const t0 = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const time = (now - t0) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);

      // The rings do not wait for a basemap. If Mapbox never arrives — no
      // token, blocked host, WebGL off — the hero still opens on the mark
      // rather than on an empty rectangle.
      if (map) {
        try {
          if (!reduce) {
            const c = map.getCenter();
            c.lng -= 0.028;
            map.setCenter(c);
          }
          const centre = map.getCenter();
          const project = (p: LngLat) => map!.project([p.lng, p.lat]);

          LINKS.forEach(([ai, bi], i) => {
            const a = SITES[ai]!;
            const b = SITES[bi]!;
            const head = reduce ? 0.5 : (((time * 0.22 + i * 0.31) % 1) + 1) % 1;
            const N = 34;
            for (let s = 0; s < N; s++) {
              const u0 = s / N;
              const u1 = (s + 1) / N;
              const p0 = along(a, b, u0);
              const p1 = along(a, b, u1);
              if (!nearSide(centre, p0) || !nearSide(centre, p1)) continue;
              const s0 = project(p0);
              const s1 = project(p1);
              const d = Math.abs(u0 - head);
              const near = Math.max(0, 1 - Math.min(d, 1 - d) / 0.14);
              ctx.strokeStyle = `rgba(${FLOW},${0.1 + 0.62 * near})`;
              ctx.lineWidth = 1 + near * 0.8;
              ctx.beginPath();
              ctx.moveTo(s0.x, s0.y);
              ctx.lineTo(s1.x, s1.y);
              ctx.stroke();
            }
          });

          // A ring that thickens with load and fills near capacity: shape
          // carries the state, so colour is not doing the work alone.
          SITES.forEach((site) => {
            if (!nearSide(centre, site)) return;
            const s = project(site);
            const hot = site.load > 0.8;
            const r = 3.5 + site.load * 4.5;
            ctx.strokeStyle = hot
              ? `rgba(${PRESSURE},0.85)`
              : `rgba(${INK},${0.3 + site.load * 0.35})`;
            ctx.lineWidth = 1 + site.load * 1.6;
            ctx.beginPath();
            ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
            ctx.stroke();
            if (hot) {
              ctx.fillStyle = `rgba(${PRESSURE},0.16)`;
              ctx.fill();
            }
          });
        } catch {
          /* a camera not ready yet costs one frame, not the animation */
        }
      }

      drawIntro(ctx, w, h, reduce ? 99 : time);
    };

    resize();
    ro = new ResizeObserver(resize);
    ro.observe(host);
    raf = requestAnimationFrame(frame);

    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (disposed) return;
      mapboxgl.accessToken = TOKEN;
      const m = new mapboxgl.Map({
        container: host,
        style: STYLE,
        projection: { name: "globe" },
        center: [-30, 26],
        zoom: 1.55,
        interactive: false,
        attributionControl: false,
      });
      map = m;

      const reveal = () => {
        if (disposed) return;
        host.style.opacity = "0.34";
        try {
          m.setFog({
            color: "rgb(255,255,255)",
            "high-color": "rgb(240,242,245)",
            "horizon-blend": 0.03,
            "space-color": "rgb(255,255,255)",
            "star-intensity": 0,
          });
        } catch {
          /* the globe is fine without atmosphere */
        }
      };
      m.once("style.load", reveal);
      // Belt and braces: on a warm reload the style can be in before the
      // listener is, and `isStyleLoaded` has been known to lag the event.
      if (m.isStyleLoaded()) reveal();
      m.once("idle", reveal);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      map?.remove();
      map = null;
    };
  }, []);

  return (
    <div className={className}>
      {/* Sized with h-full rather than inset-0: Mapbox writes position:relative
          onto its container at init, which cancels the inset and collapses the
          element to zero height — a failure nothing in a build would show. */}
      <div
        ref={hostRef}
        className="h-full w-full transition-opacity duration-1000"
        style={{ opacity: 0 }}
        aria-hidden
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
    </div>
  );
}

/**
 * Two rings converge into the mark, then settle to a watermark.
 *
 * The end state is the logo's own geometry rather than something that resembles
 * it: equal radii, centres apart by two thirds of one, stroke a third of it.
 * They start a screen apart and ease in, which is why the sequence reads as two
 * things becoming one rather than as a shape appearing.
 */
function drawIntro(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
) {
  const { converge, hold, fade } = INTRO;
  const total = converge + hold + fade;
  if (time > total + 0.01) {
    paintRings(ctx, w, h, 1, 0.07);
    return;
  }

  let p: number;
  let alpha: number;
  if (time < converge) {
    const u = time / converge;
    // Ease out cubic: fast approach, soft landing on the logo.
    p = 1 - Math.pow(1 - u, 3);
    alpha = 0.1 + 0.62 * u;
  } else if (time < converge + hold) {
    p = 1;
    alpha = 0.72;
  } else {
    p = 1;
    const u = (time - converge - hold) / fade;
    alpha = 0.72 + (0.07 - 0.72) * u;
  }
  paintRings(ctx, w, h, p, alpha);
}

function paintRings(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: number,
  alpha: number,
) {
  const r = Math.min(w, h) * 0.19;
  // Apart at p=0, at the logo's separation at p=1.
  const spread = r * (2.6 - (2.6 - LOGO_GAP) * p);
  const cx = w / 2;
  const cy = h / 2;

  ctx.lineWidth = r * LOGO_STROKE;
  ctx.strokeStyle = `rgba(${INK},${alpha})`;
  ctx.beginPath();
  ctx.arc(cx - spread / 2, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${INK},${alpha * 0.73})`;
  ctx.beginPath();
  ctx.arc(cx + spread / 2, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}
