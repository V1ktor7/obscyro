import type { DbClient } from "../lib/db.js";
import { BadRequest } from "../lib/errors.js";

/**
 * Where the analyst may search the web: a list of domains, set per project.
 *
 * The search is run by the Claude API, restricted to these domains by the API
 * itself (`allowed_domains` on the tool). What comes back is checked against
 * the same list here, so an event can only cite a page from a source somebody
 * chose to trust.
 *
 * A project that never set a list searches the starting one below: official
 * health and government sources for Québec, Canada and the WHO.
 */

export const DEFAULT_WEB_SOURCES = ["inspq.qc.ca", "quebec.ca", "msss.gouv.qc.ca", "donneesquebec.ca", "canada.ca", "who.int"];

/** A long list makes the search request too large for the API. */
export const MAX_WEB_SOURCES = 20;

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const PATH = /^\/[A-Za-z0-9._~%/*-]*$/;

/**
 * One entry as the API wants it: a bare domain, with an optional path, no
 * scheme. `https://www.quebec.ca/` is tidied to `www.quebec.ca`; anything that
 * is not a domain is refused with the reason.
 *
 * ASCII only: a domain written with a look-alike letter from another alphabet
 * is a different domain, and would pass for the one it imitates.
 */
export function normalizeSource(entry: string): string {
  const raw = entry.trim();
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(raw)) {
    throw BadRequest("WEB_SOURCE_INVALID", `"${raw}" holds a character that is not plain ASCII. Write the domain in plain letters.`);
  }
  const bare = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
  const slash = bare.indexOf("/");
  const host = (slash < 0 ? bare : bare.slice(0, slash)).toLowerCase();
  const path = slash < 0 ? "" : bare.slice(slash);
  if (!HOST.test(host)) {
    throw BadRequest("WEB_SOURCE_INVALID", `"${raw}" is not a domain. Write it like quebec.ca or quebec.ca/sante, without https:// and without a wildcard.`);
  }
  if (path && !PATH.test(path)) {
    throw BadRequest("WEB_SOURCE_INVALID", `"${raw}" has a path the search cannot use. Keep to letters, digits, / . - _`);
  }
  return host + path;
}

/** A list as it is stored: tidied, without repeats, in the order given. */
export function normalizeSources(entries: string[]): string[] {
  const out = [...new Set(entries.filter((e) => e.trim().length > 0).map(normalizeSource))];
  if (out.length > MAX_WEB_SOURCES) {
    throw BadRequest("WEB_SOURCES_TOO_MANY", `A project can search at most ${MAX_WEB_SOURCES} sources; ${out.length} were given.`);
  }
  return out;
}

/**
 * Is this page inside one of the allowed sources?
 *
 * A domain covers its subdomains (`quebec.ca` covers `www.quebec.ca`); an
 * entry with a path covers what is under that path. Anything that is not an
 * http(s) address is outside.
 */
export function sourceAllows(domains: readonly string[], url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  return domains.some((d) => {
    const slash = d.indexOf("/");
    const dHost = slash < 0 ? d : d.slice(0, slash);
    const dPath = slash < 0 ? "" : d.slice(slash);
    if (host !== dHost && !host.endsWith(`.${dHost}`)) return false;
    // A path with a wildcard is left to the API, which is the one that reads it.
    if (!dPath || dPath.includes("*")) return true;
    return parsed.pathname === dPath || parsed.pathname.startsWith(dPath.endsWith("/") ? dPath : `${dPath}/`);
  });
}

export interface WebSources {
  domains: string[];
  /** True when the project never set a list and the starting one applies. */
  isDefault: boolean;
}

export async function getWebSources(db: DbClient, projectId: string): Promise<WebSources> {
  const { rows } = await db.query<{ domains: unknown }>(`SELECT domains FROM app.project_web_source WHERE project_id = $1`, [projectId]);
  const stored = rows[0]?.domains;
  if (!Array.isArray(stored)) return { domains: [...DEFAULT_WEB_SOURCES], isDefault: true };
  return { domains: stored.filter((d): d is string => typeof d === "string"), isDefault: false };
}

export async function setWebSources(db: DbClient, projectId: string, userId: string, entries: string[]): Promise<WebSources> {
  const domains = normalizeSources(entries);
  await db.query(
    `INSERT INTO app.project_web_source (project_id, domains, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (project_id) DO UPDATE SET domains = EXCLUDED.domains, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [projectId, JSON.stringify(domains), userId],
  );
  return { domains, isDefault: false };
}
