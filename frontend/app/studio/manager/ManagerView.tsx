"use client";

/**
 * Ontology Manager — construct and edit an ontology from A-Z:
 *  - create/edit/delete object types and their property schema
 *  - define relationships (link types) between object types
 *  - browse, create, edit, link, and delete instances of each type
 *  - a visual schema graph (object types as boxes, link types as edges)
 *
 * Every mutation calls `bumpOntology()` (and `refreshEnvironments()` for env
 * changes) on the shared StudioContext so the Parser "Save to ontology" node
 * and the Studio "Ontology source" node immediately see new types/instances.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import {
  createEnvironment,
  createEnvLink,
  createEnvLinkType,
  createEnvObject,
  createEnvType,
  deleteEnvLink,
  deleteEnvLinkType,
  deleteEnvObject,
  deleteEnvType,
  getEnvObject,
  listEnvObjects,
  listEnvTypes,
  updateEnvObject,
  updateEnvType,
  type EnvInstance,
  type EnvLinkEdge,
  type EnvLinkType,
  type EnvObjectType,
  type EnvironmentType,
  type LinkCardinality,
  type PropertyDefinition,
  type PropertyType,
} from "@/lib/platform-api";
import { EDGE_HEX, NODE_W, pathD, pointGeom } from "../studio-graph";
import { useStudio } from "../StudioShell";

type View = "schema" | "instances";

const PROPERTY_TYPES: PropertyType[] = ["string", "number", "boolean", "object", "array"];
const CARDINALITIES: LinkCardinality[] = [
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
];

const SCHEMA_COLS = 2;
const SCHEMA_BOX_H = 84;
const COL_GAP = 320;
const ROW_GAP = 150;
const ORIGIN = { x: 48, y: 48 };

function instanceLabel(inst: EnvInstance): string {
  const p = inst.properties;
  return (
    (p.span as string) ||
    (p.display as string) ||
    (p.label as string) ||
    (p.identifier as string) ||
    (p.snomed_code as string) ||
    inst.id.slice(0, 8)
  );
}

const ENV_TYPE_HELP: Record<EnvironmentType, string> = {
  reference: "Shared catalogs (substances, codes) — starts empty.",
  entity: "Clinical sites — seeds Patient, ClinicalFinding, has_finding.",
  operations: "Supply chain / logistics — starts empty.",
};

export default function ManagerView() {
  const {
    hasKey,
    selectedEnv,
    setSelectedEnv,
    refreshEnvironments,
    ontologyVersion,
    bumpOntology,
  } = useStudio();

  const [view, setView] = useState<View>("schema");
  const [types, setTypes] = useState<EnvObjectType[]>([]);
  const [linkTypes, setLinkTypes] = useState<EnvLinkType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [objects, setObjects] = useState<EnvInstance[]>([]);
  const [whereInput, setWhereInput] = useState("");
  const [detail, setDetail] = useState<{ object: EnvInstance; links: EnvLinkEdge[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editor panels
  const [panel, setPanel] = useState<"none" | "newType" | "newLinkType" | "newInstance">(
    "none",
  );

  const env = selectedEnv;

  const loadTypes = useCallback(async () => {
    if (!env) {
      setTypes([]);
      setLinkTypes([]);
      return;
    }
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
    setDetail(null);
    void loadTypes();
  }, [loadTypes, ontologyVersion]);

  const loadObjects = useCallback(async () => {
    if (!env || !selectedType) {
      setObjects([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { objects: o } = await listEnvObjects(env, {
        type: selectedType,
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
    if (view === "instances") void loadObjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, env, selectedType, ontologyVersion]);

  async function openInstance(id: string) {
    if (!env) return;
    try {
      setDetail(await getEnvObject(env, id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function notifyChanged() {
    bumpOntology();
  }

  const selectedTypeDef = useMemo(
    () => types.find((t) => t.name === selectedType) ?? null,
    [types, selectedType],
  );

  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    types.forEach((t, i) => {
      const col = i % SCHEMA_COLS;
      const row = Math.floor(i / SCHEMA_COLS);
      m.set(t.name, { x: ORIGIN.x + col * COL_GAP, y: ORIGIN.y + row * ROW_GAP });
    });
    return m;
  }, [types]);

  if (!hasKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="max-w-sm text-center text-sm text-gray-500">
          Sign in and create an API key to model ontology environments.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left sidebar — environment + types + link types */}
      <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white">
        <EnvironmentCreator
          onCreated={async (slug) => {
            await refreshEnvironments();
            setSelectedEnv(slug);
            bumpOntology();
          }}
          onError={setError}
        />

        <div className="border-b border-gray-100 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
              Object types
            </span>
            <button
              type="button"
              disabled={!env}
              onClick={() => setPanel(panel === "newType" ? "none" : "newType")}
              className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-gray-400 disabled:text-gray-300"
            >
              + New
            </button>
          </div>
          {types.length === 0 ? (
            <p className="text-[11px] text-gray-400">
              {env ? "No object types yet." : "Select an environment."}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedType(t.name);
                    setDetail(null);
                    setPanel("none");
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

        <div className="border-b border-gray-100 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
              Relationships
            </span>
            <button
              type="button"
              disabled={!env || types.length < 1}
              onClick={() => setPanel(panel === "newLinkType" ? "none" : "newLinkType")}
              className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-gray-400 disabled:text-gray-300"
            >
              + New
            </button>
          </div>
          {linkTypes.length === 0 ? (
            <p className="text-[11px] text-gray-400">No relationships yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {linkTypes.map((lt) => (
                <div
                  key={lt.id}
                  className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-600"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">{lt.name}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!env) return;
                        try {
                          await deleteEnvLinkType(env, lt.name);
                          await loadTypes();
                          notifyChanged();
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                      className="text-[10px] text-gray-400 hover:text-rose-600"
                    >
                      delete
                    </button>
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-400">
                    {lt.fromType} → {lt.toType}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Center — schema / instances */}
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
                  view === v ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900",
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
                onClick={() => void loadObjects()}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Refresh
              </button>
              <button
                type="button"
                disabled={!selectedType}
                onClick={() => setPanel("newInstance")}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
              >
                + Instance
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
                No schema yet. Create an object type to begin modeling.
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
                        <path d={pathD(g)} fill="none" stroke={EDGE_HEX} strokeWidth={1.5} />
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
                        setDetail(null);
                        setPanel("none");
                      }}
                      className={cn(
                        "absolute overflow-hidden rounded-lg border bg-white text-left shadow-sm transition-colors",
                        selectedType === t.name
                          ? "border-indigo-400"
                          : "border-gray-300 hover:border-gray-400",
                      )}
                      style={{ left: pos.x, top: pos.y, width: NODE_W, minHeight: SCHEMA_BOX_H }}
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
                    <th className="px-2 py-1.5 font-medium">Updated</th>
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
                      <td className="px-2 py-1.5 text-gray-400">
                        {new Date(o.updatedAt).toLocaleString()}
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

      {/* Right inspector — context-dependent editor */}
      {panel === "newType" ? (
        <TypeEditorPanel
          mode="create"
          onClose={() => setPanel("none")}
          onSubmit={async (name, description, schema) => {
            if (!env) return;
            await createEnvType(env, { name, description, propertySchema: schema });
            await loadTypes();
            setSelectedType(name);
            notifyChanged();
            setPanel("none");
          }}
          onError={setError}
        />
      ) : panel === "newLinkType" ? (
        <LinkTypeEditorPanel
          types={types}
          onClose={() => setPanel("none")}
          onSubmit={async (name, fromType, toType, cardinality) => {
            if (!env) return;
            await createEnvLinkType(env, { name, fromType, toType, cardinality });
            await loadTypes();
            notifyChanged();
            setPanel("none");
          }}
          onError={setError}
        />
      ) : panel === "newInstance" && selectedTypeDef ? (
        <InstanceEditorPanel
          typeDef={selectedTypeDef}
          onClose={() => setPanel("none")}
          onSubmit={async (properties) => {
            if (!env) return;
            await createEnvObject(env, { type: selectedTypeDef.name, properties });
            await loadObjects();
            notifyChanged();
            setPanel("none");
          }}
          onError={setError}
        />
      ) : detail ? (
        <InstanceDetailPanel
          env={env!}
          detail={detail}
          types={types}
          linkTypes={linkTypes}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            await loadObjects();
            await openInstance(detail.object.id);
            notifyChanged();
          }}
          onDeleted={async () => {
            setDetail(null);
            await loadObjects();
            notifyChanged();
          }}
          onError={setError}
        />
      ) : selectedTypeDef ? (
        <TypeEditorPanel
          key={selectedTypeDef.id}
          mode="edit"
          initial={selectedTypeDef}
          onClose={() => setSelectedType(null)}
          onSubmit={async (_name, description, schema) => {
            if (!env) return;
            await updateEnvType(env, selectedTypeDef.name, { description, propertySchema: schema });
            await loadTypes();
            notifyChanged();
          }}
          onDelete={async () => {
            if (!env) return;
            await deleteEnvType(env, selectedTypeDef.name);
            setSelectedType(null);
            await loadTypes();
            notifyChanged();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environment creator
// ---------------------------------------------------------------------------

function EnvironmentCreator({
  onCreated,
  onError,
}: {
  onCreated: (slug: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<EnvironmentType>("entity");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const env = await createEnvironment({ name: name.trim(), type });
      setName("");
      await onCreated(env.slug);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-gray-100 p-3">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-gray-400">
        New environment
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="e.g. Site A Clinical"
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EnvironmentType)}
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
        >
          <option value="reference">Reference</option>
          <option value="entity">Entity</option>
          <option value="operations">Operations</option>
        </select>
        <p className="text-[10px] leading-relaxed text-gray-400">{ENV_TYPE_HELP[type]}</p>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="w-full rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Add environment
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property rows editor (shared by create/edit object type)
// ---------------------------------------------------------------------------

function PropertyRowsEditor({
  rows,
  onChange,
}: {
  rows: PropertyDefinition[];
  onChange: (rows: PropertyDefinition[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            value={row.key}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, key: e.target.value };
              onChange(next);
            }}
            placeholder="key"
            className="min-w-0 flex-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[11px] text-gray-800 focus:border-gray-400 focus:outline-none"
          />
          <select
            value={row.type}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, type: e.target.value as PropertyType };
              onChange(next);
            }}
            className="rounded border border-gray-200 bg-gray-50 px-1 py-1 text-[11px] text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="rounded px-1 text-gray-400 hover:text-rose-600"
            aria-label="Remove property"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", type: "string" }])}
        className="self-start rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-gray-400"
      >
        + Property
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Object-type editor panel (create + edit)
// ---------------------------------------------------------------------------

function TypeEditorPanel({
  mode,
  initial,
  onClose,
  onSubmit,
  onDelete,
  onError,
}: {
  mode: "create" | "edit";
  initial?: EnvObjectType;
  onClose: () => void;
  onSubmit: (name: string, description: string, schema: PropertyDefinition[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rows, setRows] = useState<PropertyDefinition[]>(
    (initial?.propertySchema as PropertyDefinition[]) ?? [],
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (mode === "create" && !name.trim()) {
      onError("Object type name is required.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(
        name.trim(),
        description.trim(),
        rows.filter((r) => r.key.trim()).map((r) => ({ ...r, key: r.key.trim() })),
      );
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader
        title={mode === "create" ? "New object type" : `Edit ${initial?.name}`}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto p-4">
        <Labelled label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={mode === "edit"}
            placeholder="e.g. Specimen"
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none disabled:text-gray-400"
          />
        </Labelled>
        <Labelled label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          />
        </Labelled>
        <Labelled label="Properties">
          <PropertyRowsEditor rows={rows} onChange={setRows} />
        </Labelled>
      </div>
      <div className="flex items-center gap-2 border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          {mode === "create" ? "Create type" : "Save changes"}
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await onDelete();
              } catch (err) {
                onError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 hover:bg-rose-100"
          >
            Delete
          </button>
        ) : null}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Link-type editor panel
// ---------------------------------------------------------------------------

function LinkTypeEditorPanel({
  types,
  onClose,
  onSubmit,
  onError,
}: {
  types: EnvObjectType[];
  onClose: () => void;
  onSubmit: (
    name: string,
    fromType: string,
    toType: string,
    cardinality: LinkCardinality,
  ) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [fromType, setFromType] = useState(types[0]?.name ?? "");
  const [toType, setToType] = useState(types[0]?.name ?? "");
  const [cardinality, setCardinality] = useState<LinkCardinality>("many_to_many");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (!name.trim() || !fromType || !toType) {
      onError("Name, from, and to are required.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name.trim(), fromType, toType, cardinality);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader title="New relationship" onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <Labelled label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. collected_from"
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          />
        </Labelled>
        <Labelled label="From type">
          <select
            value={fromType}
            onChange={(e) => setFromType(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {types.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="To type">
          <select
            value={toType}
            onChange={(e) => setToType(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {types.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Cardinality">
          <select
            value={cardinality}
            onChange={(e) => setCardinality(e.target.value as LinkCardinality)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {CARDINALITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Create relationship
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Instance create panel (form derived from property schema)
// ---------------------------------------------------------------------------

function coerceValue(type: PropertyType, raw: string): unknown {
  if (raw === "") return type === "string" ? "" : null;
  if (type === "number") return Number(raw);
  if (type === "boolean") return raw === "true";
  if (type === "object" || type === "array") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function InstanceEditorPanel({
  typeDef,
  initial,
  onClose,
  onSubmit,
  onError,
}: {
  typeDef: EnvObjectType;
  initial?: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (properties: Record<string, unknown>) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const p of typeDef.propertySchema) {
      const cur = initial?.[p.key];
      v[p.key] =
        cur == null
          ? ""
          : typeof cur === "object"
            ? JSON.stringify(cur)
            : String(cur);
    }
    return v;
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const properties: Record<string, unknown> = {};
      for (const p of typeDef.propertySchema) {
        properties[p.key] = coerceValue(p.type as PropertyType, values[p.key] ?? "");
      }
      await onSubmit(properties);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader
        title={initial ? `Edit ${typeDef.name}` : `New ${typeDef.name}`}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto p-4">
        {typeDef.propertySchema.length === 0 ? (
          <p className="text-[11px] text-gray-400">
            This type has no properties. Add some in the type editor first.
          </p>
        ) : (
          typeDef.propertySchema.map((p) => (
            <Labelled key={p.key} label={`${p.label ?? p.key} · ${p.type}`}>
              {p.type === "boolean" ? (
                <select
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                  className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
                >
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={p.type === "number" ? "number" : "text"}
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                  placeholder={p.type === "object" || p.type === "array" ? "JSON" : ""}
                  className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
                />
              )}
            </Labelled>
          ))
        )}
      </div>
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          {initial ? "Save changes" : "Create instance"}
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Instance detail panel (view/edit properties, links, delete)
// ---------------------------------------------------------------------------

function InstanceDetailPanel({
  env,
  detail,
  types,
  linkTypes,
  onClose,
  onChanged,
  onDeleted,
  onError,
}: {
  env: string;
  detail: { object: EnvInstance; links: EnvLinkEdge[] };
  types: EnvObjectType[];
  linkTypes: EnvLinkType[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const { object, links } = detail;
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const typeDef = types.find((t) => t.name === object.typeName) ?? null;

  if (editing && typeDef) {
    return (
      <InstanceEditorPanel
        typeDef={typeDef}
        initial={object.properties}
        onClose={() => setEditing(false)}
        onSubmit={async (properties) => {
          await updateEnvObject(env, object.id, { properties });
          setEditing(false);
          await onChanged();
        }}
        onError={onError}
      />
    );
  }

  if (linking) {
    return (
      <LinkInstancePanel
        env={env}
        fromInstance={object}
        linkTypes={linkTypes}
        onClose={() => setLinking(false)}
        onLinked={async () => {
          setLinking(false);
          await onChanged();
        }}
        onError={onError}
      />
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader title={instanceLabel(object)} onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <SectionLabel>Properties</SectionLabel>
        <dl className="mb-4 space-y-1">
          {Object.entries(object.properties).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 text-[11px]">
              <dt className="text-gray-400">{k}</dt>
              <dd className="max-w-[60%] truncate text-right font-medium text-gray-700">
                {v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mb-4 flex items-center justify-between">
          <SectionLabel>Linked objects</SectionLabel>
          <button
            type="button"
            onClick={() => setLinking(true)}
            disabled={linkTypes.length === 0}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-gray-400 disabled:text-gray-300"
          >
            + Link
          </button>
        </div>
        {links.length === 0 ? (
          <p className="text-[11px] text-gray-400">No links.</p>
        ) : (
          <ul className="space-y-1.5">
            {links.map((l) => (
              <li
                key={l.id}
                className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">
                    {(l.otherProperties.span as string) ||
                      (l.otherProperties.label as string) ||
                      l.otherType}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await deleteEnvLink(env, l.id);
                        await onChanged();
                      } catch (err) {
                        onError((err as Error).message);
                      }
                    }}
                    className="text-[10px] text-gray-400 hover:text-rose-600"
                  >
                    unlink
                  </button>
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                  {l.direction === "out" ? "→" : "←"} {l.linkType} · {l.otherType}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={!typeDef}
          className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await deleteEnvObject(env, object.id);
              await onDeleted();
            } catch (err) {
              onError((err as Error).message);
            }
          }}
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 hover:bg-rose-100"
        >
          Delete
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Link instance panel (connect this instance to another)
// ---------------------------------------------------------------------------

function LinkInstancePanel({
  env,
  fromInstance,
  linkTypes,
  onClose,
  onLinked,
  onError,
}: {
  env: string;
  fromInstance: EnvInstance;
  linkTypes: EnvLinkType[];
  onClose: () => void;
  onLinked: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [linkType, setLinkType] = useState(linkTypes[0]?.name ?? "");
  const [candidates, setCandidates] = useState<EnvInstance[]>([]);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedLinkType = linkTypes.find((lt) => lt.name === linkType) ?? null;

  useEffect(() => {
    if (!selectedLinkType) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    void listEnvObjects(env, { type: selectedLinkType.toType, limit: 100 })
      .then(({ objects }) => {
        if (!cancelled) setCandidates(objects.filter((o) => o.id !== fromInstance.id));
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [env, selectedLinkType, fromInstance.id]);

  async function save() {
    if (busy || !linkType || !targetId) {
      if (!targetId) onError("Pick a target instance.");
      return;
    }
    setBusy(true);
    try {
      await createEnvLink(env, { linkType, fromId: fromInstance.id, toId: targetId });
      await onLinked();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
      <PanelHeader title="Create link" onClose={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
        <Labelled label="Relationship">
          <select
            value={linkType}
            onChange={(e) => {
              setLinkType(e.target.value);
              setTargetId("");
            }}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            {linkTypes.map((lt) => (
              <option key={lt.id} value={lt.name}>
                {lt.name} ({lt.fromType} → {lt.toType})
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Target instance">
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none"
          >
            <option value="">Select…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {instanceLabel(c)}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      <div className="border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs text-white hover:bg-gray-700 disabled:bg-gray-300"
        >
          Create link
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Small shared UI
// ---------------------------------------------------------------------------

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <span className="truncate text-sm font-medium text-gray-800">{title}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
      {children}
    </span>
  );
}
