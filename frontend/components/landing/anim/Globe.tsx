"use client";

import { SCENE, useCanvasScene } from "./useCanvasScene";

/**
 * A rotating wireframe globe with transfers arcing between sites.
 *
 * The argument it carries is the one the engine actually supports: the
 * mechanics are arithmetic over capacity, occupancy and travel time, and none
 * of them knows the name of a city or a disease. A network in one hemisphere is
 * the same problem as a network in another, which is why the graphic is a globe
 * and not a map of one region.
 *
 * Canvas 2D with hand-rolled spherical projection — a sphere, a graticule and
 * great-circle arcs are about eighty lines of trigonometry, where a 3D library
 * would be a few hundred kilobytes to draw the same thing.
 */

interface Site {
  lat: number;
  lon: number;
}

/** Where health networks with published operational data actually are. */
const SITES: Site[] = [
  { lat: 45.5, lon: -73.57 }, // Montréal
  { lat: 46.81, lon: -71.21 }, // Québec
  { lat: 43.65, lon: -79.38 }, // Toronto
  { lat: 49.28, lon: -123.12 }, // Vancouver
  { lat: 40.71, lon: -74.0 }, // New York
  { lat: 51.5, lon: -0.12 }, // London
  { lat: 48.85, lon: 2.35 }, // Paris
  { lat: 52.52, lon: 13.4 }, // Berlin
  { lat: 59.33, lon: 18.06 }, // Stockholm
  { lat: -33.86, lon: 151.2 }, // Sydney
  { lat: 35.68, lon: 139.69 }, // Tokyo
  { lat: 1.35, lon: 103.82 }, // Singapore
  { lat: -23.55, lon: -46.63 }, // São Paulo
  { lat: -26.2, lon: 28.04 }, // Johannesburg
  { lat: 19.43, lon: -99.13 }, // Mexico City
];

/** Pairs that carry a transfer arc. Fixed, so the picture is stable. */
const ROUTES: [number, number][] = [
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

type V3 = { x: number; y: number; z: number };

function toVec(lat: number, lon: number): V3 {
  const p = (lat * Math.PI) / 180;
  const l = (lon * Math.PI) / 180;
  return { x: Math.cos(p) * Math.cos(l), y: Math.sin(p), z: Math.cos(p) * Math.sin(l) };
}

function rotateY(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Tilt so the northern hemisphere reads as up rather than edge-on. */
function tiltX(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

/** Great-circle interpolation, so an arc follows the sphere. */
function slerp(a: V3, b: V3, t: number): V3 {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a;
  const s = Math.sin(omega);
  const k1 = Math.sin((1 - t) * omega) / s;
  const k2 = Math.sin(t * omega) / s;
  return { x: a.x * k1 + b.x * k2, y: a.y * k1 + b.y * k2, z: a.z * k1 + b.z * k2 };
}

export default function Globe({ className }: { className?: string }) {
  const ref = useCanvasScene(({ ctx, width, height, time }) => {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.42;
    const spin = time * 0.16;
    const tilt = -0.38;

    const project = (v: V3) => {
      const r = tiltX(rotateY(v, spin), tilt);
      return { x: cx + r.x * radius, y: cy - r.y * radius, front: r.z > 0 };
    };

    // Limb
    ctx.strokeStyle = SCENE.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Graticule. Back-facing segments are drawn fainter rather than culled, so
    // the sphere reads as transparent glass instead of a flat disc.
    const line = (pts: V3[]) => {
      let pen = false;
      let lastFront = false;
      for (const v of pts) {
        const p = project(v);
        if (!pen || p.front !== lastFront) {
          if (pen) ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = p.front ? "rgba(29,29,31,0.16)" : "rgba(29,29,31,0.055)";
          ctx.moveTo(p.x, p.y);
          pen = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
        lastFront = p.front;
      }
      if (pen) ctx.stroke();
    };

    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: V3[] = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push(toVec(lat, lon));
      line(pts);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: V3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(toVec(lat, lon));
      line(pts);
    }

    const vecs = SITES.map((s) => toVec(s.lat, s.lon));

    // Transfer arcs, lifted off the surface so they read as movement between
    // sites rather than as another graticule line.
    ROUTES.forEach(([ai, bi], i) => {
      const a = vecs[ai]!;
      const b = vecs[bi]!;
      const cycle = 4.5;
      const head = ((time * 0.55 + i * 0.37) % 1 + 1) % 1;
      void cycle;

      ctx.lineWidth = 1.2;
      for (let seg = 0; seg < 40; seg++) {
        const t0 = seg / 40;
        const t1 = (seg + 1) / 40;
        const lift = (k: number) => 1 + 0.13 * Math.sin(Math.PI * k);
        const m0 = slerp(a, b, t0);
        const m1 = slerp(a, b, t1);
        const p0 = project({ x: m0.x * lift(t0), y: m0.y * lift(t0), z: m0.z * lift(t0) });
        const p1 = project({ x: m1.x * lift(t1), y: m1.y * lift(t1), z: m1.z * lift(t1) });
        if (!p0.front && !p1.front) continue;

        // A travelling bright head on a dim track.
        const d = Math.abs(t0 - head);
        const near = Math.max(0, 1 - Math.min(d, 1 - d) / 0.16);
        ctx.strokeStyle = `rgba(45,114,210,${0.1 + 0.7 * near})`;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    });

    // Sites
    vecs.forEach((v, i) => {
      const p = project(v);
      if (!p.front) return;
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.6 + i);
      ctx.strokeStyle = `rgba(45,114,210,${0.14 + 0.16 * pulse})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + pulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(45,114,210,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  return <canvas ref={ref} className={className} aria-hidden />;
}
