# Simulation & Data Flux — Design Notes

Prototype: `design/twin-sim-flux-view.html` (self-contained, mock data, your code untouched). Companion to `twin-command-view.html` — same shell, dark tokens, and Palantir information architecture.

## View 1 — Crisis Simulation console (v2: live cross-reference)

Your current `SimulationView.tsx` is a 3-step wizard on a white page, disconnected from live data. The redesign treats the sim as a **fork of the live twin projected against reality**:

**Workflow (left rail, top to bottom):**

1. **Crisis library** — 10 composable scenarios: infectious index case (COVID), patient intake surge, mass casualty, staff shortage, ward closure, equipment failure (lab), supply shortage, seasonal/heatwave surge, regional transfer wave, data-source outage. Each added to the **active stack** with per-crisis intensity (×0.5–×2) and onset time (T+h). Stacked crises compose — their effect channels (occupancy, intake, isolation, staff, beds, lab, uncertainty) sum on every factor.
2. **Factor picker** — choose which twin metrics to watch evolve *before* running: hospital-wide (avg occupancy, intake rate, beds available, isolation demand, staff load) and per-unit (ER Ward A/B occupancy, ICU North occupancy, lab turnaround). Each selected factor becomes its own chart lane.
3. **Run vs live** — the run bar shows the baseline chip ("BASELINE = live twin snapshot HH:MM:SS"): the sim forks the current twin state (`cloneSubtree`) and projects forward.

**Cross-reference to reality (center lanes, Overlay ↔ Split toggle):**

- *Overlay*: one lane per factor. Solid cyan line = live stream (last 24h, keeps ticking after the run — the pulsing dot is "now"). Dashed pink = crisis projection. Dotted gray = no-crisis baseline. Shaded band = uncertainty (widens in ML mode and under data-outage crises). Warn/crit thresholds as dashed rules; blue verticals mark each crisis onset.
- *Split*: LIVE TWIN — REALITY on the left, SIMULATED TWIN — SCENARIO STACK on the right, same factor mirrored.
- Lane header shows LIVE now / SIM PEAK @ +h / Δ now — so divergence between reality and projection is a number, not a squint.

**Right panel** — scenario stack summary, per-factor outcomes (live now, sim peak, time-to-critical, end-of-horizon, Δ vs baseline), engine/model card (gnn-seir version + graph_spec in ML mode, mechanistic + mulberry32 seed otherwise). Bottom ribbon: projected `AlertTimelineEvent[]` (crisis onsets + threshold crossings). Each run also posts an ML+LLM notification whose recommendation references the live-vs-sim comparison ("if reality tracks the projection for 2–3h, pre-stage beds before the crossing").

Backend mapping: crisis stack ≈ generalized `Intervention[]` on `runMlSimulation` / scenario params on `runOutbreakSimulation`; factor picker ≈ selecting which `TwinUnitMetrics` keys to project; baseline fork = `cloneSubtree` of live state; live overlay = same SSE stream the Live Twin view consumes.

## View 2 — Data Flux

New view; today sources/webhooks are buried in Studio node forms and there's no runtime picture of data movement.

| Region | Content | Maps to |
|---|---|---|
| Left rail | flux catalog: each source with protocol (webhook / http poll / sse), live ev/s, target unit, health dot. **"+ Attach flux to twin"** opens a modal: source type → endpoint → target unit → ontology-mapping preview → attach | `routes/source.ts` (method/auth/pagination), `routes/ingest.ts` `/webhooks/:token`, `SourceNodeForm` |
| Center | animated flow graph: SOURCES → INGEST PIPELINE (parse/detect → normalize/SNOMED → ontology map) → DIGITAL TWIN units. Moving dots = live throughput; red dashed edge + glowing node = flux with an open anomaly | pipeline stages from `format-detect`, `normalize`, `persist-extract` |
| Bottom | live ingest log (mono stream: ADT admits, OBX results, dedupes, ML detector emissions) | ingest events |
| Right | **anomaly cards**: `[ML]` detector name + score + z-value + evidence, then a `[LLM]` triage block (typed-out recommendation, confidence %) with Ack / Escalate / Open unit | `live-analysis.ts` `ScoreSpec` generalized into detectors (ewma-zscore, gap-detector, iforest) |

## ML → LLM notification pattern

Every detection is a two-stage card, deliberately visually split:

1. **ML badge (purple)** — the detector: name, anomaly score, z-value, raw evidence. Machine facts, mono font.
2. **LLM badge (gold)** — the triage: a generated recommendation with confidence, typed out to signal it's generated, with actions (Ack, Escalate, jump to unit in the live twin).

Cards surface in three places: the right panel (in context), toasts (immediate), and a global notification drawer behind the bell — persistent, so alerts never vanish like today's toasts. Try it live: the prototype fires a new "admission-rate drift" detection ~22s after load, and attaching a flux or finishing a sim run also posts notifications.

## If you implement

Backend already has most primitives. What's genuinely new: a per-source throughput/health endpoint (extend `MetricsSnapshot`), a detector registry generalizing `ScoreSpec` (baseline + z-score is enough to start), and one LLM call per fired detection — prompt = detection JSON + unit context from `fetchTwinUnit` → recommendation + confidence, stored alongside the alert so the UI just renders it.
