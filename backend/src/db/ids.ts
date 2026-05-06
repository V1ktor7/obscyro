// SCTID and refset constants used across queries.
// All values are kept as strings so they can flow into pg parameters
// without losing precision (BIGINT > Number.MAX_SAFE_INTEGER).

export const FSN_TYPE_ID = "900000000000003001";
export const SYNONYM_TYPE_ID = "900000000000013009";
export const TEXT_DEFINITION_TYPE_ID = "900000000000550004";

export const IS_A_TYPE_ID = "116680003";

export const PRIMITIVE_DEFINITION_STATUS = "900000000000074008";
export const DEFINED_DEFINITION_STATUS = "900000000000073002";

export function definitionStatusName(id: string | null | undefined): string {
  switch (id) {
    case PRIMITIVE_DEFINITION_STATUS:
      return "primitive";
    case DEFINED_DEFINITION_STATUS:
      return "defined";
    default:
      return "unknown";
  }
}

// Map refsets
export const ICD10_MAP_REFSET = "447562003";
export const ICDO_MAP_REFSET = "446608001";
export const CTV3_SIMPLE_MAP_REFSET = "900000000000497000";

export type TerminologyTarget = "icd10" | "icdo" | "ctv3";

export const SIMPLE_MAP_REFSETS: Record<Exclude<TerminologyTarget, "icd10">, string> = {
  icdo: ICDO_MAP_REFSET,
  ctv3: CTV3_SIMPLE_MAP_REFSET,
};
