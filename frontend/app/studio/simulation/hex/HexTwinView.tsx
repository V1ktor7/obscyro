"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { fetchSimExport, listGeoShapes } from "@/lib/platform-api";

import { useStudio } from "../../StudioShell";
import {
  addScenarioOverride,
  createOverlayScenario,
  deleteScenarioOverride,
  listOverlayScenarios,
  listScenarioOverrides,
  updateOverlayScenario,
  type OverlayScenario,
} from "../../scenarios-api";
import { engineMessage, runScenario, type RunOutput } from "./engine";
import {
  buildHexGrid,
  cellsWithin,
  polygonsFromGeoJson,
  populationsOf,
  type GridPolygon,
  type HexGrid,
} from "./hex-grid";
import {
  describe as describeStamp,
  engineInput,
  HEAT_PER_THOUSAND,
  laneOf,
  measurePresets,
  stampFromOverride,
  stampToOverride,
  twinContext,
  weakestTier,
  type Lane,
  type Stamp,
  type StampBody,
  type TwinContext,
} from "./stamps";

// ---------------------------------------------------------------------------
// The Scenarios page: one map, three verbs.
//
// Pick a tool, move the timeline to a day, tap the map. Every stamp is one
// sentence in the recipe and one input the engine already reads; Run sends the
// stamps through the real engine twice, with and without the planner's choices,
// so what the choices did is built rather than inferred.
// ---------------------------------------------------------------------------

type Tool = "inspect" | "seed" | "heat" | "measure" | "capacity";
type LensKey = "occupancy" | "sick" | "residents";

const TOOLS: { key: Tool; label: string; lane: Lane | "Look"; hint: string }[] = [
  { key: "inspect", label: "Inspect", lane: "Look", hint: "Tap a cell to read it." },
  { key: "seed", label: "Seed outbreak", lane: "Events", hint: "Tap a cell: an outbreak starts in its catchment on the day shown on the timeline." },
  { key: "heat", label: "Heat wave", lane: "Events", hint: "Tap anywhere: a heat wave over every catchment, from the day shown." },
  { key: "measure", label: "Measure", lane: "Measures", hint: "Tap a cell: the measure applies around it, from the day shown." },
  { key: "capacity", label: "Add capacity", lane: "Resources", hint: "Tap near a site: it gains capacity from the day shown." },
];

const LANE_INK: Record<Lane | "Look", string> = {
  Look: "text-ink-muted",
  Events: "text-danger-ink",
  Measures: "text-scenario",
  Resources: "text-brand-deep",
};
const LANE_BG: Record<Lane, string> = { Events: "bg-danger-ink", Measures: "bg-scenario", Resources: "bg-brand" };

const OCC_STEPS: [number, string, string][] = [
  [0.9, "#dcefe5", "under 90 %"],
  [1.1, "#f6e4b8", "90–109 %"],
  [1.5, "#f2b867", "110–149 %"],
  [2, "#e07a3f", "150–199 %"],
  [Infinity, "#a82255", "200 % and over"],
];
const SICK_STEPS: [number, string, string][] = [
  [0.5, "#f2f5fa", "under 0.5"],
  [2, "#dce7f6", "0.5–2"],
  [5, "#b9cfee", "2–5"],
  [10, "#87ade0", "5–10"],
  [20, "#5585cc", "10–20"],
  [40, "#2d5fae", "20–40"],
  [Infinity, "#1b3f7a", "40 and over"],
];
const DENSITY_STEPS: [number, string, string][] = [
  [500, "#eef1f4", "under 500"],
  [2000, "#dde3ea", "500–2,000"],
  [5000, "#c5cfdb", "2,000–5,000"],
  [9000, "#a3b2c4", "5,000–9,000"],
  [Infinity, "#56677e", "9,000 and over"],
];
const NO_DATA = "#e5e8eb";

function ramp(v: number, steps: [number, string, string][]): string {
  if (!Number.isFinite(v)) return NO_DATA;
  for (const [limit, colour] of steps) if (v < limit) return colour;
  return steps[steps.length - 1]![1];
}

const pct = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)} %` : "—");
const fmt = (n: number) => Math.round(n).toLocaleString("en-CA");

const FIELD =
  "rounded border border-line bg-white px-2 py-1 text-[12px] text-ink focus:border-brand focus:outline-none";
const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-faint";

function nonce(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The facility whose own patients a cell sends: the nearest that provides the activity. */
function siteFor(grid: HexGrid, ctx: TwinContext, cell: number, activity: string): number {
  const h = grid.hexes[cell];
  if (!h) return -1;
  let best = -1;
  let bd = Infinity;
  ctx.facilities.forEach((f, i) => {
    if (!(f.capacity[activity] ?? 0)) return;
    const p = grid.project(f.lat, f.lon);
    const d = (p.x - h.x) ** 2 + (p.y - h.y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export default function HexTwinView() {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [ctx, setCtx] = useState<TwinContext | null>(null);
  const [polygons, setPolygons] = useState<GridPolygon[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [scenarios, setScenarios] = useState<OverlayScenario[]>([]);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("inspect");
  const [lens, setLens] = useState<LensKey>("occupancy");
  const [day, setDay] = useState(0);
  const [horizon, setHorizon] = useState(60);
  const [activity, setActivity] = useState<string>("");
  const [cell, setCell] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [seedCount, setSeedCount] = useState(100);
  const [heatDays, setHeatDays] = useState(4);
  const [presetKey, setPresetKey] = useState<string>("");
  const [scope, setScope] = useState<"catchment" | "5" | "everywhere">("5");
  const [measureDays, setMeasureDays] = useState(14);
  const [amount, setAmount] = useState(10);
  const [pickCatchment, setPickCatchment] = useState("");

  const [run, setRun] = useState<RunOutput | null>(null);
  const [runKey, setRunKey] = useState<string>("");
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- loading ------------------------------------------------------------

  const loadTwin = useCallback(async () => {
    if (!env) return;
    setLoading(true);
    setLoadError(null);
    try {
      const ex = await fetchSimExport(env);
      const c = twinContext(ex);
      setCtx(c);
      setActivity((a) => a || (c.activities.find((x) => /civi|stretch|urg|emerg/i.test(x)) ?? c.activities[0] ?? ""));
      // Catchment outlines are optional: without PostGIS, or without shapes,
      // cells are placed by their nearest site and the page says so.
      try {
        const { shapes } = await listGeoShapes(env);
        const ids = new Set(c.populations.map((p) => p.id));
        setPolygons(
          shapes
            .map((s) => ({ populationId: `pop:${s.instanceId}`, polygons: polygonsFromGeoJson(s.geometry) }))
            .filter((p) => ids.has(p.populationId) && p.polygons.length > 0),
        );
      } catch {
        setPolygons([]);
      }
    } catch (err) {
      setLoadError(engineMessage(err));
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, [env]);

  const loadScenarios = useCallback(async () => {
    if (!env) return;
    const { scenarios: list } = await listOverlayScenarios(env);
    setScenarios(list);
    setScenarioId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null));
  }, [env]);

  const loadStamps = useCallback(async (id: string | null) => {
    if (!id) {
      setStamps([]);
      return;
    }
    const { overrides } = await listScenarioOverrides(id);
    setStamps(
      overrides
        .map(stampFromOverride)
        .filter((s): s is Stamp => s !== null)
        .sort((a, b) => a.start - b.start),
    );
  }, []);

  useEffect(() => {
    setRun(null);
    void loadTwin();
    void loadScenarios().catch((err) => setMessage(engineMessage(err)));
  }, [loadTwin, loadScenarios]);

  useEffect(() => {
    setRun(null);
    setSelected(null);
    void loadStamps(scenarioId).catch((err) => setMessage(engineMessage(err)));
  }, [scenarioId, loadStamps]);

  // --- derived ------------------------------------------------------------

  const grid = useMemo(() => {
    if (!ctx) return null;
    return buildHexGrid(
      ctx.facilities.map((f) => ({ id: f.id, name: f.name, lat: f.lat, lon: f.lon })),
      ctx.populations,
      { polygons },
    );
  }, [ctx, polygons]);

  const presets = useMemo(() => (ctx ? measurePresets(ctx.couplings) : []), [ctx]);
  useEffect(() => {
    if (presets.length && !presets.some((p) => p.key === presetKey)) setPresetKey(presets[0]!.key);
  }, [presets, presetKey]);

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null;
  const stampKey = JSON.stringify([stamps.map((s) => [s.id, s.start, s.days]), horizon, activity]);
  const stale = run !== null && runKey !== stampKey;
  const d = Math.min(day, horizon - 1);

  const siteOfCell = useMemo(() => {
    if (!grid || !ctx) return [] as number[];
    return grid.hexes.map((h) => siteFor(grid, ctx, h.index, activity));
  }, [grid, ctx, activity]);

  const liveOccupancy = useMemo(
    () =>
      (ctx?.facilities ?? []).map((f) => {
        const cap = f.capacity[activity] ?? 0;
        return cap > 0 && activity in f.census ? (f.census[activity] ?? 0) / cap : Number.NaN;
      }),
    [ctx, activity],
  );

  const occupancyAt = useCallback(
    (site: number) => {
      if (site < 0) return Number.NaN;
      if (run && !stale) return run.full.occupancy[d]?.[site] ?? Number.NaN;
      return liveOccupancy[site] ?? Number.NaN;
    },
    [run, stale, d, liveOccupancy],
  );

  // --- writing stamps -----------------------------------------------------

  async function ensureScenario(): Promise<string | null> {
    if (!env) return null;
    if (scenarioId) return scenarioId;
    const created = await createOverlayScenario(env, {
      name: `Scenario ${new Date().toLocaleDateString("en-CA")}`,
    });
    await loadScenarios();
    setScenarioId(created.id);
    return created.id;
  }

  async function save(body: StampBody, start: number, days: number) {
    if (!ctx) return;
    setBusy(true);
    setMessage(null);
    try {
      const id = await ensureScenario();
      if (!id) return;
      const draft = { ...body, id: "draft", start, days } as Stamp;
      const saved = await addScenarioOverride(id, stampToOverride(draft, describeStamp(draft, ctx).title, nonce()));
      await loadStamps(id);
      setSelected(saved.id);
    } catch (err) {
      setMessage(engineMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function replace(old: Stamp, next: Stamp) {
    if (!scenarioId || !ctx) return;
    setBusy(true);
    setMessage(null);
    try {
      // Overrides are appended, never edited: the change is a new one in
      // place of the old, which keeps the scenario's history readable.
      const saved = await addScenarioOverride(
        scenarioId,
        stampToOverride(next, describeStamp(next, ctx).title, nonce()),
      );
      await deleteScenarioOverride(scenarioId, old.id);
      await loadStamps(scenarioId);
      setSelected(saved.id);
    } catch (err) {
      setMessage(engineMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Stamp) {
    if (!scenarioId) return;
    setBusy(true);
    try {
      await deleteScenarioOverride(scenarioId, s.id);
      await loadStamps(scenarioId);
      setSelected(null);
    } catch (err) {
      setMessage(engineMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function tap(index: number) {
    if (!grid || !ctx) return;
    const h = grid.hexes[index];
    if (!h) return;
    setCell(index);
    if (tool === "inspect" || busy) return;
    const at = { lat: h.lat, lon: h.lon };
    if (tool === "seed") {
      if (!h.population) return setMessage("This cell belongs to no catchment, so nobody there can be seeded.");
      void save({ kind: "seed", at, population: h.population, count: seedCount }, d, 1);
    }
    if (tool === "heat") {
      const acuity = ctx.acuities.find((a) => /urg|emerg/i.test(a)) ?? ctx.acuities[0];
      if (!acuity) return setMessage("The twin's model produces no severity, so heat has nothing to add to.");
      const start = Math.max(0, Math.min(d, horizon - heatDays));
      void save({ kind: "heat", acuity, perThousand: HEAT_PER_THOUSAND }, start, heatDays);
    }
    if (tool === "measure") {
      const preset = presets.find((p) => p.key === presetKey);
      if (!preset) return setMessage("The twin declares no contact layer a measure could act on.");
      const pops =
        scope === "everywhere"
          ? null
          : scope === "catchment"
            ? h.population
              ? [h.population]
              : []
            : populationsOf(grid, cellsWithin(grid, index, 5));
      if (pops && pops.length === 0) return setMessage("No catchment there for the measure to cover.");
      void save(
        {
          kind: "measure",
          label: preset.label,
          layers: preset.layers,
          at,
          radiusKm: scope === "5" ? 5 : null,
          populations: pops,
        },
        d,
        Math.max(1, Math.min(measureDays, horizon - d)),
      );
    }
    if (tool === "capacity") {
      const site = siteOfCell[index] ?? -1;
      const f = ctx.facilities[site];
      if (!f) return setMessage(`No site nearby provides ${activity}.`);
      void save({ kind: "capacity", facility: f.id, activity, amount }, d, Math.max(1, horizon - d));
    }
  }

  async function doRun() {
    if (!env || !ctx || !scenario) return;
    setRunning("Starting");
    setMessage(null);
    try {
      const out = await runScenario({
        env,
        scenario: { id: scenario.id, name: scenario.name },
        stamps,
        ctx,
        horizon,
        activity,
        onProgress: setRunning,
      });
      setRun(out);
      setRunKey(stampKey);
    } catch (err) {
      setMessage(engineMessage(err));
    } finally {
      setRunning(null);
    }
  }

  // --- empty states -------------------------------------------------------

  if (!hasKey || !env) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-ink-muted">Sign in and pick an environment to build a scenario.</p>
      </div>
    );
  }
  if (loading && !ctx) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 bg-canvas text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the twin…
      </div>
    );
  }
  if (loadError || !ctx || !grid) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas p-6">
        <div className="max-w-lg rounded-lg border border-line bg-white p-5 text-sm text-ink-body">
          <p className="font-semibold text-ink">The twin could not be read for the map.</p>
          <p className="mt-1">{loadError ?? "No export came back."}</p>
          <button type="button" onClick={() => void loadTwin()} className="mt-3 rounded border border-line px-3 py-1.5 text-[12px] hover:bg-canvas-raised">
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (grid.hexes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas p-6">
        <p className="max-w-lg text-sm text-ink-muted">
          No site in this twin has a location, so there is nothing to place on the map. Give sites a latitude and
          longitude, then come back.
        </p>
      </div>
    );
  }

  // --- the map ------------------------------------------------------------

  const W = 820;
  const scale = Math.min((W - 40) / grid.widthKm, 620 / grid.heightKm);
  const H = Math.round(grid.heightKm * scale + 40);
  const r = grid.radiusKm * scale;
  const corner = Array.from({ length: 6 }, (_, k) => {
    const a = ((60 * k - 30) * Math.PI) / 180;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
  const px = (x: number) => 20 + x * scale;
  const py = (y: number) => 20 + y * scale;
  const hexArea = 2.598 * grid.radiusKm ** 2;
  const sick = run && !stale ? run.full.sick : null;

  const fillFor = (i: number): string => {
    const h = grid.hexes[i]!;
    if (lens === "residents") return ramp(h.residents / hexArea, DENSITY_STEPS);
    if (lens === "sick") return sick && h.population ? ramp(sick[h.population]?.[d] ?? Number.NaN, SICK_STEPS) : NO_DATA;
    return ramp(occupancyAt(siteOfCell[i] ?? -1), OCC_STEPS);
  };
  const legend = lens === "residents" ? DENSITY_STEPS : lens === "sick" ? SICK_STEPS : OCC_STEPS;
  const shownSites = ctx.facilities
    .map((f, i) => ({ f, i, p: grid.project(f.lat, f.lon) }))
    .filter(({ f }) => (f.capacity[activity] ?? 0) > 0);
  const labelSites = shownSites.length <= 60;

  const areas = stamps.filter(
    (s): s is Stamp & { kind: "measure" } => s.kind === "measure" && s.at !== null && s.radiusKm !== null,
  );
  const seeds = stamps.filter((s): s is Stamp & { kind: "seed" } => s.kind === "seed");
  const islandNow = stamps.filter((s) => s.kind === "heat" && d >= s.start && d < s.start + s.days);

  const inspected = cell !== null ? grid.hexes[cell] : undefined;
  const inspectedSite = cell !== null ? (siteOfCell[cell] ?? -1) : -1;
  const popName = (id: string | null) => ctx.populations.find((p) => p.id === id)?.name ?? "no catchment";

  // --- the result ---------------------------------------------------------

  const peak = (xs: number[]) =>
    xs.reduce((b, v, t) => (Number.isFinite(v) && v > b.v ? { v, t } : b), { v: -Infinity, t: 0 });
  const pa = run ? peak(run.events.island) : null;
  const pb = run ? peak(run.full.island) : null;
  const hasChoices = stamps.some((s) => laneOf(s) !== "Events");
  const notes = run ? Array.from(new Set(run.events.notes.concat(run.full.notes))) : [];

  const chartTop = run
    ? Math.max(1.2, ...run.events.island.filter(Number.isFinite), ...run.full.island.filter(Number.isFinite)) * 1.05
    : 2;
  const CH = 150;
  const CW = 1000;
  const yOf = (v: number) => CH - (v / chartTop) * CH;
  const line = (xs: number[]) =>
    xs
      .map((v, t) => (Number.isFinite(v) ? `${((t + 0.5) / horizon) * CW},${yOf(v)}` : null))
      .filter(Boolean)
      .join(" ");

  const tier = weakestTier(stamps, ctx);
  const sorted = [...stamps].sort((a, b) => a.start - b.start);

  function payloadOf(s: Stamp): string {
    if (s.kind === "seed") return JSON.stringify({ seeds: { [s.population]: { [ctx!.infectious ?? "?"]: s.count } } }, null, 2);
    if (s.kind === "measure")
      return JSON.stringify(
        s.layers.map((l) => ({
          layer: l.layer,
          factor: l.factor,
          fromStep: s.start,
          toStep: s.start + s.days - 1,
          ...(s.populations ? { populations: s.populations } : {}),
        })),
        null,
        2,
      );
    return JSON.stringify(engineInput([s], ctx!, "full", horizon).effects[0] ?? {}, null, 2);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2">
        <span className={LABEL}>Scenario</span>
        {renaming !== null && scenario ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void updateOverlayScenario(scenario.id, { name: renaming.trim() || scenario.name })
                .then(loadScenarios)
                .finally(() => setRenaming(null));
            }}
          >
            <label htmlFor="scenario-name" className="sr-only">Scenario name</label>
            <input id="scenario-name" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} className={FIELD} />
            <button type="submit" className="rounded bg-brand px-2 py-1 text-[12px] font-medium text-white">Save</button>
          </form>
        ) : (
          <>
            <label htmlFor="scenario-pick" className="sr-only">Scenario</label>
            <select id="scenario-pick" value={scenarioId ?? ""} onChange={(e) => setScenarioId(e.target.value || null)} className={FIELD}>
              {scenarios.length === 0 ? <option value="">No scenario yet: stamping creates one</option> : null}
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {scenario ? (
              <button type="button" onClick={() => setRenaming(scenario.name)} className="rounded px-2 py-1 text-[12px] text-ink-muted hover:bg-canvas-raised">
                Rename
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void createOverlayScenario(env, { name: `Scenario ${scenarios.length + 1}` })
                  .then(async (s) => {
                    await loadScenarios();
                    setScenarioId(s.id);
                  })
                  .catch((err) => setMessage(engineMessage(err)))
              }
              className="rounded border border-line px-2 py-1 text-[12px] hover:bg-canvas-raised"
            >
              New scenario
            </button>
          </>
        )}
        <span className="rounded bg-scenario-soft px-2 py-0.5 text-[11px] font-semibold text-scenario">Scenario · not reality</span>
        <span className="ml-auto flex items-center gap-2">
          <label htmlFor="horizon" className={LABEL}>Days</label>
          <select id="horizon" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className={FIELD}>
            {[30, 60, 90].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <label htmlFor="activity" className={LABEL}>Capacity read</label>
          <select id="activity" value={activity} onChange={(e) => setActivity(e.target.value)} className={FIELD}>
            {ctx.activities.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void doRun()}
            disabled={!scenario || running !== null}
            className="flex items-center gap-1.5 rounded bg-brand px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {running ?? (stale ? "Run again" : "Run")}
          </button>
        </span>
      </header>

      {message ? (
        <div role="alert" className="mx-4 mt-3 rounded border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger-ink">
          {message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-3 p-4">
        <aside aria-label="Layers" className="flex min-w-0 max-w-[260px] flex-[1_1_200px] flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-white p-3">
            <span className={LABEL}>Layers</span>
            {(
              [
                ["occupancy", `${activity || "Capacity"} occupancy`, run && !stale ? "Projected by the last run" : "Today, from the census"],
                ["sick", "Sick per 1,000", run && !stale ? "Projected by the last run" : "Run to see it"],
                ["residents", "Residents per km²", grid.placement === "polygons" ? "Catchment sizes over their outlines" : "Catchment sizes, spread over their nearest cells"],
              ] as [LensKey, string, string][]
            ).map(([key, name, src]) => (
              <button
                key={key}
                type="button"
                aria-pressed={lens === key}
                onClick={() => setLens(key)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left",
                  lens === key ? "border-brand bg-brand-soft" : "border-line bg-white hover:bg-canvas-raised",
                )}
              >
                <span className="text-[12.5px] font-semibold text-ink">{name}</span>
                <span className="text-[11px] text-ink-muted">{src}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-line bg-white p-3">
            <span className={LABEL}>Legend</span>
            {legend.map(([, colour, label]) => (
              <span key={label} className="flex items-center gap-2 text-[11.5px] text-ink-body">
                <span className="h-3.5 w-3.5 rounded-sm border border-line" style={{ background: colour }} />
                {label}
              </span>
            ))}
            <span className="flex items-center gap-2 text-[11.5px] text-ink-body">
              <span className="h-3.5 w-3.5 rounded-sm border border-line" style={{ background: NO_DATA }} />
              no reading
            </span>
            <span className="mt-1 text-[11px] text-ink-faint">
              {grid.hexes.length} cells of {grid.radiusKm.toFixed(1)} km ·{" "}
              {grid.placement === "polygons" ? "placed by catchment outline" : "placed by nearest site"}
            </span>
          </div>
        </aside>

        <section aria-label="Map" className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-lg border border-line bg-white">
          <div role="toolbar" aria-label="Stamp tools" className="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-3 py-2">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tool === t.key}
                onClick={() => setTool(t.key)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-[12px] font-semibold",
                  tool === t.key ? "border-ink bg-ink text-white" : cn("border-line bg-white hover:bg-canvas-raised", LANE_INK[t.lane]),
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-canvas-raised px-3 py-1.5 text-[12px] text-ink-body">
            <span>{TOOLS.find((t) => t.key === tool)!.hint}</span>
            {tool === "seed" ? (
              <label className="ml-auto flex items-center gap-1">
                Sick at start
                <input type="number" min={1} value={seedCount} onChange={(e) => setSeedCount(Math.max(1, Number(e.target.value) || 1))} className={cn(FIELD, "w-20")} />
              </label>
            ) : null}
            {tool === "heat" ? (
              <label className="ml-auto flex items-center gap-1">
                Days
                <input type="number" min={1} max={horizon} value={heatDays} onChange={(e) => setHeatDays(Math.max(1, Number(e.target.value) || 1))} className={cn(FIELD, "w-16")} />
              </label>
            ) : null}
            {tool === "measure" ? (
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  Measure
                  <select value={presetKey} onChange={(e) => setPresetKey(e.target.value)} className={FIELD}>
                    {presets.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Where
                  <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={FIELD}>
                    <option value="5">Within 5 km</option>
                    <option value="catchment">This catchment</option>
                    <option value="everywhere">Everywhere</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Days
                  <input type="number" min={1} max={horizon} value={measureDays} onChange={(e) => setMeasureDays(Math.max(1, Number(e.target.value) || 1))} className={cn(FIELD, "w-16")} />
                </label>
              </span>
            ) : null}
            {tool === "capacity" ? (
              <label className="ml-auto flex items-center gap-1">
                Add
                <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} className={cn(FIELD, "w-16")} />
                {activity}
              </label>
            ) : null}
            {tool !== "inspect" ? (
              <span className="flex items-center gap-1">
                <label htmlFor="pick-catchment" className="sr-only">Or apply to a catchment</label>
                <select id="pick-catchment" value={pickCatchment} onChange={(e) => setPickCatchment(e.target.value)} className={FIELD}>
                  <option value="">or pick a catchment…</option>
                  {ctx.populations.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!pickCatchment || busy}
                  onClick={() => {
                    const first = grid.hexes.find((h) => h.population === pickCatchment);
                    if (first) tap(first.index);
                  }}
                  className="rounded border border-line px-2 py-1 disabled:opacity-50"
                >
                  Apply
                </button>
              </span>
            ) : null}
          </div>

          <div className="overflow-auto">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              className="mx-auto block max-w-full"
              role="img"
              aria-label="Map of the twin's catchments as hexagonal cells, coloured by the chosen layer"
            >
              <rect width={W} height={H} fill="#eaf0f6" />
              {grid.hexes.map((h) => (
                <polygon
                  key={h.index}
                  points={corner.map(([cx, cy]) => `${px(h.x) + cx},${py(h.y) + cy}`).join(" ")}
                  fill={fillFor(h.index)}
                  stroke={cell === h.index ? "#1c2127" : "#ffffff"}
                  strokeWidth={cell === h.index ? 2 : 0.6}
                  onClick={() => tap(h.index)}
                  className="cursor-pointer"
                >
                  <title>{popName(h.population)}</title>
                </polygon>
              ))}
              {areas.map((s) => {
                const p = grid.project(s.at!.lat, s.at!.lon);
                const on = d >= s.start && d < s.start + s.days;
                return (
                  <g key={s.id} opacity={on ? 1 : 0.45} pointerEvents="none">
                    <circle cx={px(p.x)} cy={py(p.y)} r={s.radiusKm! * scale} fill={on ? "rgba(91,74,134,0.10)" : "none"} stroke="#5b4a86" strokeWidth={2} strokeDasharray="6 4" />
                    <text x={px(p.x)} y={py(p.y) - s.radiusKm! * scale - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#5b4a86">
                      {s.label} · d{s.start}–{s.start + s.days - 1}
                    </text>
                  </g>
                );
              })}
              {seeds.map((s) => {
                const p = grid.project(s.at.lat, s.at.lon);
                return <circle key={s.id} cx={px(p.x)} cy={py(p.y)} r={7} fill="#a82255" stroke="#ffffff" strokeWidth={3} pointerEvents="none" />;
              })}
              {shownSites.map(({ f, i, p }) => {
                const occ = occupancyAt(i);
                const boosted = stamps.some((s) => s.kind === "capacity" && s.facility === f.id && d >= s.start);
                if (!labelSites)
                  return <circle key={f.id} cx={px(p.x)} cy={py(p.y)} r={3} fill="#1c2127" pointerEvents="none" />;
                const dark = Number.isFinite(occ) && occ >= 1.5;
                return (
                  <g key={f.id} pointerEvents="none">
                    <rect x={px(p.x) - 20} y={py(p.y) - 9} width={40} height={18} rx={4} fill={Number.isFinite(occ) ? ramp(occ, OCC_STEPS) : "#ffffff"} stroke="#1c2127" />
                    <text x={px(p.x)} y={py(p.y) + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={dark ? "#ffffff" : "#1c2127"}>
                      {Number.isFinite(occ) ? pct(occ) : "—"}
                    </text>
                    {boosted ? (
                      <text x={px(p.x) + 24} y={py(p.y) + 4} fontSize={10} fontWeight={700} fill="#215db0">+</text>
                    ) : null}
                    <title>{f.name}</title>
                  </g>
                );
              })}
              {islandNow.map((s, k) => (
                <g key={s.id} pointerEvents="none">
                  <rect x={12} y={12 + k * 24} width={170} height={20} rx={4} fill="#a82255" />
                  <text x={20} y={26 + k * 24} fontSize={12} fontWeight={700} fill="#ffffff">
                    Heat wave · day {d - s.start + 1} of {s.days}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {inspected ? (
            <div aria-live="polite" className="grid grid-cols-2 gap-x-6 gap-y-0.5 border-t border-line-soft px-3 py-2 text-[12px] sm:grid-cols-4">
              <span className="col-span-2 font-semibold text-ink sm:col-span-4">{popName(inspected.population)}</span>
              <span className="text-ink-muted">Residents (est.)</span>
              <span className="tabular-nums">{fmt(inspected.residents)}</span>
              <span className="text-ink-muted">Sick per 1,000 · day {d}</span>
              <span className="tabular-nums">{sick && inspected.population ? (sick[inspected.population]?.[d] ?? 0).toFixed(1) : "run to see"}</span>
              <span className="text-ink-muted">Sends {activity} patients to</span>
              <span>{ctx.facilities[inspectedSite]?.name ?? "no site"}</span>
              <span className="text-ink-muted">That site, day {d}</span>
              <span className="tabular-nums">{pct(occupancyAt(inspectedSite))}</span>
            </div>
          ) : null}
        </section>

        <aside aria-label="Recipe and result" className="flex min-w-0 max-w-[380px] flex-[1_1_300px] flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className={LABEL}>Recipe · {stamps.length} stamp{stamps.length === 1 ? "" : "s"}</span>
              {tier ? <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn-ink">weakest · {tier}</span> : null}
            </div>
            {sorted.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">No stamps yet. Pick a tool above the map, move the timeline to a day, then tap the map.</p>
            ) : null}
            {sorted.map((s) => {
              const ds = describeStamp(s, ctx);
              const open = s.id === selected;
              const resizable = s.kind === "heat" || s.kind === "measure";
              const shift = (by: number) =>
                void replace(s, { ...s, start: Math.max(0, Math.min(horizon - 1, s.start + by)), ...(s.kind === "capacity" ? { days: Math.max(1, horizon - Math.max(0, s.start + by)) } : {}) });
              return (
                <div key={s.id} className={cn("rounded-md border", open ? "border-brand bg-white" : "border-line-soft bg-canvas-raised")}>
                  <button type="button" aria-expanded={open} onClick={() => setSelected(open ? null : s.id)} className="grid w-full grid-cols-[10px_minmax(0,1fr)] gap-2 px-2.5 py-2 text-left">
                    <span className={cn("mt-1 h-2.5 w-2.5 rounded-sm", LANE_BG[laneOf(s)])} />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[12.5px] font-semibold text-ink">{ds.title}</span>
                      <span className="text-[11.5px] text-ink-muted">
                        {ds.when} · <span className={ds.tier === "Decision" ? "font-semibold text-ink-body" : "font-semibold text-warn-ink"}>{ds.tier}</span>
                      </span>
                    </span>
                  </button>
                  {open ? (
                    <div className="flex flex-col gap-2 px-2.5 pb-2.5">
                      <div className="flex flex-wrap gap-1">
                        <button type="button" disabled={busy} onClick={() => shift(-1)} className="rounded border border-line bg-white px-2 py-1 text-[11.5px] disabled:opacity-50">− 1 day</button>
                        <button type="button" disabled={busy} onClick={() => shift(1)} className="rounded border border-line bg-white px-2 py-1 text-[11.5px] disabled:opacity-50">+ 1 day</button>
                        {resizable ? (
                          <>
                            <button type="button" disabled={busy || s.days <= 1} onClick={() => void replace(s, { ...s, days: s.days - 1 })} className="rounded border border-line bg-white px-2 py-1 text-[11.5px] disabled:opacity-50">Shorter</button>
                            <button type="button" disabled={busy} onClick={() => void replace(s, { ...s, days: Math.min(horizon - s.start, s.days + 1) })} className="rounded border border-line bg-white px-2 py-1 text-[11.5px] disabled:opacity-50">Longer</button>
                          </>
                        ) : null}
                        <button type="button" disabled={busy} onClick={() => void remove(s)} className="rounded border border-danger/30 bg-danger-soft px-2 py-1 text-[11.5px] text-danger-ink disabled:opacity-50">Remove</button>
                      </div>
                      <p className="text-[12px] text-ink-body">{ds.why}</p>
                      <div className="rounded border border-line-soft bg-canvas-raised p-2">
                        <span className={LABEL}>What the engine receives</span>
                        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-ink">{payloadOf(s)}</pre>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3">
            <span className={LABEL}>Result · {activity} across every site</span>
            {!run ? (
              <p className="text-[12.5px] text-ink-muted">
                Run sends the recipe through the engine twice: with only the events, and with your measures and capacity as
                well. The difference is what your choices did.
              </p>
            ) : (
              <>
                {stale ? (
                  <p className="rounded bg-warn-soft px-2 py-1 text-[11.5px] text-warn-ink">The recipe changed since this run. Run again to update.</p>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col">
                    <span className="text-[11.5px] text-ink-muted">Events only</span>
                    <span className="text-[22px] font-bold tabular-nums text-ink-muted">{pct(pa!.v)}</span>
                    <span className="text-[11.5px] text-ink-muted">peak, day {pa!.t}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11.5px] font-semibold text-brand-deep">With your choices</span>
                    <span className="text-[22px] font-bold tabular-nums text-brand-deep">{pct(pb!.v)}</span>
                    <span className="text-[11.5px] text-ink-muted">peak, day {pb!.t}</span>
                  </div>
                </div>
                <p className="text-[12.5px] text-ink-body">
                  {!hasChoices
                    ? "Add a measure or capacity to see what it changes."
                    : pa!.v - pb!.v > 0.005
                      ? `Your choices lower the peak by ${Math.round((pa!.v - pb!.v) * 100)} points${pb!.t > pa!.t ? ` and push it ${pb!.t - pa!.t} days later` : ""}.`
                      : "Your choices do not lower the peak."}
                </p>
                {notes.map((n) => (
                  <p key={n} className="rounded bg-canvas-raised px-2 py-1 text-[11.5px] text-ink-body">{n}</p>
                ))}
                <p className="text-[11px] text-ink-faint">
                  Stored as two events, “Hex twin · {scenario?.name} · events only” and “· with your measures”, rewritten on each run.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>

      <section aria-label="Timeline" className="mx-4 mb-4 flex flex-col gap-2 rounded-lg border border-line bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="day-scrub" className="text-[12.5px] font-semibold tabular-nums">Day {d} of {horizon - 1}</label>
          <input id="day-scrub" type="range" min={0} max={horizon - 1} value={d} onChange={(e) => setDay(Number(e.target.value))} className="min-w-0 flex-[1_1_240px] accent-brand" />
          <span className="text-[11.5px] text-ink-muted">Stamps land on the day shown here.</span>
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
          {(["Events", "Measures", "Resources"] as Lane[]).map((ln) => (
            <div key={ln} className="contents">
              <span className={cn("text-[10.5px] font-bold uppercase tracking-wide", LANE_INK[ln])}>{ln}</span>
              <div className="relative h-7 rounded bg-canvas">
                {stamps
                  .filter((s) => laneOf(s) === ln)
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelected(s.id)}
                      title={describeStamp(s, ctx).title}
                      className={cn(
                        "absolute bottom-0.5 top-0.5 min-w-[10px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 text-left text-[11px] font-bold text-white",
                        LANE_BG[ln],
                        s.id === selected && "ring-2 ring-ink",
                      )}
                      style={{ left: `${(s.start / horizon) * 100}%`, width: `${Math.max((s.days / horizon) * 100, 1.5)}%` }}
                    >
                      {s.kind === "seed" ? "Outbreak" : s.kind === "heat" ? "Heat" : s.kind === "measure" ? s.label : `+${s.amount}`}
                    </button>
                  ))}
                <div className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 bg-ink" style={{ left: `${((d + 0.5) / horizon) * 100}%` }} />
              </div>
            </div>
          ))}
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">{activity}</span>
          <div className="relative">
            <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" className="block h-[150px] w-full" role="img" aria-label={`Occupancy of ${activity} across every site, by day`}>
              <rect width={CW} height={CH} fill="#f6f7f9" />
              <line x1={0} x2={CW} y1={yOf(1)} y2={yOf(1)} stroke="#a82255" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
              {run ? (
                <>
                  <polyline points={line(run.events.island)} fill="none" stroke="#8f99a8" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                  <polyline points={line(run.full.island)} fill="none" stroke="#2d72d2" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                </>
              ) : null}
              <line x1={((d + 0.5) / horizon) * CW} x2={((d + 0.5) / horizon) * CW} y1={0} y2={CH} stroke="#1c2127" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="absolute left-1 rounded bg-white/90 px-1 text-[10px] text-danger-ink" style={{ top: `${(yOf(1) / CH) * 150 - 14}px` }}>100 % full</span>
            <span className="absolute right-1 top-0 rounded bg-white/90 px-1 text-[10px] text-ink-muted">{Math.round(chartTop * 100)} %</span>
            {!run ? (
              <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-muted">Run to see occupancy over time.</span>
            ) : null}
          </div>
          <span />
          <div className="flex flex-wrap gap-4 text-[11.5px] text-ink-body">
            <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-ink-faint" />Same events, without your choices</span>
            <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 bg-brand" />Your scenario</span>
            {run && !stale ? (
              <span>
                Day {d}: <strong className="tabular-nums">{pct(run.events.island[d] ?? Number.NaN)} → {pct(run.full.island[d] ?? Number.NaN)}</strong>
              </span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
