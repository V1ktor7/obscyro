"use client";

/**
 * Writing an event, effect by effect.
 *
 * The form has no idea what an effect *kind* is. It reads the engine's
 * catalogue of addressable quantities and renders whatever each one declares:
 * the operations it accepts, the dimensions it can be narrowed by, its unit and
 * its bounds. Adding something perturbable server-side makes it appear here
 * with no change to this file — which is the whole reason the catalogue exists.
 *
 * The failure this form guards against is not an invalid payload; the engine
 * catches those. It is a *valid* event that applies to nothing: a window that
 * closes before it opens, a multiplier of 1, a facility renamed away. Those run
 * cleanly, change nothing, and read as a network that shrugged off a disaster.
 * So every effect carries a sentence derived from the same object the engine
 * receives, and anything inert is named before it can be saved.
 */

import { useMemo, useState } from "react";

import type {
  SelectorDimension,
  SimEffect,
  SimEvent,
  SimExport,
  SimTarget,
  ProfileShape,
} from "@/lib/platform-api";
import EventTimeline from "./EventTimeline";
import {
  blankEffect,
  describeEffect,
  eventProblems,
  inertReasons,
  type NamedThing,
  type Vocabulary,
} from "./event-effects";
import {
  declaredProperties,
  describeDeclaration,
  opsFor,
  propertyProblem,
  resolveProperty,
  valueKind,
  valueLabel,
  type ResolvedProperty,
} from "./object-property";

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

const DIMENSION_LABEL: Record<SelectorDimension, string> = {
  facility: "Facilities",
  category: "Kinds of resource",
  activity: "Activities",
  acuity: "Severities",
  population: "Populations",
  route: "Routes",
  object_type: "Kinds of object",
};

/** The one target whose value may be text and which names a property. */
const OBJECT_TARGET = "object.property";

export interface EventComposerProps {
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

export default function EventComposer({
  snapshot,
  targets,
  initial,
  twinScenarioId,
  onSave,
  onDelete,
  onClose,
}: EventComposerProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [horizon, setHorizon] = useState(initial?.horizon ?? 60);
  const [effects, setEffects] = useState<SimEffect[]>(initial?.effects ?? []);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shared by the timeline and the cards, so focusing a bar highlights its card
  // and vice versa. Two selections would let them disagree, and the user would
  // be editing one effect while looking at another.
  const [focused, setFocused] = useState<number | null>(null);

  /**
   * Everything the twin offers, per dimension.
   *
   * Severities are the one dimension the twin does not hold: they come from the
   * care model the engine builds, which is fixed at three. Naming them here
   * rather than leaving the picker empty is what lets a length-of-stay effect
   * be written at all.
   */
  const vocab: Vocabulary = useMemo(() => {
    const categories = new Set<string>();
    const activities = new Set<string>();
    for (const f of snapshot.facilities) {
      for (const r of Object.values(f.resources)) {
        categories.add(r.category);
        for (const a of r.enables) activities.add(a);
      }
    }
    return {
      facility: snapshot.facilities.map((f) => ({ id: f.id, name: f.name })),
      population: snapshot.populations.map((p) => ({ id: p.id, name: p.name })),
      category: Array.from(categories).sort().map((c) => ({ id: c, name: c })),
      activity: Array.from(activities).sort().map((a) => ({ id: a, name: a })),
      acuity: [
        { id: "critical", name: "Critical" },
        { id: "urgent", name: "Urgent" },
        { id: "routine", name: "Routine" },
      ],
      route: snapshot.edges.map((e) => ({
        id: `${e.source}>${e.target}`,
        name: `${nameIn(snapshot, e.source)} → ${nameIn(snapshot, e.target)}`,
      })),
      object_type: Array.from(new Set<string>((snapshot.objects ?? []).map((o) => o.type)))
        .sort()
        .map((t) => ({
          id: t,
          name: `${t} (${(snapshot.objects ?? []).filter((o) => o.type === t).length})`,
        })),
    };
  }, [snapshot]);

  /**
   * The values instances already hold, per type and key.
   *
   * Still suggestions rather than a closed list — an event's whole purpose may
   * be to introduce a value the ontology has never seen, and "contaminated"
   * exists nowhere until the first flood puts it there. The *keys*, by contrast,
   * are now closed and come from the declared schema: a key nothing declares is
   * inert in the most convincing way available, because it selects real objects,
   * runs without error and changes nothing.
   */
  const valuesByType = useMemo(() => {
    const out = new Map<string, Map<string, Set<string>>>();
    for (const o of snapshot.objects ?? []) {
      const keys = out.get(o.type) ?? new Map<string, Set<string>>();
      for (const [k, v] of Object.entries(o.properties ?? {})) {
        const seen = keys.get(k) ?? new Set<string>();
        if (typeof v === "string" || typeof v === "number") seen.add(String(v));
        keys.set(k, seen);
      }
      out.set(o.type, keys);
    }
    return out;
  }, [snapshot]);

  const byPath = useMemo(() => new Map(targets.map((t) => [t.path, t])), [targets]);

  /**
   * Effects the engine would refuse, gathered before the save rather than after.
   *
   * A declaration problem is not cosmetic: multiplying a property nobody has
   * declared a behaviour for is refused at `/events/compare`, so letting it into
   * the library produces an event that looks saved and cannot run. Shown on the
   * card *and* counted here, because a warning next to a field is easy to scroll
   * past.
   */
  const declarationProblems = useMemo(
    () =>
      effects.flatMap((e, i) => {
        if (e.target !== OBJECT_TARGET) return [];
        const resolved = resolveProperty(snapshot, e.select.object_type ?? [], e.property_key);
        const problem = propertyProblem(resolved, e.op);
        return problem ? [`Effect ${i + 1} (${e.id}): ${problem}`] : [];
      }),
    [effects, snapshot],
  );

  const problems = [...eventProblems(effects, targets, horizon), ...declarationProblems];
  const canSave = name.trim().length > 0 && problems.length === 0 && !busy;

  function patch(index: number, next: Partial<SimEffect>) {
    setEffects((prev) => prev.map((e, i) => (i === index ? { ...e, ...next } : e)));
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
          An event is a list of changes to quantities in the model. Nothing here
          decides whether a change is bad: growing a resource opens a wing, and
          negative arrivals are a vaccination programme. It is written against{" "}
          <strong className="font-medium text-ink">
            {twinScenarioId ? "the selected scenario" : "the live twin"}
          </strong>
          , because effects name things by id and those ids only exist there.
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

      <EventTimeline
        effects={effects}
        targets={targets}
        horizon={horizon}
        focused={focused}
        onFocus={setFocused}
        onChangeProfile={(i, profile) => patch(i, { profile })}
      />

      {effects.map((effect, i) => (
        <EffectCard
          key={i}
          effect={effect}
          index={i}
          target={byPath.get(effect.target)}
          horizon={horizon}
          vocab={vocab}
          snapshot={snapshot}
          valuesByType={valuesByType}
          focused={focused === i}
          onFocus={() => setFocused(i)}
          onChange={(next) => patch(i, next)}
          onRemove={() => {
            setEffects((prev) => prev.filter((_, j) => j !== i));
            setFocused(null);
          }}
        />
      ))}

      <section className="rounded-lg border border-dashed border-line bg-white p-4">
        {adding ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] text-ink-faint">What should this event change?</p>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-[11px] text-ink-faint hover:text-ink"
              >
                Cancel
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {targets.map((t) => (
                <button
                  key={t.path}
                  type="button"
                  onClick={() => {
                    setEffects((prev) => [...prev, blankEffect(t, horizon, prev.length + 1)]);
                    setAdding(false);
                  }}
                  className="rounded-md border border-line px-3 py-2 text-left hover:border-brand"
                >
                  <span className="block text-xs text-ink">{t.label}</span>
                  <span className="block text-[11px] leading-snug text-ink-faint">{t.help}</span>
                </button>
              ))}
              {targets.length === 0 ? (
                <p className="text-[11px] text-ink-faint">
                  The engine did not return a catalogue, so there is nothing to
                  perturb. Check that the simulation service is reachable.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:border-brand hover:text-brand"
          >
            Add an effect
          </button>
        )}
      </section>

      {problems.length > 0 ? (
        <section className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <h3 className="mb-2 text-xs font-medium text-ink">
            This event is not ready — it would change nothing, or be refused
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

function nameIn(snapshot: SimExport, id: string): string {
  return snapshot.facilities.find((f) => f.id === id)?.name ?? id.slice(0, 8);
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
  target,
  horizon,
  vocab,
  snapshot,
  valuesByType,
  focused,
  onFocus,
  onChange,
  onRemove,
}: {
  effect: SimEffect;
  index: number;
  target: SimTarget | undefined;
  horizon: number;
  vocab: Vocabulary;
  snapshot: SimExport;
  valuesByType: Map<string, Map<string, Set<string>>>;
  focused: boolean;
  onFocus: () => void;
  onChange: (next: Partial<SimEffect>) => void;
  onRemove: () => void;
}) {
  const sentence = describeEffect(effect, target, vocab);
  const inert = inertReasons(effect, target, horizon);
  const p = effect.profile;
  const isObject = effect.target === OBJECT_TARGET;
  const chosenTypes = effect.select.object_type ?? [];

  // Everything about an object effect's fields is read from what the institution
  // declared, not from the target's fixed opinion: which operations compose,
  // what the unit is called, what range the value lives in, and whether the
  // field takes a word or a figure.
  const declared = useMemo(
    () => (isObject ? declaredProperties(snapshot, chosenTypes) : []),
    [isObject, snapshot, chosenTypes],
  );
  const resolved = useMemo(
    () => resolveProperty(snapshot, chosenTypes, effect.property_key),
    [snapshot, chosenTypes, effect.property_key],
  );
  const ops = isObject ? opsFor(resolved.behaviour) : (target?.ops ?? []);
  const textValued = isObject
    ? valueKind(resolved, effect.op) === "text"
    : false;
  const declarationProblem = isObject ? propertyProblem(resolved, effect.op) : null;
  const valueChoices = Array.from(
    new Set(
      Array.from(valuesByType.entries())
        .filter(([type]) => chosenTypes.length === 0 || chosenTypes.includes(type))
        .flatMap(([, keys]) => Array.from(keys.get(effect.property_key ?? "") ?? [])),
    ),
  ).sort();

  return (
    <section
      onFocusCapture={onFocus}
      className={`rounded-lg border bg-white p-4 ${
        focused ? "border-brand" : "border-line"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
          {target?.label ?? effect.target}
        </span>
        <input
          value={effect.id}
          onChange={(e) => onChange({ id: e.target.value })}
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

      {target ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {target.selector.map((dimension) => (
              <Picker
                key={dimension}
                label={DIMENSION_LABEL[dimension]}
                options={vocab[dimension] ?? []}
                selected={effect.select[dimension] ?? []}
                onToggle={(id) => {
                  const current = effect.select[dimension] ?? [];
                  const next = current.includes(id)
                    ? current.filter((x) => x !== id)
                    : [...current, id];
                  onChange({ select: { ...effect.select, [dimension]: next } });
                }}
              />
            ))}
          </div>

          {isObject ? (
            <ObjectFields
              effect={effect}
              declared={declared}
              resolved={resolved}
              onChange={onChange}
            />
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-[150px_150px]">
            <Field label="Change">
              <select
                value={effect.op}
                onChange={(e) => {
                  const op = e.target.value as SimEffect["op"];
                  // Switching away from `set` on an object property leaves a
                  // string in a field that now means arithmetic. Reset it
                  // rather than let the engine refuse a payload the form
                  // produced.
                  const value =
                    isObject && op !== "set" && typeof effect.value === "string"
                      ? 1
                      : effect.value;
                  onChange({ op, value });
                }}
                className={INPUT}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABEL[op]}
                  </option>
                ))}
              </select>
              {isObject && ops.length === 1 ? (
                <span className="text-[10px] leading-snug text-ink-faint">
                  {resolved.behaviour === "state"
                    ? "Declared a state, so it is replaced rather than calculated with."
                    : "Only setting a value is well-defined until the property declares how it composes."}
                </span>
              ) : null}
            </Field>
            <Field label={isObject ? valueLabel(resolved, effect.op) : target.unit || "Value"}>
              {textValued ? (
                <>
                  <input
                    list={`values-${index}`}
                    value={String(effect.value ?? "")}
                    onChange={(e) => onChange({ value: e.target.value })}
                    placeholder="e.g. contaminated"
                    className={INPUT}
                  />
                  <datalist id={`values-${index}`}>
                    {valueChoices.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </>
              ) : (
                <input
                  inputMode="decimal"
                  value={effect.value}
                  onChange={(e) => onChange({ value: Number(e.target.value) || 0 })}
                  className={INPUT}
                />
              )}
            </Field>
          </div>

          {declarationProblem ? (
            <p className="mt-2 text-[11px] leading-relaxed text-warn">{declarationProblem}</p>
          ) : null}
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-danger">
          This effect names “{effect.target}”, which the engine does not offer.
          It was probably written against an older catalogue. Remove it, or add a
          replacement.
        </p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Field label="Shape">
          <select
            value={p.shape}
            onChange={(e) => onChange({ profile: { ...p, shape: e.target.value as ProfileShape } })}
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
            onChange={(e) => onChange({ profile: { ...p, start: Number(e.target.value) || 0 } })}
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
              })
            }
            className={INPUT}
          />
        </Field>
        <Field label="Intensity">
          <input
            inputMode="decimal"
            value={p.peak}
            onChange={(e) => onChange({ profile: { ...p, peak: Number(e.target.value) || 0 } })}
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

/**
 * The property to change, chosen from what the ontology declares.
 *
 * A closed list, and that is the change. It used to be a free-text box with the
 * keys instances happened to carry as suggestions, so an effect could name a key
 * nothing declared — which is inert in the most convincing way available: it
 * selects real objects, runs without error, and reads as a network that shrugged
 * off a disaster.
 */
function ObjectFields({
  effect,
  declared,
  resolved,
  onChange,
}: {
  effect: SimEffect;
  declared: ResolvedProperty[];
  resolved: ResolvedProperty;
  onChange: (next: Partial<SimEffect>) => void;
}) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px]">
      <Field label="Property to change">
        <select
          value={effect.property_key ?? ""}
          onChange={(e) => onChange({ property_key: e.target.value || null })}
          className={INPUT}
        >
          <option value="">Pick a property…</option>
          {declared.map((d) => (
            <option key={d.key} value={d.key}>
              {d.key}
              {d.def?.unit?.trim() ? ` (${d.def.unit.trim()})` : ""}
            </option>
          ))}
          {/* An effect written before the property was removed from the schema
              would otherwise silently switch to the first entry in the list, so
              the stale key stays selectable and is called out below. */}
          {effect.property_key && resolved.undeclared ? (
            <option value={effect.property_key}>{effect.property_key} — no longer declared</option>
          ) : null}
        </select>
        <span className="text-[10px] leading-snug text-ink-faint">
          {declared.length > 0
            ? describeDeclaration(resolved) ||
              `${declared.length} propert${declared.length === 1 ? "y" : "ies"} declared on the selected types.`
            : "The selected object types declare no properties. Add them in the ontology manager — an effect has nothing to change until then."}
        </span>
      </Field>
      <Field label="How many">
        <input
          inputMode="decimal"
          value={effect.reach ?? ""}
          placeholder="all"
          onChange={(e) =>
            onChange({ reach: e.target.value === "" ? null : Number(e.target.value) })
          }
          className={INPUT}
        />
        <span className="text-[10px] leading-snug text-ink-faint">
          Blank is every matching object. Below 1 is a share of them; anything
          else is a count.
        </span>
      </Field>
    </div>
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
    <Field label={`${label}${selected.length === 0 ? " — all" : ""}`}>
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
