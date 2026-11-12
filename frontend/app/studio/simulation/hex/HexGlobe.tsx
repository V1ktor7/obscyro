"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { cellToBoundary, cellToChildren, cellToParent, getHexagonEdgeLengthAvg, getRes0Cells } from "h3-js";
import { Globe2, Minus, Plus, Scan } from "lucide-react";
import type { Feature, FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from "react";

import { cn } from "@/lib/cn";

import { GLOBE_ZOOM, MAPBOX_TOKEN, STYLE_STANDARD } from "../../map-style";
import type { HexGrid } from "./hex-grid";

/**
 * The scenario map: H3 hexagons over the whole globe, on the same Mapbox globe
 * as Units.
 *
 * Two tilings are drawn. The planet's, in outline only, so the globe reads as
 * one surface of cells everywhere — and empty, because the twin has nothing to
 * say about Lagos. And the twin's own, coloured, where the twin has cells.
 *
 * The twin's cells change size with the zoom. At the scale of a continent a
 * cell of a city block is under a pixel, so the cells are regrouped into their
 * H3 parents two and four levels up; each parent takes the colour most of its
 * children have. Taps land on the finest level only, because that is the level
 * the engine reads — a tap on a coarse cell zooms in to it instead.
 *
 * The map opens on the whole globe and stays there. Nothing flies down on its
 * own: the reader decides where to look.
 */

export interface GlobeSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  colour: string;
  /** Text drawn beside the site when sites are few enough to be labelled. */
  label: string | null;
}

export interface GlobeArea {
  id: string;
  lat: number;
  lon: number;
  radiusKm: number;
  label: string;
  /** In force on the day shown. */
  active: boolean;
}

export interface GlobeSeed {
  id: string;
  lat: number;
  lon: number;
}

type Ring = [number, number][];
type Fc = FeatureCollection;

const EMPTY_FC: Fc = { type: "FeatureCollection", features: [] };
/** How many levels of regrouping the twin's cells get, at most. */
const LEVELS = 3;
/** A level of cells is shown from the zoom at which its cells are this wide, in pixels. */
const MIN_CELL_PX = 8;

/**
 * A cell's outline as GeoJSON, or null for the handful a single ring cannot
 * draw. A cell across the antimeridian is shifted onto continuous longitudes;
 * a cell around a pole has no such fix, and is left out rather than drawn as a
 * band across the whole map.
 */
function ringOf(h3: string): Ring | null {
  const ring = cellToBoundary(h3, true) as Ring;
  const spread = (r: Ring) => {
    const lons = r.map((p) => p[0]);
    return Math.max(...lons) - Math.min(...lons);
  };
  if (spread(ring) <= 180) return ring;
  const shifted = ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat] as [number, number]);
  return spread(shifted) <= 180 ? shifted : null;
}

function polygon(ring: Ring, properties: Record<string, unknown>): Feature {
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** The planet's tiling at H3 levels 1 and 2, built once. */
let worldTiling: Fc | null = null;
function world(): Fc {
  if (worldTiling) return worldTiling;
  const features: Feature[] = [];
  const roots = getRes0Cells();
  for (const r of [1, 2])
    for (const c of roots.flatMap((root) => cellToChildren(root, r))) {
      const ring = ringOf(c);
      if (ring) features.push(polygon(ring, { r }));
    }
  worldTiling = { type: "FeatureCollection", features };
  return worldTiling;
}

/** The zoom from which cells of an H3 level are at least MIN_CELL_PX wide at this latitude. */
function zoomFor(res: number, lat: number): number {
  const edge = getHexagonEdgeLengthAvg(res, "m");
  return Math.log2((MIN_CELL_PX * 156543.03 * Math.cos((lat * Math.PI) / 180)) / edge);
}

/** A circle on the ground, as a polygon of 64 points. */
function circle(lat: number, lon: number, km: number): Ring {
  const R = 6371;
  const phi1 = (lat * Math.PI) / 180;
  const lam1 = (lon * Math.PI) / 180;
  const dist = km / R;
  const out: Ring = [];
  for (let k = 0; k <= 64; k++) {
    const brg = (2 * Math.PI * k) / 64;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(dist) + Math.cos(phi1) * Math.sin(dist) * Math.cos(brg));
    const lam2 = lam1 + Math.atan2(Math.sin(brg) * Math.sin(dist) * Math.cos(phi1), Math.cos(dist) - Math.sin(phi1) * Math.sin(phi2));
    out.push([(lam2 * 180) / Math.PI, (phi2 * 180) / Math.PI]);
  }
  return out;
}

/** What the buttons beside the globe can ask of it. */
export interface GlobeHandle {
  zoomIn(): void;
  zoomOut(): void;
  /** Back out to the whole planet, turned towards the network. */
  whole(): void;
  /** Frame every cell of the twin. */
  fit(): void;
}

const HexGlobe = forwardRef<GlobeHandle, {
  grid: HexGrid;
  /** Fill of each of the grid's cells, by index. */
  colours: string[];
  /** The colour that means "nothing here", which never wins a regrouping. */
  emptyColour: string;
  selected: number | null;
  sites: GlobeSite[];
  areas: GlobeArea[];
  seeds: GlobeSeed[];
  onTap: (index: number) => void;
  className?: string;
}>(function HexGlobe({ grid, colours, emptyColour, selected, sites, areas, seeds, onTap, className }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const centre = useMemo(() => {
    const n = grid.hexes.length || 1;
    return {
      lat: grid.hexes.reduce((s, h) => s + h.lat, 0) / n,
      lon: grid.hexes.reduce((s, h) => s + h.lon, 0) / n,
    };
  }, [grid]);
  const centreRef = useRef(centre);
  centreRef.current = centre;

  // The twin's levels, finest first, and the zoom range each is shown at.
  const levels = useMemo(() => {
    const res = [grid.res, grid.res - 2, grid.res - 4].filter((r) => r >= 0).slice(0, LEVELS);
    return res.map((r, k) => ({
      res: r,
      min: k === res.length - 1 ? 0 : zoomFor(r, centre.lat),
      max: k === 0 ? 24 : zoomFor(res[k - 1]!, centre.lat),
    }));
  }, [grid, centre.lat]);
  const fineZoomRef = useRef(0);
  fineZoomRef.current = levels[0]?.min ?? 0;

  const cells = useMemo((): Fc => {
    const features: Feature[] = [];
    for (const h of grid.hexes) {
      const ring = ringOf(h.h3);
      if (ring) features.push(polygon(ring, { i: h.index, l: 0, c: colours[h.index] ?? emptyColour }));
    }
    levels.slice(1).forEach(({ res }, k) => {
      const tally = new Map<string, Map<string, number>>();
      for (const h of grid.hexes) {
        const parent = cellToParent(h.h3, res);
        const counts = tally.get(parent) ?? new Map<string, number>();
        const c = colours[h.index] ?? emptyColour;
        counts.set(c, (counts.get(c) ?? 0) + 1);
        tally.set(parent, counts);
      }
      tally.forEach((counts, parent) => {
        // The colour most children have, among those that say something: a
        // parent half empty and half red is red, not grey.
        let pick = emptyColour;
        let most = 0;
        counts.forEach((n, c) => {
          if (c !== emptyColour && n > most) {
            most = n;
            pick = c;
          }
        });
        const ring = ringOf(parent);
        if (ring) features.push(polygon(ring, { i: -1, l: k + 1, c: pick }));
      });
    });
    return { type: "FeatureCollection", features };
  }, [grid, colours, emptyColour, levels]);

  // --- the map, created once ------------------------------------------------

  useEffect(() => {
    if (!MAPBOX_TOKEN || !hostRef.current || mapRef.current) return;
    let cancelled = false;
    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !hostRef.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({
        container: hostRef.current,
        style: STYLE_STANDARD,
        center: [centreRef.current.lon, centreRef.current.lat],
        zoom: GLOBE_ZOOM,
        projection: "globe",
        attributionControl: true,
      });
      mapRef.current = map;

      map.on("style.load", () => {
        if (cancelled) return;
        map.setProjection("globe");
        const add = (id: string, data: Fc) => {
          if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
        };
        add("hex-world", world());
        add("hex-cells", EMPTY_FC);
        add("hex-areas", EMPTY_FC);
        add("hex-sites", EMPTY_FC);
        add("hex-seeds", EMPTY_FC);

        const layer = (spec: Parameters<MapboxMap["addLayer"]>[0]) => {
          if (!map.getLayer((spec as { id: string }).id)) map.addLayer(spec);
        };
        layer({
          id: "hex-world-1",
          type: "line",
          source: "hex-world",
          filter: ["==", ["get", "r"], 1],
          maxzoom: 2.6,
          paint: { "line-color": "#404854", "line-opacity": 0.22, "line-width": 0.6 },
        });
        layer({
          id: "hex-world-2",
          type: "line",
          source: "hex-world",
          filter: ["==", ["get", "r"], 2],
          minzoom: 2.6,
          maxzoom: 7,
          paint: { "line-color": "#404854", "line-opacity": 0.18, "line-width": 0.6 },
        });
        for (let l = LEVELS - 1; l >= 0; l--) {
          layer({
            id: `hex-cells-${l}`,
            type: "fill",
            source: "hex-cells",
            filter: ["==", ["get", "l"], l],
            paint: { "fill-color": ["get", "c"], "fill-opacity": 0.82 },
          });
        }
        layer({
          id: "hex-cells-0-edge",
          type: "line",
          source: "hex-cells",
          filter: ["==", ["get", "l"], 0],
          paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.9 },
        });
        layer({
          id: "hex-selected",
          type: "line",
          source: "hex-cells",
          filter: ["==", ["get", "i"], -2],
          paint: { "line-color": "#1c2127", "line-width": 2.5 },
        });
        layer({
          id: "hex-areas-fill",
          type: "fill",
          source: "hex-areas",
          filter: ["==", ["get", "kind"], "area"],
          paint: { "fill-color": "#5b4a86", "fill-opacity": ["case", ["get", "on"], 0.1, 0] },
        });
        layer({
          id: "hex-areas-line",
          type: "line",
          source: "hex-areas",
          filter: ["==", ["get", "kind"], "area"],
          paint: {
            "line-color": "#5b4a86",
            "line-width": 2,
            "line-dasharray": [3, 2],
            "line-opacity": ["case", ["get", "on"], 1, 0.45],
          },
        });
        layer({
          id: "hex-areas-label",
          type: "symbol",
          source: "hex-areas",
          filter: ["==", ["get", "kind"], "label"],
          layout: { "text-field": ["get", "t"], "text-size": 11.5, "text-anchor": "bottom", "text-allow-overlap": true },
          paint: { "text-color": "#5b4a86", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        });
        layer({
          id: "hex-sites",
          type: "circle",
          source: "hex-sites",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 9, 5, 13, 8],
            "circle-color": ["get", "c"],
            "circle-stroke-color": "#1c2127",
            "circle-stroke-width": 1,
          },
        });
        layer({
          id: "hex-sites-label",
          type: "symbol",
          source: "hex-sites",
          minzoom: 8,
          filter: ["!=", ["get", "t"], ""],
          layout: {
            "text-field": ["get", "t"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
          },
          paint: { "text-color": "#1c2127", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        });
        layer({
          id: "hex-seeds",
          type: "circle",
          source: "hex-seeds",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 10, 8],
            "circle-color": "#a82255",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
          },
        });
        setReady(true);
      });

      map.on("click", (e) => {
        const fine = map.queryRenderedFeatures(e.point, { layers: ["hex-cells-0"] });
        const i = Number(fine[0]?.properties?.i);
        if (fine.length && i >= 0) {
          onTapRef.current(i);
          return;
        }
        // A coarse cell stands for many; the tap reads as "show me", not as a
        // stamp on whichever child happens to be under the pointer.
        const coarse = map.queryRenderedFeatures(e.point, {
          layers: Array.from({ length: LEVELS - 1 }, (_, k) => `hex-cells-${k + 1}`),
        });
        if (coarse.length) map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom() + 1, fineZoomRef.current + 0.3) });
      });
      for (let l = 0; l < LEVELS; l++) {
        map.on("mouseenter", `hex-cells-${l}`, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", `hex-cells-${l}`, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("error", (e: { error?: { message?: string } }) => {
        console.error("[scenario map]", e?.error?.message ?? e);
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // --- data, pushed whenever it changes --------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("hex-cells") as GeoJSONSource | undefined)?.setData(cells);
    levels.forEach(({ min, max }, l) => {
      if (map.getLayer(`hex-cells-${l}`)) map.setLayerZoomRange(`hex-cells-${l}`, min, max);
    });
    for (let l = levels.length; l < LEVELS; l++)
      if (map.getLayer(`hex-cells-${l}`)) map.setLayerZoomRange(`hex-cells-${l}`, 24, 24);
    if (map.getLayer("hex-cells-0-edge")) map.setLayerZoomRange("hex-cells-0-edge", levels[0]?.min ?? 0, 24);
  }, [ready, cells, levels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer("hex-selected")) return;
    map.setFilter("hex-selected", ["==", ["get", "i"], selected ?? -2]);
  }, [ready, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const features: Feature[] = [];
    for (const a of areas) {
      features.push(polygon(circle(a.lat, a.lon, a.radiusKm), { kind: "area", on: a.active }));
      const top = circle(a.lat, a.lon, a.radiusKm)[0]!;
      features.push({
        type: "Feature",
        properties: { kind: "label", t: a.label },
        geometry: { type: "Point", coordinates: top },
      });
    }
    (map.getSource("hex-areas") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }, [ready, areas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("hex-sites") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: sites.map((s) => ({
        type: "Feature",
        properties: { c: s.colour, t: s.label ?? "", n: s.name },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      })),
    });
    (map.getSource("hex-seeds") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: seeds.map((s) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      })),
    });
  }, [ready, sites, seeds]);

  // A new twin, while the reader is still looking at the whole globe, turns
  // the globe to face it. Once they have zoomed in, the camera is theirs.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || map.getZoom() > 3) return;
    map.easeTo({ center: [centre.lon, centre.lat], duration: 800 });
  }, [ready, centre]);

  function fitNetwork() {
    const map = mapRef.current;
    if (!map || grid.hexes.length === 0) return;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const h of grid.hexes) {
      w = Math.min(w, h.lon);
      e = Math.max(e, h.lon);
      s = Math.min(s, h.lat);
      n = Math.max(n, h.lat);
    }
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 120, duration: 1400 },
    );
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    whole: () => mapRef.current?.flyTo({ center: [centre.lon, centre.lat], zoom: GLOBE_ZOOM, pitch: 0, bearing: 0, duration: 1400 }),
    fit: fitNetwork,
  }));

  if (!MAPBOX_TOKEN) {
    return (
      <div className={cn("flex items-center justify-center bg-canvas p-6", className)}>
        <div className="max-w-md rounded-md border border-line bg-white p-5 text-sm text-ink-body">
          <p className="mb-2 font-semibold text-ink">Mapbox token missing</p>
          <p className="text-xs leading-relaxed">
            Add <code className="rounded bg-canvas px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> to the environment, then
            restart or redeploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Sized directly: mapbox-gl.css forces position:relative on this
          element, which would defeat absolute positioning. */}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
});

export default HexGlobe;

/**
 * Zoom, whole globe and fit, as a column of buttons. Kept apart from the globe
 * so the page can set them beside its floating panels, where an open panel
 * cannot cover them.
 */
export function GlobeControls({ globe, className }: { globe: RefObject<GlobeHandle>; className?: string }) {
  const control =
    "flex h-8 w-8 items-center justify-center rounded border border-line bg-white/95 text-ink-body shadow-sm hover:border-brand hover:text-brand";
  return (
    <div className={cn("pointer-events-auto flex flex-col gap-1", className)}>
      <button type="button" className={control} aria-label="Zoom in" title="Zoom in" onClick={() => globe.current?.zoomIn()}>
        <Plus className="h-4 w-4" />
      </button>
      <button type="button" className={control} aria-label="Zoom out" title="Zoom out" onClick={() => globe.current?.zoomOut()}>
        <Minus className="h-4 w-4" />
      </button>
      <button type="button" className={control} aria-label="Whole globe" title="Whole globe" onClick={() => globe.current?.whole()}>
        <Globe2 className="h-4 w-4" />
      </button>
      <button type="button" className={control} aria-label="Fit the network" title="Fit the network" onClick={() => globe.current?.fit()}>
        <Scan className="h-4 w-4" />
      </button>
    </div>
  );
}
