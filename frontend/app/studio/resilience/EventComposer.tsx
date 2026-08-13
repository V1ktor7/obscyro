"use client";

/**
 * Writing an event, effect by effect.
 *
 * The failure this form exists to prevent is not an invalid payload — the
 * engine catches those. It is a *valid* event that applies to nothing: a
 * window that closes before it opens, a multiplier of 1, a facility that was
 * renamed away. Those run cleanly, change nothing, and read as a network that
 * shrugged off a disaster.
 *
 * So every effect carries a sentence derived from the same object the engine
 * receives, and anything inert is named before it can be saved.
 */

import { useMemo, useState } from "react";

import type {
  CapacityEffect,
  ConnectivityEffect,
  CrisisEffect,
  CrisisEventDef,
  CrisisExport,
  DemandEffect,
  EffectKind,
  ProfileShape,
} from "@/lib/platform-api";
import {
  blankEffect,
  describeEffect,
  eventProblems,
  inertReasons,
  type NamedThing,
} from "./event-effects";

const KINDS: Array<{ id: EffectKind; label: string; hint: string }> = [
  { id: "demand", label: "Demand", hint: "People needing care appear — or stop appearing." },
  { id: "capacity", label: "Capacity", hint: "A resource shrinks, grows, or is set outright." },
  { id: "connectivity", label: "Routes", hint: "A connection is cut, throttled, or widened." },
];

const SHAPES: Array<{ id: ProfileShape; label: string }> = [
  { id: "step", label: "Steady while it lasts" },
  { id: "ramp", label: "Builds up gradually" },
  { id: "pulse", label: "One hit, then over" },
  { id: "gaussian", label: "Peaks then fades" },
];

export interface EventComposerProps {
  snapshot: CrisisExport;
  initial: CrisisEventDef | null;
  twinScenarioId: string | null;
  onSave: (body: {
    name: string;
    description: string;
    horizon: number;
    effects: CrisisEffect[];
    twinScenarioId: string | null;
  }) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onClose: () => void;
}

export default function EventComposer({
  snapshot,
  initial,
  twinScenarioId,
  onSave,
  onDelete,
  onClose,
}: EventComposerProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [horizon, setHorizon] = useState(initial?.horizon ?? 60);
  const [effects, setEffects] = useState<CrisisEffect[]>(initial?.effects ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facilities: NamedThing[] = useMemo(
    () => snapshot.facilities.map((f) => ({ id: f.id, name: f.name })),
    [snapshot],
  );
  const populations: NamedThing[] = useMemo(
    () => snapshot.populations.map((p) => ({ id: p.id, name: p.name })),
    [snapshot],
  );
  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const f of snapshot.facilities) {
      for (const r of Object.values(f.resources)) s.add(r.category);
    }
    return Array.from(s).sort();
  }, [snapshot]);

  const problems = eventProblems(effects, horizon);
  const canSave = name.trim().length > 0 && problems.length === 0 && !busy;

  function patch(index: number, next: Partial<CrisisEffect>) {
    setEffects((prev) =>
      prev.map((e, i) => (i === index ? ({ ...e, ...next } as CrisisEffect) : e)),
    );
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        horizon,
        effects,
        twinScenarioId,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium text-ink">
            {initial ? `Edit “${initial.name}”` : "Compose an event"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-ink-faint hover:text-ink"
          >
            Close
          </button>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
          An event is a list of effects. Nothing here decides whether a change is
          bad: growing a resource opens a wing, and negative demand is a
          vaccination programme. It runs against{" "}
          <strong className="font-medium text-ink">
            {twinScenarioId ? "the selected scenario" : "the live twin"}
          </strong>
          , because effects name instances by id and those ids only exist there.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. East wing closed for renovation"
              className={INPUT}
            />
          </Field>
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className={INPUT}
            />
          </Field>
          <Field label="Steps to run">
            <input
              inputMode="numeric"
              value={horizon}
              onChange={(e) => setHorizon(Math.max(1, Number(e.target.value) || 1))}
              className={INPUT}
            />
          </Field>
        </div>
      </section>

      {effects.map((effect, i) => (
        <EffectCard
          key={i}
          effect={effect}
          index={i}
          horizon={horizon}
          facilities={facilities}
          populations={populations}
          categories={categories}
          edges={snapshot.edges}
          onChange={(next) => patch(i, next)}
          onRemove={() => setEffects((prev) => prev.filter((_, j) => j !== i))}
        />
      ))}

      <section className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="mb-2 text-[11px] text-ink-faint">Add an effect</p>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              title={k.hint}
              onClick={() =>
                setEffects((prev) => [...prev, blankEffect(k.id, horizon, prev.length + 1)])
              }
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:border-brand hover:text-brand"
            >
              {k.label}
            </button>
          ))}
        </div>
      </section>

      {problems.length > 0 ? (
        <section className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <h3 className="mb-2 text-xs font-medium text-ink">
            This event would run and change nothing
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {problems.map((p) => (
              <li key={p} className="text-[11px] leading-relaxed text-ink">
                {p}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="rounded-md bg-brand px-3 py-2 text-xs text-white hover:bg-brand-deep disabled:bg-ink-ghost"
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Create event"}
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="rounded-md border border-danger/40 px-3 py-2 text-xs text-danger hover:bg-danger/5"
          >
            Delete
          </button>
        ) : null}
        {name.trim().length === 0 ? (
          <span className="text-[11px] text-ink-faint">Give the event a name.</span>
        ) : null}
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:border-brand focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function EffectCard({
  effect,
  index,
  horizon,
  facilities,
  populations,
  categories,
  edges,
  onChange,
  onRemove,
}: {
  effect: CrisisEffect;
  index: number;
  horizon: number;
  facilities: NamedThing[];
  populations: NamedThing[];
  categories: string[];
  edges: CrisisExport["edges"];
  onChange: (next: Partial<CrisisEffect>) => void;
  onRemove: () => void;
}) {
  const sentence = describeEffect(effect, facilities, populations);
  const inert = inertReasons(effect, horizon);
  const p = effect.profile;

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
          {effect.kind}
        </span>
        <input
          value={effect.id}
          onChange={(e) => onChange({ id: e.target.value } as Partial<CrisisEffect>)}
          className="flex-1 rounded-md border border-transparent px-1 py-0.5 text-xs text-ink hover:border-line focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-ink-faint hover:text-danger"
        >
          Remove
        </button>
      </div>

      {effect.kind === "demand" ? (
        <DemandFields effect={effect as DemandEffect} populations={populations} onChange={onChange} />
      ) : effect.kind === "capacity" ? (
        <CapacityFields
          effect={effect as CapacityEffect}
          facilities={facilities}
          categories={categories}
          onChange={onChange}
        />
      ) : (
        <ConnectivityFields
          effect={effect as ConnectivityEffect}
          facilities={facilities}
          edges={edges}
          onChange={onChange}
        />
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Field label="Shape">
          <select
            value={p.shape}
            onChange={(e) =>
              onChange({ profile: { ...p, shape: e.target.value as ProfileShape } } as Partial<CrisisEffect>)
            }
            className={INPUT}
          >
            {SHAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From step">
          <input
            inputMode="numeric"
            value={p.start}
            onChange={(e) =>
              onChange({ profile: { ...p, start: Number(e.target.value) || 0 } } as Partial<CrisisEffect>)
            }
            className={INPUT}
          />
        </Field>
        <Field label="To step">
          <input
            inputMode="numeric"
            value={p.end ?? ""}
            placeholder="open-ended"
            onChange={(e) =>
              onChange({
                profile: { ...p, end: e.target.value === "" ? null : Number(e.target.value) },
              } as Partial<CrisisEffect>)
            }
            className={INPUT}
          />
        </Field>
        <Field label="Intensity">
          <input
            inputMode="decimal"
            value={p.peak}
            onChange={(e) =>
              onChange({ profile: { ...p, peak: Number(e.target.value) || 0 } } as Partial<CrisisEffect>)
            }
            className={INPUT}
          />
        </Field>
      </div>

      <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink">
        {sentence}
      </p>
      {inert.length > 0 ? (
        <p className="mt-1 text-[11px] leading-relaxed text-warn">
          Effect {index + 1} {inert.join("; ")}.
        </p>
      ) : null}
    </section>
  );
}

function Picker({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: NamedThing[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="max-h-32 overflow-y-auto rounded-md border border-line p-1.5">
        {options.length === 0 ? (
          <p className="px-1 py-0.5 text-[11px] text-ink-faint">Nothing to pick.</p>
        ) : (
          options.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5">
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => onToggle(o.id)}
              />
              <span className="truncate text-[11px] text-ink">{o.name}</span>
            </label>
          ))
        )}
      </div>
    </Field>
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function DemandFields({
  effect,
  populations,
  onChange,
}: {
  effect: DemandEffect;
  populations: NamedThing[];
  onChange: (next: Partial<CrisisEffect>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
      <Picker
        label="Populations affected"
        options={populations}
        selected={effect.targets}
        onToggle={(id) =>
          onChange({ targets: toggle(effect.targets, id) } as Partial<CrisisEffect>)
        }
      />
      <Field label="Patients per step">
        <input
          inputMode="decimal"
          value={effect.volume}
          onChange={(e) => onChange({ volume: Number(e.target.value) || 0 } as Partial<CrisisEffect>)}
          className={INPUT}
        />
        <span className="text-[10px] leading-snug text-ink-faint">
          Negative removes demand — a vaccination programme rather than an outbreak.
        </span>
      </Field>
    </div>
  );
}

function CapacityFields({
  effect,
  facilities,
  categories,
  onChange,
}: {
  effect: CapacityEffect;
  facilities: NamedThing[];
  categories: string[];
  onChange: (next: Partial<CrisisEffect>) => void;
}) {
  const absolute = effect.absolute ?? null;
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_150px_150px]">
      <Picker
        label="Facilities affected"
        options={facilities}
        selected={effect.facilities}
        onToggle={(id) =>
          onChange({ facilities: toggle(effect.facilities, id) } as Partial<CrisisEffect>)
        }
      />
      <Field label="What kind of capacity">
        <select
          value={effect.category ?? ""}
          onChange={(e) =>
            onChange({ category: e.target.value || null } as Partial<CrisisEffect>)
          }
          className={INPUT}
        >
          <option value="">Everything</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label={absolute === null ? "Multiply by" : "Set to"}>
        <input
          inputMode="decimal"
          value={absolute === null ? (effect.multiplier ?? 1) : absolute}
          onChange={(e) =>
            onChange(
              (absolute === null
                ? { multiplier: Number(e.target.value) || 0 }
                : { absolute: Number(e.target.value) || 0 }) as Partial<CrisisEffect>,
            )
          }
          className={INPUT}
        />
        <button
          type="button"
          onClick={() =>
            onChange(
              (absolute === null
                ? { absolute: 0, multiplier: null }
                : { absolute: null, multiplier: 1 }) as Partial<CrisisEffect>,
            )
          }
          className="text-left text-[10px] text-brand hover:underline"
        >
          {absolute === null
            ? "Set an exact value instead"
            : "Use a multiplier instead"}
        </button>
        <span className="text-[10px] leading-snug text-ink-faint">
          {absolute === null
            ? "Above 1 grows it — an opening wing, not a losing one."
            : "0 destroys it outright, whatever it held."}
        </span>
      </Field>
    </div>
  );
}

function ConnectivityFields({
  effect,
  facilities,
  edges,
  onChange,
}: {
  effect: ConnectivityEffect;
  facilities: NamedThing[];
  edges: CrisisExport["edges"];
  onChange: (next: Partial<CrisisEffect>) => void;
}) {
  const options: NamedThing[] = edges.map((e) => ({
    id: `${e.source}>${e.target}`,
    name: `${facilities.find((f) => f.id === e.source)?.name ?? e.source.slice(0, 8)} → ${
      facilities.find((f) => f.id === e.target)?.name ?? e.target.slice(0, 8)
    }`,
  }));
  const selected = effect.edges.map(([s, t]) => `${s}>${t}`);

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
      <Picker
        label="Routes affected"
        options={options}
        selected={selected}
        onToggle={(key) => {
          const next = toggle(selected, key).map((k) => k.split(">") as [string, string]);
          onChange({ edges: next } as Partial<CrisisEffect>);
        }}
      />
      <Field label="Throughput multiplier">
        <input
          inputMode="decimal"
          value={effect.multiplier}
          onChange={(e) =>
            onChange({ multiplier: Number(e.target.value) || 0 } as Partial<CrisisEffect>)
          }
          className={INPUT}
        />
        <span className="text-[10px] leading-snug text-ink-faint">
          0 severs the route; 0.5 halves it; above 1 widens it.
        </span>
      </Field>
    </div>
  );
}
