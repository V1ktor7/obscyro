export interface TwinPreferences {
  displayMetric: string;
  kindFilter: string | null;
}

const PREFIX = "obs_twin_prefs_v1:";

const DEFAULTS: TwinPreferences = {
  displayMetric: "occupancyPct",
  kindFilter: null,
};

function storageKey(envSlug: string): string {
  return `${PREFIX}${envSlug}`;
}

export function loadTwinPreferences(envSlug: string): TwinPreferences {
  if (typeof window === "undefined" || !envSlug) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(storageKey(envSlug));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TwinPreferences>;
    return {
      displayMetric:
        typeof parsed.displayMetric === "string"
          ? parsed.displayMetric
          : DEFAULTS.displayMetric,
      kindFilter:
        parsed.kindFilter === null || typeof parsed.kindFilter === "string"
          ? parsed.kindFilter
          : DEFAULTS.kindFilter,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTwinPreferences(
  envSlug: string,
  prefs: TwinPreferences,
): void {
  if (typeof window === "undefined" || !envSlug) return;
  try {
    localStorage.setItem(storageKey(envSlug), JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export const KIND_FILTER_OPTIONS = [
  { value: null, label: "All kinds" },
  { value: "org", label: "Org" },
  { value: "hospital", label: "Hospital" },
  { value: "department", label: "Department" },
  { value: "ward", label: "Ward" },
  { value: "lab", label: "Lab" },
] as const;
