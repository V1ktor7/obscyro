/**
 * Overlay scenarios — a named set of proposed edits over the live ontology.
 *
 * Distinct from the copy-based scenarios in platform-api: those clone a subtree
 * into their own tables, which is frozen at clone time and invisible to
 * everything else. These resolve over the real ontology, so reads through one
 * see the world as it would be under those edits.
 */

import { apiFetch } from "@/lib/auth";

export type OverrideTargetType = "instance" | "link" | "param";
export type OverrideOp =
  | "create"
  | "set_property"
  | "delete"
  | "link"
  | "unlink"
  | "set_param";

export interface OverlayScenario {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  parentScenarioId: string | null;
  baseAsOf: string | null;
  status: "draft" | "ready" | "submitted" | "archived";
  createdAt: string;
  overrideCount: number;
}

export interface ScenarioOverride {
  id: string;
  scenarioId: string;
  seq: number;
  targetType: OverrideTargetType;
  targetId: string | null;
  targetLocalKey: string | null;
  op: OverrideOp;
  payload: Record<string, unknown>;
  effectiveOffsetHours: number;
  durationHours: number | null;
  note: string | null;
}

export interface OverrideIssue {
  overrideId: string | null;
  message: string;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function listOverlayScenarios(
  env: string,
): Promise<{ scenarios: OverlayScenario[] }> {
  return apiFetch(`/v1/ontology/${enc(env)}/overlay-scenarios`);
}

export async function createOverlayScenario(
  env: string,
  body: { name: string; description?: string; parentScenarioId?: string; baseAsOf?: string },
): Promise<OverlayScenario> {
  return apiFetch(`/v1/ontology/${enc(env)}/overlay-scenarios`, { method: "POST", body });
}

export async function listScenarioOverrides(
  id: string,
): Promise<{ overrides: ScenarioOverride[]; issues: OverrideIssue[] }> {
  return apiFetch(`/v1/overlay-scenarios/${id}/overrides`);
}

export async function addScenarioOverride(
  id: string,
  body: {
    targetType: OverrideTargetType;
    targetId?: string | null;
    targetLocalKey?: string | null;
    op: OverrideOp;
    payload?: Record<string, unknown>;
    effectiveOffsetHours?: number;
    durationHours?: number | null;
    note?: string | null;
  },
): Promise<ScenarioOverride> {
  return apiFetch(`/v1/overlay-scenarios/${id}/overrides`, { method: "POST", body });
}

export async function deleteScenarioOverride(
  id: string,
  overrideId: string,
): Promise<{ deleted: boolean }> {
  return apiFetch(`/v1/overlay-scenarios/${id}/overrides/${overrideId}`, { method: "DELETE" });
}

/** What the scenario amounts to at a point in its timeline, ancestors included. */
export async function resolveScenario(
  id: string,
  atOffsetHours = 0,
): Promise<{ atOffsetHours: number; chain: string[]; overrides: ScenarioOverride[] }> {
  return apiFetch(`/v1/overlay-scenarios/${id}/resolve?atOffsetHours=${atOffsetHours}`);
}
