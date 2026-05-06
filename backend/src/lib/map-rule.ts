export type MapRuleConditional =
  | { rule: "TRUE" }
  | { rule: "OTHERWISE_TRUE" }
  | { rule: "IFA"; conceptId: string; description: string }
  | { rule: "RAW"; expression: string };

const IFA_RE = /^IFA\s+(\d+)\s*\|\s*([^|]*)\s*\|/i;

/**
 * Parses a SNOMED extended-map `mapRule` string into a structured conditional.
 * Returns `null` for unconditional rules ("TRUE" / "OTHERWISE TRUE") so callers
 * can omit the `conditional` field; everything else returns a discriminated
 * object so we never silently drop information.
 */
export function parseMapRule(raw: string | null | undefined): MapRuleConditional | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toUpperCase() === "TRUE") {
    return null;
  }
  if (trimmed.toUpperCase() === "OTHERWISE TRUE") {
    return null;
  }

  const ifa = IFA_RE.exec(trimmed);
  if (ifa) {
    return {
      rule: "IFA",
      conceptId: ifa[1],
      description: ifa[2].trim(),
    };
  }

  return { rule: "RAW", expression: trimmed };
}
