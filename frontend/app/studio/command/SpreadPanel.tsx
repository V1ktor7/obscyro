"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { runSpread, type SpreadResult } from "@/lib/platform-api";

import { leaders, paintFor, type Measure } from "./spread-map";
import { waveFrames } from "./spread-map";

/**
 * Seed a spreading process, watch it cross the map, and act on it mid-wave.
 *
 * The panel deliberately declares nothing about what is spreading. It reads the
 * states and couplings back from the twin and offers those, so the same screen
 * runs a virus, a cyber incident travelling a network of institutions, or a
 * heatwave — the vocabulary comes from the ontology and the arithmetic comes
 * from the engine, and neither is written here.
 *
 * Intervening needs no pause button, and that is worth stating because the
 * obvious design is one. The engine is deterministic, so "stop at day 42 and
 * close the schools" and "run from zero with the schools closed from day 42"
 * produce the same trajectory — the second is a rerun rather than a resumed
 * checkpoint, and it costs one call.
 */

interface Props {
  env: string | null;
  twinScenarioId: string | null;
  /**
   * The frame to paint, shape id → 0..1, or null when nothing is loaded.
   *
   * Handed up rather than drawn here: the map belongs to the view and two
   * components painting the same layer is how a frame ends up showing one
   * step's colour under another step's label.
   */
  onWave: (intensity: Map<string, number> | null) => void;
  /** Instance ids the map has a polygon for, to report the ones it does not. */
  shapeIds: ReadonlySet<string>;
}

interface Change {
  key: string;
  layer: string;
  factor: string;
  fromStep: string;
  toStep: string;
}

export default function SpreadPanel({ env, twinScenarioId, onWave, shapeIds }: Props) {
  const [declared, setDeclared] = useState<SpreadResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [run, setRun] = useState<SpreadResult | null>(null);
  const [busy, setBusy] = useState<null | "probe" | "run">(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [seedPop, setSeedPop] = useState("");
  const [seedState, setSeedState] = useState("");
  const [seedCount, setSeedCount] = useState("10");
  const [seeds, setSeeds] = useState<Record<string, Record<string, number>>>({});
  const [horizon, setHorizon] = useState("91");
  const [changes, setChanges] = useState<Change[]>([]);
  const [measure, setMeasure] = useState<Measure>({ kind: "incidence" });
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saveAs, setSaveAs] = useState("");

  // What the twin declared, read before anything can be filled in. A state
  // misspelled by one letter seeds nothing and the run comes back empty, so the
  // vocabulary is offered rather than typed.
  useEffect(() => {
    if (!env) return;
    let live = true;
    setBusy("probe");
    runSpread(env, { seeds: {}, probe: true, twinScenarioId: twinScenarioId ?? undefined })
      .then((out) => {
        if (!live) return;
        setDeclared(out);
        setSeedPop((p) => p || out.populations[0]?.id || "");
        setSeedState((s) => s || out.vocabulary.states[0] || "");
        setProbeError(null);
      })
      .catch((err: Error) => live && setProbeError(err.message))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [env, twinScenarioId]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const nameOf = useMemo(() => {
    const m = new Map((declared?.populations ?? []).map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) || id;
  }, [declared]);

  const wave = useMemo(
    () => (run ? waveFrames(run.states, measure) : null),
    [run, measure],
  );

  const frame = wave?.frames[Math.min(step, wave.frames.length - 1)] ?? null;
  const painted = useMemo(
    () => (frame ? paintFor(frame, shapeIds) : null),
    [frame, shapeIds],
  );

  // The map is painted from here as a side effect rather than by returning
  // features, because the layer outlives this panel: closing the tab should not
  // wipe a wave the reader is still looking at, but unmounting should.
  useEffect(() => {
    onWave(painted?.byShape ?? null);
  }, [painted, onWave]);
  useEffect(() => () => onWave(null), [onWave]);

  useEffect(() => {
    if (!playing || !wave) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s + 1 >= wave.frames.length) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [playing, wave]);

  const seedTotal = Object.values(seeds).reduce(
    (n, byState) => n + Object.values(byState).reduce((a, b) => a + b, 0),
    0,
  );

  const addSeed = () => {
    const n = Number(seedCount);
    if (!seedPop || !seedState || !Number.isFinite(n) || n <= 0) return;
    setSeeds((prev) => ({
      ...prev,
      [seedPop]: { ...(prev[seedPop] ?? {}), [seedState]: n },
    }));
  };

  const go = useCallback(async () => {
    if (!env || busy || seedTotal <= 0) return;
    setBusy("run");
    setError(null);
    setPlaying(false);
    try {
      const out = await runSpread(env, {
        seeds,
        horizon: Math.max(1, Number(horizon) || 91),
        changes: changes
          .filter((c) => c.layer && Number.isFinite(Number(c.factor)))
          .map((c) => ({
            layer: c.layer,
            factor: Number(c.factor),
            fromStep: Number(c.fromStep) || 0,
            toStep: c.toStep.trim() === "" ? null : Number(c.toStep),
          })),
        saveAs: saveAs.trim() || undefined,
        twinScenarioId: twinScenarioId ?? undefined,
      });
      setRun(out);
      setStep(0);
    } catch (err) {
      setError((err as Error).message);
      setRun(null);
    } finally {
      setBusy(null);
    }
  }, [env, busy, seeds, seedTotal, horizon, changes, saveAs, twinScenarioId]);

  if (probeError) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[11px] leading-snug text-ink-body">
          This twin describes no spreading process yet.
        </p>
        <p className="text-[10px] leading-snug text-ink-faint">{probeError}</p>
      </div>
    );
  }

  if (!declared) {
    return (
      <p className="p-3 text-[11px] text-ink-faint">
        {busy === "probe" ? "Reading what the twin declared…" : "Nothing declared."}
      </p>
    );
  }

  const states = declared.vocabulary.states;
  const couplings = declared.vocabulary.couplings;
  const top = frame && wave ? leaders(frame, wave.values[step] ?? new Map(), nameOf) : [];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">Where it starts</span>
        <p className="text-[10px] leading-snug text-ink-faint">
          Nothing is seeded for you — a wave starts where you say it started, and choosing
          that here would be the engine deciding the outbreak began in the biggest
          territory.
        </p>
        <div className="flex gap-1">
          <select
            value={seedPop}
            onChange={(e) => setSeedPop(e.target.value)}
            className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink"
          >
            {declared.populations.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={seedState}
            onChange={(e) => setSeedState(e.target.value)}
            className="w-24 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink"
          >
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={seedCount}
            onChange={(e) => setSeedCount(e.target.value)}
            inputMode="numeric"
            className="w-14 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] tabular-nums text-ink"
          />
          <button
            type="button"
            onClick={addSeed}
            className="rounded border border-line px-2 text-[11px] text-ink-body hover:border-ink-ghost"
          >
            Add
          </button>
        </div>
        {Object.entries(seeds).map(([pop, byState]) => (
          <div key={pop} className="flex items-baseline gap-2 text-[10px] text-ink-faint">
            <span className="flex-1 truncate">{nameOf(pop)}</span>
            <span className="tabular-nums">
              {Object.entries(byState)
                .map(([s, n]) => `${n} ${s}`)
                .join(", ")}
            </span>
            <button
              type="button"
              onClick={() =>
                setSeeds((prev) => {
                  const next = { ...prev };
                  delete next[pop];
                  return next;
                })
              }
              className="text-ink-ghost hover:text-danger"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">Measures</span>
        {couplings.length === 0 ? (
          <p className="text-[10px] leading-snug text-ink-faint">
            No transition travels a named coupling, so there is no layer a measure could
            reach. Bind a property to <code>couples_along</code> to make one.
          </p>
        ) : (
          <>
            <p className="text-[10px] leading-snug text-ink-faint">
              Closing a school is a factor of zero on the layer the school is. The
              counterfactual is built rather than estimated — which is why this answers a
              question fitting a curve could not: the closure and the holidays fell on the
              same day, and no method separates two things that only ever happened together.
            </p>
            {changes.map((c, i) => (
              <div key={c.key} className="flex gap-1">
                <select
                  value={c.layer}
                  onChange={(e) =>
                    setChanges((prev) =>
                      prev.map((x, j) => (i === j ? { ...x, layer: e.target.value } : x)),
                    )
                  }
                  className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink"
                >
                  {couplings.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  value={c.factor}
                  onChange={(e) =>
                    setChanges((prev) =>
                      prev.map((x, j) => (i === j ? { ...x, factor: e.target.value } : x)),
                    )
                  }
                  title="×0 removes the layer, ×0.5 halves it, ×1 changes nothing"
                  className="w-12 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] tabular-nums text-ink"
                />
                <input
                  value={c.fromStep}
                  onChange={(e) =>
                    setChanges((prev) =>
                      prev.map((x, j) => (i === j ? { ...x, fromStep: e.target.value } : x)),
                    )
                  }
                  title="From which step"
                  className="w-12 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] tabular-nums text-ink"
                />
                <input
                  value={c.toStep}
                  onChange={(e) =>
                    setChanges((prev) =>
                      prev.map((x, j) => (i === j ? { ...x, toStep: e.target.value } : x)),
                    )
                  }
                  placeholder="end"
                  title="Until which step. Empty runs to the end."
                  className="w-12 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] tabular-nums text-ink"
                />
                <button
                  type="button"
                  onClick={() => setChanges((prev) => prev.filter((_, j) => j !== i))}
                  className="text-[11px] text-ink-ghost hover:text-danger"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setChanges((prev) => [
                  ...prev,
                  {
                    key: `c${Date.now()}`,
                    layer: couplings[0] ?? "",
                    factor: "0",
                    fromStep: String(step),
                    toStep: "",
                  },
                ])
              }
              className="self-start rounded border border-dashed border-line px-2 py-1 text-[11px] text-ink-body hover:border-ink-ghost"
            >
              Add a measure {run ? `from step ${step}` : ""}
            </button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <div className="flex items-center gap-1">
          <label className="text-[10px] uppercase tracking-wide text-ink-faint">Steps</label>
          <input
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
            inputMode="numeric"
            className="w-14 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] tabular-nums text-ink"
          />
          <input
            value={saveAs}
            onChange={(e) => setSaveAs(e.target.value)}
            placeholder="keep as an event…"
            title="Saved, the run becomes an event the replay and the ranking can use."
            className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink"
          />
        </div>
        <button
          type="button"
          onClick={() => void go()}
          disabled={!!busy || seedTotal <= 0}
          className="rounded border border-line px-2 py-1 text-[11px] text-ink-body hover:border-ink-ghost disabled:text-ink-ghost"
        >
          {busy === "run" ? `Running… ${elapsed}s` : seedTotal > 0 ? "Run the spread" : "Seed it first"}
        </button>
        {error ? <p className="text-[10px] leading-snug text-danger">{error}</p> : null}
      </div>

      {run && wave ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-body hover:border-ink-ghost"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <span className="text-[11px] tabular-nums text-ink-faint">
              step {step} / {wave.frames.length - 1}
            </span>
            <select
              value={measure.kind === "incidence" ? "incidence" : `state:${measure.name}`}
              onChange={(e) => {
                const v = e.target.value;
                setMeasure(
                  v === "incidence" ? { kind: "incidence" } : { kind: "state", name: v.slice(6) },
                );
              }}
              className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink"
            >
              <option value="incidence">new demand</option>
              {states.map((s) => (
                <option key={s} value={`state:${s}`}>
                  in {s}
                </option>
              ))}
            </select>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, wave.frames.length - 1)}
            value={step}
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
            className="w-full"
          />

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-ink-faint">
              Worst here, at this step
            </span>
            {top.length === 0 ? (
              <p className="text-[10px] text-ink-faint">Nothing anywhere yet.</p>
            ) : (
              top.map((t) => (
                <div key={t.id} className="flex items-baseline gap-2 text-[10.5px]">
                  <span className="flex-1 truncate text-ink-body">{t.name}</span>
                  <span className="tabular-nums text-ink-faint">
                    {t.value >= 10 ? Math.round(t.value).toLocaleString("en-CA") : t.value.toFixed(1)}
                  </span>
                </div>
              ))
            )}
            <span className="text-[10px] tabular-nums text-ink-faint">
              deepest colour = {Math.round(wave.peak).toLocaleString("en-CA")}, the run&rsquo;s peak
            </span>
          </div>

          {run.saved ? (
            <p className="text-[10px] leading-snug text-ok">
              Kept as “{run.saved.name}”. It is an event now, so the replay and the ranking
              can run responses against it.
            </p>
          ) : null}

          {painted && painted.unmatched.length > 0 ? (
            <p className="text-[10px] leading-snug text-warn">
              {painted.unmatched.length} catchment(s) have no boundary on this map, so the
              wave in them is running and not drawn.
            </p>
          ) : null}

          {run.gaps.map((g) => (
            <p key={g.code} className={cn("text-[10px] leading-snug", "text-warn")}>
              {g.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
