"use client";

/**
 * Live twin · network — Mapbox globe of the healthcare network.
 *
 * Root twin units render as geolocated sites (occupancy badge, alert ring);
 * ontology links between sites render as typed flow arcs (patient / supply /
 * data). Layers panel with saved views, globe ↔ flat toggle, 3D standard ↔
 * satellite styles, an inspector with drill-in to the unit command canvas,
 * and a multi-lane event timeline (alerts + feed activity).
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
  Loader2,
  Map as MapIcon,
  MapPin,
  Mountain,
  Plus,
  RefreshCw,
  Satellite,
  Save,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import {
  createEnvObject,
  createEnvType,
  fetchTwinNetwork,
  getEnvObject,
  listIngestEvents,
  listTwinAlerts,
  updateEnvObject,
  updateEnvType,
  type TwinAlert,
  type TwinFlowKind,
  type TwinNetworkSite,
  type TwinNetworkSnapshot,
} from "@/lib/platform-api";
import { useStudio } from "../StudioShell";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const STYLE_STANDARD = "mapbox://styles/mapbox/standard";
const STYLE_SATELLITE = "mapbox://styles/mapbox/satellite-streets-v12";
const MONTREAL: [number, number] = [-73.5673, 45.5017];

const FLOW_STYLE: Record<TwinFlowKind, { color: string; width: number; dash?: number[] }> = {
  patient: { color: "#2d72d2", width: 3 },
  supply: { color: "#d97706", width: 2.5, dash: [1.5, 1.5] },
  data: { color: "#6b3fa0", width: 1.6, dash: [0.8, 2.2] },
  other: { color: "#64748b", width: 1.4, dash: [2, 2] },
};

interface LayerToggles {
  patient: boolean;
  supply: boolean;
  data: boolean;
  other: boolean;
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

interface SavedView {
  name: string;
  layers: LayerToggles;
  projection: "globe" | "mercator";
  styleMode: "standard" | "satellite";
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
}

function viewsKey(env: string): string {
  return `obs_twin_views_v1:${env}`;
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
  const [layers, setLayers] = useState<LayerToggles>({
    patient: true,
    supply: true,
    data: true,
    other: true,
  });
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

  mapClickRef.current = (lng: number, lat: number) => {
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
    if (canvas) canvas.style.cursor = placing ? "crosshair" : "";
  }, [placing]);

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
      const [net, al, ev] = await Promise.all([
        fetchTwinNetwork(env),
        listTwinAlerts(env, { limit: 100 }).catch(() => ({ alerts: [] as TwinAlert[] })),
        listIngestEvents().catch(() => ({ events: [] })),
      ]);
      setNetwork(net);
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

  function ensureFlowLayers(map: MapboxMap) {
    for (const kind of Object.keys(FLOW_STYLE) as TwinFlowKind[]) {
      const id = `twin-flow-${kind}`;
      if (!map.getSource(id)) {
        map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getLayer(id)) {
        const style = FLOW_STYLE[kind];
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
  }

  const positions = useMemo(() => {
    const m = new Map<string, [number, number]>();
    network?.sites.forEach((s, i) => m.set(s.id, sitePosition(s, i)));
    return m;
  }, [network]);

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
        const pos = positions.get(site.id)!;
        const el = document.createElement("div");
        const occ = site.metrics.occupancyPct;
        const sev = site.worstAlertSeverity;
        const ring =
          sev === "critical" ? "#e11d48" : sev === "warn" ? "#d97706" : "#059669";
        el.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;">
            <div style="font-size:11px;font-weight:600;color:#1c2127;background:rgba(255,255,255,0.9);padding:1px 6px;border-radius:4px;margin-bottom:2px;white-space:nowrap;">${site.name}</div>
            <div style="width:38px;height:38px;border-radius:50%;background:#fff;border:3px solid ${ring};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${ring};box-shadow:0 1px 4px rgba(0,0,0,0.25);">
              ${occ !== null ? `${Math.round(occ)}%` : "—"}
            </div>
            ${site.openAlertCount > 0 ? `<div style="margin-top:2px;font-size:9px;font-weight:600;color:#fff;background:${ring};border-radius:6px;padding:0 5px;">${site.openAlertCount} alert${site.openAlertCount === 1 ? "" : "s"}</div>` : ""}
          </div>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setSelectedId(site.id);
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
  }, [network, mapReady, positions]);

  // Flow arcs: update sources when flows or toggles change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !network) return;
    ensureFlowLayers(map);
    for (const kind of Object.keys(FLOW_STYLE) as TwinFlowKind[]) {
      const source = map.getSource(`twin-flow-${kind}`) as
        | { setData: (d: FlowFeatureCollection) => void }
        | undefined;
      if (!source) continue;
      const features = layers[kind]
        ? network.flows
            .filter((f) => f.kind === kind)
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
  }, [network, mapReady, layers, positions, styleMode]);

  // --- toolbar actions -----------------------------------------------------------

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

  // --- derived -------------------------------------------------------------------

  const selected = network?.sites.find((s) => s.id === selectedId) ?? null;
  const selectedAlerts = useMemo(
    () => alerts.filter((a) => a.unitInstanceId === selectedId),
    [alerts, selectedId],
  );
  const selectedFlows = useMemo(() => {
    if (!network || !selectedId) return { patient: 0, supply: 0, data: 0, other: 0 };
    const counts = { patient: 0, supply: 0, data: 0, other: 0 };
    for (const f of network.flows) {
      if (f.fromId === selectedId || f.toId === selectedId) counts[f.kind]++;
    }
    return counts;
  }, [network, selectedId]);

  const missingCoords = network?.sites.filter((s) => s.latitude === null).length ?? 0;

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
            live · {network.sites.length} site{network.sites.length === 1 ? "" : "s"}
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
        {/* Layers rail */}
        <aside className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-[#d3d8de] bg-white p-2">
          <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
            Layers
          </p>
          {(
            [
              ["patient", "Patient flows", "#2d72d2"],
              ["supply", "Supply shipments", "#d97706"],
              ["data", "Data feeds", "#6b3fa0"],
              ["other", "Other links", "#64748b"],
            ] as const
          ).map(([key, label, color]) => (
            <button
              key={key}
              type="button"
              onClick={() => setLayers((cur) => ({ ...cur, [key]: !cur[key] }))}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                layers[key] ? "text-[#1c2127]" : "text-[#8f99a8]",
                "hover:bg-[#f6f7f9]",
              )}
            >
              <span
                className="h-[3px] w-4 shrink-0 rounded"
                style={{ background: layers[key] ? color : "#d3d8de" }}
              />
              {label}
            </button>
          ))}
          <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f99a8]">
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
          <p className="mt-auto px-2 pt-3 text-[10px] leading-relaxed text-[#8f99a8]">
            node ring = alert severity · badge = occupancy · arcs = flows between sites
          </p>
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
                    <span className="font-mono text-[10px] text-[#8f99a8]">
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
              <div className="absolute bottom-2 left-2 flex gap-3 rounded border border-[#d3d8de] bg-white/90 px-2.5 py-1 text-[10px] text-[#5f6b7c]">
                <span className="flex items-center gap-1">
                  <span className="h-[3px] w-3 rounded bg-[#2d72d2]" />
                  patients
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-[3px] w-3 rounded bg-[#d97706]" />
                  supplies
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-[3px] w-3 rounded bg-[#6b3fa0]" />
                  data
                </span>
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
            <MetricRow label="Patient flows" value={String(selectedFlows.patient)} />
            <MetricRow label="Supply flows" value={String(selectedFlows.supply)} />
            <MetricRow label="Data flows" value={String(selectedFlows.data)} last />

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
