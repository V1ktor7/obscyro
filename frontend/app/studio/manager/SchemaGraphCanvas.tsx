"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { EnvLinkType, EnvObjectType } from "@/lib/platform-api";
import { EDGE_HEX, NODE_W, pathD, pointGeom } from "../studio-graph";
import { SCHEMA_BOX_H } from "../manager-layout-persist";

type SchemaGraphCanvasProps = {
  types: EnvObjectType[];
  linkTypes: EnvLinkType[];
  positions: Map<string, { x: number; y: number }>;
  selectedType: string | null;
  placementMode: boolean;
  onSelectType: (name: string) => void;
  onPositionChange: (typeName: string, pos: { x: number; y: number }) => void;
  onConnect: (fromType: string, toType: string) => void;
  onCanvasDoubleClick: (pos: { x: number; y: number }) => void;
  onCanvasClickPlace: (pos: { x: number; y: number }) => void;
};

export default function SchemaGraphCanvas({
  types,
  linkTypes,
  positions,
  selectedType,
  placementMode,
  onSelectType,
  onPositionChange,
  onConnect,
  onCanvasDoubleClick,
  onCanvasClickPlace,
}: SchemaGraphCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    typeName: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const movedRef = useRef(false);
  const connectingRef = useRef<{ fromType: string } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{
    fromType: string;
    cursor: { x: number; y: number };
  } | null>(null);
  const [connectHover, setConnectHover] = useState<string | null>(null);

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: clientX - rect.left + el.scrollLeft,
      y: clientY - rect.top + el.scrollTop,
    };
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (drag) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;
        onPositionChange(drag.typeName, {
          x: drag.origX + dx,
          y: drag.origY + dy,
        });
        return;
      }
      const conn = connectingRef.current;
      if (conn) {
        const pt = getCanvasPoint(e.clientX, e.clientY);
        if (pt) setPendingEdge({ fromType: conn.fromType, cursor: pt });
      }
    }

    function onUp(e: PointerEvent) {
      const conn = connectingRef.current;
      if (conn) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const inputEl = target?.closest("[data-schema-input]");
        const toType = inputEl?.getAttribute("data-type-name");
        if (toType && toType !== conn.fromType) {
          onConnect(conn.fromType, toType);
        }
      }
      dragRef.current = null;
      connectingRef.current = null;
      setPendingEdge(null);
      setConnectHover(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [getCanvasPoint, onConnect, onPositionChange]);

  function startDrag(e: React.PointerEvent, typeName: string) {
    e.stopPropagation();
    e.preventDefault();
    const pos = positions.get(typeName);
    if (!pos) return;
    movedRef.current = false;
    dragRef.current = {
      typeName,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  }

  function startConnect(e: React.PointerEvent, fromType: string) {
    e.stopPropagation();
    e.preventDefault();
    const pos = positions.get(fromType);
    if (!pos) return;
    connectingRef.current = { fromType };
    setPendingEdge({
      fromType,
      cursor: { x: pos.x + NODE_W, y: pos.y + SCHEMA_BOX_H / 2 },
    });
  }

  function handleCanvasClick(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return;
    const pt = getCanvasPoint(e.clientX, e.clientY);
    if (!pt) return;
    if (placementMode) {
      onCanvasClickPlace(pt);
    }
  }

  function handleCanvasDoubleClick(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return;
    const pt = getCanvasPoint(e.clientX, e.clientY);
    if (pt) onCanvasDoubleClick(pt);
  }

  return (
    <div
      ref={canvasRef}
      className={cn(
        "relative min-h-0 flex-1 overflow-auto",
        placementMode && "cursor-crosshair",
      )}
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
      onClick={handleCanvasClick}
      onDoubleClick={handleCanvasDoubleClick}
    >
      {types.length === 0 ? (
        <div
          className="flex min-h-[200px] items-start p-6"
          onDoubleClick={(e) => {
            const pt = getCanvasPoint(e.clientX, e.clientY);
            if (pt) onCanvasDoubleClick(pt);
          }}
        >
          <p className="text-sm text-gray-400">
            No schema yet. Double-click to add a type, or use + New in the sidebar.
          </p>
        </div>
      ) : (
        <div
          className="relative"
          style={{ width: 5000, height: 3000 }}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
        >
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
            {pendingEdge ? (() => {
              const from = positions.get(pendingEdge.fromType);
              if (!from) return null;
              const a = {
                x: from.x + NODE_W,
                y: from.y + SCHEMA_BOX_H / 2,
              };
              const g = pointGeom(a, pendingEdge.cursor);
              return (
                <path
                  d={pathD(g)}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              );
            })() : null}
          </svg>

          {types.map((t) => {
            const pos = positions.get(t.name);
            if (!pos) return null;
            const isSelected = selectedType === t.name;
            return (
              <div
                key={t.id}
                className={cn(
                  "absolute overflow-visible rounded-lg border bg-white text-left shadow-sm transition-colors",
                  isSelected ? "border-indigo-400" : "border-gray-300",
                  connectHover === t.name && "ring-2 ring-indigo-300",
                )}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: NODE_W,
                  minHeight: SCHEMA_BOX_H,
                }}
              >
                <span
                  data-schema-input
                  data-type-name={t.name}
                  onPointerEnter={() => {
                    if (connectingRef.current) setConnectHover(t.name);
                  }}
                  onPointerLeave={() => setConnectHover(null)}
                  className="absolute -left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-indigo-400 bg-white"
                  title="Drop connection here"
                />
                <span
                  onPointerDown={(e) => startConnect(e, t.name)}
                  className="absolute -right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-indigo-400 bg-white"
                  title="Drag to connect"
                />
                <div
                  onPointerDown={(e) => startDrag(e, t.name)}
                  className="cursor-grab border-b border-gray-100 px-3 py-2 text-xs font-medium text-gray-800 active:cursor-grabbing"
                >
                  {t.name}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (movedRef.current) return;
                    onSelectType(t.name);
                  }}
                  className="w-full px-3 py-1.5 text-left text-[10px] text-gray-500 hover:bg-gray-50"
                >
                  {t.propertySchema.length} propert
                  {t.propertySchema.length === 1 ? "y" : "ies"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
