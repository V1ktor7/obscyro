"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import {
  addScenarioOverride,
  deleteScenarioOverride,
  listScenarioOverrides,
  type OverrideIssue,
  type ScenarioOverride,
} from "../scenarios-api";

// ---------------------------------------------------------------------------
// The minimal editor for a scenario's edits, sitting next to the twin it
// changes. Not the composer — that lands with its own timeline. This exists so
// the overlay can be exercised without curl, and so the numbers it produces can
// be checked against the twin standing right beside it.
//
// The actions offered are the ones that visibly move something: occupancy is
// occupied beds over total beds in a unit, so closing a unit, adding beds and
// flipping a bed's status are the edits worth having here.
// ---------------------------------------------------------------------------

type Action = "close_unit" | "add_beds" | "set_property";

const MAX_BEDS = 24;

export default function ScenarioPanel({
  scenarioId,
  units,
  onClose,
}: {
  scenarioId: string;
  units: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [overrides, setOverrides] = useState<ScenarioOverride[]>([]);
  const [issues, setIssues] = useState<OverrideIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [unitId, setUnitId] = useState("");
  const [action, setAction] = useState<Action>("close_unit");
  const [count, setCount] = useState(12);
  const [prop, setProp] = useState("status");
  const [value, setValue] = useState("closed");
  const [day, setDay] = useState(0);
  const [lasts, setLasts] = useState<number | "">("");

  const load = useCallback(async () => {
    try {
      const r = await listScenarioOverrides(scenarioId);
      setOverrides(r.overrides);
      setIssues(r.issues);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!unitId && units[0]) setUnitId(units[0].id);
  }, [units, unitId]);

  async function add() {
    if (!unitId) return;
    setBusy(true);
    setError(null);
    const offset = day * 24;
    const duration = lasts === "" ? null : Number(lasts) * 24;
    try {
      if (action === "close_unit") {
        await addScenarioOverride(scenarioId, {
          targetType: "instance",
          targetId: unitId,
          op: "delete",
          effectiveOffsetHours: offset,
          durationHours: duration,
          note: "unit closed",
        });
      } else if (action === "set_property") {
        await addScenarioOverride(scenarioId, {
          targetType: "instance",
          targetId: unitId,
          op: "set_property",
          payload: { property: prop, value: Number.isNaN(Number(value)) ? value : Number(value) },
          effectiveOffsetHours: offset,
          durationHours: duration,
        });
      } else {
        // Each bed is two edits: bring it into existence, then put it in the
        // unit. The local key is what ties the second to the first.
        const n = Math.min(Math.max(1, count), MAX_BEDS);
        const stamp = Date.now().toString(36);
        for (let i = 0; i < n; i++) {
          const key = `bed_${stamp}_${i}`;
          await addScenarioOverride(scenarioId, {
            targetType: "instance",
            targetLocalKey: key,
            op: "create",
            payload: { objectType: "Bed", properties: { label: `Extra ${i + 1}`, status: "free" } },
            effectiveOffsetHours: offset,
            durationHours: duration,
          });
          await addScenarioOverride(scenarioId, {
            targetType: "link",
            targetLocalKey: key,
            op: "link",
            payload: { linkType: "located_in", toId: unitId },
            effectiveOffsetHours: offset,
            durationHours: duration,
          });
        }
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteScenarioOverride(scenarioId, id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const unitName = (id: string | null) =>
    units.find((u) => u.id === id)?.name ?? (id ? `${id.slice(0, 8)}…` : "—");

  const F = "rounded border border-[#d3d8de] bg-white px-2 py-1 text-xs focus:outline-none";

  return (
    <div className="shrink-0 border-b border-[#d3d8de] bg-[#faf9fc] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-[#5b4a86]">
          Scenario edits
        </span>
        <span className="text-[10px] text-[#8f99a8]">
          {overrides.length === 0
            ? "none yet — this scenario currently resolves to reality"
            : `${overrides.length} edit${overrides.length === 1 ? "" : "s"}`}
        </span>
        {error ? (
          <span className="max-w-[40ch] truncate text-[11px] text-[#a82255]" title={error}>
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[11px] text-[#5f6b7c] hover:text-[#1c2127]"
        >
          Hide
        </button>
      </div>

      {/* existing edits */}
      {overrides.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {overrides.map((o) => (
            <span
              key={o.id}
              className="flex items-center gap-1.5 rounded border border-[#d9d2e6] bg-white px-2 py-0.5 text-[10.5px] text-[#404854]"
            >
              <b className="font-medium">{o.op.replace("_", " ")}</b>
              {o.targetId ? unitName(o.targetId) : (o.targetLocalKey ?? "")}
              {o.op === "set_property" ? (
                <span className="text-[#8f99a8]">
                  {String(o.payload.property ?? "")}={String(o.payload.value ?? "")}
                </span>
              ) : null}
              <span className="text-[#8f99a8]">
                d{Math.round(o.effectiveOffsetHours / 24)}
                {o.durationHours ? `+${Math.round(o.durationHours / 24)}d` : ""}
              </span>
              <button
                type="button"
                onClick={() => void remove(o.id)}
                aria-label="Remove edit"
                className="text-[#8f99a8] hover:text-[#a82255]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <p className="mt-1.5 rounded bg-[#fdf6ec] px-2 py-1 text-[10.5px] leading-snug text-[#8a5a12]">
          {issues.map((i) => i.message).join(" ")}
        </p>
      ) : null}

      {/* add */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select value={action} onChange={(e) => setAction(e.target.value as Action)} className={F}>
          <option value="close_unit">Close</option>
          <option value="add_beds">Add beds to</option>
          <option value="set_property">Set a property on</option>
        </select>
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={cn(F, "max-w-[190px]")}>
          {units.length === 0 ? <option value="">no units in the twin</option> : null}
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        {action === "add_beds" ? (
          <input
            type="number"
            min={1}
            max={MAX_BEDS}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className={cn(F, "w-16")}
          />
        ) : null}
        {action === "set_property" ? (
          <>
            <input
              value={prop}
              onChange={(e) => setProp(e.target.value)}
              placeholder="property"
              className={cn(F, "w-28")}
            />
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="value"
              className={cn(F, "w-28")}
            />
          </>
        ) : null}

        <span className="text-[10px] text-[#8f99a8]">from day</span>
        <input
          type="number"
          min={0}
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          className={cn(F, "w-14")}
        />
        <span className="text-[10px] text-[#8f99a8]">for</span>
        <input
          type="number"
          min={1}
          value={lasts}
          onChange={(e) => setLasts(e.target.value === "" ? "" : Number(e.target.value))}
          placeholder="∞"
          className={cn(F, "w-14")}
        />
        <span className="text-[10px] text-[#8f99a8]">days</span>

        <button
          type="button"
          disabled={busy || !unitId}
          onClick={() => void add()}
          className="flex items-center gap-1.5 rounded border border-[#7961a8] bg-[#f0edf7] px-2.5 py-1 text-xs font-medium text-[#5b4a86] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Add edit
        </button>
        <span className="text-[10px] text-[#8f99a8]">
          the twin picks this up on its next tick
        </span>
      </div>
    </div>
  );
}
