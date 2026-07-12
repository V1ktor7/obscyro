/**
 * Frontend-only per-environment prefs for the Ontology Manager landing page:
 * favorite object types and a recently-viewed list (most recent first).
 */

const FAV_PREFIX = "obs_ontology_favorites_v1:";
const RECENT_PREFIX = "obs_ontology_recents_v1:";
const RECENT_MAX = 6;

function readList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

export function loadFavorites(envSlug: string): string[] {
  return envSlug ? readList(`${FAV_PREFIX}${envSlug}`) : [];
}

export function toggleFavorite(envSlug: string, typeName: string): string[] {
  const cur = loadFavorites(envSlug);
  const next = cur.includes(typeName)
    ? cur.filter((n) => n !== typeName)
    : [...cur, typeName];
  writeList(`${FAV_PREFIX}${envSlug}`, next);
  return next;
}

export function loadRecents(envSlug: string): string[] {
  return envSlug ? readList(`${RECENT_PREFIX}${envSlug}`) : [];
}

export function pushRecent(envSlug: string, typeName: string): string[] {
  if (!envSlug) return [];
  const next = [typeName, ...loadRecents(envSlug).filter((n) => n !== typeName)].slice(
    0,
    RECENT_MAX,
  );
  writeList(`${RECENT_PREFIX}${envSlug}`, next);
  return next;
}
