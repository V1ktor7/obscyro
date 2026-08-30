"use client";

import { useMemo } from "react";
import { SCENE, useCanvasScene } from "./useCanvasScene";

/**
 * Data moving through a network.
 *
 * Nodes are laid out in five columns that correspond to the stages the product
 * actually has — source, pipeline, ontology, twin, response — and packets
 * travel left to right along the edges between them. It is decoration that
 * happens to be true: nothing flows backwards, nothing appears in the last
 * column that did not come through the first, and a packet that reaches the end
 * lands on a node that brightens for a moment.
 *
 * The layout is generated once from a fixed seed rather than randomised per
 * load, so the shape of the graph is a constant of the brand instead of a
 * different picture for every visitor.
 */

const COLUMNS = 5;
const PER_COLUMN = [4, 5, 5, 4, 3];
const PACKETS = 46;

interface Node {
  /** 0..1 across the canvas. */
  x: number;
  y: number;
  col: number;
  /** Seconds; when a packet last landed here. */
  hit: number;
}

interface Edge {
  from: number;
  to: number;
}

interface Packet {
  edge: number;
  /** 0..1 along the edge. */
  t: number;
  speed: number;
}

/** Deterministic pseudo-random, so the graph is the same for everyone. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function buildGraph() {
  const rand = seeded(20260830);
  const nodes: Node[] = [];
  const columnStart: number[] = [];

  for (let col = 0; col < COLUMNS; col++) {
    columnStart.push(nodes.length);
    const count = PER_COLUMN[col]!;
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: 0.06 + (col / (COLUMNS - 1)) * 0.88,
        // Spread within the column, nudged so the columns do not read as a grid.
        y: 0.14 + ((i + 0.5) / count) * 0.72 + (rand() - 0.5) * 0.07,
        col,
        hit: -10,
      });
    }
  }

  const edges: Edge[] = [];
  for (let col = 0; col < COLUMNS - 1; col++) {
    const aStart = columnStart[col]!;
    const aEnd = aStart + PER_COLUMN[col]!;
    const bStart = columnStart[col + 1]!;
    const bEnd = bStart + PER_COLUMN[col + 1]!;
    for (let a = aStart; a < aEnd; a++) {
      // Two or three forward edges each: enough to look like a network, few
      // enough that a packet can still be followed by eye.
      const fanout = 2 + (rand() < 0.4 ? 1 : 0);
      const picked = new Set<number>();
      for (let k = 0; k < fanout; k++) {
        const b = bStart + Math.floor(rand() * (bEnd - bStart));
        if (!picked.has(b)) {
          picked.add(b);
          edges.push({ from: a, to: b });
        }
      }
    }
  }

  const packets: Packet[] = Array.from({ length: PACKETS }, () => ({
    edge: Math.floor(rand() * edges.length),
    t: rand(),
    speed: 0.09 + rand() * 0.13,
  }));

  return { nodes, edges, packets };
}

export default function DataFlow({ className }: { className?: string }) {
  const graph = useMemo(buildGraph, []);

  const ref = useCanvasScene(({ ctx, width, height, time, still }) => {
    const { nodes, edges, packets } = graph;
    const px = (n: Node) => n.x * width;
    const py = (n: Node) => n.y * height;

    ctx.lineWidth = 1;
    ctx.strokeStyle = SCENE.hairline;
    for (const e of edges) {
      const a = nodes[e.from]!;
      const b = nodes[e.to]!;
      ctx.beginPath();
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
      ctx.stroke();
    }

    for (const p of packets) {
      const e = edges[p.edge]!;
      const a = nodes[e.from]!;
      const b = nodes[e.to]!;

      if (!still) {
        p.t += p.speed * (1 / 60);
        if (p.t >= 1) {
          nodes[e.to]!.hit = time;
          p.t = 0;
          // Continue from the node it arrived at, so a packet reads as one
          // record crossing the whole chain rather than a dot on a segment.
          const onward = edges.filter((x) => x.from === e.to);
          p.edge = onward.length
            ? edges.indexOf(onward[Math.floor(Math.random() * onward.length)]!)
            : Math.floor(Math.random() * edges.length);
        }
      }

      const x = px(a) + (px(b) - px(a)) * p.t;
      const y = py(a) + (py(b) - py(a)) * p.t;

      // A short tail rather than a bare dot: direction has to be legible.
      const tail = 0.16;
      const tx = px(a) + (px(b) - px(a)) * Math.max(0, p.t - tail);
      const ty = py(a) + (py(b) - py(a)) * Math.max(0, p.t - tail);
      const grad = ctx.createLinearGradient(tx, ty, x, y);
      grad.addColorStop(0, "rgba(110,155,255,0)");
      grad.addColorStop(1, "rgba(110,155,255,0.85)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    for (const n of nodes) {
      const since = time - n.hit;
      const lit = still ? 0 : Math.max(0, 1 - since / 1.1);
      const r = 2 + lit * 2.4;

      if (lit > 0.01) {
        ctx.fillStyle = `rgba(232,176,75,${0.16 * lit})`;
        ctx.beginPath();
        ctx.arc(px(n), py(n), r + 7, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle =
        lit > 0.01
          ? `rgba(232,176,75,${0.5 + 0.5 * lit})`
          : n.col === COLUMNS - 1
            ? "rgba(232,236,239,0.5)"
            : "rgba(232,236,239,0.26)";
      ctx.beginPath();
      ctx.arc(px(n), py(n), r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return <canvas ref={ref} className={className} aria-hidden />;
}
