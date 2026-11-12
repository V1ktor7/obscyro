"use client";

/**
 * Where a change lands, on the twin's own map.
 *
 * It used to be a picture of one city drawn from embedded coordinates. It is
 * now the network the event will run against, on the Studio basemap, fitted to
 * wherever its sites are: Rimouski and Sherbrooke in one frame as easily as two
 * Montréal hospitals. The picture itself is computed by `mapPicture`; this only
 * paints it and turns clicks into picks.
 */

import "mapbox-gl/dist/mapbox-gl.css";

import type { FeatureCollection } from "geojson";
import { Scan } from "lucide-react";
import type { GeoJSONSource, MapLayerMouseEvent, Map as MapboxMap, Popup } from "mapbox-gl";
import { useEffect, useRef, useState } from "react";

import { MAPBOX_TOKEN, STYLE_STANDARD } from "../../map-style";
import type { LatLon } from "./engine";
import { ringPolygon, type Dot, type MapPicture } from "./mapdata";
import type { BuilderTwin } from "./twin";

type FC = FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };

const dots = (list: Dot[]): FC => ({
  type: "FeatureCollection",
  features: list.map((d) => ({ type: "Feature", geometry: { type: "Point", coordinates: [d.lon, d.lat] },
    properties: { id: d.id, r: d.r, fill: d.fill, opacity: d.opacity, stroke: d.stroke, sw: d.strokeWidth, so: d.dashed ? 0.45 : 1, info: d.info } })),
});
const ring = (r: { at: LatLon; km: number } | null): FC => (r ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: ringPolygon(r.at, r.km) }, properties: {} }] } : EMPTY);
const point = (p: LatLon | null): FC => (p ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [p[1], p[0]] }, properties: {} }] } : EMPTY);

export default function WhereItLands({ tw, picture, colour, onPickSite, onPickPop, onPickPoint }: {
  tw: BuilderTwin;
  picture: MapPicture;
  colour: string;
  onPickSite: (id: string) => void;
  onPickPop: (id: string) => void;
  onPickPoint: (at: LatLon) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const popRef = useRef<Popup | null>(null);
  const [ready, setReady] = useState(false);
  const pickRef = useRef(picture.pick);
  pickRef.current = picture.pick;
  const cb = useRef({ onPickSite, onPickPop, onPickPoint });
  cb.current = { onPickSite, onPickPop, onPickPoint };

  useEffect(() => {
    if (!MAPBOX_TOKEN || !host.current || mapRef.current) return;
    let cancelled = false;
    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !host.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({ container: host.current, style: STYLE_STANDARD, center: [-71.2, 46.8], zoom: 4, attributionControl: true });
      mapRef.current = map;
      popRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", offset: 10 });
      map.on("style.load", () => {
        for (const id of ["wil-pops", "wil-sites", "wil-ring", "wil-front", "wil-centre"]) map.addSource(id, { type: "geojson", data: EMPTY });
        map.addLayer({ id: "wil-pops", type: "circle", source: "wil-pops", paint: {
          "circle-radius": ["get", "r"], "circle-color": ["get", "fill"], "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": ["get", "stroke"], "circle-stroke-width": ["get", "sw"], "circle-stroke-opacity": ["get", "so"] } });
        map.addLayer({ id: "wil-sites", type: "circle", source: "wil-sites", paint: {
          "circle-radius": ["get", "r"], "circle-color": ["get", "fill"], "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": ["get", "stroke"], "circle-stroke-width": ["get", "sw"], "circle-stroke-opacity": ["get", "so"] } });
        map.addLayer({ id: "wil-ring", type: "line", source: "wil-ring", paint: { "line-color": colour, "line-width": 1.4, "line-dasharray": [3, 2] } });
        map.addLayer({ id: "wil-front", type: "line", source: "wil-front", paint: { "line-color": colour, "line-width": 2 } });
        map.addLayer({ id: "wil-centre", type: "circle", source: "wil-centre", paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": colour, "circle-stroke-width": 2.5 } });
        setReady(true);
      });
      const show = (ev: MapLayerMouseEvent) => {
        const f = ev.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = pickRef.current && pickRef.current !== "point" ? "pointer" : "default";
        const box = document.createElement("div");
        box.style.fontSize = "11.5px";
        String(f.properties?.info ?? "").split("\n").forEach((line, k) => {
          const p = document.createElement(k === 0 ? "b" : "div");
          p.textContent = line.replace(/\*\*/g, "");
          if (k === 0) p.style.display = "block";
          box.appendChild(p);
        });
        popRef.current?.setLngLat(ev.lngLat).setDOMContent(box).addTo(map);
      };
      const hide = () => { map.getCanvas().style.cursor = pickRef.current === "point" ? "crosshair" : ""; popRef.current?.remove(); };
      for (const layer of ["wil-pops", "wil-sites"]) { map.on("mousemove", layer, show); map.on("mouseleave", layer, hide); }
      map.on("click", (ev) => {
        const mode = pickRef.current;
        if (!mode) return;
        const hits = map.queryRenderedFeatures(ev.point, { layers: mode === "pops" ? ["wil-pops"] : ["wil-sites"] });
        const id = hits[0]?.properties?.id as string | undefined;
        if (mode === "pops" && id) cb.current.onPickPop(id);
        else if (mode === "sites" && id) cb.current.onPickSite(id);
        else if (mode === "point") {
          const site = map.queryRenderedFeatures(ev.point, { layers: ["wil-sites"] })[0];
          const c = site?.geometry.type === "Point" ? (site.geometry.coordinates as [number, number]) : [ev.lngLat.lng, ev.lngLat.lat];
          cb.current.onPickPoint([+c[1]!.toFixed(4), +c[0]!.toFixed(4)]);
        }
      });
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // The map is made once; the picture is pushed in by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit the twin's extent: wherever its sites are, all of them in frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !tw.bounds) return;
    const [[s, w], [n, e]] = tw.bounds;
    map.fitBounds([[w, s], [e, n]], { padding: 28, maxZoom: 11, duration: 0 });
  }, [ready, tw.bounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("wil-pops") as GeoJSONSource | undefined)?.setData(dots(picture.pops));
    (map.getSource("wil-sites") as GeoJSONSource | undefined)?.setData(dots(picture.sites));
    (map.getSource("wil-ring") as GeoJSONSource | undefined)?.setData(ring(picture.ring));
    (map.getSource("wil-front") as GeoJSONSource | undefined)?.setData(ring(picture.front));
    (map.getSource("wil-centre") as GeoJSONSource | undefined)?.setData(point(picture.centre));
    for (const id of ["wil-ring", "wil-front"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", colour);
    if (map.getLayer("wil-centre")) map.setPaintProperty("wil-centre", "circle-stroke-color", colour);
    map.getCanvas().style.cursor = picture.pick === "point" ? "crosshair" : "";
  }, [ready, picture, colour]);

  if (!MAPBOX_TOKEN) {
    return <p className="rounded-md border border-line-soft bg-canvas p-3 text-[11.5px] text-ink-muted">The map needs NEXT_PUBLIC_MAPBOX_TOKEN. The changes still work without it.</p>;
  }
  return (
    <div className="relative overflow-hidden rounded-md border border-line-soft">
      <div ref={host} className="h-[300px] w-full" />
      <button
        type="button"
        title="Show every site of the twin"
        aria-label="Show every site of the twin"
        onClick={() => { const map = mapRef.current; if (map && tw.bounds) { const [[s, w], [n, e]] = tw.bounds; map.fitBounds([[w, s], [e, n]], { padding: 28, maxZoom: 11 }); } }}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded border border-line bg-white/95 text-ink-body shadow-sm hover:border-brand hover:text-brand"
      >
        <Scan className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
