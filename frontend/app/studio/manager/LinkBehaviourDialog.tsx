"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import {
  setLinkTypeBehaviour,
  type EnvLinkType,
  type LinkBehaviour,
  type LinkCardinality,
} from "@/lib/platform-api";

const CARDINALITIES: { value: LinkCardinality; label: (from: string, to: string) => string }[] = [
  { value: "many_to_one", label: (f, t) => `many ${f} → one ${t}` },
  { value: "one_to_many", label: (f, t) => `one ${f} → many ${t}` },
  { value: "one_to_one", label: (f, t) => `one ${f} → one ${t}` },
  { value: "many_to_many", label: (f, t) => `many ${f} → many ${t}` },
];

// ---------------------------------------------------------------------------
// What a relationship does.
//
// The twin engine used to recognise three names written into the code —
// `contains`, `located_in`, `located_in_bed`. Anything else got no roll-up at
// all: an empty tree, percentages at zero, and no message saying why. These
// three settings are what it reads instead, so a relationship can be called
// whatever the institution calls it.
//
// The dialog says the settings back in plain words rather than "source" and
// "target". Nobody should have to hold the arrow's direction in their head to
// know whether beds will end up counted in the ward or the ward in the bed.
// ---------------------------------------------------------------------------

export default function LinkBehaviourDialog({
  env,
  linkType,
  onSaved,
  onClose,
}: {
  env: string;
  linkType: EnvLinkType;
  onSaved: (updated: EnvLinkType) => void;
  onClose: () => void;
}) {
  const [aggregates, setAggregates] = useState<"metrics" | null>(linkType.aggregates);
  const [toward, setToward] = useState<"source" | "target" | null>(
    linkType.aggregateToward ?? "target",
  );
  const [transitive, setTransitive] = useState(linkType.transitive);
  const [cardinality, setCardinality] = useState(linkType.cardinality);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chaining needs a second link of the same shape to follow. A bed is in a
  // ward, and there is no bed inside a bed — so the option is not offered
  // rather than offered and ignored.
  const chainable = linkType.fromType === linkType.toType;
  const receiver = toward === "source" ? linkType.fromType : linkType.toType;
  const giver = toward === "source" ? linkType.toType : linkType.fromType;

  async function save() {
    setSaving(true);
    setError(null);
    const behaviour: LinkBehaviour = {
      aggregates,
      aggregateToward: aggregates ? toward : null,
      transitive: aggregates ? transitive && chainable : false,
    };
    try {
      onSaved(
        await setLinkTypeBehaviour(env, linkType.name, {
          ...behaviour,
          cardinality: cardinality as LinkCardinality,
        }),
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-[460px] flex-col overflow-hidden rounded-md border border-line bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
          <p className="flex-1 text-xs font-medium text-ink">
            What <span className="font-semibold">{linkType.name}</span> does
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-ink-faint hover:bg-canvas-raised hover:text-ink-body"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-3 text-[11px] text-ink-faint">
            {linkType.fromType} → {linkType.toType}
          </p>

          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            How many on each side
          </p>
          <select
            value={cardinality}
            onChange={(e) => setCardinality(e.target.value)}
            className="mb-1 w-full rounded border border-line bg-canvas px-2 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
          >
            {CARDINALITIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label(linkType.fromType, linkType.toType)}
              </option>
            ))}
          </select>
          <p className="mb-4 text-[10px] leading-relaxed text-ink-faint">
            Nothing enforces this yet — it documents the intent. Which is why a wrong
            one is worth fixing before something starts relying on it.
          </p>

          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            What travels along it
          </p>
          <div className="mb-1 flex gap-1">
            {(
              [
                [null, "Nothing"],
                ["metrics", "Metrics"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setAggregates(value)}
                className={cn(
                  "flex-1 rounded border px-2 py-1.5 text-[11.5px]",
                  aggregates === value
                    ? "border-brand bg-brand-soft font-medium text-brand-deep"
                    : "border-line text-ink-body hover:border-brand",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mb-4 text-[10px] leading-relaxed text-ink-faint">
            Nothing is the ordinary answer. A transfer between two wards is a real
            relationship, but the beds of one do not become the beds of the other.
          </p>

          {aggregates ? (
            <>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
                Which end receives
              </p>
              <div className="mb-1 flex gap-1">
                {(
                  [
                    ["target", linkType.toType],
                    ["source", linkType.fromType],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setToward(value)}
                    className={cn(
                      "flex-1 truncate rounded border px-2 py-1.5 text-[11.5px]",
                      toward === value
                        ? "border-brand bg-brand-soft font-medium text-brand-deep"
                        : "border-line text-ink-body hover:border-brand",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mb-4 text-[10px] leading-relaxed text-ink-faint">
                “A contains B” and “B part of A” describe the same tree with the arrow
                reversed. This is the only thing that tells them apart.
              </p>

              <label
                className={cn(
                  "mb-1 flex items-start gap-2",
                  !chainable && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={transitive && chainable}
                  disabled={!chainable}
                  onChange={(e) => setTransitive(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[11.5px] text-ink">It chains with itself</span>
              </label>
              <p className="mb-4 text-[10px] leading-relaxed text-ink-faint">
                {chainable
                  ? `If A → B and B → C, then A receives from C as well. Without it a roll-up climbs one step and the top reads zero.`
                  : `Not available: this relationship runs ${linkType.fromType} → ${linkType.toType}, so there is no second link of the same shape to follow.`}
              </p>
            </>
          ) : null}

          <div className="rounded border border-line-soft bg-canvas px-3 py-2">
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              In other words
            </p>
            <p className="text-[11.5px] leading-relaxed text-ink-body">
              {aggregates === null ? (
                <>
                  A {linkType.name} is recorded and can be queried, but no number moves
                  because of it.
                </>
              ) : (
                <>
                  The numbers of each <span className="font-medium">{giver}</span> count
                  toward the <span className="font-medium">{receiver}</span> it is linked
                  to
                  {transitive && chainable ? ", and onward up the chain" : ""}.
                </>
              )}
            </p>
          </div>

          {error ? (
            <p className="mt-3 rounded border border-danger/20 bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line-soft px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line px-2.5 py-1 text-xs text-ink-body"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex items-center gap-1.5 rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-deep disabled:bg-ink-ghost"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
