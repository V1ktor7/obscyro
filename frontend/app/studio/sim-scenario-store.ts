import type { OutbreakParams } from "./sim-api";

export interface StoredScenario {
  id: string;
  name: string;
  createdAt: string;
  params: OutbreakParams;
}

function storageKey(envSlug: string): string {
  return `obs_studio_sim_scenarios_v1:${envSlug}`;
}

export function loadScenarios(envSlug: string): StoredScenario[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(envSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is StoredScenario =>
        !!s &&
        typeof s === "object" &&
        typeof (s as StoredScenario).id === "string" &&
        typeof (s as StoredScenario).name === "string",
    );
  } catch {
    return [];
  }
}

export function saveScenario(envSlug: string, scenario: StoredScenario): void {
  if (typeof window === "undefined") return;
  const existing = loadScenarios(envSlug);
  const next = [scenario, ...existing.filter((s) => s.id !== scenario.id)];
  try {
    localStorage.setItem(storageKey(envSlug), JSON.stringify(next));
  } catch {
    /* localStorage unavailable */
  }
}
