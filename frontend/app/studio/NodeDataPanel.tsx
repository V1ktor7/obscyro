"use client";

import { useCallback, useState } from "react";

import { cn } from "@/lib/cn";
import {
  FIELD_PATH_MIME,
  fieldPathsFromInput,
  formatNodeDataPreview,
  hasNodeData,
  type NodeDataBag,
} from "./studio-data";

type NodeDataPanelProps = {
  data: NodeDataBag | null;
  emptyHint?: string;
  draggableFields?: boolean;
  className?: string;
};

export default function NodeDataPanel({
  data,
  emptyHint = "No data yet.",
  draggableFields = false,
  className,
}: NodeDataPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(path);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  if (!data || !hasNodeData(data)) {
    return (
      <p className={cn("text-[11px] leading-relaxed text-gray-400", className)}>
        {emptyHint}
      </p>
    );
  }

  const preview = formatNodeDataPreview(data);
  const recordCount = data.records?.length ?? data.instances?.length ?? 0;
  const fieldPaths = draggableFields ? fieldPathsFromInput(data) : [];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {recordCount > 0 ? (
        <span className="self-start rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[9px] text-gray-500">
          {recordCount} item{recordCount === 1 ? "" : "s"}
        </span>
      ) : null}

      {draggableFields && fieldPaths.length > 0 ? (
        <div>
          <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.18em] text-gray-400">
            Fields (drag to map)
          </span>
          <div className="flex flex-wrap gap-1">
            {fieldPaths.map((path) => (
              <button
                key={path}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(FIELD_PATH_MIME, path);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => void copyPath(path)}
                title="Drag to map or click to copy"
                className={cn(
                  "cursor-grab rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] text-sky-800 active:cursor-grabbing",
                  copied === path && "border-emerald-300 bg-emerald-50 text-emerald-800",
                )}
              >
                {path}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <JsonTree value={preview} depth={0} copyPath={copyPath} copied={copied} />
    </div>
  );
}

function JsonTree({
  value,
  depth,
  label,
  copyPath,
  copied,
}: {
  value: unknown;
  depth: number;
  label?: string;
  copyPath: (path: string) => void;
  copied: string | null;
}) {
  if (value === null || value === undefined) {
    return (
      <span className="font-mono text-[10px] text-gray-400">
        {label ? `${label}: ` : ""}
        null
      </span>
    );
  }

  if (typeof value !== "object") {
    const display =
      typeof value === "string" && value.length > 80
        ? `${value.slice(0, 80)}…`
        : String(value);
    return (
      <div className="font-mono text-[10px] text-gray-700">
        {label ? (
          <span className="text-violet-600">{label}: </span>
        ) : null}
        <span className="text-emerald-700">{display}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span className="font-mono text-[10px] text-gray-400">
          {label ? `${label}: ` : ""}[]
        </span>
      );
    }
    if (depth >= 2) {
      return (
        <span className="font-mono text-[10px] text-gray-500">
          {label ? `${label}: ` : ""}[{value.length} items]
        </span>
      );
    }
    return (
      <details open={depth < 1} className="group">
        <summary className="cursor-pointer font-mono text-[10px] text-gray-600 hover:text-gray-900">
          {label ?? "array"} [{value.length}]
        </summary>
        <div className="ml-3 border-l border-gray-200 pl-2">
          {value.slice(0, 20).map((item, i) => (
            <JsonTree
              key={i}
              value={item}
              depth={depth + 1}
              label={`[${i}]`}
              copyPath={copyPath}
              copied={copied}
            />
          ))}
          {value.length > 20 ? (
            <span className="text-[10px] text-gray-400">…{value.length - 20} more</span>
          ) : null}
        </div>
      </details>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return (
      <span className="font-mono text-[10px] text-gray-400">
        {label ? `${label}: ` : ""}
        {"{}"}
      </span>
    );
  }

  return (
    <details open={depth < 1} className="group">
      <summary className="cursor-pointer font-mono text-[10px] text-gray-600 hover:text-gray-900">
        {label ?? "object"} {"{"}
        {entries.length}
        {"}"}
      </summary>
      <div className="ml-3 border-l border-gray-200 pl-2">
        {entries.map(([k, v]) => (
          <div key={k} className="py-0.5">
            <JsonTree
              value={v}
              depth={depth + 1}
              label={k}
              copyPath={copyPath}
              copied={copied}
            />
          </div>
        ))}
      </div>
    </details>
  );
}
