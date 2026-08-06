/**
 * Which environment you are looking at.
 *
 * It used to be `useState<string | null>(null)`, defaulting to the first
 * environment the API returned. Nothing wrote it down, so a reload, a bookmark
 * or a pasted link silently moved you somewhere else — and the header showed
 * the name as dead text, with the command palette as the only way to change it.
 *
 * That is how a network ends up with its datasets in one environment and its
 * twin in another: you reload, you are quietly elsewhere, and you upload.
 *
 * The URL is the source of truth, so a link carries the environment and can be
 * shared. `localStorage` remembers your last choice for the next visit. The
 * API's first environment is the fallback, and only that.
 */

const KEY = "obs_selected_env";

/** Query parameter carrying the environment on every Studio URL. */
export const ENV_PARAM = "env";

export function readStoredEnv(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeStoredEnv(slug: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (slug) localStorage.setItem(KEY, slug);
    else localStorage.removeItem(KEY);
  } catch {
    /* quota / private mode */
  }
}

/**
 * Resolve the environment to show, in order of authority.
 *
 * A slug that no longer exists — a deleted environment, a link from another
 * organization — falls through rather than selecting nothing, because an empty
 * selection renders every view as if the account had no data.
 */
export function resolveEnv(
  fromUrl: string | null,
  remembered: string | null,
  available: readonly { slug: string }[],
): string | null {
  const known = (slug: string | null) =>
    slug && available.some((e) => e.slug === slug) ? slug : null;
  return known(fromUrl) ?? known(remembered) ?? available[0]?.slug ?? null;
}

/** The same path with `?env=` set, preserving every other parameter. */
export function urlWithEnv(pathname: string, search: string, slug: string): string {
  const params = new URLSearchParams(search);
  params.set(ENV_PARAM, slug);
  return `${pathname}?${params.toString()}`;
}
