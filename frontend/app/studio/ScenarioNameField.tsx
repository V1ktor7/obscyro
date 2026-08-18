"use client";

/**
 * Naming a scenario, inline.
 *
 * Both places that create a scenario used `window.prompt`. A browser that
 * suppresses dialogs — an embedded view, or a page the user has already told to
 * stop asking — returns null from it without showing anything, so the button
 * did nothing at all and explained nothing. A field that is visibly on the page
 * cannot fail that way.
 *
 * Shared rather than written twice, because the two screens would otherwise
 * drift into disagreeing about how a scenario gets named.
 */

import { useState } from "react";

export default function ScenarioNameField({
  initial = "",
  busy = false,
  action = "Create",
  onSubmit,
  onCancel,
}: {
  initial?: string;
  busy?: boolean;
  action?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        // Enter and Escape, because a one-field form that needs the mouse is
        // slower than the prompt it replaced.
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit(value);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Scenario name"
        aria-label="Scenario name"
        className="w-48 rounded border border-brand px-2 py-1 text-[11.5px] focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onSubmit(value)}
        disabled={busy || !value.trim()}
        className="rounded bg-brand px-2 py-1 text-[11px] text-white hover:bg-brand-deep disabled:bg-ink-ghost"
      >
        {busy ? "…" : action}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-1.5 py-1 text-[11px] text-ink-faint hover:text-ink"
      >
        Cancel
      </button>
    </span>
  );
}
