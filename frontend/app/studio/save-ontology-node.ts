import type { PersistedSummary } from "@/lib/platform-api";

export type PersistGlance =
  | { kind: "saved-linked"; identifier: string }
  | { kind: "saved-unlinked"; reason: "no_patient_identifier" }
  | { kind: "saved-instances"; count: number }
  | { kind: "error"; message: string };

export function resolvePatientIdentifierFromSource(
  source: string | undefined,
  payload: unknown,
): string | null {
  const raw = source?.trim();
  if (!raw) return null;
  if (raw.startsWith("payload.")) {
    const path = raw.slice("payload.".length).split(".").filter(Boolean);
    let cur: unknown = payload;
    for (const key of path) {
      if (cur && typeof cur === "object" && key in (cur as object)) {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        return null;
      }
    }
    if (typeof cur === "string" && cur.trim()) return cur.trim();
    if (typeof cur === "number" && Number.isFinite(cur)) return String(cur);
    return null;
  }
  return raw;
}

export function glanceFromPersisted(persisted: PersistedSummary): PersistGlance {
  if (persisted.linked && persisted.patient?.identifier) {
    return { kind: "saved-linked", identifier: persisted.patient.identifier };
  }
  return { kind: "saved-unlinked", reason: "no_patient_identifier" };
}

export function formatSaveOntologyGlance(glance: PersistGlance): string {
  switch (glance.kind) {
    case "saved-linked":
      return `Saved · linked to ${glance.identifier}`;
    case "saved-unlinked":
      return "Saved · unlinked (no identifier)";
    case "saved-instances":
      return `Saved · ${glance.count} instance${glance.count === 1 ? "" : "s"}`;
    case "error":
      return glance.message;
  }
}
