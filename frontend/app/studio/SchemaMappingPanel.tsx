"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import type { EnvObjectType } from "@/lib/platform-api";
import {
  autoMatchFieldMap,
  FIELD_PATH_MIME,
  fieldPathsFromInput,
  type NodeDataBag,
} from "./studio-data";

type SchemaMappingPanelProps = {
  objectType: string;
  fieldMap: { property: string; source: string }[];
  envTypes: EnvObjectType[];
  upstreamInput: NodeDataBag;
  onObjectTypeChange: (name: string) => void;
  onFieldMapChange: (rows: { property: string; source: string }[]) => void;
};

export default function SchemaMappingPanel({
  objectType,
  fieldMap,
  envTypes,
  upstreamInput,
  onObjectTypeChange,
  onFieldMapChange,
}: SchemaMappingPanelProps) {
  const selectedType = useMemo(
    () => envTypes.find((t) => t.name === objectType) ?? null,
    [envTypes, objectType],
  );

  const sourcePaths = useMemo(() => fieldPathsFromInput(upstreamInput), [upstreamInput]);

  useEffect(() => {
    if (!selectedType) return;
    const schema = selectedType.propertySchema;
    if (!schema.length) return;
    const existing = new Map(fieldMap.map((r) => [r.property, r.source]));
    const next = schema.map((p) => ({
      property: p.key,
      source: existing.get(p.key) ?? "",
    }));
    const changed =
      next.length !== fieldMap.length ||
      next.some((r, i) => r.property !== fieldMap[i]?.property);
    if (changed) onFieldMapChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType?.id, objectType]);

  function setSource(property: string, source: string) {
    const idx = fieldMap.findIndex((r) => r.property === property);
    if (idx >= 0) {
      const next = [...fieldMap];
      next[idx] = { ...next[idx]!, source };
      onFieldMapChange(next);
    } else {
      onFieldMapChange([...fieldMap, { property, source }]);
    }
  }

  function handleAutoMatch() {
    if (!selectedType) return;
    onFieldMapChange(autoMatchFieldMap(selectedType.propertySchema, sourcePaths));
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-body">
          Target object type
        </span>
        <select
          value={objectType}
          onChange={(e) => onObjectTypeChange(e.target.value)}
          className="w-full rounded-md border border-line bg-canvas-raised px-2.5 py-2 text-xs text-ink focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-line"
        >
          <option value="">Select a type…</option>
          {envTypes.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {sourcePaths.length > 0 ? (
        <div>
          <span className="mb-1 block text-[9px] uppercase tracking-wide text-ink-faint">
            Source fields
          </span>
          <div className="flex flex-wrap gap-1">
            {sourcePaths.map((path) => (
              <span
                key={path}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(FIELD_PATH_MIME, path);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className="cursor-grab rounded border border-sky-400/40 bg-sky-400/15 px-1.5 py-0.5 text-[10px] text-sky-300 active:cursor-grabbing"
              >
                {path}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-warn-ink">
          Run upstream nodes to discover source fields, or use Auto-match after
          running.
        </p>
      )}

      {selectedType ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-ink-faint">
              Ontology properties
            </span>
            <button
              type="button"
              onClick={handleAutoMatch}
              disabled={sourcePaths.length === 0}
              className="rounded border border-line px-2 py-0.5 text-[10px] text-ink-muted hover:border-line-strong disabled:text-ink-ghost"
            >
              Auto-match
            </button>
          </div>

          {selectedType.propertySchema.length === 0 ? (
            <p className="text-[11px] text-ink-faint">
              This type has no properties. Add them in Ontology Manager.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {selectedType.propertySchema.map((prop) => {
                const mapped = fieldMap.find((r) => r.property === prop.key);
                const source = mapped?.source ?? "";
                return (
                  <PropertyDropRow
                    key={prop.key}
                    propertyKey={prop.key}
                    propertyType={prop.type}
                    label={prop.label}
                    source={source}
                    onDrop={(path) => setSource(prop.key, path)}
                    onClear={() => setSource(prop.key, "")}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-ink-faint">
          Select an object type to see its properties from the Ontology Manager.
        </p>
      )}
    </div>
  );
}

function PropertyDropRow({
  propertyKey,
  propertyType,
  label,
  source,
  onDrop,
  onClear,
}: {
  propertyKey: string;
  propertyType: string;
  label?: string;
  source: string;
  onDrop: (path: string) => void;
  onClear: () => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const path = e.dataTransfer.getData(FIELD_PATH_MIME);
        if (path) onDrop(path);
      }}
      className={cn(
        "rounded-md border px-2 py-1.5 transition-colors",
        over
          ? "border-indigo-400 bg-indigo-400/15"
          : source
            ? "border-ok-line bg-ok-soft/50"
            : "border-line bg-canvas-raised",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-medium text-ink">{propertyKey}</span>
          <span className="ml-1.5 text-[9px] text-ink-faint">{propertyType}</span>
          {label ? (
            <span className="ml-1 text-[10px] text-ink-muted">· {label}</span>
          ) : null}
        </div>
        {source ? (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-[10px] text-ink-faint hover:text-danger"
          >
            clear
          </button>
        ) : null}
      </div>
      <div className="mt-0.5 text-[10px] text-ink-muted">
        {source ? (
          <span className="text-ok-ink">← {source}</span>
        ) : (
          <span className="text-ink-faint">Drop source field here</span>
        )}
      </div>
    </div>
  );
}
