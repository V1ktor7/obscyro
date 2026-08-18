"use client";

/**
 * Building an event, as a workbench rather than a form.
 *
 * What was here before was a column of cards: a box for the name, a box per
 * effect, a box of warnings, stacked down a scrolling page. That shape asks you
 * to hold the whole event in your head, because no two parts of it are ever on
 * screen together — and it is why the last version read as "a bunch of boxes
 * with text".
 *
 * Four regions on one screen instead, each scrolling on its own:
 *
 *   left     the ontology. What exists, and what an effect could change on it.
 *            This is the vocabulary, and it is entirely the institution's.
 *   centre   the timeline. The event *is* its effects over time, so the thing
 *            that shows them together is the subject of the screen, not a
 *            preview of it.
 *   right    the inspector for whatever is selected. One effect at a time,
 *            because an effect is only editable in the context of what it hits.
 *   bottom   what is wrong. Always visible, because a warning you scroll to is
 *            a warning nobody reads.
 *
 * Nothing here offers a menu of things to perturb. You pick a property off your
 * own ontology, and the fields that appear are the ones that property declares.
 */

import { useMemo, useState } from "react";

import type {
  ProfileShape,
  SimEffect,
  SimEvent,
  SimExport,
  SimTarget,
} from "@/lib/platform-api";
import EventTimeline from "./EventTimeline";
import { eventProblems, inertReasons, describeEffect } from "./event-effects";
import {
  describeDeclaration,
  declaredProperties,
  opsFor,
  propertyProblem,
  resolveProperty,
  valueKind,
  valueLabel,
} from "./object-property";
import {
  describeRailProperty,
  ontologyRail,
  perturbableCount,
  vocabularyOf,
  type RailProperty,
} from "./rail";

const OBJECT_TARGET = "object.property";

const SHAPES: Array<{ id: ProfileShape; label: string }> = [
  { id: "step", label: "Steady while it lasts" },
  { id: "ramp", label: "Builds up gradually" },
  { id: "pulse", label: "One hit, then over" },
  { id: "gaussian", label: "Peaks then fades" },
];

const OP_LABEL: Record<SimEffect["op"], string> = {
  multiply: "Multiply by",
  add: "Add",
  set: "Set to",
};

const INPUT =
  "w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none";

export interface EventWorkspaceProps {
  snapshot: SimExport;
  targets: SimTarget[];
  initial: SimEvent | null;
  twinScenarioId: string | null;
  onSave: (body: {
    name: string;
    description: string;
    horizon: number;
    effects: SimEffect[];
    twinScenarioId: string | null;
  }) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onClose: () => void;
}

export default function EventWorkspace({
  snapshot,
  targets,
  initial,
  twinScenarioId,
  onSave,
  onDelete,
  onClose,
}: EventWorkspaceProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [horizon, setHorizon] = useState(initial?.horizon ?? 60);
  const [effects, setEffects] = useState<SimEffect[]>(initial?.effects ?? []);
  const [focused, setFocused] = useState<number | null>(initial?.effects?.length ? 0 : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rail = useMemo(() => ontologyRail(snapshot), [snapshot]);
  const perturbable = useMemo(() => perturbableCount(rail), [rail]);
  const vocab = useMemo(() => vocabularyOf(snapshot), [snapshot]);

  const declarationProblems = useMemo(
    () =>
      effects.flatMap((e, i) => {
        if (e.target !== OBJECT_TARGET) return [];
        const resolved = resolveProperty(snapshot, e.select.object_type ?? [], e.property_key);
        const problem = propertyProblem(resolved, e.op);
        return problem ? [{ index: i, text: problem }] : [];
      }),
    [effects, snapshot],
  );

  const problems = [
    ...eventProblems(effects, targets, horizon).map((text) => ({ index: null, text })),
    ...declarationProblems,
  ];
  const canSave = name.trim().length > 0 && problems.length === 0 && !busy;

  function patch(index: number, next: Partial<SimEffect>) {
    setEffects((prev) => prev.map((e, i) => (i === index ? { ...e, ...next } : e)));
  }

  /**
   * Adding an effect starts from a property, not from a kind.
   *
   * The operation is chosen for you here, and it is the only one the
   * declaration permits: a state gets `set`, a declared quantity gets
   * `multiply`. That is not a preset value — it is the only legal option, and
   * offering a dropdown whose other entries are all refused would be worse.
   */
  function addEffect(typeName: string, property: RailProperty) {
    const ops = opsFor(property.behaviour);
    const op = ops.includes("multiply") ? "multiply" : "set";
    const next: SimEffect = {
      id: `${property.key}-${effects.length + 1}`,
      target: OBJECT_TARGET,
      select: { object_type: [typeName] },
      op,
      value: op === "multiply" ? 0.5 : "",
      property_key: property.key,
      reach: null,
      profile: { start: 0, end: Math.max(1, Math.round(horizon / 3)), shape: "step", peak: 1 },
    };
    setEffects((prev) => [...prev, next]);
    setFocused(effects.length);
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
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* --- the event's own identity, one line ------------------------------ */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-white px-4 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this event"
          aria-label="Event name"
          className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-sm text-ink hover:border-line focus:border-brand focus:outline-none"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          aria-label="Event description"
          className="hidden min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-xs text-ink-muted hover:border-line focus:border-brand focus:outline-none lg:block"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          Steps
          <input
            inputMode="numeric"
            value={horizon}
            onChange={(e) => setHorizon(Math.max(1, Number(e.target.value) || 1))}
            aria-label="Steps to run"
            className="w-16 rounded-md border border-line px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="rounded-md bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-deep disabled:bg-ink-ghost"
        >
          {busy ? "Saving…" : initial ? "Save" : "Create"}
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
            className="rounded-md border border-danger/40 px-2.5 py-1.5 text-xs text-danger hover:bg-danger/5"
          >
            Delete
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1.5 text-xs text-ink-faint hover:text-ink"
        >
          Close
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* --- left: the ontology ------------------------------------------- */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-white">
          <div className="shrink-0 border-b border-line px-3 py-2">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Your ontology
            </h2>
            <p className="mt-0.5 text-[10px] leading-snug text-ink-faint">
              {perturbable > 0
                ? `${perturbable} propert${perturbable === 1 ? "y" : "ies"} can be calculated with. Click one to affect it.`
                : "Nothing here declares a behaviour yet, so effects can only replace values, not calculate with them."}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {rail.length === 0 ? (
              <p className="px-2 py-3 text-[11px] leading-snug text-ink-faint">
                This twin declares no object types. There is nothing an event could
                change until the ontology has some.
              </p>
            ) : (
              rail.map((t) => <RailType key={t.name} type={t} onPick={addEffect} />)
            )}
          </div>
        </aside>

        {/* --- centre: the timeline ------------------------------------------ */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
          {effects.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="max-w-sm text-center text-xs leading-relaxed text-ink-faint">
                An event is a set of changes to things in your ontology, over time.
                <br />
                Pick a property on the left to make the first one.
              </p>
            </div>
          ) : (
            <>
              <EventTimeline
                effects={effects}
                targets={targets}
                horizon={horizon}
                focused={focused}
                onFocus={setFocused}
                onChangeProfile={(i, profile) => patch(i, { profile })}
              />
              <ul className="mt-3 flex flex-col gap-1">
                {effects.map((e, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setFocused(i)}
                      className={`w-full rounded-md border px-3 py-1.5 text-left text-[11px] leading-snug ${
                        focused === i
                          ? "border-brand bg-white text-ink"
                          : "border-line bg-white text-ink-muted hover:border-brand/50"
                      }`}
                    >
                      {describeEffect(e, targets.find((t) => t.path === e.target), vocab)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>

        {/* --- right: the inspector ------------------------------------------ */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-white">
          {focused === null || !effects[focused] ? (
            <p className="p-4 text-[11px] leading-snug text-ink-faint">
              Select an effect to edit it.
            </p>
          ) : (
            <Inspector
              effect={effects[focused]!}
              snapshot={snapshot}
              horizon={horizon}
              target={targets.find((t) => t.path === effects[focused]!.target)}
              onChange={(next) => patch(focused, next)}
              onRemove={() => {
                setEffects((prev) => prev.filter((_, j) => j !== focused));
                setFocused(null);
              }}
            />
          )}
        </aside>
      </div>

      {/* --- bottom: what is wrong ------------------------------------------ */}
      <footer className="shrink-0 border-t border-line bg-white px-4 py-2">
        {error ? (
          <p className="text-[11px] text-danger">{error}</p>
        ) : problems.length === 0 ? (
          // An empty event is never problem-free — `eventProblems` reports that
          // it is indistinguishable from a normal day — so there is no "nothing
          // yet" state to write here, and the branch that had one was dead.
          <p className="text-[11px] text-ink-faint">
            {effects.length} effect{effects.length === 1 ? "" : "s"} · nothing inert, nothing
            contradictory.
          </p>
        ) : (
          <ul className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
            {problems.map((p, i) => (
              <li key={i} className="text-[11px] leading-snug text-warn">
                {p.index !== null ? (
                  <button
                    type="button"
                    onClick={() => setFocused(p.index)}
                    className="text-left underline decoration-dotted underline-offset-2 hover:text-ink"
                  >
                    {p.text}
                  </button>
                ) : (
                  p.text
                )}
              </li>
            ))}
          </ul>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RailType({
  type,
  onPick,
}: {
  type: ReturnType<typeof ontologyRail>[number];
  onPick: (typeName: string, property: RailProperty) => void;
}) {
  const [open, setOpen] = useState(type.blocked === null);
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // Without this the button's whole name is the disclosure triangle and a
        // number: a screen reader hears "▸ 48" and the type is never spoken.
        aria-label={`${type.name}, ${type.instances} instance${type.instances === 1 ? "" : "s"}`}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-canvas"
      >
        <span className="text-[10px] text-ink-faint">{open ? "▾" : "▸"}</span>
        <span className={`flex-1 truncate text-[11px] ${type.blocked ? "text-ink-faint" : "text-ink"}`}>
          {type.name}
        </span>
        <span className="text-[10px] text-ink-faint">{type.instances}</span>
      </button>
      {open ? (
        type.blocked ? (
          <p className="px-2 pb-1.5 pl-6 text-[10px] leading-snug text-ink-faint">{type.blocked}</p>
        ) : (
          <ul className="pb-1">
            {type.properties.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => onPick(type.name, p)}
                  // Names the consequence, not the widget: this button does not
                  // select a property, it creates an effect on one.
                  aria-label={`Affect ${p.key} on ${type.name}${
                    p.limitation ? ` — ${p.limitation}` : ""
                  }`}
                  className="w-full rounded px-2 py-0.5 pl-6 text-left hover:bg-canvas"
                >
                  <span className="block truncate text-[11px] text-ink">{p.key}</span>
                  <span className="block truncate text-[10px] text-ink-faint">
                    {describeRailProperty(p)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function Inspector({
  effect,
  snapshot,
  horizon,
  target,
  onChange,
  onRemove,
}: {
  effect: SimEffect;
  snapshot: SimExport;
  horizon: number;
  target: SimTarget | undefined;
  onChange: (next: Partial<SimEffect>) => void;
  onRemove: () => void;
}) {
  const chosenTypes = effect.select.object_type ?? [];
  const isObject = effect.target === OBJECT_TARGET;
  const declared = useMemo(
    () => (isObject ? declaredProperties(snapshot, chosenTypes) : []),
    [isObject, snapshot, chosenTypes],
  );
  const resolved = useMemo(
    () => resolveProperty(snapshot, chosenTypes, effect.property_key),
    [snapshot, chosenTypes, effect.property_key],
  );
  const ops = isObject ? opsFor(resolved.behaviour) : (target?.ops ?? []);
  const textValued = isObject && valueKind(resolved, effect.op) === "text";
  const inert = inertReasons(effect, target, horizon);
  const p = effect.profile;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <input
          value={effect.id}
          onChange={(e) => onChange({ id: e.target.value })}
          aria-label="Effect name"
          className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-xs text-ink hover:border-line focus:border-brand focus:outline-none"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-ink-faint hover:text-danger"
        >
          Remove
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* An effect saved against a quantity the engine has since retired.
            Rendering the ordinary form here would offer an empty operation list
            and a value field that writes into nothing, which reads as a form
            that is merely broken rather than as an event that cannot run. */}
        {!target ? (
          <div className="rounded-md border border-warn/40 bg-warn/5 p-3">
            <p className="text-[11px] leading-relaxed text-ink">
              This effect changes “{effect.target}”, which the engine no longer offers.
              It was written against an older catalogue.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              {effect.target.startsWith("care.")
                ? "Care parameters are declared in your ontology now, as a type whose properties bind occupies_for, dies_without and consumes_amount. Affect one of its properties from the left instead."
                : "Pick a property on the left to say what this event should change instead."}
            </p>
            <button
              type="button"
              onClick={onRemove}
              className="mt-3 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink hover:border-danger hover:text-danger"
            >
              Remove this effect
            </button>
          </div>
        ) : null}

        {!target ? null : isObject ? (
          <>
            <Label>Property</Label>
            <select
              value={effect.property_key ?? ""}
              onChange={(e) => onChange({ property_key: e.target.value || null })}
              aria-label="Property to change"
              className={INPUT}
            >
              <option value="">Pick a property…</option>
              {declared.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.key}
                  {d.def?.unit?.trim() ? ` (${d.def.unit.trim()})` : ""}
                </option>
              ))}
              {effect.property_key && resolved.undeclared ? (
                <option value={effect.property_key}>
                  {effect.property_key} — no longer declared
                </option>
              ) : null}
            </select>
            <p className="mb-3 mt-1 text-[10px] leading-snug text-ink-faint">
              {describeDeclaration(resolved)}
            </p>
          </>
        ) : null}

        {!target ? null : (
        <>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <Label>Change</Label>
            <select
              value={effect.op}
              onChange={(e) => {
                const op = e.target.value as SimEffect["op"];
                const value =
                  isObject && op !== "set" && typeof effect.value === "string" ? 1 : effect.value;
                onChange({ op, value });
              }}
              aria-label="Operation"
              className={INPUT}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{isObject ? valueLabel(resolved, effect.op) : target?.unit || "Value"}</Label>
            {textValued ? (
              <input
                value={String(effect.value ?? "")}
                onChange={(e) => onChange({ value: e.target.value })}
                placeholder="new value"
                aria-label="New value"
                className={INPUT}
              />
            ) : (
              <input
                inputMode="decimal"
                value={effect.value}
                onChange={(e) => onChange({ value: Number(e.target.value) || 0 })}
                aria-label="Value"
                className={INPUT}
              />
            )}
          </div>
        </div>

        {isObject ? (
          <div className="mb-3">
            <Label>How many</Label>
            <input
              inputMode="decimal"
              value={effect.reach ?? ""}
              placeholder="all of them"
              aria-label="How many objects"
              onChange={(e) =>
                onChange({ reach: e.target.value === "" ? null : Number(e.target.value) })
              }
              className={INPUT}
            />
            <p className="mt-1 text-[10px] leading-snug text-ink-faint">
              Blank is every matching object. Below 1 is a share of them; anything else
              is a count.
            </p>
          </div>
        ) : null}

        <Label>Over time</Label>
        <select
          value={p.shape}
          onChange={(e) => onChange({ profile: { ...p, shape: e.target.value as ProfileShape } })}
          aria-label="Shape"
          className={INPUT}
        >
          {SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div>
            <Label>From</Label>
            <input
              inputMode="numeric"
              value={p.start}
              aria-label="From step"
              onChange={(e) => onChange({ profile: { ...p, start: Number(e.target.value) || 0 } })}
              className={INPUT}
            />
          </div>
          <div>
            <Label>To</Label>
            <input
              inputMode="numeric"
              value={p.end ?? ""}
              placeholder="open"
              aria-label="To step"
              onChange={(e) =>
                onChange({
                  profile: { ...p, end: e.target.value === "" ? null : Number(e.target.value) },
                })
              }
              className={INPUT}
            />
          </div>
          <div>
            <Label>Intensity</Label>
            <input
              inputMode="decimal"
              value={p.peak}
              aria-label="Intensity"
              onChange={(e) => onChange({ profile: { ...p, peak: Number(e.target.value) || 0 } })}
              className={INPUT}
            />
          </div>
        </div>
        </>
        )}

        {/* Guarded on `target`: with none, the only inert reason is that the
            quantity is gone, and the notice above already says it at length.
            Saying it twice in one panel makes the panel look confused. */}
        {target && inert.length > 0 ? (
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-snug text-warn">
            This effect {inert.join("; ")}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-faint">
      {children}
    </span>
  );
}
