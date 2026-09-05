"use client";

/**
 * The network on a map, in a tile.
 *
 * Deliberately not the command-centre map. That one is an instrument: layers,
 * saved views, drill-in, a drawing tool. This is a card on a board, and the
 * only questions it answers are where the sites are and which of them are
 * loaded — so it is a basemap, one circle layer, and a legend.
 *
 * The legend carries the part that matters. A site the source said nothing
 * about is drawn hollow, never at the bottom of the ramp: "no reading" and
 * "empty hospital" are different statements and a dashboard that renders them
 * the same colour is a dashboard that invents calm.
 */

import "mapbox-gl/dist/mapbox-gl.css";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";

import { formatValue, siteRamp } from "./chart-geometry";
import type { Card } from "../dashboards-api";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const STYLE = "mapbox://styles/victormorency7/cmsddjrmc002c01s99df7adnp";

/** Quiet to loaded. Ends at the danger red the rest of the studio uses. */
const RAMP = ["#2d72d2", "#54a0d8", "#e5b53f", "#e08b2f", "#c23030"];

function colourAt(t: number): string {
  const i = Math.min(RAMP.length - 1, Math.max(0, Math.round(t * (RAMP.length - 1))));
  return RAMP[i]!;
}

export default function MapCard({ card }: { card: Card }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [ready, setReady] = useState(false);

  const sites = card.data.sites;

  const features = useMemo(() => {
    const ramp = siteRamp(sites.map((s) => s.value));
    return sites.map((s) => {
      const t = ramp(s.value);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
        properties: {
          name: s.name,
          // A site with no reading gets no ramp colour at all; the layer draws
          // it hollow so it cannot be mistaken for the quiet end of the scale.
          colour: t == null ? "#ffffff" : colourAt(t),
          read: t == null ? 0 : 1,
          label:
            s.value == null
              ? "aucune lecture"
              : `${formatValue(s.value)}${s.from ? ` · ${s.from}` : ""}`,
        },
      };
    });
  }, [sites]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: STYLE,
        center: [-73.57, 45.5],
        zoom: 8,
        attributionControl: true,
        // A tile on a board is read, not flown through. Leaving the handlers on
        // would let a scroll down the page zoom the map instead.
        scrollZoom: false,
      });
      mapRef.current = map;
      map.on("load", () => {
        if (cancelled) return;
        map.addSource("sites", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "sites-circles",
          type: "circle",
          source: "sites",
          paint: {
            "circle-radius": 6,
            "circle-color": ["get", "colour"],
            "circle-opacity": ["case", ["==", ["get", "read"], 1], 0.9, 0.15],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": ["case", ["==", ["get", "read"], 1], "#ffffff", "#8f99a8"],
          },
        });
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Sites arrive with the page and change when the card is re-read, so the
  // source is updated rather than the map rebuilt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("sites") as { setData?: (d: unknown) => void } | undefined;
    src?.setData?.({ type: "FeatureCollection", features });

    if (features.length === 0) return;
    let west = 180;
    let south = 90;
    let east = -180;
    let north = -90;
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      west = Math.min(west, lng!);
      east = Math.max(east, lng!);
      south = Math.min(south, lat!);
      north = Math.max(north, lat!);
    }
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 36, duration: 0, maxZoom: 11 },
    );
  }, [features, ready]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-[260px] items-center justify-center px-6 text-center text-sm text-ink-faint">
        NEXT_PUBLIC_MAPBOX_TOKEN n&apos;est pas configuré, donc cette carte ne peut rien afficher.
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center px-6 text-center text-sm text-ink-faint">
        Aucun site géolocalisé dans ce jumeau.
        {card.data.sitesUnplaced > 0
          ? ` ${card.data.sitesUnplaced} site${card.data.sitesUnplaced > 1 ? "s ont" : " a"} été trouvé${card.data.sitesUnplaced > 1 ? "s" : ""} sans coordonnées.`
          : ""}
      </div>
    );
  }

  return (
    <div>
      <div ref={containerRef} className="h-[260px] w-full" data-testid="map-canvas" />
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-[11px] text-ink-faint">
        <span className="flex items-center gap-1">
          {RAMP.map((c) => (
            <span key={c} className="h-2 w-4 rounded-sm" style={{ backgroundColor: c }} />
          ))}
          <span className="ml-1">calme → saturé</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-ink-ghost bg-white" />
          aucune lecture
        </span>
      </div>
    </div>
  );
}
