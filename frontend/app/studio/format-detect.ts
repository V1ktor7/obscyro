// Pure format-detection helpers for the Studio "Format detection" router node.
// Exported for unit tests and used by executeNode in StudioEditor.

export type FormatBranch = "fhir" | "hl7" | "json" | "text" | "unknown";

export type FormatMeta = {
  contentType?: string;
  headers?: Record<string, string>;
};

export const FORMAT_BRANCHES: FormatBranch[] = [
  "fhir",
  "hl7",
  "json",
  "text",
  "unknown",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasResourceType(obj: unknown): boolean {
  return isRecord(obj) && typeof obj.resourceType === "string" && obj.resourceType.length > 0;
}

function contentTypeFromMeta(meta?: FormatMeta): string | undefined {
  if (meta?.contentType?.trim()) return meta.contentType.trim();
  const h = meta?.headers;
  if (!h) return undefined;
  const direct = h["content-type"] ?? h["Content-Type"];
  return typeof direct === "string" && direct.trim() ? direct.trim() : undefined;
}

function branchFromContentType(ct: string): FormatBranch | null {
  const lower = ct.toLowerCase();
  if (lower.includes("fhir") || lower === "application/fhir+json") return "fhir";
  if (
    lower === "application/hl7-v2" ||
    lower === "x-application/hl7-v2+er7" ||
    lower.includes("hl7")
  ) {
    return "hl7";
  }
  if (lower === "application/json" || lower.endsWith("+json")) return "json";
  return null;
}

/** Sniff a trimmed string body (no Content-Type). Never throws. */
export function sniffFormat(raw: string): FormatBranch {
  const t = String(raw ?? "").trim();
  if (!t) return "unknown";
  if (t.startsWith("MSH|")) return "hl7";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const obj = JSON.parse(t) as unknown;
      if (hasResourceType(obj)) return "fhir";
      return "json";
    } catch {
      return "unknown";
    }
  }
  return "text";
}

function branchFromJsonLike(raw: unknown): FormatBranch {
  if (hasResourceType(raw)) return "fhir";
  return "json";
}

/**
 * Detect payload format. Trust Content-Type first when enabled (default ON),
 * then fall back to content sniffing. Never throws.
 */
export function detectFormat(
  raw: unknown,
  meta?: FormatMeta,
  opts?: { trustContentType?: boolean },
): FormatBranch {
  const trust = opts?.trustContentType ?? true;

  if (trust) {
    const ct = contentTypeFromMeta(meta);
    if (ct) {
      const fromCt = branchFromContentType(ct);
      if (fromCt === "fhir" || fromCt === "hl7") return fromCt;
      if (fromCt === "json") {
        if (isRecord(raw) || Array.isArray(raw)) return branchFromJsonLike(raw);
        const t = String(raw ?? "").trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          try {
            return branchFromJsonLike(JSON.parse(t));
          } catch {
            return "unknown";
          }
        }
        return "json";
      }
    }
  }

  if (isRecord(raw) || Array.isArray(raw)) return branchFromJsonLike(raw);

  return sniffFormat(String(raw ?? ""));
}
