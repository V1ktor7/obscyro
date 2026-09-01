"use client";

import { useEffect, useRef, useState } from "react";

// Static, like the Studio does it: Next handles the stylesheet at build time,
// and a dynamic import of a .css file has no types to resolve against.
import "mapbox-gl/dist/mapbox-gl.css";

/**
 * The real map component, not a drawing of one.
 *
 * The Studio renders its network on Mapbox; this is the same library and the
 * same account, put on the marketing page in globe projection. Hand-drawing a
 * sphere was cheaper but it was also a claim about capability made in pencil —
 * showing the actual renderer is the honest version of the same statement.
 *
 * **No twin data is loaded here.** No facilities, no occupancy, no instances:
 * the globe turns and that is all. Operational data belongs behind the sign-in,
 * and a marketing page that displayed a live network would be publishing a
 * ministry's operating picture to anyone who scrolled.
 *
 * mapbox-gl is imported dynamically. It is a few hundred kilobytes, and a
 * visitor who never scrolls this far should not pay for it — so the import
 * itself waits until the section is near the viewport.
 */

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
/** A light basemap, so the globe sits in the page rather than punching a hole. */
const STYLE = "mapbox://styles/mapbox/light-v11";

export default function MapGlobe({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);
  const [failed, setFailed] = useState(!TOKEN);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !TOKEN) return;

    let cancelled = false;
    let spin = 0;

    const boot = async () => {
      try {
        const mapboxgl = (await import("mapbox-gl")).default;
        if (cancelled || !hostRef.current) return;

        mapboxgl.accessToken = TOKEN;
        const map = new mapboxgl.Map({
          container: hostRef.current,
          style: STYLE,
          projection: { name: "globe" },
          center: [-40, 25],
          zoom: 1.35,
          // The page owns the scroll. A map that grabs the wheel is the single
          // most hostile thing a landing page can do on a laptop.
          scrollZoom: false,
          dragRotate: false,
          touchZoomRotate: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          attributionControl: true,
          interactive: false,
        });
        mapRef.current = map as unknown as { remove: () => void };

        map.on("style.load", () => {
          if (cancelled) return;
          map.setFog({
            color: "rgb(255,255,255)",
            "high-color": "rgb(238,240,243)",
            "horizon-blend": 0.02,
            "space-color": "rgb(255,255,255)",
            "star-intensity": 0,
          });
        });

        // Rotation is driven by the frame loop rather than by easeTo, which
        // would queue animations and drift out of step when a tab is hidden.
        const step = () => {
          if (cancelled) return;
          spin = requestAnimationFrame(step);
          const c = map.getCenter();
          c.lng -= 0.045;
          map.setCenter(c);
        };

        const io = new IntersectionObserver((entries) => {
          const on = entries.some((e) => e.isIntersecting);
          if (on && !spin) spin = requestAnimationFrame(step);
          else if (!on && spin) {
            cancelAnimationFrame(spin);
            spin = 0;
          }
        });
        io.observe(hostRef.current);

        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) io.disconnect();

        return () => io.disconnect();
      } catch {
        if (!cancelled) setFailed(true);
      }
      return undefined;
    };

    let teardown: (() => void) | undefined;
    void boot().then((fn) => {
      teardown = fn;
    });

    return () => {
      cancelled = true;
      if (spin) cancelAnimationFrame(spin);
      teardown?.();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  if (failed) {
    // Without a token the section still has to hold its shape, and an empty
    // box that says nothing is worse than one that says why it is empty.
    return (
      <div
        className={className}
        style={{
          display: "grid",
          placeItems: "center",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <span className="caption">Map unavailable</span>
      </div>
    );
  }

  return <div ref={hostRef} className={className} aria-hidden />;
}
