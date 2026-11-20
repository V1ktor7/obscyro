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
      <p className={cn("text-[11px] leading-relaxed text-ink-faint", className)}>
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
        <span className="self-start rounded-full bg-canvas-raised px-2 py-0.5 text-[9px] text-ink-muted">
          {recordCount} item{recordCount === 1 ? "" : "s"}
        </span>
      ) : null}

      {draggableFields && fieldPaths.length > 0 ? (
        <div>
          <span className="mb-1 block text-[9px] uppercase tracking-wide text-ink-faint">
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
                  "cursor-grab rounded border border-sky-400/40 bg-sky-400/15 px-1.5 py-0.5 text-[10px] text-sky-300 active:cursor-grabbing",
                  copied === path && "border-ok-line bg-ok-soft text-ok-ink",
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
      <span className="text-[10px] text-ink-faint">
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
      <div className="text-[10px] text-ink-body">
        {label ? (
          <span className="text-scenario">{label}: </span>
        ) : null}
        <span className="text-ok-ink">{display}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span className="text-[10px] text-ink-faint">
          {label ? `${label}: ` : ""}[]
        </span>
      );
    }
    if (depth >= 2) {
      return (
        <span className="text-[10px] text-ink-muted">
          {label ? `${label}: ` : ""}[{value.length} items]
        </span>
      );
    }
    return (
      <details open={depth < 1} className="group">
        <summary className="cursor-pointer text-[10px] text-ink-muted hover:text-ink">
          {label ?? "array"} [{value.length}]
        </summary>
        <div className="ml-3 border-l border-line pl-2">
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
            <span className="text-[10px] text-ink-faint">…{value.length - 20} more</span>
          ) : null}
        </div>
      </details>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return (
      <span className="text-[10px] text-ink-faint">
        {label ? `${label}: ` : ""}
        {"{}"}
      </span>
    );
  }

  return (
    <details open={depth < 1} className="group">
      <summary className="cursor-pointer text-[10px] text-ink-muted hover:text-ink">
        {label ?? "object"} {"{"}
        {entries.length}
        {"}"}
      </summary>
      <div className="ml-3 border-l border-line pl-2">
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
