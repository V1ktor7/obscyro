import type { ActionEffect, ActionType, ActionTypeDraft, TwinOffer } from "../analyst-api";

// ---------------------------------------------------------------------------
// Action types, as the ontology manager words and edits them. No screen here.
//
// An action type is what the analyst may propose in a project: what it changes,
// within what bounds, in how long, and who can approve it. The server holds
// the rules; this file says a type in sentences, and turns what a person fills
// in into what the server reads.
//
// Nothing here is typed by name: an activity, a layer, a site or a response is
// picked from what the twin declares (`TwinOffer`).
// ---------------------------------------------------------------------------

export const EFFECTS: { key: ActionEffect; label: string; says: string }[] = [
  { key: "capacity", label: "Capacity", says: "Units of an activity added or closed at a site, from a day until the end of the run." },
  { key: "measure", label: "Measure", says: "Contact layers the twin declares, scaled in some catchments for some days." },
  { key: "transfer", label: "Transfer", says: "Waiting patients sent each day from one site to another, along a transfer route the twin holds." },
  { key: "response", label: "Recorded response", says: "Rules the engine evaluates at every step: a response of the library, or one the engine writes itself." },
];

export const effectLabel = (effect: ActionEffect): string => EFFECTS.find((e) => e.key === effect)!.label;

const days = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;
const some = (names: string[], most = 4): string => (names.length <= most ? names.join(", ") : `${names.slice(0, most).join(", ")} and ${names.length - most} more`);
const nameOf = (list: readonly { id: string; name: string }[] | undefined, id: string): string => list?.find((x) => x.id === id)?.name ?? id;

/** A range of units in words. Negative units are units closed. */
export function unitsText(min: number | null, max: number | null): string {
  if (min === null && max === null) return "any number of units";
  if (min !== null && max !== null) return min === max ? `${min} units` : `${min} to ${max} units`;
  return min !== null ? `${min} units or more` : `${max} units or fewer`;
}

/**
 * The bounds of an action type, one short line each, in the order a person
 * would say them. An unbounded type says so in one line.
 */
export function boundsLines(t: ActionType, offer: TwinOffer | null): string[] {
  const lines: string[] = [];
  if (t.effect === "capacity") {
    const b = t.bounds;
    lines.push(b.activity ? `On ${b.activity}` : "On any activity a site provides");
    if (b.minUnits !== null || b.maxUnits !== null) lines.push(unitsText(b.minUnits, b.maxUnits));
    lines.push(b.sites === null ? "At any site that provides it" : `At ${some(b.sites.map((id) => nameOf(offer?.sites, id)))}`);
    if (b.mode) lines.push(`Opened in mode “${b.mode}” of the price list`);
  } else if (t.effect === "measure") {
    const b = t.bounds;
    lines.push(b.layers === null ? "On any contact layer the twin declares" : b.layers.map((l) => `${l.layer}, factor ${l.minFactor} to ${l.maxFactor}`).join(" · "));
    if (b.maxDays !== null) lines.push(`${days(b.maxDays)} at most`);
    lines.push(b.catchments === null ? "In any catchment, or all of them" : `In ${some(b.catchments.map((id) => nameOf(offer?.catchments, id)))}`);
  } else if (t.effect === "transfer") {
    const b = t.bounds;
    if (b.maxPerDay !== null) lines.push(`${b.maxPerDay} patient${b.maxPerDay === 1 ? "" : "s"} a day at most`);
    lines.push(b.from === null ? "From any site a route leaves" : `From ${some(b.from.map((id) => nameOf(offer?.sites, id)))}`);
    lines.push(b.to === null ? "To any site a route reaches" : `To ${some(b.to.map((id) => nameOf(offer?.sites, id)))}`);
  } else {
    const allowed = t.bounds.responses;
    lines.push(allowed === null ? "Any recorded response" : `Only ${some(allowed.map((id) => nameOf(offer?.responses, id)))}`);
  }
  if (t.leadDays !== null) lines.push(t.leadDays === 0 ? "Can apply from the day of the decision" : `Takes ${days(t.leadDays)} before it can apply`);
  return lines;
}

/** What the list says beside a type's name. */
export function standingOf(t: ActionType): "built-in" | "built-in, changed here" | "this project's" {
  return !t.builtIn ? "this project's" : t.declared ? "built-in, changed here" : "built-in";
}

// --- the form -----------------------------------------------------------------

/**
 * What a person fills in. Numbers are kept as the text typed, so an empty box
 * is "no bound" and not a zero.
 */
export interface ActionForm {
  name: string;
  description: string;
  effect: ActionEffect;
  approver: string;
  leadDays: string;
  active: boolean;
  // capacity
  activity: string;
  minUnits: string;
  maxUnits: string;
  sites: string[] | null;
  mode: string;
  // measure
  layers: { layer: string; minFactor: string; maxFactor: string }[] | null;
  maxDays: string;
  catchments: string[] | null;
  // transfer
  maxPerDay: string;
  from: string[] | null;
  to: string[] | null;
  // response
  responses: string[] | null;
}

const text = (n: number | null): string => (n === null ? "" : String(n));

export function blankForm(effect: ActionEffect = "capacity"): ActionForm {
  return {
    name: "",
    description: "",
    effect,
    approver: "",
    leadDays: "",
    active: true,
    activity: "",
    minUnits: "",
    maxUnits: "",
    sites: null,
    mode: "",
    layers: null,
    maxDays: "",
    catchments: null,
    maxPerDay: "",
    from: null,
    to: null,
    responses: null,
  };
}

export function formOf(t: ActionType): ActionForm {
  const f = { ...blankForm(t.effect), name: t.name, description: t.description, approver: t.approver, leadDays: text(t.leadDays), active: t.active };
  if (t.effect === "capacity") return { ...f, activity: t.bounds.activity ?? "", minUnits: text(t.bounds.minUnits), maxUnits: text(t.bounds.maxUnits), sites: t.bounds.sites, mode: t.bounds.mode ?? "" };
  if (t.effect === "measure") {
    return {
      ...f,
      layers: t.bounds.layers ? t.bounds.layers.map((l) => ({ layer: l.layer, minFactor: String(l.minFactor), maxFactor: String(l.maxFactor) })) : null,
      maxDays: text(t.bounds.maxDays),
      catchments: t.bounds.catchments,
    };
  }
  if (t.effect === "transfer") return { ...f, maxPerDay: text(t.bounds.maxPerDay), from: t.bounds.from, to: t.bounds.to };
  return { ...f, responses: t.bounds.responses };
}

/** A box read as a number: empty is no bound, anything else has to be a number. */
function numberIn(box: string, what: string, problems: string[], whole = true): number | null {
  const s = box.trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || (whole && !Number.isInteger(n))) {
    problems.push(`${what} has to be a ${whole ? "whole " : ""}number, or left empty for no bound.`);
    return null;
  }
  return n;
}

/**
 * What the server is sent for a form, or what to correct first.
 *
 * The server checks everything again. These are the mistakes a person can be
 * told about before a round trip.
 */
export function draftOf(f: ActionForm): { draft: ActionTypeDraft; problems: string[] } {
  const problems: string[] = [];
  if (!f.name.trim()) problems.push("Give the action type a name, in your own words.");
  const leadDays = numberIn(f.leadDays, "The days before it can apply", problems);
  if (leadDays !== null && leadDays < 0) problems.push("The days before it can apply cannot be negative.");
  let bounds: Record<string, unknown> = {};
  if (f.effect === "capacity") {
    const minUnits = numberIn(f.minUnits, "The fewest units", problems);
    const maxUnits = numberIn(f.maxUnits, "The most units", problems);
    if (minUnits !== null && maxUnits !== null && minUnits > maxUnits) problems.push(`The fewest units (${minUnits}) is above the most (${maxUnits}).`);
    if (f.sites !== null && f.sites.length === 0) problems.push("Pick at least one site, or allow any site.");
    bounds = { activity: f.activity || null, minUnits, maxUnits, sites: f.sites, mode: f.mode || null };
  } else if (f.effect === "measure") {
    const layers =
      f.layers === null
        ? null
        : f.layers.map((l) => {
            const minFactor = numberIn(l.minFactor, `The lowest factor on ${l.layer}`, problems, false) ?? 0;
            const maxFactor = numberIn(l.maxFactor, `The highest factor on ${l.layer}`, problems, false) ?? 1;
            if (minFactor > maxFactor) problems.push(`On ${l.layer}, the lowest factor (${minFactor}) is above the highest (${maxFactor}).`);
            if (minFactor < 0 || maxFactor > 5) problems.push(`On ${l.layer}, a factor stays between 0 and 5.`);
            return { layer: l.layer, minFactor, maxFactor };
          });
    if (layers !== null && layers.length === 0) problems.push("Pick at least one contact layer, or allow any layer.");
    const maxDays = numberIn(f.maxDays, "The most days", problems);
    if (maxDays !== null && maxDays < 1) problems.push("A measure lasts at least one day.");
    if (f.catchments !== null && f.catchments.length === 0) problems.push("Pick at least one catchment, or allow any catchment.");
    bounds = { layers, maxDays, catchments: f.catchments };
  } else if (f.effect === "transfer") {
    const maxPerDay = numberIn(f.maxPerDay, "The most patients a day", problems);
    if (maxPerDay !== null && maxPerDay < 1) problems.push("A transfer sends at least one patient a day.");
    if (f.from !== null && f.from.length === 0) problems.push("Pick at least one site to send from, or allow any.");
    if (f.to !== null && f.to.length === 0) problems.push("Pick at least one site to send to, or allow any.");
    bounds = { maxPerDay, from: f.from, to: f.to };
  } else {
    if (f.responses !== null && f.responses.length === 0) problems.push("Pick at least one recorded response, or allow any.");
    bounds = { responses: f.responses };
  }
  return {
    draft: { name: f.name.trim(), description: f.description.trim(), effect: f.effect, bounds, leadDays, approver: f.approver.trim(), active: f.active },
    problems,
  };
}

/** The modes the price list holds for what a capacity type changes: for one activity, or for any. */
export function modesFor(offer: TwinOffer | null, activity: string): { mode: string; leadDays: number }[] {
  if (!offer) return [];
  const held = activity ? (offer.modes[activity] ?? []) : Object.values(offer.modes).flat();
  const seen = new Map<string, number>();
  for (const m of held) seen.set(m.mode, Math.min(seen.get(m.mode) ?? m.leadDays, m.leadDays));
  return Array.from(seen, ([mode, leadDays]) => ({ mode, leadDays }));
}

/** Where a tool is offered, in the words of the screen's tabs. */
export const WHERE: Record<string, string> = { ask: "Ask", options: "Options", events: "Event finder", investigate: "Investigate" };
