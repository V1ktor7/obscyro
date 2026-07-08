# Twin Command View — Design Notes

Prototype: `design/twin-command-view.html` (open in any browser, self-contained, mock data only — zero changes to your code).

## Why the current view feels abstract and unorganized

The Live Twin today (`app/studio/live/LiveTwinView.tsx` + `TwinCanvas.tsx`) is free-draggable white cards on a 5000×3000 dot grid. Three root causes:

1. **No enforced hierarchy.** OrgUnits have parent/child edges, but users position nodes freely, so the structure (hospital → dept → ward) is invisible unless you arrange it yourself.
2. **No aggregate layer.** You see per-node metrics but never "how is the whole hospital doing" — no KPI summary above the graph.
3. **No temporal context.** Alerts arrive as toasts and vanish; there's no timeline showing when things happened, and simulation lives on a separate page disconnected from the live view.

## The Palantir model applied

Palantir Foundry/Gotham ops views follow a fixed information architecture: **orient (top) → navigate (left) → focus (center) → inspect (right) → time (bottom)**. The prototype maps your existing data onto it:

| Region | What it shows | Feeds from (existing code) |
|---|---|---|
| Command bar | env, stream/poll status, mode toggle Live↔Simulation | `StudioShell` env selector, `subscribeTwinStream` state |
| KPI strip | avg occupancy, open/critical alerts, beds free, worst freshness, linked instances | aggregated from `TwinTreeSnapshot.nodes[].metrics` |
| Left rail | indented ontology tree with severity dot + occupancy micro-bar per unit, kind filters | `snapshot.nodes` + `edges` (parent order), `KIND_FILTER_OPTIONS` |
| Center canvas | **auto-tiered graph** (depth = row, no free drag) with orthogonal edges; Grid tab = sortable table of the same units | `TwinCanvas` data, layout replaced by deterministic tiering; Grid is new |
| Node card | severity dot, name, 20-pt occupancy sparkline, metric value, occupancy bar (blue→amber ≥85 → red ≥95) | `TwinUnitNode.metrics`, `worstAlertSeverity`, history buffered client-side |
| Right inspector | occupancy gauge, linked/freshness, instances-by-type, alerts with Ack, recommendations | exactly `TwinUnitDetail` (`fetchTwinUnit`, `ackTwinAlert`) |
| Bottom ribbon | Live: alert dots on a 15-min time axis (replaces toast-only alerts). Sim: SEIR trajectory (E/I/R + isolation demand, peak marker) inline | alert timestamps; `runOutbreakSimulation` `DailyTrajectory[]` from `twin-sim` |

## Key design decisions

**Auto-layout over free drag.** Deterministic tiered layout (depth → row, siblings grouped under parent) is what makes it stop feeling unorganized. Keep drag as an optional override, but default to computed positions — you already have `mergeTwinPositions`, this just changes the default.

**Dark theme.** Ops consoles are dark for a reason: severity colors (red/amber/blue/green) carry meaning only when everything else is neutral. Your current white cards + indigo accents compete with the alert colors.

**Density with monospace values.** All numbers in mono, 9px uppercase micro-labels, 1px borders, no rounded shadows. Data-forward, chrome-recessive.

**Simulation as an overlay mode, not a separate page.** The Live/Simulation toggle swaps the bottom ribbon from the alert timeline to the SEIR trajectory while keeping the same graph — Palantir's pattern of projecting scenarios onto the live twin rather than a detached screen. Next step would be tinting node cards by projected infectious count per unit.

**Grid tab.** Same units as a ranked table (worst occupancy first). Cheap to build, and often the fastest answer to "which ward is in trouble."

## If you implement this

Nearly everything is a re-skin plus one layout function; no backend changes needed. Rough order of value: (1) tiered auto-layout, (2) KPI strip, (3) left tree, (4) alert timeline ribbon, (5) dark theme tokens in `globals.css`, (6) sim overlay toggle.
