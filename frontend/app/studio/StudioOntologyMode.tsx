"use client";

/**
 * Studio "Ontology" mode — browse an environment's schema and instances.
 *
 * SCHEMA view reuses the canvas graph geometry (object_types as boxes,
 * link_types as bezier edges). INSTANCES view is a filterable table with a
 * context-envelope `where` filter (the structured query a code-only store
 * cannot do). The right inspector shows a selected instance's properties,
 * provenance, and linked objects.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import {
  createEnvironment,
  getEnvObject,
  listEnvObjects,
  listEnvTypes,
  type EnvInstance,
  type EnvLinkEdge,
  type EnvLinkType,
  type EnvObjectType,
  type EnvironmentType,
} from "@/lib/platform-api";
import { EDGE_HEX, NODE_W, pathD, pointGeom } from "./studio-graph";

type View = "schema" | "instances";

const SCHEMA_COLS = 2;
const SCHEMA_BOX_H = 84;
const COL_GAP = 320;
const ROW_GAP = 150;
const ORIGIN = { x: 48, y: 48 };

/** Pick a short, human label for an instance row/inspector header. */
function instanceLabel(inst: EnvInstance): string {
  const p = inst.properties;
  return (
    (p.span as string) ||
    (p.display as string) ||
    (p.label as string) ||
    (p.snomed_code as string) ||
    inst.id.slice(0, 8)
  );
}

export default function StudioOntologyMode({
  env,
  hasKey,
  onEnvironmentsChanged,
}: {
  env: string | null;
  hasKey: boolean;
  onEnvironmentsChanged: () => void;
}) {
  const [view, setView] = useState<View>("schema");
  const [types, setTypes] = useState<EnvObjectType[]>([]);
  const [linkTypes, setLinkTypes] = useState<EnvLinkType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [objects, setObjects] = useState<EnvInstance[]>([]);
  const [whereInput, setWhereInput] = useState("");
  const [detail, setDetail] = useState<
    { object: EnvInstance; links: EnvLinkEdge[] } | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newEnvName, setNewEnvName] = useState("");
  const [newEnvType, setNewEnvType] = useState<EnvironmentType>("entity");
  const [creatingEnv, setCreatingEnv] = useState(false);

  const ENV_TYPE_HELP: Record<EnvironmentType, string> = {
    reference: "Shared catalogs (substances, codes) — starts empty.",
    entity: "Clinical sites — seeds Patient, ClinicalFinding, has_finding.",
    operations: "Supply chain / logistics — starts empty.",
  };

  const loadTypes = useCallback(async () => {
    if (!env) {
      setTypes([]);
      setLinkTypes([]);
      return;
    }
    setError(null);
    try {
      const { types: t, linkTypes: lt } = await listEnvTypes(env);
      setTypes(t);
      setLinkTypes(lt);
      setSelectedType((cur) => cur ?? t[0]?.name ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [env]);

  useEffect(() => {
    setSelectedType(null);
    setDetail(null);
    setObjects([]);
    void loadTypes();
  }, [loadTypes]);

  const loadObjects = useCallback(async () => {
    if (!env) return;
    setLoading(true);
    setError(null);
    try {
      const { objects: o } = await listEnvObjects(env, {
        type: selectedType ?? undefined,
        where: whereInput.trim() || undefined,
        limit: 100,
      });
      setObjects(o);
    } catch (err) {
      setError((err as Error).message);
      setObjects([]);
    } finally {
      setLoading(false);
    }
  }, [env, selectedType, whereInput]);

  useEffect(() => {
    if (view === "instances" && env) void loadObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, env, selectedType]);

  async function openInstance(id: string) {
    if (!env) return;
    setError(null);
    try {
      const d = await getEnvObject(env, id);
      setDetail(d);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCreateEnvironment() {
    if (!newEnvName.trim() || creatingEnv) return;
    setCreatingEnv(true);
    setError(null);
    try {
      await createEnvironment({ name: newEnvName.trim(), type: newEnvType });
      setNewEnvName("");
      onEnvironmentsChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingEnv(false);
    }
  }

  // Schema layout: place each object type on a grid; map name -> box position.
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    types.forEach((t, i) => {
      const col = i % SCHEMA_COLS;
      const row = Math.floor(i / SCHEMA_COLS);
      m.set(t.name, {
        x: ORIGIN.x + col * COL_GAP,
        y: ORIGIN.y + row * ROW_GAP,
      });
    });
    return m;
  }, [types]);

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to browse ontology environments.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left sidebar — object types + env creator */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
            Object types
          </div>
          {types.length === 0 ? (
            <p className="text-[11px] text-gray-400">
              {env ? "No object types in this environment." : "Select an environment."}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedType(t.name);
                    setView("instances");
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                    selectedType === t.name
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 text-gray-700 hover:border-gray-400 hover:bg-gray-50",
                  )}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-gray-400">
                    {t.propertySchema.length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {linkTypes.length > 0 ? (
          <div className="border-b border-gray-100 p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
              Link types
            </div>
            <div className="flex flex-col gap-1">
              {linkTypes.map((lt) => (
                <div
                  key={lt.id}
                  className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-600"
                >
                  <span className="font-medium text-gray-800">{lt.name}</span>
                  <div className="mt-0.5 text-[10px] text-gray-400">
                    {lt.fromType} → {lt.toType}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-auto border-t border-gray-100 p-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
            New environment
          </div>
          <div className="mb-1.5 flex flex-col gap-1.5">
            <input
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreateEnvironment();
              }}
              placeholder="e.g. Site A Clinical"
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
            />
            <select
              value={newEnvType}
              onChange={(e) => setNewEnvType(e.target.value as EnvironmentType)}
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
            >
              <option value="reference">Reference</option>
              <option value="entity">Entity</option>
              <option value="operations">Operations</option>
            </select>
            <p className="text-[10px] leading-relaxed text-gray-400">
              {ENV_TYPE_HELP[newEnvType]}
            </p>
            <button
              type="button"
              onClick={onCreateEnvironment}
              disabled={creatingEnv || !newEnvName.trim()}
              className="w-full rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
            >
              Add environment
            </button>
          </div>
        </div>
      </aside>

      {/* Center — view toggle + schema/instances */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <div className="flex rounded-md border border-gray-200 p-0.5">
            {(["schema", "instances"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium capitalize transition-colors",
                  view === v
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:text-gray-900",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          {view === "instances" ? (
            <div className="flex items-center gap-1.5">
              <input
                value={whereInput}
                onChange={(e) => setWhereInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadObjects();
                }}
                placeholder="where: assertion:affirmed,subject:patient"
                className="w-72 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-[11px] text-gray-800 focus:border-gray-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={loadObjects}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Apply
              </button>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-700">
            {error}
          </div>
        ) : null}

        {view === "schema" ? (
          <div
            className="relative min-h-0 flex-1 overflow-auto"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          >
            {types.length === 0 ? (
              <p className="p-6 text-sm text-gray-400">
                No schema to display for this environment.
              </p>
            ) : (
              <div className="relative" style={{ width: 5000, height: 3000 }}>
                <svg
                  className="pointer-events-none absolute left-0 top-0"
                  width={5000}
                  height={3000}
                >
                  {linkTypes.map((lt) => {
                    const from = positions.get(lt.fromType);
                    const to = positions.get(lt.toType);
                    if (!from || !to) return null;
                    const a = { x: from.x + NODE_W, y: from.y + SCHEMA_BOX_H / 2 };
                    const b = { x: to.x, y: to.y + SCHEMA_BOX_H / 2 };
                    const g = pointGeom(a, b);
                    return (
                      <g key={lt.id}>
                        <path
                          d={pathD(g)}
                          fill="none"
                          stroke={EDGE_HEX}
                          strokeWidth={1.5}
                        />
                        <text
                          x={(a.x + b.x) / 2}
                          y={(a.y + b.y) / 2 - 6}
                          textAnchor="middle"
                          className="fill-gray-400"
                          fontSize={10}
                        >
                          {lt.name}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {types.map((t) => {
                  const pos = positions.get(t.name)!;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setSelectedType(t.name);
                        setView("instances");
                      }}
                      className={cn(
                        "absolute overflow-hidden rounded-lg border bg-white text-left shadow-sm transition-colors",
                        selectedType === t.name
                          ? "border-indigo-400"
                          : "border-gray-300 hover:border-gray-400",
                      )}
                      style={{
                        left: pos.x,
                        top: pos.y,
                        width: NODE_W,
                        minHeight: SCHEMA_BOX_H,
                      }}
                    >
                      <div className="border-b border-gray-100 px-3 py-2 text-xs font-medium text-gray-800">
                        {t.name}
                      </div>
                      <div className="px-3 py-1.5 text-[10px] text-gray-500">
                        {t.propertySchema.length} propert
                        {t.propertySchema.length === 1 ? "y" : "ies"}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : objects.length === 0 ? (
              <p className="text-sm text-gray-400">
                No instances{selectedType ? ` of ${selectedType}` : ""}
                {whereInput.trim() ? " match this filter." : " yet."}
              </p>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="px-2 py-1.5 font-medium">Label</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium">Assertion</th>
                    <th className="px-2 py-1.5 font-medium">Subject</th>
                    <th className="px-2 py-1.5 font-medium">Decision</th>
                    <th className="px-2 py-1.5 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {objects.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => openInstance(o.id)}
                      className={cn(
                        "cursor-pointer border-b border-gray-100 hover:bg-gray-50",
                        detail?.object.id === o.id ? "bg-indigo-50" : "",
                      )}
                    >
                      <td className="px-2 py-1.5 font-medium text-gray-800">
                        {instanceLabel(o)}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500">{o.typeName}</td>
                      <td className="px-2 py-1.5 text-gray-600">
                        {(o.properties.assertion as string) ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">
                        {(o.properties.subject as string) ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">
                        {(o.properties.decision as string) ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-gray-400">
                        {(o.provenance.source as string) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Right inspector — selected instance */}
      {detail ? (
        <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <span className="truncate text-sm font-medium text-gray-800">
              {instanceLabel(detail.object)}
            </span>
            <button
              type="button"
              onClick={() => setDetail(null)}
              aria-label="Close"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
              Properties
            </span>
            <dl className="mb-4 space-y-1">
              {Object.entries(detail.object.properties).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 text-[11px]">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className="max-w-[60%] truncate text-right font-medium text-gray-700">
                    {v == null ? "—" : String(v)}
                  </dd>
                </div>
              ))}
            </dl>

            <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
              Provenance
            </span>
            <dl className="mb-4 space-y-1">
              {Object.entries(detail.object.provenance).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 text-[11px]">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className="max-w-[60%] truncate text-right font-mono text-[10px] text-gray-600">
                    {v == null ? "—" : String(v)}
                  </dd>
                </div>
              ))}
            </dl>

            <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
              Linked objects
            </span>
            {detail.links.length === 0 ? (
              <p className="text-[11px] text-gray-400">No links.</p>
            ) : (
              <ul className="space-y-1.5">
                {detail.links.map((l) => (
                  <li
                    key={l.id}
                    onClick={() => openInstance(l.otherId)}
                    className="cursor-pointer rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] hover:border-gray-400 hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">
                        {(l.otherProperties.span as string) ||
                          (l.otherProperties.label as string) ||
                          l.otherType}
                      </span>
                      <span className="text-[9px] uppercase tracking-wide text-gray-400">
                        {l.direction === "out" ? "→" : "←"} {l.linkType}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {l.otherType}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
