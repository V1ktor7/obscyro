/**
 * The basemap every Studio map draws on.
 *
 * One place for the token and the styles, so Units and Scenarios cannot drift
 * apart: a reader moving from one tab to the other should see the same globe.
 */
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Mapbox's own dark basemap: grey land on darker water, close to the Studio's
// ground (Gray 100), so the cells, the flow arcs and the site markers are the
// only saturated things on screen. Everything drawn on a map (ramps, halos,
// outlines) is chosen for this ground: a light basemap would need them redone.
export const STYLE_STANDARD = "mapbox://styles/mapbox/dark-v11";
export const STYLE_SATELLITE = "mapbox://styles/mapbox/satellite-streets-v12";

/** A map opens on the whole globe, turned towards the network, and stays there. */
export const GLOBE_ZOOM = 1.6;
