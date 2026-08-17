"use client";

/**
 * The event's effects on one shared time axis.
 *
 * Windows were two number fields. Writing `start: 3, end: 20` is blind: you
 * cannot see that two effects overlap, that one starts after the run ends, or
 * that a "ramp" and a "step" over the same window are different things. All
 * three are visible here at a glance and none of them were before.
 *
 * Dragging writes the same fields the form does — there is one source of truth
 * and the drag is a second way to reach it, not a parallel model.
 *
 * Keyboard reaches everything the pointer does. That is not politeness: a
 * timeline is the sort of control that quietly becomes the only way to perform
 * an action, and then the feature does not exist for anyone who cannot use a
 * mouse. Arrow keys move the focused bar, shift+arrows move its end.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { SimEffect, SimTarget, TemporalProfile } from "@/lib/platform-api";
import {
  applyDrag,
  effectiveEnd,
  overlapWindow,
  shapePoints,
  stepAt,
  trackOf,
  type DragEdge,
} from "./timeline-geometry";

export interface EventTimelineProps {
  effects: SimEffect[];
  targets: SimTarget[];
  horizon: number;
  /** Index of the effect being edited, or null. */
  focused: number | null;
  onFocus: (index: number | null) => void;
  onChangeProfile: (index: number, profile: TemporalProfile) => void;
}

interface DragState {
  index: number;
  edge: DragEdge;
}

export default function EventTimeline({
  effects,
  targets,
  horizon,
  focused,
  onFocus,
  onChangeProfile,
}: EventTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const labelOf = useCallback(
    (path: string) => targets.find((t) => t.path === path)?.label ?? path,
    [targets],
  );

  /**
   * Pointer handling lives on the window, not the bar.
   *
   * A drag that stops tracking the moment the pointer leaves the element is the
   * classic timeline bug: the bar sticks to wherever the cursor happened to
   * exit, and the value written is not the one the user released on.
   */
  useEffect(() => {
    if (!drag) return;
    function move(e: PointerEvent) {
      const track = trackRef.current;
      if (!track || !drag) return;
      const rect = track.getBoundingClientRect();
      const step = stepAt(e.clientX - rect.left, rect.width, horizon);
      const effect = effects[drag.index];
      if (!effect) return;
      onChangeProfile(drag.index, applyDrag(effect.profile, drag.edge, step, horizon));
    }
    function up() {
      setDrag(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, effects, horizon, onChangeProfile]);

  function onKey(e: React.KeyboardEvent, index: number) {
    const effect = effects[index];
    if (!effect) return;
    const step = e.shiftKey ? 5 : 1;
    const edge: DragEdge = e.altKey ? "end" : "body";
    const p = effect.profile;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -step : step;
      const anchor = edge === "end" ? effectiveEnd(p, horizon) : p.start;
      onChangeProfile(index, applyDrag(p, edge, anchor + delta, horizon));
    }
  }

  const ticks = tickMarks(horizon);

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium text-ink">When each effect bites</h2>
        <p className="text-[11px] text-ink-faint">
          Drag an edge to change a step. Arrow keys move a focused bar; hold Alt
          for its end.
        </p>
      </div>

      {effects.length === 0 ? (
        <p className="text-[11px] text-ink-faint">
          No effects yet — add one below and it appears here.
        </p>
      ) : (
        <>
          <div ref={trackRef} className="relative">
            {effects.map((effect, i) => {
              const track = trackOf(effect.profile, horizon);
              const isFocused = focused === i;
              const clashes = overlapsWith(effects, i, horizon);
              return (
                <div key={i} className="relative mb-1.5 h-8">
                  <div className="absolute inset-0 rounded bg-canvas" />
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={barLabel(effect, labelOf(effect.target), horizon, clashes)}
                    aria-current={isFocused ? "true" : undefined}
                    onFocus={() => onFocus(i)}
                    onKeyDown={(e) => onKey(e, i)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onFocus(i);
                      setDrag({ index: i, edge: "body" });
                    }}
                    data-testid={`bar-${i}`}
                    className={`absolute top-0 h-8 cursor-grab rounded border ${
                      isFocused
                        ? "border-brand bg-brand-soft"
                        : "border-line bg-white hover:border-brand"
                    } focus:outline-none focus:ring-2 focus:ring-brand`}
                    style={{
                      left: `${track.left * 100}%`,
                      width: `${track.width * 100}%`,
                    }}
                  >
                    <Curve profile={effect.profile} />
                    <span className="pointer-events-none absolute left-1.5 top-1 truncate text-[10px] text-ink">
                      {effect.id}
                    </span>
                    {clashes.length > 0 ? (
                      // Hatching, not colour: the composition rule is the thing
                      // people ask about once overlaps become visible, and
                      // colour alone would exclude anyone who cannot see it.
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded opacity-40"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 6px)",
                        }}
                      />
                    ) : null}
                    <Handle side="left" onGrab={() => setDrag({ index: i, edge: "start" })} />
                    <Handle side="right" onGrab={() => setDrag({ index: i, edge: "end" })} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
            {ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          {/* The list equivalent. Every bar above is reachable and readable
              here, so nothing is available only by pointing at a picture. */}
          <ul className="sr-only">
            {effects.map((effect, i) => (
              <li key={i}>
                {barLabel(effect, labelOf(effect.target), horizon, overlapsWith(effects, i, horizon))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Handle({ side, onGrab }: { side: "left" | "right"; onGrab: () => void }) {
  return (
    <span
      aria-hidden
      data-testid={`handle-${side}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onGrab();
      }}
      className={`absolute top-0 h-8 w-2 cursor-col-resize ${
        side === "left" ? "left-0" : "right-0"
      }`}
    />
  );
}

function Curve({ profile }: { profile: TemporalProfile }) {
  const points = shapePoints(profile.shape, profile.peak);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${(1 - p.y) * 100}`)
    .join(" ");
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full text-brand"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Other effects on the same quantity whose window this one shares. */
function overlapsWith(effects: SimEffect[], index: number, horizon: number): string[] {
  const self = effects[index];
  if (!self) return [];
  const out: string[] = [];
  for (let j = 0; j < effects.length; j += 1) {
    if (j === index) continue;
    const other = effects[j]!;
    if (other.target !== self.target) continue;
    if (overlapWindow(self.profile, other.profile, horizon)) out.push(other.id);
  }
  return out;
}

/**
 * What a screen reader says, and what the hatching means.
 *
 * Spelled out rather than left to the visual: "overlaps with staff-sickness"
 * is the sentence someone needs, and it is also the one a sighted user wants
 * on hover.
 */
function barLabel(
  effect: SimEffect,
  targetLabel: string,
  horizon: number,
  clashes: string[],
): string {
  const end = effect.profile.end === null ? "the end of the run" : `step ${effect.profile.end}`;
  const base =
    `${effect.id}: ${targetLabel}, ${effect.op} ${effect.value}, ` +
    `from step ${effect.profile.start} to ${end}, ${effect.profile.shape} shape`;
  if (clashes.length === 0) return `${base}. No overlap.`;
  return `${base}. Overlaps with ${clashes.join(", ")} on the same quantity.`;
}

function tickMarks(horizon: number): number[] {
  const count = 5;
  return Array.from({ length: count + 1 }, (_, i) => Math.round((horizon * i) / count));
}
