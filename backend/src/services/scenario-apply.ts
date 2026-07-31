import { createHash } from "node:crypto";

import type { EnvInstanceRow, EnvLinkRow } from "./ontology.js";
import type { ScenarioOverride } from "./scenario-overrides.js";

// ---------------------------------------------------------------------------
// Applying a scenario's edits to what the base query returned.
//
// Pure on purpose. Resolution is where a scenario silently becomes something
// other than what its author drew, so it is a function over two arrays rather
// than something woven into SQL — it can be tested exhaustively without a
// database, and every rule is visible in one place.
//
// Payload shapes:
//   create        { objectType, properties }
//   set_property  { property, value }  |  { properties: {...} }
//   delete        {}
//   link/unlink   target is the *from* instance; { linkType, toId | toLocalKey }
// ---------------------------------------------------------------------------

/**
 * A stable id for something a scenario invents.
 *
 * Derived rather than random because the twin keys its tree, its rollups and
 * its alert state by instance id — a ward that got a fresh id on every read
 * would appear and disappear between two ticks of the same SSE stream.
 * Shaped as a UUID so nothing downstream that assumes the format breaks.
 */
export function syntheticId(scenarioId: string, localKey: string): string {
  const h = createHash("sha1").update(`${scenarioId}:${localKey}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}

/** The instance an override points at, real or scenario-local. */
function targetIdOf(o: ScenarioOverride, scenarioId: string): string | null {
  if (o.targetId) return o.targetId;
  if (o.targetLocalKey) return syntheticId(scenarioId, o.targetLocalKey);
  return null;
}

function payloadInstanceId(
  payload: Record<string, unknown>,
  scenarioId: string,
  idKey: string,
  localKey: string,
): string | null {
  const direct = payload[idKey];
  if (typeof direct === "string" && direct) return direct;
  const local = payload[localKey];
  if (typeof local === "string" && local) return syntheticId(scenarioId, local);
  return null;
}

export function applyOverridesToInstances(
  base: EnvInstanceRow[],
  overrides: ScenarioOverride[],
  scenarioId: string,
): EnvInstanceRow[] {
  const byId = new Map(base.map((i) => [i.id, { ...i, properties: { ...i.properties } }]));
  const removed = new Set<string>();

  for (const o of overrides) {
    if (o.targetType !== "instance") continue;
    const id = targetIdOf(o, scenarioId);
    if (!id) continue;

    if (o.op === "create") {
      const typeName = String(o.payload.objectType ?? "");
      if (!typeName) continue;
      // A created instance borrows the schema of an existing one of the same
      // type when there is one, so downstream code that reads propertySchema
      // does not have to special-case scenario objects.
      const sibling = base.find((i) => i.typeName === typeName);
      byId.set(id, {
        id,
        typeId: sibling?.typeId ?? syntheticId(scenarioId, `type:${typeName}`),
        typeName,
        properties: { ...((o.payload.properties as Record<string, unknown>) ?? {}) },
        provenance: { source: "scenario", scenarioId, overrideId: o.id },
        propertySchema: sibling?.propertySchema ?? [],
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
      removed.delete(id);
      continue;
    }

    if (o.op === "delete") {
      removed.add(id);
      byId.delete(id);
      continue;
    }

    if (o.op === "set_property") {
      const target = byId.get(id);
      // Setting a property on something this scenario deleted, or that never
      // existed, does nothing. validateOverrides reports the first case; the
      // second is a stale target and is equally not an error to resolve.
      if (!target) continue;
      const bulk = o.payload.properties as Record<string, unknown> | undefined;
      if (bulk && typeof bulk === "object") {
        Object.assign(target.properties, bulk);
      }
      const single = o.payload.property;
      if (typeof single === "string" && single) {
        target.properties[single] = o.payload.value ?? null;
      }
    }
  }

  return Array.from(byId.values());
}

export function applyOverridesToLinks(
  base: EnvLinkRow[],
  overrides: ScenarioOverride[],
  scenarioId: string,
  instances: EnvInstanceRow[],
): EnvLinkRow[] {
  const typeNameById = new Map(instances.map((i) => [i.id, i.typeName]));
  const live = new Map(base.map((l) => [`${l.linkTypeName}|${l.fromInstanceId}|${l.toInstanceId}`, l]));

  for (const o of overrides) {
    if (o.targetType !== "link") continue;
    const fromId = targetIdOf(o, scenarioId);
    const toId = payloadInstanceId(o.payload, scenarioId, "toId", "toLocalKey");
    const linkType = String(o.payload.linkType ?? "");
    if (!fromId || !toId || !linkType) continue;
    const key = `${linkType}|${fromId}|${toId}`;

    if (o.op === "unlink") {
      live.delete(key);
      continue;
    }
    if (o.op === "link") {
      live.set(key, {
        id: syntheticId(scenarioId, key),
        linkTypeName: linkType,
        fromInstanceId: fromId,
        toInstanceId: toId,
        fromTypeName: typeNameById.get(fromId) ?? "",
        toTypeName: typeNameById.get(toId) ?? "",
      });
    }
  }

  // A link whose endpoint the scenario deleted cannot stand — leaving it would
  // let the twin count a patient into a ward that no longer exists.
  const present = new Set(instances.map((i) => i.id));
  return Array.from(live.values()).filter(
    (l) => present.has(l.fromInstanceId) && present.has(l.toInstanceId),
  );
}

/** Simulation parameters a scenario sets. Ontology reads ignore these. */
export function scenarioParams(overrides: ScenarioOverride[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of overrides) {
    if (o.targetType !== "param" || o.op !== "set_param") continue;
    const key = String(o.payload.key ?? o.payload.property ?? "");
    if (key) out[key] = o.payload.value ?? null;
  }
  return out;
}
