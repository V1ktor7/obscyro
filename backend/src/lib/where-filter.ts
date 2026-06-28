import { BadRequest } from "./errors.js";

const WHERE_KEY_RE = /^[a-zA-Z0-9_]+$/;
const MAX_WHERE_PAIRS = 12;

/** Parse `where=key:value,key2:value2` into validated, parameterizable pairs. */
export function parseWhere(raw: string | undefined): Array<[string, string]> {
  if (!raw) return [];
  const pairs: Array<[string, string]> = [];
  for (const clause of raw.split(",")) {
    const trimmed = clause.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) {
      throw BadRequest("INVALID_WHERE", `Invalid where clause "${trimmed}". Use key:value.`);
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!WHERE_KEY_RE.test(key)) {
      throw BadRequest("INVALID_WHERE", `Invalid where key "${key}".`);
    }
    pairs.push([key, value]);
    if (pairs.length > MAX_WHERE_PAIRS) {
      throw BadRequest("INVALID_WHERE", `Too many where clauses (max ${MAX_WHERE_PAIRS}).`);
    }
  }
  return pairs;
}
