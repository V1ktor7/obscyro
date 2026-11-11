/**
 * The basemap every Studio map draws on.
 *
 * One place for the token and the styles, so Units and Scenarios cannot drift
 * apart: a reader moving from one tab to the other should see the same globe.
 */
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// Obscyro's own Standard basemap: land and water desaturated to the app's
// canvas so the flow arcs and site markers are the only saturated things on
// screen. Edited in Mapbox Studio, not here — publishing a new version there
// reaches this map without a redeploy. Owned by the same account as the token.
export const STYLE_STANDARD = "mapbox://styles/victormorency7/cmsddjrmc002c01s99df7adnp";
export const STYLE_SATELLITE = "mapbox://styles/mapbox/satellite-streets-v12";

/** A map opens on the whole globe, turned towards the network, and stays there. */
export const GLOBE_ZOOM = 1.6;
