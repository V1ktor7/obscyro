"use client";

/**
 * What you land on: the events you have, or the offer to make one.
 *
 * The page used to open on a form with three shipped events pre-selected —
 * pandemic, flood, cyberattack. A modelling tool that hands you finished
 * artefacts is telling you what to think about, and the ones it hands you are
 * always the obvious ones. They are gone.
 *
 * So the first screen is a library. An event is a saved object with an id, a
 * name and a world it was written against; opening one is how you edit or run
 * it. Nothing is offered until something has been made.
 */

import type { SimEvent } from "@/lib/platform-api";

export interface EventLibraryProps {
  events: SimEvent[];
  /** Events written against a different world, which cannot run here. */
  elsewhere: SimEvent[];
  worldLabel: string;
  onOpen: (event: SimEvent) => void;
  onCreate: () => void;
}

export default function EventLibrary({
  events,
  elsewhere,
  worldLabel,
  onOpen,
  onCreate,
}: EventLibraryProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-xs font-medium text-ink">Your events</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            Written against <strong className="font-medium text-ink">{worldLabel}</strong>.
            An event names things by id, so it belongs to the world it was built in.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-md bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-deep"
        >
          Create an event
        </button>
      </div>

      {events.length === 0 ? (
        <EmptyState onCreate={onCreate} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onOpen(e)}
                className="w-full rounded-lg border border-line bg-white p-3 text-left hover:border-brand focus:border-brand focus:outline-none"
              >
                <span className="block truncate text-xs text-ink">{e.name}</span>
                <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                  {e.description || "No description"}
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <Tag>
                    {e.effects.length} effect{e.effects.length === 1 ? "" : "s"}
                  </Tag>
                  <Tag>{e.horizon} steps</Tag>
                  {e.effects.length === 0 ? (
                    // Saved-but-empty is a real state — an event is allowed to
                    // be a draft — and it is worth flagging here rather than
                    // only when a run refuses it.
                    <Tag tone="warn">nothing to apply yet</Tag>
                  ) : null}
                </span>
                <span className="mt-2 block text-[10px] text-ink-ghost">
                  edited {new Date(e.updatedAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {elsewhere.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {elsewhere.length} other event{elsewhere.length === 1 ? "" : "s"} —{" "}
          {elsewhere.map((e) => e.name).join(", ")} — {elsewhere.length === 1 ? "was" : "were"}{" "}
          written against a different world and {elsewhere.length === 1 ? "does" : "do"} not
          appear here. Their effects name instances that only exist there.
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white p-6">
      <h3 className="text-xs font-medium text-ink">No events yet</h3>
      <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-ink-faint">
        An event is a set of changes to your network, placed in time: a wing
        closes, a route is cut, admissions rise, a wing opens. Nothing here
        decides whether a change is bad — that is what lets the same tool model a
        flood and an expansion.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-3 rounded-md bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-deep"
      >
        Create your first event
      </button>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        tone === "warn" ? "bg-warn/10 text-warn-ink" : "bg-canvas text-ink-faint"
      }`}
    >
      {children}
    </span>
  );
}
