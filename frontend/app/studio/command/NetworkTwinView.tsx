"use client";

/**
 * Live twin · network — Mapbox globe of the healthcare network.
 *
 * Root twin units render as geolocated sites (occupancy badge, alert ring);
 * ontology links between sites render as flow arcs, one layer per link type —
 * the map's legend is the institution's ontology, not a fixed list. Layers
 * panel with saved views, globe ↔ flat toggle, 3D standard ↔ satellite styles,
 * an inspector with drill-in to the unit command canvas, and a multi-lane
 * event timeline (alerts + feed activity).
 *
 * Requires NEXT_PUBLIC_MAPBOX_TOKEN; without it the view renders setup steps.
 */

import "mapbox-gl/dist/mapbox-gl.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapboxMap, Marker } from "mapbox-gl";

import {
  Building2,
  Eye,
  Globe2,
  HeartPulse,
  Hexagon,
  Loader2,
  Map as MapIcon,
  MapPin,
  Mountain,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Satellite,
  Save,
  Shapes,
  Spline,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import {
  createEnvLink,
  createEnvLinkType,
  createEnvObject,
  createEnvType,
  fetchGeoCapability,
  fetchTwinNetwork,
  fetchTwinTree,
  getEnvObject,
  listEnvTypes,
  listEnvObjects,
  listGeoShapes,
  listIngestEvents,
  listTwinAlerts,
  saveGeoShape,
  updateEnvObject,
  updateEnvType,
  type EnvLinkType,
  type GeoCapability,
  type InstanceShape,
  type TwinAlert,
  type TwinTreeSnapshot,
  type TwinNetworkSite,
  type TwinNetworkSnapshot,
} from "@/lib/platform-api";
import { useStudio } from "../StudioShell";
import TreeExplorer, { type TreeItem } from "../TreeExplorer";
import { BAND_COLOUR, bandOf, type Frame } from "../events/replay-frames";
import ReplayPanel from "./ReplayPanel";

import CoverageDialog from "./CoverageDialog";
import { capacityOf, isSiteHidden } from "./units-tree";
import { shapeFeatures } from "./map-shapes";
import { AXES, missionsIn, treeForAxis, type GroupingAxis } from "./units-axes";
import {
  flattenCoordinates,
  formatArea,
  pointsStillNeeded,
  polygonFrom,
  ringBounds,
} from "./polygon-draw";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Obscyro's own Standard basemap: land and water desaturated to the app's
// canvas so the flow arcs and site markers are the only saturated things on
// screen. Edited in Mapbox Studio, not here — publishing a new version there
// reaches this map without a redeploy. Owned by the same account as the token.
const STYLE_STANDARD = "mapbox://styles/victormorency7/cmsddjrmc002c01s99df7adnp";
const STYLE_SATELLITE = "mapbox://styles/mapbox/satellite-streets-v12";
const MONTREAL: [number, number] = [-73.5673, 45.5017];

/**
 * Layer styling.
 *
 * A lane used to be one of four names the server matched by regex, each with a
 * hand-picked colour. Lanes are now whatever link types the institution
 * modelled, so the styles are a categorical palette assigned by name — the same
 * reasoning as TYPE_TINTS in the ontology manager: the fifth style is red
 * because it is fifth, not because that flow is dangerous.
 *
 * Each style pairs a colour with a dash so the lanes stay distinguishable
 * without relying on colour alone.
 */
const LAYER_STYLES: { color: string; width: number; dash?: number[] }[] = [
  { color: "#2d72d2", width: 3 },
  { color: "#d9822b", width: 2.5, dash: [1.5, 1.5] },
  { color: "#5b4a86", width: 1.8, dash: [0.8, 2.2] },
  { color: "#1d9e75", width: 2.2, dash: [3, 1.5] },
  { color: "#c23030", width: 2, dash: [2, 2] },
  { color: "#8a94a0", width: 1.6, dash: [1, 3] },
];

function stylesKey(env: string): string {
  return `obs_twin_layer_styles_v1:${env}`;
}

/**
 * Style per link type, stable for as long as the browser remembers.
 *
 * The assignment is *recorded*, not computed. Deriving it from the current
 * layer set — by hash, or by index into the sorted list — looks stable and
 * isn't: with six styles and three lanes, adding a fourth link type changes the
 * colour of an existing one about 31% of the time, because the newcomer can
 * sort ahead of it and take its slot. A map whose legend reshuffles when
 * someone edits the ontology is worse than one with a repeated colour.
 *
 * So known types keep their slot, newcomers take the lowest free one, and past
 * six lanes the styles start repeating — visible, and better than churn.
 */
function assignLayerStyles(
  env: string,
  linkTypes: string[],
): Map<string, (typeof LAYER_STYLES)[number]> {
  let saved: Record<string, number> = {};
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(stylesKey(env));
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") saved = parsed as Record<string, number>;
      }
    } catch {
      /* unreadable or private mode — fall through to a fresh assignment */
    }
  }

  const slots = new Map<string, number>();
  const taken = new Set<number>();
  for (const name of linkTypes) {
    const s = saved[name];
    if (typeof s === "number" && s >= 0 && s < LAYER_STYLES.length && !taken.has(s)) {
      slots.set(name, s);
      taken.add(s);
    }
  }
  for (const name of [...linkTypes].sort((a, b) => a.localeCompare(b))) {
    if (slots.has(name)) continue;
    let slot = 0;
    while (slot < LAYER_STYLES.length && taken.has(slot)) slot++;
    if (slot >= LAYER_STYLES.length) slot = slots.size % LAYER_STYLES.length;
    slots.set(name, slot);
    taken.add(slot);
  }

  if (typeof window !== "undefined" && linkTypes.length > 0) {
    try {
      localStorage.setItem(
        stylesKey(env),
        JSON.stringify({ ...saved, ...Object.fromEntries(slots) }),
      );
    } catch {
      /* quota */
    }
  }

  return new Map(
    Array.from(slots, ([name, slot]) => [name, LAYER_STYLES[slot]!] as const),
  );
}

/**
 * Shape layers.
 *
 * Areas are ground, flows are figure. A catchment is context you read the map
 * *through*, so it gets a neutral wash and sits beneath the arcs; giving it one
 * of the categorical flow colours would make it look like another lane. The
 * shape being drawn right now is the exception — it is the active thing, so it
 * takes the brand blue.
 */
const SHAPES_SRC = "twin-shapes";
const SHAPES_FILL = "twin-shapes-fill";
const SHAPES_LINE = "twin-shapes-line";
const SHAPES_LABEL = "twin-shapes-label";
const REPLAY_SRC = "twin-replay";
const REPLAY_DOT = "twin-replay-dot";
const REPLAY_RING = "twin-replay-ring";
const DRAW_SRC = "twin-draw";
const DRAW_FILL = "twin-draw-fill";
const DRAW_LINE = "twin-draw-line";
const DRAW_PTS = "twin-draw-points";

/** Visibility per link type. Anything absent is visible. */
type LayerToggles = Record<string, boolean>;

/** Mapbox layer ids must be stable and safe; link type names are neither. */
function layerId(linkType: string): string {
  let h = 0;
  for (let i = 0; i < linkType.length; i++) h = (h * 31 + linkType.charCodeAt(i)) >>> 0;
  return `twin-flow-${h.toString(36)}`;
}

// Minimal GeoJSON shape for the flow sources (avoids depending on the
// ambient GeoJSON namespace, which is not guaranteed in every build env).
interface FlowFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { linkType: string };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
}

/** The same, for shape sources, whose geometries are whatever PostGIS returns. */
interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: Record<string, string | number>;
    geometry: { type: string; coordinates?: unknown };
  }[];
}

type GeoSource = { setData: (d: GeoFeatureCollection) => void } | undefined;

interface SavedView {
  name: string;
  layers: LayerToggles;
  projection: "globe" | "mercator";
  styleMode: "standard" | "satellite";
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
}

function viewsKey(env: string): string {
  // v2: `layers` is keyed by link type now, so a v1 view's patient/supply/data
  // keys describe lanes that no longer exist.
  return `obs_twin_views_v2:${env}`;
}

/** Position for a site: real coordinates, else a ring around Montréal. */
function sitePosition(site: TwinNetworkSite, index: number): [number, number] {
  if (site.longitude !== null && site.latitude !== null) {
    return [site.longitude, site.latitude];
  }
  const angle = index * 2.399963; // golden angle keeps fallbacks spread out
  const radius = 0.12 + (index % 3) * 0.05;
  return [MONTREAL[0] + Math.cos(angle) * radius, MONTREAL[1] + Math.sin(angle) * radius * 0.7];
}

/** Curved arc between two points (quadratic bezier sampled to a LineString). */
function arcCoords(a: [number, number], b: [number, number]): [number, number][] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const cx = mx - dy * 0.18;
  const cy = my + dx * 0.18;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    pts.push([
      u * u * a[0] + 2 * u * t * cx + t * t * b[0],
      u * u * a[1] + 2 * u * t * cy + t * t * b[1],
    ]);
  }
  return pts;
}

export default function NetworkTwinView({ onDrillIn }: { onDrillIn: () => void }) {
  const { hasKey, selectedEnv } = useStudio();
  const env = selectedEnv;

  const [network, setNetwork] = useState<TwinNetworkSnapshot | null>(null);
  const [alerts, setAlerts] = useState<TwinAlert[]>([]);
  const [feedEvents, setFeedEvents] = useState<{ id: string; receivedAt: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The map is why this screen exists; on a laptop the panel costs it a fifth
  // of its width, so it folds away.
  const [railOpen, setRailOpen] = useState(true);
  // Ids the map is *not* drawing. Empty means everything, which is the state
  // you start in — hiding one site should be one click, not a list you first
  // have to build.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  // Read inside the marker closure, which is built once per redraw and must
  // not capture a stale selection.
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const [panelTab, setPanelTab] = useState<"explorer" | "layers" | "views" | "replay">(
    "explorer",
  );
  // The frame the replay is showing, or null when it is not running. While it
  // holds a frame the DOM markers step aside: two things drawing the same site
  // with two different colours is worse than either.
  const [replayFrame, setReplayFrame] = useState<Frame | null>(null);
  const [axis, setAxis] = useState<GroupingAxis>("etablissement");
  // unit id -> territory name, resolved from the polygons rather than from a
  // field on the unit: an installation belongs to the territory it stands in.
  /**
   * unit id -> territory name, from the boundaries themselves.
   *
   * Territory is not a field on a unit and inventing one would be a second
   * truth to keep in step. A point in polygon test against the shapes already
   * loaded for the map answers it, and recomputes on its own whenever either
   * side lands.
   */
  const [treeSnap, setTreeSnap] = useState<TwinTreeSnapshot | null>(null);
  const [layers, setLayers] = useState<LayerToggles>({});
  const [projection, setProjection] = useState<"globe" | "mercator">("globe");
  const [styleMode, setStyleMode] = useState<"standard" | "satellite">("standard");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [windowHours, setWindowHours] = useState(72);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const fittedRef = useRef(false);
  /** Mapbox layer ids currently on the map, so dropped link types get cleaned up. */
  const drawnLayersRef = useRef<Set<string>>(new Set());

  // Site placement (add / move) — click handler lives in a ref so the map's
  // single click listener always sees current state.
  const [placing, setPlacing] = useState<null | { mode: "add" } | { mode: "move"; siteId: string }>(
    null,
  );
  const [pendingPos, setPendingPos] = useState<[number, number] | null>(null);
  const [siteName, setSiteName] = useState("");
  const [siteKind, setSiteKind] = useState("hospital");
  const [savingSite, setSavingSite] = useState(false);
  const mapClickRef = useRef<((lng: number, lat: number) => void) | null>(null);

  // Flow drawing — click a site, click another, pick the relationship. The
  // result is an ordinary link instance in the ontology, not a decoration on
  // the map: the map draws it afterwards because it exists.
  const [drawing, setDrawing] = useState<null | { fromId: string | null }>(null);
  const [pendingFlow, setPendingFlow] = useState<{ fromId: string; toId: string } | null>(null);
  const [linkTypes, setLinkTypes] = useState<EnvLinkType[]>([]);
  const [savingFlow, setSavingFlow] = useState(false);
  // Marker handlers are built once per snapshot, so they read current state
  // through a ref rather than a stale closure.
  const siteClickRef = useRef<((siteId: string) => void) | null>(null);

  // Shapes — the areas a site covers, and the PostGIS questions they answer.
  // The capability check comes first: this deployment does not have the
  // extension, so "unavailable" is the ordinary state, not an error path.
  const [capability, setCapability] = useState<GeoCapability | null>(null);
  const [shapes, setShapes] = useState<InstanceShape[]>([]);
  const [missionsOf, setMissionsOf] = useState<Map<string, string[]>>(new Map());

  const territoryOf = useMemo(() => {
    const out = new Map<string, string>();
    const terr = shapes.filter((g) => g.kind === "territoire");
    if (!network || terr.length === 0) return out;
    const named = new Map(terr.map((g) => [g.instanceId, g.instanceName ?? ""]));
    const hit = (px: number, py: number, ring: number[][]) => {
      let c = false;
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i]!, b = ring[(i + 1) % n]!;
        if (a[1]! > py !== b[1]! > py &&
            px < ((b[0]! - a[0]!) * (py - a[1]!)) / (b[1]! - a[1]! + 1e-15) + a[0]!) c = !c;
      }
      return c;
    };
    for (const site of network.sites) {
      if (site.longitude == null || site.latitude == null) continue;
      for (const g of terr) {
        const ring = (g.geometry.coordinates as unknown as number[][][])[0];
        if (!ring || !hit(site.longitude, site.latitude, ring)) continue;
        for (const u of site.contributingUnits ?? []) out.set(u.id, named.get(g.instanceId) ?? "");
        break;
      }
    }
    return out;
  }, [network, shapes]);

  const tree = useMemo(
    () => treeForAxis(treeSnap, axis, territoryOf, missionsOf),
    [treeSnap, axis, territoryOf, missionsOf],
  );

  const [drawArea, setDrawArea] = useState<null | {
    instanceId: string;
    instanceName: string;
    kind: string;
    points: [number, number][];
  }>(null);
  const [savingShape, setSavingShape] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const spatial = capability?.available === true;

  siteClickRef.current = (siteId: string) => {
    // Drawing an area over a site snaps the vertex to it, which is how a
    // corridor between buildings gets traced without hunting for the centre.
    if (drawArea) {
      const pos = positions.get(siteId);
      if (pos) addVertex(pos[0], pos[1]);
      return;
    }
    if (!drawing) {
      setSelectedId(siteId);
      return;
    }
    if (drawing.fromId === null) {
      setDrawing({ fromId: siteId });
      return;
    }
    if (drawing.fromId === siteId) {
      setDrawing({ fromId: null });
      return;
    }
    setPendingFlow({ fromId: drawing.fromId, toId: siteId });
    setDrawing(null);
  };

  function addVertex(lng: number, lat: number) {
    setDrawArea((cur) => (cur ? { ...cur, points: [...cur.points, [lng, lat]] } : cur));
  }

  mapClickRef.current = (lng: number, lat: number) => {
    if (drawArea) {
      addVertex(lng, lat);
      return;
    }
    if (!placing) return;
    if (placing.mode === "add") {
      setPendingPos([lng, lat]);
      setPlacing(null);
    } else {
      const siteId = placing.siteId;
      setPlacing(null);
      void (async () => {
        if (!env) return;
        try {
          const { object } = await getEnvObject(env, siteId);
          await updateEnvObject(env, siteId, {
            properties: { ...object.properties, latitude: lat, longitude: lng },
          });
          await load();
        } catch (err) {
          setError((err as Error).message);
        }
      })();
    }
  };

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = placing || drawing || drawArea ? "crosshair" : "";
  }, [placing, drawing, drawArea]);

  /**
   * Write the drawn ring to the instance.
   *
   * Same reasoning as the flow tool: the map is an editor for the ontology, not
   * a place decorations live. The shape belongs to the instance afterwards, and
   * every other view can ask about it.
   */
  async function saveArea() {
    if (!env || !drawArea || savingShape) return;
    const geometry = polygonFrom(drawArea.points);
    if (!geometry) {
      setError("An area needs at least three corners.");
      return;
    }
    setSavingShape(true);
    setError(null);
    try {
      await saveGeoShape(env, drawArea.instanceId, { kind: drawArea.kind, geometry });
      setDrawArea(null);
      await loadShapes();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingShape(false);
    }
  }

  // Enter finishes the ring, Escape abandons it. A drawing tool that can only
  // be left with the mouse is a trap once the pointer is out over the map.
  useEffect(() => {
    if (!drawArea) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawArea(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void saveArea();
      } else if ((e.key === "Backspace" || e.key === "Delete") && drawArea.points.length > 0) {
        e.preventDefault();
        setDrawArea((cur) => (cur ? { ...cur, points: cur.points.slice(0, -1) } : cur));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawArea, env, savingShape]);

  async function createSite() {
    if (!env || !pendingPos || savingSite) return;
    if (!siteName.trim()) {
      setError("Give the site a name.");
      return;
    }
    setSavingSite(true);
    try {
      // Ensure the physical Institution type exists (tagged for the twin).
      try {
        await createEnvType(env, {
          name: "Institution",
          description: "Physical site of the healthcare network",
          nature: "physical",
          propertySchema: [
            { key: "name", type: "string" },
            { key: "kind", type: "string" },
            { key: "latitude", type: "number" },
            { key: "longitude", type: "number" },
          ],
        });
      } catch {
        await updateEnvType(env, "Institution", { nature: "physical" }).catch(() => undefined);
      }
      await createEnvObject(env, {
        type: "Institution",
        properties: {
          name: siteName.trim(),
          kind: siteKind,
          latitude: pendingPos[1],
          longitude: pendingPos[0],
        },
        provenance: { source: "twin-add-site" },
      });
      setPendingPos(null);
      setSiteName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSite(false);
    }
  }

  // --- data ------------------------------------------------------------------

  const load = useCallback(async () => {
    if (!env) {
      setNetwork(null);
      setAlerts([]);
      setFeedEvents([]);
      return;
    }
    setLoading(true);
    try {
      const [net, al, ev, schema] = await Promise.all([
        fetchTwinNetwork(env),
        listTwinAlerts(env, { limit: 100 }).catch(() => ({ alerts: [] as TwinAlert[] })),
        listIngestEvents().catch(() => ({ events: [] })),
        listEnvTypes(env).catch(() => ({ linkTypes: [] as EnvLinkType[] })),
      ]);
      setNetwork(net);
      // The map reads a flat list of sites; the tree needs the parent/child
      // edges, which only the tree endpoint carries. A failure here costs the
      // panel, not the map.
      fetchTwinTree(env)
        .then((t) => setTreeSnap(t))
        .catch(() => setTreeSnap(null));
      setLinkTypes(schema.linkTypes);
      setAlerts(al.alerts);
      setFeedEvents(ev.events.map((e) => ({ id: e.id, receivedAt: e.receivedAt })));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [env]);

  useEffect(() => {
    fittedRef.current = false;
    void load();
    const handle = setInterval(() => void load(), 30_000);
    return () => clearInterval(handle);
  }, [load]);

  const loadShapes = useCallback(async () => {
    if (!env) {
      setShapes([]);
      return;
    }
    try {
      const { shapes: got } = await listGeoShapes(env);
      setShapes(got);
    } catch {
      // A database without PostGIS answers this honestly rather than failing,
      // so a throw here is a real fault — but an empty map is still the right
      // thing to show, and the capability banner already explains why.
      setShapes([]);
    }
  }, [env]);

  // What each installation declares it does.
  //
  // Read off the instances rather than off the twin snapshot, which carries
  // metrics and hierarchy and has no room for an attribute only one axis uses.
  // Nothing here knows the vocabulary: whatever list the institution declared
  // becomes the headings, so a network that files its sites under "urgence" and
  // "réadaptation" gets those and not a translation of somebody else's.
  useEffect(() => {
    if (!env) {
      setMissionsOf(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { objects } = await listEnvObjects(env, {
          where: "kind:installation",
          limit: 200,
        });
        const out = new Map<string, string[]>();
        for (const o of objects) {
          const list = missionsIn(o.properties);
          if (list.length) out.set(o.id, list);
        }
        if (!cancelled) setMissionsOf(out);
      } catch {
        // An axis with no data says so on screen. Failing the whole map because
        // one grouping could not be resolved would be the worse trade.
        if (!cancelled) setMissionsOf(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [env]);

  // Asked once per environment: whether the extension is installed changes when
  // someone runs a command against the database, not while the map is open.
  useEffect(() => {
    if (!env) {
      setCapability(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cap = await fetchGeoCapability(env);
        if (!cancelled) setCapability(cap);
      } catch {
        if (!cancelled) setCapability({ available: false, reason: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [env]);

  useEffect(() => {
    if (spatial) void loadShapes();
    else setShapes([]);
  }, [spatial, loadShapes]);

  useEffect(() => {
    if (!env) return;
    try {
      setSavedViews(JSON.parse(localStorage.getItem(viewsKey(env)) ?? "[]") as SavedView[]);
    } catch {
      setSavedViews([]);
    }
  }, [env]);

  // --- map lifecycle -----------------------------------------------------------

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: STYLE_STANDARD,
        center: MONTREAL,
        zoom: 9,
        pitch: 45,
        attributionControl: true,
      });
      mapRef.current = map;
      map.on("load", () => {
        if (cancelled) return;
        map.setProjection("globe");
        setMapReady(true);
      });
      map.on("style.load", () => {
        // Shapes first so the arcs land on top of them: `setStyle` drops every
        // source and layer, and insertion order is what decides who covers whom.
        ensureShapeLayers(map);
        ensureFlowLayers(map);
      });
      map.on("click", (e) => {
        mapClickRef.current?.(e.lngLat.lng, e.lngLat.lat);
      });
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Layer list and styling, straight from the ontology's link types. */
  const flowLayers = useMemo(() => network?.layers ?? [], [network]);
  const styles = useMemo(
    () => assignLayerStyles(env ?? "", flowLayers.map((l) => l.linkType)),
    [env, flowLayers],
  );

  function ensureFlowLayers(map: MapboxMap) {
    const wanted = new Set<string>();
    for (const { linkType } of flowLayers) {
      const id = layerId(linkType);
      wanted.add(id);
      if (!map.getSource(id)) {
        map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(id)) {
        const style = styles.get(linkType) ?? LAYER_STYLES[0]!;
        map.addLayer({
          id,
          type: "line",
          source: id,
          paint: {
            "line-color": style.color,
            "line-width": style.width,
            "line-opacity": 0.75,
            ...(style.dash ? { "line-dasharray": style.dash } : {}),
          },
        });
      }
    }
    // A link type deleted from the ontology leaves its arcs behind otherwise.
    for (const id of Array.from(drawnLayersRef.current)) {
      if (wanted.has(id)) continue;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    drawnLayersRef.current = wanted;
  }

  /**
   * Sources and layers for saved shapes and for the one being drawn.
   *
   * Idempotent, and called again on every `style.load`, because switching
   * basemaps tears the whole style down. The saved shapes go beneath the flow
   * arcs — `beforeId` on the first flow layer if one is already there.
   */
  function ensureShapeLayers(map: MapboxMap) {
    const empty = { type: "FeatureCollection" as const, features: [] };
    const firstFlow = Array.from(drawnLayersRef.current).find((id) => map.getLayer(id));

    if (!map.getSource(SHAPES_SRC)) map.addSource(SHAPES_SRC, { type: "geojson", data: empty });
    if (!map.getLayer(SHAPES_FILL)) {
      map.addLayer(
        {
          id: SHAPES_FILL,
          type: "fill",
          source: SHAPES_SRC,
          // Read from the feature, not hard-coded: the colour is a declared
          // property of the instance, so an institution recolours its map by
          // editing its ontology rather than by asking for a deploy.
          //
          // The fill fades as you zoom in. Far out the territory is the subject
          // and the installations are dots inside it; close in the installation
          // is the subject and the territory is context that should not tint
          // the building you are reading.
          paint: {
            "fill-color": ["get", "couleur"],
            "fill-opacity": [
              "case",
              ["get", "dimmed"],
              0.02,
              ["interpolate", ["linear"], ["zoom"], 8, 0.2, 11, 0.12, 14, 0.04],
            ],
          },
        },
        firstFlow,
      );
    }
    if (!map.getLayer(SHAPES_LINE)) {
      map.addLayer(
        {
          id: SHAPES_LINE,
          type: "line",
          source: SHAPES_SRC,
          // The outline survives the zoom the fill gives up: a boundary you can
          // still trace is what tells you two neighbouring hospitals are not in
          // the same territory.
          paint: {
            "line-color": ["get", "couleur"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 11, 1.6, 14, 2.4],
            "line-opacity": ["case", ["get", "dimmed"], 0.15, 0.85],
          },
        },
        firstFlow,
      );
    }

    if (!map.getLayer(SHAPES_LABEL)) {
      map.addLayer({
        id: SHAPES_LABEL,
        type: "symbol",
        source: SHAPES_SRC,
        filter: ["==", ["get", "kind"], "territoire"],
        layout: {
          "text-field": ["get", "label"],
          // Spaced small caps is how an atlas names an area rather than a
          // place: it reads as the ground the pins stand on, not as one of them.
          "text-transform": "uppercase",
          "text-letter-spacing": 0.09,
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 12.5, 15, 14],
          "text-anchor": "center",
          "text-max-width": 8,
          // Mapbox drops a label rather than overlap one already placed, which
          // is the behaviour we want: twelve names on one island cannot all fit
          // at every zoom, and a stack of overlapping names is worse than ten.
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": ["get", "couleur"],
          "text-opacity": ["case", ["get", "dimmed"], 0.25, 1],
          // On imagery the ground is dark, so the halo that makes a label
          // legible has to invert with it.
          "text-halo-color": styleMode === "satellite" ? "#0b0f14" : "#ffffff",
          "text-halo-width": 1.6,
        },
      });
    }

    // Replay sits above the shapes and below the hand-drawn ring. Circles on a
    // GeoJSON source rather than DOM markers: ninety-one frames of two hundred
    // markers is a scrubber, and moving two hundred DOM nodes cannot answer a
    // slider inside a frame. `setData` on a source can.
    if (!map.getSource(REPLAY_SRC)) map.addSource(REPLAY_SRC, { type: "geojson", data: empty });
    if (!map.getLayer(REPLAY_RING)) {
      map.addLayer({
        id: REPLAY_RING,
        type: "circle",
        source: REPLAY_SRC,
        filter: [">", ["get", "waiting"], 0],
        paint: {
          "circle-radius": ["+", ["get", "r"], ["get", "queue"]],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#c23030",
          "circle-stroke-width": 1.2,
          "circle-stroke-opacity": 0.45,
        },
      });
    }
    if (!map.getLayer(REPLAY_DOT)) {
      map.addLayer({
        id: REPLAY_DOT,
        type: "circle",
        source: REPLAY_SRC,
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": ["get", "colour"],
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.8,
        },
      });
    }

    // The ring in progress sits above everything: it is what the hand is doing.
    if (!map.getSource(DRAW_SRC)) map.addSource(DRAW_SRC, { type: "geojson", data: empty });
    if (!map.getLayer(DRAW_FILL)) {
      map.addLayer({
        id: DRAW_FILL,
        type: "fill",
        source: DRAW_SRC,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#2d72d2", "fill-opacity": 0.14 },
      });
    }
    if (!map.getLayer(DRAW_LINE)) {
      map.addLayer({
        id: DRAW_LINE,
        type: "line",
        source: DRAW_SRC,
        filter: ["!=", ["geometry-type"], "Point"],
        paint: {
          "line-color": "#2d72d2",
          "line-width": 2,
          "line-dasharray": [2, 1.5],
        },
      });
    }
    if (!map.getLayer(DRAW_PTS)) {
      map.addLayer({
        id: DRAW_PTS,
        type: "circle",
        source: DRAW_SRC,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#2d72d2",
          "circle-stroke-width": 2,
        },
      });
    }
  }

  const positions = useMemo(() => {
    const m = new Map<string, [number, number]>();
    network?.sites.forEach((s, i) => m.set(s.id, sitePosition(s, i)));
    return m;
  }, [network]);

  // Saved shapes onto the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    ensureShapeLayers(map);
    (map.getSource(SHAPES_SRC) as GeoSource)?.setData(
      shapeFeatures(shapes, { axis, hidden: hiddenIds }) as never,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, mapReady, styleMode, axis, hiddenIds]);

  // The replay frame onto the map.
  //
  // Keyed by the unit ids the engine reports, which are the `contributingUnits`
  // of a site rather than the site itself — the map draws places and the engine
  // runs units, and joining them anywhere else would put a second definition of
  // "where is this hospital" in the product.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    ensureShapeLayers(map);
    const src = map.getSource(REPLAY_SRC) as GeoSource | undefined;
    if (!src) return;
    if (!replayFrame || !network) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const byUnit = new Map(replayFrame.facilities.map((f) => [f.id, f]));
    const features = [];
    for (const site of network.sites) {
      const pos = positions.get(site.id);
      if (!pos) continue;
      // A site may host several units; the worst of them is what colours it,
      // for the same reason the worst activity colours a unit.
      let worst: (typeof replayFrame.facilities)[number] | null = null;
      let waiting = 0;
      for (const u of site.contributingUnits ?? []) {
        const f = byUnit.get(u.id);
        if (!f) continue;
        waiting += f.waiting;
        if (!worst || f.worst > worst.worst) worst = f;
      }
      if (!worst) continue;
      features.push({
        type: "Feature" as const,
        properties: {
          colour: BAND_COLOUR[bandOf(worst.worst)],
          r: Math.max(4, Math.sqrt(capacityOf(site)) * 0.7),
          waiting,
          queue: Math.min(14, Math.sqrt(waiting) * 1.6),
        },
        geometry: { type: "Point" as const, coordinates: pos },
      });
    }
    src.setData({ type: "FeatureCollection", features } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayFrame, network, positions, mapReady, styleMode]);

  // The ring being drawn: the closed polygon once it is one, the open line
  // before that, plus a dot on every corner so a misplaced click is visible.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    ensureShapeLayers(map);
    const source = map.getSource(DRAW_SRC) as GeoSource;
    if (!source) return;
    const pts = drawArea?.points ?? [];
    const polygon = drawArea ? polygonFrom(pts) : null;
    source.setData({
      type: "FeatureCollection",
      features: [
        ...(polygon
          ? [{ type: "Feature" as const, properties: {}, geometry: polygon }]
          : pts.length > 1
            ? [
                {
                  type: "Feature" as const,
                  properties: {},
                  geometry: { type: "LineString", coordinates: pts },
                },
              ]
            : []),
        ...pts.map((p, i) => ({
          type: "Feature" as const,
          properties: { index: i },
          geometry: { type: "Point", coordinates: p },
        })),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawArea, mapReady, styleMode]);

  // Markers: rebuild when sites change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !network) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    let mounted = true;
    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (!mounted) return;
      for (const site of network.sites) {
        // The tree's whole point: a control that redraws nothing is an ornament.
        //
        // The map draws Sites — the instances that carry coordinates — while
        // the tree is built from the OrgUnits above them. Two id spaces, no
        // overlap, so matching on `site.id` hid nothing at all. A site is hidden
        // when every unit standing on it is.
        if (isSiteHidden(site, hiddenIds)) continue;
        // The replay draws these sites itself. Two things painting one hospital
        // in two different colours is worse than either of them alone.
        if (replayFrame) continue;
        const pos = positions.get(site.id)!;
        const el = document.createElement("div");
        const occ = site.metrics.occupancyPct;
        const sev = site.worstAlertSeverity;
        const ring =
          sev === "critical" ? "#e11d48" : sev === "warn" ? "#d97706" : "#059669";
        // A 38px white disc with the name always above it works for a dozen
        // sites and collapses into a wall of overlapping labels at 190. Three
        // changes, each carrying one fact instead of stacking them:
        //
        //   size    capacity, on a square-root scale so a 732-bed hospital
        //           reads as bigger than a 9-place group home without a
        //           500-bed one swallowing the island
        //   fill    occupancy, so the reading is the colour and needs no text
        //   ring    an open alert, which is a different axis and stays separate
        //
        // The name appears on hover and when selected. A label per site is what
        // made the map unreadable, and it is the one thing you can ask for on
        // demand.
        const cap = capacityOf(site);
        const size = Math.round(10 + Math.sqrt(Math.min(cap, 900)) * 0.9);
        const fill =
          occ === null ? "#c5cbd3" : occ >= 100 ? "#e11d48" : occ >= 85 ? "#d97706" : "#059669";
        const alerted = site.openAlertCount > 0;
        el.style.cursor = "pointer";
        el.innerHTML = `
          <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
            <div class="site-dot" style="width:${size}px;height:${size}px;border-radius:50%;background:${fill};opacity:.85;border:${alerted ? `2px solid ${ring}` : "1px solid rgba(255,255,255,.9)"};box-shadow:0 1px 3px rgba(0,0,0,.3);"></div>
            <div class="site-name" style="display:none;position:absolute;bottom:${size + 4}px;font-size:11px;font-weight:600;color:#1c2127;background:rgba(255,255,255,.94);padding:1px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2);">${site.name}${cap ? ` · ${cap}` : ""}${occ !== null ? ` · ${Math.round(occ)}%` : ""}</div>
          </div>`;
        const nameEl = el.querySelector<HTMLElement>(".site-name");
        const showName = (on: boolean) => {
          if (nameEl) nameEl.style.display = on || site.id === selectedRef.current ? "block" : "none";
        };
        showName(false);
        el.addEventListener("mouseenter", () => showName(true));
        el.addEventListener("mouseleave", () => showName(false));
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          siteClickRef.current?.(site.id);
          mapRef.current?.flyTo({ center: pos, zoom: Math.max(mapRef.current.getZoom(), 11) });
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat(pos)
          .addTo(map);
        markersRef.current.push(marker);
      }
      if (!fittedRef.current && network.sites.length > 0) {
        fittedRef.current = true;
        const bounds = new mapboxgl.LngLatBounds();
        network.sites.forEach((s) => bounds.extend(positions.get(s.id)!));
        map.fitBounds(bounds, { padding: 90, maxZoom: 11 });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [network, mapReady, positions, hiddenIds, replayFrame]);

  // Flow arcs: update sources when flows or toggles change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !network) return;
    ensureFlowLayers(map);
    for (const { linkType } of flowLayers) {
      const source = map.getSource(layerId(linkType)) as
        | { setData: (d: FlowFeatureCollection) => void }
        | undefined;
      if (!source) continue;
      const features = layers[linkType] !== false
        ? network.flows
            .filter((f) => f.linkType === linkType)
            .map((f) => {
              const a = positions.get(f.fromId);
              const b = positions.get(f.toId);
              if (!a || !b) return null;
              return {
                type: "Feature" as const,
                properties: { linkType: f.linkType },
                geometry: { type: "LineString" as const, coordinates: arcCoords(a, b) },
              };
            })
            .filter((f): f is NonNullable<typeof f> => f !== null)
        : [];
      source.setData({ type: "FeatureCollection", features });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, mapReady, layers, positions, styleMode, flowLayers, styles]);

  // --- toolbar actions -----------------------------------------------------------

  /**
   * Write the flow to the ontology.
   *
   * `relationship` is either an existing link type's name, or a new one to
   * define. Defining one is a schema change and the panel asks separately for
   * it: an instance is a fact you can delete, a type is a rule the whole
   * organization inherits.
   */
  async function saveFlow(relationship: string, createType: boolean) {
    if (!env || !pendingFlow) return;
    const from = network?.sites.find((s) => s.id === pendingFlow.fromId);
    const to = network?.sites.find((s) => s.id === pendingFlow.toId);
    setSavingFlow(true);
    setError(null);
    try {
      if (createType) {
        if (!from?.objectType || !to?.objectType) {
          throw new Error(
            "These sites have no object type on record — reload the map and try again.",
          );
        }
        await createEnvLinkType(env, {
          name: relationship,
          fromType: from.objectType,
          toType: to.objectType,
        });
      }
      await createEnvLink(env, {
        linkType: relationship,
        fromId: pendingFlow.fromId,
        toId: pendingFlow.toId,
        provenance: { source: "network-map" },
      });
      setPendingFlow(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingFlow(false);
    }
  }

  function toggleProjection() {
    const next = projection === "globe" ? "mercator" : "globe";
    setProjection(next);
    mapRef.current?.setProjection(next);
  }

  function toggleStyle() {
    const next = styleMode === "standard" ? "satellite" : "standard";
    setStyleMode(next);
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(next === "standard" ? STYLE_STANDARD : STYLE_SATELLITE);
    map.once("style.load", () => map.setProjection(projection));
  }

  function saveCurrentView() {
    if (!env) return;
    const map = mapRef.current;
    if (!map) return;
    const name = window.prompt("Name this view", `View ${savedViews.length + 1}`);
    if (!name?.trim()) return;
    const view: SavedView = {
      name: name.trim(),
      layers,
      projection,
      styleMode,
      camera: {
        center: [map.getCenter().lng, map.getCenter().lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      },
    };
    const next = [...savedViews.filter((v) => v.name !== view.name), view];
    setSavedViews(next);
    try {
      localStorage.setItem(viewsKey(env), JSON.stringify(next));
    } catch {
      /* quota */
    }
  }

  function applyView(view: SavedView) {
    setLayers(view.layers);
    if (view.styleMode !== styleMode) {
      setStyleMode(view.styleMode);
      mapRef.current?.setStyle(
        view.styleMode === "standard" ? STYLE_STANDARD : STYLE_SATELLITE,
      );
    }
    setProjection(view.projection);
    const map = mapRef.current;
    if (map) {
      map.once("style.load", () => map.setProjection(view.projection));
      map.setProjection(view.projection);
      map.flyTo({
        center: view.camera.center,
        zoom: view.camera.zoom,
        pitch: view.camera.pitch,
        bearing: view.camera.bearing,
      });
    }
  }

  /**
   * Frame a saved shape.
   *
   * The bounds come from the geometry's own positions rather than a stored
   * bounding box, so it works for whatever PostGIS hands back — polygon,
   * multipolygon, line.
   */
  function flyToShape(shape: InstanceShape) {
    const map = mapRef.current;
    if (!map) return;
    const box = ringBounds(flattenCoordinates(shape.geometry.coordinates));
    if (!box) return;
    setShowCoverage(false);
    map.fitBounds(
      [
        [box.west, box.south],
        [box.east, box.north],
      ],
      { padding: 80, maxZoom: 14 },
    );
  }

  // --- derived -------------------------------------------------------------------

  const selected = network?.sites.find((s) => s.id === selectedId) ?? null;
  const selectedShape = useMemo(
    () => shapes.find((s) => s.instanceId === selectedId) ?? null,
    [shapes, selectedId],
  );
  const selectedAlerts = useMemo(
    () => alerts.filter((a) => a.unitInstanceId === selectedId),
    [alerts, selectedId],
  );
  /** Flows touching the selected site, one row per link type it actually uses. */
  const selectedFlows = useMemo(() => {
    if (!network || !selectedId) return [];
    const counts = new Map<string, number>();
    for (const f of network.flows) {
      if (f.fromId !== selectedId && f.toId !== selectedId) continue;
      counts.set(f.linkType, (counts.get(f.linkType) ?? 0) + 1);
    }
    return Array.from(counts, ([linkType, count]) => ({ linkType, count })).sort((a, b) =>
      a.linkType.localeCompare(b.linkType),
    );
  }, [network, selectedId]);

  const missingCoords = network?.sites.filter((s) => s.latitude === null).length ?? 0;

  const nameOfSite = useCallback(
    (id: string) => network?.sites.find((s) => s.id === id)?.name ?? "site",
    [network],
  );

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to see the network twin.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f7f9]">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d3d8de] bg-white px-4 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-[#e7f2fd] text-[#2d72d2]">
          <Globe2 className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] font-semibold text-[#1c2127]">Live twin · network</span>
        <span className="rounded border border-[#d3d8de] px-2 py-0.5 text-[11px] text-[#404854]">
          {env ?? "no environment"}
        </span>
        {network ? (
          <span className="flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            live · {hiddenIds.size > 0 ? `${network.sites.filter((s) => !isSiteHidden(s, hiddenIds)).length} of ` : ""}
            {network.sites.length} site{network.sites.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {missingCoords > 0 ? (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
            {missingCoords} site{missingCoords === 1 ? "" : "s"} without coordinates — set
            latitude/longitude in Manager
          </span>
        ) : null}
        {placing ? (
          <span className="flex items-center gap-1.5 rounded bg-[#e7f2fd] px-2 py-0.5 text-[11px] font-medium text-[#215db0]">
            <MapPin className="h-3 w-3" />
            {placing.mode === "add"
              ? "click the map to place the new site"
              : "click the map to set the new location"}
            <button type="button" onClick={() => setPlacing(null)} aria-label="Cancel placement">
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : null}
        {drawing ? (
          <span className="flex items-center gap-1.5 rounded bg-[#e7f2fd] px-2 py-0.5 text-[11px] font-medium text-[#215db0]">
            <Spline className="h-3 w-3" />
            {drawing.fromId === null
              ? "click the site the flow starts from"
              : `from ${nameOfSite(drawing.fromId)} — click the site it goes to`}
            <button type="button" onClick={() => setDrawing(null)} aria-label="Cancel flow">
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : null}
        {drawArea ? (
          <span className="flex items-center gap-1.5 rounded bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-deep">
            <Hexagon className="h-3 w-3" />
            {pointsStillNeeded(drawArea.points) > 0
              ? `${drawArea.instanceName} — ${pointsStillNeeded(drawArea.points)} more corner${
                  pointsStillNeeded(drawArea.points) === 1 ? "" : "s"
                }`
              : `${drawArea.instanceName} — ${drawArea.points.length} corners · Enter to save`}
            <button type="button" onClick={() => setDrawArea(null)} aria-label="Cancel area">
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded border border-[#d3d8de] bg-white px-2 py-1 text-[11px] text-[#404854] hover:border-[#2d72d2]"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
        <button
          type="button"
          disabled={!env || !MAPBOX_TOKEN}
          onClick={() => setPlacing(placing?.mode === "add" ? null : { mode: "add" })}
          className={cn(
            "flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium",
            placing?.mode === "add"
              ? "bg-[#e7f2fd] text-[#215db0]"
              : "bg-[#2d72d2] text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add site
        </button>
        <button
          type="button"
          disabled={!env || !MAPBOX_TOKEN || (network?.sites.length ?? 0) < 2}
          title={
            (network?.sites.length ?? 0) < 2
              ? "A flow needs two sites — add another first"
              : "Draw a flow between two sites"
          }
          onClick={() => {
            setPlacing(null);
            setDrawing(drawing ? null : { fromId: null });
          }}
          className={cn(
            "flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium",
            drawing
              ? "bg-[#e7f2fd] text-[#215db0]"
              : "border border-[#d3d8de] bg-white text-[#404854] hover:border-[#2d72d2] disabled:text-[#c5cbd3]",
          )}
        >
          <Spline className="h-3.5 w-3.5" />
          Draw flow
        </button>
        <button
          type="button"
          disabled={!env || !MAPBOX_TOKEN || !spatial || !selected}
          title={
            !spatial
              ? capability?.reason ?? "Spatial queries are not available on this database"
              : !selected
                ? "Select a site first — an area belongs to something"
                : `Draw the area covered by ${selected.name}`
          }
          onClick={() => {
            if (!selected) return;
            setPlacing(null);
            setDrawing(null);
            setDrawArea(
              drawArea
                ? null
                : {
                    instanceId: selected.id,
                    instanceName: selected.name,
                    kind: "catchment",
                    points: [],
                  },
            );
          }}
          className={cn(
            "flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium",
            drawArea
              ? "bg-brand-soft text-brand-deep"
              : "border border-line bg-white text-ink-body hover:border-brand disabled:text-ink-ghost",
          )}
        >
          <Hexagon className="h-3.5 w-3.5" />
          Draw area
        </button>
        <button
          type="button"
          disabled={!env || !MAPBOX_TOKEN}
          onClick={() => setShowCoverage(true)}
          title="Overlaps between areas, and sites covered by none"
          className="flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink-body hover:border-brand disabled:text-ink-ghost"
        >
          <Shapes className="h-3.5 w-3.5" />
          Coverage
          {shapes.length > 0 ? (
            <span className="rounded bg-canvas px-1 text-[10px] tabular-nums text-ink-muted">
              {shapes.length}
            </span>
          ) : null}
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-700">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-[440px] flex-1">
        {/* Collapsed: a rail wide enough for one button. The map is the reason
            this screen exists, and on a laptop the panel costs it a fifth of
            its width. */}
        {!railOpen ? (
          <div className="flex w-8 shrink-0 flex-col items-center border-r border-[#d3d8de] bg-white pt-2">
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              aria-label="Show the panel"
              title="Show layers, saved views and the explorer"
              className="rounded p-1 text-[#5f6b7c] hover:bg-[#f6f7f9] hover:text-[#2d72d2]"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {/* Layers rail */}
        <aside
          className={cn(
            "shrink-0 flex-col border-r border-[#d3d8de] bg-white",
            railOpen ? "flex w-72" : "hidden",
          )}
        >
          {/* Tabs rather than three stacked sections: each one gets the whole
              panel height instead of a share of it, and the explorer is a tree
              of 241 rows that a 42% slice made unusable. */}
          <div className="flex shrink-0 items-center gap-0.5 border-b border-[#e5e8eb] px-1 py-1">
            {(
              [
                ["explorer", "Explorer"],
                ["layers", "Layers"],
                ["views", "Views"],
                ["replay", "Replay"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanelTab(id)}
                className={cn(
                  "rounded px-2 py-1 text-[11px]",
                  panelTab === id
                    ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                    : "text-[#5f6b7c] hover:bg-[#f6f7f9]",
                )}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              aria-label="Hide the panel"
              title="Hide the panel"
              className="ml-auto rounded p-1 text-[#8f99a8] hover:bg-[#f6f7f9] hover:text-[#1c2127]"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-2",
              panelTab === "explorer" && "hidden",
            )}
          >
          {panelTab === "layers" ? (
          <>
          <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Layers
          </p>
          {flowLayers.length === 0 ? (
            <p className="px-2 py-1 text-[10.5px] leading-snug text-ink-faint">
              No link runs between two sites yet. Every link type that does becomes a layer here.
            </p>
          ) : (
            flowLayers.map(({ linkType, count }) => {
              const on = layers[linkType] !== false;
              const style = styles.get(linkType) ?? LAYER_STYLES[0]!;
              return (
                <button
                  key={linkType}
                  type="button"
                  title={`${linkType} · ${count} link${count === 1 ? "" : "s"}`}
                  onClick={() => setLayers((cur) => ({ ...cur, [linkType]: !on }))}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-canvas",
                    on ? "text-ink" : "text-ink-faint",
                  )}
                >
                  <span
                    className="h-[3px] w-4 shrink-0 rounded"
                    style={{ background: on ? style.color : "#d3d8de" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{linkType}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{count}</span>
                </button>
              );
            })
          )}
          <p className="px-2 pt-3 text-[10px] leading-relaxed text-[#8f99a8]">
            node ring = alert severity · badge = occupancy · arcs = flows between sites
          </p>
          </>
          ) : null}

          {panelTab === "views" ? (
          <>
          <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
            Saved views
          </p>
          {savedViews.length === 0 ? (
            <p className="px-2 py-1 text-[10.5px] text-[#8f99a8]">
              none yet — frame the map, then save
            </p>
          ) : (
            savedViews.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => applyView(v)}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#404854] hover:bg-[#f6f7f9]"
              >
                <Eye className="h-3 w-3 shrink-0 text-[#8f99a8]" />
                <span className="truncate">{v.name}</span>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={saveCurrentView}
            className="mt-1 flex items-center gap-1.5 rounded border border-dashed border-[#c5cbd3] px-2 py-1 text-[11px] text-[#5f6b7c] hover:border-[#2d72d2] hover:text-[#2d72d2]"
          >
            <Save className="h-3 w-3" />
            save current view
          </button>
          </>
          ) : null}
          </div>

          {/* The hierarchy, browsable. The eye hides a branch; "only" keeps one
              and hides every other — which is the gesture you actually want
              when you say "show me Centre-Sud": its 59 installations stay, the
              other 131 go. */}
          {panelTab === "replay" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ReplayPanel env={env} twinScenarioId={null} onFrame={setReplayFrame} />
            </div>
          ) : null}

          <div className={cn("min-h-0 flex-1 flex-col", panelTab === "explorer" ? "flex" : "hidden")}>
            {/* Three ways to group the same 190 installations, because they are
                three different questions. Only one of them has boundaries the
                map can honestly draw. */}
            <div className="shrink-0 border-b border-line px-2 pb-1.5 pt-2">
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-ink-faint">
                Group by
              </label>
              <select
                value={axis}
                onChange={(e) => setAxis(e.target.value as GroupingAxis)}
                aria-label="Grouping axis"
                className="w-full rounded border border-line px-2 py-1 text-[11px] text-ink focus:border-brand focus:outline-none"
              >
                {AXES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] leading-snug text-ink-faint">
                {AXES.find((a) => a.id === axis)?.hint}
              </p>
            </div>
            <TreeExplorer
              items={tree}
              selectedId={selectedId}
              onSelect={setSelectedId}
              hidden={hiddenIds}
              onToggleHidden={(ids, hide) =>
                setHiddenIds((cur) => {
                  const next = new Set(cur);
                  for (const id of ids) {
                    if (hide) next.add(id);
                    else next.delete(id);
                  }
                  return next;
                })
              }
              onSolo={(ids) => {
                const keep = new Set(ids);
                const all = new Set<string>();
                const walk = (list: TreeItem[]) => {
                  for (const i of list) {
                    all.add(i.id);
                    if (i.children) walk(i.children);
                  }
                };
                walk(tree);
                setHiddenIds(new Set(Array.from(all).filter((id) => !keep.has(id))));
              }}
              emptyLabel="No units yet. Import or declare an OrgUnit to see the network here."
            />
          </div>
        </aside>

        {/* Map */}
        <div className="relative min-h-[440px] min-w-0 flex-1">
          {!MAPBOX_TOKEN ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-md rounded-md border border-[#d3d8de] bg-white p-5 text-sm text-[#404854]">
                <p className="mb-2 font-semibold text-[#1c2127]">Mapbox token missing</p>
                <p className="mb-2 text-xs leading-relaxed">
                  Add <code className="rounded bg-[#f6f7f9] px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code>{" "}
                  to <code className="rounded bg-[#f6f7f9] px-1">frontend/.env.local</code> and to
                  the Vercel project environment variables, then restart / redeploy.
                </p>
                <p className="text-xs text-[#8f99a8]">
                  Create a public token at mapbox.com → Access tokens (default public scopes).
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Sized directly: mapbox-gl.css forces position:relative on this
                  element, which would defeat absolute/inset positioning. */}
              <div ref={containerRef} className="h-full w-full" style={{ minHeight: 440 }} />
              <div className="absolute right-2 top-2 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={toggleProjection}
                  title={projection === "globe" ? "Switch to flat map" : "Switch to globe"}
                  className="flex h-8 w-8 items-center justify-center rounded border border-[#d3d8de] bg-white text-[#404854] shadow-sm hover:border-[#2d72d2]"
                >
                  {projection === "globe" ? (
                    <MapIcon className="h-4 w-4" />
                  ) : (
                    <Globe2 className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={toggleStyle}
                  title={styleMode === "standard" ? "Satellite imagery" : "3D standard style"}
                  className="flex h-8 w-8 items-center justify-center rounded border border-[#d3d8de] bg-white text-[#404854] shadow-sm hover:border-[#2d72d2]"
                >
                  {styleMode === "standard" ? (
                    <Satellite className="h-4 w-4" />
                  ) : (
                    <Mountain className="h-4 w-4" />
                  )}
                </button>
              </div>
              {pendingPos ? (
                <div className="absolute left-1/2 top-6 z-20 w-72 -translate-x-1/2 rounded-md border border-[#d3d8de] bg-white p-3 shadow-lg">
                  <p className="mb-2 text-xs font-semibold text-[#1c2127]">New site</p>
                  <input
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    placeholder="e.g. Hôpital Nord"
                    autoFocus
                    className="mb-2 w-full rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1.5 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none"
                  />
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      value={siteKind}
                      onChange={(e) => setSiteKind(e.target.value)}
                      className="flex-1 rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1.5 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none"
                    >
                      <option value="hospital">Hospital</option>
                      <option value="clinic">Clinic</option>
                      <option value="lab">Lab</option>
                      <option value="pharmacy">Pharmacy</option>
                      <option value="supplier">Supplier</option>
                      <option value="other">Other</option>
                    </select>
                    <span className="text-[10px] text-[#8f99a8]">
                      {pendingPos[1].toFixed(4)}, {pendingPos[0].toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingPos(null)}
                      className="rounded border border-[#d3d8de] px-2.5 py-1 text-xs text-[#404854]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingSite}
                      onClick={() => void createSite()}
                      className="rounded bg-[#2d72d2] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
                    >
                      {savingSite ? "Creating…" : "Create site"}
                    </button>
                  </div>
                </div>
              ) : null}

              {drawArea ? (
                <div className="absolute left-1/2 top-6 z-20 w-80 -translate-x-1/2 rounded-md border border-line bg-white p-3 shadow-lg">
                  <p className="mb-1 text-xs font-semibold text-ink">
                    Area for {drawArea.instanceName}
                  </p>
                  <p className="mb-2 text-[10.5px] leading-relaxed text-ink-faint">
                    Click the map to place corners — clicking a site snaps to it. Backspace undoes
                    the last one.
                  </p>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
                    What this area means
                  </label>
                  <input
                    value={drawArea.kind}
                    onChange={(e) =>
                      setDrawArea((cur) => (cur ? { ...cur, kind: e.target.value } : cur))
                    }
                    placeholder="catchment"
                    className="mb-1 w-full rounded border border-line bg-canvas px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
                  />
                  <p className="mb-2 text-[10px] leading-relaxed text-ink-faint">
                    Free text, like a signal&apos;s domain — &ldquo;catchment&rdquo;, &ldquo;exclusion
                    zone&rdquo;, &ldquo;corridor&rdquo;. Coverage reports can filter on it.
                  </p>
                  <div className="mb-2 flex items-center justify-between text-[10.5px] text-ink-muted">
                    <span>{drawArea.points.length} corners</span>
                    <span>
                      {pointsStillNeeded(drawArea.points) > 0
                        ? `${pointsStillNeeded(drawArea.points)} more needed`
                        : "ready"}
                    </span>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDrawArea(null)}
                      className="rounded border border-line px-2.5 py-1 text-xs text-ink-body"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingShape || pointsStillNeeded(drawArea.points) > 0}
                      onClick={() => void saveArea()}
                      className="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
                    >
                      {savingShape ? "Saving…" : "Save area"}
                    </button>
                  </div>
                </div>
              ) : null}

              {pendingFlow ? (
                <FlowPanel
                  fromName={nameOfSite(pendingFlow.fromId)}
                  toName={nameOfSite(pendingFlow.toId)}
                  fromType={
                    network?.sites.find((s) => s.id === pendingFlow.fromId)?.objectType ?? null
                  }
                  toType={network?.sites.find((s) => s.id === pendingFlow.toId)?.objectType ?? null}
                  linkTypes={linkTypes}
                  busy={savingFlow}
                  onCancel={() => setPendingFlow(null)}
                  onSave={(name, createType) => void saveFlow(name, createType)}
                />
              ) : null}
              {/* The legend used to name patients / supplies / data — the three
                  lanes the server once matched by regex. Lanes are the
                  ontology's link types now, and they are listed in the rail
                  with their own colours, so naming three fixed ones here was
                  simply wrong. */}
              <div className="absolute bottom-2 left-2 flex gap-3 rounded border border-line bg-white/90 px-2.5 py-1 text-[10px] text-ink-muted">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-ok" />
                  site
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-[3px] w-3 rounded bg-ink-faint" />
                  flow · see rail
                </span>
                {shapes.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-3 rounded-sm border border-ink-body bg-ink-muted/10" />
                    area
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Inspector */}
        {selected ? (
          <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-l border-[#d3d8de] bg-white p-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  selected.worstAlertSeverity === "critical"
                    ? "bg-rose-500"
                    : selected.worstAlertSeverity === "warn"
                      ? "bg-amber-400"
                      : "bg-emerald-500",
                )}
              />
              <span className="text-[13px] font-semibold text-[#1c2127]">{selected.name}</span>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="ml-auto text-[#8f99a8] hover:text-[#1c2127]"
                aria-label="Close inspector"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mb-2 text-[10.5px] text-[#8f99a8]">{selected.kind}</p>
            <MetricRow
              label="Occupancy"
              value={
                selected.metrics.occupancyPct !== null
                  ? `${Math.round(selected.metrics.occupancyPct)}%`
                  : "—"
              }
              danger={(selected.metrics.occupancyPct ?? 0) >= 95}
            />
            <MetricRow
              label="Linked instances"
              value={selected.metrics.linkedInstanceCount.toLocaleString()}
            />
            <MetricRow
              label="Data freshness"
              value={
                selected.metrics.freshnessSeconds !== null
                  ? `${Math.round(selected.metrics.freshnessSeconds)} s`
                  : "—"
              }
            />
            {selectedShape ? (
              <MetricRow
                label={selectedShape.kind}
                value={formatArea(selectedShape.areaM2)}
              />
            ) : null}

            {/* Where the numbers above come from.
                A site's figures are the sum of the units placed in it, and only
                the topmost ones — a ward inside a hospital at the same address
                is already counted through the hospital. Showing the list is how
                you tell a real 82% from a plausible one. */}
            {selected.contributingUnits.length > 0 ? (
              <>
                <p className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
                  Counted from · {selected.contributingUnits.length}
                </p>
                {selected.contributingUnits.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-1.5 border-b border-line-faint py-1 last:border-0 text-[11px] text-ink-body"
                  >
                    <span className="h-1 w-1 shrink-0 rounded-full bg-ink-ghost" />
                    <span className="min-w-0 truncate">{u.name}</span>
                  </div>
                ))}
                <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
                  Units placed here. Anything inside one of them is already included.
                </p>
              </>
            ) : null}
            {selectedFlows.length === 0 ? (
              <MetricRow label="Flows" value="none" last />
            ) : (
              selectedFlows.map((f, i) => (
                <MetricRow
                  key={f.linkType}
                  label={f.linkType}
                  value={String(f.count)}
                  last={i === selectedFlows.length - 1}
                />
              ))
            )}

            <p className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
              Open alerts · {selectedAlerts.length}
            </p>
            {selectedAlerts.slice(0, 4).map((a) => (
              <div
                key={a.id}
                className={cn(
                  "mb-1.5 rounded border px-2 py-1.5",
                  a.severity === "critical"
                    ? "border-rose-200 bg-rose-50"
                    : "border-amber-200 bg-amber-50",
                )}
              >
                <p
                  className={cn(
                    "text-[10.5px] font-medium",
                    a.severity === "critical" ? "text-rose-700" : "text-amber-700",
                  )}
                >
                  {a.message}
                </p>
              </div>
            ))}
            {selectedAlerts.length === 0 ? (
              <p className="text-[10.5px] text-[#8f99a8]">none</p>
            ) : null}

            <div className="mt-auto flex flex-col gap-1.5 pt-3">
              <button
                type="button"
                onClick={() => setPlacing({ mode: "move", siteId: selected.id })}
                className="flex items-center gap-1.5 rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs text-[#404854] hover:border-[#2d72d2]"
              >
                <MapPin className="h-3.5 w-3.5" />
                Edit location
              </button>
              <button
                type="button"
                onClick={onDrillIn}
                className="flex items-center gap-1.5 rounded bg-[#2d72d2] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#215db0]"
              >
                <Building2 className="h-3.5 w-3.5" />
                Open unit canvas
              </button>
              <Link
                href="/studio/flux"
                className="flex items-center gap-1.5 rounded border border-[#d3d8de] px-2.5 py-1.5 text-xs text-[#404854] hover:border-[#2d72d2]"
              >
                <HeartPulse className="h-3.5 w-3.5" />
                Data health
              </Link>
            </div>
          </aside>
        ) : null}
      </div>

      {showCoverage && env ? (
        <CoverageDialog
          env={env}
          capability={capability}
          shapes={shapes}
          onFlyTo={flyToShape}
          onDeleted={() => void loadShapes()}
          onClose={() => setShowCoverage(false)}
        />
      ) : null}

      {/* Event timeline */}
      <EventTimeline
        alerts={alerts}
        feedEvents={feedEvents}
        windowHours={windowHours}
        onWindow={setWindowHours}
      />
    </div>
  );
}

function MetricRow({
  label,
  value,
  danger,
  last,
}: {
  label: string;
  value: string;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-1 text-[11px]",
        !last && "border-b border-[#eef1f4]",
      )}
    >
      <span className="text-[#8f99a8]">{label}</span>
      <span className={cn("font-medium", danger ? "text-rose-600" : "text-[#1c2127]")}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-lane event timeline (alerts + feed activity)
// ---------------------------------------------------------------------------

function EventTimeline({
  alerts,
  feedEvents,
  windowHours,
  onWindow,
}: {
  alerts: TwinAlert[];
  feedEvents: { id: string; receivedAt: string }[];
  windowHours: number;
  onWindow: (h: number) => void;
}) {
  const now = Date.now();
  const start = now - windowHours * 3_600_000;
  const W = 900;
  const x = (iso: string) => {
    const t = new Date(iso).getTime();
    return 70 + ((W - 80) * Math.max(0, Math.min(1, (t - start) / (now - start))));
  };

  const alertEvents = alerts
    .filter((a) => a.createdAt && new Date(a.createdAt).getTime() >= start)
    .slice(0, 60);
  const feeds = feedEvents.filter((e) => new Date(e.receivedAt).getTime() >= start);

  return (
    <div className="shrink-0 border-t border-[#d3d8de] bg-white px-4 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-[#1c2127]">Event timeline</span>
        {[24, 72].map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onWindow(h)}
            className={cn(
              "rounded px-2 py-0.5 text-[10.5px]",
              windowHours === h
                ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                : "border border-[#d3d8de] text-[#8f99a8]",
            )}
          >
            {h} h
          </button>
        ))}
        <span className="ml-auto text-[10.5px] text-[#8f99a8]">
          {alertEvents.length} alerts · {feeds.length} feed events in window
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} 64`}
        className="w-full"
        role="img"
        aria-label="Timeline lanes for alerts and feed events"
      >
        <line x1={70} y1={18} x2={W - 10} y2={18} stroke="#e5e8eb" strokeWidth="1" />
        <line x1={70} y1={46} x2={W - 10} y2={46} stroke="#e5e8eb" strokeWidth="1" />
        <text x={4} y={21} fontSize="9" fill="#8f99a8">
          ALERTS
        </text>
        <text x={4} y={49} fontSize="9" fill="#8f99a8">
          FEEDS
        </text>
        <text x={70} y={62} fontSize="8.5" fill="#8f99a8">
          −{windowHours} h
        </text>
        <text x={W - 10} y={62} textAnchor="end" fontSize="8.5" fill="#8f99a8">
          now
        </text>
        {alertEvents.map((a) => (
          <circle
            key={a.id}
            cx={x(a.createdAt!)}
            cy={18}
            r={a.severity === "critical" ? 5 : 4}
            fill={
              a.severity === "critical"
                ? "#e11d48"
                : a.severity === "warn"
                  ? "#d97706"
                  : "#2d72d2"
            }
            opacity="0.85"
          >
            <title>{a.message}</title>
          </circle>
        ))}
        {feeds.map((e) => (
          <rect key={e.id} x={x(e.receivedAt) - 1} y={41} width={2} height={10} fill="#2d72d2" opacity="0.6">
            <title>ingest event · {new Date(e.receivedAt).toLocaleString()}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/**
 * Confirm a flow between two sites.
 *
 * The relationship list is filtered to link types whose declared from/to match
 * the two sites' object types — the server does not check that today, so the
 * tool has to. Defining a new relationship is separated behind its own control
 * because it edits the schema: an instance is a fact you can delete, a link
 * type is a rule every environment in the organization inherits.
 */
function FlowPanel({
  fromName,
  toName,
  fromType,
  toType,
  linkTypes,
  busy,
  onCancel,
  onSave,
}: {
  fromName: string;
  toName: string;
  fromType: string | null;
  toType: string | null;
  linkTypes: EnvLinkType[];
  busy: boolean;
  onCancel: () => void;
  onSave: (relationship: string, createType: boolean) => void;
}) {
  const usable = linkTypes.filter(
    (lt) => lt.fromType === fromType && lt.toType === toType,
  );
  const [defining, setDefining] = useState(usable.length === 0);
  const [existing, setExisting] = useState(usable[0]?.name ?? "");
  const [fresh, setFresh] = useState("");

  const relationship = defining ? fresh.trim() : existing;
  const duplicate =
    defining && linkTypes.some((lt) => lt.name === fresh.trim());
  const ready =
    relationship !== "" && !busy && !duplicate && (!defining || (!!fromType && !!toType));

  const field =
    "w-full rounded border border-[#d3d8de] bg-[#f6f7f9] px-2 py-1.5 text-xs text-[#1c2127] focus:border-[#2d72d2] focus:outline-none";

  return (
    <div className="absolute left-1/2 top-6 z-20 w-80 -translate-x-1/2 rounded-md border border-[#d3d8de] bg-white p-3 shadow-lg">
      <p className="text-xs font-semibold text-[#1c2127]">New flow</p>
      <p className="mb-2 mt-0.5 text-[11px] leading-snug text-[#5f6b7c]">
        {fromName} → {toName}
      </p>

      {!defining ? (
        <>
          <select
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
            className={cn(field, "mb-2")}
          >
            {usable.map((lt) => (
              <option key={lt.id} value={lt.name}>
                {lt.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDefining(true)}
            className="mb-2 text-[11px] text-[#2d72d2] hover:underline"
          >
            define a new relationship
          </button>
        </>
      ) : (
        <>
          <input
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
            placeholder="e.g. transfers_to"
            autoFocus
            className={cn(field, "mb-1.5")}
          />
          {fromType && toType ? (
            <p className="mb-2 rounded bg-[#fdf6ec] px-2 py-1.5 text-[10.5px] leading-snug text-[#935610]">
              This adds <b className="font-semibold">{fromType} → {toType}</b> to the ontology
              schema. Every environment in your organization gets it.
            </p>
          ) : (
            <p className="mb-2 rounded bg-[#fdf1f1] px-2 py-1.5 text-[10.5px] leading-snug text-[#a82255]">
              One of these sites has no object type on record, so a new relationship cannot be
              defined from here.
            </p>
          )}
          {duplicate ? (
            <p className="mb-2 text-[10.5px] text-[#a82255]">
              A link type already goes by that name.
            </p>
          ) : null}
          {usable.length > 0 ? (
            <button
              type="button"
              onClick={() => setDefining(false)}
              className="mb-2 text-[11px] text-[#2d72d2] hover:underline"
            >
              use an existing relationship
            </button>
          ) : null}
        </>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-[#d3d8de] px-2.5 py-1 text-xs text-[#404854]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onSave(relationship, defining)}
          className="rounded bg-[#2d72d2] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#215db0] disabled:bg-[#c5cbd3]"
        >
          {busy ? "Saving…" : defining ? "Define & draw" : "Draw flow"}
        </button>
      </div>
    </div>
  );
}
